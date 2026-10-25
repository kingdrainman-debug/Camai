/**
 * The display passes on the CPU: post (overlays after decode and the
 * capture), the web upload and the present. Mirrors of post, updown, upfdct,
 * upidct and present.frag.glsl.
 */

import type { FramePlan } from '../../cam/plan';
import type { OsdImage } from '../../cam/osd';
import { Buf, bilinear, clamp, gaussHash, idx, ihash, rgbToYcc, yccToRgb } from './core';

/* ---- post.frag ---- */
export function postPass(plan: FramePlan, dec: Buf, osd: [OsdImage | null, OsdImage | null], dst: Buf): void {
  const W = dec.w;
  const H = dec.h;
  const p = plan.post;
  const n = plan.fs.n;
  const seed = plan.fs.seed;
  const decFlags = [plan.osdPath[0] === 1 && !!osd[0], plan.osdPath[1] === 1 && !!osd[1]];
  const oc = new Float32Array(3);
  const s3 = new Float32Array(3);
  const sig = (x: number, y: number, out: Float32Array): void => {
    const o = idx(dec, x, y);
    out[0] = dec.d[o];
    out[1] = dec.d[o + 1];
    out[2] = dec.d[o + 2];
    for (let l = 0; l < 2; l++) {
      const img = osd[l];
      if (!decFlags[l] || !img) continue;
      const ox = clamp(x >> 1, 0, img.width - 1);
      const oy = clamp(y >> 1, 0, img.height - 1);
      const k = (oy * img.width + ox) * 4;
      rgbToYcc(img.data[k] / 255, img.data[k + 1] / 255, img.data[k + 2] / 255, oc);
      const a = img.data[k + 3] / 255;
      for (let c = 0; c < 3; c++) out[c] += (oc[c] - out[c]) * a;
    }
  };
  const pal = p.pal === 1;
  const phaseAt = (x: number, y: number): number => {
    const fl = y >> 1;
    const pp = y & 1;
    if (pal) return x * 2.0635449 + fl * 4.712389 + pp * 1.5707963 + n * 1.5707963;
    return x * 1.6660082 + fl * Math.PI + pp * 1.5707963 + n * Math.PI;
  };
  const vSwitch = (y: number): number => (pal && (((y >> 1) + (y & 1)) & 1) === 1 ? -1 : 1);
  const noiseAt = (x: number, y: number, ch: number): number =>
    p.noise > 0 ? p.noise * gaussHash(x + 1024 * y, n * 3 + ch, seed + 211) : 0;
  const comp = (x: number, y: number): number => {
    sig(x, y, s3);
    const ph = phaseAt(x, y);
    return s3[0] + s3[1] * Math.sin(ph) + s3[2] * vSwitch(y) * Math.cos(ph) + noiseAt(x, y, 0);
  };
  const ySep = (x: number, y: number): number => {
    if (p.comb === 3) return 0.5 * comp(x, y) + 0.25 * (comp(x, y - 2) + comp(x, y + 2));
    if (pal) {
      const e = 0.523;
      return (comp(x - 1, y) + comp(x, y) + comp(x + 1, y) + e * (comp(x - 2, y) + comp(x + 2, y))) / (3 + 2 * e);
    }
    const w = 0.385;
    return (w * comp(x - 2, y) + comp(x - 1, y) + comp(x, y) + comp(x + 1, y) + w * comp(x + 2, y)) / (3 + 2 * w);
  };
  const out = dst.d;
  const RY = Math.min(Math.ceil(3 * p.sigY), 8);
  const RC = Math.min(Math.ceil(3 * p.sigC), 12);
  const wy = new Float64Array(17);
  const wc = new Float64Array(25);
  for (let t = -8; t <= 8; t++) wy[t + 8] = p.sigY > 0.05 ? Math.exp(-(t * t) / (2 * p.sigY * p.sigY)) : t === 0 ? 1 : 0;
  for (let t = -12; t <= 12; t++) wc[t + 12] = p.sigC > 0.05 ? Math.exp(-(t * t) / (2 * p.sigC * p.sigC)) : t === 0 ? 1 : 0;
  const delay = Math.floor(p.delay + 0.5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      let Y: number;
      let Cb: number;
      let Cr: number;
      if (p.path === 0) {
        sig(x, y, s3);
        Y = s3[0];
        Cb = s3[1];
        Cr = s3[2];
      } else {
        let ys = 0;
        let ws = 0;
        for (let t = -RY; t <= RY; t++) {
          const w = wy[t + 8];
          let v: number;
          if (p.path === 2) v = ySep(x + t, y);
          else {
            sig(x + t, y, s3);
            v = s3[0] + noiseAt(x + t, y, 0);
          }
          ys += v * w;
          ws += w;
        }
        Y = ys / ws;
        let cb = 0;
        let cr = 0;
        let wsum = 0;
        const xc = x - delay;
        for (let t = -RC; t <= RC; t++) {
          const w = wc[t + 12];
          const xx = xc + t;
          let vb: number;
          let vr: number;
          if (p.path === 2) {
            const ch = comp(xx, y) - ySep(xx, y);
            const ph = phaseAt(xx, y);
            vb = 2 * ch * Math.sin(ph);
            vr = 2 * ch * Math.cos(ph) * vSwitch(y);
          } else {
            sig(xx, y, s3);
            vb = s3[1] + noiseAt(xx, y, 1) * 0.5;
            vr = s3[2] + noiseAt(xx, y, 2) * 0.5;
          }
          cb += vb * w;
          cr += vr * w;
          wsum += w;
        }
        Cb = cb / wsum;
        Cr = cr / wsum;
      }
      if (p.levels === 1) {
        Y = (Y * 219 + 16) / 255;
        Cb *= 224 / 255;
        Cr *= 224 / 255;
      }
      out[o] = Y;
      out[o + 1] = Cb;
      out[o + 2] = Cr;
      out[o + 3] = 1;
    }
  }
}

