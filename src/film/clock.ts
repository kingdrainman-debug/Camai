/**
 * The frame clock.
 *
 * Video and film keep different time. A video frame is shown every 1/30 s; a
 * film frame was exposed every 1/18 s by a camera that did not hold its speed,
 * and is shown by a projector at whatever rate it runs — which need not be the
 * rate it was shot at. This module is where those clocks meet. Given a media
 * time it answers, for both renderers at once:
 *
 *   - which output frame this is, and which film frame each of its two
 *     fields shows (they differ on the mixed frames of a pulldown cadence)
 *   - when each of those film frames was exposed, which is the source time
 *     the picture has to come from
 *   - everything that happened to that particular frame: where the camera's
 *     claw left the image, where the projector's left the strip, how long the
 *     exposure was, whether a splice or a scratch was going through the gate
 *
 * Nothing here touches pixels. Both backends consume the same FrameState, so
 * they cannot disagree about time, and every event comes from
 * film-events.js — the file the audio worklet imports too — so the sound
 * cannot disagree either.
 */

import { Settings, bool, num, str } from '../core/params';
import { Gauge, gauge } from './formats';
import { stock } from './stocks';
import { Tone, buildTone } from './tone';
import {
  CH,
  bhash,
  clawStrike,
  flashStops,
  flickerAt,
  ihash,
  rollEnd,
  snoise,
  speedError,
  speedOffset,
  spliceAt,
  weave,
} from '../../public/worklets/film-events.js';

/** Margin of the exposure buffer beyond the camera aperture, per side. */
export const E_MARGIN = 0.04;
/** Margin of the film-frame buffer beyond the camera aperture, per side. */
export const F_MARGIN = 0.06;

export const MAX_SCRATCHES = 6;
export const MAX_HAIRS = 3;
export const HAIR_POINTS = 9;
export const MAX_SPECKS = 8;

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export interface Geometry {
  gauge: Gauge;
  /** Anamorphic squeeze: film millimetres are this much narrower than the picture. */
  squeeze: number;
  /** Camera aperture, film mm. */
  apW: number;
  apH: number;
  /** The part of the film the output frame shows, film mm, centred on the frame. */
  visW: number;
  visH: number;
  /** Shape of the output frame. */
  outAspect: number;
  /** Source aspect, for mapping the source onto the aperture. */
  srcAspect: number;
}

export function geometry(s: Settings, srcW: number, srcH: number): Geometry {
  const g = gauge(str(s, 'format.gauge'));
  const squeeze = bool(s, 'anamorphic.enabled') ? num(s, 'anamorphic.squeeze') : 1;
  const apW = g.width;
  const apH = g.height;
  const gateAsp = (apW * squeeze) / apH;
  const srcAspect = Math.max(srcW, 1) / Math.max(srcH, 1);
  const mode = str(s, 'framing.aspect');
  const outAspect =
    mode === 'gate' ? gateAsp : mode === 'source' ? srcAspect : Number(mode) > 0 ? Number(mode) : gateAsp;

  // The largest window of the output shape that fits inside the gate, then
  // grown or shrunk by the overscan.
  let visH: number;
  let visW: number;
  if (outAspect > gateAsp) {
    visW = apW;
    visH = (apW * squeeze) / outAspect;
  } else {
    visH = apH;
    visW = (apH * outAspect) / squeeze;
  }
  const k = 1 + num(s, 'framing.overscan');
  return { gauge: g, squeeze, apW, apH, visW: visW * k, visH: visH * k, outAspect, srcAspect };
}

/** Camera and projector speeds, and the rate of the video being made. */
export interface Rates {
  camera: number;
  projector: number;
  output: number;
}

const OUTPUT_FPS: Record<string, number> = {
  '23.976': 24000 / 1001,
  '24': 24,
  '25': 25,
  '29.97': 30000 / 1001,
  '30': 30,
  '50': 50,
  '59.94': 60000 / 1001,
};

export function rates(s: Settings): Rates {
  const g = gauge(str(s, 'format.gauge'));
  const camSel = str(s, 'format.fps');
  const camera = camSel === 'native' ? g.fps : Number(camSel) || g.fps;
  const projSel = bool(s, 'projector.enabled') ? str(s, 'projector.speed') : 'match';
  const projector = projSel === 'match' ? camera : Number(projSel) || camera;
  const outSel = str(s, 'framing.fps');
  const output = OUTPUT_FPS[outSel] ?? projector;
  return { camera, projector, output };
}

