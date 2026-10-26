/**
 * Everything both renderers derive from the settings and the clock, in one
 * place: per field, where the camera pointed and how it exposed; per frame,
 * the DSP, the codec, the tape, the overlays and the display mapping.
 *
 * The GPU and the CPU backends read one FramePlan rather than computing these
 * twice, so they cannot disagree about anything but arithmetic. This is also
 * where the engine order is fixed (lesson 11 from FILMBOX): gain noise before
 * sharpening, sharpening before the codec, imprinted text before the codec
 * and playback text after decode, concealment after decode, analogue capture
 * after all of it.
 */

import { Settings, bool, code, num, str } from '../core/params';
import { Automatics, Exposure } from './automatics';
import { ACTIVE_W, FrameState, frameAspect, pixelAspect, shutterRepeat } from './clock';
import { OsdImage, drawDate, drawDisplay, overlayPaths } from './osd';
import { meterView } from '../video/sources';
import { Timeline, isAnimated, valueAt } from '../core/timeline';
import { ihash, operatorAt } from '../../public/worklets/camai-events.js';

/** Rows of the view table: a rolling shutter samples the camera's motion at this many heights. */
export const VIEW_ROWS = 8;
export const VIEW_TAPS = 4;

/** Bits for the AC coefficients of one five-macroblock video segment at 25 Mbit/s. */
export const SEGMENT_BITS = 5 * (4 * (14 * 8 - 12) + 2 * (10 * 8 - 12));

/**
 * Coefficient scale and class bounds of the quantiser, in orthonormal DCT
 * units of 8-bit codes. Calibrated against FFmpeg's dvvideo encoder by the
 * smoke test's codec stage; see the README for the figures.
 */
export const DV_QSCALE = 1.0;
export const DV_CLASS_BOUNDS: [number, number, number] = [24, 48, 72];

/**
 * What a field line of the complementary mosaic measures, as a matrix on
 * linear RGB: the pair-summed total, and the two colour differences the two
 * kinds of line carry (see demod.frag.glsl). `k` is how much each filter
 * passes of the colours it should block.
 */
function mosaicMatrix(k: number): number[] {
  const Cy = [k, 1, 1];
  const Ye = [1, 1, k];
  const Mg = [1, k, 1];
  const G = [k, 1, k];
  const row = (f: (i: number) => number) => [0, 1, 2].map(f);
  return [
    ...row((i) => (Cy[i] + G[i] + Ye[i] + Mg[i]) / 2),
    ...row((i) => (Cy[i] + G[i] - Ye[i] - Mg[i]) / 2),
    ...row((i) => (Cy[i] + Mg[i] - Ye[i] - G[i]) / 2),
  ];
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}

/**
 * The camera's decoding matrix. It was designed for its own filters, but
 * only partly: it undoes about half of their overlap, which is where the
 * single-chip camera's muddy saturated colours come from. It is calibrated
 * so that white decodes to white, as a factory would have set it.
 */
export function decodeMatrix(k: number): number[] {
  const inv = invert3(mosaicMatrix(k * 0.5));
  const white = mul3(mul3(inv, mosaicMatrix(k)), [1, 0, 0, 1, 0, 0, 1, 0, 0]);
  const out = inv.slice();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] /= white[r * 3];
  return out;
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

const SENSOR_WIDTH_MM: Record<string, number> = { '1/6': 2.4, '1/4': 3.6, '1/3.6': 4.0, '1/3': 4.8 };
const SENSOR_NOISE: Record<string, number> = { '1/6': 1.7, '1/4': 1, '1/3.6': 0.85, '1/3': 0.65 };

export interface FieldPlan {
  m: number;
  parity: 0 | 1;
  /** Source tags this field samples, and which of them each motion tap uses. */
  tapTags: number[];
  taps: number;
  tapSrc: [number, number, number, number];
  rows: number;
  /** VIEW_ROWS × VIEW_TAPS × (cu, cv, roll, z). */
  view: Float32Array;
  light: [number, number, number];
  veil: [number, number, number];
  ir: number;
  sigma0: number;
  /** Decoding matrix for the complementary mosaic, row-major. */
  minv: number[];
  sensor: {
    type: number;
    crosstalk: number;
    well: number;
    bloom: number;
    smearK: number;
    read: number;
    shot: number;
    integrate: number;
  };
  gain: number;
  wb: [number, number, number];
  exposure: Exposure;
  fade: number;
}