/* ---- updown, upfdct, upidct ---- */
export function uploadPass(plan: FramePlan, cap: Buf, up: Buf, coef: Buf, dst: Buf): void {
  const u = plan.upload;
  const [mx, my, mw, mh] = plan.present.map;
  for (let py = 0; py < u.H; py++) {
    for (let px = 0; px < u.W; px++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const sx = mx + ((px + (i + 0.5) / 4) / u.W) * mw;
          const sy = my + ((py + (j + 0.5) / 4) / u.H) * mh;
          const k = Math.floor((sy - u.par - 0.5) * 0.5 + 0.5);
          let row = clamp(2 * k + u.par, 0, cap.h - 1);
          if ((row & 1) !== u.par) row += row + 1 < cap.h ? 1 : -1;
          const o = idx(cap, Math.floor(sx), row);
          a += cap.d[o];
          b += cap.d[o + 1];
          c += cap.d[o + 2];
        }
      }
      const o = (py * u.W + px) * 4;
      up.d[o] = a / 16;
      up.d[o + 1] = b / 16;
      up.d[o + 2] = c / 16;
      up.d[o + 3] = 1;
    }
  }
  const cu = (k: number) => (k === 0 ? Math.SQRT1_2 : 1);
  const C8 = new Float64Array(64);
  for (let f = 0; f < 8; f++) for (let i = 0; i < 8; i++) C8[f * 8 + i] = Math.cos(((2 * i + 1) * f * Math.PI) / 16);
  const scale = [219, 224, 224];
  const off = [16 - 128, 0, 0];
  for (let by = 0; by < u.H; by += 8) {
    for (let bx = 0; bx < u.W; bx += 8) {
      for (let v = 0; v < 8; v++) {
        for (let uu = 0; uu < 8; uu++) {
          const acc = [0, 0, 0];
          for (let j = 0; j < 8; j++) {
            const cv = C8[v * 8 + j];
            for (let i = 0; i < 8; i++) {
              const o = idx(up, bx + i, by + j);
              const w = C8[uu * 8 + i] * cv;
              for (let ch = 0; ch < 3; ch++) acc[ch] += (up.d[o + ch] * scale[ch] + off[ch]) * w;
            }
          }
          const o = ((by + v) * u.W + bx + uu) * 4;
          const k = 0.25 * cu(uu) * cu(v);
          for (let ch = 0; ch < 3; ch++) coef.d[o + ch] = acc[ch] * k;
          coef.d[o + 3] = 1;
        }
      }
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
          const acc = [0, 0, 0];
          for (let v = 0; v < 8; v++) {
            const cv = cu(v) * C8[v * 8 + j];
            for (let uu = 0; uu < 8; uu++) {
              const o = ((by + v) * u.W + bx + uu) * 4;
              const w = 1 + 0.25 * (uu + v);
              const bu = cu(uu) * C8[uu * 8 + i];
              for (let ch = 0; ch < 3; ch++) {
                const c = coef.d[o + ch];
                const st = uu === 0 && v === 0 ? 8 : (ch === 0 ? 2 : 3) * u.q * w;
                const rec = Math.sign(c) * Math.floor(Math.abs(c) / st + 0.5) * st;
                acc[ch] += rec * bu * cv;
              }
            }
          }
          const o = ((by + j) * u.W + bx + i) * 4;
          dst.d[o] = (acc[0] * 0.25 + 128 - 16) / 219;
          dst.d[o + 1] = (acc[1] * 0.25) / 224;
          dst.d[o + 2] = (acc[2] * 0.25) / 224;
          dst.d[o + 3] = 1;
        }
      }
    }
  }
}

/* ---- present.frag ---- */
export interface PresentOpts {
  img: Buf;
  map: [number, number, number, number];
  deint: number;
  split: number;
  src: Buf | null;
  frame: number;
}

