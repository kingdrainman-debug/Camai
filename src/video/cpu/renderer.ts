/**
 * The CPU backend.
 *
 * A complete second implementation of the render chain that needs no GPU at
 * all. It exists for three reasons, none of them speed:
 *
 *   - Machines where WebGL2 is missing, blocked or broken.
 *   - Headless and batch rendering on a server or in CI, where the GPU path
 *     either is not present or quietly produces black frames.
 *   - Determinism. GPU floating point varies between vendors and drivers, so
 *     the same project can render subtly differently on two machines. This
 *     path produces identical bytes everywhere.
 *
 * It is much slower than the GPU path and always will be. It is helped a
 * great deal by film itself: a film frame is held for several display frames,
 * and the expensive part — exposing, developing and printing it — is done once
 * per film frame and cached, while only the projector pass runs every frame.
 */

import { BufferSizes, FrameState, bufferSizes, frameState } from '../../film/clock';
import { PassParams, passParams } from '../../film/passes';
import { RenderFrame, RenderTelemetry, audioDim } from '../renderer';
import type { FrameSource } from '../backend';
import { SourceSlots, placeFilmFrames, settingsKey } from '../sources';
import { Buf, ensureBuf, makeBuf } from './core';
import { blurPass, cameraPass, downPass, filmPass, presentPass } from './film';

export class CpuRenderer {
  readonly backend = 'cpu' as const;

  private ctx: CanvasRenderingContext2D;
  private blit: HTMLCanvasElement;
  private blitCtx: CanvasRenderingContext2D;
  private out: ImageData | null = null;