/**
 * How fast source time passes against output time. A 16 fps film on a 24 fps
 * projector runs through the source half as fast again.
 */
export function playbackRate(r: Rates): number {
  return r.projector / r.camera;
}

/* ------------------------------------------------------------------ *
 * Per-frame state
 * ------------------------------------------------------------------ */

export interface FieldState {
  /** Film frame number. */
  n: number;
  /** Source time this frame was exposed at. */
  capture: number;
  /** Image offset from the camera's registration error, film mm. */
  camWeave: [number, number];
  /** Strip offset in the projector, film mm, and its tilt in radians. */
  projWeave: [number, number];
  projRot: number;
  /** Exposure change in stops: flicker, camera starts, speed drift. */
  expStops: number;
  /** 1 on a splice, a fraction either side of one. */
  splice: number;
  /** Vertical jump of the strip as a splice goes through, film mm. */
  spliceJump: number;
  /** Light leak strength and where round the frame it is. */
  leak: number;
  leakAngle: number;
  /** Fog at the head or tail of the roll. */
  rollFog: number;
  /** A cue mark is printed on this frame. */
  cue: number;
  /** MAX_SCRATCHES × (x mm, half-width mm, strength, kind + depth). */
  scratches: Float32Array;
  /** 0..1 seed for this frame's grain and dirt. */
  seed: number;
  /** Lamp brightness while this field was captured (shutter, ripple). */
  lamp: number;
}

export interface FrameState {
  /** The seed everything here was hashed from. */
  seed: number;
  geometry: Geometry;
  tone: Tone;
  rates: Rates;
  /** Output time, seconds. */
  tOut: number;
  outFrame: number;
  fields: [FieldState, FieldState];
  /** Pulldown is building this frame from two fields. */
  interlaced: boolean;
  /** The two fields show different film frames. */
  mixed: boolean;
  /** Lower field first. */
  lowerFirst: boolean;

  // Lens, in exposure-buffer terms.
  lensSigmaMm: number;
  cornerSoft: number;
  vignette: number;
  caRel: number;
  distortion: number;
  flare: number;
  flareTint: number;
  streak: number;
  streakLen: number;
  streakTint: number;
  streakThreshold: number;

  // Projector.
  focusMm: number;
  buckleMm: number;
  hotspot: number;
  warmth: number;
  framingMm: number;

  // Gate dirt.
  hairs: Float32Array;
  hairWidth: Float32Array;
  specks: Float32Array;

  // Film dirt and damage (frame-independent strengths; the frame seed varies them).
  dust: number;
  fibres: number;
  dirtSizeMm: number;
  dirtNegative: number;
  spliceKind: number;
  spliceFlash: number;
  edgeFog: number;
  leakWarmth: number;
  vinegar: number;
  channelling: number;
  mould: number;
  water: number;
  flaking: number;
}

/** Light reaching the screen while a capture's shutter was open, relative to the average. */
function lampFactor(s: Settings, r: Rates, tStart: number, window: number): number {
  const projOn = bool(s, 'projector.enabled');
  const blades = projOn ? Number(str(s, 'projector.blades')) || 0 : 0;
  const ripple = projOn ? num(s, 'projector.lampRipple') : 0;
  if (blades <= 0 && ripple <= 0) return 1;
  const mains = Number(str(s, 'projector.mains')) || 60;
  const duty = 0.5;
  const N = 96;
  let lit = 0;
  for (let i = 0; i < N; i++) {
    const t = tStart + ((i + 0.5) / N) * window;
    const open = blades > 0 ? (((t * r.projector * blades) % 1) + 1) % 1 < duty ? 1 : 0 : 1;
    const lamp = 1 + ripple * Math.sin(2 * Math.PI * 2 * mains * t);
    lit += open * lamp;
  }
  return lit / N / (blades > 0 ? duty : 1);
}

