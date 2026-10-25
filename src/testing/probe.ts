/**
 * A measurement hook for the smoke test.
 *
 * Camcorder artefacts are measurable — a field shows one moment or another,
 * a block boundary has a gradient or it does not — but only if the
 * measurement controls exactly what goes in. This renders synthetic sources
 * through a real renderer of either kind, at chosen output frames, and hands
 * back pixels. Each source is drawn at the exact capture moment of every
 * field that asks for it, so it is an infinitely fast source: whatever the
 * output shows about time came from the field clock, not from the footage.
 *
 * It uses the same renderers, the same clock and the same source tagging as
 * the application; only the source and the canvas are its own. It reports
 * any requested setting the schema would have clamped or dropped, so a test
 * cannot silently measure something it did not ask for (FILMBOX, lesson 18).
 *
 * It is always present, because the packaged build is what the smoke test
 * loads over file://, and it costs nothing until it is called.
 */

import { DEFAULTS, ParamValue, Settings, applyEngineMasters, num, sanitize, settingsProblems } from '../core/params';
import { Timeline, evaluateTimeline, sanitizeTimeline } from '../core/timeline';
import { renderProcessedAudio } from '../export/offlineAudio';
import { zoomVelocityAt } from '../audio/engine';
import { PRESETS } from '../core/presets';
import { frameAspect, frameState, neededTaps, rates } from '../cam/clock';
import { BackendChoice, Renderer, createRenderer } from '../video/backend';

export type ProbeSource =
  | { kind: 'grey'; level: number }
  | { kind: 'ramp'; stops: number }
  | { kind: 'texture'; panPxPerSec: number; cell: number }
  | { kind: 'counter' }
  | { kind: 'bar'; pxPerSec: number; width?: number }
  | { kind: 'zone' }
  | { kind: 'edge'; low?: number; high?: number }
  | { kind: 'redline'; width?: number }
  | { kind: 'redtext' }
  | { kind: 'point'; size?: number; level?: number }
  | { kind: 'noise'; amount: number }
  | { kind: 'verticals'; spacing?: number }
  | { kind: 'bars' }
  | { kind: 'scene' }
  | { kind: 'interior' };

export interface ProbeRequest {
  backend: BackendChoice;
  settings: Record<string, ParamValue>;
  source: ProbeSource;
  width: number;
  height: number;
  srcWidth?: number;
  srcHeight?: number;
  /** Output frame numbers to render, in order. */
  frames: number[];
  seed?: number;
  /** Return the pixels, or only a channel-mean summary. */
  pixels?: boolean;
  /** Read frames back at all. Off for timing, where a readback would dominate. */
  readback?: boolean;
  /** Return each segment's quantisation number. */
  qno?: boolean;
  /** Zoom bar shown, as if the rocker were pressed. */
  zoomMoving?: boolean;
  /** Keyframes, evaluated at each frame's source time as the app does. */
  timeline?: Timeline;
}

export interface ProbeFrame {
  outFrame: number;
  dvFrame: number;
  /** Source time each field showed, in temporal order, with its parity. */
  fields: { srcT: number; parity: number }[];
  rgb?: Uint8Array;
  mean: [number, number, number];
  qno?: number[];
  exposure: { shutter: number; fNumber: number; gainDb: number; X: number; wb: number[] };
  lost: number;
  /** Indices of the lost macroblocks, when there are any. */
  lostMBs?: number[];
  clock: { wallMs: number; timecode: number; battery: number; shot: number };
}

export interface ProbeResult {
  backend: string;
  frames: ProbeFrame[];
  width: number;
  height: number;
  ms: number;
  problems: string[];
}

