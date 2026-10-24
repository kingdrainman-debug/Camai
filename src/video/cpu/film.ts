/**
 * The CPU film chain: camera.frag, down.frag, blur.frag, film.frag and
 * present.frag, pass for pass.
 *
 * Buffers are stored bottom row first, the way OpenGL addresses textures, so
 * that a pixel's (x + 0.5, y + 0.5) here is exactly gl_FragCoord there and no
 * coordinate in the chain needs flipping. The source is flipped once on
 * upload, as UNPACK_FLIP_Y_WEBGL does for the GPU, and the output once on the
 * way to the canvas.
 *
 * Every function below exists to produce what its shader produces. When one
 * of them is changed, the other has to be, and the smoke test compares the two.
 */

import { FieldState, FrameState, HAIR_POINTS, MAX_HAIRS, MAX_SCRATCHES, MAX_SPECKS } from '../../film/clock';
import { PassParams } from '../../film/passes';
import {
  Buf,
  PI,
  TAU,
  clamp,
  fbm,
  gauss,
  hash12,
  hash22,
  hash32,
  ign,
  mix,
  sampleUV,
  smoothstep,
  vnoise,
} from './core';

const t4 = new Float32Array(4);
const h2 = new Float32Array(2);
const h3 = new Float32Array(4);
const LOG10_GREY = Math.log10(0.18);
const LN10 = Math.log(10);

/* ------------------------------------------------------------------ *
 * Shared maths
 * ------------------------------------------------------------------ */

function sp(z: number): number {
  return Math.max(z, 0) + Math.log(1 + Math.exp(-Math.abs(z)));
}

function response(x: number, g: number, xt: number, xs: number, t: number, s: number): number {
  return g * (t * sp((x - xt) / t) - s * sp((x - xs) / s));
}

