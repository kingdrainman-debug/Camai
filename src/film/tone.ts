/**
 * The tone model: exposure in, density out.
 *
 * Everything here is evaluated once per change of settings on the CPU and
 * handed to both renderers as plain numbers, so the GPU and the CPU backend
 * cannot disagree about what a stock is. The per-pixel half — a softplus or
 * two per channel — is mirrored in film.frag.glsl and cpu/film.ts.
 *
 * The characteristic curve
 * ------------------------
 * Density against log10 exposure is modelled as the difference of two
 * softplus functions:
 *
 *   r(x) = γ · [ t·sp((x − x_t)/t) − s·sp((x − x_s)/s) ]
 *
 * which is flat far below the toe x_t, rises with slope γ along the straight
 * line, and is flat again above the shoulder x_s. t and s are how gradually
 * it bends at each end. Its total rise is exactly γ·(x_s − x_t), which is the
 * whole reason reversal has so little latitude: a reversal film has to span
 * its full density range, Dmax down to Dmin, so its highlight end is not a
 * free choice — it sits (Dmax − Dmin)/γ above its shadow end, about six stops,
 * and anything brighter is clear film. A negative only has to reach a modest
 * density and can keep its shoulder eight stops above grey.
 *
 * Laboratory aim density
 * ----------------------
 * Printer lights are not guessed. As a real laboratory does, the model finds
 * the density a correctly exposed grey card produces on the negative and
 * solves for the printer exposure that prints it at the print stock's aim
 * density. Printer points then move away from that, 0.025 log E per point,
 * which is the industry's own unit.
 *
 * The transfer
 * ------------
 * A telecine reads transmission through the final positive. It is mapped so
 * that the aim density lands on video mid grey and clear film on white, which
 * makes video log-luminance a straight line in print density — so every bend
 * in the picture's tone is a bend in the film's curve, not in the transfer.
 */

import { Settings, bool, num, str } from '../core/params';
import { gauge } from './formats';
import { RGB, printStock, stock } from './stocks';

export const LOG10_GREY = Math.log10(0.18);

export function softplus(z: number): number {
  return z > 0 ? z + Math.log(1 + Math.exp(-z)) : Math.log(1 + Math.exp(z));
}

/** The rising curve r(x) described above. */
export function response(x: number, gamma: number, xt: number, xs: number, t: number, s: number): number {
  return gamma * (t * softplus((x - xt) / t) - s * softplus((x - xs) / s));
}

/** Monotone bisection, for the handful of inverse problems below. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number, increasing: boolean): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2;
    const v = f(m);
    if (v < target === increasing) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export const enum ToneMode {
  Negative = 0,
  Reversal = 1,
  /** Characteristic curve bypassed: an ideal, straight-line positive. */
  Linear = 2,
}

export const enum Process {
  Print = 0,
  Scan = 1,
  Raw = 2,
}

/** Everything per-stock the renderers need, as plain numbers. */
export interface Tone {
  mode: ToneMode;
  mono: boolean;
  /** Spectral weights a single-layer emulsion sees through. */
  monoWeights: RGB;

  /** Camera exposure multiplier per channel: stops, push, light and filter. */
  expGain: RGB;
  /** Stops of highlight above white in the source. 0 disables expansion. */
  headroom: number;

  // The original's curve (negative or reversal).
  gamma: RGB;
  xt: RGB;
  xs: RGB;
  toeSoft: number;
  shoulderSoft: number;
  dmin: RGB;
  dmax: RGB;
  /** Interimage effect strength (1 = none, >1 = more separation). */
  interimage: number;

  // Grain.
  grainSigma: RGB;
  grainCell: RGB;
  grainRough: number;
  grainExp: number;
  grainIndep: number;
  printSigma: number;
  printCell: number;
  dupeSigma: number;

  // Halation.
  halWeights: RGB;
  /** Halation spread as a Gaussian sigma, mm on the film. */
  halSigmaMm: number;

  // Negative → positive.
  process: Process;
  pMono: boolean;
  pGamma: RGB;
  pXt: RGB;
  pXs: RGB;
  pToeSoft: number;
  pShoulderSoft: number;
  pDmin: RGB;
  pDmax: RGB;
  /** Print exposure offset per channel: x_print = k − D_negative. */
  pK: RGB;
  scanGrey: RGB;
  scanRatio: number;
  generations: number;
  bleach: number;

