/**
 * The DV codec and the tape on the CPU: chroma, fdct, blockinfo, cost, qno,
 * dequant, idct and assemble. The shaders compute one coefficient per texel;
 * here a block is transformed at once, separably, which is the same
 * arithmetic in a different order.
 */

import type { FramePlan } from '../../cam/plan';
import { DV_CLASS_BOUNDS, DV_QSCALE } from '../../cam/plan';
import { DvLayout, blockPixel, chromaOwner, lumaOwner } from '../../cam/dvlayout';
import { Buf, bilinear, ihash } from './core';

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
];
const ZZ_INDEX = new Int32Array(64);
ZIGZAG.forEach((p, k) => (ZZ_INDEX[p] = k));

const SHIFTS = [
  3, 3, 4, 4, 3, 3, 4, 4, 2, 3, 3, 4, 2, 3, 3, 4,
  2, 2, 3, 3, 2, 2, 3, 3, 1, 2, 2, 3, 1, 2, 2, 3,
  1, 1, 2, 2, 1, 1, 2, 2, 0, 1, 1, 2, 0, 1, 1, 2,
  0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const CLASS_OFFSET = [6, 3, 0, 1];

const clamp8 = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

const areaOf = (k: number): number => (k < 6 ? 0 : k < 21 ? 1 : k < 43 ? 2 : 3);

export function stepFor(q: number, cls: number, area: number): number {
  const s = SHIFTS[Math.min(q + CLASS_OFFSET[cls], 21) * 4 + area] + (cls === 3 ? 1 : 0);
  return Math.pow(2, s) * DV_QSCALE;
}

const DV_W = [1.0, 0.9807, 0.9239, 0.9, 0.875, 0.8504, 0.7654, 0.721];
export const dvWeight = (u: number, v: number): number => Math.fround(DV_W[u]) * Math.fround(DV_W[v]);

export const quantLevel = (c: number, step: number): number => Math.floor(Math.abs(c) / step + 0.35);

export function vlcBits(run: number, amp: number): number {
  const a = amp < 23 ? 2 + 1.7 * Math.log2(amp) : 16;
  const r = run < 0.5 ? 0 : run < 62 ? 1.6 + 1.5 * Math.log2(run) : 13;
  return Math.min(a + r, 24) + 1;
}

const CUTS = [48, 36, 28, 21, 15, 10, 6, 3];
/** Quantiser and scan cut-off of a cost-table row, as costRow() in codec.glsl. */
const costRow = (row: number): [number, number] => (row < 16 ? [row, 64] : [0, CUTS[row - 16]]);

const SQ = Math.SQRT1_2;
const cu = (k: number) => (k === 0 ? SQ : 1);
// cos((2i+1) u π / 16) and cos((2k+1) v π / 8)
const C8 = new Float64Array(64);
const C4 = new Float64Array(16);
for (let u = 0; u < 8; u++) for (let i = 0; i < 8; i++) C8[u * 8 + i] = Math.cos(((2 * i + 1) * u * Math.PI) / 16);
for (let v = 0; v < 4; v++) for (let k = 0; k < 4; k++) C4[v * 4 + k] = Math.cos(((2 * k + 1) * v * Math.PI) / 8);

/** Coefficient store: a value and a mode per texel of the coefW × coefH tiling. */
export interface Coefs {
  v: Float32Array;
  mode: Uint8Array;
  /** Per block: class and max AC. */
  cls: Uint8Array;
  maxAc: Float32Array;
}

export function makeCoefs(L: DvLayout): Coefs {
  const n = L.coefW * L.coefH;
  const nb = (L.coefW / 8) * (L.coefH / 8);
  return { v: new Float32Array(n), mode: new Uint8Array(n), cls: new Uint8Array(nb), maxAc: new Float32Array(nb) };
}

export const coefAddr = (m: number, b: number, u: number, v: number): number =>
  ((Math.floor(m / 30) * 8 + v) * 30 * 48 + (m % 30) * 48 + b * 8 + u);
const blockAddr = (m: number, b: number): number => Math.floor(m / 30) * 180 + (m % 30) * 6 + b;

/* ---- chroma.frag ---- */
export function chromaPass(pre: Buf, L: DvLayout, out: Buf): void {
  const n = L.cx * L.cy;
  for (let y = 0; y < L.CH; y++) {
    for (let x = 0; x < L.CW; x++) {
      let cb = 0;
      let cr = 0;
      for (let j = 0; j < L.cy; j++) {
        for (let i = 0; i < L.cx; i++) {
          const o = ((y * L.cy + j) * pre.w + x * L.cx + i) * 4;
          cb += pre.d[o + 1];
          cr += pre.d[o + 2];
        }
      }
      const o = (y * L.CW + x) * 4;
      out.d[o] = cb / n;
      out.d[o + 1] = cr / n;
      out.d[o + 2] = 0;
      out.d[o + 3] = 1;
    }
  }
}

/* ---- fdct.frag + blockinfo.frag ---- */
export function fdctPass(pre: Buf, chroma: Buf, L: DvLayout, dct248: number, classes: number, C: Coefs): void {
  const x = new Float64Array(64);
  const t = new Float64Array(64);
  const [b0, b1, b2] = DV_CLASS_BOUNDS;
  for (let m = 0; m < L.nMB; m++) {
    for (let b = 0; b < 6; b++) {
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const [plane, px, py] = blockPixel(L, m, b, i, j);
          if (plane === 0) x[j * 8 + i] = clamp8(Math.floor(pre.d[(py * pre.w + px) * 4] * 219 + 16.5), 1, 254) - 128;
          else x[j * 8 + i] = clamp8(Math.floor(chroma.d[(py * chroma.w + px) * 4 + (b === 4 ? 0 : 1)] * 224 + 128.5), 1, 254) - 128;
        }
      }
      let mode = 0;
      if (dct248 === 1) {
        let adj = 0;
        let two = 0;
        for (let j = 0; j < 7; j++) for (let i = 0; i < 8; i++) adj += Math.abs(x[j * 8 + i] - x[(j + 1) * 8 + i]);
        for (let j = 0; j < 6; j++) for (let i = 0; i < 8; i++) two += Math.abs(x[j * 8 + i] - x[(j + 2) * 8 + i]);
        adj /= 56;
        two /= 48;
        if (adj > two * 1.5 + 3) mode = 1;
      }
      // Rows first: t[j][u] = Σ_i x[j][i] C8[u][i]
      for (let j = 0; j < 8; j++) {
        for (let u = 0; u < 8; u++) {
          let a = 0;
          for (let i = 0; i < 8; i++) a += x[j * 8 + i] * C8[u * 8 + i];
          t[j * 8 + u] = a;
        }
      }
      let mx = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          let a = 0;
          if (mode === 0) {
            for (let j = 0; j < 8; j++) a += t[j * 8 + u] * C8[v * 8 + j];
            a *= 0.25 * cu(u) * cu(v);
          } else {
            const vv = v & 3;
            const sg = v < 4 ? 1 : -1;
            for (let k = 0; k < 4; k++) a += (t[2 * k * 8 + u] + sg * t[(2 * k + 1) * 8 + u]) * C4[vv * 4 + k];
            a *= 0.5 * cu(u) * (vv === 0 ? 0.5 : SQ) * SQ;
          }
          const addr = coefAddr(m, b, u, v);
          C.v[addr] = a;
          C.mode[addr] = mode;
          if (u !== 0 || v !== 0) mx = Math.max(mx, Math.abs(Math.fround(a)));
        }
      }
      const ba = blockAddr(m, b);
      C.maxAc[ba] = mx;
      C.cls[ba] = classes === 1 ? (mx <= b0 ? 0 : mx <= b1 ? 1 : mx <= b2 ? 2 : 3) : 1;
    }
  }
}

