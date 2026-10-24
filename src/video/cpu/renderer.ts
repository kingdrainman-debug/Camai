/**
 * The CPU backend.
 *
 * A complete second implementation of the render chain that needs no GPU at
 * all. It exists for three reasons, none of them speed:
 *
 *   - Machines where WebGL2 is missing, blocked or broken. The app refused to
 *     start at all on those; now it runs.
 *   - Headless and batch rendering on a server or in CI, where the GPU path
 *     either is not present or quietly produces black frames.
 *   - Determinism. GPU floating point varies between vendors and drivers, so
 *     the same project can render subtly differently on two machines. This
 *     path produces identical bytes everywhere.
 *
 * It is slower than the GPU path by a wide margin and always will be: the
 * chain is a handful of full-screen operations, which is the one thing
 * graphics hardware is built for. `npm run bench` prints both.
 *
 * Structure follows the shader chain pass for pass, so the two can be compared
 * side by side and kept honest. Where a shader reads a texture at a non-integer
 * coordinate, this samples bilinearly; where it reads gl_FragCoord, this uses
 * the pixel index.
 */

import { Settings, bool, code, num } from '../../core/params';
import { beamNormalisation, maskNormalisation } from '../normalization';
import { RenderTelemetry, TubeState } from '../state';
import type { RenderFrame } from '../renderer';
import type { FrameSource } from '../backend';
import {
  Buf,
  TAU,
  clamp,
  clearBuf,
  ensureBuf,
  fbm,
  fract,
  gauss,
  hash11,
  hash12,
  hash32,
  ign,
  luma,
  mix,
  rgb2i,
  rgb2q,
  rgb2y,
  safePow,
  sampleUV,
  sampleUVc,
  smoothstep,
  vnoise,
  yiq2rgb,
} from './core';

/** Scratch vectors, reused to keep the inner loops allocation-free. */
const t4 = new Float32Array(4);
const t4b = new Float32Array(4);
const rgb3 = new Float32Array(4);

const SUBCARRIER_CYCLES = 227.5;

export class CpuRenderer {
  readonly backend = 'cpu' as const;

  private ctx: CanvasRenderingContext2D;
  private blit: HTMLCanvasElement;
  private blitCtx: CanvasRenderingContext2D;
  private out: ImageData | null = null;

  private src: Buf | null = null;
  private ntsc: Buf | null = null;
  private signal: Buf | null = null;
  private screenA: Buf | null = null;
  private screenB: Buf | null = null;
  private burnA: Buf | null = null;
  private burnB: Buf | null = null;
  private bright: Buf | null = null;
  private tmp: Buf | null = null;
  private bloom: Buf | null = null;
  private halA: Buf | null = null;
  private halB: Buf | null = null;

