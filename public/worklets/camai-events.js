/*
 * The camcorder's event clock.
 *
 * Everything that happens to the recording at a given moment — whether the
 * camera was stopped and started, whether a stretch of track was damaged,
 * where the operator's hand was, whether the focus was hunting — is a pure
 * function of time and the seed. That is what lets the picture and the sound
 * agree without ever talking to each other: the renderer and the audio
 * worklet both import this one file and evaluate the same function of the
 * same moment, so the dropout that freezes a block of picture is the dropout
 * that mutes the sound, and the bump that jolts the frame is the thump in the
 * microphone.
 *
 * It is plain JavaScript in public/ because an AudioWorklet can only load a
 * module by URL; the TypeScript side imports the very same file through the
 * bundler, so there is no second copy to drift.
 *
 * Integer hashing throughout (Math.imul). A float hash of a large tick count
 * loses its low bits, and two engines evaluating "the same" float hash in a
 * slightly different order is exactly the divergence this file exists to
 * prevent.
 *
 * Three clocks meet here, and keeping them apart is most of the point:
 *
 *   source time   the world: the footage being "filmed"
 *   output time   the tape: the recorded shots butted together
 *   wall time     the camera's clock: output time plus every gap between
 *                 shots, which is what the date stamp shows
 *
 * The tape counter is output time. It runs straight across a break, because
 * the tape is continuous; the wall clock jumps, because time passed.
 */

/** Uniform 0..1 from up to three integers. */
export function ihash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x1b873593, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Signed −1..1. */
export function bhash(a, b = 0, c = 0) {
  return ihash(a, b, c) * 2 - 1;
}

/** Smooth value noise along one axis, −1..1. */
export function snoise(x, seed, channel = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  const a = bhash(i, seed, channel);
  const b = bhash(i + 1, seed, channel);
  return a + (b - a) * s;
}

/** Channels — every event family hashes into its own stream. */
export const CH = {
  shot: 11,
  skip: 12,
  gap: 13,
  dropout: 21,
  clog: 31,
  bump: 41,
  whip: 51,
  hunt: 61,
  tremor: 71,
  sway: 81,
  walk: 91,
  noise: 101,
};

/** The two television systems DV records. */
export const SYSTEMS = [
  // 525/60: 29.97 frames, ten tracks a frame.
  { fps: 30000 / 1001, width: 720, height: 480, tracks: 10, mains: 60 },
  // 625/50: 25 frames, twelve tracks a frame.
  { fps: 25, width: 720, height: 576, tracks: 12, mains: 50 },
];

/** Every timed event lives on this grid, independent of the frame rate. */
export const EVENT_HZ = 50;

/** Probability per tick for an event rate given per minute. */
export function perTick(ratePerMin, hz = EVENT_HZ) {
  return Math.max(0, ratePerMin) / (60 * Math.max(hz, 1));
}

/* ------------------------------------------------------------------ *
 * Recording breaks
 *
 * The world runs in source time. The camera records shot k from source time
 * a_k to b_k; between shots it is in standby, and the next shot starts a
 * little later in the world (the source skipped) and much later on the wall
 * clock (the gap). Shots butted together are the tape.
 *
 * Break candidates sit on a quarter-second grid of source time, so the table
 * is cheap to build and identical wherever it is built.
 * ------------------------------------------------------------------ */

const SHOT_SLOT = 0.25;
const MIN_SHOT = 1.5;

export class Shots {
  constructor(seed, opts) {
    this.seed = seed | 0;
    this.enabled = !!opts.enabled && opts.rate > 0;
    this.rate = opts.rate || 0;
    this.skip = Math.max(0, opts.skip || 0);
    this.gap = Math.max(0, opts.gap || 0);
    this.seamless = opts.seamless !== false;
    // Shot 0 begins at the start of the source and the tape.
    this.list = [{ src0: 0, out0: 0, gapMin: 0, tc0: 0 }];
    this.builtTo = 0;
    this.slot = 1;
  }