  // The final positive.
  aim: number;
  finalDmin: RGB;
  /** Row-major 3×3: dye fading and impurity in density space. */
  dyeMatrix: number[];
  stain: RGB;
  /** Fade the negative (scan/raw) rather than the positive. */
  fadeNegative: boolean;
  /** Density of unexposed film in the final positive, for the overscan. */
  unexposed: RGB;
  /** Layer order of the final positive from the surface down (0 c, 1 m, 2 y). */
  layers: number[];
  /** Layer order of the original from the surface down. Camera films put blue on top. */
  originalLayers: number[];
  /** The original, and the final positive, are single-layer silver: a scratch clears all channels at once. */
  originalMono: boolean;
  finalMono: boolean;

  // Telecine.
  tkGamma: number;
  tkGrey: number;
  /**
   * Video level of unexposed film under that mapping. A colourist sets black
   * on the film's own black, so this is subtracted out and the rest stretched.
   */
  tkFloor: number;
  tkBlack: number;
  tkSat: number;
}

/* ------------------------------------------------------------------ *
 * Light
 * ------------------------------------------------------------------ */

/** Approximate camera-RGB of an illuminant, green normalised. */
function balanceRGB(kelvin: number): RGB {
  // Interpolated in mireds between daylight and 3200 K tungsten, in log
  // space — colour-temperature conversion filters are additive in mireds.
  const m = 1e6 / Math.max(kelvin, 1000);
  const t = (m - 1e6 / 5500) / (1e6 / 3200 - 1e6 / 5500);
  return [Math.pow(1.38, t), 1, Math.pow(0.55, t)];
}

const LIGHTS: Record<string, RGB> = {
  daylight: [1, 1, 1],
  tungsten: balanceRGB(3200),
  overcast: balanceRGB(7500),
  // A cool-white tube's mercury lines are mostly green; film renders it so.
  fluorescent: [0.87, 1, 0.84],
};

/** Transmission of a Wratten 85, normalised to green. */
const FILTER_85: RGB = [1.31, 1, 0.6];

const STORAGE_RATE: Record<string, number> = {
  vault: 0.05,
  cool: 0.35,
  room: 1,
  warm: 2.2,
  loft: 4,
};

/** Unwanted absorptions: rows are R,G,B channel densities; columns c,m,y dyes. */
const UNWANTED = [
  [0, 0.1, 0.02],
  [0.18, 0, 0.08],
  [0.06, 0.28, 0],
];

function dyeMatrix(impurity: number): number[] {
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    const row = [0, 1, 2].map((c) => (r === c ? 1 : 0) + impurity * UNWANTED[r][c]);
    const sum = row[0] + row[1] + row[2];
    m.push(...row.map((v) => v / sum));
  }
  return m;
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return o;
}

function inv3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

const LAYER = { c: 0, m: 1, y: 2 } as const;

/* ------------------------------------------------------------------ *
 * Building the tone
 * ------------------------------------------------------------------ */

const cache = { key: '', tone: null as Tone | null };

/** Only the keys the tone depends on, so animating a scratch does not re-solve the curves. */
function toneKey(s: Settings): string {
  let k = '';
  for (const key in s) {
    if (
      key.startsWith('format.') || key.startsWith('curve.') || key.startsWith('grain.') ||
      key.startsWith('halation.') || key.startsWith('dye.') || key.startsWith('print.') ||
      key.startsWith('fade.') || key.startsWith('exposure.') || key.startsWith('telecine.')
    ) {
      k += `${key}=${String(s[key])};`;
    }
  }
  return k;
}

export function buildTone(s: Settings): Tone {
  const key = toneKey(s);
  if (cache.tone && cache.key === key) return cache.tone;
  const tone = computeTone(s);
  cache.key = key;
  cache.tone = tone;
  return tone;
}