  private slots: SourceSlots<Buf>;
  private E: Buf | null = null;
  private Q: Buf | null = null;
  private T1: Buf | null = null;
  private H: Buf | null = null;
  private Qs: Buf | null = null;
  private T2: Buf | null = null;
  private V: Buf | null = null;
  private T3: Buf | null = null;
  private T4: Buf | null = null;
  private S: Buf | null = null;
  private film: [Buf | null, Buf | null] = [null, null];
  private filmKeys: string[] = ['', ''];

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('could not get a 2D context for the CPU renderer');
    this.ctx = ctx;
    this.blit = document.createElement('canvas');
    const bctx = this.blit.getContext('2d', { willReadFrequently: true });
    if (!bctx) throw new Error('could not get a 2D context to read the source');
    this.blitCtx = bctx;
    this.slots = new SourceSlots([makeBuf(2, 2), makeBuf(2, 2)]);
  }

  get sourceSize(): { width: number; height: number } {
    return this.slots.size;
  }

  hasFrame(filmFrame: number): boolean {
    return this.slots.has(filmFrame);
  }

  resetHistory(): void {
    this.filmKeys = ['', ''];
  }

  dispose(): void {
    this.E = this.Q = this.T1 = this.H = this.Qs = this.T2 = this.V = this.T3 = this.T4 = this.S = null;
    this.film = [null, null];
  }

  /**
   * Read a frame of source material into a float buffer, bottom row first, as
   * the GPU path's UNPACK_FLIP_Y_WEBGL leaves its texture.
   */
  setSource(source: FrameSource | null, width: number, height: number, filmFrame = 0): void {
    if (!source || width < 1 || height < 1) return;
    if (this.blit.width !== width || this.blit.height !== height) {
      this.blit.width = width;
      this.blit.height = height;
    }
    this.blitCtx.drawImage(source, 0, 0, width, height);
    const img = this.blitCtx.getImageData(0, 0, width, height);
    const slot = this.slots.claim(filmFrame, width, height);
    const buf = ensureBuf(slot.handle, width, height);
    this.slots.handles[slot.index] = buf;
    const d = buf.d;
    const s = img.data;
    const inv = 1 / 255;
    for (let y = 0; y < height; y++) {
      const from = (height - 1 - y) * width * 4;
      const to = y * width * 4;
      for (let i = 0; i < width * 4; i++) d[to + i] = s[from + i] * inv;
    }
  }

  private ensureTargets(sizes: BufferSizes, pp: PassParams): void {
    this.E = ensureBuf(this.E, sizes.eW, sizes.eH);
    this.Q = ensureBuf(this.Q, pp.qW, pp.qH);
    this.T1 = ensureBuf(this.T1, pp.qW, pp.qH);
    this.H = ensureBuf(this.H, pp.qW, pp.qH);
    this.Qs = ensureBuf(this.Qs, pp.vW, pp.vH);
    this.T2 = ensureBuf(this.T2, pp.vW, pp.vH);
    this.V = ensureBuf(this.V, pp.vW, pp.vH);
    this.T3 = ensureBuf(this.T3, pp.qW, pp.qH);
    this.T4 = ensureBuf(this.T4, pp.qW, pp.qH);
    this.S = ensureBuf(this.S, pp.qW, pp.qH);
    for (let i = 0; i < 2; i++) {
      const prev = this.film[i];
      this.film[i] = ensureBuf(prev, sizes.fW, sizes.fH);
      if (this.film[i] !== prev) this.filmKeys[i] = '';
    }
  }

  private renderFilmFrame(fs: FrameState, i: 0 | 1, pp: PassParams, dst: Buf, src: Buf): void {
    const field = fs.fields[i];
    const E = this.E!;
    cameraPass(src, E, fs, pp);
    // Each glow chain only runs when something will read it — the GPU runs
    // them regardless, but here a skipped pass is real time saved.
    const hal = fs.tone.halWeights.some((w) => w > 0);
    const veil = fs.flare > 0;
    const streak = fs.streak > 0;
    if (hal || veil) downPass(E, this.Q!, 0);
    if (hal) {
      blurPass(this.Q!, this.T1!, pp.halSigmaQ, 1, 0);
      blurPass(this.T1!, this.H!, pp.halSigmaQ, 0, 1);
    }
    if (veil) {
      downPass(this.Q!, this.Qs!, 0);
      blurPass(this.Qs!, this.T2!, pp.veilSigmaV, 1, 0);
      blurPass(this.T2!, this.V!, pp.veilSigmaV, 0, 1);
    }
    if (streak) {
      downPass(E, this.T3!, Math.max(pp.streakThreshold, 1e-6));
      blurPass(this.T3!, this.T4!, pp.streakSigmaQ, 1, 0);
      blurPass(this.T4!, this.S!, pp.streakSigmaQ, 1, 0);
    }
    filmPass(E, this.H!, this.V!, this.S!, dst, fs, field, pp, { hal, veil, streak });
  }

  render(f: RenderFrame): RenderTelemetry {
    const src = this.slots.size;
    const fs = frameState({
      settings: f.settings,
      time: f.time,
      outFrame: f.outFrame,
      seed: f.seed,
      srcW: src.width,
      srcH: src.height,
    });
    const tel: RenderTelemetry = {
      filmFrame: fs.fields[0].n,
      filmFrame2: fs.fields[1].n,
      capture: fs.fields[0].capture,
      capture2: fs.fields[1].capture,
      lamp: fs.fields[0].lamp,
    };
    const outW = Math.max(1, this.canvas.width);
    const outH = Math.max(1, this.canvas.height);
    const sizes = bufferSizes(fs.geometry, src.height, outH);
    const pp = passParams(fs, sizes, src.height);
    this.ensureTargets(sizes, pp);

    const base = settingsKey(f.settings, f.seed);
    const need: (0 | 1)[] = fs.mixed ? [0, 1] : [0];
    const keys = need.map((i) => `${fs.fields[i].n}|${this.slots.lookup(fs.fields[i].n).version}|${base}`);
    const placed = placeFilmFrames(this.filmKeys, keys, (k, j) => {
      const field = need[j];
      this.renderFilmFrame(fs, field, pp, this.film[k]!, this.slots.lookup(fs.fields[field].n).handle);
    });
    const F0 = this.film[placed[0]]!;
    const F1 = this.film[placed[placed.length - 1]]!;

    if (!this.out || this.out.width !== outW || this.out.height !== outH) {
      this.out = this.ctx.createImageData(outW, outH);
    }
    presentPass(this.out.data, outW, outH, fs, pp, { F0, F1, src: this.slots.lookup(fs.fields[0].n).handle }, {
      splitX: f.splitX,
      dither: Number(f.settings['framing.dither']) || 0,
      frame: f.frame,
      audioDim: audioDim(f),
    });
    this.ctx.putImageData(this.out, 0, 0);
    return tel;
  }
}
