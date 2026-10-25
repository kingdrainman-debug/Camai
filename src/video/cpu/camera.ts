/**
 * The camera passes on the CPU: scene, blur, smear, sensor, demod and DSP.
 * Each function mirrors the shader of the same name line for line; when one
 * changes, the other must.
 */

import type { FieldPlan, FramePlan } from '../../cam/plan';
import type { OsdImage } from '../../cam/osd';
import {
  Buf,
  bilinearMirror,
  clamp,
  gaussHash,
  idx,
  linearToSrgb,
  rgbToYcc,
  srgbToLinear,
} from './core';

const tmp = new Float32Array(4);

/* ------------------------------------------------------------------ *
 * scene.frag
 * ------------------------------------------------------------------ */

export function scenePass(srcs: Buf[], plan: FramePlan, fp: FieldPlan, E: Buf): void {
  const W = plan.W;
  const H = plan.H;
  const A = plan.aspect;
  const rc = Math.hypot(A * 0.5, 0.5);
  const [k1, k2] = plan.dist;
  const ca = plan.ca;
  const hr = plan.headroom;
  const subs = fp.taps === 1 ? 4 : 1;
  const nS = fp.taps * subs;
  const view = fp.view;
  const rows = fp.rows;
  const out = E.d;
  const vtmp = new Float32Array(4);

  const decode = (r: number, g: number, b: number, o: Float32Array) => {
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);
    const m = Math.max(lr, lg, lb);
    const t = clamp((m - 0.95) / 0.05, 0, 1);
    const k = Math.pow(2, hr * t * t * (3 - 2 * t));
    o[0] = lr * k;
    o[1] = lg * k;
    o[2] = lb * k;
  };
  const dec = new Float32Array(3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let ir = 0;
      let r0 = 0;
      for (let k = 0; k < fp.taps; k++) {
        const src = srcs[fp.tapSrc[k]];
        const sw = src.w;
        const sh = src.h;
        for (let j = 0; j < subs; j++) {
          const ox = subs === 1 ? 0.5 : j === 0 || j === 2 ? 0.25 : 0.75;
          const oy = subs === 1 ? 0.5 : j < 2 ? 0.25 : 0.75;
          const px = x + ox;
          const py = y + oy;
          const qx = ((px - W * 0.5) / 704) * A;
          const qy = (py - H * 0.5) / H;
          r0 = Math.hypot(qx, qy) / rc;
          // viewAt
          if (rows <= 1) {
            vtmp[0] = view[k * 4];
            vtmp[1] = view[k * 4 + 1];
            vtmp[2] = view[k * 4 + 2];
            vtmp[3] = view[k * 4 + 3];
          } else {
            const f = clamp((py + 0.5) / H, 0, 1) * (rows - 1);
            const i0 = Math.floor(f);
            const i1 = Math.min(i0 + 1, rows - 1);
            const t = f - i0;
            for (let c = 0; c < 4; c++) vtmp[c] = view[(i0 * 4 + k) * 4 + c] * (1 - t) + view[(i1 * 4 + k) * 4 + c] * t;
          }
          const cr = Math.cos(vtmp[2]);
          const sr = Math.sin(vtmp[2]);
          const rx = cr * qx - sr * qy;
          const ry = sr * qx + cr * qy;
          const rho2 = (rx * rx + ry * ry) / (rc * rc);
          const d = (1 + k1 * rho2 + k2 * rho2 * rho2) / (1 + k1 + k2);
          const dx = rx * d;
          const dy = ry * d;
          const sx = plan.fit[0] / vtmp[3];
          const sy = plan.fit[1] / vtmp[3];
          const kr = 1 + ca * rho2;
          const kb = 1 - ca * rho2;
          bilinearMirror(src, (vtmp[0] + dx * kr * sx) * sw, (vtmp[1] + dy * kr * sy) * sh, tmp);
          decode(tmp[0], tmp[1], tmp[2], dec);
          const cR = dec[0];
          bilinearMirror(src, (vtmp[0] + dx * sx) * sw, (vtmp[1] + dy * sy) * sh, tmp);
          decode(tmp[0], tmp[1], tmp[2], dec);
          const cG = dec[1];
          bilinearMirror(src, (vtmp[0] + dx * kb * sx) * sw, (vtmp[1] + dy * kb * sy) * sh, tmp);
          decode(tmp[0], tmp[1], tmp[2], dec);
          const cB = dec[2];
          ar += cR;
          ag += cG;
          ab += cB;
          ir += 0.55 * cR + 0.35 * cG + 0.1 * cB;
        }
      }
      ar /= nS;
      ag /= nS;
      ab /= nS;
      ir /= nS;
      const vig = Math.pow(2, -plan.vignette * r0 * r0);
      let lr = ar * fp.light[0] * vig + fp.veil[0];
      let lg = ag * fp.light[1] * vig + fp.veil[1];
      let lb = ab * fp.light[2] * vig + fp.veil[2];
      if (fp.ir > 0) {
        const spot = Math.exp(-(r0 * r0) / (2 * plan.irSpot * plan.irSpot));
        const shine = 1 + plan.eyes * 6 * clamp((ir - 0.55) / 0.35, 0, 1);
        const v = fp.ir * spot * ir * shine;
        lr += v;
        lg += v;
        lb += v;
      }
      if (plan.circle > 0) {
        const qx = ((x + 0.5 - W * 0.5) / 704) * A;
        const qy = (y + 0.5 - H * 0.5) / H;
        const r = Math.hypot(qx, qy);
        const m = 1 - clamp((r - plan.circle) / 0.012 + 0.5, 0, 1);
        lr *= m;
        lg *= m;
        lb *= m;
      }
      const o = (y * W + x) * 4;
      out[o] = lr;
      out[o + 1] = lg;
      out[o + 2] = lb;
      out[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * blur.frag
 * ------------------------------------------------------------------ */

export function blurPass(
  src: Buf,
  dst: Buf,
  dx: number,
  dy: number,
  sigma0: number,
  sigmaCorner: number,
  rim: [number, number, number],
  aspect: number,
): void {
  const W = src.w;
  const H = src.h;
  const rc = Math.hypot(aspect * 0.5, 0.5);
  const s = src.d;
  const d = dst.d;
  const w = new Float32Array(49);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const qx = ((x + 0.5 - W * 0.5) / 704) * aspect;
      const qy = (y + 0.5 - H * 0.5) / H;
      const len = Math.hypot(qx, qy);
      const rho = len / rc;
      const sc = sigmaCorner * rho * rho;
      let sg = Math.sqrt(sigma0 * sigma0 + sc * sc);
      if (rim[2] > 0) sg += rim[2] * clamp((len - (rim[0] - rim[1])) / Math.max(rim[1], 1e-4), 0, 1);
      const o = (y * W + x) * 4;
      if (sg < 0.05) {
        d[o] = s[o];
        d[o + 1] = s[o + 1];
        d[o + 2] = s[o + 2];
        d[o + 3] = s[o + 3];
        continue;
      }
      const R = Math.min(Math.ceil(3 * sg), 24);
      const kk = -1 / (2 * sg * sg);
      let wsum = 0;
      for (let i = -R; i <= R; i++) {
        const v = Math.exp(i * i * kk);
        w[i + 24] = v;
        wsum += v;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let i = -R; i <= R; i++) {
        const j = idx(src, x + dx * i, y + dy * i);
        const v = w[i + 24];
        r += s[j] * v;
        g += s[j + 1] * v;
        b += s[j + 2] * v;
        a += s[j + 3] * v;
      }
      d[o] = r / wsum;
      d[o + 1] = g / wsum;
      d[o + 2] = b / wsum;
      d[o + 3] = a / wsum;
    }
  }
}