export interface FramePlan {
  fs: FrameState;
  W: number;
  H: number;
  /** Picture aspect: 4:3, or 16:9 in the camera's 16:9 mode. */
  aspect: number;
  fit: [number, number];
  dist: [number, number];
  ca: number;
  vignette: number;
  circle: number;
  headroom: number;
  irSpot: number;
  /** How strongly retro-reflections glow under the IR lamp. */
  eyes: number;
  sigmaCorner: number;
  rim: [number, number, number];
  fields: [FieldPlan, FieldPlan];
  dsp: {
    dz: number;
    dzNearest: number;
    toneOn: number;
    gamma: number;
    knee: number;
    slope: number;
    clip: number;
    pedestal: number;
    sat: number;
    detailOn: number;
    dGain: number;
    dFreq: number;
    dVert: number;
    dCoring: number;
    dLimit: number;
    dDark: number;
    green: number;
    effect: number;
    effectSize: number;
    fadeWhite: number;
    flicker: number;
    trail: boolean;
  };
  codec: {
    on: boolean;
    subsample: boolean;
    dct248: number;
    classes: number;
    budget: number;
    shuffle: boolean;
    linear: number;
  };
  tape: {
    lost: Uint8Array | null;
    conceal: number;
    clog: number;
    garbage: number;
    dead: number;
  };
  /** The two overlay layers and their paths: 0 before the codec, 1 after decode, 2 on the display, −1 off. */
  osd: [OsdImage | null, OsdImage | null];
  osdPath: [number, number];
  post: {
    path: number;
    comb: number;
    sigY: number;
    sigC: number;
    delay: number;
    noise: number;
    levels: number;
    pal: number;
  };
  upload: { on: boolean; W: number; H: number; q: number; par: number };
  present: {
    deint: number;
    field: number;
    scaler: number;
    /** The picture's rectangle in DV pixels: x0, y0, width, height. */
    map: [number, number, number, number];
    dither: number;
  };
  /** The source frame for the split view, as a cover fit of the output. */
  srcMap: [number, number, number, number];
  zoom: { total: number; optical: number; digital: number; range: number };
}

export interface PlanInput {
  settings: Settings;
  fs: FrameState;
  srcW: number;
  srcH: number;
  /** The metering thumbnail for a source tag. */
  thumbOf: (tag: number) => Float32Array;
  auto: Automatics;
  zoomMoving?: boolean;
  /**
   * Where the camera is deliberately pointed at a source time — pan, tilt
   * and roll from the keyframes — so that a keyframed pan moves within a
   * field's exposure and down a rolling shutter's readout. Without it the
   * frame's settings hold still for the whole frame.
   */
  aimAt?: AimAt;
  outW: number;
  outH: number;
}

export type AimAt = (t: number) => [number, number, number];

/** An aimAt for a timeline, or undefined when pan, tilt and roll are not keyframed. */
export function aimFromTimeline(base: Settings, timeline: Timeline): AimAt | undefined {
  const keys = ['operator.pan', 'operator.tilt', 'operator.roll'] as const;
  if (!keys.some((k) => isAnimated(timeline, k))) return undefined;
  return (t) =>
    keys.map((k) => {
      const v = isAnimated(timeline, k) ? valueAt(k, timeline[k], t) : undefined;
      return Number(v ?? base[k] ?? 0);
    }) as [number, number, number];
}