  private srcW = 2;
  private srcH = 2;
  private state = new TubeState();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('could not get a 2D context for the CPU renderer');
    this.ctx = ctx;
    this.blit = document.createElement('canvas');
    const bctx = this.blit.getContext('2d', { willReadFrequently: true });
    if (!bctx) throw new Error('could not get a 2D context to read the source');
    this.blitCtx = bctx;
  }

  get sourceSize(): { width: number; height: number } {
    return { width: this.srcW, height: this.srcH };
  }

  triggerDegauss(now: number): void {
    this.state.triggerDegauss(now);
  }

  resetHistory(): void {
    if (this.screenA) clearBuf(this.screenA);
    if (this.screenB) clearBuf(this.screenB);
    if (this.burnA) clearBuf(this.burnA);
    if (this.burnB) clearBuf(this.burnB);
  }

  dispose(): void {
    this.src = this.ntsc = this.signal = null;
    this.screenA = this.screenB = this.burnA = this.burnB = null;
    this.bright = this.tmp = this.bloom = this.halA = this.halB = null;
  }

  /**
   * Read a frame of source material into a float buffer.
   *
   * The GPU path hands the element straight to texImage2D. Here it has to come
   * back through a 2D canvas, which is the single largest fixed cost per frame
   * and the reason the source resolution matters so much to CPU throughput.
   */
  setSource(source: FrameSource | null, width: number, height: number): void {
    if (!source || width < 1 || height < 1) return;
    if (this.blit.width !== width || this.blit.height !== height) {
      this.blit.width = width;
      this.blit.height = height;
    }
    this.blitCtx.drawImage(source, 0, 0, width, height);
    const img = this.blitCtx.getImageData(0, 0, width, height);

    this.src = ensureBuf(this.src, width, height);
    const d = this.src.d;
    const s = img.data;
    const inv = 1 / 255;
    for (let i = 0, n = width * height * 4; i < n; i++) d[i] = s[i] * inv;

    this.srcW = width;
    this.srcH = height;
  }

  private ensureTargets(w: number, h: number): void {
    const hw = Math.max(2, w >> 1);
    const hh = Math.max(2, h >> 1);
    const ew = Math.max(2, w >> 3);
    const eh = Math.max(2, h >> 3);
    const bw = Math.max(2, w >> 2);
    const bh = Math.max(2, h >> 2);

    const fresh = !this.screenA || this.screenA.w !== w || this.screenA.h !== h;
    this.ntsc = ensureBuf(this.ntsc, w, h);
    this.signal = ensureBuf(this.signal, w, h);
    this.screenA = ensureBuf(this.screenA, w, h);
    this.screenB = ensureBuf(this.screenB, w, h);
    this.burnA = ensureBuf(this.burnA, bw, bh);
    this.burnB = ensureBuf(this.burnB, bw, bh);
    this.bright = ensureBuf(this.bright, hw, hh);
    this.tmp = ensureBuf(this.tmp, hw, hh);
    this.bloom = ensureBuf(this.bloom, hw, hh);
    this.halA = ensureBuf(this.halA, ew, eh);
    this.halB = ensureBuf(this.halB, ew, eh);
    if (fresh) this.resetHistory();
  }

  render(f: RenderFrame): RenderTelemetry {
    const s = f.settings;
    const tel = this.state.advance(s, f.time, f.dt, f.seed);
    if (!this.src) return tel;

    const w = this.srcW;
    const h = this.srcH;
    this.ensureTargets(w, h);

    const dt = Math.max(1e-4, Math.min(f.dt, 0.25));

    this.passNtsc(f, s, this.src, this.ntsc!);
    this.passSignal(f, s, this.ntsc!, this.signal!);
    this.passPersist(s, this.signal!, this.screenB!, this.screenA!, dt);
    [this.screenA, this.screenB] = [this.screenB!, this.screenA!];
    this.passBurnin(s, this.screenB!, this.burnB!, this.burnA!, dt);
    [this.burnA, this.burnB] = [this.burnB!, this.burnA!];
    this.passGlow(s, this.screenB!);
    this.passTube(f, s, tel);

    return tel;
  }

  /* ---------------------------------------------------------------- *
   * Pass 0 — the tape engine
   * ---------------------------------------------------------------- */

  private passNtsc(f: RenderFrame, s: Settings, src: Buf, dst: Buf): void {
    const compositeOn = bool(s, 'composite.enabled');
    const tapeOn = bool(s, 'tape.enabled');
    const noiseOn = bool(s, 'vnoise.enabled');
    const headOn = bool(s, 'headswitch.enabled');

    const w = dst.w;
    const h = dst.h;
    const d = dst.d;

    if (!compositeOn && !tapeOn && !noiseOn && !headOn) {
      d.set(src.d);
      return;
    }

    const bandwidthScale = Math.max(num(s, 'composite.bandwidthScale'), 0.03);
    const demod = code(s, 'composite.demodulation');
    const phaseShiftCode = code(s, 'composite.phaseShift');
    const perLine = phaseShiftCode === 0 ? 0 : phaseShiftCode === 1 ? 0.25 : phaseShiftCode === 2 ? 0.5 : 0.75;
    const field = (f.frame + num(s, 'composite.phaseShiftOffset')) % 4;
    const preemphasis = num(s, 'composite.preemphasis');
    const ringing = num(s, 'composite.ringing');
    const ringingFreq = num(s, 'composite.ringingFrequency');
    const ringingPower = num(s, 'composite.ringingPower');
    const cLowIn = num(s, 'composite.chromaLowpassIn');
    const cLowOut = num(s, 'composite.chromaLowpassOut');
    const cDelayH = num(s, 'composite.chromaDelayH');
    const cDelayV = num(s, 'composite.chromaDelayV');
    const phaseErrBase = num(s, 'composite.chromaPhaseError') * Math.PI;
    const lumaSmear = num(s, 'composite.lumaSmear');

    const speed = code(s, 'tape.speed');
    const lumaBw = !tapeOn || speed > 2.5 ? 4.2 : speed < 0.5 ? 3.0 : speed < 1.5 ? 2.6 : 1.9;
    const chromaBw = !tapeOn || speed > 2.5 ? 0.6 : speed < 0.5 ? 0.4 : speed < 1.5 ? 0.3 : 0.19;
    const cycleWidth = (mhz: number) => {
      const cycles = Math.max(mhz, 0.02) * 52.6;
      return Math.max(w / Math.max(cycles * 2, 1), 0.5) / bandwidthScale;
    };
    const yW = cycleWidth(lumaBw);
    const cW = cycleWidth(chromaBw) * mix(0.5, 2.0, cLowIn);

    const chromaLoss = num(s, 'tape.chromaLoss');
    const vertBlend = bool(s, 'tape.chromaVertBlend');
    const sharpen = num(s, 'tape.sharpen');
    const sharpenFreq = Math.max(num(s, 'tape.sharpenFrequency'), 0.1);
    const edgeWave = num(s, 'tape.edgeWave');
    const edgeWaveSpeed = num(s, 'tape.edgeWaveSpeed');
    const edgeWaveFreq = Math.max(num(s, 'tape.edgeWaveFrequency'), 0.0005);
    const edgeWaveDetail = num(s, 'tape.edgeWaveDetail');

    const compNoise = num(s, 'vnoise.compositeNoise');
    const compNoiseFreq = num(s, 'vnoise.compositeNoiseFrequency');
    const compNoiseDetail = num(s, 'vnoise.compositeNoiseDetail');
    const lNoise = num(s, 'vnoise.lumaNoise');
    const lNoiseFreq = num(s, 'vnoise.lumaNoiseFrequency');
    const lNoiseDetail = num(s, 'vnoise.lumaNoiseDetail');
    const cNoise = num(s, 'vnoise.chromaNoise');
    const cNoiseFreq = num(s, 'vnoise.chromaNoiseFrequency');
    const cNoiseDetail = num(s, 'vnoise.chromaNoiseDetail');
    const cPhaseNoise = num(s, 'vnoise.chromaPhaseNoise');
    const snow = num(s, 'vnoise.snow');
    const snowAniso = num(s, 'vnoise.snowAnisotropy');

    const headHeight = num(s, 'headswitch.height');
    const headOffset = num(s, 'headswitch.offset');
    const headShift = num(s, 'headswitch.shift');
    const midLine = bool(s, 'headswitch.midLine');
    const midLinePos = num(s, 'headswitch.midLinePosition');
    const midLineJitter = num(s, 'headswitch.midLineJitter');
    const tracking = num(s, 'headswitch.tracking');
    const trackingHeight = num(s, 'headswitch.trackingHeight');
    const trackingWave = num(s, 'headswitch.trackingWave');
    const trackingSnow = num(s, 'headswitch.trackingSnow');

    const texelX = 1 / w;
    const texelY = 1 / h;

    // The composite sample at a uv, with the carrier phase for that point.
    const carrierPhase = (x: number, line: number) =>
      TAU * (x * SUBCARRIER_CYCLES + line * perLine + field * perLine);

    const compositeAt = (u: number, v: number, line: number): number => {
      sampleUV(src, u, v, t4);
      const y = rgb2y(t4[0], t4[1], t4[2]);
      const i = rgb2i(t4[0], t4[1], t4[2]);
      const q = rgb2q(t4[0], t4[1], t4[2]);
      const ph = carrierPhase(u, line);
      return y + i * Math.cos(ph) + q * Math.sin(ph);
    };

    const signalNoise = (x: number, y: number, freq: number, detail: number, salt: number) => {
      const scale = mix(2, 220, clamp(freq, 0, 1));
      let v = 0;
      let amp = 0.5;
      let total = 0;
      const oct = clamp(detail, 1, 5) | 0;
      let qx = x * scale + salt;
      let qy = y * scale * 0.35 + salt;
      for (let i = 0; i < oct; i++) {
        v += amp * vnoise(qx, qy);
        total += amp;
        qx *= 2.07;
        qy *= 2.07;
        amp *= 0.5;
      }
      return v / Math.max(total, 1e-4) - 0.5;
    };

    for (let py = 0; py < h; py++) {
      const v0 = (py + 0.5) * texelY;
      const line0 = Math.floor(v0 * h);

      for (let px = 0; px < w; px++) {
        const u0 = (px + 0.5) * texelX;
        let u = u0;
        let v = v0;
        let lineNoise = 0;
        let lineSnow = 0;

        /* ---- tape geometry ---- */
        if (tapeOn && edgeWave > 0.001) {
          let acc = 0;
          let amp = 1;
          let total = 0;
          const oct = clamp(edgeWaveDetail, 1, 5) | 0;
          for (let i = 0; i < oct; i++) {
            acc += amp * (vnoise(line0 * edgeWaveFreq * (i + 1) * 3, f.time * edgeWaveSpeed + f.seed) - 0.5);
            total += amp;
            amp *= 0.5;
          }
          u += (acc / Math.max(total, 1e-4)) * edgeWave * 2 * texelX;
        }

        if (headOn) {
          if (tracking > 0.001 && trackingHeight > 0.5) {
            const bandCentre = fract(-f.time * 0.22 + f.seed * 0.31);
            const half = trackingHeight * 0.5 / h;
            const dd = Math.abs(fract(v - bandCentre + 0.5) - 0.5);
            const inBand = 1 - smoothstep(half * 0.6, half, dd);
            if (inBand > 0) {
              const g = inBand * tracking;
              u += (hash11(line0 * 3.7 + f.frame * 17 + f.seed) - 0.5) * g * trackingWave * 0.25;
              lineNoise = g;
              lineSnow = g * trackingSnow;
            }
          }
          if (headHeight > 0.5) {
            const fromBottom = (1 - v) * h - headOffset;
            if (fromBottom >= 0 && fromBottom < headHeight) {
              const t = 1 - fromBottom / Math.max(headHeight, 1e-4);
              const amount = Math.pow(clamp(t, 0, 1), 1.7);
              let gate = 1;
              if (midLine) {
                const jit = (hash11(line0 * 1.3 + f.frame * 7 + f.seed) - 0.5) * midLineJitter;
                gate = u >= clamp(midLinePos + jit, 0, 1) ? 1 : 0;
              }
              u += amount * gate * headShift * texelX;
              lineNoise = Math.max(lineNoise, amount * gate * 0.6);
            }
          }
        }

        const o = (py * w + px) * 4;
        const line = Math.floor(v * h);

        if (!compositeOn) {
          sampleUV(src, u, v, t4);
          d[o] = t4[0];
          d[o + 1] = t4[1];
          d[o + 2] = t4[2];
          d[o + 3] = lineNoise;
          continue;
        }

        /* ---- chroma band-limiting before encoding ---- */
        const cu = u - cDelayH * texelX;
        const cv = v - cDelayV * texelY;
        let ci = 0;
        let cq = 0;
        {
          let wsum = 0;
          const stepX = Math.max(cW * 0.4, 0.5);
          const sig = Math.max(cW * 0.5, 0.5);
          for (let k = -4; k <= 4; k++) {
            const x = k * stepX;
            const wt = gauss(x, sig);
            sampleUV(src, cu + x * texelX, cv, t4);
            ci += rgb2i(t4[0], t4[1], t4[2]) * wt;
            cq += rgb2q(t4[0], t4[1], t4[2]) * wt;
            wsum += wt;
          }
          ci /= Math.max(wsum, 1e-5);
          cq /= Math.max(wsum, 1e-5);
        }

        if (tapeOn && vertBlend) {
          sampleUV(src, cu, cv - texelY, t4);
          const ai = rgb2i(t4[0], t4[1], t4[2]);
          const aq = rgb2q(t4[0], t4[1], t4[2]);
          ci = mix(ci, (ci + ai) * 0.5, 0.75);
          cq = mix(cq, (cq + aq) * 0.5, 0.75);
        }

        if (tapeOn && chromaLoss > 0.001) {
          const r = hash11(line * 5.17 + Math.floor(f.time * 30) * 13 + f.seed);
          if (r < chromaLoss * 0.35) {
            ci = 0;
            cq = 0;
          }
        }

        let phaseErr = phaseErrBase;
        if (noiseOn && cPhaseNoise > 0.001) {
          phaseErr += (hash11(line * 2.3 + f.frame * 31 + f.seed) - 0.5) * cPhaseNoise * Math.PI;
        }

        const centre = compositeAt(u, v, line);

        /* ---- luma band-limiting in the composite domain ---- */
        let composite = 0;
        {
          let wsum = 0;
          const stepX = Math.max(yW * 0.4, 0.5);
          const sig = Math.max(yW * 0.5, 0.5);
          for (let k = -4; k <= 4; k++) {
            const x = k * stepX;
            const wt = gauss(x, sig);
            composite += compositeAt(u + x * texelX, v, line) * wt;
            wsum += wt;
          }
          composite /= Math.max(wsum, 1e-5);
        }

        if (ringing > 0.001 || Math.abs(preemphasis - 1) > 0.001) {
          const stepR = Math.max(yW * mix(1.4, 0.4, ringingFreq), 0.8) * texelX;
          let acc = 0;
          for (let k = 1; k <= 3; k++) {
            const dd = k * stepR;
            acc += (compositeAt(u - dd, v, line) + compositeAt(u + dd, v, line) - 2 * centre) / k;
          }
          composite -= acc * ringing * 0.35 * (ringingPower * 0.18);
          composite += (centre - composite) * (preemphasis - 1) * 0.5;
        }

        if (noiseOn) {
          const n = compNoise + lineNoise * 0.6;
          if (n > 0.0001) {
            composite += signalNoise(u, line / h, compNoiseFreq, compNoiseDetail, f.seed + f.frame * 0.37) * n * 0.6;
          }
          const snowAmount = snow + lineSnow;
          if (snowAmount > 0.0001) {
            const sx = Math.floor((u * w) / mix(1, 14, snowAniso));
            const hsh = hash12(sx + f.frame * 9.71 + f.seed, line + f.frame * 9.71 + f.seed);
            if (hsh > 1 - snowAmount * 0.06) composite += hash11(hsh * 31) * 1.4 - 0.2;
          }
        }

        /* ---- demodulate ---- */
        const phase = carrierPhase(u, line) + phaseErr;
        let yOut: number;
        let iOut: number;
        let qOut: number;

        if (demod >= 2) {
          const above = compositeAt(u, v - texelY, line - 1);
          const below = demod >= 3 ? compositeAt(u, v + texelY, line + 1) : 0;
          const neighbour = demod >= 3 ? (above + below) * 0.5 : above;
          yOut = (composite + neighbour) * 0.5;
          const cs = composite - yOut;
          iOut = cs * Math.cos(phase) * 2;
          qOut = cs * Math.sin(phase) * 2;
        } else if (demod === 1) {
          let notch = 0;
          for (let k = -2; k <= 2; k++) {
            notch += compositeAt(u + k * (w / SUBCARRIER_CYCLES) * 0.25 * texelX, v, line);
          }
          yOut = notch / 5;
          const cs = composite - yOut;
          iOut = cs * Math.cos(phase) * 2;
          qOut = cs * Math.sin(phase) * 2;
        } else {
          const period = w / SUBCARRIER_CYCLES;
          let acc = 0;
          let ai = 0;
          let aq = 0;
          for (let k = -3; k <= 3; k++) {
            const dd = k * period * 0.25 * texelX;
            const c = compositeAt(u + dd, v, line);
            const ph = carrierPhase(u + dd, line) + phaseErr;
            acc += c;
            ai += c * Math.cos(ph);
            aq += c * Math.sin(ph);
          }
          yOut = acc / 7;
          iOut = (ai / 7) * 2;
          qOut = (aq / 7) * 2;
        }

        const lowOut = mix(1, 0.55, cLowOut);
        iOut *= lowOut;
        qOut *= lowOut;

        if (noiseOn) {
          if (lNoise > 0.0001) {
            yOut += signalNoise(u, line / h, lNoiseFreq, lNoiseDetail, f.seed + 11 + f.frame * 0.53) * lNoise * 0.35;
          }
          if (cNoise > 0.0001) {
            iOut += signalNoise(u, line / h, cNoiseFreq, cNoiseDetail, f.seed + 23 + f.frame * 0.29) * cNoise * 0.5;
            qOut += signalNoise(u, line / h, cNoiseFreq, cNoiseDetail, f.seed + 41 + f.frame * 0.31) * cNoise * 0.5;
          }
        }

        if (lumaSmear > 0.001) {
          let trail = 0;
          let wsum = 0;
          for (let k = 1; k <= 4; k++) {
            const wt = 1 / k;
            trail += compositeAt(u - k * 2 * texelX, v, line) * wt;
            wsum += wt;
          }
          yOut = mix(yOut, Math.max(yOut, (trail / Math.max(wsum, 1e-4)) * 0.9), lumaSmear * 0.55);
        }

        if (tapeOn && sharpen > 0.001) {
          const sW = Math.max(yW / sharpenFreq, 0.8);
          let blurred = 0;
          let wsum = 0;
          for (let k = -3; k <= 3; k++) {
            const x = k * sW * 0.6;
            const wt = gauss(x, Math.max(sW, 0.6));
            blurred += compositeAt(u + x * texelX, v, line) * wt;
            wsum += wt;
          }
          yOut += (yOut - blurred / Math.max(wsum, 1e-5)) * sharpen * 0.55;
        }

        yiq2rgb(yOut, iOut, qOut, rgb3);
        d[o] = clamp(rgb3[0], -0.2, 2);
        d[o + 1] = clamp(rgb3[1], -0.2, 2);
        d[o + 2] = clamp(rgb3[2], -0.2, 2);
        d[o + 3] = clamp(lineNoise, 0, 1);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Pass 1 — reception, picture controls, sync faults, glitching
   * ---------------------------------------------------------------- */

  private passSignal(f: RenderFrame, s: Settings, src: Buf, dst: Buf): void {
    const w = dst.w;
    const h = dst.h;
    const d = dst.d;
    const texelX = 1 / w;

    const brightness = num(s, 'picture.brightness');
    const contrast = num(s, 'picture.contrast');
    const colour = num(s, 'picture.color');
    const tint = (num(s, 'picture.tint') * Math.PI) / 180;
    const sharpness = num(s, 'picture.sharpness');

    const signalOn = bool(s, 'signal.enabled');
    const path = code(s, 'signal.path');
    const lumaBw = num(s, 'signal.lumaBandwidth');
    const chromaBw = num(s, 'signal.chromaBandwidth');
    const chromaDelay = num(s, 'signal.chromaDelay');
    const dotCrawl = num(s, 'signal.dotCrawl');
    const crossColor = num(s, 'signal.crossColor');
    const ringing = num(s, 'signal.ringing');
    const ringingFreq = num(s, 'signal.ringingFreq');
    const ghosting = num(s, 'signal.ghosting');
    const ghostDelay = num(s, 'signal.ghostDelay');
    const snow = num(s, 'signal.snow');
    const snowSize = num(s, 'signal.snowSize');
    const loss = clamp(num(s, 'signal.signalLoss'), 0, 1);
    const interference = num(s, 'signal.interference');
    const interferenceFreq = num(s, 'signal.interferenceFreq');
    const interferenceDrift = num(s, 'signal.interferenceDrift');

    const syncOn = bool(s, 'sync.enabled');
    const hJitter = num(s, 'sync.hJitter');
    const jitterCorr = num(s, 'sync.jitterCorrelation');
    const tearing = num(s, 'sync.tearing');
    const flagging = num(s, 'sync.flagging');
    const headSwitch = num(s, 'sync.headSwitch');
    const headSwitchH = num(s, 'sync.headSwitchHeight');
    const vRoll = num(s, 'sync.vRoll');
    const vHold = num(s, 'sync.vHold');
    const wobble = num(s, 'sync.timebaseWobble');

    const glitchOn = bool(s, 'glitch.enabled');
    const gRate = num(s, 'glitch.rate');
    const gDropout = num(s, 'glitch.dropout');
    const gDropoutLen = num(s, 'glitch.dropoutLength');
    const gLineRepeat = num(s, 'glitch.lineRepeat');
    const gSyncSlip = num(s, 'glitch.syncSlip');
    const gChromaBurst = num(s, 'glitch.chromaBurst');
    const gBlock = num(s, 'glitch.blockCorrupt');
    const gBlockSize = num(s, 'glitch.blockSize');
    const gBlockColour = num(s, 'glitch.blockColour');
    const gPosterize = num(s, 'glitch.posterize');
    const gInvert = num(s, 'glitch.invert');

    const composite = signalOn && path < 1.5;
    const analogue = signalOn && path < 2.5;
    const rf = signalOn && path < 0.5 ? 1 : 0;

    const bandwidthToPixels = (mhz: number) => {
      const cycles = Math.max(mhz, 0.02) * 52.6;
      return Math.max(w / Math.max(cycles * 2, 1), 0.5);
    };
    const pxY = bandwidthToPixels(lumaBw);
    const pxC = bandwidthToPixels(chromaBw);

    const eventClock = () => Math.floor(f.time * mix(1.5, 16, clamp(gRate, 0, 1)));
    const bandGate = (y: number, salt: number, density: number, height: number) => {
      if (density <= 0.0001) return 0;
      const era = eventClock() + f.seed * 71 + salt;
      if (hash11(era) > density) return 0;
      const c = hash11(era * 1.37 + 0.5);
      return 1 - smoothstep(height * 0.4, height, Math.abs(y - c));
    };

    const lowpassH = (u: number, v: number, widthPx: number, outIdx: Float32Array) => {
      if (widthPx <= 0.6) {
        sampleUV(src, u, v, outIdx);
        return;
      }
      const sig = widthPx * 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      const stepX = Math.max(widthPx * 0.45, 0.5);
      for (let k = -4; k <= 4; k++) {
        const x = k * stepX;
        const wt = gauss(x, sig);
        sampleUV(src, u + x * texelX, v, t4b);
        r += t4b[0] * wt;
        g += t4b[1] * wt;
        b += t4b[2] * wt;
        wsum += wt;
      }
      outIdx[0] = r / Math.max(wsum, 1e-5);
      outIdx[1] = g / Math.max(wsum, 1e-5);
      outIdx[2] = b / Math.max(wsum, 1e-5);
    };

    for (let py = 0; py < h; py++) {
      const vBase = (py + 0.5) / h;
      for (let px = 0; px < w; px++) {
        const uBase = (px + 0.5) / w;
        let u = uBase;
        let v = vBase;
        let damage = 0;

        /* ---- timebase ---- */
        if (syncOn) {
          let roll = vRoll * f.time;
          if (vHold > 0) {
            const burst = vnoise(f.time * 0.7 + f.seed, 0);
            const gate = smoothstep(1 - vHold * 0.85, 1, burst);
            roll += gate * f.time * 6 * vHold;
          }
          v = fract(v + roll);
          const line = Math.floor(v * h);
          const lineSeed = line + f.frame * 131 + f.seed * 977;
          const white = hash11(lineSeed) - 0.5;
          const smooth = vnoise(line * 0.06, f.time * 2.3 + f.seed) - 0.5;
          let jitter = mix(white, smooth * 1.6, jitterCorr) * hJitter;
          const topDist = 1 - v;
          jitter += flagging * 26 * Math.exp(-topDist * 34) * (1 + 0.3 * smooth);
          if (tearing > 0) {
            const r = hash11(lineSeed * 1.7);
            const hit = r >= 1 - tearing * 0.06 ? 1 : 0;
            jitter += hit * (hash11(lineSeed * 3.1) - 0.5) * w * 0.35;
            damage = Math.max(damage, hit);
          }
          const wob = Math.sin(f.time * 1.7 + f.seed) * 0.5 + Math.sin(f.time * 0.41) * 0.5;
          const scale = 1 + wobble * 0.012 * wob;
          u = (u - 0.5) / scale + 0.5;
          if (headSwitch > 0 && v < headSwitchH) {
            const t = 1 - v / Math.max(headSwitchH, 1e-4);
            jitter += Math.pow(t, 1.6) * headSwitch * 0.16 * w;
            damage = Math.max(damage, headSwitch * t);
          }
          u += jitter / w;
        }

        /* ---- glitch, coordinate domain ---- */
        let blockErr = 0;
        let chromaSlide = 0;
        let posterizeBand = 0;
        let invertBand = 0;
        if (glitchOn && gRate > 0.0001) {
          const slip = bandGate(v, 3, gSyncSlip * gRate, 0.05);
          if (slip > 0) {
            u += slip * (hash11(eventClock() * 2.9 + f.seed) - 0.5) * 0.45;
            damage = Math.max(damage, slip);
          }
          const rep = bandGate(v, 17, gLineRepeat * gRate, 0.07);
          if (rep > 0.5) {
            v = (Math.floor((v * h) / 18) * 18) / h;
            damage = Math.max(damage, rep);
          }
          if (gBlock > 0.0001) {
            const bs = Math.max(gBlockSize, 2);
            const bx = Math.floor((u * w) / bs);
            const by = Math.floor((v * h) / bs);
            const id = bx * 31.7 + by * 17.3 + eventClock() * 7 + f.seed * 13;
            if (hash11(id) < gBlock * gRate * 0.4) {
              u += (hash11(id) - 0.5) * bs * 6 * texelX;
              v += (hash11(id * 1.7) - 0.5) * bs * 6 / h;
              blockErr = 1;
              damage = Math.max(damage, 0.8);
            }
          }
          chromaSlide = bandGate(v, 29, gChromaBurst * gRate, 0.06);
          posterizeBand = bandGate(v, 41, gPosterize * gRate, 0.09);
          invertBand = bandGate(v, 53, gInvert * gRate, 0.05);
        }

        /* ---- band-limiting, picture controls ---- */
        let yv: number;
        let iv: number;
        let qv: number;

        if (signalOn && path < 3) {
          lowpassH(u, v, pxY, t4);
          yv = rgb2y(t4[0], t4[1], t4[2]);
          const cu = u - (chromaDelay + chromaSlide * 90) * texelX;
          lowpassH(cu, v, pxC, t4);
          iv = rgb2i(t4[0], t4[1], t4[2]);
          qv = rgb2q(t4[0], t4[1], t4[2]);

          if (sharpness > 0 || ringing > 0) {
            const amount = (sharpness - 1) * 0.6 + ringing * 1.4;
            const stepR = Math.max(pxY * 0.6, 1) * texelX;
            let acc = 0;
            for (let k = 1; k <= 3; k++) {
              const dd = k * stepR;
              const wt = Math.cos(k * ringingFreq * 0.9) / k;
              sampleUV(src, u - dd, v, t4);
              const a = rgb2y(t4[0], t4[1], t4[2]);
              sampleUV(src, u + dd, v, t4);
              const b = rgb2y(t4[0], t4[1], t4[2]);
              acc += wt * (a + b - 2 * yv);
            }
            yv -= amount * acc * 0.5;
          }

          if (composite) {
            const line = Math.floor(v * h);
            const carrier = u * w * 0.5 * Math.PI + line * Math.PI + f.frame * Math.PI;
            const chromaMag = Math.hypot(iv, qv);
            sampleUV(src, u + 2 * texelX, v, t4);
            const ei = rgb2i(t4[0], t4[1], t4[2]);
            const eq = rgb2q(t4[0], t4[1], t4[2]);
            const edge = Math.abs(ei - iv) + Math.abs(eq - qv);
            yv += dotCrawl * chromaMag * 0.55 * Math.cos(carrier) * (0.35 + edge * 3);
            lowpassH(u, v, pxY * 3, t4);
            const detail = yv - rgb2y(t4[0], t4[1], t4[2]);
            iv += crossColor * detail * 1.7 * Math.cos(carrier);
            qv += crossColor * detail * 1.7 * Math.sin(carrier);
          }

          if (ghosting > 0) {
            const gu = u - ghostDelay * texelX;
            lowpassH(gu, v, pxY * 1.8, t4);
            const g1y = rgb2y(t4[0], t4[1], t4[2]);
            const g1i = rgb2i(t4[0], t4[1], t4[2]);
            const g1q = rgb2q(t4[0], t4[1], t4[2]);
            lowpassH(gu - ghostDelay * 1.9 * texelX, v, pxY * 2.6, t4);
            const g2y = rgb2y(t4[0], t4[1], t4[2]);
            yv += ghosting * (g1y * 0.42 + g2y * 0.16);
            iv += ghosting * g1i * 0.2;
            qv += ghosting * g1q * 0.2;
          }
        } else {
          sampleUV(src, u, v, t4);
          yv = rgb2y(t4[0], t4[1], t4[2]);
          iv = rgb2i(t4[0], t4[1], t4[2]);
          qv = rgb2q(t4[0], t4[1], t4[2]);
        }

        yv = (yv - 0.5) * contrast + 0.5 + brightness;
        const cs = Math.cos(tint);
        const sn = Math.sin(tint);
        const ni = (cs * iv - sn * qv) * colour;
        const nq = (sn * iv + cs * qv) * colour;
        iv = ni;
        qv = nq;

        if (interference > 0 && analogue) {
          const drift = f.time * interferenceDrift * 3;
          const bars = Math.sin((u * interferenceFreq + v * interferenceFreq * 0.27 + drift) * TAU);
          const env = 0.5 + 0.5 * Math.sin(v * 3.1 - f.time * 0.7);
          yv += interference * 0.06 * bars * (0.4 + env);
          iv += interference * 0.02 * bars;
          qv += interference * 0.02 * bars;
        }

        yiq2rgb(yv, iv, qv, rgb3);
        let r = rgb3[0];
        let g = rgb3[1];
        let b = rgb3[2];

        /* ---- glitch, colour domain ---- */
        if (glitchOn && gRate > 0.0001) {
          if (blockErr > 0.5 && gBlockColour > 0.0001) {
            const bs = Math.max(gBlockSize, 2);
            const id = Math.floor((u * w) / bs) * 13.1 + Math.floor((v * h) / bs) * 7.7 + eventClock() * 3 + f.seed * 5;
            const a = (hash11(id) - 0.5) * TAU;
            const yy = rgb2y(r, g, b);
            const ii = rgb2i(r, g, b);
            const qq = rgb2q(r, g, b);
            const ri = (Math.cos(a) * ii - Math.sin(a) * qq) * (1 + gBlockColour);
            const rq = (Math.sin(a) * ii + Math.cos(a) * qq) * (1 + gBlockColour);
            yiq2rgb(yy, ri, rq, rgb3);
            r = mix(r, rgb3[0], gBlockColour);
            g = mix(g, rgb3[1], gBlockColour);
            b = mix(b, rgb3[2], gBlockColour);
          }
          if (posterizeBand > 0) {
            const levels = mix(26, 3, gPosterize);
            r = mix(r, Math.floor(r * levels + 0.5) / levels, posterizeBand);
            g = mix(g, Math.floor(g * levels + 0.5) / levels, posterizeBand);
            b = mix(b, Math.floor(b * levels + 0.5) / levels, posterizeBand);
          }
          if (invertBand > 0) {
            r = mix(r, 1 - r, invertBand * gInvert);
            g = mix(g, 1 - g, invertBand * gInvert);
            b = mix(b, 1 - b, invertBand * gInvert);
          }
          if (gDropout > 0.0001) {
            const line = Math.floor(v * h);
            const id = line * 7.13 + eventClock() * 313 + f.seed * 97;
            if (hash11(id) <= gDropout * clamp(gRate, 0, 1) * 0.5) {
              const start = hash11(id * 2.17);
              const len = Math.max(gDropoutLen * hash11(id * 3.31), 0.004);
              const edge = len * 0.18;
              const drop =
                smoothstep(start - edge, start + edge, u) *
                (1 - smoothstep(start + len - edge, start + len + edge, u));
              if (drop > 0) {
                const pol = hash11(id * 5.71) > 0.28;
                r = mix(r, pol ? 1.08 : 0.02, drop);
                g = mix(g, pol ? 1.06 : 0.02, drop);
                b = mix(b, pol ? 1.0 : 0.02, drop);
                damage = Math.max(damage, drop);
              }
            }
          }
        }

        /* ---- tuner noise ---- */
        const snowAmount = snow * mix(0.6, 1, rf);
        if (snowAmount > 0 || loss > 0) {
          const nx = Math.floor((uBase * w) / Math.max(snowSize, 0.25));
          const ny = Math.floor((vBase * h) / Math.max(snowSize, 0.25));
          hash32(nx + f.frame * 7.13 + f.seed, ny + f.frame * 3.71 + f.seed, t4);
          const mono = t4[0];
          const kk = 0.25 + rf * 0.35;
          r += (mix(mono, t4[0], kk) - 0.5) * snowAmount * 0.7;
          g += (mix(mono, t4[1], kk) - 0.5) * snowAmount * 0.7;
          b += (mix(mono, t4[2], kk) - 0.5) * snowAmount * 0.7;
          if (loss > 0) {
            const residue = smoothstep(0.75, 1, loss);
            const k2 = loss * (1 - residue * 0.15);
            const gain = 0.85 + 0.3 * mono;
            r = mix(r, mix(mono, t4[0], 0.3) * gain, k2);
            g = mix(g, mix(mono, t4[1], 0.3) * gain, k2);
            b = mix(b, mix(mono, t4[2], 0.3) * gain, k2);
          }
        }

        const o = (py * w + px) * 4;
        const carried = sampleUVc(src, u, v, 3);
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = Math.max(Math.max(damage, loss), carried);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Pass 2 — phosphor persistence
   * ---------------------------------------------------------------- */

  private passPersist(s: Settings, cur: Buf, prev: Buf, dst: Buf, dt: number): void {
    const persistence = bool(s, 'phosphor.enabled') ? num(s, 'phosphor.persistence') : 0;
    const d = dst.d;
    if (persistence <= 0.0005) {
      d.set(cur.d);
      return;
    }
    const tilt = num(s, 'phosphor.persistenceTilt');
    const halfLife = mix(0.004, 0.42, Math.pow(persistence, 1.6));
    const br = Math.max(halfLife * (1 - Math.max(tilt, 0) * 0.45), 1e-4);
    const bg = Math.max(halfLife * (1 + Math.abs(tilt) * 0.55), 1e-4);
    const bb = Math.max(halfLife * (1 - Math.max(-tilt, 0) * 0.45), 1e-4);
    const dr = Math.pow(2, -dt / br);
    const dg = Math.pow(2, -dt / bg);
    const db = Math.pow(2, -dt / bb);
    const c = cur.d;
    const p = prev.d;
    for (let i = 0, n = d.length; i < n; i += 4) {
      const pr = p[i] * dr;
      const pg = p[i + 1] * dg;
      const pb = p[i + 2] * db;
      d[i] = c[i] > pr ? c[i] : pr;
      d[i + 1] = c[i + 1] > pg ? c[i + 1] : pg;
      d[i + 2] = c[i + 2] > pb ? c[i + 2] : pb;
      d[i + 3] = c[i + 3];
    }
  }

  /* ---------------------------------------------------------------- *
   * Pass 3 — burn-in accumulator
   * ---------------------------------------------------------------- */

  private passBurnin(s: Settings, cur: Buf, prev: Buf, dst: Buf, dt: number): void {
    if (!(bool(s, 'faults.enabled') && num(s, 'faults.burnIn') > 0.001)) {
      dst.d.set(prev.d);
      return;
    }
    const k = clamp(num(s, 'faults.burnInRate') * dt * 60, 0, 1);
    const d = dst.d;
    const p = prev.d;
    for (let py = 0; py < dst.h; py++) {
      const v = (py + 0.5) / dst.h;
      for (let px = 0; px < dst.w; px++) {
        const u = (px + 0.5) / dst.w;
        sampleUV(cur, u, v, t4);
        const o = (py * dst.w + px) * 4;
        d[o] = mix(p[o], t4[0], k);
        d[o + 1] = mix(p[o + 1], t4[1], k);
        d[o + 2] = mix(p[o + 2], t4[2], k);
        d[o + 3] = 1;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Passes 4-6 — bright pass and the two blur chains
   * ---------------------------------------------------------------- */

  private passGlow(s: Settings, screen: Buf): void {
    const bright = this.bright!;
    const tmp = this.tmp!;
    const bloom = this.bloom!;
    const halA = this.halA!;
    const halB = this.halB!;

    const threshold = num(s, 'glow.threshold');
    const bd = bright.d;
    for (let py = 0; py < bright.h; py++) {
      const v = (py + 0.5) / bright.h;
      for (let px = 0; px < bright.w; px++) {
        const u = (px + 0.5) / bright.w;
        sampleUV(screen, u, v, t4);
        const l = luma(t4[0], t4[1], t4[2]);
        const k = Math.max(l - threshold, 0) / Math.max(1 - threshold, 1e-3);
        const kk = k * k;
        const o = (py * bright.w + px) * 4;
        bd[o] = t4[0] * kk;
        bd[o + 1] = t4[1] * kk;
        bd[o + 2] = t4[2] * kk;
        bd[o + 3] = 1;
      }
    }

    const radius = num(s, 'glow.bloomRadius');
    this.blur(bright, tmp, radius, 1, 0);
    this.blur(tmp, bloom, radius, 0, 1);

    // Halation runs at a quarter the resolution again, which is both how the
    // GPU path does it and the only reason a wide blur is affordable here.
    const halRadius = num(s, 'glow.halationRadius');
    this.resample(bloom, halA);
    this.blur(halA, halB, halRadius, 1, 0);
    this.blur(halB, halA, halRadius, 0, 1);
  }

  private resample(srcB: Buf, dst: Buf): void {
    const d = dst.d;
    for (let py = 0; py < dst.h; py++) {
      const v = (py + 0.5) / dst.h;
      for (let px = 0; px < dst.w; px++) {
        const u = (px + 0.5) / dst.w;
        sampleUV(srcB, u, v, t4);
        const o = (py * dst.w + px) * 4;
        d[o] = t4[0];
        d[o + 1] = t4[1];
        d[o + 2] = t4[2];
        d[o + 3] = 1;
      }
    }
  }

  private blur(srcB: Buf, dst: Buf, radius: number, dx: number, dy: number): void {
    const sigma = Math.max(radius, 0.35);
    const stepPx = Math.max(sigma * 0.42, 0.6);
    const d = dst.d;
    const texelX = 1 / srcB.w;
    const texelY = 1 / srcB.h;
    const weights: number[] = [];
    for (let k = -6; k <= 6; k++) weights.push(gauss(k * stepPx, sigma));

    for (let py = 0; py < dst.h; py++) {
      const v = (py + 0.5) / dst.h;
      for (let px = 0; px < dst.w; px++) {
        const u = (px + 0.5) / dst.w;
        let r = 0;
        let g = 0;
        let b = 0;
        let wsum = 0;
        for (let k = -6; k <= 6; k++) {
          const wt = weights[k + 6];
          const off = k * stepPx;
          sampleUV(srcB, u + dx * off * texelX, v + dy * off * texelY, t4);
          r += t4[0] * wt;
          g += t4[1] * wt;
          b += t4[2] * wt;
          wsum += wt;
        }
        const o = (py * dst.w + px) * 4;
        const iw = 1 / Math.max(wsum, 1e-5);
        d[o] = r * iw;
        d[o + 1] = g * iw;
        d[o + 2] = b * iw;
        d[o + 3] = 1;
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Pass 7 — the tube
   * ---------------------------------------------------------------- */

  private passTube(f: RenderFrame, s: Settings, tel: RenderTelemetry): void {
    const canvas = this.canvas;
    const outW = Math.max(1, canvas.width);
    const outH = Math.max(1, canvas.height);
    if (!this.out || this.out.width !== outW || this.out.height !== outH) {
      this.out = this.ctx.createImageData(outW, outH);
    }
    const px = this.out.data;

    const screen = this.screenB!;
    const bloom = this.bloom!;
    const halation = this.halA!;
    const burn = this.burnB!;

    const geomOn = bool(s, 'geometry.enabled');
    const curvatureX = num(s, 'geometry.curvatureX');
    const curvatureY = num(s, 'geometry.curvatureY');
    const cornerRadius = num(s, 'geometry.cornerRadius');
    const overscan = num(s, 'geometry.overscan');
    const hSize = Math.max(num(s, 'geometry.hSize'), 0.01);
    const vSize = Math.max(num(s, 'geometry.vSize'), 0.01);
    const hPos = num(s, 'geometry.hPos');
    const vPos = num(s, 'geometry.vPos');
    const pincushion = num(s, 'geometry.pincushion');
    const trapezoid = num(s, 'geometry.trapezoid');
    const rotation = (num(s, 'geometry.rotation') * Math.PI) / 180;
    const aspectMode = code(s, 'geometry.aspect');

    const beamOn = bool(s, 'beam.enabled');
    const scanMode = code(s, 'beam.scanMode');
    const lineCount = num(s, 'beam.lineCount');
    const scanlineDepth = clamp(num(s, 'beam.scanlineDepth'), 0, 1);
    const beamWidth = Math.max(num(s, 'beam.beamWidth'), 0.05);
    const beamBloom = num(s, 'beam.beamBloom');
    const beamShape = Math.max(num(s, 'beam.beamShape'), 0.5);
    const brightBoost = num(s, 'beam.brightBoost');
    const beamNorm = Math.max(beamNormalisation(beamWidth, beamShape), 0.05);
    const interlaceFlicker = num(s, 'beam.interlaceFlicker');
    const fieldBlend = num(s, 'beam.fieldBlend');

    const phosphorOn = bool(s, 'phosphor.enabled');
    const maskType = code(s, 'phosphor.maskType');
    const maskPitch = Math.max(num(s, 'phosphor.maskPitch'), 1);
    const maskStrength = num(s, 'phosphor.maskStrength');
    const maskBoost = num(s, 'phosphor.maskBoost');
    const slotStagger = num(s, 'phosphor.slotStagger');
    const maskNorm = maskNormalisation(maskType, maskPitch, slotStagger);
    const gamut = num(s, 'phosphor.gamut');

    const colourOn = bool(s, 'colour.enabled');
    const temperature = num(s, 'colour.temperature');
    const tintGM = num(s, 'colour.tintGM');
    const gainR = num(s, 'colour.redGain');
    const gainG = num(s, 'colour.greenGain');
    const gainB = num(s, 'colour.blueGain');
    const liftR = num(s, 'colour.redLift');
    const liftG = num(s, 'colour.greenLift');
    const liftB = num(s, 'colour.blueLift');
    const hue = (num(s, 'colour.hue') * Math.PI) / 180;
    const saturation = num(s, 'colour.saturation');
    const vibrance = num(s, 'colour.vibrance');
    const chromaCrush = num(s, 'colour.chromaCrush');
    const colourKiller = num(s, 'colour.colourKiller');
    const chromaClip = Math.max(num(s, 'colour.chromaClip'), 0.05);

    const glowOn = bool(s, 'glow.enabled');
    const bloomAmount = num(s, 'glow.bloom');
    const halationAmount = num(s, 'glow.halation');
    const halationTint = num(s, 'glow.halationTint');
    const diffusion = num(s, 'glow.diffusion');
    const vignette = num(s, 'glow.vignette');
    const glare = num(s, 'glow.glare');

    const convOn = bool(s, 'convergence.enabled');
    const convRedX = num(s, 'convergence.redX');
    const convRedY = num(s, 'convergence.redY');
    const convBlueX = num(s, 'convergence.blueX');
    const convBlueY = num(s, 'convergence.blueY');
    const convRadial = num(s, 'convergence.radial');
    const focus = num(s, 'convergence.focus');
    const edgeFocus = num(s, 'convergence.edgeFocus');

    const tubeOn = bool(s, 'tube.enabled');
    const gammaV = num(s, 'tube.gamma');
    const blackCrush = num(s, 'tube.blackCrush');
    const whiteClip = Math.max(num(s, 'tube.whiteClip'), 0.05);
    const humBar = num(s, 'tube.humBar');
    const humBarWidth = Math.max(num(s, 'tube.humBarWidth'), 0.02);
    const agcPump = num(s, 'tube.agcPump');
    const psuSag = num(s, 'tube.psuSag');
    const flicker = num(s, 'tube.flicker');

    const faultsOn = bool(s, 'faults.enabled');
    const burnIn = num(s, 'faults.burnIn');
    const dirt = num(s, 'faults.dirt');
    const moire = num(s, 'faults.moire');

    const bezel = num(s, 'output.bezel');
    const bezelShadow = num(s, 'output.bezelShadow');
    const roomLight = num(s, 'output.roomLight');
    const dither = num(s, 'output.dither');
    const exposure = num(s, 'output.exposure');

    const linkOn = bool(s, 'link.enabled');
    const linkBrightness = linkOn ? num(s, 'link.audioToBrightness') : 0;
    const linkBloom = linkOn ? num(s, 'link.audioToBloom') : 0;
    const audioLevel = f.audioLevel;

    const degauss = tel.degauss;
    const open = clamp(tel.powerOpen, 0, 1);
    const powerDot = this.state.powerDot;

    const srcAspect = this.srcW / Math.max(this.srcH, 1);
    const tubeAspect = aspectMode < 0.5 ? 4 / 3 : aspectMode < 1.5 ? 16 / 9 : srcAspect;
    const outAspect = outW / Math.max(outH, 1);

    const screenTexelX = 1 / screen.w;
    const screenTexelY = 1 / screen.h;

    // Grey-scale tracking multipliers, normalised to preserve white's luminance.
    let wbR = 1 - temperature * 0.2 - tintGM * 0.05;
    let wbG = 1 + tintGM * 0.09;
    let wbB = 1 + temperature * 0.26 - tintGM * 0.05;
    wbR = Math.max(wbR, 0.02);
    wbG = Math.max(wbG, 0.02);
    wbB = Math.max(wbB, 0.02);
    const wbL = Math.max(luma(wbR, wbG, wbB), 1e-4);
    wbR /= wbL;
    wbG /= wbL;
    wbB /= wbL;

    const bezelR = 0.055;
    const bezelG = 0.052;
    const bezelB = 0.049;

    const stripeW = new Float32Array(3);
    const maskW = new Float32Array(3);

    const stripeWeights = (phase: number, softness: number) => {
      let m = 1e-4;
      for (let i = 0; i < 3; i++) {
        let dd = Math.abs(phase - (i + 0.5));
        dd = Math.min(dd, 3 - dd);
        stripeW[i] = Math.exp(-(dd * dd) / (2 * softness * softness));
        if (stripeW[i] > m) m = stripeW[i];
      }
      stripeW[0] /= m;
      stripeW[1] /= m;
      stripeW[2] /= m;
    };

    const phosphorMask = (fx: number, fy: number) => {
      if (maskType === 0) {
        maskW[0] = maskW[1] = maskW[2] = 1;
        return;
      }
      const soft = clamp(0.28 + 0.55 / maskPitch, 0.28, 0.75);
      if (maskType === 1) {
        stripeWeights(fract(fx / maskPitch) * 3, soft);
        maskW.set(stripeW);
        return;
      }
      if (maskType === 2) {
        const col = Math.floor(fx / maskPitch);
        const rowPitch = maskPitch * 2;
        const stagger = (col % 2 === 0 ? 0 : 1) * slotStagger * rowPitch * 0.5;
        const rowPhase = fract((fy + stagger) / rowPitch);
        const slot = smoothstep(0, 0.16, rowPhase) * smoothstep(1, 0.84, rowPhase);
        stripeWeights(fract(fx / maskPitch) * 3, soft);
        const k = mix(0.62, 1, slot);
        maskW[0] = stripeW[0] * k;
        maskW[1] = stripeW[1] * k;
        maskW[2] = stripeW[2] * k;
        return;
      }
      const rowPitch = maskPitch * 1.732;
      const row = Math.floor(fy / rowPitch);
      const offset = (row % 2 === 0 ? 0 : 1) * 0.5;
      const phase = fract(fx / maskPitch + offset) * 3;
      const rowPhase = fract(fy / rowPitch);
      const dotv = smoothstep(0, 0.3, rowPhase) * smoothstep(1, 0.7, rowPhase);
      stripeWeights(phase, soft * 1.15);
      const k = mix(0.7, 1, dotv);
      maskW[0] = stripeW[0] * k;
      maskW[1] = stripeW[1] * k;
      maskW[2] = stripeW[2] * k;
    };

    const gunAcc = new Float32Array(4);
    const sampleGuns = (u: number, v: number, pxn: number, pyn: number, blurPx: number) => {
      let rOffX = 0;
      let rOffY = 0;
      let bOffX = 0;
      let bOffY = 0;
      if (convOn) {
        const radial = 1 + convRadial * (pxn * pxn + pyn * pyn);
        rOffX = convRedX * radial * screenTexelX + pxn * convRadial * 0.6 * screenTexelX;
        rOffY = convRedY * radial * screenTexelY + pyn * convRadial * 0.6 * screenTexelY;
        bOffX = convBlueX * radial * screenTexelX - pxn * convRadial * 0.6 * screenTexelX;
        bOffY = convBlueY * radial * screenTexelY - pyn * convRadial * 0.6 * screenTexelY;
      }
      const sp = blurPx * screenTexelX;
      const W0 = 0.5;
      const W1 = 0.25;
      gunAcc[0] =
        sampleUVc(screen, u + rOffX, v + rOffY, 0) * W0 +
        sampleUVc(screen, u + rOffX + sp, v + rOffY, 0) * W1 +
        sampleUVc(screen, u + rOffX - sp, v + rOffY, 0) * W1;
      gunAcc[1] =
        sampleUVc(screen, u, v, 1) * W0 +
        sampleUVc(screen, u + sp, v, 1) * W1 +
        sampleUVc(screen, u - sp, v, 1) * W1;
      gunAcc[2] =
        sampleUVc(screen, u + bOffX, v + bOffY, 2) * W0 +
        sampleUVc(screen, u + bOffX + sp, v + bOffY, 2) * W1 +
        sampleUVc(screen, u + bOffX - sp, v + bOffY, 2) * W1;
    };

    const sum3 = new Float32Array(3);
    const flat3 = new Float32Array(3);

    for (let y = 0; y < outH; y++) {
      const outV = (y + 0.5) / outH;
      for (let x = 0; x < outW; x++) {
        const outU = (x + 0.5) / outW;
        const o = (y * outW + x) * 4;

        let pxn = outU * 2 - 1;
        let pyn = outV * 2 - 1;
        if (outAspect > tubeAspect) pxn *= outAspect / tubeAspect;
        else pyn *= tubeAspect / outAspect;

        // ---- geometry ----
        let wx = pxn;
        let wy = pyn;
        if (geomOn) {
          const ca = Math.cos(rotation);
          const sa = Math.sin(rotation);
          const rx = ca * wx - sa * wy;
          const ry = sa * wx + ca * wy;
          wx = rx;
          wy = ry;
          wx *= 1 + trapezoid * wy;
          const cx = wx;
          const cy = wy;
          wx *= 1 + pincushion * cy * cy;
          wy *= 1 + pincushion * cx * cx;
          const c2x = wx;
          const c2y = wy;
          wx *= 1 + curvatureX * c2y * c2y;
          wy *= 1 + curvatureY * c2x * c2x;
          wx /= hSize;
          wy /= vSize;
          wx -= hPos * 2;
          wy -= vPos * 2;
        }

        if (open < 0.999) {
          if (open < 0.002) {
            const dotGlow = powerDot * Math.exp(-(wx * wx + wy * wy) * 900);
            px[o] = clamp(dotGlow + bezelR * bezel, 0, 1) * 255;
            px[o + 1] = clamp(dotGlow + bezelG * bezel, 0, 1) * 255;
            px[o + 2] = clamp(dotGlow + bezelB * bezel, 0, 1) * 255;
            px[o + 3] = 255;
            continue;
          }
          wy /= Math.max(open, 0.002);
        }

        let degaussHue = 0;
        if (faultsOn && degauss > 0.0001) {
          const dlen = Math.hypot(wx, wy);
          const wave = Math.sin(dlen * 22 - f.time * 26) * Math.exp(-dlen * 1.4);
          const nl = Math.max(Math.hypot(wx, wy), 1e-5);
          wx += (wx / nl) * wave * degauss * 0.035;
          wy += (wy / nl) * wave * degauss * 0.035;
          degaussHue = wave * degauss;
        }

        // Rounded-rectangle signed distance.
        const rr = geomOn ? cornerRadius : 0;
        const qx = Math.abs(wx) - (1 - rr);
        const qy = Math.abs(wy) - (1 - rr);
        const sdf =
          Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;

        let u = wx * 0.5 + 0.5;
        let v = wy * 0.5 + 0.5;
        const os = geomOn ? overscan : 0;
        u = (u - 0.5) * (1 - os * 2) + 0.5;
        v = (v - 0.5) * (1 - os * 2) + 0.5;

        if (sdf > 0 || u < 0 || u > 1 || v < 0 || v > 1) {
          const shade = 1 - bezelShadow * Math.exp(-Math.max(sdf, 0) * 26);
          px[o] = clamp(bezelR * shade * bezel, 0, 1) * 255;
          px[o + 1] = clamp(bezelG * shade * bezel, 0, 1) * 255;
          px[o + 2] = clamp(bezelB * shade * bezel, 0, 1) * 255;
          px[o + 3] = 255;
          continue;
        }

        sampleUV(halation, u, v, t4);
        const halR = t4[0];
        const halG = t4[1];
        const halB = t4[2];
        sampleUV(bloom, u, v, t4b);
        const localLevel = clamp(luma(halR, halG, halB) * 1.6, 0, 1);

        let blurPx = 0;
        if (convOn) blurPx = (focus + edgeFocus * (pxn * pxn + pyn * pyn) * 0.9) * 2.4;

        let cr: number;
        let cg: number;
        let cb: number;

        if (beamOn && scanMode < 1.5) {
          const interlaced = scanMode > 0.5;
          const parity = interlaced ? f.frame % 2 : 0;
          const lines = interlaced ? Math.max(lineCount * 0.5, 1) : Math.max(lineCount, 1);
          const shift = interlaced ? parity * 0.5 : 0;
          const ly = v * lines - shift;
          const base = Math.floor(ly - 0.5);
          const sagBloom = linkBloom * audioLevel;

          sum3[0] = sum3[1] = sum3[2] = 0;
          flat3[0] = flat3[1] = flat3[2] = 0;
          for (let i = -1; i <= 2; i++) {
            const n = base + i;
            const centre = (n + 0.5 + shift) / lines;
            sampleGuns(u, clamp(centre, 0, 1), pxn, pyn, blurPx);
            const l = luma(gunAcc[0], gunAcc[1], gunAcc[2]);
            const halfWidth = beamWidth * 0.5 * (1 + (beamBloom + sagBloom) * l * 1.25);
            const dd = Math.abs(ly - (n + 0.5)) / Math.max(halfWidth, 0.02);
            const wt = Math.exp(-Math.pow(dd, beamShape));
            sum3[0] += gunAcc[0] * wt;
            sum3[1] += gunAcc[1] * wt;
            sum3[2] += gunAcc[2] * wt;
            if (i === 0 || i === 1) {
              flat3[0] += gunAcc[0] * 0.5;
              flat3[1] += gunAcc[1] * 0.5;
              flat3[2] += gunAcc[2] * 0.5;
            }
          }
          cr = mix(flat3[0], sum3[0] / beamNorm, scanlineDepth) * brightBoost;
          cg = mix(flat3[1], sum3[1] / beamNorm, scanlineDepth) * brightBoost;
          cb = mix(flat3[2], sum3[2] / beamNorm, scanlineDepth) * brightBoost;

          if (interlaced && interlaceFlicker > 0) {
            const shimmer = (parity * 2 - 1) * interlaceFlicker * 0.06;
            cr *= 1 + shimmer;
            cg *= 1 + shimmer;
            cb *= 1 + shimmer;
            cr = mix(cr, flat3[0] * brightBoost, fieldBlend * 0.5);
            cg = mix(cg, flat3[1] * brightBoost, fieldBlend * 0.5);
            cb = mix(cb, flat3[2] * brightBoost, fieldBlend * 0.5);
          }
        } else {
          sampleGuns(u, v, pxn, pyn, blurPx);
          cr = gunAcc[0];
          cg = gunAcc[1];
          cb = gunAcc[2];
        }

        // ---- grey-scale tracking ----
        if (colourOn) {
          cr = Math.max(cr * wbR * gainR + liftR, 0);
          cg = Math.max(cg * wbG * gainG + liftG, 0);
          cb = Math.max(cb * wbB * gainB + liftB, 0);
        }

        // ---- phosphor mask ----
        if (phosphorOn && maskStrength > 0.001) {
          // gl_FragCoord is the pixel *centre* and its origin is bottom-left,
          // so an integer top-left index is half a pixel out in x and half a
          // pixel plus a flip out in y. At a three-pixel mask pitch that is a
          // sixth of a triad, which is plainly visible as a brightness shift.
          phosphorMask(x + 0.5, outH - y - 0.5);
          cr *= mix(1, maskW[0] * maskNorm, maskStrength) * maskBoost;
          cg *= mix(1, maskW[1] * maskNorm, maskStrength) * maskBoost;
          cb *= mix(1, maskW[2] * maskNorm, maskStrength) * maskBoost;
        }

        // ---- P22 gamut ----
        if (phosphorOn && gamut > 0.001) {
          const gr = 0.93 * cr + 0.045 * cg + 0.02 * cb;
          const gg = 0.055 * cr + 0.9 * cg + 0.075 * cb;
          const gb = 0.015 * cr + 0.055 * cg + 0.905 * cb;
          cr = mix(cr, gr, gamut);
          cg = mix(cg, gg, gamut);
          cb = mix(cb, gb, gamut);
        }

        // ---- chroma behaviour of the decoder ----
        if (colourOn) {
          let yy = rgb2y(cr, cg, cb);
          let ii = rgb2i(cr, cg, cb);
          let qq = rgb2q(cr, cg, cb);
          const mag = Math.hypot(ii, qq);
          const ca = Math.cos(hue);
          const sa = Math.sin(hue);
          let ni = ca * ii - sa * qq;
          let nq = sa * ii + ca * qq;
          const weak = 1 - clamp(mag * 2.4, 0, 1);
          const satK = saturation * (1 + vibrance * weak * 1.3);
          ni *= satK;
          nq *= satK;
          if (chromaCrush > 0.0001) {
            const knee = chromaCrush * 0.14;
            const k = smoothstep(0, Math.max(knee, 1e-4), mag);
            ni *= k;
            nq *= k;
          }
          if (colourKiller > 0.0001) {
            const th = colourKiller * 0.3;
            const k = smoothstep(th * 0.55, th, mag);
            ni *= k;
            nq *= k;
          }
          const newMag = Math.hypot(ni, nq);
          if (newMag > chromaClip) {
            const excess = newMag - chromaClip;
            const k = chromaClip / Math.max(newMag, 1e-5);
            ni *= k;
            nq *= k;
            yy += excess * 0.35;
          }
          yiq2rgb(yy, ni, nq, rgb3);
          cr = rgb3[0];
          cg = rgb3[1];
          cb = rgb3[2];
        }

        // ---- tube transfer function ----
        if (tubeOn) {
          const g = gammaV / 2.2;
          cr = safePow(Math.max(cr, 0), g);
          cg = safePow(Math.max(cg, 0), g);
          cb = safePow(Math.max(cb, 0), g);
          const crush = blackCrush * 0.06;
          const denom = Math.max(1 - crush, 1e-3);
          cr = Math.max(cr - crush, 0) / denom;
          cg = Math.max(cg - crush, 0) / denom;
          cb = Math.max(cb - crush, 0) / denom;
          cr = Math.min(cr, whiteClip) + Math.max(cr - whiteClip, 0) * 0.15;
          cg = Math.min(cg, whiteClip) + Math.max(cg - whiteClip, 0) * 0.15;
          cb = Math.min(cb, whiteClip) + Math.max(cb - whiteClip, 0) * 0.15;
        }

        // ---- glass ----
        if (glowOn) {
          cr += t4b[0] * bloomAmount;
          cg += t4b[1] * bloomAmount;
          cb += t4b[2] * bloomAmount;
          const tr = mix(1, 1.0, halationTint);
          const tg = mix(1, 0.72, halationTint);
          const tb = mix(1, 0.48, halationTint);
          cr += halR * tr * halationAmount * 0.8;
          cg += halG * tg * halationAmount * 0.8;
          cb += halB * tb * halationAmount * 0.8;
          const dif = localLevel * diffusion * 0.14;
          cr += dif;
          cg += dif;
          cb += dif;
        }

        // ---- rail and gain behaviour ----
        if (tubeOn) {
          if (humBar > 0.001) {
            const dd = Math.abs(fract(v + tel.humPhase) - 0.5);
            const bar = Math.exp(-(dd * dd) / (2 * humBarWidth * humBarWidth * 0.25));
            const k = 1 + humBar * 0.28 * bar;
            cr = cr * k + humBar * 0.03 * bar;
            cg = cg * k + humBar * 0.03 * bar;
            cb = cb * k + humBar * 0.03 * bar;
          }
          const agc = clamp(1 - agcPump * 0.35 * (localLevel - 0.35), 0.4, 1.6);
          cr *= agc;
          cg *= agc;
          cb *= agc;
          const sag = clamp(psuSag * (localLevel * 0.7 + linkBrightness * audioLevel), 0, 0.9);
          const sk = 1 - sag * 0.22;
          cr *= sk;
          cg *= sk;
          cb *= sk;
          if (flicker > 0.001) {
            const fl = vnoise(f.time * 9 + f.seed, 0) - 0.5;
            const k = 1 + fl * flicker * 0.14;
            cr *= k;
            cg *= k;
            cb *= k;
          }
        }

        if (degaussHue !== 0) {
          const yy = rgb2y(cr, cg, cb);
          const ii = rgb2i(cr, cg, cb);
          const qq = rgb2q(cr, cg, cb);
          const a = degaussHue * 2.2;
          const k = 1 + Math.abs(degaussHue) * 0.8;
          yiq2rgb(yy, (Math.cos(a) * ii - Math.sin(a) * qq) * k, (Math.sin(a) * ii + Math.cos(a) * qq) * k, rgb3);
          const boost = 1 + Math.abs(degaussHue) * 0.25;
          cr = rgb3[0] * boost;
          cg = rgb3[1] * boost;
          cb = rgb3[2] * boost;
        }

        // ---- wear ----
        if (faultsOn) {
          if (burnIn > 0.001) {
            sampleUV(burn, u, v, t4);
            const retained = clamp(luma(t4[0], t4[1], t4[2]), 0, 1);
            const k = 1 - burnIn * 0.55 * retained;
            cr *= k;
            cg *= k;
            cb *= k;
          }
          if (dirt > 0.001) {
            const smear = fbm(u * 6 + f.seed, v * 4 + f.seed);
            const specks = smoothstep(0.86, 1, vnoise(u * 90 + f.seed * 3, v * 90 + f.seed * 3));
            const edgeBias = 0.35 + 0.65 * (pxn * pxn + pyn * pyn);
            const k = 1 - dirt * (smear * 0.22 + specks * 0.5) * edgeBias;
            const add = dirt * specks * 0.02;
            cr = cr * k + add;
            cg = cg * k + add;
            cb = cb * k + add;
          }
          if (moire > 0.001) {
            const beat =
              Math.sin(v * lineCount * Math.PI) * Math.sin(((x + 0.5) / maskPitch) * Math.PI);
            const detail = clamp(Math.abs(luma(t4b[0], t4b[1], t4b[2])) * 3, 0, 1);
            const k = 1 + moire * 0.12 * beat * detail;
            cr *= k;
            cg *= k;
            cb *= k;
          }
        }

        // ---- the room ----
        if (glowOn && vignette > 0.001) {
          const r2 = pxn * pxn + pyn * pyn;
          const k = 1 - vignette * 0.45 * r2 * r2;
          cr *= k;
          cg *= k;
          cb *= k;
        }
        if (glare > 0.001) {
          const gx = (pxn + 0.45) * 1.1;
          const gy = (pyn - 0.5) * 2.4;
          const sheet = Math.exp(-(gx * gx + gy * gy) * 1.6);
          const add = glare * sheet * 0.09;
          cr += add;
          cg += add;
          cb += add;
        }
        cr += roomLight;
        cg += roomLight;
        cb += roomLight;

        const edgeK = 1 - bezelShadow * 0.9 * smoothstep(-0.12, 0, sdf);
        cr *= edgeK * exposure;
        cg *= edgeK * exposure;
        cb *= edgeK * exposure;

        if (dither > 0.001) {
          const n = ign(x + 0.5 + (f.frame % 64) * 5.588, outH - y - 0.5) - 0.5;
          const add = n * dither * (1.5 / 255);
          cr += add;
          cg += add;
          cb += add;
        }

        px[o] = clamp(cr, 0, 1) * 255;
        px[o + 1] = clamp(cg, 0, 1) * 255;
        px[o + 2] = clamp(cb, 0, 1) * 255;
        px[o + 3] = 255;
      }
    }

    this.ctx.putImageData(this.out, 0, 0);
  }
}
