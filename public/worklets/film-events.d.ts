// Types for the shared event clock. The implementation is plain JavaScript so
// that the audio worklet can load it by URL; see film-events.js.

export function ihash(a: number, b?: number, c?: number): number;
export function bhash(a: number, b?: number, c?: number): number;
export function snoise(x: number, seed: number, channel?: number): number;
export const CH: {
  camWeaveX: number;
  camWeaveY: number;
  projWeaveX: number;
  projWeaveY: number;
  projRot: number;
  claw: number;
  flicker: number;
  flash: number;
  splice: number;
  spliceKind: number;
  leak: number;
  scratch: number;
  hair: number;
  speck: number;
  dirt: number;
};
export function weave(
  n: number,
  seed: number,
  fps: number,
  speedHz: number,
  jitter: number,
  chX: number,
  chY: number,
): [number, number];
export function clawStrike(n: number, seed: number): number;
export function speedError(t: number, seed: number, drift: number): number;
export function speedOffset(t: number, seed: number, drift: number): number;
export function perFrame(ratePerMin: number, fps: number): number;
export function spliceAt(n: number, seed: number, ratePerMin: number, fps: number): number;
export function flashStops(n: number, seed: number, ratePerMin: number, fps: number, frames: number): number;
export function flickerAt(n: number, seed: number): number;
export function rollEnd(n: number, rollFrames: number): number;
