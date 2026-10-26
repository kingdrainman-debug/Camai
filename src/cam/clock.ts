/**
 * The field clock.
 *
 * A camcorder does not take frames. Its CCD delivers fields — 59.94 a second
 * in 525/60, 50 in 625/50 — each a separate moment, and DV puts two of them in
 * a frame, bottom field first. Sixty distinct moments a second is the video
 * motion, and it only exists if the field clock is real: the two fields of a
 * frame must come from two different instants of the source.
 *
 * This module is where the clocks meet. Given an output frame (or a source
 * time) it answers, for both renderers and for the audio at once:
 *
 *   - which DV frame this is, and for each of its two fields which lines it
 *     covers, when on the tape it was recorded and which moment of the source
 *     it shows (and, for a slow shutter, every moment it integrated)
 *   - which shot it belongs to, and so what the camera's clock read
 *   - whether the tape lost part of it, and which macroblocks
 *   - whether the battery had already died
 *
 * Nothing here touches pixels, and nothing here has memory: the automatics,
 * which do, live in automatics.ts. Every event comes from camai-events.js, the
 * file the audio worklet imports too.
 */

import { Settings, bool, num, str } from '../core/params';
import { DvLayout, dvLayout } from './dvlayout';
import {
  SYSTEMS,
  Shots,
  batteryDeath,
  batteryLeft,
  clogAt,
  dropoutAt,
  huntAt,
} from '../../public/worklets/camai-events.js';

export interface SystemInfo {
  code: 0 | 1;
  fps: number;
  fieldRate: number;
  W: number;
  H: number;
  tracks: number;
  mains: number;
}

export function systemOf(s: Settings): SystemInfo {
  const code = str(s, 'format.system') === 'pal' ? 1 : 0;
  const sys = SYSTEMS[code];
  return { code, fps: sys.fps, fieldRate: sys.fps * 2, W: sys.width, H: sys.height, tracks: sys.tracks, mains: sys.mains };
}

/** Width of the active picture, which is what 4:3 or 16:9 refers to. */
export const ACTIVE_W = 704;

/** Pixel aspect ratio of the DV raster. */
export function pixelAspect(s: Settings): number {
  const pal = str(s, 'format.system') === 'pal';
  const wide = str(s, 'format.aspect') === '16:9';
  const H = pal ? 576 : 480;
  return ((wide ? 16 / 9 : 4 / 3) * H) / ACTIVE_W;
}

/**
 * Shape of the output frame: the active picture (or the whole 720-sample
 * raster) at its pixel aspect, unless an aspect is forced, in which case the
 * picture is cropped to fill it.
 */
export function frameAspect(s: Settings): number {
  const forced = str(s, 'framing.aspect');
  if (forced === '4:3') return 4 / 3;
  if (forced === '16:9') return 16 / 9;
  const H = str(s, 'format.system') === 'pal' ? 576 : 480;
  const w = bool(s, 'framing.overscan') ? 720 : ACTIVE_W;
  return (w * pixelAspect(s)) / H;
}

export interface Rates {
  /** DV frames a second. */
  dv: number;
  /** Fields a second. */
  field: number;
  /** Output frames a second. */
  output: number;
}

export function rates(s: Settings): Rates {
  const sys = systemOf(s);
  const output = str(s, 'framing.fps') === 'field' ? sys.fieldRate : sys.fps;
  return { dv: sys.fps, field: sys.fieldRate, output };
}

/* ------------------------------------------------------------------ *
 * Shots
 * ------------------------------------------------------------------ */

const shotCache = new Map<string, Shots>();

/** The recording breaks for these settings, built lazily and shared. */
export function shotsFor(s: Settings, seed: number): Shots {
  const on = bool(s, 'breaks.enabled');
  const key = on
    ? `${seed}|${num(s, 'breaks.rate')}|${num(s, 'breaks.skip')}|${num(s, 'breaks.gap')}|${bool(s, 'breaks.seamless')}`
    : 'off';
  let sh = shotCache.get(key);
  if (!sh) {
    if (shotCache.size > 16) shotCache.clear();
    sh = new Shots(seed, {
      enabled: on,
      rate: num(s, 'breaks.rate'),
      skip: num(s, 'breaks.skip'),
      gap: num(s, 'breaks.gap'),
      seamless: bool(s, 'breaks.seamless'),
    });
    shotCache.set(key, sh);
  }
  return sh;
}

/* ------------------------------------------------------------------ *
 * Shutter
 * ------------------------------------------------------------------ */

/** Fields a slow shutter integrates over: 1 at 1/60 s and faster. */
export function shutterRepeat(s: Settings, sys: SystemInfo): number {
  if (!bool(s, 'exposure.enabled')) return 1;
  const sel = str(s, 'exposure.shutter');
  const denom = Number(sel);
  if (!denom || denom >= 60) return 1;
  return Math.max(1, Math.round(sys.fieldRate / denom));
}