function srgbToLinear(c: number): number {
  const v = clamp(c, 0, 1);
  return v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = clamp(c, 0, 1);
  return v < 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function sdRoundRect(px: number, py: number, hx: number, hy: number, r: number): number {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/* ------------------------------------------------------------------ *
 * camera.frag
 * ------------------------------------------------------------------ */

const TAPS = 12;
const TAP_X = new Float64Array(TAPS);
const TAP_Y = new Float64Array(TAPS);
const TAP_W = new Float64Array(TAPS);
for (let i = 0; i < TAPS; i++) {
  const rr = Math.sqrt((i + 0.5) / TAPS);
  const th = i * 2.399963;
  TAP_X[i] = Math.cos(th) * rr * 2;
  TAP_Y[i] = Math.sin(th) * rr * 2;
  TAP_W[i] = Math.exp(-2 * rr * rr);
}

export function cameraPass(src: Buf, dst: Buf, fs: FrameState, pp: PassParams): void {
  const g = fs.geometry;
  const apWs = g.apW * g.squeeze;
  const sizeX = g.srcAspect > apWs / g.apH ? g.apH * g.srcAspect : apWs;
  const sizeY = g.srcAspect > apWs / g.apH ? g.apH : apWs / g.srcAspect;
  const headroom = fs.tone.headroom;
  const sq = g.squeeze;
  const ca = fs.caRel;
  const fringe = ca > 1e-6;
  const d = dst.d;

  const scene = (mx: number, my: number, out: Float32Array) => {
    sampleUV(src, (mx * sq) / sizeX + 0.5, my / sizeY + 0.5, out);
    const r = srgbToLinear(out[0]);
    const gg = srgbToLinear(out[1]);
    const b = srgbToLinear(out[2]);
    const m = Math.max(r, gg, b);
    const m2 = m * m;
    const k = Math.pow(2, headroom * m2 * m2);
    out[0] = r * k;
    out[1] = gg * k;
    out[2] = b * k;
  };

  for (let y = 0; y < dst.h; y++) {
    const v = (y + 0.5) / dst.h;
    const my = (v - 0.5) * pp.eSizeMm[1];
    for (let x = 0; x < dst.w; x++) {
      const u = (x + 0.5) / dst.w;
      const mx = (u - 0.5) * pp.eSizeMm[0];
      const prx = mx / pp.halfDiag;
      const pry = my / pp.halfDiag;
      const r2 = prx * prx + pry * pry;
      const k = 1 + fs.distortion * r2;
      const dx = mx * k;
      const dy = my * k;
      const sigma = fs.lensSigmaMm * (1 + fs.cornerSoft * r2);
      const blur = sigma > pp.srcPxMm * 0.33;

      let sr = 0;
      let sg = 0;
      let sb = 0;
      let ws = 0;
      for (let i = 0; i < TAPS; i++) {
        let ox = 0;
        let oy = 0;
        let w = 1;
        if (blur) {
          ox = TAP_X[i] * sigma;
          oy = TAP_Y[i] * sigma;
          w = TAP_W[i];
        }
        if (fringe) {
          scene(dx * (1 + ca) + ox, dy * (1 + ca) + oy, t4);
          sr += t4[0] * w;
          scene(dx + ox, dy + oy, t4);
          sg += t4[1] * w;
          scene(dx * (1 - ca) + ox, dy * (1 - ca) + oy, t4);
          sb += t4[2] * w;
        } else {
          scene(dx + ox, dy + oy, t4);
          sr += t4[0] * w;
          sg += t4[1] * w;
          sb += t4[2] * w;
        }
        ws += w;
        if (!blur) break;
      }
      const vg = Math.pow(2, -fs.vignette * r2) / ws;
      const o = (y * dst.w + x) * 4;
      d[o] = sr * vg;
      d[o + 1] = sg * vg;
      d[o + 2] = sb * vg;
      d[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * down.frag and blur.frag
 * ------------------------------------------------------------------ */

export function downPass(src: Buf, dst: Buf, threshold: number): void {
  const d = dst.d;
  const tx = 1 / src.w;
  const ty = 1 / src.h;
  for (let y = 0; y < dst.h; y++) {
    const v = (y + 0.5) / dst.h;
    for (let x = 0; x < dst.w; x++) {
      const u = (x + 0.5) / dst.w;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        sampleUV(src, u + (k & 1 ? tx : -tx), v + (k & 2 ? ty : -ty), t4);
        r += t4[0];
        g += t4[1];
        b += t4[2];
      }
      r *= 0.25;
      g *= 0.25;
      b *= 0.25;
      if (threshold > 0) {
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        const k = Math.max(l - threshold, 0) / Math.max(l, 1e-4);
        r *= k;
        g *= k;
        b *= k;
      }
      const o = (y * dst.w + x) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 1;
    }
  }
}

export function blurPass(src: Buf, dst: Buf, radius: number, dx: number, dy: number): void {
  const sigma = Math.max(radius, 0.35);
  const step = Math.max(sigma * 0.42, 0.6);
  const d = dst.d;
  const tx = 1 / src.w;
  const ty = 1 / src.h;
  const weights: number[] = [];
  for (let k = -6; k <= 6; k++) weights.push(gauss(k * step, sigma));
  for (let y = 0; y < dst.h; y++) {
    const v = (y + 0.5) / dst.h;
    for (let x = 0; x < dst.w; x++) {
      const u = (x + 0.5) / dst.w;
      let r = 0;
      let g = 0;
      let b = 0;
      let ws = 0;
      for (let k = -6; k <= 6; k++) {
        const w = weights[k + 6];
        const off = k * step;
        sampleUV(src, u + dx * tx * off, v + dy * ty * off, t4);
        r += t4[0] * w;
        g += t4[1] * w;
        b += t4[2] * w;
        ws += w;
      }
      const o = (y * dst.w + x) * 4;
      const iw = 1 / Math.max(ws, 1e-5);
      d[o] = r * iw;
      d[o + 1] = g * iw;
      d[o + 2] = b * iw;
      d[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * film.frag
 * ------------------------------------------------------------------ */

function gnoise(x: number, y: number): number {
  return (vnoise(x, y) - 0.5) * 5.26;
}

function grainField(umx: number, umy: number, cell: number, ox: number, oy: number, rough: number): number {
  const px = umx / cell + ox;
  const py = umy / cell + oy;
  const f = gnoise(px, py);
  const c = gnoise(px * 0.5 + 37.1, py * 0.5 + 37.1);
  return (f + rough * c) / Math.sqrt(1 + rough * rough);
}

function grainNoise(
  umx: number,
  umy: number,
  cr: number,
  cg: number,
  cb: number,
  ox: number,
  oy: number,
  rough: number,
  mono: boolean,
  indep: number,
  out: Float64Array,
): void {
  const shared = grainField(umx, umy, cg, ox + 3.1, oy + 7.7, rough);
  if (mono) {
    out[0] = out[1] = out[2] = shared;
    return;
  }
  const nr = grainField(umx, umy, cr, ox + 17.3, oy + 91.7, rough);
  const ng = grainField(umx, umy, cg, ox + 53.9, oy + 11.3, rough);
  const nb = grainField(umx, umy, cb, ox + 29.1, oy + 63.7, rough);
  const k = indep;
  const norm = 1 / Math.sqrt((1 - k) * (1 - k) + k * k);
  out[0] = mix(shared, nr, k) * norm;
  out[1] = mix(shared, ng, k) * norm;
  out[2] = mix(shared, nb, k) * norm;
}

const gn = new Float64Array(3);
const dirtOut = new Float64Array(2);

function dust(mx: number, my: number, fs: FrameState, frameSeed: number, out: Float64Array): void {
  out[0] = out[1] = 0;
  if (fs.dust <= 0) return;
  const cs = fs.dirtSizeMm * 9;
  const cx = Math.floor(mx / cs);
  const cy = Math.floor(my / cs);
  const kx = cx + frameSeed * 419;
  const ky = cy + frameSeed * 419;
  hash32(kx, ky, h3);
  if (h3[0] > fs.dust * 0.24) return;
  hash22(kx + 7.1, ky + 7.1, h2);
  const ccx = (cx + 0.25 + 0.5 * h2[0]) * cs;
  const ccy = (cy + 0.25 + 0.5 * h2[1]) * cs;
  const r = fs.dirtSizeMm * (0.3 + 1.4 * h3[1] * h3[1]);
  const dx = mx - ccx;
  const dy = my - ccy;
  const rr = Math.max(r, 1e-4);
  const edge = r * (0.7 + 0.6 * vnoise((dx / rr) * 1.7 + h3[2] * 40, (dy / rr) * 1.7 + h3[2] * 40));
  const a = 1 - smoothstep(edge * 0.6, edge, Math.sqrt(dx * dx + dy * dy));
  const dens = a * 2.6;
  if (h3[2] < fs.dirtNegative) out[0] = dens;
  else out[1] = dens;
}

function fibre(mx: number, my: number, fs: FrameState, frameSeed: number, out: Float64Array): void {
  out[0] = out[1] = 0;
  if (fs.fibres <= 0) return;
  const cs = fs.dirtSizeMm * 40;
  const cx = Math.floor(mx / cs);
  const cy = Math.floor(my / cs);
  const kx = cx + frameSeed * 263 + 11;
  const ky = cy + frameSeed * 263 + 11;
  hash32(kx, ky, h3);
  if (h3[0] > fs.fibres * 0.3) return;
  const ccx = (cx + 0.5) * cs;
  const ccy = (cy + 0.5) * cs;
  const ang = h3[1] * TAU;
  const dirx = Math.cos(ang);
  const diry = Math.sin(ang);
  const len = cs * (0.35 + 0.5 * h3[2]);
  const dx = mx - ccx;
  const dy = my - ccy;
  const along0 = dx * dirx + dy * diry;
  const s = clamp(along0 / len + 0.5, 0, 1);
  const curl = (hash12(kx + 3.3, ky + 3.3) - 0.5) * 0.6;
  const off = (dx * -diry + dy * dirx) - curl * len * Math.sin(PI * s) - curl * len * 0.4 * Math.sin(TAU * s);
  const along = Math.abs(along0) < len * 0.5 ? 1 : 0;
  const w = fs.dirtSizeMm * 0.09;
  const a = (1 - smoothstep(w * 0.5, w, Math.abs(off))) * along;
  if (hash12(kx + 9.9, ky + 9.9) < fs.dirtNegative) out[0] = a * 2;
  else out[1] = a * 2;
}

function removeLayers(D: Float64Array, base: number[], order: number[], amount: number, depth: number): void {
  const gone = depth * 3 + 0.2;
  for (let i = 0; i < 3; i++) {
    const rem = clamp(gone - i, 0, 1) * amount;
    const ch = Math.round(order[i]);
    D[ch] = base[ch] + (D[ch] - base[ch]) * (1 - rem);
  }
}

function scratches(D: Float64Array, base: number[], order: number[], x: number, onOriginal: number, sc: Float32Array): void {
  for (let i = 0; i < MAX_SCRATCHES; i++) {
    const sx = sc[i * 4];
    const sw = sc[i * 4 + 1];
    const sz = sc[i * 4 + 2];
    const code = sc[i * 4 + 3];
    if (sz <= 0) continue;
    const type = Math.floor(code);
    const depth = code - type;
    const isNeg = type >= 2 ? 1 : 0;
    if (Math.abs(isNeg - onOriginal) > 0.5) continue;
    const isBase = type % 2;
    const d = Math.abs(x - sx);
    if (isBase > 0.5) {
      const hw = sw * 2.2;
      const add = 0.45 * sz * Math.exp(-(d * d) / (2 * hw * hw));
      D[0] += add;
      D[1] += add;
      D[2] += add;
    } else {
      const core = 1 - smoothstep(sw * 0.45, sw, d);
      removeLayers(D, base, order, core * sz, depth);
      const q = (d - sw) / (sw * 0.35 + 1e-5);
      const rim = 0.18 * Math.exp(-q * q) * sz;
      D[0] += rim;
      D[1] += rim;
      D[2] += rim;
    }
  }
}

export function filmPass(
  E: Buf,
  Hb: Buf,
  Vb: Buf,
  Sb: Buf,
  dst: Buf,
  fs: FrameState,
  field: FieldState,
  pp: PassParams,
  useGlow: { hal: boolean; veil: boolean; streak: boolean },
): void {
  const tone = fs.tone;
  const g = fs.geometry;
  const H = g.apH;
  const apW = g.apW;
  const d = dst.d;
  const seed = fs.seed;
  const statX = (((seed * 0.0137) % 1) + 1) % 1 * 300;
  const statY = (((seed * 0.0291) % 1) + 1) % 1 * 300;
  const driftY = (field.n % 20000) * 0.0006 * H;
  const fseed = field.seed;
  const offX = fseed * 911;
  const offY = fseed * 577;
  const mono = tone.mono;
  const halW = tone.halWeights;
  const ft = pp.flareTint;
  const stt = pp.streakTint;
  const expMul = Math.pow(2, field.expStops);
  const egR = tone.expGain[0] * expMul;
  const egG = tone.expGain[1] * expMul;
  const egB = tone.expGain[2] * expMul;
  const warmR = 1;
  const warmG = mix(1, 0.42, fs.leakWarmth);
  const warmB = mix(1, 0.1, fs.leakWarmth);
  const pix = pp.fPixUm;
  const cellR = Math.max(tone.grainCell[0], pix);
  const cellG = Math.max(tone.grainCell[1], pix);
  const cellB = Math.max(tone.grainCell[2], pix);
  const sigR = (tone.grainSigma[0] * 48) / Math.max(tone.grainCell[0], pix);
  const sigG = (tone.grainSigma[1] * 48) / Math.max(tone.grainCell[1], pix);
  const sigB = (tone.grainSigma[2] * 48) / Math.max(tone.grainCell[2], pix);
  const grainOn = sigR > 0 || sigG > 0 || sigB > 0;
  const negativePath = tone.mode === 0;
  const dyeM = tone.dyeMatrix;
  const D = new Float64Array(3);
  const P = new Float64Array(3);
  const base = tone.mode === 2 ? tone.finalDmin : tone.dmin;
  const pc = Math.max(tone.printCell, pix);
  const psig = (tone.printSigma * 48) / pc;
  const dupeCell = Math.max(5, pix);
  const dsig = (tone.dupeSigma * 48) / dupeCell;
  const leakAtX = Math.cos(field.leakAngle) * apW * 0.58;
  const leakAtY = Math.sin(field.leakAngle) * H * 0.58;

  const applyDye = (V: Float64Array, b: number[]) => {
    const a0 = V[0] - b[0];
    const a1 = V[1] - b[1];
    const a2 = V[2] - b[2];
    V[0] = b[0] + dyeM[0] * a0 + dyeM[1] * a1 + dyeM[2] * a2 + tone.stain[0];
    V[1] = b[1] + dyeM[3] * a0 + dyeM[4] * a1 + dyeM[5] * a2 + tone.stain[1];
    V[2] = b[2] + dyeM[6] * a0 + dyeM[7] * a1 + dyeM[8] * a2 + tone.stain[2];
  };

  for (let y = 0; y < dst.h; y++) {
    const v = (y + 0.5) / dst.h;
    for (let x = 0; x < dst.w; x++) {
      const u = (x + 0.5) / dst.w;
      let mx = (u - 0.5) * pp.fSizeMm[0];
      let my = (v - 0.5) * pp.fSizeMm[1];

      if (fs.vinegar > 0) {
        const qx = mx / (H * 0.45) + statX;
        const qy = my / (H * 0.45) + statY + driftY / H;
        const wx = fbm(qx, qy) - 0.47;
        const wy = fbm(qx + 19.7, qy + 19.7) - 0.47;
        mx += fs.vinegar * 0.035 * H * wx;
        my += fs.vinegar * 0.035 * H * wy;
      }
      const umx = mx * 1000;
      const umy = my * 1000;

      /* ---- exposure ---- */
      const eu = (mx - field.camWeave[0]) / pp.eSizeMm[0] + 0.5;
      const ev = (my - field.camWeave[1]) / pp.eSizeMm[1] + 0.5;
      sampleUV(E, eu, ev, t4);
      let er = t4[0];
      let eg = t4[1];
      let eb = t4[2];
      if (useGlow.hal) {
        sampleUV(Hb, eu, ev, t4);
        er += t4[0] * halW[0];
        eg += t4[1] * halW[1];
        eb += t4[2] * halW[2];
      }
      if (useGlow.veil) {
        sampleUV(Vb, eu, ev, t4);
        er += t4[0] * fs.flare * ft[0];
        eg += t4[1] * fs.flare * ft[1];
        eb += t4[2] * fs.flare * ft[2];
      }
      if (useGlow.streak) {
        sampleUV(Sb, eu, ev, t4);
        er += t4[0] * fs.streak * stt[0];
        eg += t4[1] * fs.streak * stt[1];
        eb += t4[2] * fs.streak * stt[2];
      }
      const gate = 1 - smoothstep(-0.012, 0.012, sdRoundRect(mx, my, apW * 0.5, H * 0.5, g.gauge.gateRadius));
      er *= egR * gate;
      eg *= egG * gate;
      eb *= egB * gate;

      if (field.leak > 0) {
        const ddx = (mx - leakAtX) / apW;
        const ddy = (my - leakAtY) / H;
        let shape = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 0.3 * 0.3));
        shape *= 0.65 + 0.7 * vnoise(mx / (H * 0.35) + fseed * 5, my / (H * 0.35) + fseed * 5);
        const k = field.leak * shape * 1.4;
        er += warmR * k;
        eg += warmG * k;
        eb += warmB * k;
      }
      const perfSide = Math.exp(-Math.max(mx + apW * 0.5, 0) / (apW * 0.14));
      if (field.rollFog > 0) {
        const f = 0.55 + 0.45 * fbm(mx / (H * 0.4) + fseed * 3, my / (H * 0.4) + fseed * 3);
        const k = field.rollFog * f * (0.5 + 0.8 * perfSide) * 1.1;
        er += warmR * k;
        eg += warmG * k;
        eb += warmB * k;
      }
      if (fs.edgeFog > 0) {
        const k = fs.edgeFog * perfSide * (0.8 + 0.4 * vnoise((my / H) * 6, fseed * 31)) * 0.7;
        er += warmR * k;
        eg += warmG * k;
        eb += warmB * k;
      }
      if (mono) {
        const m = er * tone.monoWeights[0] + eg * tone.monoWeights[1] + eb * tone.monoWeights[2];
        er = eg = eb = m;
      }

      /* ---- development ---- */
      const xr = Math.log(Math.max(er, 1e-6)) / LN10 - LOG10_GREY;
      const xg = Math.log(Math.max(eg, 1e-6)) / LN10 - LOG10_GREY;
      const xb = Math.log(Math.max(eb, 1e-6)) / LN10 - LOG10_GREY;
      if (tone.mode === 2) {
        D[0] = tone.aim - xr;
        D[1] = tone.aim - xg;
        D[2] = tone.aim - xb;
      } else if (tone.mode === 1) {
        D[0] = clamp(tone.dmax[0] - response(xr, tone.gamma[0], tone.xt[0], tone.xs[0], tone.toeSoft, tone.shoulderSoft), tone.dmin[0], tone.dmax[0]);
        D[1] = clamp(tone.dmax[1] - response(xg, tone.gamma[1], tone.xt[1], tone.xs[1], tone.toeSoft, tone.shoulderSoft), tone.dmin[1], tone.dmax[1]);
        D[2] = clamp(tone.dmax[2] - response(xb, tone.gamma[2], tone.xt[2], tone.xs[2], tone.toeSoft, tone.shoulderSoft), tone.dmin[2], tone.dmax[2]);
      } else {
        D[0] = tone.dmin[0] + response(xr, tone.gamma[0], tone.xt[0], tone.xs[0], tone.toeSoft, tone.shoulderSoft);
        D[1] = tone.dmin[1] + response(xg, tone.gamma[1], tone.xt[1], tone.xs[1], tone.toeSoft, tone.shoulderSoft);
        D[2] = tone.dmin[2] + response(xb, tone.gamma[2], tone.xt[2], tone.xs[2], tone.toeSoft, tone.shoulderSoft);
      }

      if (tone.interimage !== 1) {
        const n0 = D[0] - base[0];
        const n1 = D[1] - base[1];
        const n2 = D[2] - base[2];
        const m = (n0 + n1 + n2) / 3;
        D[0] = base[0] + Math.max(m + (n0 - m) * tone.interimage, 0);
        D[1] = base[1] + Math.max(m + (n1 - m) * tone.interimage, 0);
        D[2] = base[2] + Math.max(m + (n2 - m) * tone.interimage, 0);
      }

      if (grainOn) {
        grainNoise(umx, umy, cellR, cellG, cellB, offX, offY, tone.grainRough, mono, tone.grainIndep, gn);
        D[0] += sigR * Math.pow(Math.max(D[0] - base[0], 0.03), tone.grainExp) * gn[0];
        D[1] += sigG * Math.pow(Math.max(D[1] - base[1], 0.03), tone.grainExp) * gn[1];
        D[2] += sigB * Math.pow(Math.max(D[2] - base[2], 0.03), tone.grainExp) * gn[2];
      }

      dust(mx, my, fs, fseed, dirtOut);
      let dirtNeg = dirtOut[0];
      let dirtPos = dirtOut[1];
      fibre(mx, my, fs, fseed, dirtOut);
      dirtNeg += dirtOut[0];
      dirtPos += dirtOut[1];
      D[0] += dirtNeg;
      D[1] += dirtNeg;
      D[2] += dirtNeg;
      scratches(D, base, tone.originalLayers, mx, 1, field.scratches);

      /* ---- to a positive ---- */
      let pBase = tone.finalDmin;
      if (negativePath) {
        if (tone.fadeNegative) applyDye(D, base);
        for (let gi = 0; gi < 4; gi++) {
          if (gi >= tone.generations) break;
          grainNoise(umx, umy, dupeCell, dupeCell, dupeCell, offX + gi * 71.3 + 500, offY + gi * 13.9 + 500, tone.grainRough, mono, tone.grainIndep, gn);
          D[0] = base[0] + (D[0] - base[0]) * 1.04 + dsig * gn[0];
          D[1] = base[1] + (D[1] - base[1]) * 1.04 + dsig * gn[1];
          D[2] = base[2] + (D[2] - base[2]) * 1.04 + dsig * gn[2];
        }
        if (tone.process === 0) {
          let x0: number;
          let x1: number;
          let x2: number;
          if (tone.pMono) {
            const m = D[0] * 0.15 + D[1] * 0.25 + D[2] * 0.6;
            x0 = tone.pK[0] - m;
            x1 = tone.pK[1] - m;
            x2 = tone.pK[2] - m;
          } else {
            x0 = tone.pK[0] - D[0];
            x1 = tone.pK[1] - D[1];
            x2 = tone.pK[2] - D[2];
          }
          P[0] = Math.min(tone.pDmin[0] + response(x0, tone.pGamma[0], tone.pXt[0], tone.pXs[0], tone.pToeSoft, tone.pShoulderSoft), tone.pDmax[0]);
          P[1] = Math.min(tone.pDmin[1] + response(x1, tone.pGamma[1], tone.pXt[1], tone.pXs[1], tone.pToeSoft, tone.pShoulderSoft), tone.pDmax[1]);
          P[2] = Math.min(tone.pDmin[2] + response(x2, tone.pGamma[2], tone.pXt[2], tone.pXs[2], tone.pToeSoft, tone.pShoulderSoft), tone.pDmax[2]);
          if (psig > 0) {
            grainNoise(umx, umy, pc, pc, pc, offX + 300, offY + 300, tone.grainRough, mono, tone.grainIndep, gn);
            P[0] += psig * Math.pow(Math.max(P[0] - tone.pDmin[0], 0.03), tone.grainExp) * gn[0];
            P[1] += psig * Math.pow(Math.max(P[1] - tone.pDmin[1], 0.03), tone.grainExp) * gn[1];
            P[2] += psig * Math.pow(Math.max(P[2] - tone.pDmin[2], 0.03), tone.grainExp) * gn[2];
          }
        } else if (tone.process === 1) {
          P[0] = tone.aim + (tone.scanGrey[0] - D[0]) * tone.scanRatio;
          P[1] = tone.aim + (tone.scanGrey[1] - D[1]) * tone.scanRatio;
          P[2] = tone.aim + (tone.scanGrey[2] - D[2]) * tone.scanRatio;
        } else {
          P[0] = D[0];
          P[1] = D[1];
          P[2] = D[2];
          pBase = base;
        }
      } else {
        P[0] = D[0];
        P[1] = D[1];
        P[2] = D[2];
        for (let gi = 0; gi < 4; gi++) {
          if (gi >= tone.generations) break;
          grainNoise(umx, umy, dupeCell, dupeCell, dupeCell, offX + gi * 71.3 + 500, offY + gi * 13.9 + 500, tone.grainRough, mono, tone.grainIndep, gn);
          P[0] = pBase[0] + (P[0] - pBase[0]) * 1.05 + dsig * gn[0];
          P[1] = pBase[1] + (P[1] - pBase[1]) * 1.05 + dsig * gn[1];
          P[2] = pBase[2] + (P[2] - pBase[2]) * 1.05 + dsig * gn[2];
        }
      }

      P[0] += dirtPos;
      P[1] += dirtPos;
      P[2] += dirtPos;
      scratches(P, pBase, tone.layers, mx, 0, field.scratches);

      if (tone.bleach > 0) {
        const net = (Math.max(P[0] - pBase[0], 0) + Math.max(P[1] - pBase[1], 0) + Math.max(P[2] - pBase[2], 0)) / 3;
        const add = tone.bleach * 0.55 * net;
        P[0] += add;
        P[1] += add;
        P[2] += add;
      }

      if (field.splice > 0) {
        const yN = my / (H * 0.5);
        if (fs.spliceKind < 0.5) {
          const q = (Math.abs(yN) - 0.86) / 0.012;
          const edgeLine = Math.exp(-q * q);
          const k = field.splice * 0.8;
          const sc = fbm(mx / (H * 0.05) + fseed * 9, my / (H * 0.05) + fseed * 9);
          for (let c = 0; c < 3; c++) {
            P[c] = mix(P[c], tone.aim + (P[c] - tone.aim) * 0.8, k);
            P[c] += 0.7 * edgeLine * field.splice + 0.12 * field.splice * sc;
          }
        } else {
          const q = (yN - 0.965) / 0.014;
          const line = Math.exp(-q * q);
          for (let c = 0; c < 3; c++) P[c] += 0.9 * line * field.splice + 0.07 * field.splice;
        }
        if (field.splice > 0.99) {
          for (let c = 0; c < 3; c++) P[c] = mix(P[c], pBase[c], 0.5 * fs.spliceFlash);
        }
      }
      if (field.cue > 0) {
        const cx = apW * 0.37;
        const cy = H * 0.34;
        const r = H * 0.045;
        const dx = mx - cx;
        const dy = my - cy;
        const dd = Math.sqrt(dx * dx + dy * dy) - r * (1 + 0.08 * (vnoise((dx / r) * 3, (dy / r) * 3) - 0.5));
        const disc = 1 - smoothstep(-r * 0.06, r * 0.06, dd);
        const q = dd / (r * 0.12);
        const rim = Math.exp(-q * q);
        for (let c = 0; c < 3; c++) P[c] = mix(P[c], pBase[c], disc) + 1.2 * rim;
      }

      if (!tone.fadeNegative) applyDye(P, pBase);

      if (fs.mould > 0) {
        const qx = mx / (H * 0.2) + statX + 13.1;
        const qy = my / (H * 0.2) + statY + 7.3 + driftY / (H * 0.2);
        const m = fbm(qx, qy) + 0.18 * (vnoise(mx / (H * 0.008), my / (H * 0.008)) - 0.5);
        const colony = smoothstep(0.86 - fs.mould * 0.4, 0.9 - fs.mould * 0.4, m);
        const q = (m - (0.88 - fs.mould * 0.4)) / 0.012;
        const edge = 0.25 * Math.exp(-q * q);
        const keep = [0.3, 0.45, 0.6];
        for (let c = 0; c < 3; c++) P[c] = mix(P[c], pBase[c] + (P[c] - pBase[c]) * keep[c], colony) + edge;
      }
      if (fs.water > 0) {
        const w = fbm(mx / (H * 0.4) + statX + 71, my / (H * 0.4) + statY + 3 + driftY / (H * 0.4));
        const level = 0.6 - 0.18 * fs.water;
        const q = (w - level) / 0.005;
        const add = Math.exp(-q * q) * 0.55 * fs.water + smoothstep(level, level + 0.03, w) * 0.05 * fs.water;
        P[0] += add;
        P[1] += add;
        P[2] += add;
      }
      if (fs.flaking > 0) {
        const f = fbm(mx / (H * 0.12) + statX + 5, my / (H * 0.12) + statY + 41 + driftY / (H * 0.12));
        const t = 0.9 - 0.33 * fs.flaking;
        const hole = smoothstep(t, t + 0.015, f);
        const q = (f - t) / 0.008;
        const rim = 0.6 * Math.exp(-q * q);
        for (let c = 0; c < 3; c++) P[c] = mix(P[c], 0.03, hole) + rim;
      }
      if (fs.channelling > 0) {
        const qx = mx / (H * 0.05) + statX;
        const qy = my / (H * 0.35) + statY + driftY / (H * 0.35);
        const c0 = Math.abs(fbm(qx, qy) - 0.5);
        const ridge = 1 - smoothstep(0, 0.012 + 0.01 * fs.channelling, c0);
        const q = (c0 - 0.02) / 0.006;
        const add = ridge * 0.4 * fs.channelling - 0.12 * fs.channelling * Math.exp(-q * q);
        P[0] += add;
        P[1] += add;
        P[2] += add;
      }

      const o = (y * dst.w + x) * 4;
      d[o] = Math.max(P[0], 0);
      d[o + 1] = Math.max(P[1], 0);
      d[o + 2] = Math.max(P[2], 0);
      d[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * present.frag
 * ------------------------------------------------------------------ */

export interface PresentTargets {
  F0: Buf;
  F1: Buf;
  src: Buf | null;
}

export function presentPass(
  out: Uint8ClampedArray,
  outW: number,
  outH: number,
  fs: FrameState,
  pp: PassParams,
  t: PresentTargets,
  opts: { splitX: number; dither: number; frame: number; audioDim: number },
): void {
  const g = fs.geometry;
  const tone = fs.tone;
  const raw = tone.mode === 0 && tone.process === 2;
  const aspect = g.outAspect;
  const pitch = g.gauge.pitch;
  const [pw, ph, pr, perFrame] = pp.perf;
  const unexp = tone.unexposed.map((dd) => Math.pow(10, -dd));
  const fW = pp.fSizeMm[0];
  const fH = pp.fSizeMm[1];
  const T = new Float64Array(3);
  const S = new Float64Array(3);
  const tint =
    fs.warmth >= 0
      ? [mix(1, 1, fs.warmth), mix(1, 0.9, fs.warmth), mix(1, 0.72, fs.warmth)]
      : [mix(1, 0.9, -fs.warmth), mix(1, 0.96, -fs.warmth), mix(1, 1.08, -fs.warmth)];
  const apWs = g.apW * g.squeeze;
  const sizeX = g.srcAspect > apWs / g.apH ? g.apH * g.srcAspect : apWs;
  const sizeY = g.srcAspect > apWs / g.apH ? g.apH : apWs / g.srcAspect;
  const aimLog = tone.aim * 3.321928;

  const inPerf = (px: number, py: number): boolean => {
    const yy = py / pitch - pp.perfPhase;
    const j = Math.floor(yy * perFrame + 0.5) / perFrame;
    const dy = (yy - j) * pitch;
    if (sdRoundRect(px - pp.perfX[0], dy, pw * 0.5, ph * 0.5, pr) < 0) return true;
    if (sdRoundRect(px - pp.perfX[1], dy, pw * 0.5, ph * 0.5, pr) < 0) return true;
    return false;
  };

  const transmission = (px: number, py: number, F: Buf, o: Float64Array) => {
    const k = Math.floor(py / pitch + 0.5);
    const qy = py - k * pitch;
    const u = px / fW + 0.5;
    const v = qy / fH + 0.5;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
      sampleUV(F, u, v, t4);
      o[0] = Math.pow(2, -t4[0] * 3.321928);
      o[1] = Math.pow(2, -t4[1] * 3.321928);
      o[2] = Math.pow(2, -t4[2] * 3.321928);
      return;
    }
    if (px < pp.stripL || px > pp.stripR || inPerf(px, py)) {
      o[0] = o[1] = o[2] = 1;
      return;
    }
    o[0] = unexp[0];
    o[1] = unexp[1];
    o[2] = unexp[2];
  };

  // Hair segments, pre-scaled into the aspect-corrected window space.
  const hairPts: number[][] = [];
  for (let h = 0; h < MAX_HAIRS; h++) {
    const pts: number[] = [];
    for (let k = 0; k < HAIR_POINTS; k++) {
      pts.push(fs.hairs[(h * HAIR_POINTS + k) * 2] * aspect, fs.hairs[(h * HAIR_POINTS + k) * 2 + 1]);
    }
    hairPts.push(pts);
  }

  for (let y = 0; y < outH; y++) {
    const fy = y + 0.5;
    const rowFromTop = outH - 1 - y;
    const even = rowFromTop % 2 === 0;
    const second = fs.interlaced ? (fs.lowerFirst ? even : !even) : false;
    const field = second ? fs.fields[1] : fs.fields[0];
    const F = second ? t.F1 : t.F0;
    const imgRow = (outH - 1 - y) * outW;
    for (let x = 0; x < outW; x++) {
      const fx = x + 0.5;
      const snx = fx / outW - 0.5;
      const sny = fy / outH - 0.5;
      const o = (imgRow + x) * 4;

      if (snx + 0.5 < opts.splitX && t.src) {
        const mx = snx * g.visW;
        const my = sny * g.visH;
        sampleUV(t.src, (mx * g.squeeze) / sizeX + 0.5, my / sizeY + 0.5, t4);
        out[o] = clamp(t4[0], 0, 1) * 255;
        out[o + 1] = clamp(t4[1], 0, 1) * 255;
        out[o + 2] = clamp(t4[2], 0, 1) * 255;
        out[o + 3] = 255;
        continue;
      }

      let px = snx * g.visW;
      let py = sny * g.visH + fs.framingMm + field.spliceJump;
      px -= field.projWeave[0];
      py -= field.projWeave[1];
      const c = Math.cos(-field.projRot);
      const s = Math.sin(-field.projRot);
      const rx = c * px - s * py;
      const ry = s * px + c * py;
      const rr2 = (snx * snx * 4 * aspect * aspect + sny * sny * 4) / (aspect * aspect + 1);

      const radius = fs.focusMm + fs.buckleMm * (1 - 0.7 * rr2);
      if (radius > pp.fPixMm * 0.35) {
        transmission(rx, ry, F, T);
        T[0] *= 0.2;
        T[1] *= 0.2;
        T[2] *= 0.2;
        let ws = 0.2;
        for (let i = 0; i < 8; i++) {
          const r = Math.sqrt((i + 0.5) / 8);
          const th = i * 2.399963;
          transmission(rx + Math.cos(th) * r * radius, ry + Math.sin(th) * r * radius, F, S);
          T[0] += S[0];
          T[1] += S[1];
          T[2] += S[2];
          ws += 1;
        }
        T[0] /= ws;
        T[1] /= ws;
        T[2] /= ws;
      } else {
        transmission(rx, ry, F, T);
      }

      const lamp = field.lamp * Math.pow(2, -fs.hotspot * rr2) * (1 - opts.audioDim);

      // Gate grit.
      const wx = (fx / outW) * aspect;
      const wy = fy / outH;
      let block = 0;
      for (let h = 0; h < MAX_HAIRS; h++) {
        const hw = fs.hairWidth[h];
        if (hw <= 0) continue;
        const pts = hairPts[h];
        let dmin = 1e9;
        for (let k = 0; k < HAIR_POINTS - 1; k++) {
          const ax = pts[k * 2];
          const ay = pts[k * 2 + 1];
          const bx = pts[k * 2 + 2];
          const by = pts[k * 2 + 3];
          const pax = wx - ax;
          const pay = wy - ay;
          const bax = bx - ax;
          const bay = by - ay;
          const hh = clamp((pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-9), 0, 1);
          const ex = pax - bax * hh;
          const ey = pay - bay * hh;
          dmin = Math.min(dmin, Math.sqrt(ex * ex + ey * ey));
        }
        block = Math.max(block, 1 - smoothstep(hw * 0.5, hw * 1.3, dmin));
      }
      for (let k = 0; k < MAX_SPECKS; k++) {
        const sz = fs.specks[k * 4 + 2];
        if (sz <= 0) continue;
        const dx = wx - fs.specks[k * 4] * aspect;
        const dy = wy - fs.specks[k * 4 + 1];
        const dd = Math.sqrt(dx * dx + dy * dy);
        block = Math.max(block, fs.specks[k * 4 + 3] * (1 - smoothstep(sz * 0.55, sz, dd)));
      }
      const pass = 1 - 0.94 * block;

      let vr: number;
      let vg: number;
      let vb: number;
      const tr = T[0] * lamp * tint[0] * pass;
      const tg = T[1] * lamp * tint[1] * pass;
      const tb = T[2] * lamp * tint[2] * pass;
      if (raw) {
        vr = tr * 1.6;
        vg = tg * 1.6;
        vb = tb * 1.6;
      } else {
        vr = tone.tkGrey * Math.pow(2, tone.tkGamma * (Math.log2(Math.max(tr, 1e-7)) + aimLog));
        vg = tone.tkGrey * Math.pow(2, tone.tkGamma * (Math.log2(Math.max(tg, 1e-7)) + aimLog));
        vb = tone.tkGrey * Math.pow(2, tone.tkGamma * (Math.log2(Math.max(tb, 1e-7)) + aimLog));
        const fl = tone.tkFloor;
        vr = (vr - fl) / (1 - fl);
        vg = (vg - fl) / (1 - fl);
        vb = (vb - fl) / (1 - fl);
      }
      vr = tone.tkBlack + (1 - tone.tkBlack) * vr;
      vg = tone.tkBlack + (1 - tone.tkBlack) * vg;
      vb = tone.tkBlack + (1 - tone.tkBlack) * vb;
      const yy = 0.2126 * vr + 0.7152 * vg + 0.0722 * vb;
      vr = Math.max(yy + (vr - yy) * tone.tkSat, 0);
      vg = Math.max(yy + (vg - yy) * tone.tkSat, 0);
      vb = Math.max(yy + (vb - yy) * tone.tkSat, 0);

      let orr = linearToSrgb(vr);
      let og = linearToSrgb(vg);
      let ob = linearToSrgb(vb);
      if (opts.dither > 0) {
        const n = (ign(fx + (opts.frame % 64) * 5.588, fy + (opts.frame % 64) * 5.588) - 0.5) * opts.dither * (1.5 / 255);
        orr += n;
        og += n;
        ob += n;
      }
      out[o] = clamp(orr, 0, 1) * 255;
      out[o + 1] = clamp(og, 0, 1) * 255;
      out[o + 2] = clamp(ob, 0, 1) * 255;
      out[o + 3] = 255;
    }
  }
}
