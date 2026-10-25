/**
 * The CPU backend.
 *
 * A complete second implementation of the render chain that needs no GPU at
 * all. It exists for three reasons, none of them speed:
 *
 *   - Machines where WebGL2 is missing, blocked or broken.
 *   - Headless and batch rendering on a server or in CI, where the GPU path
 *     either is not present or quietly produces black frames.
 *   - Checking the GPU. Every pass mirrors its shader, and the smoke test
 *     compares the two: the DCT, the rate control and the concealment are
 *     deterministic integer-friendly maths, which makes agreement achievable.
 *
 * It is much slower than the GPU path and always will be: a frame is two
 * fields of sensor simulation and a full DV encode and decode.
 */

import { frameState, neededTaps } from '../../cam/clock';
import { Automatics } from '../../cam/automatics';
import { FramePlan, planFrame } from '../../cam/plan';
import { RenderFrame, RenderTelemetry, decodeKey, telemetryOf } from '../renderer';
import type { FrameSource } from '../backend';
import { SOURCE_SLOTS, SourceSlots } from '../sources';
import { Buf, ensureBuf, makeBuf } from './core';
import { blurPass, demodPass, dspPass, scenePass, sensorPass, smearPass } from './camera';
import { Coefs, assemblePass, chromaPass, fdctPass, idctPass, makeCoefs, quantisePass } from './codec';
import { postPass, presentPass, uploadPass } from './display';

export class CpuRenderer {
  readonly backend = 'cpu' as const;

  private ctx: CanvasRenderingContext2D;
  private blit: HTMLCanvasElement;
  private blitCtx: CanvasRenderingContext2D;
  private out: ImageData | null = null;
  private slots: SourceSlots<Buf>;
  private auto = new Automatics();
  private lastPlan: FramePlan | null = null;