function fieldState(
  s: Settings,
  geo: Geometry,
  r: Rates,
  seed: number,
  n: number,
  lamp: number,
): FieldState {
  const g = geo.gauge;
  const camOn = bool(s, 'camera.enabled');
  const projOn = bool(s, 'projector.enabled');
  const spliceOn = bool(s, 'splice.enabled');
  const leakOn = bool(s, 'leak.enabled');
  const scratchOn = bool(s, 'scratch.enabled');

  // ---- camera ----
  let camWeave: [number, number] = [0, 0];
  let expStops = 0;
  let capture = n / r.camera;
  if (camOn) {
    const amp = num(s, 'camera.weave') / 1000;
    const w = weave(n, seed, r.camera, num(s, 'camera.weaveSpeed'), num(s, 'camera.jitter'), CH.camWeaveX, CH.camWeaveY);
    // Registration error is mostly vertical — the claw sets where the frame
    // lands along the strip; the side guides only loosely hold it across.
    camWeave = [w[0] * amp * 0.5, w[1] * amp];
    expStops += num(s, 'camera.flicker') * flickerAt(n, seed);
    expStops += flashStops(n, seed, num(s, 'camera.flashRate'), r.camera, num(s, 'camera.flashFrames'));
    const drift = num(s, 'camera.speedDrift');
    if (drift > 0) {
      const tau = n / r.camera;
      expStops += Math.log2(1 + speedError(tau, seed, drift));
      capture += speedOffset(tau, seed, drift);
    }
  }

  // ---- projector ----
  let projWeave: [number, number] = [0, 0];
  let projRot = 0;
  if (projOn) {
    const amp = num(s, 'projector.weave') / 1000;
    const w = weave(n, seed + 7, r.projector, 1.3, 0.5, CH.projWeaveX, CH.projWeaveY);
    projWeave = [w[0] * amp * 0.6, w[1] * amp];
    const rot = num(s, 'projector.rotation');
    projRot = (rot * amp * snoise((n / r.projector) * 0.9, seed, CH.projRot)) / (geo.apH * 0.5);
    // The claw's own strike is part of the vertical error: a hard strike
    // throws the frame a little further. The sound uses the same number.
    projWeave[1] += (clawStrike(n, seed) - 0.5) * amp * 0.3;
  }

  // ---- splices ----
  let splice = 0;
  let spliceJump = 0;
  if (spliceOn) {
    const rate = num(s, 'splice.rate');
    const at = (k: number) => spliceAt(k, seed, rate, r.projector);
    if (at(n)) splice = 1;
    else if (at(n + 1) || at(n - 1)) splice = 0.3;
    const jump = num(s, 'splice.jump') * g.pitch;
    if (at(n)) spliceJump = jump * 0.22 * (ihash(n, seed, CH.spliceKind) < 0.5 ? 1 : -1);
    else if (at(n - 1)) spliceJump = jump * 0.06;
  }

  // ---- leaks ----
  let leak = 0;
  let leakAngle = 0;
  let rollFog = 0;
  if (leakOn) {
    const t = n / r.camera;
    const speed = num(s, 'leak.speed');
    const flare = 0.5 + 0.5 * snoise(t * speed * 0.8, seed, CH.leak);
    const burst = Math.max(0, snoise(t * speed * 2.7 + 9.1, seed, CH.leak + 1));
    leak = num(s, 'leak.amount') * (flare * flare * 0.7 + burst * burst * 0.8);
    leakAngle = num(s, 'leak.position') * Math.PI * 2 + snoise(t * speed * 0.3, seed, CH.leak + 2) * 0.5;
    const d = rollEnd(n, g.rollFrames);
    rollFog = num(s, 'leak.rollFog') * Math.exp(-d / (r.camera * 1.4)) * (0.8 + 0.2 * bhash(n, seed, CH.leak + 3));
  }

  // ---- cue marks ----
  let cue = 0;
  if (spliceOn && bool(s, 'splice.cueMarks')) {
    const reel = Math.max(10, Math.round(num(s, 'splice.reel') * r.projector));
    const p = ((n % reel) + reel) % reel;
    const first = reel - Math.round(8 * r.projector);
    const second = reel - Math.round(1 * r.projector);
    if ((p >= first && p < first + 4) || (p >= second && p < second + 4)) cue = 1;
  }

  // ---- scratches ----
  // Each slot is a piece of grit that arrives, rides in the gate for a while,
  // and falls out. Its scratch is on the film, so it is fixed in film
  // coordinates and weaves with the strip — but the grit, not the frame,
  // decides where it is, so it runs continuously from frame to frame.
  const scratches = new Float32Array(MAX_SCRATCHES * 4);
  if (scratchOn) {
    const rate = num(s, 'scratch.rate');
    const life = num(s, 'scratch.life') * r.projector;
    const halfW = num(s, 'scratch.width') / 2000;
    const depth = num(s, 'scratch.depth');
    const baseShare = num(s, 'scratch.base');
    const negShare = num(s, 'scratch.negative');
    const wander = num(s, 'scratch.wander');
    for (let k = 0; k < MAX_SCRATCHES; k++) {
      const len = life * (0.6 + 0.8 * ihash(k, seed, CH.scratch));
      const phase = ihash(k, seed, CH.scratch + 1) * len;
      const seg = Math.floor((n + phase) / len);
      const active = ihash(k, seg, seed + CH.scratch + 2) < rate * (k < 2 ? 1 : 0.6);
      if (!active) continue;
      const h1 = ihash(k, seg, seed + CH.scratch + 3);
      const h2 = ihash(k, seg, seed + CH.scratch + 4);
      const h3 = ihash(k, seg, seed + CH.scratch + 5);
      const x =
        (h1 - 0.5) * geo.apW * 0.92 +
        wander * 0.04 * geo.apW * snoise(n / r.projector * 0.4, seed + seg, CH.scratch + k);
      // Strength flickers a little from frame to frame as the grit rocks,
      // and the scratch occasionally breaks where it lifted off.
      const flick = 0.75 + 0.25 * bhash(n, k, seed + CH.scratch + 6);
      const broken = ihash(n, k, seed + CH.scratch + 7) < 0.04 ? 0 : 1;
      const base = h2 < baseShare ? 1 : 0;
      const neg = h3 < negShare ? 2 : 0;
      scratches[k * 4] = x;
      scratches[k * 4 + 1] = halfW * (0.6 + 0.8 * ihash(k, seg, seed + CH.scratch + 8));
      scratches[k * 4 + 2] = flick * broken;
      scratches[k * 4 + 3] = base + neg + Math.min(depth * (0.7 + 0.6 * h1), 0.99);
    }
  }

  return {
    n,
    capture,
    camWeave,
    projWeave,
    projRot,
    expStops,
    splice,
    spliceJump,
    leak,
    leakAngle,
    rollFog,
    cue,
    scratches,
    seed: ihash(n, seed, CH.dirt),
    lamp,
  };
}