function hashCell(cx: number, cy: number): number {
  let h = Math.imul(cx ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(cy + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function drawSource(ctx: CanvasRenderingContext2D, w: number, h: number, src: ProbeSource, t: number): void {
  ctx.save();
  if (src.kind === 'grey') {
    const v = Math.round(src.level * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, w, h);
  } else if (src.kind === 'ramp') {
    // A horizontal log-exposure ramp, `stops` below white at the left to
    // white at the right, in linear light.
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
  } else if (src.kind === 'texture' || src.kind === 'noise') {
    const img = ctx.createImageData(w, h);
    const shift = src.kind === 'texture' ? Math.round(src.panPxPerSec * t) : 0;
    const cell = src.kind === 'texture' ? src.cell : 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v: number;
        if (src.kind === 'texture') {
          v = 60 + hashCell(Math.floor((x + shift) / cell), Math.floor(y / cell)) * 140;
        } else {
          // A smooth gradient, with a patch of fine noise in the left third.
          v = 70 + (110 * y) / h;
          if (x < w / 3) v += (hashCell(x, y) - 0.5) * 255 * src.amount;
        }
        const o = (y * w + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, Math.round(v)));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  } else if (src.kind === 'counter') {
    // Brightness encodes which 1/240 s the source was sampled in, so the
    // moment each field shows can be read back from its level.
    const k = Math.floor(t * 240 + 1e-6) % 8;
    const v = 40 + k * 25;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, 0, w, h);
  } else if (src.kind === 'bar') {
    ctx.fillStyle = 'rgb(40,40,40)';
    ctx.fillRect(0, 0, w, h);
    const bw = src.width ?? w / 40;
    const x = (w * 0.1 + src.pxPerSec * t) % w;
    ctx.fillStyle = 'rgb(230,230,230)';
    ctx.fillRect(x, 0, bw, h);
  } else if (src.kind === 'zone') {
    // A zone plate: frequency rising with radius, to Nyquist at the edge.
    const img = ctx.createImageData(w, h);
    const k = Math.PI / Math.max(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - w / 2;
        const dy = y - h / 2;
        const v = 128 + 100 * Math.cos(k * (dx * dx + dy * dy) * 0.5);
        const o = (y * w + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(v);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  } else if (src.kind === 'edge') {
    const lo = Math.round((src.low ?? 0.25) * 255);
    const hi = Math.round((src.high ?? 0.7) * 255);
    ctx.fillStyle = `rgb(${lo},${lo},${lo})`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = `rgb(${hi},${hi},${hi})`;
    ctx.fillRect(Math.round(w / 2), 0, w - Math.round(w / 2), h);
  } else if (src.kind === 'redline') {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(230,20,20)';
    const lw = src.width ?? Math.max(1, Math.round(w / 640));
    ctx.fillRect(Math.round(w / 2), 0, lw, h);
    // And a thin horizontal one, for vertical chroma spread.
    ctx.fillRect(0, Math.round(h * 0.75), w, Math.max(1, Math.round(h / 480)));
  } else if (src.kind === 'redtext') {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, w, h);
  } else if (src.kind === 'point') {
    ctx.fillStyle = 'rgb(18,18,24)';
    ctx.fillRect(0, 0, w, h);
    const v = Math.round((src.level ?? 1) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    const r = src.size ?? Math.max(2, w / 160);
    ctx.beginPath();
    ctx.arc(w * 0.4, h * 0.35, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (src.kind === 'verticals') {
    ctx.fillStyle = 'rgb(30,30,30)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgb(220,220,220)';
    const sp = src.spacing ?? w / 8;
    for (let x = sp / 2; x < w; x += sp) ctx.fillRect(Math.round(x), 0, Math.max(2, Math.round(w / 200)), h);
  } else if (src.kind === 'bars') {
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect((i * w) / bars.length, 0, w / bars.length + 1, h * 0.75);
    });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, h * 0.75, w, h * 0.25);
    ctx.fillStyle = '#fff';
    ctx.fillRect(w * 0.06, h * 0.8, w * 0.25, h * 0.15);
    ctx.fillStyle = '#808080';
    ctx.fillRect(w * 0.4, h * 0.8, w * 0.25, h * 0.15);
  } else if (src.kind === 'interior') {
    drawInterior(ctx, w, h, t);
  } else {
    drawScene(ctx, w, h, t);
  }
  ctx.restore();
}

/**
 * A small outdoor scene with the things a video camera treats most
 * characteristically: a sky running to a hot sun, skin, foliage, a saturated
 * red, a white shirt in sun and a figure in deep shade. Drawn, not
 * photographed, so it ships with the code and every render is reproducible.
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

/**
 * A living room at night under tungsten light: a lamp, a window black with
 * night, a sofa, a red jumper and a cake with candles. Drawn as it would look
 * to the eye, which has already adapted — the White Balance section's Light
 * setting is what makes it orange.
 */
function drawInterior(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const wall = g.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, '#8a8478');
  wall.addColorStop(1, '#5a554c');
  g.fillStyle = wall;
  g.fillRect(0, 0, w, h);
  // A night window.
  g.fillStyle = '#0c0f16';
  g.fillRect(w * 0.06, h * 0.12, w * 0.22, h * 0.36);
  g.fillStyle = '#d8d2c4';
  g.fillRect(w * 0.06, h * 0.29, w * 0.22, h * 0.012);
  g.fillRect(w * 0.168, h * 0.12, w * 0.012, h * 0.36);
  // A lamp with a bright bulb under its shade.
  g.fillStyle = '#e8d8b0';
  g.beginPath();
  g.moveTo(w * 0.74, h * 0.16);
  g.lineTo(w * 0.86, h * 0.16);
  g.lineTo(w * 0.89, h * 0.3);
  g.lineTo(w * 0.71, h * 0.3);
  g.fill();
  const bulb = g.createRadialGradient(w * 0.8, h * 0.31, 0, w * 0.8, h * 0.31, h * 0.08);
  bulb.addColorStop(0, '#ffffff');
  bulb.addColorStop(0.3, '#fff8e0');
  bulb.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = bulb;
  g.fillRect(w * 0.7, h * 0.22, w * 0.2, h * 0.2);
  g.fillStyle = '#3a2c20';
  g.fillRect(w * 0.795, h * 0.3, w * 0.01, h * 0.4);
  // A sofa.
  g.fillStyle = '#4b5a6e';
  g.fillRect(w * 0.0, h * 0.6, w * 0.6, h * 0.3);
  g.fillStyle = '#56667c';
  g.fillRect(w * 0.0, h * 0.52, w * 0.6, h * 0.1);
  // Someone in a red jumper on the sofa, moving a little.
  const fx = w * (0.32 + 0.02 * Math.sin(t * 1.7));
  g.fillStyle = '#b8261e';
  g.fillRect(fx - w * 0.07, h * 0.5, w * 0.14, h * 0.22);
  g.fillStyle = '#d8a080';
  g.beginPath();
  g.ellipse(fx, h * 0.43, w * 0.04, h * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  // A table with a white cake and candles.
  g.fillStyle = '#6a4a30';
  g.fillRect(w * 0.55, h * 0.76, w * 0.4, h * 0.05);
  g.fillStyle = '#f4f0ea';
  g.fillRect(w * 0.65, h * 0.66, w * 0.18, h * 0.1);
  for (let i = 0; i < 5; i++) {
    const x = w * (0.67 + i * 0.035);
    g.fillStyle = '#e04a8a';
    g.fillRect(x, h * 0.6, w * 0.006, h * 0.06);
    const flick = 0.8 + 0.2 * Math.sin(t * 9 + i * 1.7);
    g.fillStyle = `rgba(255,${Math.round(220 * flick)},120,1)`;
    g.beginPath();
    g.ellipse(x + w * 0.003, h * 0.59, w * 0.004, h * 0.012, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#2a2420';
  g.fillRect(0, h * 0.9, w, h * 0.1);
}

function drawRedText(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.fillStyle = 'rgb(220,24,24)';
  // Block letters drawn with rectangles, so no font is involved.
  const s = Math.max(2, Math.round(h / 60));
  const glyph = [
    '### #   # ###',
    '#   ## ## #  ',
    '##  # # # ## ',
    '#   #   # #  ',
    '### #   # ###',
  ];
  const x0 = Math.round(w * 0.25);
  const y0 = Math.round(h * 0.45);
  for (let r = 0; r < glyph.length; r++) {
    for (let c = 0; c < glyph[r].length; c++) if (glyph[r][c] === '#') g.fillRect(x0 + c * s * 2, y0 + r * s * 2, s * 2, s * 2);
  }
}

/**
 * One renderer per backend, kept between calls: compiling every shader again
 * for each measurement costs far more than the measurement does, especially
 * on a software rasteriser. Its history is reset for every request, so no
 * call sees another's frames.
 */
const cached: Partial<Record<BackendChoice, { canvas: HTMLCanvasElement; renderer: Renderer; kind: string }>> = {};

function rendererFor(backend: BackendChoice, width: number, height: number) {
  let c = cached[backend];
  if (!c) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const made = createRenderer(canvas, backend);
    c = { canvas, renderer: made.renderer, kind: made.kind };
    cached[backend] = c;
  }
  c.canvas.width = width;
  c.canvas.height = height;
  c.renderer.resetHistory();
  return c;
}

export async function renderProbe(req: ProbeRequest): Promise<ProbeResult> {
  const t0 = performance.now();
  const problems = settingsProblems(req.settings);
  const { canvas, renderer, kind } = rendererFor(req.backend, req.width, req.height);
  const srcW = req.srcWidth ?? 720;
  const srcH = req.srcHeight ?? 540;
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
  const baseSettings = sanitize(req.settings, DEFAULTS);
  const timeline = sanitizeTimeline(req.timeline ?? {});
  const settingsAt = (t: number) => applyEngineMasters(evaluateTimeline(baseSettings, timeline, t));
  const seed = req.seed ?? 1337;
  const r = rates(applyEngineMasters(baseSettings));

  const read = document.createElement('canvas');
  read.width = req.width;
  read.height = req.height;
  const rctx = read.getContext('2d', { willReadFrequently: true })!;

  const frames: ProbeFrame[] = [];
  try {
    for (const k of req.frames) {
      const time = k / r.output;
      const settings = settingsAt(time);
      const fs = frameState({ settings, time, outFrame: k, seed });
      for (const tap of neededTaps(fs)) {
        if (renderer.hasFrame(tap.tag)) continue;
        drawSource(sctx, srcW, srcH, req.source, tap.srcT);
        if (req.source.kind === 'redtext') drawRedText(sctx, srcW, srcH);
        renderer.setSource(srcCanvas, srcW, srcH, tap.tag);
      }
      const moving = req.zoomMoving ?? Math.abs(zoomVelocityAt((t) => num(settingsAt(t), 'lens.zoom'), time)) > 0.01;
      const tel = renderer.render({ settings, time, outFrame: k, frame: k, dt: 1 / r.output, audioLevel: 0, splitX: -1, seed, zoomMoving: moving });
      const plan = renderer.plan!;
      const e = plan.fields[0].exposure;
      const base: ProbeFrame = {
        outFrame: k,
        dvFrame: tel.dvFrame,
        fields: fs.fields.map((f) => ({ srcT: f.srcT, parity: f.parity })),
        mean: [0, 0, 0],
        exposure: { shutter: e.shutter, fNumber: e.fNumber, gainDb: e.gainDb, X: e.X, wb: [...e.wb] },
        lost: fs.lost ? fs.lost.reduce((a, b) => a + b, 0) : 0,
        lostMBs: fs.lost ? Array.from(fs.lost).flatMap((v, i) => (v ? [i] : [])) : undefined,
        clock: { wallMs: fs.clock.wallMs, timecode: fs.clock.timecode, battery: fs.clock.battery, shot: fs.clock.shot },
      };
      if (req.qno) {
        const q = renderer.readQno();
        if (q) base.qno = Array.from(q);
      }
      if (req.readback === false) {
        frames.push(base);
        continue;
      }
      rctx.drawImage(canvas, 0, 0);
      const data = rctx.getImageData(0, 0, req.width, req.height).data;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      const n = req.width * req.height;
      const rgb: Uint8Array | undefined = req.pixels ? new Uint8Array(n * 3) : undefined;
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
      base.mean = [sr / n, sg / n, sb / n];
      base.rgb = rgb;
      frames.push(base);
    }
    if (req.readback === false) {
      rctx.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1);
      rctx.getImageData(0, 0, 1, 1);
    }
  } finally {
    renderer.resetHistory();
  }
  return { backend: kind, frames, width: req.width, height: req.height, ms: performance.now() - t0, problems };
}

export interface AudioProbeRequest {
  settings: Record<string, ParamValue>;
  timeline?: Timeline;
  /** Seconds of source to render. */
  seconds: number;
  seed?: number;
  /**
   * The programme at the microphone: silence (the camera hears only itself),
   * white noise, or a loud second of tone followed by silence.
   */
  programme?: 'silence' | 'noise' | 'burst';
  /** Return every n-th sample only, to keep the transfer small. */
  decimate?: number;
}

/** Render the camera's sound offline, as an export does, and hand back the samples. */
export async function renderAudioProbe(req: AudioProbeRequest): Promise<{ sampleRate: number; left: number[]; right: number[] }> {
  const settings = sanitize(req.settings, DEFAULTS);
  const sr = 48000;
  let file: Blob | null = null;
  if (req.programme && req.programme !== 'silence') {
    const n = Math.ceil(req.seconds * sr);
    const data = new Float32Array(n);
    let x = 0x2545f491;
    for (let i = 0; i < n; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const noise = ((x >>> 0) / 4294967296) * 2 - 1;
      if (req.programme === 'noise') data[i] = noise * 0.25;
      else data[i] = i < sr ? 0.6 * Math.sin((2 * Math.PI * 440 * i) / sr) : 0;
    }
    const { encodeWav } = await import('../export/wav');
    const ctx = new OfflineAudioContext(2, n, sr);
    const buf = ctx.createBuffer(2, n, sr);
    buf.copyToChannel(data, 0);
    buf.copyToChannel(data, 1);
    file = encodeWav(buf, 16);
  }
  const out = await renderProcessedAudio(file, applyEngineMasters(settings), {
    seed: req.seed ?? 1337,
    start: 0,
    end: req.seconds,
    duration: req.seconds,
    timeline: sanitizeTimeline(req.timeline ?? {}),
    sampleRate: sr,
  });
  if (!out) throw new Error('no audio rendered');
  const d = Math.max(1, req.decimate ?? 1);
  const pick = (c: Float32Array) => {
    const o: number[] = [];
    for (let i = 0; i < c.length; i += d) o.push(c[i]);
    return o;
  };
  return { sampleRate: sr / d, left: pick(out.getChannelData(0)), right: pick(out.getChannelData(1)) };
}

/** Draw a probe source into a canvas, for the codec comparison against FFmpeg. */
export function probeSourceImage(source: ProbeSource, w: number, h: number, t = 0): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  drawSource(g, w, h, source, t);
  if (source.kind === 'redtext') drawRedText(g, w, h);
  return c.toDataURL('image/png');
}

/** Base64 of a byte array, for handing pixels across a page boundary compactly. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** renderProbe, with each frame's pixels as base64 rather than an array. */
export async function renderProbeB64(req: ProbeRequest) {
  const r = await renderProbe(req);
  return { ...r, frames: r.frames.map((f) => ({ ...f, rgb: f.rgb ? toBase64(f.rgb) : undefined })) };
}

declare global {
  interface Window {
    __camai?: {
      renderProbe: typeof renderProbe;
      renderProbeB64: typeof renderProbeB64;
      renderAudio: typeof renderAudioProbe;
      probeSourceImage: typeof probeSourceImage;
      defaults: Settings;
      presets: Record<string, Settings>;
      /** Shape of the output frame for these settings — the app's own answer. */
      aspect(settings: Record<string, ParamValue>): number;
    };
  }
}

export function installProbe(): void {
  window.__camai = {
    renderProbe,
    renderProbeB64,
    renderAudio: renderAudioProbe,
    probeSourceImage,
    defaults: DEFAULTS,
    presets: Object.fromEntries(PRESETS.map((p) => [p.id, p.settings])),
    aspect: (settings) => frameAspect(applyEngineMasters(sanitize(settings, DEFAULTS))),
  };
}