/* ---- cost.frag + qno.frag + dequant.frag ---- */
export function quantisePass(L: DvLayout, C: Coefs, plan: FramePlan, qnoOut: Float32Array, cutOut: Float32Array, deq: Float32Array): void {
  const cost = new Float64Array(L.nMB * 24);
  for (let m = 0; m < L.nMB; m++) {
    for (let row = 0; row < 24; row++) {
      const [q, cut] = costRow(row);
      let bits = 0;
      for (let b = 0; b < 6; b++) {
        const cls = C.cls[blockAddr(m, b)];
        let run = 0;
        for (let k = 1; k < cut; k++) {
          const z = ZIGZAG[k];
          const c = C.v[coefAddr(m, b, z & 7, z >> 3)] * dvWeight(z & 7, z >> 3);
          const lv = quantLevel(c, stepFor(q, cls, areaOf(k)));
          if (lv > 0) {
            bits += vlcBits(run, lv);
            run = 0;
          } else run += 1;
        }
        bits += 4;
      }
      cost[m * 24 + row] = Math.fround(bits);
    }
  }
  const segMBs = plan.codec.shuffle ? L.segMBs : L.segMBsPlain;
  const segOf = plan.codec.shuffle ? L.segOfMB : L.segOfMBPlain;
  for (let s = 0; s < L.nSeg; s++) {
    let chosen = 0;
    let cut = 3;
    for (let i = 0; i < 24; i++) {
      const row = i < 16 ? 15 - i : i;
      let total = 0;
      for (let j = 0; j < 5; j++) total += cost[segMBs[s * 5 + j] * 24 + row];
      if (total <= plan.codec.budget) {
        [chosen, cut] = costRow(row);
        break;
      }
    }
    qnoOut[s] = chosen;
    cutOut[s] = cut;
  }
  for (let m = 0; m < L.nMB; m++) {
    const q = qnoOut[segOf[m]];
    const cut = cutOut[segOf[m]];
    for (let b = 0; b < 6; b++) {
      const cls = C.cls[blockAddr(m, b)];
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          const a = coefAddr(m, b, u, v);
          const c = C.v[a];
          if (u === 0 && v === 0) {
            deq[a] = Math.floor(c / 2 + 0.5) * 2;
          } else {
            const k = ZZ_INDEX[u + 8 * v];
            const st = stepFor(q, cls, areaOf(k));
            const w = dvWeight(u, v);
            deq[a] = k < cut ? (Math.sign(c) * quantLevel(c * w, st) * st) / w : 0;
          }
        }
      }
    }
  }
}