/** Film frame shown at a given output time. */
function filmFrameAt(t: number, r: Rates): number {
  return Math.floor(t * r.projector + 1e-6);
}

export interface ClockInput {
  settings: Settings;
  /** Media (source) time in seconds. Ignored when outFrame is given. */
  time: number;
  /** Exact output frame index, for exports, which must not round. */
  outFrame?: number;
  seed: number;
  srcW: number;
  srcH: number;
}

export function frameState(input: ClockInput): FrameState {
  const s = input.settings;
  const seed = input.seed | 0;
  const geo = geometry(s, input.srcW, input.srcH);
  const tone = buildTone(s);
  const r = rates(s);
  const rate = playbackRate(r);

  const outFrame = input.outFrame ?? Math.floor((input.time / rate) * r.output + 1e-6);
  const tOut = outFrame / r.output;
  const fieldsOn = bool(s, 'telecine.enabled') && bool(s, 'telecine.fields');
  const lowerFirst = str(s, 'telecine.fieldOrder') === 'lower';

  const capWindow = (bool(s, 'projector.enabled') ? num(s, 'projector.captureShutter') : 0.5) / r.output;
  const t0 = tOut;
  const t1 = fieldsOn ? tOut + 0.5 / r.output : tOut;
  const n0 = filmFrameAt(t0, r);
  const n1 = filmFrameAt(t1, r);
  const lamp0 = lampFactor(s, r, t0, fieldsOn ? capWindow / 2 : capWindow);
  const lamp1 = fieldsOn ? lampFactor(s, r, t1, capWindow / 2) : lamp0;
  const f0 = fieldState(s, geo, r, seed, n0, lamp0);
  const f1 = n1 === n0 && lamp1 === lamp0 ? f0 : fieldState(s, geo, r, seed, n1, lamp1);

  const st = stock(str(s, 'format.stock'));

  // ---- lens ----
  const lensOn = bool(s, 'lens.enabled');
  const curveOn = bool(s, 'curve.enabled');
  const gen = tone.generations;
  const sq = (v: number) => v * v;
  // Gaussian sigma for a given MTF50, in mm on the film.
  const sigmaFor = (lpmm: number) => 0.1874 / Math.max(lpmm, 1);
  const lensSigmaMm = Math.sqrt(
    (lensOn ? sq(sigmaFor(num(s, 'lens.resolution'))) + sq(num(s, 'lens.defocus') / 2000) : 0) +
      (curveOn ? sq(sigmaFor(st.mtf50)) : 0) +
      gen * sq(sigmaFor(90)),
  );
  const halfDiag = Math.hypot(geo.apW / 2, geo.apH / 2);

  // ---- anamorphic ----
  const anaOn = bool(s, 'anamorphic.enabled');

  // ---- projector ----
  const projOn = bool(s, 'projector.enabled');
  const buckle = projOn ? num(s, 'projector.buckle') / 1000 : 0;
  const buckleNow = buckle * (0.55 + 0.45 * snoise(tOut * 0.31, seed, 777)) + buckle * 0.25 * Math.max(0, snoise(tOut * 1.7, seed, 778));

  // ---- gate dirt ----
  const hairs = new Float32Array(MAX_HAIRS * HAIR_POINTS * 2);
  const hairWidth = new Float32Array(MAX_HAIRS);
  const specks = new Float32Array(MAX_SPECKS * 4);
  if (bool(s, 'gatedirt.enabled')) {
    const life = num(s, 'gatedirt.life');
    const size = num(s, 'gatedirt.size');
    const wiggle = num(s, 'gatedirt.wiggle');
    const hairP = num(s, 'gatedirt.hair');
    const speckP = num(s, 'gatedirt.specks');
    const nShown = f0.n;
    for (let k = 0; k < MAX_HAIRS; k++) {
      const len = life * (0.6 + 0.8 * ihash(k, seed, CH.hair));
      const seg = Math.floor(tOut / len + ihash(k, seed, CH.hair + 1));
      if (ihash(k, seg, seed + CH.hair + 2) >= hairP * (k === 0 ? 1 : 0.55)) continue;
      // Anchored on one edge of the aperture, reaching inward and curling.
      const edge = Math.floor(ihash(k, seg, seed + CH.hair + 3) * 4);
      const along = 0.12 + 0.76 * ihash(k, seg, seed + CH.hair + 4);
      const length = (0.08 + 0.18 * ihash(k, seg, seed + CH.hair + 5)) * size;
      const curl = bhash(k, seg, seed + CH.hair + 6) * 2.4;
      const lean = bhash(k, seg, seed + CH.hair + 7) * 0.7;
      let ax = 0;
      let ay = 0;
      let dir = 0;
      if (edge === 0) { ax = along; ay = 0; dir = Math.PI / 2; }
      else if (edge === 1) { ax = along; ay = 1; dir = -Math.PI / 2; }
      else if (edge === 2) { ax = 0; ay = along; dir = 0; }
      else { ax = 1; ay = along; dir = Math.PI; }
      dir += lean;
      // Each frame pulled past nudges it; it also sways slowly.
      const flutter = wiggle * (bhash(nShown, k, seed + CH.hair + 8) * 0.35 + snoise(tOut * 1.3, seed + k, CH.hair + 9) * 0.5);
      const aspect = geo.outAspect;
      let x = ax;
      let y = ay;
      let a = dir;
      const step = length / (HAIR_POINTS - 1);
      for (let p = 0; p < HAIR_POINTS; p++) {
        hairs[(k * HAIR_POINTS + p) * 2] = x;
        hairs[(k * HAIR_POINTS + p) * 2 + 1] = y;
        a += (curl + flutter * (p / HAIR_POINTS) * 3) / HAIR_POINTS;
        x += (Math.cos(a) * step) / aspect;
        y += Math.sin(a) * step;
      }
      hairWidth[k] = (0.0016 + 0.0016 * ihash(k, seg, seed + CH.hair + 10)) * size;
    }
    for (let k = 0; k < MAX_SPECKS; k++) {
      const len = life * (0.5 + ihash(k, seed, CH.speck));
      const seg = Math.floor(tOut / len + ihash(k, seed, CH.speck + 1));
      if (ihash(k, seg, seed + CH.speck + 2) >= speckP * (1 - k * 0.08)) continue;
      // Grit collects towards the edges of a gate, where the film drags.
      const u = ihash(k, seg, seed + CH.speck + 3);
      const v = ihash(k, seg, seed + CH.speck + 4);
      const edgeU = u < 0.5 ? Math.pow(u * 2, 2) * 0.5 : 1 - Math.pow((1 - u) * 2, 2) * 0.5;
      specks[k * 4] = ihash(k, seg, seed + CH.speck + 5) < 0.5 ? edgeU : u;
      specks[k * 4 + 1] = v;
      specks[k * 4 + 2] = (0.002 + 0.006 * Math.pow(ihash(k, seg, seed + CH.speck + 6), 2)) * size;
      specks[k * 4 + 3] = 0.6 + 0.4 * ihash(k, seg, seed + CH.speck + 7);
    }
  }

  const dirtOn = bool(s, 'filmdirt.enabled');
  const spliceOn = bool(s, 'splice.enabled');
  const leakOn = bool(s, 'leak.enabled');
  const decayOn = bool(s, 'decay.enabled');

  return {
    seed,
    geometry: geo,
    tone,
    rates: r,
    tOut,
    outFrame,
    fields: [f0, f1],
    interlaced: fieldsOn,
    mixed: f0.n !== f1.n,
    lowerFirst,
    lensSigmaMm,
    cornerSoft: lensOn ? num(s, 'lens.corners') : 0,
    vignette: lensOn ? num(s, 'lens.vignette') : 0,
    caRel: lensOn ? num(s, 'lens.chromatic') / 1000 / halfDiag : 0,
    distortion: lensOn ? num(s, 'lens.distortion') : 0,
    flare: lensOn ? num(s, 'lens.flare') : 0,
    flareTint: num(s, 'lens.flareTint'),
    streak: anaOn ? num(s, 'anamorphic.streak') : 0,
    streakLen: num(s, 'anamorphic.streakLength'),
    streakTint: num(s, 'anamorphic.streakTint'),
    streakThreshold: num(s, 'anamorphic.threshold'),
    focusMm: projOn ? num(s, 'projector.focus') / 1000 : 0,
    buckleMm: buckleNow,
    hotspot: projOn ? num(s, 'projector.hotspot') : 0,
    warmth: projOn ? num(s, 'projector.warmth') : 0,
    framingMm: projOn ? num(s, 'projector.framing') * geo.gauge.pitch : 0,
    hairs,
    hairWidth,
    specks,
    dust: dirtOn ? num(s, 'filmdirt.dust') : 0,
    fibres: dirtOn ? num(s, 'filmdirt.fibres') : 0,
    dirtSizeMm: num(s, 'filmdirt.size') * 0.03,
    // Only a printed negative has a second film for dirt to be on. A scanned
    // or raw negative is the only film there is; a reversal original likewise.
    dirtNegative: tone.mode === 0 ? (tone.process === 0 ? num(s, 'filmdirt.negative') : 1) : 0,
    spliceKind: str(s, 'splice.kind') === 'cement' ? 1 : 0,
    spliceFlash: spliceOn ? num(s, 'splice.flash') : 0,
    edgeFog: leakOn ? num(s, 'leak.edgeFog') : 0,
    leakWarmth: num(s, 'leak.warmth'),
    vinegar: decayOn ? num(s, 'decay.vinegar') : 0,
    channelling: decayOn ? num(s, 'decay.channelling') : 0,
    mould: decayOn ? num(s, 'decay.mould') : 0,
    water: decayOn ? num(s, 'decay.water') : 0,
    flaking: decayOn ? num(s, 'decay.flaking') : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Buffer sizes
 * ------------------------------------------------------------------ */

export interface BufferSizes {
  /** Exposure buffer: the aperture plus E_MARGIN, at about source resolution. */
  eW: number;
  eH: number;
  /** Film-frame buffer: the aperture plus F_MARGIN, at output pixel pitch. */
  fW: number;
  fH: number;
}

export function bufferSizes(geo: Geometry, srcH: number, outH: number): BufferSizes {
  const k = 1 + 2 * F_MARGIN;
  // One film-frame pixel per output pixel, measured on the film.
  const fH = Math.max(16, Math.min(Math.round((outH * geo.apH * k) / geo.visH), outH * 2, 2600));
  const fW = Math.max(16, Math.round((fH * geo.apW) / geo.apH));
  // The exposure buffer never needs more detail than the film can show, nor
  // more than the source has.
  const eH = Math.max(16, Math.min(Math.round(srcH * (1 + 2 * E_MARGIN)), fH, 2200));
  const eW = Math.max(16, Math.round((eH * geo.apW) / geo.apH));
  return { eW, eH, fW, fH };
}
