/*
 * The film's event clock.
 *
 * Everything that happens to a particular frame of film — where the claw left
 * it, whether it carries a splice, how fast the camera was running when it was
 * exposed — is a pure function of the frame number and the seed. That is what
 * lets the picture and the sound agree without ever talking to each other: the
 * renderer and the audio worklet both import this one file and evaluate the
 * same function of the same frame, so a splice that jumps the picture is the
 * splice that pops in the speaker, and a frame the claw struck badly both
 * weaves and clatters.
 *
 * It is plain JavaScript in public/ because an AudioWorklet can only load a
 * module by URL; the TypeScript side imports the very same file through the
 * bundler, so there is no second copy to drift.
 *
 * Integer hashing throughout. A float hash of a large frame number loses its
 * low bits, and two engines evaluating "the same" float hash in slightly
 * different orders is exactly the divergence this file exists to prevent.
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
  camWeaveX: 11,
  camWeaveY: 12,
  projWeaveX: 21,
  projWeaveY: 22,
  projRot: 23,
  claw: 31,
  flicker: 41,
  flash: 51,
  splice: 61,
  spliceKind: 62,
  leak: 71,
  scratch: 81,
  hair: 91,
  speck: 101,
  dirt: 111,
};

/**
 * A wandering 2D offset for frame n, in units of the configured amplitude.
 *
 * Two parts, because registration error has two parts: a slow drift as the
 * loop and the pressure plate settle, and a per-frame error from where the
 * claw happened to engage. `jitter` is the share of the second.
 */
export function weave(n, seed, fps, speedHz, jitter, chX, chY) {
  const t = (n / Math.max(fps, 1)) * Math.max(speedHz, 0.01);
  const slowX = snoise(t, seed, chX) * 0.7 + snoise(t * 2.3 + 17.1, seed, chX + 500) * 0.3;
  const slowY = snoise(t + 41.7, seed, chY) * 0.7 + snoise(t * 2.1 + 3.3, seed, chY + 500) * 0.3;
  const fastX = bhash(n, seed, chX + 1000);
  const fastY = bhash(n, seed, chY + 1000);
  const j = Math.min(Math.max(jitter, 0), 1);
  return [slowX * (1 - j) + fastX * j * 0.8, slowY * (1 - j) + fastY * j * 0.8];
}

/**
 * How hard the claw struck frame n, 0..1. The picture uses it as part of the
 * frame's weave; the sound uses it as the loudness of that frame's clack.
 */
export function clawStrike(n, seed) {
  return Math.abs(bhash(n, seed, CH.projWeaveY + 1000));
}

/* ------------------------------------------------------------------ *
 * Camera speed
 *
 * A spring-wound motor does not hold speed. Speed is modelled as a sum of
 * three slow sinusoids with seeded frequencies and phases, because a sum of
 * sinusoids integrates in closed form: the capture time of frame n, and the
 * delay the sound needs to follow it, are both exact at any frame without
 * summing every frame before it.
 * ------------------------------------------------------------------ */

const SPEED_PARTIALS = 3;

function speedPartial(seed, k) {
  const freq = [0.11, 0.27, 0.61][k] * (0.8 + 0.4 * ihash(seed, k, 901));
  const amp = [0.6, 0.3, 0.15][k];
  const phase = ihash(seed, k, 902) * Math.PI * 2;
  return { w: freq * Math.PI * 2, amp, phase };
}

/** Relative speed error at nominal time t, as a fraction (0 = exact). */
export function speedError(t, seed, drift) {
  if (drift <= 0) return 0;
  let v = 0;
  for (let k = 0; k < SPEED_PARTIALS; k++) {
    const p = speedPartial(seed, k);
    v += p.amp * Math.sin(p.w * t + p.phase);
  }
  return v * drift;
}

/**
 * Seconds by which the camera's real clock has drifted from nominal at t: the
 * integral of the speed error. Frame n was exposed at n / fps + this.
 */
export function speedOffset(t, seed, drift) {
  if (drift <= 0) return 0;
  let v = 0;
  for (let k = 0; k < SPEED_PARTIALS; k++) {
    const p = speedPartial(seed, k);
    v += (p.amp / p.w) * (Math.cos(p.phase) - Math.cos(p.w * t + p.phase));
  }
  return v * drift;
}

/* ------------------------------------------------------------------ *
 * Discrete events
 * ------------------------------------------------------------------ */

/** Probability per frame for an event rate given per minute. */
export function perFrame(ratePerMin, fps) {
  return Math.max(0, ratePerMin) / (60 * Math.max(fps, 1));
}

/** Is there a splice on frame n? Returns 0 (none), 1 (tape) or 2 (cement) as hinted by kind. */
export function spliceAt(n, seed, ratePerMin, fps) {
  if (ratePerMin <= 0 || n < 1) return 0;
  return ihash(n, seed, CH.splice) < perFrame(ratePerMin, fps) ? 1 : 0;
}

/** Exposure boost in stops on frame n from camera starts. */
export function flashStops(n, seed, ratePerMin, fps, frames) {
  if (ratePerMin <= 0) return 0;
  const p = perFrame(ratePerMin, fps);
  let stops = 0;
  const k = Math.max(1, Math.min(6, frames | 0));
  for (let j = 0; j < k; j++) {
    const start = n - j;
    if (start < 1) break;
    if (ihash(start, seed, CH.flash) < p) {
      // The first frame is the worst: the motor is barely turning and the
      // exposure is several times too long; it settles within a few frames.
      stops = Math.max(stops, 2.6 * Math.pow(0.45, (j * 4) / k));
    }
  }
  return stops;
}

/** Frame-to-frame exposure variation, −1..1. */
export function flickerAt(n, seed) {
  return bhash(n, seed, CH.flicker) * 0.75 + snoise(n * 0.37, seed, CH.flicker + 7) * 0.25;
}

/**
 * Where frame n sits in its load: 0 at either end, 1 well inside. Drives the
 * fog at the head and tail of a cartridge or spool.
 */
export function rollEnd(n, rollFrames) {
  const len = Math.max(rollFrames, 100);
  const p = ((n % len) + len) % len;
  const d = Math.min(p, len - 1 - p);
  return d;
}
