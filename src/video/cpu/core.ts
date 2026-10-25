/**
 * CPU rendering core: buffers, fetching and the shared maths.
 *
 * A direct counterpart to common.glsl. Every function here exists to behave
 * the same way as its shader namesake, because the whole value of a CPU
 * backend is that it produces the same picture as the GPU one on a machine
 * that cannot run the GPU one.
 *
 * Images are interleaved RGBA Float32Array, top row first — the same
 * convention every shader uses (see common.glsl) — and are never reallocated
 * per frame.
 */

export const PI = Math.PI;
export const TAU = Math.PI * 2;

/** A mutable RGBA float image, top row first. */
export interface Buf {
  w: number;
  h: number;
  d: Float32Array;
}

export function makeBuf(w: number, h: number): Buf {
  const W = Math.max(1, w | 0);
  const H = Math.max(1, h | 0);
  return { w: W, h: H, d: new Float32Array(W * H * 4) };
}

export function ensureBuf(b: Buf | null, w: number, h: number): Buf {
  const W = Math.max(1, w | 0);
  const H = Math.max(1, h | 0);
  if (b && b.w === W && b.h === H) return b;
  return makeBuf(W, H);
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Index of a clamped texel, as texelFetch on a clamped coordinate. */
export function idx(b: Buf, x: number, y: number): number {
  const xi = x < 0 ? 0 : x >= b.w ? b.w - 1 : x;
  const yi = y < 0 ? 0 : y >= b.h ? b.h - 1 : y;
  return (yi * b.w + xi) * 4;
}

export function mirrorIndex(i: number, n: number): number {
  const p = 2 * n;
  const k = i - p * Math.floor(i / p);
  return k < n ? k : p - 1 - k;
}

/** Bilinear at a texel-space position, clamped; writes 4 channels into out. */
export function bilinear(b: Buf, px: number, py: number, out: Float32Array): void {
  const qx = px - 0.5;
  const qy = py - 0.5;
  const x0 = Math.floor(qx);
  const y0 = Math.floor(qy);
  const fx = qx - x0;
  const fy = qy - y0;
  const d = b.d;
  const a = idx(b, x0, y0);
  const bb = idx(b, x0 + 1, y0);
  const c = idx(b, x0, y0 + 1);
  const e = idx(b, x0 + 1, y0 + 1);
  for (let k = 0; k < 4; k++) {
    const top = d[a + k] + (d[bb + k] - d[a + k]) * fx;
    const bot = d[c + k] + (d[e + k] - d[c + k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
}

/** Bilinear with mirrored repeat. */
export function bilinearMirror(b: Buf, px: number, py: number, out: Float32Array): void {
  const qx = px - 0.5;
  const qy = py - 0.5;
  const fx0 = Math.floor(qx);
  const fy0 = Math.floor(qy);
  const fx = qx - fx0;
  const fy = qy - fy0;
  const x0 = mirrorIndex(fx0, b.w);
  const x1 = mirrorIndex(fx0 + 1, b.w);
  const y0 = mirrorIndex(fy0, b.h);
  const y1 = mirrorIndex(fy0 + 1, b.h);
  const d = b.d;
  const a = (y0 * b.w + x0) * 4;
  const bb = (y0 * b.w + x1) * 4;
  const c = (y1 * b.w + x0) * 4;
  const e = (y1 * b.w + x1) * 4;
  for (let k = 0; k < 3; k++) {
    const top = d[a + k] + (d[bb + k] - d[a + k]) * fx;
    const bot = d[c + k] + (d[e + k] - d[c + k]) * fx;
    out[k] = top + (bot - top) * fy;
  }
}

/* ------------------------------------------------------------------ *
 * Hashing — uhash() in common.glsl, bit for bit
 * ------------------------------------------------------------------ */

export function uhash(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x1b873593, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function ihash(a: number, b: number, c: number): number {
  return (uhash(a, b, c) >>> 8) / 16777216;
}

export function gaussHash(a: number, b: number, c: number): number {
  const u1 = Math.max(ihash(a, b, c), 1 / 16777216);
  const u2 = ihash(a, b, c + 7919);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2);
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const LUT_N = 4096;
const SRGB_LUT = new Float64Array(LUT_N + 2);
for (let i = 0; i <= LUT_N + 1; i++) SRGB_LUT[i] = srgbToLinear(Math.min(i / LUT_N, 1.0001));

/**
 * sRGB decode by table, interpolated: within 1e-6 of the formula across
 * 0..1, and several times faster where it runs a dozen times a pixel.
 */
export function srgbToLinearFast(c: number): number {
  if (c <= 0) return c / 12.92;
  if (c >= 1) return srgbToLinear(c);
  const x = c * LUT_N;
  const i = x | 0;
  const f = x - i;
  return SRGB_LUT[i] + (SRGB_LUT[i + 1] - SRGB_LUT[i]) * f;
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function luma601(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** BT.601 R′G′B′ to Y′CbCr, into out[0..2]. */
export function rgbToYcc(r: number, g: number, b: number, out: Float32Array, o = 0): void {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  out[o] = y;
  out[o + 1] = (b - y) / 1.772;
  out[o + 2] = (r - y) / 1.402;
}

export function yccToRgb(y: number, cb: number, cr: number, out: Float32Array, o = 0): void {
  out[o] = y + 1.402 * cr;
  out[o + 1] = y - 0.344136 * cb - 0.714136 * cr;
  out[o + 2] = y + 1.772 * cb;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}