export function presentPass(plan: FramePlan, o: PresentOpts, osd: [OsdImage | null, OsdImage | null], out: Uint8ClampedArray, outW: number, outH: number): void {
  const img = o.img;
  const pr = plan.present;
  const field = pr.field;
  const deint = o.deint;
  const fieldLines = deint === 1 || deint === 3;
  const scaler = pr.scaler;
  const lineFetch = (x: number, l: number, c: number): number => {
    const row = fieldLines ? 2 * clamp(l, 0, (img.h >> 1) - 1) + field : clamp(l, 0, img.h - 1);
    return img.d[(clamp(row, 0, img.h - 1) * img.w + clamp(x, 0, img.w - 1)) * 4 + c];
  };
  const cubicW = (t: number): number => {
    t = Math.abs(t);
    if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
    if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
    return 0;
  };
  const res = new Float64Array(3);
  const sampleLines = (x: number, l: number, acc: Float64Array, k: number): void => {
    if (scaler === 0) {
      const xi = Math.floor(x);
      const li = Math.floor(l);
      for (let c = 0; c < 3; c++) acc[c] += k * lineFetch(xi, li, c);
      return;
    }
    const qx = x - 0.5;
    const ql = l - 0.5;
    const x0 = Math.floor(qx);
    const l0 = Math.floor(ql);
    const fx = qx - x0;
    const fl = ql - l0;
    if (scaler === 1) {
      for (let c = 0; c < 3; c++) {
        const a = lineFetch(x0, l0, c);
        const b = lineFetch(x0 + 1, l0, c);
        const cc = lineFetch(x0, l0 + 1, c);
        const d = lineFetch(x0 + 1, l0 + 1, c);
        const top = a + (b - a) * fx;
        const bot = cc + (d - cc) * fx;
        acc[c] += k * (top + (bot - top) * fl);
      }
      return;
    }
    for (let j = -1; j <= 2; j++) {
      const wy = cubicW(j - fl);
      if (wy === 0) continue;
      for (let i = -1; i <= 2; i++) {
        const w = cubicW(i - fx) * wy * k;
        if (w === 0) continue;
        for (let c = 0; c < 3; c++) acc[c] += lineFetch(x0 + i, l0 + j, c) * w;
      }
    }
  };
  const [mx, my, mw, mh] = o.map;
  const [ox, oy, ow, oh] = pr.map;
  const rgb = new Float32Array(3);
  const disp = [plan.osdPath[0] === 2 && !!osd[0], plan.osdPath[1] === 2 && !!osd[1]];
  const tmp = new Float32Array(4);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const nx = (x + 0.5) / outW;
      const ny = (y + 0.5) / outH;
      let r: number;
      let g: number;
      let b: number;
      if (o.split >= 0 && nx < o.split && o.src) {
        const sm = plan.srcMap;
        bilinear(o.src, (sm[0] + nx * sm[2]) * o.src.w, (sm[1] + ny * sm[3]) * o.src.h, tmp);
        r = tmp[0];
        g = tmp[1];
        b = tmp[2];
      } else {
        const sx = mx + nx * mw;
        const sy = my + ny * mh;
        res[0] = res[1] = res[2] = 0;
        if (fieldLines) sampleLines(sx, (sy - field + 0.5) * 0.5, res, 1);
        else if (deint === 2) {
          sampleLines(sx, sy - 1, res, 0.25);
          sampleLines(sx, sy, res, 0.5);
          sampleLines(sx, sy + 1, res, 0.25);
        } else sampleLines(sx, sy, res, 1);
        yccToRgb(res[0], res[1], res[2], rgb);
        r = clamp(rgb[0], 0, 1);
        g = clamp(rgb[1], 0, 1);
        b = clamp(rgb[2], 0, 1);
        const dx = ox + nx * ow;
        const dy = oy + ny * oh;
        for (let l = 0; l < 2; l++) {
          const im = osd[l];
          if (!disp[l] || !im) continue;
          const cx = clamp(Math.floor(dx * 0.5), 0, im.width - 1);
          const cy = clamp(Math.floor(dy * 0.5), 0, im.height - 1);
          const k = (cy * im.width + cx) * 4;
          const a = im.data[k + 3] / 255;
          r += (im.data[k] / 255 - r) * a;
          g += (im.data[k + 1] / 255 - g) * a;
          b += (im.data[k + 2] / 255 - b) * a;
        }
      }
      if (pr.dither > 0) {
        const h = ihash(x + 4096 * y, o.frame, 977);
        const d = ((h - 0.5) * pr.dither) / 255;
        r += d;
        g += d;
        b += d;
      }
      const k = (y * outW + x) * 4;
      out[k] = Math.round(clamp(r, 0, 1) * 255);
      out[k + 1] = Math.round(clamp(g, 0, 1) * 255);
      out[k + 2] = Math.round(clamp(b, 0, 1) * 255);
      out[k + 3] = 255;
    }
  }
}
