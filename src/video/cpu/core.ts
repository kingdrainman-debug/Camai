/**
 * CPU rendering core: buffers, sampling and the shared maths.
 *
 * This is a direct counterpart to common.glsl. Every function here exists to
 * behave the same way as its shader namesake, because the whole value of a CPU
 * backend is that it produces the same picture as the GPU one on a machine that
 * cannot run the GPU one.
 *
 * Images are planar-interleaved Float32Array in RGBA order, linear in the same
 * space the shaders work in, and are never reallocated per frame. The pipeline
 * is entirely fill-rate bound, so the two things that matter for speed are
 * avoiding allocation and avoiding bounds checks in the inner loops — hence the
 * slightly blunt style below.
 */

export const TAU = Math.PI * 2;

/** A mutable RGBA float image. */
export interface Buf {
  w: number;
  h: number;
  d: Float32Array;
}

export function makeBuf(w: number, h: number): Buf {
  return { w: Math.max(1, w | 0), h: Math.max(1, h | 0), d: new Float32Array(Math.max(1, w | 0) * Math.max(1, h | 0) * 4) };
}

export function ensureBuf(b: Buf | null, w: number, h: number): Buf {
  const W = Math.max(1, w | 0);
  const H = Math.max(1, h | 0);
  if (b && b.w === W && b.h === H) return b;
  return makeBuf(W, H);
}

export function clearBuf(b: Buf): void {
  b.d.fill(0);
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

export const fract = (x: number): number => x - Math.floor(x);

/* ------------------------------------------------------------------ *
 * Sampling
 *
 * Clamped at the edges, matching the shaders' clamp-to-edge textures. The
 * fast path reads a texel directly; the bilinear path is used wherever the
 * shader reads at a non-integer coordinate.
 * ------------------------------------------------------------------ */

/** Nearest texel, clamped. Writes r,g,b into `out`. */
export function texel(b: Buf, x: number, y: number, out: Float32Array): void {
  const xi = x < 0 ? 0 : x >= b.w ? b.w - 1 : x | 0;
  const yi = y < 0 ? 0 : y >= b.h ? b.h - 1 : y | 0;
  const i = (yi * b.w + xi) * 4;
  out[0] = b.d[i];
  out[1] = b.d[i + 1];
  out[2] = b.d[i + 2];
  out[3] = b.d[i + 3];
}

/** Bilinear sample in normalised uv, clamped. */
export function sampleUV(b: Buf, u: number, v: number, out: Float32Array): void {
  const x = clamp(u, 0, 1) * b.w - 0.5;
  const y = clamp(v, 0, 1) * b.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const cx0 = x0 < 0 ? 0 : x0 >= b.w ? b.w - 1 : x0;
  const cx1 = x1 < 0 ? 0 : x1 >= b.w ? b.w - 1 : x1;
  const cy0 = y0 < 0 ? 0 : y0 >= b.h ? b.h - 1 : y0;
  const cy1 = y1 < 0 ? 0 : y1 >= b.h ? b.h - 1 : y1;

  const i00 = (cy0 * b.w + cx0) * 4;
  const i10 = (cy0 * b.w + cx1) * 4;
  const i01 = (cy1 * b.w + cx0) * 4;
  const i11 = (cy1 * b.w + cx1) * 4;
  const d = b.d;

  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
    const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
    out[c] = top + (bot - top) * fy;
  }
}

/** Single-channel bilinear, for the places a shader reads one component. */
export function sampleUVc(b: Buf, u: number, v: number, c: number): number {
  const x = clamp(u, 0, 1) * b.w - 0.5;
  const y = clamp(v, 0, 1) * b.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = x0 < 0 ? 0 : x0 >= b.w ? b.w - 1 : x0;
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= b.w ? b.w - 1 : x0 + 1;
  const cy0 = y0 < 0 ? 0 : y0 >= b.h ? b.h - 1 : y0;
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= b.h ? b.h - 1 : y0 + 1;
  const d = b.d;
  const a = d[(cy0 * b.w + cx0) * 4 + c];
  const bb = d[(cy0 * b.w + cx1) * 4 + c];
  const cc = d[(cy1 * b.w + cx0) * 4 + c];
  const dd = d[(cy1 * b.w + cx1) * 4 + c];
  const top = a + (bb - a) * fx;
  const bot = cc + (dd - cc) * fx;
  return top + (bot - top) * fy;
}

/* ------------------------------------------------------------------ *
 * Hashing and noise — mirrors of common.glsl
 * ------------------------------------------------------------------ */

export function hash11(p: number): number {
  let x = fract(p * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

export function hash12(px: number, py: number): number {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.1031);
  let z = fract(px * 0.1031);
  const dot = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += dot;
  y += dot;
  z += dot;
  return fract((x + y) * z);
}

/** Three independent values from a 2D point, as hash32 does. */
export function hash32(px: number, py: number, out: Float32Array): void {
  let x = fract(px * 0.1031);
  let y = fract(py * 0.103);
  let z = fract(px * 0.0973);
  const dot = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += dot;
  y += dot;
  z += dot;
  out[0] = fract((x + y) * z);
  out[1] = fract((x + z) * y);
  out[2] = fract((y + z) * x);
}

export function vnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy);
  const b = hash12(ix + 1, iy);
  const c = hash12(ix, iy + 1);
  const d = hash12(ix + 1, iy + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

export function fbm(px: number, py: number): number {
  let v = 0;
  let amp = 0.5;
  let x = px;
  let y = py;
  for (let i = 0; i < 4; i++) {
    v += amp * vnoise(x, y);
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return v;
}

export function gauss(x: number, sigma: number): number {
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

/** Interleaved gradient noise, for dithering. */
export function ign(x: number, y: number): number {
  return fract(52.9829189 * fract(x * 0.06711056 + y * 0.00583715));
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

export function rgb2y(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export function rgb2i(r: number, g: number, b: number): number {
  return 0.5959 * r - 0.2746 * g - 0.3213 * b;
}
export function rgb2q(r: number, g: number, b: number): number {
  return 0.2115 * r - 0.5227 * g + 0.3112 * b;
}

export function yiq2rgb(y: number, i: number, q: number, out: Float32Array): void {
  out[0] = y + 0.956 * i + 0.619 * q;
  out[1] = y - 0.272 * i - 0.647 * q;
  out[2] = y - 1.106 * i + 1.703 * q;
}

export const luma = (r: number, g: number, b: number): number => rgb2y(r, g, b);

export function safePow(v: number, g: number): number {
  return Math.pow(v < 0 ? 0 : v, g);
}

export function remap(v: number, a: number, b: number): number {
  return clamp((v - a) / Math.max(b - a, 1e-5), 0, 1);
}