/** The manual shutter time, or null when the camera chooses. */
export function manualShutter(s: Settings, sys: SystemInfo): number | null {
  if (!bool(s, 'exposure.enabled')) return null;
  const sel = str(s, 'exposure.shutter');
  if (sel === 'auto') return null;
  const denom = Number(sel);
  if (denom === 60) return 1 / sys.fieldRate;
  return denom > 0 ? 1 / denom : null;
}

/* ------------------------------------------------------------------ *
 * Per-frame state
 * ------------------------------------------------------------------ */

export interface SourceTap {
  /** Source time this tap shows. */
  srcT: number;
  /** Integer tag the source frame is stored under. */
  tag: number;
}

export interface FieldInfo {
  /** Global field number, counting from the first field of the tape. */
  m: number;
  /** 0: the top field (even lines), 1: the bottom field (odd lines). */
  parity: 0 | 1;
  /** Tape time at which this field was recorded. */
  outT: number;
  /** Source time it shows. */
  srcT: number;
  /** Every source moment the shutter integrated over (one, unless slow). */
  taps: SourceTap[];
  /** Fields in the same slow-shutter group show the same exposure. */
  group: number;
  /** Shot this field belongs to, and seconds since the shot began. */
  shot: number;
  sinceShot: number;
  /** Autofocus hunt, 0..1 of the hunt depth. */
  hunt: number;
}

export interface OverlayClock {
  /** Camera wall-clock, as milliseconds since 1970 in the camera's own time. */
  wallMs: number;
  /** Timecode seconds. */
  timecode: number;
  /** Battery left, percent. */
  battery: number;
  /** Seconds since this shot began. */
  sinceShot: number;
  shot: number;
}

export interface FrameState {
  seed: number;
  sys: SystemInfo;
  layout: DvLayout;
  rates: Rates;
  outFrame: number;
  outT: number;
  /** DV frame number. */
  n: number;
  /** The two fields in temporal order. */
  fields: [FieldInfo, FieldInfo];
  /** For field-rate output, which of the two (temporal index) this frame shows; else −1. */
  displayField: number;
  /** Lost macroblocks, 1 per lost one, or null when the frame is intact. */
  lost: Uint8Array | null;
  /** Share of the frame's tracks a dropout took: the audio uses the same number. */
  lostShare: number;
  /** Progress through a head clog, or −1. */
  clog: number;
  /** The battery died before this frame: nothing was recorded. */
  dead: boolean;
  /** First frame after a break with no backspace: garbage. */
  garbage: boolean;
  clock: OverlayClock;
}

export interface ClockInput {
  settings: Settings;
  /** Media (source) time in seconds. Ignored when outFrame is given. */
  time: number;
  /** Exact output frame index, for exports, which must not round. */
  outFrame?: number;
  seed: number;
}

/** Source time to tag a source frame by: integer milliseconds. */
export function tagOf(srcT: number): number {
  return Math.round(srcT * 1000);
}

/** The output frame that shows source time t. */
export function outFrameAt(s: Settings, seed: number, t: number): number {
  const r = rates(s);
  const out = shotsFor(s, seed).srcToOut(t).out;
  return Math.floor(out * r.output + 1e-6);
}

function startMs(s: Settings): number {
  if (bool(s, 'date.unset')) return Date.UTC(2000, 0, 1, 0, 0, 0);
  const year = num(s, 'date.year');
  const month = num(s, 'date.month');
  const day = Math.min(num(s, 'date.day'), new Date(Date.UTC(year, month, 0)).getUTCDate());
  const hour = num(s, 'date.hour');
  return Date.UTC(year, month - 1, day) + Math.round(hour * 3600 * 1000);
}

