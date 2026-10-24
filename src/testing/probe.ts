/**
 * A measurement hook for the smoke test.
 *
 * Film artefacts are measurable — a curve has a toe or it does not, grain
 * tracks the gate or it does not — but only if the measurement can control
 * exactly what goes in. This renders synthetic sources through a real
 * renderer of either kind, at chosen output frames, and hands back pixels.
 * It uses the same renderers, the same frame clock and the same source
 * tagging as the application; only the source and the canvas are its own.
 *
 * It is always present, because the packaged build is what the smoke test
 * loads over file://, and it costs nothing until it is called.
 */

import { DEFAULTS, ParamValue, Settings, applyEngineMasters, sanitize } from '../core/params';
import { PRESETS } from '../core/presets';
import { frameState, rates } from '../film/clock';
import { BackendChoice, createRenderer } from '../video/backend';

export type ProbeSource =
  | { kind: 'grey'; level: number }
  | { kind: 'ramp'; stops: number }
  | { kind: 'texture'; panPxPerSec: number; cell: number }
  | { kind: 'counter' }
  | { kind: 'bars' }
  | { kind: 'scene' };

export interface ProbeRequest {
  backend: BackendChoice;
  settings: Record<string, ParamValue>;
  source: ProbeSource;
  width: number;
  height: number;
  srcWidth?: number;
  srcHeight?: number;
  /** Output frame numbers to render. */
  frames: number[];
  seed?: number;
  /** Return the pixels, or only a channel-mean summary. */
  pixels?: boolean;
}

export interface ProbeFrame {
  outFrame: number;
  filmFrames: [number, number];
  /** RGB, top row first, when pixels were asked for. */
  rgb?: number[];
  mean: [number, number, number];
}

export interface ProbeResult {
  backend: string;
  frames: ProbeFrame[];
  width: number;
  height: number;
  ms: number;
}