  private E: Buf | null = null;
  private B1: Buf | null = null;
  private B2: Buf | null = null;
  private smear: Buf | null = null;
  private F: Buf | null = null;
  private G: [Buf | null, Buf | null] = [null, null];
  private pre: [Buf | null, Buf | null] = [null, null];
  private chroma: Buf | null = null;
  private coefs: Coefs | null = null;
  private deq: Float32Array | null = null;
  private qno: Float32Array | null = null;
  private cut: Float32Array | null = null;
  private Y: Buf | null = null;
  private C: Buf | null = null;
  private dec: [Buf | null, Buf | null] = [null, null];
  private decKeys: [string, string] = ['', ''];
  private decN: [number, number] = [-9, -9];
  private cur = 0;
  private cap: Buf | null = null;
  private up: Buf | null = null;
  private upCoef: Buf | null = null;
  private upDec: Buf | null = null;
  private layoutSys = -1;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('could not get a 2D context for the CPU renderer');
    this.ctx = ctx;
    this.blit = document.createElement('canvas');
    const bctx = this.blit.getContext('2d', { willReadFrequently: true });
    if (!bctx) throw new Error('could not get a 2D context to read the source');
    this.blitCtx = bctx;
    this.slots = new SourceSlots(Array.from({ length: SOURCE_SLOTS }, () => makeBuf(2, 2)));
  }

  get sourceSize(): { width: number; height: number } {
    return this.slots.size;
  }

  get plan(): FramePlan | null {
    return this.lastPlan;
  }

  hasFrame(tag: number): boolean {
    return this.slots.has(tag);
  }

  resetHistory(): void {
    this.slots.clear();
    this.auto.reset();
    this.decKeys = ['', ''];
    this.decN = [-9, -9];
  }

  dispose(): void {
    this.E = this.B1 = this.B2 = this.F = this.Y = this.C = this.cap = null;
  }

  /** Read a source frame into a float buffer, top row first. */
  setSource(source: FrameSource | null, width: number, height: number, tag = 0): void {
    if (!source || width < 1 || height < 1) return;
    if (this.blit.width !== width || this.blit.height !== height) {
      this.blit.width = width;
      this.blit.height = height;
    }
    this.blitCtx.clearRect(0, 0, width, height);
    this.blitCtx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    const img = this.blitCtx.getImageData(0, 0, width, height);
    const slot = this.slots.claim(tag, width, height, this.blit);
    const buf = ensureBuf(slot.handle, width, height);
    this.slots.handles[slot.index] = buf;
    const d = buf.d;
    const s = img.data;
    const inv = 1 / 255;
    for (let i = 0; i < width * height * 4; i++) d[i] = s[i] * inv;
  }

  readQno(): Float32Array | null {
    return this.lastPlan?.codec.on && this.qno ? this.qno.slice() : null;
  }

  private ensure(plan: FramePlan): void {
    const L = plan.fs.layout;
    const W = L.W;
    const H = L.H;
    this.E = ensureBuf(this.E, W, H);
    this.B1 = ensureBuf(this.B1, W, H);
    this.B2 = ensureBuf(this.B2, W, H);
    this.smear = ensureBuf(this.smear, W, 1);
    this.F = ensureBuf(this.F, W, H / 2);
    this.G = [ensureBuf(this.G[0], W, H / 2), ensureBuf(this.G[1], W, H / 2)];
    this.chroma = ensureBuf(this.chroma, L.CW, L.CH);
    this.Y = ensureBuf(this.Y, W, H);
    this.C = ensureBuf(this.C, L.CW, L.CH);
    this.cap = ensureBuf(this.cap, W, H);
    for (let i = 0; i < 2; i++) {
      const p = this.pre[i];
      const d = this.dec[i];
      this.pre[i] = ensureBuf(p, W, H);
      this.dec[i] = ensureBuf(d, W, H);
      if (this.dec[i] !== d) {
        this.decKeys[i] = '';
        this.decN[i] = -9;
      }
    }
    if (this.layoutSys !== L.system || !this.coefs) {
      this.coefs = makeCoefs(L);
      this.deq = new Float32Array(L.coefW * L.coefH);
      this.qno = new Float32Array(L.nSeg);
      this.cut = new Float32Array(L.nSeg);
      this.layoutSys = L.system;
    }
    if (plan.upload.on) {
      this.up = ensureBuf(this.up, plan.upload.W, plan.upload.H);
      this.upCoef = ensureBuf(this.upCoef, plan.upload.W, plan.upload.H);
      this.upDec = ensureBuf(this.upDec, plan.upload.W, plan.upload.H);
    }
  }

  private renderField(plan: FramePlan, j: 0 | 1, dst: Buf): void {
    const fp = plan.fields[j];
    const srcs = [0, 1, 2, 3].map((i) => this.slots.lookup(fp.tapTags[Math.min(i, fp.tapTags.length - 1)]).handle);
    scenePass(srcs, plan, fp, this.E!);
    let lit = this.E!;
    if (fp.sigma0 > 0.05 || plan.sigmaCorner > 0.05 || plan.rim[2] > 0) {
      blurPass(this.E!, this.B1!, 1, 0, fp.sigma0, plan.sigmaCorner, plan.rim, plan.aspect);
      blurPass(this.B1!, this.B2!, 0, 1, fp.sigma0, plan.sigmaCorner, plan.rim, plan.aspect);
      lit = this.B2!;
    }
    if (fp.sensor.smearK > 0) smearPass(lit, this.smear!, plan.H);
    sensorPass(lit, this.smear!, plan, fp, this.F!);
    demodPass(this.F!, fp, dst);
  }

  render(f: RenderFrame): RenderTelemetry {
    const src = this.slots.size;
    const fs = frameState({ settings: f.settings, time: f.time, outFrame: f.outFrame, seed: f.seed });
    const outW = Math.max(1, this.canvas.width);
    const outH = Math.max(1, this.canvas.height);
    const plan = planFrame({
      settings: f.settings,
      fs,
      srcW: src.width,
      srcH: src.height,
      thumbOf: (tag) => this.slots.lookup(tag).thumb,
      auto: this.auto,
      zoomMoving: f.zoomMoving,
      outW,
      outH,
    });
    this.lastPlan = plan;
    this.ensure(plan);
    const L = fs.layout;

    const json = JSON.stringify(f.settings);
    const versions = neededTaps(fs)
      .map((t) => this.slots.lookup(t.tag).version)
      .join(',');
    const key = decodeKey(plan, json, versions);
    let slot = this.decKeys.indexOf(key);
    if (slot < 0) {
      const prevSlot = this.decN.findIndex((n) => n === fs.n - 1);
      slot = prevSlot === 0 ? 1 : prevSlot === 1 ? 0 : 1 - this.cur;
      const prev = prevSlot >= 0 ? this.dec[prevSlot] : null;
      const prevPre = prevSlot >= 0 ? this.pre[prevSlot] : null;
      const pre = this.pre[slot]!;
      this.renderField(plan, 0, this.G[0]!);
      this.renderField(plan, 1, this.G[1]!);
      dspPass(this.G[0]!, this.G[1]!, plan, prevPre, plan.osd, [plan.osdPath[0] === 0, plan.osdPath[1] === 0], pre);
      const c = plan.codec;
      if (c.subsample) chromaPass(pre, L, this.chroma!);
      if (c.on) {
        fdctPass(pre, this.chroma!, L, c.dct248, c.classes, this.coefs!);
        quantisePass(L, this.coefs!, plan, this.qno!, this.cut!, this.deq!);
        idctPass(L, this.deq!, this.coefs!.mode, this.Y!, this.C!);
      }
      assemblePass(plan, L, c.on ? this.Y! : pre, c.on ? this.C! : this.chroma!, c.on, prev, this.dec[slot]!);
      this.decKeys[slot] = key;
      this.decN[slot] = fs.n;
    }
    this.cur = slot;
    const dec = this.dec[slot]!;

    postPass(plan, dec, plan.osd, this.cap!);
    let img = this.cap!;
    let map = plan.present.map;
    if (plan.upload.on) {
      uploadPass(plan, this.cap!, this.up!, this.upCoef!, this.upDec!);
      img = this.upDec!;
      map = [0, 0, plan.upload.W, plan.upload.H];
    }
    if (!this.out || this.out.width !== outW || this.out.height !== outH) {
      this.out = this.ctx.createImageData(outW, outH);
    }
    presentPass(
      plan,
      {
        img,
        map,
        deint: plan.upload.on ? 0 : plan.present.deint,
        split: f.splitX,
        src: this.slots.lookup(fs.fields[0].taps[0].tag).handle,
        frame: f.frame,
      },
      plan.osd,
      this.out.data,
      outW,
      outH,
    );
    this.ctx.putImageData(this.out, 0, 0);
    return telemetryOf(plan);
  }
}
