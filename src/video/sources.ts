/**
 * Source frames, tagged by the moment they show.
 *
 * Every field is a separate moment of the source, and a slow shutter
 * integrates several, so the renderer holds a handful of decoded source
 * frames tagged by capture time (integer milliseconds, see tagOf in
 * cam/clock.ts) rather than by frame number. When a slot is needed for a new
 * moment the frame furthest from it is evicted — not the least recently
 * used: interlace needs two capture moments per frame all the time, and
 * least-recently-used eviction once made FILMBOX show a stale field.
 *
 * Each slot also keeps a 64×48 linear thumbnail, which is what the camera's
 * automatics meter. It is made here, the same way for both backends, so the
 * GPU and the CPU renderer steer to the same exposure.
 */

import type { Meter } from '../cam/automatics';

export interface SourceSlot<H> {
  handle: H;
  tag: number;
  version: number;
  index: number;
  thumb: Float32Array;
}

export const THUMB_W = 64;
export const THUMB_H = 48;

let thumbCanvas: HTMLCanvasElement | null = null;
let thumbCtx: CanvasRenderingContext2D | null = null;
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** A small linear-light copy of a source picture, for metering. */
export function makeThumb(source: CanvasImageSource, out?: Float32Array): Float32Array {
  if (!thumbCanvas) {
    thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMB_W;
    thumbCanvas.height = THUMB_H;
    thumbCtx = thumbCanvas.getContext('2d', { willReadFrequently: true });
  }
  const t = out ?? new Float32Array(THUMB_W * THUMB_H * 3);
  const ctx = thumbCtx!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
  const d = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
  for (let i = 0; i < THUMB_W * THUMB_H; i++) {
    t[i * 3] = LIN[d[i * 4]];
    t[i * 3 + 1] = LIN[d[i * 4 + 1]];
    t[i * 3 + 2] = LIN[d[i * 4 + 2]];
  }
  return t;
}

/**
 * makeThumb for raw RGBA pixels: each thumbnail cell is the mean of a grid of
 * samples across its area, in linear light.
 */
export function makeThumbFromPixels(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  out?: Float32Array,
): Float32Array {
  const t = out ?? new Float32Array(THUMB_W * THUMB_H * 3);
  const S = 4;
  for (let ty = 0; ty < THUMB_H; ty++) {
    for (let tx = 0; tx < THUMB_W; tx++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < S; sy++) {
        const y = Math.min(height - 1, Math.floor(((ty + (sy + 0.5) / S) * height) / THUMB_H));
        for (let sx = 0; sx < S; sx++) {
          const x = Math.min(width - 1, Math.floor(((tx + (sx + 0.5) / S) * width) / THUMB_W));
          const o = (y * width + x) * 4;
          r += LIN[rgba[o]];
          g += LIN[rgba[o + 1]];
          b += LIN[rgba[o + 2]];
        }
      }
      const o = (ty * THUMB_W + tx) * 3;
      t[o] = r / (S * S);
      t[o + 1] = g / (S * S);
      t[o + 2] = b / (S * S);
    }
  }
  return t;
}

function mirror(i: number, n: number): number {
  const p = 2 * n;
  const k = i - p * Math.floor(i / p);
  return k < n ? k : p - 1 - k;
}

/**
 * Meter what the camera is looking at: the thumbnail sampled over the view's
 * rectangle (centre and half-extent in source uv), plain and centre-weighted.
 */
export function meterView(thumb: Float32Array, cu: number, cv: number, hu: number, hv: number): Meter {
  let r = 0;
  let g = 0;
  let b = 0;
  let lum = 0;
  let cl = 0;
  let cw = 0;
  const NX = 16;
  const NY = 12;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const nx = (i + 0.5) / NX * 2 - 1;
      const ny = (j + 0.5) / NY * 2 - 1;
      const x = Math.floor((cu + nx * hu) * THUMB_W);
      const y = Math.floor((cv + ny * hv) * THUMB_H);
      const o = (mirror(y, THUMB_H) * THUMB_W + mirror(x, THUMB_W)) * 3;
      const pr = thumb[o];
      const pg = thumb[o + 1];
      const pb = thumb[o + 2];
      r += pr;
      g += pg;
      b += pb;
      const l = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      lum += l;
      const w = Math.exp(-(nx * nx + ny * ny) / 0.5);
      cl += l * w;
      cw += w;
    }
  }
  const n = NX * NY;
  return { rgb: [r / n, g / n, b / n], lum: lum / n, centre: cl / cw };
}