  /** Extend the table until it covers source time t. */
  ensure(t) {
    if (!this.enabled) return;
    const p = perTick(this.rate, 1 / SHOT_SLOT);
    while (this.builtTo <= t + SHOT_SLOT) {
      const last = this.list[this.list.length - 1];
      const at = this.slot * SHOT_SLOT;
      this.slot++;
      this.builtTo = at;
      if (at < last.src0 + MIN_SHOT) continue;
      if (ihash(this.slot, this.seed, CH.shot) >= p) continue;
      const k = this.list.length;
      const skip = this.skip * (0.5 + ihash(k, this.seed, CH.skip));
      const u = ihash(k, this.seed, CH.gap);
      const gapMin = this.gap * Math.min(5, -Math.log(1 - u * 0.999));
      const out0 = last.out0 + (at - last.src0);
      this.list.push({
        src0: at + skip,
        out0,
        gapMin: last.gapMin + gapMin,
        tc0: this.seamless ? last.tc0 : out0,
        srcEndPrev: at,
      });
      // Continue scanning from where the new shot begins.
      this.slot = Math.ceil((at + skip) / SHOT_SLOT) + 1;
    }
  }

  /** The shot recorded at output (tape) time t. */
  atOutput(t) {
    if (!this.enabled) return { index: 0, shot: this.list[0] };
    // The last shot is open-ended: it runs to wherever the table is built.
    let last = this.list[this.list.length - 1];
    while (last.out0 + (this.builtTo - last.src0) <= t) {
      this.ensure(this.builtTo + 5);
      last = this.list[this.list.length - 1];
    }
    let lo = 0;
    let hi = this.list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.list[mid].out0 <= t) lo = mid;
      else hi = mid - 1;
    }
    return { index: lo, shot: this.list[lo] };
  }

  /** Source time of output time t. */
  outToSrc(t) {
    const { shot } = this.atOutput(t);
    return shot.src0 + (t - shot.out0);
  }

  /**
   * Output time of source time t, or where the next shot begins if t falls
   * in a stretch the camera did not record.
   */
  srcToOut(t) {
    if (!this.enabled) return { out: t, index: 0, recorded: true, resume: t };
    this.ensure(t + 1);
    let i = this.list.length - 1;
    while (i > 0 && this.list[i].src0 > t) i--;
    const next = this.list[i + 1];
    if (next && next.srcEndPrev !== undefined && t >= next.srcEndPrev) {
      return { out: next.out0, index: i + 1, recorded: false, resume: next.src0 };
    }
    const shot = this.list[i];
    return { out: shot.out0 + (t - shot.src0), index: i, recorded: true, resume: t };
  }

  /** Output times at which shots start, up to t. */
  startsUpTo(t) {
    this.atOutput(t);
    return this.list.filter((s) => s.out0 <= t).map((s) => s.out0);
  }
}

/* ------------------------------------------------------------------ *
 * Tape errors
 * ------------------------------------------------------------------ */

/**
 * The dropout on DV frame n, if any.
 *
 * A defect on the tape is a stretch of oxide the heads cross on consecutive
 * tracks, so a dropout takes a run of tracks, and within each a run of its
 * 27 video segments. Each segment's five macroblocks are scattered across the
 * picture by the shuffle, which is why a DV dropout is blocks all over the
 * frame rather than a streak. The audio blocks are on the same tracks.
 */
export function dropoutAt(n, seed, ratePerMin, fps, size, tracks) {
  if (ratePerMin <= 0 || n < 1) return null;
  const p = Math.max(0, ratePerMin) / (60 * fps);
  if (ihash(n, seed, CH.dropout) >= p) return null;
  const sz = Math.min(1, Math.max(0, size));
  const nTracks = sz >= 0.999 ? tracks : Math.max(1, Math.round(tracks * sz * (0.5 + ihash(n, seed, CH.dropout + 1))));
  const nSeg = sz >= 0.999 ? 27 : Math.max(1, Math.min(27, Math.round(27 * Math.min(1, sz * 1.6) * (0.4 + 0.6 * ihash(n, seed, CH.dropout + 2)))));
  const t0 = Math.floor(ihash(n, seed, CH.dropout + 3) * tracks);
  const s0 = Math.floor(ihash(n, seed, CH.dropout + 4) * 27);
  return { track0: sz >= 0.999 ? 0 : t0, nTracks: Math.min(nTracks, tracks), seg0: sz >= 0.999 ? 0 : s0, nSeg, share: Math.min(nTracks, tracks) / tracks };
}