/* ---- idct.frag ---- */
export function idctPass(L: DvLayout, deq: Float32Array, mode: Uint8Array, Y: Buf, Cp: Buf): void {
  const t = new Float64Array(64);
  const blk = new Float64Array(64);
  const inverse = (m: number, b: number) => {
    const md = mode[coefAddr(m, b, 0, 0)];
    if (md === 0) {
      // Columns first: t[j][u] = Σ_v c(u,v) cu(v) C8[v][j]
      for (let u = 0; u < 8; u++) {
        for (let j = 0; j < 8; j++) {
          let a = 0;
          for (let v = 0; v < 8; v++) a += deq[coefAddr(m, b, u, v)] * cu(v) * C8[v * 8 + j];
          t[j * 8 + u] = a;
        }
      }
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          let a = 0;
          for (let u = 0; u < 8; u++) a += t[j * 8 + u] * cu(u) * C8[u * 8 + i];
          blk[j * 8 + i] = a * 0.25;
        }
      }
      return;
    }
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < 8; i++) {
        let sum = 0;
        let dif = 0;
        for (let vv = 0; vv < 4; vv++) {
          const cv = (vv === 0 ? 0.5 : SQ) * C4[vv * 4 + k];
          for (let u = 0; u < 8; u++) {
            const bu = cu(u) * C8[u * 8 + i] * 0.5;
            sum += deq[coefAddr(m, b, u, vv)] * bu * cv;
            dif += deq[coefAddr(m, b, u, vv + 4)] * bu * cv;
          }
        }
        blk[2 * k * 8 + i] = (sum + dif) * SQ;
        blk[(2 * k + 1) * 8 + i] = (sum - dif) * SQ;
      }
    }
  };
  for (let m = 0; m < L.nMB; m++) {
    for (let b = 0; b < 6; b++) {
      inverse(m, b);
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const [plane, px, py] = blockPixel(L, m, b, i, j);
          const v = blk[j * 8 + i];
          if (plane === 0) {
            const o = (py * Y.w + px) * 4;
            Y.d[o] = (clamp8(Math.floor(v + 128.5), 0, 255) - 16) / 219;
            Y.d[o + 1] = 0;
            Y.d[o + 2] = 0;
            Y.d[o + 3] = 1;
          } else {
            const o = (py * Cp.w + px) * 4;
            Cp.d[o + (b === 4 ? 0 : 1)] = (clamp8(Math.floor(v + 128.5), 0, 255) - 128) / 224;
            Cp.d[o + 2] = 0;
            Cp.d[o + 3] = 1;
          }
        }
      }
    }
  }
}