export function planFrame(inp: PlanInput): FramePlan {
  const s = inp.settings;
  const fs = inp.fs;
  const sys = fs.sys;
  const W = sys.W;
  const H = sys.H;
  const seed = fs.seed;

  const lensOn = bool(s, 'lens.enabled');
  const opOn = bool(s, 'operator.enabled');
  const sensorOn = bool(s, 'sensor.enabled');
  const expOn = bool(s, 'exposure.enabled');
  const eisOn = bool(s, 'eis.enabled');
  const dzOn = bool(s, 'dzoom.enabled');
  const nightOn = bool(s, 'night.enabled');
  const focusOn = bool(s, 'focus.enabled');
  const fxOn = bool(s, 'fx.enabled');
  const sensorType = sensorOn ? code(s, 'format.sensor') : 3;
  const sensorKey = str(s, 'format.sensor');

  const aspect = str(s, 'format.aspect') === '16:9' ? 16 / 9 : 4 / 3;
  const srcAspect = Math.max(inp.srcW, 1) / Math.max(inp.srcH, 1);
  const fitU = Math.min(1, aspect / srcAspect);
  const fitV = Math.min(1, srcAspect / aspect);
  const fit: [number, number] = [fitU / aspect, fitV];

  // ---- zoom ----
  const zoom = lensOn ? num(s, 'lens.zoom') : 1;
  const range = num(s, 'lens.range');
  const optical = Math.min(zoom, range);
  const digital = dzOn && zoom > range ? Math.min(zoom / range, num(s, 'dzoom.max')) : 1;
  const zFrac = range > 1 ? Math.log(optical) / Math.log(range) : 0;
  const margin = eisOn ? num(s, 'eis.margin') : 0;
  const crop = 1 / (1 - 2 * margin);
  const z = optical * crop;
  const fov = num(s, 'lens.fov');
  const degU = (aspect / fov) * fit[0];
  const degV = (aspect / fov) * fit[1];

  // ---- the lens ----
  const adapter = lensOn ? str(s, 'lens.adapter') : 'none';
  let k1 = lensOn ? num(s, 'lens.distortion') * (1 - 1.3 * zFrac) : 0;
  let k2 = 0;
  let corner = lensOn ? num(s, 'lens.corners') : 0;
  let vignette = lensOn ? num(s, 'lens.vignette') * (1 - 0.6 * zFrac) : 0;
  let circle = 0;
  let rim: [number, number, number] = [0, 0, 0];
  if (adapter === 'wide') {
    k1 += 0.2;
    corner += 1.5;
    vignette += 0.45;
  } else if (adapter === 'fisheye') {
    k1 += 0.6;
    k2 += 0.3;
    corner += 1.5;
    vignette += 0.6;
    circle = 0.66;
    rim = [0.66, 0.12, 2.6];
  }
  const rc = Math.hypot(aspect / 2, 0.5);
  const ca = lensOn ? (num(s, 'lens.chromatic') * (0.3 + 0.7 * zFrac)) / (rc * H) : 0;

  const o = {
    tremor: num(s, 'operator.tremor'),
    sway: num(s, 'operator.sway'),
    walk: num(s, 'operator.walk'),
    cadence: num(s, 'operator.cadence'),
    bumps: num(s, 'operator.bumps'),
    bumpSize: num(s, 'operator.bumpSize'),
    whips: num(s, 'operator.whips'),
    whipAngle: num(s, 'operator.whipAngle'),
  };
  const pointed = inp.aimAt;
  const aim = (t: number): [number, number, number] => {
    if (!opOn) return [0, 0, 0];
    const a = operatorAt(t, seed, o);
    const p = pointed ? pointed(t) : [num(s, 'operator.pan'), num(s, 'operator.tilt'), num(s, 'operator.roll')];
    return [a[0] + p[0], a[1] + p[1], a[2] + p[2]];
  };

  const rep = shutterRepeat(s, sys);
  const fieldPeriod = 1 / sys.fieldRate;
  const rolling = sensorOn && sensorKey === 'cmos1' ? num(s, 'sensor.rolling') * fieldPeriod : 0;
  const rows = opOn && rolling > 0 ? VIEW_ROWS : 1;
  const K = opOn || rep > 1 ? VIEW_TAPS : 1;

  const field = (j: 0 | 1): FieldPlan => {
    const f = fs.fields[j];
    // ---- metering, through the view at the middle of the field ----
    const a0 = aim(f.srcT);
    const thumb = inp.thumbOf(f.taps[0].tag);
    const meter = meterView(
      thumb,
      0.5 + a0[0] * degU,
      0.5 - a0[1] * degV,
      fitU / (2 * z * digital),
      fitV / (2 * z * digital),
    );
    const own = nightOn ? num(s, 'night.ir') * 0.35 : 0;
    const exp = inp.auto.step(s, sys, f.m, f.outT, meter, own);
    const T = rep > 1 ? rep * fieldPeriod : expOn ? exp.shutter : fieldPeriod;

    // ---- the stabiliser: the crop moves once a field against the shake's
    // fast part, as far as its margin allows ----
    let corr: [number, number] = [0, 0];
    if (eisOn && opOn) {
      let mp = 0;
      let mt = 0;
      const N = 12;
      for (let i = 0; i < N; i++) {
        const a = aim(f.srcT - 1 + (i + 0.5) / N);
        mp += a[0] / N;
        mt += a[1] / N;
      }
      const lim = (margin * fov) / optical;
      const st = num(s, 'eis.strength');
      corr = [clamp(-st * (a0[0] - mp), -lim, lim), clamp(-st * (a0[1] - mt), -lim, lim)];
    }

    const view = new Float32Array(VIEW_ROWS * VIEW_TAPS * 4);
    const tStart = rep > 1 ? f.srcT : f.srcT - T / 2;
    for (let r = 0; r < rows; r++) {
      const rowOff = rows > 1 ? (r / (rows - 1)) * rolling : 0;
      for (let k = 0; k < K; k++) {
        const t = tStart + (T * (k + 0.5)) / K + rowOff;
        const a = K === 1 && rows === 1 ? a0 : aim(t);
        const i = (r * VIEW_TAPS + k) * 4;
        view[i] = 0.5 + (a[0] + corr[0]) * degU;
        view[i + 1] = 0.5 - (a[1] + corr[1]) * degV;
        view[i + 2] = (a[2] * Math.PI) / 180;
        view[i + 3] = z;
      }
    }

    const tapTags = f.taps.map((t) => t.tag);
    const tapSrc: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) tapSrc[k] = Math.min(tapTags.length - 1, Math.floor((k * tapTags.length) / K));

    // ---- softness: the lens, the focus, diffraction, the stabiliser's crop ----
    const soft = lensOn ? num(s, 'lens.softness') : 0;
    const defocus = focusOn ? f.hunt * num(s, 'focus.depth') + num(s, 'focus.miss') : 0;
    const pitch = ((SENSOR_WIDTH_MM[str(s, 'format.sensorSize')] ?? 3.6) * 1000) / 720;
    const N = expOn ? exp.fNumber : 2.8;
    const diff = lensOn ? ((0.45 * 0.55 * N) / pitch) * num(s, 'lens.diffraction') : 0;
    const eisBlur = eisOn ? 0.8 * (crop - 1) : 0;
    const sigma0 = Math.sqrt(soft * soft + defocus * defocus + diff * diff + eisBlur * eisBlur);

    const flare = lensOn ? num(s, 'lens.flare') : 0;
    const light = exp.light;
    const veil: [number, number, number] = [
      flare * meter.rgb[0] * light[0],
      flare * meter.rgb[1] * light[1],
      flare * meter.rgb[2] * light[2],
    ];

    const noiseF = SENSOR_NOISE[str(s, 'format.sensorSize')] ?? 1;
    const interlaced = bool(s, 'interlace.enabled');
    const isCcd = sensorType === 0 || sensorType === 1;
    const fade = fxOn && str(s, 'fx.fader') !== 'none' ? clamp(1 - f.sinceShot / Math.max(num(s, 'fx.faderTime'), 0.01), 0, 1) : 0;

    const crosstalk = sensorType === 0 ? num(s, 'sensor.crosstalk') : sensorType === 2 ? num(s, 'sensor.crosstalk') * 0.5 : 0.02;
    // A Bayer mosaic passes a little of every colour to every site; the
    // camera's gain is set so that white stays white.
    const chipNorm = sensorType === 2 ? 1 / (1 + 2 * crosstalk) : 1;

    return {
      m: f.m,
      parity: f.parity,
      tapTags,
      taps: K,
      tapSrc,
      rows,
      view,
      light,
      veil,
      ir: nightOn ? num(s, 'night.ir') * exp.ownLight : 0,
      sigma0,
      sensor: {
        type: sensorType,
        crosstalk,
        well: sensorOn ? num(s, 'sensor.well') : 1e6,
        bloom: sensorOn ? num(s, 'sensor.bloom') : 0,
        smearK: sensorOn && isCcd ? num(s, 'sensor.smear') * (fieldPeriod / exp.shutter) : 0,
        read: sensorOn ? num(s, 'sensor.noise') * noiseF : 0,
        shot: sensorOn ? num(s, 'sensor.shot') * Math.sqrt(noiseF) : 0,
        integrate: interlaced && bool(s, 'interlace.integration') ? 1 : 0,
      },
      minv: decodeMatrix(crosstalk),
      gain: exp.gain * chipNorm,
      wb: exp.wb,
      exposure: exp,
      fade,
    };
  };
  const fields: [FieldPlan, FieldPlan] = [field(0), field(1)];

  // ---- DSP ----
  const toneOn = bool(s, 'tone.enabled');
  const detailOn = bool(s, 'detail.enabled');
  const effect = fxOn ? code(s, 'fx.effect') : 0;

  // ---- overlays ----
  const osdPath = overlayPaths(s);
  const osd: [OsdImage | null, OsdImage | null] = [
    osdPath[0] >= 0 && !fs.dead
      ? drawDisplay({ settings: s, fs, zoom: optical * digital, zoomOptical: optical, zoomRange: range, zoomMoving: !!inp.zoomMoving })
      : null,
    osdPath[1] >= 0 && !fs.dead ? drawDate(s, fs) : null,
  ];

  // ---- capture ----
  const capOn = bool(s, 'capture.enabled');
  const path = capOn ? code(s, 'capture.path') : 0;
  const bw = num(s, 'capture.bandwidth');

  // ---- the picture's rectangle and the output's shape ----
  const outAspect = frameAspect(s);
  const par = pixelAspect(s);
  let mx = bool(s, 'framing.overscan') ? 0 : (W - ACTIVE_W) / 2;
  let mw = W - 2 * mx;
  let my = 0;
  let mh = H;
  const picAspect = (mw * par) / mh;
  if (outAspect > picAspect + 1e-6) {
    const h2 = (mw * par) / outAspect;
    my = (mh - h2) / 2;
    mh = h2;
  } else if (outAspect < picAspect - 1e-6) {
    const w2 = (mh * outAspect) / par;
    mx += (mw - w2) / 2;
    mw = w2;
  }

  const upOn = bool(s, 'upload.enabled');
  const uW = Math.max(16, Math.round(num(s, 'upload.width') / 16) * 16);
  const uH = Math.max(16, Math.round(uW / outAspect / 16) * 16);

  const deintOn = bool(s, 'deint.enabled');
  const shown = fs.displayField >= 0 ? fs.fields[fs.displayField].parity : fs.fields[0].parity;

  const srcA = srcAspect;
  const sw = Math.min(1, outAspect / srcA);
  const sh = Math.min(1, srcA / outAspect);

  return {
    fs,
    W,
    H,
    aspect,
    fit,
    dist: [k1, k2],
    ca,
    vignette,
    circle,
    headroom: sensorOn ? num(s, 'sensor.headroom') : 0,
    irSpot: num(s, 'night.spot'),
    eyes: nightOn ? num(s, 'night.eyes') : 0,
    sigmaCorner: corner,
    rim,
    fields,
    dsp: {
      dz: digital,
      dzNearest: str(s, 'dzoom.filter') === 'nearest' ? 1 : 0,
      toneOn: toneOn ? 1 : 0,
      gamma: num(s, 'tone.gamma'),
      knee: num(s, 'tone.knee'),
      slope: num(s, 'tone.slope'),
      clip: num(s, 'tone.clip') / 100,
      pedestal: num(s, 'tone.pedestal'),
      sat: num(s, 'tone.saturation'),
      detailOn: detailOn ? 1 : 0,
      dGain: num(s, 'detail.gain'),
      dFreq: num(s, 'detail.freq'),
      dVert: num(s, 'detail.vertical'),
      dCoring: num(s, 'detail.coring'),
      dLimit: num(s, 'detail.limit'),
      dDark: num(s, 'detail.dark'),
      green: nightOn ? num(s, 'night.green') : 0,
      effect,
      effectSize: Math.max(2, Math.round(num(s, 'fx.size'))),
      fadeWhite: str(s, 'fx.fader') === 'white' ? 1 : 0,
      flicker: 0.86 + 0.14 * ihash(fs.n, seed, 977),
      trail: effect === 6,
    },
    codec: {
      on: bool(s, 'codec.enabled'),
      subsample: bool(s, 'chroma.enabled') || bool(s, 'codec.enabled'),
      dct248: bool(s, 'codec.dct248') && bool(s, 'interlace.enabled') ? 1 : 0,
      classes: bool(s, 'codec.classes') ? 1 : 0,
      budget: SEGMENT_BITS * num(s, 'codec.budget'),
      shuffle: bool(s, 'codec.shuffle'),
      linear: str(s, 'chroma.upsample') === 'linear' ? 1 : 0,
    },
    tape: {
      lost: fs.lost,
      conceal: code(s, 'tape.conceal'),
      clog: fs.clog,
      garbage: fs.garbage ? 1 : 0,
      dead: fs.dead ? 1 : 0,
    },
    osd,
    osdPath,
    post: {
      path,
      comb: code(s, 'capture.decoder'),
      sigY: path === 0 ? 0 : 2.53 / Math.max(bw, 0.5),
      sigC: path === 2 ? 2.53 / 1.3 : 2.53 / 1.6,
      delay: num(s, 'capture.chromaDelay'),
      noise: num(s, 'capture.noise'),
      levels: capOn && str(s, 'capture.levels') === 'full' ? 1 : 0,
      pal: sys.code,
    },
    upload: { on: upOn, W: uW, H: uH, q: num(s, 'upload.quality'), par: fs.fields[0].parity },
    present: {
      deint: deintOn ? code(s, 'deint.mode') : 0,
      field: upOn ? 0 : shown,
      scaler: code(s, 'framing.scaler'),
      map: [mx, my, mw, mh],
      dither: num(s, 'framing.dither'),
    },
    srcMap: [(1 - sw) / 2, (1 - sh) / 2, sw, sh],
    zoom: { total: optical * digital, optical, digital, range },
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