export class SourceSlots<H> {
  readonly handles: H[];
  private tags: number[];
  private versions: number[];
  private thumbs: Float32Array[];
  /** Extra tags that show the same picture as a slot: tag -> slot index. */
  private aliases = new Map<number, number>();
  private counter = 0;
  size = { width: 2, height: 2 };

  constructor(handles: H[]) {
    this.handles = handles;
    this.tags = handles.map(() => Number.NaN);
    this.versions = handles.map(() => 0);
    this.thumbs = handles.map(() => new Float32Array(THUMB_W * THUMB_H * 3));
  }

  private slotOf(tag: number): number {
    const i = this.tags.indexOf(tag);
    if (i >= 0) return i;
    return this.aliases.get(tag) ?? -1;
  }

  /** Choose the slot a new upload for `tag` goes into, and meter it. */
  claim(tag: number, width: number, height: number, source: CanvasImageSource): SourceSlot<H> {
    const i = this.take(tag, width, height);
    makeThumb(source, this.thumbs[i]);
    return this.slot(i);
  }

  /** As claim, for raw RGBA pixels rather than an image. */
  claimPixels(tag: number, width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): SourceSlot<H> {
    const i = this.take(tag, width, height);
    makeThumbFromPixels(rgba, width, height, this.thumbs[i]);
    return this.slot(i);
  }

  private take(tag: number, width: number, height: number): number {
    let i = this.slotOf(tag);
    if (i < 0) i = this.tags.findIndex((t) => Number.isNaN(t));
    if (i < 0) {
      i = 0;
      for (let k = 1; k < this.tags.length; k++) {
        if (Math.abs(this.tags[k] - tag) > Math.abs(this.tags[i] - tag)) i = k;
      }
    }
    // Whatever else pointed at this slot now points at nothing.
    for (const [t, k] of this.aliases) if (k === i) this.aliases.delete(t);
    this.aliases.delete(tag);
    this.tags[i] = tag;
    this.versions[i] = ++this.counter;
    this.size = { width, height };
    return i;
  }

  private slot(i: number): SourceSlot<H> {
    return { handle: this.handles[i], tag: this.tags[i], version: this.versions[i], index: i, thumb: this.thumbs[i] };
  }

  /**
   * `tag` shows the same picture as `existing`: no upload, no metering. Used
   * when two fields' moments fall on one frame of the source.
   */
  alias(tag: number, existing: number): boolean {
    const i = this.slotOf(existing);
    if (i < 0) return false;
    if (this.tags[i] !== tag) this.aliases.set(tag, i);
    return true;
  }

  has(tag: number): boolean {
    return this.slotOf(tag) >= 0;
  }

  /** The slot holding `tag`, or the nearest one there is. */
  lookup(tag: number): SourceSlot<H> {
    let i = this.slotOf(tag);
    if (i < 0) {
      let best = -1;
      for (let k = 0; k < this.tags.length; k++) {
        const t = this.tags[k];
        if (Number.isNaN(t)) continue;
        if (best < 0 || Math.abs(t - tag) < Math.abs(this.tags[best] - tag)) best = k;
      }
      i = best < 0 ? 0 : best;
    }
    return this.slot(i);
  }

  clear(): void {
    this.tags = this.tags.map(() => Number.NaN);
    this.aliases.clear();
  }
}

/** Number of source slots each renderer keeps: two fields, a slow shutter's several moments. */
export const SOURCE_SLOTS = 8;