/** 0..1 through a head clog covering frame n, or −1 if the heads are clean. */
export function clogAt(n, seed, ratePerMin, fps, lengthSec) {
  if (ratePerMin <= 0) return -1;
  const len = Math.max(1, Math.round(lengthSec * fps));
  const p = Math.max(0, ratePerMin) / (60 * fps);
  for (let j = 0; j < len; j++) {
    const start = n - j;
    if (start < 1) break;
    if (ihash(start, seed, CH.clog) < p) return j / len;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * The operator
 *
 * Angles in degrees of camera rotation. Converting them to a shift in the
 * picture is the lens's job: the same tremor is ten times the shift at 10×.
 * ------------------------------------------------------------------ */

/** Response of the frame to a bump dt seconds ago: a jolt and a wobble. */
function bumpShape(dt) {
  if (dt < 0) return 0;
  const tau = 0.05;
  const jolt = (dt / tau) * Math.exp(1 - dt / tau);
  const wobble = 0.35 * Math.sin(2 * Math.PI * 6.5 * dt) * Math.exp(-dt / 0.22);
  return jolt + wobble;
}

/** Ticks at which bumps start in (t − span, t]. */
export function bumpTicks(t, seed, ratePerMin, span = 1.5) {
  const out = [];
  if (ratePerMin <= 0) return out;
  const p = perTick(ratePerMin);
  const k1 = Math.floor(t * EVENT_HZ);
  const k0 = Math.max(1, k1 - Math.ceil(span * EVENT_HZ));
  for (let k = k0; k <= k1; k++) if (ihash(k, seed, CH.bump) < p) out.push(k);
  return out;
}

function whipShape(dt, hold) {
  const swing = 0.32;
  if (dt < 0) return 0;
  const ease = (u) => u * u * (3 - 2 * u);
  if (dt < swing) return ease(dt / swing);
  if (dt < swing + hold) return 1;
  if (dt < 2 * swing + hold) return 1 - ease((dt - swing - hold) / swing);
  return 0;
}

/**
 * Where the operator is pointing at output time t, beyond the deliberate
 * pan and tilt: [pan, tilt, roll] in degrees.
 */
export function operatorAt(t, seed, o) {
  let pan = 0;
  let tilt = 0;
  let roll = 0;
  // Physiological tremor: 8–12 Hz, two incommensurate partials per axis.
  if (o.tremor > 0) {
    pan += o.tremor * (0.6 * snoise(t * 9.3, seed, CH.tremor) + 0.4 * snoise(t * 11.7 + 3.1, seed, CH.tremor + 1));
    tilt += o.tremor * (0.6 * snoise(t * 8.6 + 7.7, seed, CH.tremor + 2) + 0.4 * snoise(t * 12.3 + 1.9, seed, CH.tremor + 3));
  }
  // Sway: the unbraced arm, below 2 Hz, with a slow wander under it.
  if (o.sway > 0) {
    pan += o.sway * (0.55 * snoise(t * 0.45, seed, CH.sway) + 0.3 * snoise(t * 1.1 + 5.3, seed, CH.sway + 1) + 0.15 * snoise(t * 2.2, seed, CH.sway + 2));
    tilt += o.sway * 0.7 * (0.55 * snoise(t * 0.4 + 9.1, seed, CH.sway + 3) + 0.3 * snoise(t * 1.3 + 2.2, seed, CH.sway + 4) + 0.15 * snoise(t * 2.5, seed, CH.sway + 5));
    roll += o.sway * 0.4 * snoise(t * 0.5 + 4.4, seed, CH.sway + 6);
  }
  // Walking: a vertical bob at the step rate, a sideways roll at half of it.
  if (o.walk > 0) {
    const c = o.cadence || 1.9;
    const ph = 2 * Math.PI * c * t;
    const jitter = 1 + 0.15 * snoise(t * 0.7, seed, CH.walk);
    tilt += o.walk * jitter * (0.6 * Math.sin(ph) + 0.25 * Math.sin(2 * ph + 0.7));
    pan += o.walk * 0.45 * Math.sin(ph * 0.5 + 0.4);
    roll += o.walk * 0.8 * Math.sin(ph * 0.5);
  }
  if (o.bumps > 0) {
    for (const k of bumpTicks(t, seed, o.bumps)) {
      const dt = t - k / EVENT_HZ;
      const a = o.bumpSize * (0.5 + ihash(k, seed, CH.bump + 1));
      const dir = ihash(k, seed, CH.bump + 2) * Math.PI * 2;
      const s = bumpShape(dt) * a;
      pan += Math.cos(dir) * s;
      tilt += Math.sin(dir) * s;
      roll += s * 0.6 * bhash(k, seed, CH.bump + 3);
    }
  }
  if (o.whips > 0) {
    const p = perTick(o.whips);
    const k1 = Math.floor(t * EVENT_HZ);
    const k0 = Math.max(1, k1 - Math.ceil(5 * EVENT_HZ));
    for (let k = k0; k <= k1; k++) {
      if (ihash(k, seed, CH.whip) >= p) continue;
      const hold = 1.2 + 2.6 * ihash(k, seed, CH.whip + 1);
      const sign = ihash(k, seed, CH.whip + 2) < 0.5 ? -1 : 1;
      pan += sign * o.whipAngle * (0.7 + 0.3 * ihash(k, seed, CH.whip + 3)) * whipShape(t - k / EVENT_HZ, hold);
    }
  }
  return [pan, tilt, roll];
}

/* ------------------------------------------------------------------ *
 * Autofocus
 * ------------------------------------------------------------------ */

const HUNT_MIN = 0.9;

function huntShape(u) {
  // Out to one side, back through focus to the other, settling: breathing.
  if (u <= 0 || u >= 1) return 0;
  return Math.abs(Math.sin(2 * Math.PI * 1.25 * u)) * (1 - 0.45 * u) * Math.min(1, u * 8);
}

/**
 * Focus error during a hunt at output time t, 0..1 of the hunt depth.
 * Hunts start at random, and at the start of every shot. `shotStarts` are
 * output times.
 */
export function huntAt(t, seed, ratePerMin, shotStarts) {
  let v = 0;
  const consider = (start, k) => {
    const dur = HUNT_MIN + 0.7 * ihash(k, seed, CH.hunt + 1);
    const u = (t - start) / dur;
    if (u > 0 && u < 1) v = Math.max(v, huntShape(u) * (0.6 + 0.4 * ihash(k, seed, CH.hunt + 2)));
  };
  if (ratePerMin > 0) {
    const p = perTick(ratePerMin);
    const k1 = Math.floor(t * EVENT_HZ);
    const k0 = Math.max(1, k1 - Math.ceil(1.7 * EVENT_HZ));
    for (let k = k0; k <= k1; k++) if (ihash(k, seed, CH.hunt) < p) consider(k / EVENT_HZ, k);
  }
  if (shotStarts) {
    for (let i = 0; i < shotStarts.length; i++) {
      const s = shotStarts[i];
      if (t - s < 1.7 && t >= s) consider(s + 0.08, 100000 + i);
    }
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * The battery
 * ------------------------------------------------------------------ */

/**
 * Charge left, in percent, after `recordedSec` of recording and `standbyMin`
 * minutes of standby between shots (which drains at a third of the rate).
 */
export function batteryLeft(charge, capacityMin, recordedSec, standbyMin) {
  const used = (recordedSec / 60 + standbyMin / 3) / Math.max(capacityMin, 0.01);
  return charge - 100 * used;
}

/** Output time at which the battery runs out, or Infinity. */
export function batteryDeath(charge, capacityMin, shots) {
  if (charge <= 0) return 0;
  const perSec = 100 / (Math.max(capacityMin, 0.01) * 60);
  for (let k = 0; k < 100000; k++) {
    const s = shots.list[k];
    const left = charge - perSec * s.out0 - (100 * s.gapMin) / 3 / Math.max(capacityMin, 0.01);
    if (left <= 0) return s.out0;
    const secs = left / perSec;
    if (!shots.enabled) return s.out0 + secs;
    shots.ensure(s.src0 + secs + 1);
    const next = shots.list[k + 1];
    if (!next || next.srcEndPrev >= s.src0 + secs) return s.out0 + secs;
  }
  return Infinity;
}