export function frameState(input: ClockInput): FrameState {
  const s = input.settings;
  const seed = input.seed | 0;
  const sys = systemOf(s);
  const r = rates(s);
  const layout = dvLayout(sys.code);
  const shots = shotsFor(s, seed);

  const outFrame = input.outFrame ?? outFrameAt(s, seed, input.time);
  const outT = outFrame / r.output;

  // Which DV frame: one per output frame, or one per two at field rate. The
  // web upload keeps only some frames, and holds each until the next.
  let tDv = outT;
  let displayField = -1;
  if (r.output > r.dv * 1.5) displayField = outFrame & 1;
  if (bool(s, 'upload.enabled')) {
    const up = Math.max(1, num(s, 'upload.fps'));
    tDv = Math.floor(outT * up + 1e-6) / up;
  }
  const n = Math.floor(tDv * r.dv + 1e-6);

  const interlaced = bool(s, 'interlace.enabled');
  const lowerFirst = !interlaced || bool(s, 'interlace.lowerFirst');
  const rep = shutterRepeat(s, sys);
  const fx = bool(s, 'fx.enabled') ? str(s, 'fx.effect') : 'none';
  const strobe = fx === 'strobe' ? Math.max(2, Math.round(num(s, 'fx.size') / 2)) : 1;
  const huntRate = bool(s, 'focus.enabled') ? num(s, 'focus.hunts') : 0;
  const shotStarts = bool(s, 'focus.enabled') ? shots.startsUpTo(outT + 1) : null;

  const field = (j: 0 | 1): FieldInfo => {
    // Progressive (interlace off) captures both fields at the same moment.
    const m = interlaced ? n * 2 + j : n * 2;
    const parity: 0 | 1 = (j === 0) === lowerFirst ? 1 : 0;
    const group = Math.floor(m / rep) * rep;
    // A strobe effect holds the camera's field memory for several frames.
    const held = strobe > 1 ? Math.floor(group / (2 * strobe)) * 2 * strobe + (m & 1) : group;
    const fieldOut = held / r.field;
    const taps: SourceTap[] = [];
    for (let k = 0; k < rep; k++) {
      const srcT = shots.outToSrc((held + k) / r.field);
      const tag = tagOf(srcT);
      if (!taps.some((t) => t.tag === tag)) taps.push({ srcT, tag });
    }
    const at = shots.atOutput(m / r.field);
    const recT = m / r.field;
    return {
      m,
      parity,
      outT: recT,
      srcT: shots.outToSrc(fieldOut),
      taps,
      group: held,
      shot: at.index,
      sinceShot: recT - at.shot.out0,
      hunt: huntRate > 0 || shotStarts ? huntAt(recT, seed, huntRate, shotStarts) : 0,
    };
  };
  const fields: [FieldInfo, FieldInfo] = [field(0), field(1)];

  // ---- tape errors ----
  let lost: Uint8Array | null = null;
  let lostShare = 0;
  let clog = -1;
  if (bool(s, 'tape.enabled')) {
    const lp = str(s, 'tape.speed') === 'lp';
    const d8 = str(s, 'format.tape') === 'digital8';
    const rate = num(s, 'tape.dropouts') * (lp ? 3 : 1) * (d8 ? 1.4 : 1);
    const d = dropoutAt(n, seed, rate, r.dv, num(s, 'tape.size'), layout.tracks);
    if (d) {
      lost = new Uint8Array(layout.nMB);
      const segMBs = bool(s, 'codec.shuffle') ? layout.segMBs : layout.segMBsPlain;
      for (let t = 0; t < d.nTracks; t++) {
        const track = (d.track0 + t) % layout.tracks;
        for (let k = 0; k < d.nSeg; k++) {
          const seg = track * 27 + ((d.seg0 + k) % 27);
          for (let j = 0; j < 5; j++) lost[segMBs[seg * 5 + j]] = 1;
        }
      }
      lostShare = d.share;
    }
    clog = clogAt(n, seed, num(s, 'tape.clogs'), r.dv, num(s, 'tape.clogLength'));
  }

  // ---- shots, clock, battery ----
  const at = shots.atOutput(outT);
  let garbage = false;
  if (bool(s, 'breaks.enabled') && !bool(s, 'breaks.seamless') && at.index > 0) {
    // The first frame wholly inside the new shot.
    garbage = Math.ceil(at.shot.out0 * r.dv - 1e-6) === n;
  }
  let battery = 100;
  let dead = false;
  if (bool(s, 'battery.enabled')) {
    const charge = num(s, 'battery.charge');
    const cap = num(s, 'battery.capacity');
    battery = Math.max(0, batteryLeft(charge, cap, outT, at.shot.gapMin));
    dead = n / r.dv >= batteryDeath(charge, cap, shots);
  }
  const clock: OverlayClock = {
    wallMs: startMs(s) + Math.round((outT + at.shot.gapMin * 60) * 1000),
    timecode: outT - at.shot.tc0,
    battery,
    sinceShot: outT - at.shot.out0,
    shot: at.index,
  };

  return {
    seed,
    sys,
    layout,
    rates: r,
    outFrame,
    outT,
    n,
    fields,
    displayField,
    lost,
    lostShare,
    clog,
    dead,
    garbage,
    clock,
  };
}

/** Every source tag a frame needs, with the source time to fetch it from. */
export function neededTaps(fs: FrameState): SourceTap[] {
  const out: SourceTap[] = [];
  for (const f of fs.fields) for (const t of f.taps) if (!out.some((o) => o.tag === t.tag)) out.push(t);
  return out;
}