/* ---- assemble.frag ---- */
const GREEN = [-16 / 219, -128 / 224, -128 / 224];

export function assemblePass(
  plan: FramePlan,
  L: DvLayout,
  Ysrc: Buf,
  Csrc: Buf,
  planes: boolean,
  prev: Buf | null,
  dst: Buf,
): void {
  const W = L.W;
  const H = L.H;
  const tp = plan.tape;
  const c = plan.codec;
  const out = dst.d;
  const tmp = new Float32Array(4);
  const chromaAt = (x: number, y: number): [number, number] => {
    if (c.linear === 0) {
      const o = (Math.floor(y / L.cy) * Csrc.w + Math.floor(x / L.cx)) * 4;
      return [Csrc.d[o], Csrc.d[o + 1]];
    }
    bilinear(Csrc, (x + 0.5) / L.cx, (y + 0.5) / L.cy, tmp);
    return [tmp[0], tmp[1]];
  };
  const n = plan.fs.n;
  const seed = plan.fs.seed;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (tp.dead === 1) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = 1;
        continue;
      }
      const m = lumaOwner(L, x, y)[0];
      let Y: number;
      let Cb: number;
      let Cr: number;
      if (tp.clog >= 0) {
        const bx = x >> 4;
        const by = y >> 4;
        const h = ihash(bx + 97 * by, n, seed + 31);
        let qx = bx * 16 + 8;
        let qy = by * 16 + 8;
        if (h < 0.35) {
          qx += Math.trunc(ihash(bx, by, n + 7) * 64) - 32;
          qy += Math.trunc(ihash(by, bx, n + 11) * 32) - 16;
        }
        if (prev && h < 0.85) {
          const p = (Math.min(Math.max(qy, 0), H - 1) * W + Math.min(Math.max(qx, 0), W - 1)) * 4;
          Y = prev.d[p];
          Cb = prev.d[p + 1];
          Cr = prev.d[p + 2];
        } else if (h < 0.93) {
          Y = 0.5;
          Cb = 0;
          Cr = 0;
        } else {
          [Y, Cb, Cr] = GREEN;
        }
      } else if (tp.garbage === 1 && ihash(m, n, seed + 53) < 0.6) {
        if (ihash(m, n, seed + 59) < 0.5) {
          Y = 0.5;
          Cb = 0;
          Cr = 0;
        } else [Y, Cb, Cr] = GREEN;
      } else if (tp.lost && tp.lost[m]) {
        if (tp.conceal === 0 && prev) {
          Y = prev.d[o];
          Cb = prev.d[o + 1];
          Cr = prev.d[o + 2];
        } else if (tp.conceal === 2) [Y, Cb, Cr] = GREEN;
        else {
          Y = 0.5;
          Cb = 0;
          Cr = 0;
        }
      } else if (planes) {
        Y = Ysrc.d[o];
        [Cb, Cr] = chromaAt(x, y);
      } else {
        Y = Ysrc.d[o];
        Cb = Ysrc.d[o + 1];
        Cr = Ysrc.d[o + 2];
        if (c.subsample) [Cb, Cr] = chromaAt(x, y);
      }
      out[o] = Y;
      out[o + 1] = Cb;
      out[o + 2] = Cr;
      out[o + 3] = 1;
    }
  }
}

export { chromaOwner };