function computeTone(s: Settings): Tone {
  const st = stock(str(s, 'format.stock'));
  const curveOn = bool(s, 'curve.enabled');
  const grainOn = bool(s, 'grain.enabled');
  const halOn = bool(s, 'halation.enabled');
  const dyeOn = bool(s, 'dye.enabled');
  const printOn = bool(s, 'print.enabled');
  const fadeOn = bool(s, 'fade.enabled');
  const expOn = bool(s, 'exposure.enabled');
  const tkOn = bool(s, 'telecine.enabled');

  const push = curveOn ? num(s, 'curve.push') : 0;
  const gMul = (curveOn ? num(s, 'curve.gamma') : 1) * (1 + 0.15 * push);
  const cross = curveOn ? num(s, 'curve.crossover') : 0;
  const crossK: RGB = [1 - 0.12 * cross, 1, 1 + 0.12 * cross];
  const toeShift = curveOn ? num(s, 'curve.toe') : 0;
  const shoulderShift = curveOn ? num(s, 'curve.shoulder') : 0;
  const toeSoft = st.toeSoft * (curveOn ? num(s, 'curve.toeSoftness') : 1);
  const shoulderSoft = st.shoulderSoft * (curveOn ? num(s, 'curve.shoulderSoftness') : 1);

  const mode: ToneMode = !curveOn ? ToneMode.Linear : st.kind === 'reversal' ? ToneMode.Reversal : ToneMode.Negative;

  /* ---- exposure ---- */
  let expGain: RGB = [1, 1, 1];
  if (expOn) {
    const light = str(s, 'exposure.light');
    if (light !== 'matched') {
      const il = LIGHTS[light] ?? [1, 1, 1];
      const bal = balanceRGB(st.balance);
      const f = bool(s, 'exposure.filter85') ? FILTER_85 : [1, 1, 1];
      expGain = [0, 1, 2].map((c) => (il[c] * f[c]) / bal[c]) as RGB;
    } else if (bool(s, 'exposure.filter85')) {
      // An 85 over a stock already matched to its light still warms it.
      expGain = [FILTER_85[0], 1, FILTER_85[2]];
    }
    const g = expGain[1];
    const stops = num(s, 'exposure.stops') - 0.3 * push;
    const k = Math.pow(2, stops) / g;
    expGain = [expGain[0] * k, expGain[1] * k, expGain[2] * k];
  }
  // Push processing still implies the exposure loss when the Exposure section
  // is off, because the push belongs to the curve, not to the meter.
  if (!expOn && push !== 0) {
    const k = Math.pow(2, -0.3 * push);
    expGain = [k, k, k];
  }

  /* ---- the original's curve ---- */
  const gamma = [0, 1, 2].map((c) => st.gamma[c] * gMul * crossK[c]) as RGB;
  const dmin: RGB = [...st.dmin] as RGB;
  const dmax: RGB = [...st.dmax] as RGB;
  if (push > 0) {
    if (st.kind === 'negative') for (let c = 0; c < 3; c++) dmin[c] += 0.04 * push;
    else for (let c = 0; c < 3; c++) dmax[c] -= 0.18 * push;
  }
  const xt: RGB = [0, 0, 0];
  const xs: RGB = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const t = toeSoft;
    const sh = shoulderSoft;
    if (st.kind === 'negative') {
      const xsc = st.latitude;
      xt[c] = solve((x) => response(0, gamma[c], x, xsc, t, sh), st.grey, -8, 0, false);
      xs[c] = xsc + shoulderShift;
    } else {
      const range = dmax[c] - dmin[c];
      xt[c] = solve(
        (x) => response(0, gamma[c], x, x + range / gamma[c], t, sh),
        dmax[c] - st.grey,
        -8,
        1,
        false,
      );
      xs[c] = xt[c] + range / gamma[c] + shoulderShift;
    }
    xt[c] += toeShift;
  }

  const negDensity = (x: number, c: number) =>
    dmin[c] + response(x, gamma[c], xt[c], xs[c], toeSoft, shoulderSoft);

  /* ---- print ---- */
  const ps = printStock(str(s, 'print.stock'));
  let process: Process = Process.Print;
  if (mode === ToneMode.Negative) {
    const p = str(s, 'print.process');
    process = !printOn ? Process.Scan : p === 'scan' ? Process.Scan : p === 'raw' ? Process.Raw : Process.Print;
  }
  const pGamma: RGB = [...ps.gamma] as RGB;
  const pDmin: RGB = [...ps.dmin] as RGB;
  const pDmax: RGB = [...ps.dmax] as RGB;
  const pXt: RGB = [0, 0, 0];
  const pXs = [0, 1, 2].map((c) => (pDmax[c] - pDmin[c]) / pGamma[c]) as RGB;
  const pMono = ps.mono && !st.mono;
  const printMonoW: RGB = [0.15, 0.25, 0.6];
  const negGrey: RGB = [0, 1, 2].map((c) => negDensity(0, c)) as RGB;
  const pK: RGB = [0, 0, 0];
  const lights: RGB = [num(s, 'print.red'), num(s, 'print.green'), num(s, 'print.blue')];
  const overall = num(s, 'print.density');
  for (let c = 0; c < 3; c++) {
    const dg = pMono
      ? negGrey[0] * printMonoW[0] + negGrey[1] * printMonoW[1] + negGrey[2] * printMonoW[2]
      : negGrey[c];
    const printD = (xp: number) => pDmin[c] + response(xp, pGamma[c], pXt[c], pXs[c], ps.toeSoft, ps.shoulderSoft);
    const xAim = solve(printD, ps.aim, -6, 10, true);
    pK[c] = xAim + dg + (lights[c] - 25 + overall) * 0.025;
  }

  /* ---- the final positive ---- */
  let aim: number;
  let finalDmin: RGB;
  let unexposed: RGB;
  let layers: number[];
  const scanRatio = 2.2;
  const linearG = 1;
  const tkGrey = tkOn ? num(s, 'telecine.grey') : 0.18;
  const tkWhite = tkOn ? num(s, 'telecine.white') : 1;
  if (mode === ToneMode.Linear) {
    aim = 1;
    finalDmin = [0, 1, 2].map(() => aim - Math.log10(tkWhite / tkGrey) / linearG) as RGB;
    unexposed = [aim + 4, aim + 4, aim + 4];
    layers = [0, 1, 2];
  } else if (mode === ToneMode.Reversal) {
    aim = st.grey;
    finalDmin = dmin;
    unexposed = dmax;
    layers = [2, 1, 0];
  } else if (process === Process.Print) {
    aim = ps.aim;
    finalDmin = pDmin;
    unexposed = [0, 1, 2].map((c) => {
      const dn = pMono ? dmin[0] * 0.15 + dmin[1] * 0.25 + dmin[2] * 0.6 : dmin[c];
      return pDmin[c] + response(pK[c] - dn, pGamma[c], pXt[c], pXs[c], ps.toeSoft, ps.shoulderSoft);
    }) as RGB;
    layers = ps.layers.map((l) => LAYER[l]);
  } else if (process === Process.Scan) {
    aim = 1;
    finalDmin = [0.05, 0.05, 0.05];
    unexposed = [0, 1, 2].map((c) => aim + (negGrey[c] - dmin[c]) * scanRatio) as RGB;
    layers = [2, 1, 0];
  } else {
    // The negative on a light box: shown as transmission, mask and all.
    aim = 1;
    finalDmin = [0.05, 0.05, 0.05];
    unexposed = dmin;
    layers = [2, 1, 0];
  }

  /* ---- dyes: fading and impurity ---- */
  const fadeStock =
    mode === ToneMode.Negative && process === Process.Print
      ? { fade: ps.fade, stain: ps.stain, impurity: ps.impurity, mono: ps.mono || st.mono, saturation: ps.saturation }
      : { fade: st.fade, stain: st.stain, impurity: st.impurity, mono: st.mono, saturation: 1 };
  const years = fadeOn ? num(s, 'fade.years') * (STORAGE_RATE[str(s, 'fade.storage')] ?? 1) : 0;
  const rateMul: RGB = [num(s, 'fade.cyan'), num(s, 'fade.magenta'), num(s, 'fade.yellow')];
  const remain = [0, 1, 2].map((c) => Math.exp(-fadeStock.fade[c] * rateMul[c] * years));
  const stainD = fadeStock.stain * num(s, 'fade.stain') * years;
  const stain: RGB = [stainD * 0.1, stainD * 0.25, stainD];

  let matrix: number[];
  if (fadeStock.mono) {
    // Silver has no dyes to fade or to be impure, but it does take the
    // average of whatever the fade settings ask, so it is not inert.
    const avg = (remain[0] + remain[1] + remain[2]) / 3;
    matrix = [avg, 0, 0, 0, avg, 0, 0, 0, avg];
  } else {
    const base = fadeStock.impurity;
    const render = base * (dyeOn ? num(s, 'dye.impurity') : 1);
    const analysis = dyeMatrix(base);
    matrix = mul3(mul3(dyeMatrix(render), [remain[0], 0, 0, 0, remain[1], 0, 0, 0, remain[2]]), inv3(analysis));
  }

  /* ---- grain ---- */
  const amount = grainOn ? num(s, 'grain.amount') * (1 + 0.25 * Math.max(push, 0)) : 0;
  const size = num(s, 'grain.size');
  const blue = num(s, 'grain.blue');
  const layerSize: RGB = [1, 0.92, 1.15];
  const grainSigma = [0, 1, 2].map(
    (c) => (st.granularity / 1000) * amount * st.layerGrain[c] * (c === 2 ? blue : 1),
  ) as RGB;
  const grainCell = [0, 1, 2].map((c) => st.grainSize * size * layerSize[c]) as RGB;
  const printAmt = grainOn ? num(s, 'grain.print') : 0;

  /* ---- halation ---- */
  const halAmt = halOn ? st.halation * num(s, 'halation.amount') * (bool(s, 'halation.noBacking') ? 8 : 1) : 0;
  const green = num(s, 'halation.green');
  const halWeights: RGB = st.mono ? [halAmt, halAmt, halAmt] : [halAmt, halAmt * green, halAmt * 0.03];

  /* ---- telecine ---- */
  const dminMean = (finalDmin[0] + finalDmin[1] + finalDmin[2]) / 3;
  const tkGamma = Math.log10(tkWhite / tkGrey) / Math.max(aim - dminMean, 0.05);
  const unexposedMean = (unexposed[0] + unexposed[1] + unexposed[2]) / 3;
  const rawNeg = mode === ToneMode.Negative && process === Process.Raw;
  // Only a telecine sets a black point; with it off, video log-light is an
  // exact straight line in density, which is what lets the curve be measured.
  const tkFloor = !tkOn || rawNeg || mode === ToneMode.Linear ? 0 : Math.min(0.5, tkGrey * Math.pow(10, tkGamma * (aim - unexposedMean)));

  return {
    mode,
    mono: st.mono,
    monoWeights: [0.27, 0.58, 0.15],
    expGain,
    headroom: expOn ? num(s, 'exposure.headroom') : 0,
    gamma,
    xt,
    xs,
    toeSoft,
    shoulderSoft,
    dmin,
    dmax,
    // Zero is no interimage effect at all (layers develop independently), one
    // is the stock as made, two is twice as strong.
    interimage: dyeOn && !st.mono ? Math.pow(st.saturation, num(s, 'dye.saturation')) : 1,
    grainSigma,
    grainCell,
    grainRough: num(s, 'grain.roughness'),
    grainExp: num(s, 'grain.density'),
    grainIndep: st.mono ? 0 : num(s, 'grain.colour'),
    printSigma: (ps.granularity / 1000) * printAmt,
    printCell: ps.grainSize,
    dupeSigma: 0.004 * printAmt,
    halWeights,
    // The halo's radius is set by the base: light crossing it at up to the
    // critical angle and back again lands about 1.7 base thicknesses away.
    halSigmaMm: (gauge(str(s, 'format.gauge')).baseThickness * 1.7 * 0.6 * num(s, 'halation.radius')) / 1000,
    process,
    pMono,
    pGamma,
    pXt,
    pXs,
    pToeSoft: ps.toeSoft,
    pShoulderSoft: ps.shoulderSoft,
    pDmin,
    pDmax,
    pK,
    scanGrey: negGrey,
    scanRatio,
    generations: printOn ? num(s, 'print.generations') : 0,
    bleach: printOn ? num(s, 'print.bleachBypass') : 0,
    aim,
    finalDmin,
    dyeMatrix: matrix,
    stain,
    fadeNegative: mode === ToneMode.Negative && process !== Process.Print,
    unexposed,
    layers,
    originalLayers: [2, 1, 0],
    originalMono: st.mono,
    finalMono: st.mono || (mode === ToneMode.Negative && process === Process.Print && ps.mono),
    tkGamma,
    tkGrey,
    tkFloor,
    tkBlack: tkOn ? num(s, 'telecine.black') : 0,
    tkSat: (tkOn ? num(s, 'telecine.saturation') : 1) * (dyeOn ? fadeStock.saturation : 1),
  };
}