/* ------------------------------------------------------------------ *
 * smear.frag
 * ------------------------------------------------------------------ */

export function smearPass(E: Buf, out: Buf, H: number): void {
  const W = E.w;
  for (let x = 0; x < W; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      r += E.d[o];
      g += E.d[o + 1];
      b += E.d[o + 2];
    }
    out.d[x * 4] = r / H;
    out.d[x * 4 + 1] = g / H;
    out.d[x * 4 + 2] = b / H;
    out.d[x * 4 + 3] = 1;
  }
}

/* ------------------------------------------------------------------ *
 * sensor.frag
 * ------------------------------------------------------------------ */

export function sensorPass(E: Buf, smear: Buf, plan: FramePlan, fp: FieldPlan, F: Buf): void {
  const W = E.w;
  const H = plan.H;
  const sp = fp.sensor;
  const type = sp.type;
  const k = sp.crosstalk;
  const well = sp.well;
  const bloom = sp.bloom;
  const read = sp.read;
  const shot = sp.shot;
  const field = fp.m;
  const seed = plan.fs.seed;
  const e = E.d;
  const f3 = new Float32Array(3);

  const filterAt = (x: number, row: number): void => {
    if (type === 0) {
      if ((row & 1) === 0) {
        if ((x & 1) === 0) { f3[0] = k; f3[1] = 1; f3[2] = 1; } else { f3[0] = 1; f3[1] = 1; f3[2] = k; }
        return;
      }
      const kk = ((row >> 1) & 1) === 1;
      const g = ((x & 1) === 0) !== kk;
      if (g) { f3[0] = k; f3[1] = 1; f3[2] = k; } else { f3[0] = 1; f3[1] = k; f3[2] = 1; }
      return;
    }
    if ((row & 1) === 0) {
      if ((x & 1) === 0) { f3[0] = 1; f3[1] = k; f3[2] = k; } else { f3[0] = k; f3[1] = 1; f3[2] = k; }
    } else if ((x & 1) === 0) { f3[0] = k; f3[1] = 1; f3[2] = k; } else { f3[0] = k; f3[1] = k; f3[2] = 1; }
  };
  const L = (x: number, row: number): number => {
    const xi = x < 0 ? 0 : x >= W ? W - 1 : x;
    const yi = row < 0 ? 0 : row >= H ? H - 1 : row;
    return (yi * W + xi) * 4;
  };
  const dotF = (x: number, row: number): number => {
    filterAt(x, row);
    const o = L(x, row);
    return f3[0] * e[o] + f3[1] * e[o + 1] + f3[2] * e[o + 2];
  };
  const siteCharge = (x: number, row: number): number => {
    const q = dotF(x, row);
    let c = Math.min(q, well);
    if (bloom > 0) {
      let spill = 0;
      let w = 0.5;
      for (let d = 1; d <= 3; d++) {
        spill += w * (Math.max(dotF(x, row - d) - well, 0) + Math.max(dotF(x, row + d) - well, 0));
        w *= 0.5;
      }
      spill += 0.15 * (Math.max(dotF(x - 1, row) - well, 0) + Math.max(dotF(x + 1, row) - well, 0));
      c += bloom * spill;
    }
    return c;
  };
  const chip = new Float32Array(3);
  const chipCharge = (x: number, row: number, out: Float32Array): void => {
    const o = L(x, row);
    for (let c = 0; c < 3; c++) {
      let v = Math.min(e[o + c], well);
      if (bloom > 0) {
        let spill = 0;
        let w = 0.5;
        for (let d = 1; d <= 3; d++) {
          spill += w * (Math.max(e[L(x, row - d) + c] - well, 0) + Math.max(e[L(x, row + d) + c] - well, 0));
          w *= 0.5;
        }
        spill += 0.15 * (Math.max(e[L(x - 1, row) + c] - well, 0) + Math.max(e[L(x + 1, row) + c] - well, 0));
        v += bloom * spill;
      }
      out[c] = v;
    }
  };
  const noisy = (q: number, x: number, line: number, ch: number): number => {
    if (read <= 0 && shot <= 0) return q;
    const sigma = Math.sqrt(read * read + shot * shot * Math.max(q, 0));
    return q + sigma * gaussHash(x + 1024 * line, field * 4 + ch, seed);
  };
  const bayerSite = (x: number, row: number): number => {
    const q = Math.min(dotF(x, row), well);
    return noisy(q, x, row + 4096, 3);
  };
  const bayer = new Float32Array(3);
  const bayerRGB = (x: number, row: number, out: Float32Array): void => {
    let sr = 0, sg = 0, sb = 0, wr = 0, wg = 0, wb = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sx = x + dx;
        const sy = row + dy;
        const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
        filterAt(sx, sy);
        const selR = f3[0] > 0.99 ? 1 : 0;
        const selG = f3[1] > 0.99 ? 1 : 0;
        const selB = f3[2] > 0.99 ? 1 : 0;
        const v = bayerSite(sx, sy);
        sr += selR * w * v;
        sg += selG * w * v;
        sb += selB * w * v;
        wr += selR * w;
        wg += selG * w;
        wb += selB * w;
      }
    }
    out[0] = sr / Math.max(wr, 1e-6);
    out[1] = sg / Math.max(wg, 1e-6);
    out[2] = sb / Math.max(wb, 1e-6);
  };

  const pair = sp.integrate === 1;
  const Hf = F.h;
  const out = F.d;
  const tB = new Float32Array(3);
  for (let r = 0; r < Hf; r++) {
    const a = 2 * r + fp.parity;
    const b = a + 1;
    for (let x = 0; x < W; x++) {
      const o = (r * W + x) * 4;
      if (type === 3) {
        const oa = L(x, a);
        const ob = L(x, b);
        for (let c = 0; c < 3; c++) out[o + c] = pair ? (e[oa + c] + e[ob + c]) * 0.5 : e[oa + c];
        out[o + 3] = 1;
        continue;
      }
      if (type === 2) {
        bayerRGB(x, a, bayer);
        if (pair) {
          bayerRGB(x, b, tB);
          for (let c = 0; c < 3; c++) out[o + c] = (bayer[c] + tB[c]) * 0.5;
        } else {
          for (let c = 0; c < 3; c++) out[o + c] = bayer[c];
        }
        out[o + 3] = 1;
        continue;
      }
      const sm = x * 4;
      const smr = smear.d[sm] * sp.smearK;
      const smg = smear.d[sm + 1] * sp.smearK;
      const smb = smear.d[sm + 2] * sp.smearK;
      if (type === 0) {
        filterAt(x, a);
        const fa = f3[0] * smr + f3[1] * smg + f3[2] * smb;
        const qa = siteCharge(x, a) + fa;
        filterAt(x, b);
        const fb = f3[0] * smr + f3[1] * smg + f3[2] * smb;
        const qb = siteCharge(x, b) + fb;
        const S = Math.min((qa + qb) * 0.5, well * 1.6);
        out[o] = noisy(S, x, r, 0);
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 1;
        continue;
      }
      chipCharge(x, a, chip);
      let s0 = chip[0];
      let s1 = chip[1];
      let s2 = chip[2];
      if (pair) {
        chipCharge(x, b, chip);
        s0 = (s0 + chip[0]) * 0.5;
        s1 = (s1 + chip[1]) * 0.5;
        s2 = (s2 + chip[2]) * 0.5;
      }
      s0 = Math.min(s0 + smr, well * 1.6);
      s1 = Math.min(s1 + smg, well * 1.6);
      s2 = Math.min(s2 + smb, well * 1.6);
      out[o] = noisy(s0, x, r, 0);
      out[o + 1] = noisy(s1, x, r, 1);
      out[o + 2] = noisy(s2, x, r, 2);
      out[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * demod.frag
 * ------------------------------------------------------------------ */

export function demodPass(F: Buf, fp: FieldPlan, G: Buf): void {
  const W = F.w;
  const Hf = F.h;
  const d = F.d;
  const S = (x: number, r: number): number => d[idx(F, x, r)];
  const diffAt = (x: number, r: number): number => {
    const sg = (x & 1) === 0 ? 1 : -1;
    return sg * (2 * S(x, r) - S(x - 1, r) - S(x + 1, r)) * 0.5;
  };
  const taps = 2;
  const smoothDiff = (x: number, r: number): number => {
    let acc = 0;
    for (let i = -taps; i <= taps; i++) acc += diffAt(x + i, r);
    return acc / (2 * taps + 1);
  };
  const M = fp.minv;
  const well = fp.sensor.well;
  const g = fp.gain;
  const [wr, wg, wb] = fp.wb;
  const out = G.d;
  for (let r = 0; r < Hf; r++) {
    const a = 2 * r + fp.parity;
    const o2 = (a & 1) === 1 ? a : a + 1;
    const type = (o2 >> 1) & 1;
    for (let x = 0; x < W; x++) {
      const o = (r * W + x) * 4;
      let R: number;
      let Gc: number;
      let B: number;
      if (fp.sensor.type === 0) {
        const P = (S(x - 1, r) + 2 * S(x, r) + S(x + 1, r)) * 0.5;
        const D = smoothDiff(x, r);
        const Dn = (smoothDiff(x, r - 1) + smoothDiff(x, r + 1)) * 0.5;
        const m0 = P;
        const m1 = type === 0 ? D : Dn;
        const m2 = type === 0 ? Dn : D;
        R = M[0] * m0 + M[1] * m1 + M[2] * m2;
        Gc = M[3] * m0 + M[4] * m1 + M[5] * m2;
        B = M[6] * m0 + M[7] * m1 + M[8] * m2;
        const peak = Math.max(S(x - 1, r), S(x, r), S(x + 1, r));
        const t = clamp((peak - 0.8 * well) / (0.18 * well), 0, 1);
        const sup = t * t * (3 - 2 * t);
        if (sup > 0) {
          const Yl = 0.299 * R + 0.587 * Gc + 0.114 * B;
          R += (Yl - R) * sup;
          Gc += (Yl - Gc) * sup;
          B += (Yl - B) * sup;
        }
      } else {
        R = d[o];
        Gc = d[o + 1];
        B = d[o + 2];
      }
      out[o] = R * wr * g;
      out[o + 1] = Gc * wg * g;
      out[o + 2] = B * wb * g;
      out[o + 3] = 1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * dsp.frag
 * ------------------------------------------------------------------ */

export function dspPass(
  G0: Buf,
  G1: Buf,
  plan: FramePlan,
  prevPre: Buf | null,
  osd: [OsdImage | null, OsdImage | null],
  osdPre: [boolean, boolean],
  pre: Buf,
): void {
  const W = plan.W;
  const H = plan.H;
  const p = plan.dsp;
  const par0 = plan.fields[0].parity;
  const fade0 = plan.fields[0].fade;
  const fade1 = plan.fields[1].fade;
  const sig = new Float32Array(3);
  const ycc = new Float32Array(3);
  const a4 = new Float32Array(3);
  const b4 = new Float32Array(3);

  const fieldFetch = (j: number, x: number, r: number, out: Float32Array): void => {
    const B = j === 0 ? G0 : G1;
    const o = idx(B, x, r);
    out[0] = B.d[o];
    out[1] = B.d[o + 1];
    out[2] = B.d[o + 2];
  };
  const signalAt = (x: number, y: number, out: Float32Array): void => {
    if (p.effect === 4) {
      const c = Math.trunc(p.effectSize);
      x = Math.trunc(x / c) * c + Math.trunc(c / 2);
      y = Math.trunc(y / c) * c + Math.trunc(c / 2);
    }
    const j = (y & 1) === par0 ? 0 : 1;
    const par = y & 1;
    if (p.dz <= 1.0001) {
      fieldFetch(j, x, y >> 1, out);
      return;
    }
    const cx = W * 0.5;
    const cy = H * 0.5;
    const xs = cx + (x + 0.5 - cx) / p.dz - 0.5;
    const ys = cy + (y + 0.5 - cy) / p.dz - 0.5;
    const rs = (ys - par) * 0.5;
    if (p.dzNearest === 1) {
      fieldFetch(j, Math.floor(xs + 0.5), Math.floor(rs + 0.5), out);
      return;
    }
    const x0 = Math.floor(xs);
    const r0 = Math.floor(rs);
    const fx = xs - x0;
    const fr = rs - r0;
    fieldFetch(j, x0, r0, a4);
    fieldFetch(j, x0 + 1, r0, b4);
    const t0 = [a4[0] + (b4[0] - a4[0]) * fx, a4[1] + (b4[1] - a4[1]) * fx, a4[2] + (b4[2] - a4[2]) * fx];
    fieldFetch(j, x0, r0 + 1, a4);
    fieldFetch(j, x0 + 1, r0 + 1, b4);
    for (let c = 0; c < 3; c++) {
      const t1 = a4[c] + (b4[c] - a4[c]) * fx;
      out[c] = t0[c] + (t1 - t0[c]) * fr;
    }
  };
  const oetf = (v: number): number => {
    if (p.toneOn === 0) return v <= 0 ? v : linearToSrgb(v);
    v = Math.max(v, 0);
    let e = v < 0.018 ? 4.5 * v : 1.099 * Math.pow(v, p.gamma) - 0.099;
    if (e > p.knee) e = p.knee + (e - p.knee) * p.slope;
    return Math.min(e, p.clip) + p.pedestal;
  };
  const yccAt = (x: number, y: number, out: Float32Array): void => {
    signalAt(x, y, sig);
    rgbToYcc(oetf(sig[0]), oetf(sig[1]), oetf(sig[2]), out);
    if (p.toneOn === 1) {
      out[1] *= p.sat;
      out[2] *= p.sat;
    }
  };
  const lt = new Float32Array(3);
  const lumaAt = (x: number, y: number): number => {
    yccAt(x, y, lt);
    return lt[0];
  };
  const core = (h: number): number => {
    let a = Math.max(Math.abs(h) - p.dCoring, 0) * (h > 0 ? 1 : h < 0 ? -1 : 0);
    if (a < 0) a *= p.dDark;
    return clamp(a, -p.dLimit, p.dLimit);
  };
  const ov = (img: OsdImage, x: number, y: number, out: Float32Array): number => {
    const ox = clamp(x >> 1, 0, img.width - 1);
    const oy = clamp(y >> 1, 0, img.height - 1);
    const o = (oy * img.width + ox) * 4;
    rgbToYcc(img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255, out);
    return img.data[o + 3] / 255;
  };
  const oc = new Float32Array(3);
  const out = pre.d;
  const di = Math.floor(p.dFreq);
  const df = p.dFreq - di;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      yccAt(x, y, ycc);
      let Y = ycc[0];
      let Cb = ycc[1];
      let Cr = ycc[2];
      if (p.detailOn === 1) {
        const l1 = lumaAt(x - di, y) * (1 - df) + lumaAt(x - di - 1, y) * df;
        const r1 = lumaAt(x + di, y) * (1 - df) + lumaAt(x + di + 1, y) * df;
        const hp = Y - 0.5 * (l1 + r1);
        const hv = Y - 0.5 * (lumaAt(x, y - 2) + lumaAt(x, y + 2));
        Y += p.dGain * (core(hp) + p.dVert * core(hv));
      }
      if (p.green > 0) {
        const k = clamp(Y * 1.5, 0, 1);
        Cb = Cb + (-0.06 * k - Cb) * p.green;
        Cr = Cr + (-0.08 * k - Cr) * p.green;
      }
      const o = (y * W + x) * 4;
      if (p.effect === 1 || p.effect === 3) {
        const k = clamp(Y * 2, 0, 1);
        Cb = -0.045 * k;
        Cr = 0.055 * k;
        if (p.effect === 3) Y *= p.flicker;
      } else if (p.effect === 2) {
        Cb = 0;
        Cr = 0;
      } else if (p.effect === 7) {
        Y = 1 - Y;
        Cb = -Cb;
        Cr = -Cr;
      } else if (p.effect === 6 && prevPre && p.trail) {
        Y = Y + (prevPre.d[o] - Y) * 0.55;
        Cb = Cb + (prevPre.d[o + 1] - Cb) * 0.55;
        Cr = Cr + (prevPre.d[o + 2] - Cr) * 0.55;
      }
      const f = (y & 1) === par0 ? fade0 : fade1;
      if (f > 0) {
        Y = Y + (p.fadeWhite - Y) * f;
        Cb *= 1 - f;
        Cr *= 1 - f;
      }
      for (let l = 0; l < 2; l++) {
        const img = osd[l];
        if (!osdPre[l] || !img) continue;
        const a = ov(img, x, y, oc);
        Y += (oc[0] - Y) * a;
        Cb += (oc[1] - Cb) * a;
        Cr += (oc[2] - Cr) * a;
      }
      out[o] = Y;
      out[o + 1] = Cb;
      out[o + 2] = Cr;
      out[o + 3] = 1;
    }
  }
}