function drawSource(ctx: CanvasRenderingContext2D, w: number, h: number, src: ProbeSource, t: number, n: number): void {
  if (src.kind === 'grey') {
    const v = Math.round(src.level * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (src.kind === 'ramp') {
    // A horizontal log-exposure ramp: from `stops` below white at the left to
    // white at the right, in linear light, so the output's response to log
    // exposure can be read straight off a row.
    const img = ctx.createImageData(w, h);
    for (let x = 0; x < w; x++) {
      const lin = Math.pow(2, -src.stops * (1 - (x + 0.5) / w));
      const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
      const v = Math.round(Math.min(1, s) * 255);
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  if (src.kind === 'texture') {
    // A fixed random pattern sliding sideways: the subject moving.
    const img = ctx.createImageData(w, h);
    const shift = Math.round(src.panPxPerSec * t);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cx = Math.floor((x + shift) / src.cell);
        const cy = Math.floor(y / src.cell);
        let hsh = Math.imul(cx ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(cy + 0x165667b1, 0x9e3779b1);
        hsh ^= hsh >>> 15;
        hsh = Math.imul(hsh, 0x85ebca6b);
        hsh ^= hsh >>> 13;
        const v = 60 + ((hsh >>> 0) % 140);
        const o = (y * w + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  if (src.kind === 'counter') {
    // Brightness encodes which film frame this is, so the frame a field shows
    // can be read back from its level.
    const v = Math.round(40 + (n % 8) * 25);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (src.kind === 'scene') {
    drawScene(ctx, w, h, t);
    return;
  }
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect((i * w) / bars.length, 0, w / bars.length + 1, h * 0.75);
  });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, h * 0.75, w, h * 0.25);
  ctx.fillStyle = '#fff';
  ctx.fillRect(w * 0.06, h * 0.8, w * 0.25, h * 0.15);
}

/**
 * A small outdoor scene with the things film treats most characteristically:
 * a sky running to a hot sun, skin, foliage, a saturated red, a white shirt in
 * sun and a figure in deep shade. Drawn, not photographed, so it ships with
 * the code and every render of it is reproducible.
 */
function drawScene(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const sky = g.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#3f78c4');
  sky.addColorStop(1, '#bcd6ee');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h * 0.62);
  // The sun, clipped hard to white in the source as a video camera would.
  const sx = w * (0.78 + 0.02 * Math.sin(t * 0.7));
  const sun = g.createRadialGradient(sx, h * 0.18, 0, sx, h * 0.18, h * 0.2);
  sun.addColorStop(0, '#ffffff');
  sun.addColorStop(0.18, '#ffffff');
  sun.addColorStop(0.35, '#fff6d8');
  sun.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, w, h * 0.62);
  // Hills and a hedge.
  g.fillStyle = '#4d6b33';
  g.beginPath();
  g.moveTo(0, h * 0.62);
  for (let x = 0; x <= w; x += w / 16) g.lineTo(x, h * (0.55 + 0.04 * Math.sin(x / w * 7)));
  g.lineTo(w, h);
  g.lineTo(0, h);
  g.fill();
  g.fillStyle = '#2b3d1c';
  g.fillRect(0, h * 0.62, w, h * 0.12);
  g.fillStyle = '#6f8f3e';
  g.fillRect(0, h * 0.74, w, h * 0.26);
  // A figure in sun: skin, a white shirt, a red jumper over the shoulders.
  const fx = w * (0.32 + 0.03 * Math.sin(t * 1.3));
  g.fillStyle = '#f2efe8';
  g.fillRect(fx - w * 0.06, h * 0.48, w * 0.12, h * 0.3);
  g.fillStyle = '#c4231c';
  g.fillRect(fx - w * 0.065, h * 0.48, w * 0.13, h * 0.06);
  g.fillStyle = '#d9a384';
  g.beginPath();
  g.ellipse(fx, h * 0.4, w * 0.035, h * 0.065, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3b2a1e';
  g.beginPath();
  g.ellipse(fx, h * 0.36, w * 0.037, h * 0.035, 0, Math.PI, Math.PI * 2);
  g.fill();
  // A second figure in deep shade under a tree.
  g.fillStyle = '#1d2614';
  g.beginPath();
  g.ellipse(w * 0.66, h * 0.38, w * 0.16, h * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1a1c';
  g.fillRect(w * 0.6, h * 0.5, w * 0.06, h * 0.26);
  g.fillStyle = '#5a4034';
  g.beginPath();
  g.ellipse(w * 0.63, h * 0.47, w * 0.022, h * 0.04, 0, 0, Math.PI * 2);
  g.fill();
}

export async function renderProbe(req: ProbeRequest): Promise<ProbeResult> {
  const t0 = performance.now();
  const canvas = document.createElement('canvas');
  canvas.width = req.width;
  canvas.height = req.height;
  const { renderer, kind } = createRenderer(canvas, req.backend);
  const srcW = req.srcWidth ?? 640;
  const srcH = req.srcHeight ?? 480;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  const settings = applyEngineMasters(sanitize(req.settings, DEFAULTS));
  const seed = req.seed ?? 1337;
  const r = rates(settings);
  const speed = r.projector / r.camera;

  const read = document.createElement('canvas');
  read.width = req.width;
  read.height = req.height;
  const rctx = read.getContext('2d', { willReadFrequently: true })!;

  const frames: ProbeFrame[] = [];
  try {
    for (const k of req.frames) {
      const time = (k / r.output) * speed;
      const fs = frameState({ settings, time, outFrame: k, seed, srcW, srcH });
      for (const field of fs.fields) {
        if (renderer.hasFrame(field.n)) continue;
        drawSource(sctx, srcW, srcH, req.source, field.capture, field.n);
        renderer.setSource(srcCanvas, srcW, srcH, field.n);
      }
      renderer.render({ settings, time, outFrame: k, frame: k, dt: 1 / r.output, audioLevel: 0, splitX: -1, seed });
      rctx.drawImage(canvas, 0, 0);
      const data = rctx.getImageData(0, 0, req.width, req.height).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      const n = req.width * req.height;
      const rgb: number[] | undefined = req.pixels ? new Array(n * 3) : undefined;
      for (let i = 0; i < n; i++) {
        sr += data[i * 4];
        sg += data[i * 4 + 1];
        sb += data[i * 4 + 2];
        if (rgb) {
          rgb[i * 3] = data[i * 4];
          rgb[i * 3 + 1] = data[i * 4 + 1];
          rgb[i * 3 + 2] = data[i * 4 + 2];
        }
      }
      frames.push({
        outFrame: k,
        filmFrames: [fs.fields[0].n, fs.fields[1].n],
        rgb,
        mean: [sr / n, sg / n, sb / n],
      });
    }
  } finally {
    renderer.dispose();
  }
  return { backend: kind, frames, width: req.width, height: req.height, ms: performance.now() - t0 };
}

declare global {
  interface Window {
    __filmbox?: { renderProbe: typeof renderProbe; defaults: Settings; presets: Record<string, Settings> };
  }
}

export function installProbe(): void {
  window.__filmbox = {
    renderProbe,
    defaults: DEFAULTS,
    presets: Object.fromEntries(PRESETS.map((p) => [p.id, p.settings])),
  };
}
