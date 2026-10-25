// Types for the shared event clock, which is plain JavaScript so that the
// AudioWorklet can load it by URL.

export function ihash(a: number, b?: number, c?: number): number;
export function bhash(a: number, b?: number, c?: number): number;
export function snoise(x: number, seed: number, channel?: number): number;
export const CH: Record<string, number>;
export const SYSTEMS: { fps: number; width: number; height: number; tracks: number; mains: number }[];
export const EVENT_HZ: number;
export function perTick(ratePerMin: number, hz?: number): number;

export interface Shot {
  /** Source time the shot begins. */
  src0: number;
  /** Output (tape) time the shot begins. */
  out0: number;
  /** Wall-clock minutes elapsed in gaps before this shot. */
  gapMin: number;
  /** Output time the timecode was last restarted. */
  tc0: number;
  /** Source time the previous shot ended. */
  srcEndPrev?: number;
}

export class Shots {
  constructor(seed: number, opts: { enabled: boolean; rate: number; skip: number; gap: number; seamless: boolean });
  readonly enabled: boolean;
  readonly list: Shot[];
  builtTo: number;
  ensure(t: number): void;
  atOutput(t: number): { index: number; shot: Shot };
  outToSrc(t: number): number;
  srcToOut(t: number): { out: number; index: number; recorded: boolean; resume: number };
  startsUpTo(t: number): number[];
}

export interface Dropout {
  track0: number;
  nTracks: number;
  seg0: number;
  nSeg: number;
  share: number;
}

export function dropoutAt(n: number, seed: number, ratePerMin: number, fps: number, size: number, tracks: number): Dropout | null;
export function clogAt(n: number, seed: number, ratePerMin: number, fps: number, lengthSec: number): number;
export function bumpTicks(t: number, seed: number, ratePerMin: number, span?: number): number[];

export interface OperatorParams {
  tremor: number;
  sway: number;
  walk: number;
  cadence: number;
  bumps: number;
  bumpSize: number;
  whips: number;
  whipAngle: number;
}
export function operatorAt(t: number, seed: number, o: OperatorParams): [number, number, number];
export function huntAt(t: number, seed: number, ratePerMin: number, shotStarts: number[] | null): number;
export function batteryLeft(charge: number, capacityMin: number, recordedSec: number, standbyMin: number): number;
export function batteryDeath(charge: number, capacityMin: number, shots: Shots): number;
