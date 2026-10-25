/**
 * Numbers both renderers derive from a FrameState in exactly the same way:
 * blur radii in buffer pixels, tints, the perforation layout. Kept here so the
 * GPU and CPU paths read one definition rather than two that might drift.
 */

import { BufferSizes, E_MARGIN, F_MARGIN, FrameState } from './clock';

export interface PassParams {
  /** Exposure buffer extent, film mm. */
  eSizeMm: [number, number];
  /** Film-frame buffer extent, film mm. */
  fSizeMm: [number, number];
  /** One film-frame pixel, µm and mm. */
  fPixUm: number;
  fPixMm: number;
  /** One source pixel, in film mm. */
  srcPxMm: number;
  halfDiag: number;

  /** Quarter-resolution glow buffer, and the sixteenth one for the veil. */
  qW: number;
  qH: number;
  vW: number;
  vH: number;
  halSigmaQ: number;
  veilSigmaV: number;
  streakSigmaQ: number;
  streakThreshold: number;
  flareTint: [number, number, number];
  streakTint: [number, number, number];

  // Strip layout for the overscan.
  stripL: number;
  stripR: number;
  perf: [number, number, number, number];
  perfX: [number, number];
  perfPhase: number;
}

export function passParams(fs: FrameState, sizes: BufferSizes, srcH: number): PassParams {
  const g = fs.geometry;
  const eSizeMm: [number, number] = [g.apW * (1 + 2 * E_MARGIN), g.apH * (1 + 2 * E_MARGIN)];
  const fSizeMm: [number, number] = [g.apW * (1 + 2 * F_MARGIN), g.apH * (1 + 2 * F_MARGIN)];
  const fPixMm = fSizeMm[1] / sizes.fH;
  const qW = Math.max(2, sizes.eW >> 2);
  const qH = Math.max(2, sizes.eH >> 2);
  const vW = Math.max(2, qW >> 2);
  const vH = Math.max(2, qH >> 2);

  const ft = fs.flareTint;
  const flareTint: [number, number, number] =
    ft >= 0 ? [1 + 0.15 * ft, 1, 1 - 0.25 * ft] : [1 + 0.2 * ft, 1, 1 - 0.15 * ft];
  const st = fs.streakTint;
  const streakTint: [number, number, number] = [1 - 0.6 * st, 1 - 0.25 * st, 1 + 0.5 * st];

  const gauge = g.gauge;
  const stripL = -gauge.filmWidth / 2 - gauge.frameOffset;
  const stripR = gauge.filmWidth / 2 - gauge.frameOffset;
  const left = (stripL - g.apW / 2) / 2;
  const right = gauge.perf.sides === 'both' ? (stripR + g.apW / 2) / 2 : 1e6;

  return {
    eSizeMm,
    fSizeMm,
    fPixUm: fPixMm * 1000,
    fPixMm,
    srcPxMm: g.apH / Math.max(srcH, 1),
    halfDiag: Math.hypot(g.apW / 2, g.apH / 2),
    qW,
    qH,
    vW,
    vH,
    halSigmaQ: (fs.tone.halSigmaMm / eSizeMm[1]) * qH,
    veilSigmaV: 0.22 * vH,
    streakSigmaQ: ((fs.streakLen * g.apW * 0.5) / eSizeMm[0]) * qW,
    streakThreshold: fs.streak > 0 ? 0.18 * Math.pow(2, fs.streakThreshold) : 0,
    flareTint,
    streakTint,
    stripL,
    stripR,
    perf: [gauge.perf.w, gauge.perf.h, gauge.perf.radius, gauge.perf.perFrame],
    perfX: [left, right],
    perfPhase: gauge.perf.phase,
  };
}
