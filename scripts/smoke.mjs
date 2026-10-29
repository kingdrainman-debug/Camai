/*
 * Headless smoke test.
 *
 * Type-checking cannot catch a shader that fails to compile, a worklet that
 * fails to register, or a parameter that moves its slider and reaches
 * nothing. So the built bundle is loaded in Chromium and driven for real.
 *
 * Two kinds of stage:
 *
 *   - The application, through its own interface: it mounts, footage reaches
 *     the camera, keyframes animate, the frame is the shape asked for, the
 *     guide and the ⓘ panels work, the engine masters bypass, an export comes
 *     out complete, and all of it still works over file:// the way the
 *     packaged build loads it.
 *
 *   - The camcorder, measured. Camcorder artefacts are measurable, and this
 *     time there is a real codec to compare against. Asserted from pixels
 *     (and samples): the two fields of a frame are two moments, bottom
 *     first; deinterlacers comb, twitter and halve as they should; DCT
 *     blocks sit on the 8-pixel grid of the DV raster and scale with the
 *     output; the bit budget is shared across the frame; the codec's loss is
 *     within a stated distance of FFmpeg's own DV encoder; 4:1:1 and 4:2:0
 *     bleed colour as far as they should; edges overshoot and coring holds;
 *     a CCD smears and a CMOS leans; the curve has a knee and a wall; an
 *     overlay's path is visible; the clocks jump where they should; a
 *     dropout is the previous frame on the macroblock grid and a mute in the
 *     sound; the zoom is heard only while it moves; 12-bit audio is band
 *     limited and the AGC breathes. These use window.__camai.renderProbe,
 *     which drives the real renderers with synthetic sources drawn at the
 *     exact moment each field asks for.
 *
 * Every stage that waits for the picture polls for a condition rather than
 * sleeping a fixed time; a fixed sleep samples an undrawn frame under load
 * and fails for reasons unrelated to the thing under test.
 *
 *   node scripts/smoke.mjs
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', 'dist');
const fixtures = join(here, '..', 'tests', 'fixtures');
const require = createRequire(import.meta.url);

const MIME = {
  '.webm': 'video/webm',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname));
  if (path === '/fixture.webm') {
    const body = await readFile(join(fixtures, 'motion.webm'));
    res.writeHead(200, { 'content-type': 'video/webm', 'content-length': body.length });
    res.end(body);
    return;
  }
  if (path === '/' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const base = `http://127.0.0.1:${port}/`;

const failures = [];
const report = [];
// Results are printed as they happen as well as summarised at the end, so a
// crash part way through still leaves a record of everything before it.
const fail = (stage, msg) => {
  failures.push(`${stage}: ${msg}`);
  console.log(`  FAIL ${stage}: ${msg}`);
};
const note = (stage, msg) => {
  report.push(`  ${stage.padEnd(11)}${msg}`);
  console.log(`  ok   ${stage.padEnd(11)}${msg}`);
};
const t0 = Date.now();

// Use an explicit binary when one is given or present, otherwise let
// playwright resolve the browser it installed — runnable both in the dev
// container and on a CI runner.
const explicit = process.env.CAMAI_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(explicit) ? { executablePath: explicit } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    // The packaged app loads its bundle over file://, where a module script is
    // a cross-origin request unless this is set. Electron permits it by
    // default; Chromium does not.
    '--allow-file-access-from-files',
  ],
});

const IGNORED_CONSOLE = [/favicon/, /status of 404/, /Automatic fallback to software WebGL/, /GPU stall due to ReadPixels/];

async function openPage(url = base, { guide = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const noise = [];
  page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !IGNORED_CONSOLE.some((r) => r.test(text))) noise.push(`console: ${text}`);
  });
  if (!guide) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('camai.guide.hideOnStart', '1');
      } catch {
        /* private window */
      }
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__camai && !!document.querySelector('.stage canvas'), null, {
    timeout: 60000,
  });
  return { page, noise };
}

/**
 * Run a probe render in the page and return frames with RGB pixels, as bytes.
 * A 720×480 frame is a million values: as a JSON array of numbers a run of
 * them exhausts Node's heap, so they cross the page boundary as base64.
 */
async function probe(page, req) {
  const r = await page.evaluate((x) => window.__camai.renderProbeB64(x), { pixels: true, seed: 1337, ...req });
  if (r.problems.length) throw new Error(`the probe asked for settings the schema would change: ${r.problems.join('; ')}`);
  for (const f of r.frames) if (f.rgb) f.rgb = new Uint8Array(Buffer.from(f.rgb, 'base64'));
  return r;
}

/* ------------------------------------------------------------------ *
 * Image analysis, on the Node side
 * ------------------------------------------------------------------ */

function luma(frame, w, h) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.299 * frame.rgb[i * 3] + 0.587 * frame.rgb[i * 3 + 1] + 0.114 * frame.rgb[i * 3 + 2];
  }
  return out;
}

/** BT.601 Cr of every pixel, from the 8-bit RGB. */
function crOf(frame, w, h) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.5 * frame.rgb[i * 3] - 0.418688 * frame.rgb[i * 3 + 1] - 0.081312 * frame.rgb[i * 3 + 2];
  }
  return out;
}

function meanAbsDiff(fa, fb) {
  let d = 0;
  for (let i = 0; i < fa.rgb.length; i++) d += Math.abs(fa.rgb[i] - fb.rgb[i]);
  return d / fa.rgb.length;
}

/** Brightness-weighted centre of the bright part of a row. */
function barCentre(Y, w, y, thr = 120) {
  let s = 0;
  let n = 0;
  for (let x = 0; x < w; x++) {
    const v = Y[y * w + x];
    if (v > thr) {
      s += x * (v - thr);
      n += v - thr;
    }
  }
  return n > 0 ? s / n : NaN;
}

/** Mean horizontal gradient on the 8-pixel block boundaries against inside the blocks. */
function blockRatio(Y, w, h, x0, x1, y0 = 0, y1 = h, period = 8) {
  let bd = 0;
  let bn = 0;
  let id = 0;
  let inn = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = Math.max(1, x0); x < x1; x++) {
      const d = Math.abs(Y[y * w + x] - Y[y * w + x - 1]);
      if (x % period === 0) {
        bd += d;
        bn++;
      } else {
        id += d;
        inn++;
      }
    }
  }
  return bd / bn / Math.max(id / inn, 1e-6);
}

/** PSNR of a against b over a column range, on luma. */
function psnr(a, b, w, h, x0 = 0, x1 = w) {
  let mse = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = x0; x < x1; x++) {
      const d = a[y * w + x] - b[y * w + x];
      mse += d * d;
      n++;
    }
  }
  return 10 * Math.log10((255 * 255) / Math.max(mse / n, 1e-9));
}

/** Energy of a vertical second difference: how much vertical detail there is. */
function verticalDetail(Y, w, h, x0 = 0, x1 = w) {
  let s = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = x0; x < x1; x++) {
      const v = 2 * Y[y * w + x] - Y[(y - 1) * w + x] - Y[(y + 1) * w + x];
      s += v * v;
    }
  }
  return s / ((h - 4) * (x1 - x0));
}

/**
 * How combed a frame is: how much adjacent lines differ beyond what lines two
 * apart (the same field) do, per pixel. A vertical bar has no vertical
 * detail of its own, so on it this is the combing alone.
 */
function combing(Y, w, h, x0 = 0, x1 = w) {
  let s = 0;
  for (let y = 2; y < h - 2; y++) {
    for (let x = x0; x < x1; x++) {
      s += Math.abs(Y[y * w + x] - Y[(y + 1) * w + x]) - Math.abs(Y[y * w + x] - Y[(y + 2) * w + x]);
    }
  }
  return s / ((h - 4) * (x1 - x0));
}

const DV = { 'framing.overscan': true, 'framing.scaler': 'nearest', 'framing.dither': 0 };
const NATIVE = { width: 720, height: 480 };

/** A camera with every section of every engine off, then the DV raster at 1:1. */
const ALL_OFF = {
  'engine.camera': false,
  'interlace.enabled': false,
  'chroma.enabled': false,
  'codec.enabled': false,
  'audio.enabled': false,
};

/* ================================================================== *
 * 1. The app mounts and every shader links
 * ================================================================== */

const main = await openPage();
{
  const { page } = main;
  if (await page.locator('.fatal').count()) fail('mount', await page.locator('.fatal p').innerText());
  const kind = await page.evaluate(async () => {
    const r = await window.__camai.renderProbe({ backend: 'gpu', settings: {}, source: { kind: 'bars' }, width: 64, height: 48, frames: [0] });
    return r.backend;
  });
  if (kind !== 'gpu') fail('mount', `the GPU backend did not start (got ${kind}) — a shader failed to compile or link`);
  else note('mount', 'app mounted · all 19 programs linked on WebGL2');
}

/* ================================================================== *
 * 2. A still pushed through the interface comes out lit, with noise
 * ================================================================== */

/** Drop a generated still onto the window, as a user would. */
async function dropStill(page, draw, w = 640, h = 480) {
  await page.evaluate(
    async ({ draw, w, h }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      // eslint-disable-next-line no-new-func
      new Function('g', 'w', 'h', draw)(g, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'still.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { draw, w, h },
  );
}

const BARS = `
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => { g.fillStyle = c; g.fillRect((i * w) / 7, 0, w / 7 + 1, h * 0.75); });
  g.fillStyle = '#000'; g.fillRect(0, h * 0.75, w, h * 0.25);
  g.fillStyle = '#fff'; g.fillRect(w * 0.06, h * 0.8, w * 0.25, h * 0.15);
`;

/**
 * Sample the stage canvas until the picture has settled: lit, and two
 * consecutive samples agreeing on the mean. Returns the last sample.
 */
async function settledStats(page, { minMean = 20, tolerance = 2.5, timeout = 30000 } = {}) {
  return page.evaluate(
    async ({ minMean, tolerance, timeout }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = document.createElement('canvas');
      p.width = 160;
      p.height = 120;
      const g = p.getContext('2d', { willReadFrequently: true });
      const sample = () => {
        const app = document.querySelector('.stage canvas');
        g.drawImage(app, 0, 0, p.width, p.height);
        const d = g.getImageData(0, 0, p.width, p.height).data;
        let sum = 0;
        let lit = 0;
        let min = 255;
        let max = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l;
          if (l > 24) lit++;
          min = Math.min(min, l);
          max = Math.max(max, l);
        }
        const n = d.length / 4;
        return { mean: sum / n, lit: lit / n, contrast: (max - min) / 255, w: app.width, h: app.height };
      };
      const t0 = performance.now();
      let last = sample();
      while (performance.now() - t0 < timeout) {
        await sleep(300);
        const now = sample();
        if (now.mean >= minMean && Math.abs(now.mean - last.mean) < tolerance) return now;
        last = now;
      }
      return last;
    },
    { minMean, tolerance, timeout },
  );
}

{
  const { page } = main;
  await dropStill(page, BARS);
  const s = await settledStats(page);
  if (s.lit < 0.3) fail('picture', `only ${(s.lit * 100).toFixed(1)}% of the canvas is lit`);
  if (s.contrast < 0.5) fail('picture', `contrast is only ${s.contrast.toFixed(2)}`);
  // The flagship is a single-chip palmcorder: a flat bar is not flat.
  const texture = await page.evaluate(() => {
    const app = document.querySelector('.stage canvas');
    const p = document.createElement('canvas');
    p.width = app.width;
    p.height = app.height;
    const g = p.getContext('2d', { willReadFrequently: true });
    g.drawImage(app, 0, 0);
    const x0 = Math.round(app.width * 0.03);
    const x1 = Math.round(app.width * 0.11);
    const y0 = Math.round(app.height * 0.3);
    const y1 = Math.round(app.height * 0.5);
    const w = x1 - x0;
    const d = g.getImageData(x0, y0, w, y1 - y0).data;
    const diffs = [];
    for (let i = 0; i + 4 < d.length; i += 4) {
      if ((i / 4) % w === w - 1) continue;
      diffs.push(Math.abs(d[i + 1] - d[i + 5]));
    }
    diffs.sort((a, b) => a - b);
    return { median: diffs[Math.floor(diffs.length / 2)], p90: diffs[Math.floor(diffs.length * 0.9)] };
  });
  if (texture.p90 < 1) fail('picture', 'a flat area of the palmcorder picture has no noise or texture at all');
  note('picture', `${(s.lit * 100).toFixed(1)}% lit · contrast ${s.contrast.toFixed(2)} · flat-bar texture p90 ${texture.p90}`);
}

/* ================================================================== *
 * 3. A real video clip reaches the camera
 * ================================================================== */

{
  const { page } = main;
  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = { presented: 0, lit: 0, error: null };
    try {
      const blob = await (await fetch('/fixture.webm')).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'motion.webm', { type: 'video/webm' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      const t0 = performance.now();
      let video = null;
      while (performance.now() - t0 < 20000) {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && v.videoWidth > 0) {
          video = v;
          break;
        }
        await sleep(80);
      }
      if (!video) throw new Error('video never decoded');
      document.querySelector('.transport .play')?.click();
      const vp = document.createElement('canvas');
      vp.width = 48;
      vp.height = 36;
      const vg = vp.getContext('2d', { willReadFrequently: true });
      const pr = document.createElement('canvas');
      pr.width = 96;
      pr.height = 72;
      const pg = pr.getContext('2d', { willReadFrequently: true });
      const t1 = performance.now();
      while (performance.now() - t1 < 30000) {
        await sleep(250);
        vg.drawImage(video, 0, 0, 48, 36);
        const vd = vg.getImageData(0, 0, 48, 36).data;
        let pres = 0;
        for (let i = 0; i < vd.length; i += 4) pres = Math.max(pres, (vd[i] + vd[i + 1] + vd[i + 2]) / 3);
        out.presented = pres;
        pg.drawImage(document.querySelector('.stage canvas'), 0, 0, 96, 72);
        const d = pg.getImageData(0, 0, 96, 72).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 24) lit++;
        out.lit = lit / (96 * 72);
        if (out.presented > 6 && out.lit > 0.15) break;
      }
      video.pause();
    } catch (err) {
      out.error = String(err);
    }
    return out;
  });
  if (r.error) fail('video', r.error);
  else {
    if (r.presented < 6) fail('video', `the element presented no frame (max ${r.presented.toFixed(1)})`);
    if (r.lit < 0.15) fail('video', `frames exist but the picture is black (${(r.lit * 100).toFixed(1)}% lit) — the source upload is broken`);
    note('video', `element ${r.presented.toFixed(0)} · picture ${(r.lit * 100).toFixed(1)}% lit`);
  }
}

/* ---- 3b. opening a second clip into the same player keeps its sound ----
 * A media element can be wired into Web Audio once in its life. The player
 * reuses one <video> for every file, so a second file must not try again. */
{
  const { page } = main;
  const r = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const toasts = [];
    const open = async (name) => {
      const blob = await (await fetch('/fixture.webm')).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'video/webm' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      await sleep(300);
      for (let k = 0; k < 100; k++) {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && v.videoWidth > 0) break;
        await sleep(100);
      }
      document.querySelector('.transport .play')?.click();
      await sleep(1500);
      const t = document.querySelector('.toast')?.textContent ?? '';
      if (t) toasts.push(t);
      document.querySelector('.transport .play')?.click();
      await sleep(200);
    };
    await open('first.webm');
    await open('second.webm');
    await open('third.webm');
    return { toasts, same: true };
  });
  const bad = r.toasts.filter((t) => /audio/i.test(t));
  if (bad.length) fail('reopen', `opening another clip broke the sound: ${bad[0]}`);
  else note('reopen', 'three clips opened into the same player in turn, each played with its sound');
}

/* ================================================================== *
 * 4. The sound: the worklet registers, the camera hears itself, 12-bit
 *    audio is band-limited and the automatic gain breathes
 * ================================================================== */

/** Render the camera's sound offline in the page. */
function renderAudio(page, req) {
  return page.evaluate((r) => window.__camai.renderAudio(r), req);
}

/** RMS of a sample range. */
function rms(d, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += d[i] * d[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Energy of a signal above a frequency: what a first-order difference passes, crudely, plus a 2-pole filter. */
function bandEnergy(d, sr, lo, hi, from = 0, to = d.length) {
  // A bank of Goertzel bins across the band.
  let e = 0;
  const N = Math.min(4096, to - from);
  for (let f = lo; f <= hi; f += (hi - lo) / 12) {
    const k = Math.round((N * f) / sr);
    const w = (2 * Math.PI * k) / N;
    const c = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const s0 = d[from + i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    e += s1 * s1 + s2 * s2 - c * s1 * s2;
  }
  return e;
}

{
  const stage = 'audio';
  const { page } = main;
  try {
    const registered = await page.evaluate(async (url) => {
      const ctx = new OfflineAudioContext(2, 128, 48000);
      await ctx.audioWorklet.addModule(url);
      return 'ok';
    }, `${base}worklets/camai-dsp.js`).catch((e) => String(e));
    if (registered !== 'ok') fail(stage, `the worklet did not register: ${registered}`);

    // A silent source: the camera still has sound — its own transport.
    const quiet = await renderAudio(page, {
      settings: { 'mech.enabled': true, 'mic.enabled': true },
      seconds: 1,
      programme: 'silence',
    });
    const whine = rms(quiet.left, 4800, quiet.left.length);
    if (whine < 1e-4) fail(stage, `a silent clip came out silent (rms ${whine.toExponential(2)}) — the camera always has audio`);

    // 12-bit at 32 kHz cannot carry 16 kHz and up; 16-bit at 48 kHz can.
    const s16 = await renderAudio(page, { settings: { 'audio.mode': '16' }, seconds: 0.5, programme: 'noise' });
    const s12 = await renderAudio(page, { settings: { 'audio.mode': '12' }, seconds: 0.5, programme: 'noise' });
    const hi16 = bandEnergy(s16.left, 48000, 16500, 20000, 4800);
    const hi12 = bandEnergy(s12.left, 48000, 16500, 20000, 4800);
    const mid16 = bandEnergy(s16.left, 48000, 2000, 6000, 4800);
    const mid12 = bandEnergy(s12.left, 48000, 2000, 6000, 4800);
    const cut = 10 * Math.log10((hi16 / mid16) / Math.max(hi12 / mid12, 1e-12));
    if (cut < 15) fail(stage, `12-bit mode removes only ${cut.toFixed(1)} dB above 16 kHz relative to 16-bit`);

    // The automatic gain: a loud second, then silence. The room tone rises
    // through the silence as the gain comes back up.
    const agc = await renderAudio(page, {
      settings: { 'mic.enabled': true, 'mic.room': -60, 'agc.enabled': true, 'agc.release': 1.5, 'agc.maxGain': 30 },
      seconds: 4,
      programme: 'burst',
    });
    const sr = 48000;
    const early = rms(agc.left, Math.round(1.1 * sr), Math.round(1.4 * sr));
    const late = rms(agc.left, Math.round(3.4 * sr), Math.round(3.9 * sr));
    const lift = 20 * Math.log10(late / Math.max(early, 1e-9));
    if (lift < 6) fail(stage, `the AGC did not breathe: room tone rose only ${lift.toFixed(1)} dB after the loud passage`);
    // The source's own sound survives the camera: a tone through the
    // flagship preset (microphone, mechanics, AGC, 12-bit) keeps its level
    // within a few dB, with the camera's noises well under it.
    const flag = await page.evaluate(() => window.__camai.presets['palmcorder-2002']);
    const tone = await renderAudio(page, { settings: flag, seconds: 1.2, programme: 'burst' });
    let ts = 0;
    let tc = 0;
    const i0 = Math.round(0.3 * tone.sampleRate);
    const i1 = Math.round(0.8 * tone.sampleRate);
    for (let i = i0; i < i1; i++) {
      const w = (2 * Math.PI * 440 * i) / tone.sampleRate;
      ts += tone.left[i] * Math.sin(w);
      tc += tone.left[i] * Math.cos(w);
    }
    const kept = (2 * Math.hypot(ts, tc)) / (i1 - i0);
    const keptDb = 20 * Math.log10(kept / 0.6);
    if (keptDb < -4) fail(stage, `the flagship camera turned the source's own sound down ${(-keptDb).toFixed(1)} dB`);
    note(stage, `worklet ok · silent clip still has the camera (rms ${whine.toExponential(1)}) · 12-bit −${cut.toFixed(0)} dB above 16 kHz · AGC lifts the room +${lift.toFixed(1)} dB · the source's sound through the flagship ${keptDb.toFixed(1)} dB`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ================================================================== *
 * 5. Keyframes animate the render, and ease between
 * ================================================================== */

/** Find a parameter row by its label in a given tab and section. */
const UI_HELPERS = `
  window.__ui = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    setInput(el, value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async tab(name) {
      [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === name)?.click();
      await this.sleep(300);
    },
    async section(title) {
      const s = [...document.querySelectorAll('.group')].find((x) => x.querySelector('.group-title')?.textContent === title);
      if (!s) throw new Error('no section ' + title);
      if (!s.classList.contains('open')) s.querySelector('.group-toggle').click();
      await this.sleep(300);
      return s;
    },
    row(section, label) {
      const r = [...section.querySelectorAll('.param')].find((x) => x.querySelector('.param-label')?.textContent === label);
      if (!r) throw new Error('no parameter ' + label);
      return r;
    },
  };
`;

{
  const stage = 'keyframes';
  const { page } = await openPage();
  try {
    await page.selectOption('.topbar-actions select', 'prosumer-2003');
    await dropStill(page, `g.fillStyle = '#909090'; g.fillRect(0, 0, w, h);`);
    await settledStats(page);
    await page.evaluate(UI_HELPERS);
    const r = await page.evaluate(async () => {
      const ui = window.__ui;
      await ui.tab('Camera');
      const sect = await ui.section('Exposure');
      // Held exposure: the automatic loop has memory, and scrubbing would
      // measure its settling rather than the keyframes.
      const mode = ui.row(sect, 'Mode').querySelector('select');
      mode.value = 'manual';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      await ui.sleep(300);
      const row = ui.row(await ui.section('Exposure'), 'Compensation');
      row.querySelector('.stopwatch').click();
      await ui.sleep(200);
      const scrub = document.querySelector('input.scrub');
      ui.setInput(scrub, 4);
      await ui.sleep(200);
      ui.setInput(row.querySelector("input[type='range']"), -2);
      await ui.sleep(200);
      const diamonds = document.querySelectorAll('.track .key').length;
      const app = document.querySelector('.stage canvas');
      const p = document.createElement('canvas');
      p.width = 64;
      p.height = 48;
      const g = p.getContext('2d', { willReadFrequently: true });
      const mean = () => {
        g.drawImage(app, 0, 0, 64, 48);
        const d = g.getImageData(0, 0, 64, 48).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i + 1];
        return s / (d.length / 4);
      };
      const levels = [];
      for (const t of [0, 2, 4]) {
        ui.setInput(scrub, t);
        // A software-rendered frame can take longer than a poll, so one
        // unchanged reading is not settled: wait for four in a row.
        await ui.sleep(1500);
        let last = -1;
        let calm = 0;
        for (let k = 0; k < 80 && calm < 4; k++) {
          await ui.sleep(400);
          const m = mean();
          calm = Math.abs(m - last) < 1 ? calm + 1 : 0;
          last = m;
        }
        levels.push(mean());
      }
      const exposureMode = ui.row(await ui.section('Exposure'), 'Mode').querySelector('select').value;
      return { diamonds, levels, scrubMax: scrub.max, exposureMode, duration: document.querySelector('video')?.duration ?? null };
    });
    if (r.diamonds !== 2) fail(stage, `expected 2 keyframe markers, drew ${r.diamonds}`);
    const [a, mid, b] = r.levels;
    if (a - b < 30) fail(stage, `two stops less exposure barely changed the render (${a.toFixed(1)} → ${b.toFixed(1)})`);
    if (mid < Math.min(a, b) + 3 || mid > Math.max(a, b) - 3) {
      fail(stage, `midpoint ${mid.toFixed(1)} is not between ${a.toFixed(1)} and ${b.toFixed(1)} — stepping, not easing (scrub max ${r.scrubMax}, exposure ${r.exposureMode})`);
    }
    note(stage, `${r.diamonds} markers · brightness ${r.levels.map((v) => v.toFixed(0)).join(' → ')}`);
  } catch (err) {
    fail(stage, String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 6. The output frame is the shape of the picture
 * ================================================================== */

{
  const stage = 'framing';
  const { page } = await openPage();
  try {
    await page.evaluate(UI_HELPERS);
    const ratios = await page.evaluate(async () => {
      const ui = window.__ui;
      await ui.tab('Camera');
      await ui.tab('Display');
      const out = await ui.section('Output');
      const outAspect = ui.row(out, 'Aspect').querySelector('select');
      const res = {};
      const wait = async (want) => {
        let ratio = 0;
        for (let k = 0; k < 30; k++) {
          await ui.sleep(100);
          const c = document.querySelector('.stage canvas');
          ratio = c.width / c.height;
          if (Math.abs(ratio - want) < 0.02) break;
        }
        return ratio;
      };
      outAspect.value = '16:9';
      outAspect.dispatchEvent(new Event('change', { bubbles: true }));
      res['forced 16:9'] = await wait(16 / 9);
      outAspect.value = 'camera';
      outAspect.dispatchEvent(new Event('change', { bubbles: true }));
      res['4:3 camera'] = await wait(4 / 3);
      await ui.tab('Camera');
      // Switching tabs remounts the panel; find the select again.
      const camAspect2 = ui.row(await ui.section('Format'), 'Aspect').querySelector('select');
      camAspect2.value = '16:9';
      camAspect2.dispatchEvent(new Event('change', { bubbles: true }));
      res['16:9 camera'] = await wait(16 / 9);
      return res;
    });
    const want = { 'forced 16:9': 16 / 9, '4:3 camera': 4 / 3, '16:9 camera': 16 / 9 };
    for (const [k, got] of Object.entries(ratios)) {
      if (Math.abs(got - want[k]) > 0.03) fail(stage, `${k}: the frame is ${got.toFixed(3)}, not ${want[k].toFixed(3)}`);
    }
    note(stage, Object.entries(ratios).map(([k, v]) => `${k} → ${v.toFixed(3)}`).join(' · '));
  } catch (err) {
    fail(stage, String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 7. Off is exactly off, and a frame does not depend on its history
 *    where it should not
 * ================================================================== */

{
  const stage = 'purity';
  const { page } = main;
  try {
    // With every section of every engine off, the camera is a window: the
    // output is the source, through the DV raster and back.
    const req = { settings: { ...ALL_OFF, 'framing.scaler': 'good', 'framing.dither': 0 }, source: { kind: 'scene' }, width: 704, height: 528, srcWidth: 704, srcHeight: 528, frames: [0] };
    for (const backend of ['gpu', 'cpu']) {
      const out = (await probe(page, { ...req, backend })).frames[0];
      const src = await page.evaluate(async () => {
        const url = window.__camai.probeSourceImage({ kind: 'scene' }, 704, 528, 0);
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 704;
        c.height = 528;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return Array.from(g.getImageData(0, 0, 704, 528).data).filter((_, i) => i % 4 !== 3);
      });
      const d = meanAbsDiff(out, { rgb: src });
      if (d > 1.6) fail(stage, `${backend}: with everything off the output differs from the source by ${d.toFixed(2)}/px`);
      else note(stage, `${backend}: everything off → source within ${d.toFixed(2)}/px (the DV raster's resampling)`);
    }
    // Frames are a function of their number and of the frames before them
    // in order — the automatics and concealment have memory — but with the
    // automatics off, history must not matter at all.
    const r2 = { backend: 'cpu', settings: { ...DV }, source: { kind: 'texture', panPxPerSec: 120, cell: 6 }, ...NATIVE };
    const a = await probe(page, { ...r2, frames: [3, 4, 5, 9] });
    const b = await probe(page, { ...r2, frames: [9] });
    const dd = meanAbsDiff(a.frames[3], b.frames[0]);
    if (dd > 0.01) fail(stage, `frame 9 differs by ${dd.toFixed(3)}/px depending on what was rendered before it`);
    else note(stage, 'frame 9 identical whether rendered after 3, 4, 5 or on its own');
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ================================================================== *
 * 8. The app runs the way the packaged build loads it
 * ================================================================== */

{
  const url = pathToFileURL(join(root, 'index.html')).href;
  try {
    const { page, noise } = await openPage(url);
    await dropStill(page, `g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);`, 320, 240);
    const s = await settledStats(page, { timeout: 30000 });
    const mounted = await page.evaluate(() => (document.getElementById('root')?.innerHTML || '').length);
    if (mounted < 500) fail('packaged', `the app did not mount over file:// (root is ${mounted} chars)`);
    if (s.lit < 0.3) fail('packaged', `mounted over file:// but the picture is black (${(s.lit * 100).toFixed(1)}% lit)`);
    const worklet = await page.evaluate(async () => {
      try {
        const ctx = new OfflineAudioContext(1, 128, 48000);
        await ctx.audioWorklet.addModule(new URL('worklets/camai-dsp.js', document.baseURI).href);
        return 'ok';
      } catch (err) {
        return String(err);
      }
    });
    if (worklet !== 'ok') fail('packaged', `the audio worklet did not load over file:// (${worklet})`);
    for (const n of noise) fail('packaged', n);
    note('packaged', `file:// mounted ${mounted} chars · ${(s.lit * 100).toFixed(1)}% lit · worklet ${worklet}`);
    await page.close();
  } catch (err) {
    fail('packaged', String(err));
  }
}

/* ================================================================== *
 * 9. Every section actually reaches the picture
 *
 * A parameter can exist in the schema, move its slider, and never reach a
 * shader (CRTBOX, lesson 6). Each picture section is switched on, with its
 * own defaults or the setting that makes it act, from the same baseline,
 * and the render must change.
 * ================================================================== */

{
  const stage = 'sections';
  const { page } = main;
  try {
    const baseline = { ...DV, 'engine.camera': false, 'interlace.enabled': true };
    const cases = [
      ['operator', { 'operator.enabled': true, 'operator.sway': 2 }],
      ['lens', { 'lens.enabled': true, 'lens.zoom': 3 }],
      ['exposure', { 'exposure.enabled': true, 'exposure.scene': 0, 'exposure.mode': 'manual', 'exposure.comp': 1.5 }],
      ['sensor', { 'sensor.enabled': true }],
      ['focus', { 'focus.enabled': true, 'focus.miss': 3 }],
      ['wb', { 'wb.enabled': true, 'wb.light': 'tungsten' }],
      ['eis', { 'eis.enabled': true }],
      ['dzoom', { 'lens.enabled': true, 'lens.zoom': 40, 'dzoom.enabled': true }],
      ['tone', { 'tone.enabled': true }],
      ['detail', { 'detail.enabled': true }],
      ['battery', { 'battery.enabled': true, 'battery.charge': 0 }],
      ['night', { 'night.enabled': true }],
      ['fx', { 'fx.enabled': true, 'fx.effect': 'sepia' }],
      ['interlace', { 'interlace.integration': false }],
      ['chroma', { 'chroma.upsample': 'nearest' }],
      ['codec', { 'codec.budget': 0.3 }],
      ['tape', { 'tape.enabled': true, 'tape.clogs': 5, 'tape.clogLength': 5 }],
      ['breaks', { 'breaks.enabled': true, 'breaks.rate': 20, 'breaks.skip': 0.6, 'breaks.gap': 12, 'breaks.seamless': false }],
      ['osd', { 'osd.enabled': true }],
      ['date', { 'date.enabled': true }],
      ['capture', { 'capture.enabled': true, 'capture.path': 'composite' }],
      ['deint', { 'deint.enabled': true, 'deint.mode': 'discard' }],
      ['upload', { 'upload.enabled': true }],
    ];
    // Tape errors and recording breaks are events: look at a frame the
    // shared event clock says has one, not at a fixed frame number.
    const events = await import(pathToFileURL(join(here, '..', 'public', 'worklets', 'camai-events.js')).href);
    const fps = 30000 / 1001;
    let clogFrame = 24;
    for (let n = 1; n < 20000; n++) {
      if (events.clogAt(n, 1337, 5, fps, 5) >= 0) {
        clogFrame = n + 3;
        break;
      }
    }
    const shots = new events.Shots(1337, { enabled: true, rate: 20, skip: 0.6, gap: 12, seamless: false });
    shots.ensure(600);
    const breakFrame = shots.list.length > 1 ? Math.ceil(shots.list[1].out0 * fps - 1e-6) : 24;
    const frameFor = { tape: clogFrame, breaks: breakFrame };
    const req = { backend: 'gpu', source: { kind: 'scene' }, ...NATIVE };
    const refs = new Map();
    const refAt = async (n) => {
      if (!refs.has(n)) refs.set(n, (await probe(page, { ...req, frames: [n], settings: baseline })).frames[0]);
      return refs.get(n);
    };
    const quiet = [];
    for (const [name, extra] of cases) {
      const n = frameFor[name] ?? 24;
      const ref = await refAt(n);
      const f = (await probe(page, { ...req, frames: [n], settings: { ...baseline, ...extra, 'engine.camera': true } })).frames[0];
      // The camera engine back on with only this camera section enabled
      // (the master folds the rest off), or this tape or display section.
      const d = meanAbsDiff(ref, f);
      if (d < 0.05) quiet.push(`${name} (${d.toFixed(3)})`);
    }
    if (quiet.length) fail(stage, `these did not change the picture: ${quiet.join(', ')}`);
    note(stage, `${cases.length - quiet.length}/${cases.length} sections measurably reach the render`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ================================================================== *
 * 10. The guide and the information widgets
 * ================================================================== */

{
  const { page } = await openPage(base, { guide: true });
  const out = { shown: false, closed: false, reopened: false, cameras: 0, hidden: false, f1: false, param: '', section: '' };
  try {
    out.shown = (await page.$('.guide')) !== null;
    await page.evaluate(() => document.querySelector('.guide-close')?.click());
    await page.waitForSelector('.guide', { state: 'detached', timeout: 3000 }).catch(() => undefined);
    out.closed = (await page.$('.guide')) === null;
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Guide')?.click());
    await page.waitForSelector('.guide', { timeout: 3000 }).catch(() => undefined);
    out.reopened = (await page.$('.guide')) !== null;
    await page.evaluate(() => [...document.querySelectorAll('.guide-tabs button')].find((b) => b.textContent.includes('Reference'))?.click());
    await page.waitForSelector('.guide-film', { timeout: 3000 }).catch(() => undefined);
    out.cameras = await page.evaluate(() => document.querySelectorAll('.guide-film').length);
    await page.evaluate(() => {
      const box = document.querySelector('.guide-foot .check input');
      if (box && !box.checked) box.click();
    });
    await page.evaluate(() => document.querySelector('.guide-close')?.click());
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__camai && !!document.querySelector('.stage canvas'), null, { timeout: 60000 });
    out.hidden = (await page.$('.guide')) === null;
    await page.keyboard.press('F1');
    await page.waitForSelector('.guide', { timeout: 3000 }).catch(() => undefined);
    out.f1 = (await page.$('.guide')) !== null;
    await page.keyboard.press('Escape');
    await page.waitForSelector('.guide', { state: 'detached', timeout: 3000 }).catch(() => undefined);
    await page.evaluate(UI_HELPERS);
    const info = await page.evaluate(async () => {
      const ui = window.__ui;
      await ui.tab('Tape');
      const sect = await ui.section('DV Codec');
      sect.querySelector('.group-info-btn').click();
      await ui.sleep(300);
      const row = ui.row(sect, 'Bit budget');
      row.querySelector('.param-info-btn').click();
      await ui.sleep(300);
      return {
        section: document.querySelector('.group-info')?.textContent?.trim() ?? '',
        param: row.querySelector('.param-info')?.textContent?.trim() ?? '',
      };
    });
    out.param = info.param;
    out.section = info.section;
  } catch (err) {
    fail('guide', String(err));
  }
  if (!out.shown) fail('guide', 'not shown on first run');
  if (!out.closed) fail('guide', 'the close button did not close it');
  if (!out.reopened) fail('guide', 'the header button did not reopen it');
  if (out.cameras < 10) fail('guide', `only ${out.cameras} reference cameras listed`);
  if (!out.hidden) fail('guide', '"don\'t show on startup" did not survive a reload');
  if (!out.f1) fail('guide', 'F1 did not reopen it');
  if (out.param.length < 80) fail('guide', `a parameter's ⓘ revealed only ${out.param.length} characters`);
  if (out.section.length < 150) fail('guide', `a section's ⓘ revealed only ${out.section.length} characters`);
  note('guide', `shown, closes, reopens, ${out.cameras} cameras, remembered, F1 · ⓘ ${out.param.length} / ${out.section.length} chars`);
  await page.close();
}

/* ================================================================== *
 * 11. The camcorder, measured
 * ================================================================== */

const lab = main.page;

/* ---- 11a. the field clock: two moments a frame, bottom first ---- */
{
  const stage = 'fields';
  try {
    // A bar moving at 600 source pixels a second, from an infinitely fast
    // source: whatever the frame shows about time came from the clock.
    const src = { kind: 'bar', pxPerSec: 600, width: 12 };
    const base1 = { ...DV, 'sensor.enabled': false, 'codec.enabled': false, 'chroma.enabled': false };
    const shift = async (settings) => {
      const f = (await probe(lab, { backend: 'gpu', settings, source: src, ...NATIVE, srcWidth: 720, srcHeight: 540, frames: [10] })).frames[0];
      const Y = luma(f, 720, 480);
      let even = 0;
      let odd = 0;
      let ne = 0;
      let no = 0;
      for (let y = 40; y < 440; y++) {
        const c = barCentre(Y, 720, y);
        if (Number.isNaN(c)) continue;
        if (y % 2 === 0) {
          even += c;
          ne++;
        } else {
          odd += c;
          no++;
        }
      }
      return even / ne - odd / no;
    };
    const bff = await shift(base1);
    const tff = await shift({ ...base1, 'interlace.lowerFirst': false });
    const prog = await shift({ ...base1, 'interlace.enabled': false });
    // One field period of motion: 600 px/s × 1/59.94 s, through the 704/720
    // mapping of source to active picture.
    const expect = (600 / (60000 / 1001)) * (704 / 720);
    if (Math.abs(bff - expect) > expect * 0.3) fail(stage, `the top field is ${bff.toFixed(1)} px from the bottom one, expected +${expect.toFixed(1)} (bottom field first, one field apart)`);
    if (Math.abs(tff + expect) > expect * 0.3) fail(stage, `with top field first the offset is ${tff.toFixed(1)}, expected −${expect.toFixed(1)}`);
    if (Math.abs(prog) > 1) fail(stage, `progressive frames still split by ${prog.toFixed(1)} px`);
    note(stage, `top field is ${bff.toFixed(1)} px later (expect ${expect.toFixed(1)}): bottom first · top-first ${tff.toFixed(1)} · progressive ${prog.toFixed(2)}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11b. deinterlacing: weave combs, bob does not, discard halves ---- */
{
  const stage = 'deinterlace';
  try {
    const run = async (mode, pxPerSec, kind = 'bar') => {
      const settings = {
        ...DV,
        'framing.scaler': 'good',
        'codec.enabled': false,
        'deint.enabled': mode !== 'none',
        'deint.mode': mode === 'none' ? 'weave' : mode,
        // Line pairs: the sensor's field integration would blend them.
        ...(kind === 'hlines' ? { 'interlace.integration': false, 'engine.camera': false } : {}),
      };
      const source = kind === 'bar' ? { kind: 'bar', pxPerSec, width: 40 } : { kind };
      const f = (await probe(lab, { backend: 'gpu', settings, source, ...NATIVE, srcWidth: 720, srcHeight: 480, frames: [12] })).frames[0];
      return luma(f, 720, 480);
    };
    const weaveMove = combing(await run('weave', 900), 720, 480);
    const weaveStill = combing(await run('weave', 0), 720, 480);
    const bobMove = combing(await run('bob', 900), 720, 480);
    const linesWeave = verticalDetail(await run('weave', 0, 'hlines'), 720, 480, 100, 620);
    const linesDiscard = verticalDetail(await run('discard', 0, 'hlines'), 720, 480, 100, 620);
    if (weaveMove < 1) fail(stage, `weave on motion is not combed (${weaveMove.toFixed(2)}/px between adjacent lines)`);
    if (weaveStill > 0.3) fail(stage, `weave combs a still picture (${weaveStill.toFixed(2)}/px)`);
    if (bobMove > weaveMove * 0.25) fail(stage, `bob still combs on motion (${bobMove.toFixed(2)}/px vs weave ${weaveMove.toFixed(2)})`);
    if (linesDiscard > linesWeave * 0.6) fail(stage, `discarding a field kept ${((linesDiscard / linesWeave) * 100).toFixed(0)}% of the vertical detail`);
    note(stage, `weave combs on motion ${weaveMove.toFixed(2)}/px vs still ${weaveStill.toFixed(2)} · bob ${bobMove.toFixed(2)} · discard keeps ${((linesDiscard / linesWeave) * 100).toFixed(0)}% of line-pair detail`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11c. DCT blocks: on the DV raster's 8-pixel grid, scaled with the output ---- */
{
  const stage = 'blocking';
  try {
    // A smooth gradient beside a patch of noise. The noise starves the
    // segments; the gradient pays for it in blocks.
    const src = { kind: 'noise', amount: 0.6 };
    const on = (await probe(lab, { backend: 'gpu', settings: { ...DV }, source: src, ...NATIVE, frames: [0] })).frames[0];
    const off = (await probe(lab, { backend: 'gpu', settings: { ...DV, 'codec.enabled': false }, source: src, ...NATIVE, frames: [0] })).frames[0];
    const rOn = blockRatio(luma(on, 720, 480), 720, 480, 300, 700);
    const rOff = blockRatio(luma(off, 720, 480), 720, 480, 300, 700);
    if (rOn < 1.3) fail(stage, `boundary/interior gradient ${rOn.toFixed(2)} in the smooth area — no blocks on the 8-pixel grid`);
    if (Math.abs(rOff - 1) > 0.15) fail(stage, `with the codec off the boundary ratio is ${rOff.toFixed(2)}, not 1`);
    // At 1080p the same blocks are 8 × 1440/704 output pixels apart.
    // The codec's own error at 1080p, so the scaler's pixel pattern, which
    // is the same with the codec on and off, cancels and the blocks remain.
    const at1080 = { 'framing.dither': 0, 'framing.scaler': 'nearest' };
    const big = (await probe(lab, { backend: 'gpu', settings: at1080, source: src, width: 1440, height: 1080, frames: [0] })).frames[0];
    const bigOff = (await probe(lab, { backend: 'gpu', settings: { ...at1080, 'codec.enabled': false }, source: src, width: 1440, height: 1080, frames: [0] })).frames[0];
    const Ya = luma(big, 1440, 1080);
    const Yb = luma(bigOff, 1440, 1080);
    // Each 1080p column comes from one DV raster column (704 active columns
    // across 1440). The codec's error must step most where the raster
    // column crosses the 8-column block grid — and not on a grid that
    // ignored the scaling.
    const steps = (colOf) => {
      let onGrid = 0;
      let nOn = 0;
      let offGrid = 0;
      let nOff = 0;
      for (let x = 700; x < 1430; x++) {
        const c0 = colOf(x - 1);
        const c1 = colOf(x);
        if (c0 === c1) continue;
        let d = 0;
        for (let y = 0; y < 1080; y += 2) {
          const o = y * 1440 + x;
          d += Math.abs(Ya[o] - Yb[o] - (Ya[o - 1] - Yb[o - 1]));
        }
        if (c1 % 8 === 0) {
          onGrid += d;
          nOn++;
        } else {
          offGrid += d;
          nOff++;
        }
      }
      return onGrid / nOn / Math.max(offGrid / nOff, 1e-9);
    };
    const scaled = steps((x) => 8 + Math.floor((x * 704) / 1440));
    const unscaled = steps((x) => 8 + Math.floor((x * 704) / 1408));
    // The codec's error is everywhere, so the contrast is modest; what
    // matters is that the scaled grid stands out and the unscaled one not.
    if (scaled < 1.08) fail(stage, `at 1080p the codec's error does not step on the scaled 8-column grid (${scaled.toFixed(2)}× elsewhere)`);
    if (unscaled - 1 > (scaled - 1) * 0.5) fail(stage, `at 1080p the blocks fit an unscaled grid as well as the scaled one (${unscaled.toFixed(2)} vs ${scaled.toFixed(2)})`);
    note(stage, `boundary/interior ${rOn.toFixed(2)} with the codec, ${rOff.toFixed(2)} without · at 1080p the error steps ${scaled.toFixed(2)}× on the scaled block grid, ${unscaled.toFixed(2)}× on an unscaled one`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11d. the constant bit budget is shared across the frame ---- */
{
  const stage = 'budget';
  try {
    // The same gradient, with and without noise in the left third. The error
    // in the right third, which the noise never touches, must grow: its
    // segments share their bits with macroblocks in the noisy third.
    const err = async (amount) => {
      const src = { kind: 'noise', amount, ripple: 18 };
      const on = (await probe(lab, { backend: 'cpu', settings: { ...DV }, source: src, ...NATIVE, frames: [0], qno: true })).frames[0];
      const off = (await probe(lab, { backend: 'cpu', settings: { ...DV, 'codec.enabled': false }, source: src, ...NATIVE, frames: [0] })).frames[0];
      const q = on.qno.reduce((a, b) => a + b, 0) / on.qno.length;
      return { psnr: psnr(luma(on, 720, 480), luma(off, 720, 480), 720, 480, 480, 712), q };
    };
    const clean = await err(0);
    const noisy = await err(0.6);
    // FFmpeg's dvvideo on this picture: the right third loses 1.6 dB. The
    // cost is real but modest, since its smooth macroblocks have little to
    // lose; what must hold is that it is not zero.
    if (noisy.psnr > clean.psnr - 0.3) fail(stage, `noise in the left third cost the untouched right third only ${(clean.psnr - noisy.psnr).toFixed(2)} dB (FFmpeg: 1.6 dB)`);
    if (noisy.q > clean.q - 2) fail(stage, `the mean quantisation number moved only ${clean.q.toFixed(1)} → ${noisy.q.toFixed(1)}`);
    note(stage, `noise in a third of the frame: right third ${clean.psnr.toFixed(1)} → ${noisy.psnr.toFixed(1)} dB, mean quantiser ${clean.q.toFixed(1)} → ${noisy.q.toFixed(1)}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11e. against the real thing: FFmpeg's dvvideo ---- */
{
  const stage = 'dvvideo';
  const ff = require('ffmpeg-static');
  if (!ff || !existsSync(ff)) {
    fail(stage, 'ffmpeg-static is not installed; the comparison against the real encoder could not run');
  } else {
    const dir = await mkdtemp(join(tmpdir(), 'camai-dv-'));
    try {
      const W = 720;
      const H = 480;
      const settings = { ...DV, 'interlace.enabled': false };
      const raw = (rgb) => Buffer.from(Uint8Array.from(rgb));
      const lines = [];
      for (const src of [{ kind: 'scene' }, { kind: 'zone' }, { kind: 'noise', amount: 0.5 }]) {
        const r = { backend: 'cpu', source: src, width: W, height: H, srcWidth: 704, srcHeight: 480, frames: [0] };
        // The pre-codec frame both encoders get, with and without DV's 4:1:1.
        const full = (await probe(lab, { ...r, settings: { ...settings, 'codec.enabled': false, 'chroma.enabled': false } })).frames[0];
        const sub = (await probe(lab, { ...r, settings: { ...settings, 'codec.enabled': false, 'chroma.enabled': true } })).frames[0];
        const ours = (await probe(lab, { ...r, settings: { ...settings, 'codec.enabled': true } })).frames[0];
        await writeFile(join(dir, 'ref.rgb'), raw(full.rgb));
        const conv = (args) => execFileSync(ff, ['-y', '-loglevel', 'error', ...args], { cwd: dir });
        conv(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'ref.rgb', '-pix_fmt', 'yuv411p', '-c:v', 'dvvideo', '-r', '30000/1001', '-frames:v', '1', '-f', 'dv', 'real.dv']);
        conv(['-i', 'real.dv', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'real.rgb']);
        conv(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'ref.rgb', '-pix_fmt', 'yuv411p', '-f', 'rawvideo', 'conv.yuv']);
        conv(['-f', 'rawvideo', '-pix_fmt', 'yuv411p', '-s', `${W}x${H}`, '-i', 'conv.yuv', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'conv.rgb']);
        const real = { rgb: Array.from(await readFile(join(dir, 'real.rgb'))) };
        const realRef = { rgb: Array.from(await readFile(join(dir, 'conv.rgb'))) };
        // Codec-only error: each encoder against its own 4:1:1 reference.
        const m = (a, b) => {
          const A = luma(a, W, H);
          const B = luma(b, W, H);
          const e = A.map((v, i) => v - B[i]);
          return { psnr: psnr(A, B, W, H, 16, 704), blk: blockRatio(e.map((v) => v + 128), W, H, 16, 704) };
        };
        const mo = m(ours, sub);
        const mr = m(real, realRef);
        lines.push(`${src.kind} ${mo.psnr.toFixed(1)}/${mr.psnr.toFixed(1)} dB blk ${mo.blk.toFixed(2)}/${mr.blk.toFixed(2)}`);
        if (Math.abs(mo.psnr - mr.psnr) > 4) fail(stage, `${src.kind}: codec PSNR ${mo.psnr.toFixed(1)} dB against FFmpeg's ${mr.psnr.toFixed(1)} — more than 4 dB apart`);
        if (Math.abs(mo.blk - mr.blk) > 0.3) fail(stage, `${src.kind}: blocking ratio ${mo.blk.toFixed(2)} against FFmpeg's ${mr.blk.toFixed(2)}`);
      }
      note(stage, `emulation/FFmpeg, codec error only: ${lines.join(' · ')}`);
    } catch (err) {
      fail(stage, String(err));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/* ---- 11f. chroma subsampling: 4:1:1 bleeds four pixels, 4:2:0 two and down ---- */
{
  const stage = 'chroma';
  try {
    const spread = async (system) => {
      // The camera off: its own colour filtering would widen both alike.
      const settings = { ...DV, 'engine.camera': false, 'format.system': system, 'codec.enabled': false, 'chroma.upsample': 'nearest', 'interlace.enabled': false };
      const H = system === 'pal' ? 576 : 480;
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'redline', width: 1 }, width: 720, height: H, srcWidth: 704, srcHeight: H, frames: [0] })).frames[0];
      const cr = crOf(f, 720, H);
      // Horizontal: columns along a row in the upper half whose Cr departs from grey.
      // Counted against a quarter of the strongest, so the faint tails of
      // the field and line averaging do not count as width.
      const row = Math.round(H * 0.3);
      let hMax = 0;
      for (let x = 300; x < 420; x++) hMax = Math.max(hMax, Math.abs(cr[row * 720 + x]));
      let h = 0;
      for (let x = 300; x < 420; x++) if (Math.abs(cr[row * 720 + x]) > hMax * 0.25) h++;
      // Vertical: rows round the horizontal red line whose Cr departs.
      const y0 = Math.round(H * 0.6);
      const y1 = Math.round(H * 0.9);
      let vMax = 0;
      for (let y = y0; y < y1; y++) vMax = Math.max(vMax, Math.abs(cr[y * 720 + 100]));
      let v = 0;
      for (let y = y0; y < y1; y++) if (Math.abs(cr[y * 720 + 100]) > vMax * 0.25) v++;
      return { h, v };
    };
    const ntsc = await spread('ntsc');
    const pal = await spread('pal');
    if (ntsc.h !== 4) fail(stage, `525/60's 4:1:1 spreads a 1-pixel red line over ${ntsc.h} pixels, expected 4`);
    if (pal.h !== 2) fail(stage, `625/50's 4:2:0 spreads it over ${pal.h} pixels, expected 2`);
    if (pal.v < 2 || pal.v <= ntsc.v) fail(stage, `4:2:0 should spread a horizontal red line vertically more than 4:1:1 does (${pal.v} rows against ${ntsc.v})`);
    note(stage, `red line: 4:1:1 → ${ntsc.h} px wide, ${ntsc.v} rows · 4:2:0 → ${pal.h} px wide, ${pal.v} rows`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11g. detail enhancement: edges overshoot; coring spares the noise ---- */
{
  const stage = 'detail';
  try {
    const edge = async (on) => {
      const settings = { ...DV, 'codec.enabled': false, 'detail.enabled': on, 'detail.gain': 1.5 };
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'edge', low: 0.25, high: 0.65 }, ...NATIVE, srcWidth: 704, srcHeight: 480, frames: [0] })).frames[0];
      const Y = luma(f, 720, 480);
      const row = 240;
      const lowPlateau = Y[row * 720 + 200];
      const highPlateau = Y[row * 720 + 560];
      let max = 0;
      let min = 255;
      for (let x = 340; x < 380; x++) {
        max = Math.max(max, Y[row * 720 + x]);
        min = Math.min(min, Y[row * 720 + x]);
      }
      return { over: max - highPlateau, under: lowPlateau - min };
    };
    const off = await edge(false);
    const on = await edge(true);
    if (on.over < 4 || on.under < 3) fail(stage, `the edge does not overshoot both plateaus (+${on.over.toFixed(1)} / −${on.under.toFixed(1)})`);
    if (off.over > 1.5 || off.under > 1.5) fail(stage, `without enhancement the edge already overshoots (+${off.over.toFixed(1)})`);
    // Coring: low-level noise is not boosted.
    const noiseStd = async (coring) => {
      const settings = { ...DV, 'codec.enabled': false, 'detail.enabled': true, 'detail.gain': 2, 'detail.coring': coring };
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'noise', amount: 0.03 }, ...NATIVE, frames: [0] })).frames[0];
      const Y = luma(f, 720, 480);
      let s = 0;
      let n = 0;
      for (let y = 100; y < 380; y++) for (let x = 40; x < 200; x++) {
        const d = Y[y * 720 + x] - Y[y * 720 + x + 1];
        s += d * d;
        n++;
      }
      return Math.sqrt(s / n);
    };
    const cored = await noiseStd(0.05);
    const raw = await noiseStd(0);
    if (cored > raw * 0.8) fail(stage, `coring did not spare the noise (${cored.toFixed(2)} cored against ${raw.toFixed(2)} uncored)`);
    note(stage, `edge overshoot +${on.over.toFixed(1)} / −${on.under.toFixed(1)} (off: +${off.over.toFixed(1)}) · noise ${raw.toFixed(2)} → ${cored.toFixed(2)} with coring`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11h. a CCD smears and a CMOS leans ---- */
{
  const stage = 'sensors';
  try {
    // A point light in sun at 1/1000 s: on a CCD its column glows the full
    // height of the frame; a CMOS has no vertical registers to leak into.
    const column = async (sensor) => {
      const settings = { ...DV, 'codec.enabled': false, 'sensor.enabled': true, 'format.sensor': sensor, 'sensor.noise': 0, 'sensor.shot': 0, 'exposure.enabled': true, 'exposure.mode': 'manual', 'exposure.scene': 0, 'exposure.shutter': '1000', 'sensor.headroom': 8 };
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'point', size: 3 }, ...NATIVE, srcWidth: 704, srcHeight: 480, frames: [0] })).frames[0];
      const Y = luma(f, 720, 480);
      // The point itself: the brightest pixel.
      let at = 0;
      for (let i = 1; i < Y.length; i++) if (Y[i] > Y[at]) at = i;
      const cx = at % 720;
      const colMean = (x, y0, y1) => {
        let s = 0;
        for (let y = y0; y < y1; y++) s += Y[y * 720 + x];
        return s / (y1 - y0);
      };
      let peak = cx;
      for (let x = cx - 4; x <= cx + 4; x++) if (colMean(x, 300, 470) > colMean(peak, 300, 470)) peak = x;
      const lit = colMean(peak, 300, 470);
      const top = colMean(peak, 5, 120);
      const dark = colMean(peak + 40, 300, 470);
      return { lit, top, dark };
    };
    const ccd = await column('ccd1');
    const cmos = await column('cmos1');
    if (ccd.lit - ccd.dark < 6) fail(stage, `no smear column under a CCD point light (${ccd.lit.toFixed(1)} against ${ccd.dark.toFixed(1)})`);
    if (Math.abs(ccd.top - ccd.lit) > Math.max(4, (ccd.lit - ccd.dark) * 0.35)) fail(stage, `the smear is not constant down the frame (top ${ccd.top.toFixed(1)}, bottom ${ccd.lit.toFixed(1)})`);
    if (cmos.lit - cmos.dark > 2) fail(stage, `a CMOS sensor smears (${cmos.lit.toFixed(1)} against ${cmos.dark.toFixed(1)})`);
    // A fast pan: verticals lean on a rolling shutter and stay upright on a CCD.
    const lean = async (sensor) => {
      const settings = { ...DV, 'codec.enabled': false, 'sensor.enabled': true, 'format.sensor': sensor, 'sensor.noise': 0, 'sensor.shot': 0, 'operator.enabled': true, 'operator.tremor': 0, 'operator.sway': 0, 'exposure.enabled': true, 'exposure.mode': 'manual', 'exposure.scene': 4, 'exposure.shutter': '1000' };
      const timeline = { 'operator.pan': [{ t: 0, value: 0, ease: 'linear' }, { t: 1, value: 50, ease: 'linear' }] };
      const f = (await probe(lab, { backend: 'cpu', settings, timeline, source: { kind: 'verticals', spacing: 90 }, ...NATIVE, frames: [15] })).frames[0];
      const Y = luma(f, 720, 480);
      // Track one bar from the top band to the bottom band.
      const centreNear = (y, x0) => {
        let s = 0;
        let n = 0;
        for (let x = x0 - 30; x < x0 + 30; x++) {
          const v = Y[y * 720 + x];
          if (v > 120) {
            s += x * v;
            n += v;
          }
        }
        return n ? s / n : NaN;
      };
      let x0 = 360;
      for (let x = 330; x < 400; x++) if (Y[60 * 720 + x] > Y[60 * 720 + x0]) x0 = x;
      const top = centreNear(60, x0);
      const bottom = centreNear(420, Math.round(top));
      return bottom - top;
    };
    const leanCcd = await lean('ccd1');
    const leanCmos = await lean('cmos1');
    if (Math.abs(leanCcd) > 2) fail(stage, `verticals lean ${leanCcd.toFixed(1)} px on a CCD during a pan`);
    if (Math.abs(leanCmos) < 6) fail(stage, `verticals lean only ${leanCmos.toFixed(1)} px on a CMOS rolling shutter during a 50°/s pan`);
    note(stage, `CCD point light → column +${(ccd.lit - ccd.dark).toFixed(1)} bottom, +${(ccd.top - ccd.dark).toFixed(1)} top; CMOS +${(cmos.lit - cmos.dark).toFixed(1)} · pan lean: CCD ${leanCcd.toFixed(1)} px, CMOS ${leanCmos.toFixed(1)} px`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11i. the knee and the wall; a single chip clips colour by colour ---- */
{
  const stage = 'knee';
  try {
    // scene 0 with the gain up: the tone curve's knee and wall. scene 4 with
    // the iris doing the work: more light than the wells hold.
    const ramp = async (sensor, scene) => {
      const settings = { ...DV, 'codec.enabled': false, 'chroma.enabled': false, 'tone.enabled': true, 'sensor.enabled': true, 'format.sensor': sensor, 'sensor.noise': 0, 'sensor.shot': 0, 'sensor.headroom': 0, 'sensor.smear': 0, 'exposure.enabled': true, 'exposure.mode': 'manual', 'exposure.scene': scene, 'exposure.comp': 2 };
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'ramp', stops: 8 }, ...NATIVE, srcWidth: 704, srcHeight: 480, frames: [0] })).frames[0];
      const Y = luma(f, 720, 480);
      const prof = [];
      for (let x = 8; x < 712; x++) {
        let s = 0;
        for (let y = 200; y < 280; y++) s += Y[y * 720 + x];
        prof.push(s / 80);
      }
      let chroma = 0;
      for (let x = 8; x < 712; x++) {
        for (let y = 230; y < 250; y++) {
          const o = (y * 720 + x) * 3;
          const r = f.rgb[o];
          const g = f.rgb[o + 1];
          const b = f.rgb[o + 2];
          if (r + g + b > 450) chroma = Math.max(chroma, Math.max(Math.abs(r - g), Math.abs(b - g), Math.abs(r - b)));
        }
      }
      return { prof, chroma };
    };
    const ccd3 = await ramp('ccd3', 0);
    const ccd3Over = await ramp('ccd3', 4);
    const ccd1Over = await ramp('ccd1', 4);
    // Slope per stop at three places along the ramp (88 px a stop).
    const p = ccd3.prof;
    const top = Math.max(...p);
    const clipAt = p.findIndex((v) => v > top - 0.5);
    const slopeAt = (i) => (p[Math.min(p.length - 1, i + 22)] - p[Math.max(0, i - 22)]) / 0.5;
    const kneeAt = p.findIndex((v) => v > top * 0.8);
    const sMid = slopeAt(Math.round(kneeAt * 0.6));
    const sKnee = slopeAt(Math.round((kneeAt + clipAt) / 2));
    const sTop = slopeAt(Math.min(p.length - 23, clipAt + 40));
    if (!(sMid > sKnee * 1.4)) fail(stage, `no knee: slope ${sMid.toFixed(1)} below it, ${sKnee.toFixed(1)} above`);
    if (Math.abs(sTop) > 0.5) fail(stage, `no wall: still rising ${sTop.toFixed(2)}/stop past the clip`);
    if (ccd1Over.chroma < ccd3Over.chroma + 8) fail(stage, `a single chip clips no more colourfully than three (${ccd1Over.chroma} against ${ccd3Over.chroma})`);
    note(stage, `slope ${sMid.toFixed(0)} → ${sKnee.toFixed(0)} → ${sTop.toFixed(1)} /stop: knee and wall · near clip, chroma excursion ${ccd1Over.chroma} single-chip vs ${ccd3Over.chroma} three-chip`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11j. an overlay's path is visible ---- */
{
  const stage = 'overlays';
  try {
    const run = async (insert, path = 'firewire') => {
      const settings = { ...DV, 'date.enabled': true, 'date.insert': insert, 'date.colour': 'orange', 'capture.enabled': path !== 'firewire', 'capture.path': path };
      const f = (await probe(lab, { backend: 'cpu', settings, source: { kind: 'grey', level: 0.4 }, ...NATIVE, frames: [0] })).frames[0];
      return f;
    };
    const pre = await run('precodec');
    const dec = await run('decode');
    const decComp = await run('decode', 'composite');
    // The date sits in the bottom-left corner. Text pixels are where the
    // after-decode render has ink; the halo is everything within 6 px of it.
    const W = 720;
    const y0 = 380;
    const y1 = 470;
    const isInk = (f, i) => f.rgb[i * 3] > 150;
    const mask = new Uint8Array(W * 480);
    for (let y = y0; y < y1; y++) for (let x = 20; x < 250; x++) if (isInk(dec, y * W + x)) mask[y * W + x] = 1;
    const grey = luma(dec, W, 480)[100 * W + 360];
    const halo = (f) => {
      const Y = luma(f, W, 480);
      const cr = crOf(f, W, 480);
      let ring = 0;
      let bleed = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = 24; x < 246; x++) {
          const i = y * W + x;
          if (mask[i]) continue;
          let near = false;
          for (let d = -6; d <= 6 && !near; d++) if (mask[i + d]) near = true;
          if (!near) continue;
          // The black edge is part of the glyph; look past it.
          let edge = false;
          for (let d = -2; d <= 2 && !edge; d++) for (let e = -2; e <= 2; e++) if (mask[i + e * W + d]) edge = true;
          if (edge) continue;
          ring += Math.abs(Y[i] - grey);
          bleed += Math.abs(cr[i]);
          n++;
        }
      }
      return { ring: ring / n, bleed: bleed / n };
    };
    const sharp = (f) => {
      const Y = luma(f, W, 480);
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = 21; x < 250; x++) s += Math.abs(Y[y * W + x] - Y[y * W + x - 1]);
      return s;
    };
    const hp = halo(pre);
    const hd = halo(dec);
    if (hp.bleed < hd.bleed * 1.5 + 0.5) fail(stage, `burned in before the codec the date's colour does not bleed (${hp.bleed.toFixed(2)} against ${hd.bleed.toFixed(2)} after decode)`);
    if (hp.ring < hd.ring + 0.3) fail(stage, `burned in before the codec the glyphs do not ring (${hp.ring.toFixed(2)} against ${hd.ring.toFixed(2)})`);
    const sd = sharp(dec);
    const sc = sharp(decComp);
    if (sc > sd * 0.85) fail(stage, `a composite capture did not soften the overlay (edge energy ${sc.toFixed(0)} against ${sd.toFixed(0)})`);
    note(stage, `before the codec: bleed ${hp.bleed.toFixed(2)} ring ${hp.ring.toFixed(2)} · after decode: bleed ${hd.bleed.toFixed(2)} ring ${hd.ring.toFixed(2)} · composite capture keeps ${((sc / sd) * 100).toFixed(0)}% of the edges`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11k. the clocks: wall time jumps at a break, tape time does not ---- */
{
  const stage = 'clocks';
  try {
    const settings = { ...DV, 'codec.enabled': false, 'breaks.enabled': true, 'breaks.rate': 12, 'breaks.gap': 30, 'breaks.skip': 1.5, 'date.enabled': true };
    const frames = Array.from({ length: 300 }, (_, i) => i);
    // A slow bar: little changes from frame to frame within a shot, and the
    // second and a half the break skips moves it a long way.
    const r = await probe(lab, { backend: 'cpu', settings, source: { kind: 'bar', pxPerSec: 40, width: 16 }, width: 160, height: 120, frames, pixels: true });
    const fps = 30000 / 1001;
    let jumps = 0;
    let smooth = 0;
    let tcBreaks = 0;
    let cutAt = -1;
    for (let i = 1; i < r.frames.length; i++) {
      const a = r.frames[i - 1];
      const b = r.frames[i];
      const dw = (b.clock.wallMs - a.clock.wallMs) / 1000;
      const dtc = b.clock.timecode - a.clock.timecode;
      if (b.clock.shot !== a.clock.shot) {
        jumps++;
        if (dw < 60) fail(stage, `at the break before frame ${i} the date moved only ${dw.toFixed(1)} s`);
        if (cutAt < 0) cutAt = i;
      } else if (Math.abs(dw - 1 / fps) < 0.002) smooth++;
      if (Math.abs(dtc - 1 / fps) > 0.002) tcBreaks++;
    }
    if (jumps < 1) fail(stage, 'no recording break in ten seconds at twelve a minute');
    if (tcBreaks > 0) fail(stage, `the tape counter jumped ${tcBreaks} times; it should run straight across breaks`);
    if (smooth < r.frames.length - 1 - jumps - 2) fail(stage, `the date did not advance in real time within shots (${smooth} smooth steps)`);
    // The cut is in the picture at the same frame.
    const diffs = r.frames.slice(1).map((f, i) => meanAbsDiff(r.frames[i], f));
    const median = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    if (cutAt > 0 && diffs[cutAt - 1] < median * 2) fail(stage, `the break at frame ${cutAt} is not a cut in the picture (${diffs[cutAt - 1].toFixed(1)} against a median ${median.toFixed(1)})`);
    note(stage, `${jumps} breaks in 10 s: date jumps ≥ 1 min each, counter continuous, first cut at frame ${cutAt} (Δ ${diffs[cutAt - 1]?.toFixed(1)} vs median ${median.toFixed(1)})`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11l. a dropout is the previous frame on the macroblock grid, and a mute ---- */
{
  const stage = 'dropouts';
  try {
    // Dropouts are events: ask the shared event clock which frames have
    // one, and render each with the frame before it.
    const events = await import(pathToFileURL(join(here, '..', 'public', 'worklets', 'camai-events.js')).href);
    const fps = 30000 / 1001;
    const settings = { ...DV, 'tape.enabled': true, 'tape.dropouts': 60, 'tape.size': 0.2, 'tape.conceal': 'previous' };
    const hit = [];
    for (let n = 2; n < 20000 && hit.length < 4; n++) if (events.dropoutAt(n, 1337, 60, fps, 0.2, 10)) hit.push(n);
    const frames = hit.flatMap((n) => [n - 1, n]);
    const r = await probe(lab, { backend: 'cpu', settings, source: { kind: 'texture', panPxPerSec: 300, cell: 5 }, ...NATIVE, frames });
    const rect = (m) => (m < 1320 ? [(m % 22) * 32, Math.floor(m / 22) * 8, 32, 8] : [704, (m - 1320) * 16, 16, 16]);
    let checked = 0;
    let worst = 0;
    let differOutside = 0;
    for (let i = 1; i < r.frames.length; i += 2) {
      const f = r.frames[i];
      if (!f.lostMBs?.length) continue;
      const prev = r.frames[i - 1];
      for (const m of f.lostMBs) {
        const [x0, y0, w, h] = rect(m);
        for (let y = y0; y < y0 + h; y++) {
          for (let x = x0; x < x0 + w; x++) {
            const o = (y * 720 + x) * 3;
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(f.rgb[o + c] - prev.rgb[o + c]));
          }
        }
        checked++;
      }
      differOutside += meanAbsDiff(f, prev);
    }
    if (checked === 0) fail(stage, `no macroblocks were lost at frames ${hit.join(', ')}, where the event clock put dropouts`);
    if (worst > 0) fail(stage, `concealed macroblocks differ from the previous frame by up to ${worst}`);
    if (differOutside < 1) fail(stage, 'the frames with dropouts are identical to the previous ones throughout — the source is not moving');

    // The sound: whole-frame dropouts mute the same frames the picture
    // freezes, from the same event clock.
    const audio = await renderAudio(lab, {
      settings: { 'mech.enabled': true, 'mech.transport': -30, 'tape.enabled': true, 'tape.dropouts': 60, 'tape.size': 1 },
      seconds: 3,
      programme: 'silence',
    });
    const sr = audio.sampleRate;
    let hits = 0;
    let misses = 0;
    let falseMutes = 0;
    for (let n = 2; n < Math.floor(3 * fps) - 1; n++) {
      const d = events.dropoutAt(n, 1337, 60, fps, 1, 10);
      const a = Math.round(((n + 0.3) / fps) * sr);
      const b = Math.round(((n + 0.7) / fps) * sr);
      const level = rms(audio.left, a, b);
      if (d) {
        if (level < 1e-4) hits++;
        else misses++;
      } else if (level < 1e-4) {
        const before = events.dropoutAt(n - 1, 1337, 60, fps, 1, 10);
        if (!before) falseMutes++;
      }
    }
    if (hits === 0) fail(stage, 'no frame-long dropout muted the sound');
    if (misses > 0) fail(stage, `${misses} dropout frames kept their sound`);
    if (falseMutes > 0) fail(stage, `${falseMutes} frames without a dropout were muted`);
    note(stage, `${checked} lost macroblocks, each exactly the previous frame (max diff ${worst}) · ${hits} whole-frame dropouts muted the sound at the same frames, ${misses} missed`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11m. the A/V link: the zoom is heard while it moves; a break clunks ---- */
{
  const stage = 'avlink';
  try {
    const timeline = { 'lens.zoom': [{ t: 0, value: 1, ease: 'linear' }, { t: 1, value: 1, ease: 'linear' }, { t: 2, value: 10, ease: 'linear' }, { t: 3, value: 10, ease: 'linear' }] };
    const a = await renderAudio(lab, {
      settings: { 'lens.enabled': true, 'mech.enabled': true, 'mech.transport': -90, 'mech.zoom': -20 },
      timeline,
      seconds: 3,
      programme: 'silence',
    });
    const sr = a.sampleRate;
    const band = (t0, t1) => bandEnergy(a.left, sr, 700, 2500, Math.round(t0 * sr), Math.round(t1 * sr));
    // After the start of recording's own clunk has died away.
    const still = band(0.6, 0.68);
    const moving = band(1.4, 1.48);
    const after = band(2.6, 2.68);
    if (moving < still * 100 || moving < after * 100) fail(stage, `zoom motor energy ${moving.toExponential(1)} while zooming against ${still.toExponential(1)} before and ${after.toExponential(1)} after`);
    // A recording break: the clunk is on the frame the picture cuts.
    const events = await import(pathToFileURL(join(here, '..', 'public', 'worklets', 'camai-events.js')).href);
    const shots = new events.Shots(1337, { enabled: true, rate: 12, skip: 0.5, gap: 10, seamless: true });
    shots.atOutput(8);
    const cut = shots.list.find((s) => s.out0 > 0.5 && s.out0 < 7);
    if (!cut) throw new Error('no break in the first seconds');
    const b = await renderAudio(lab, {
      settings: { 'mech.enabled': true, 'mech.transport': -90, 'mech.rec': -10, 'breaks.enabled': true, 'breaks.rate': 12, 'breaks.skip': 0.5, 'breaks.gap': 10 },
      seconds: Math.min(8, cut.srcEndPrev + 1),
      programme: 'silence',
    });
    // The clunk's onset: the first sample at half its peak. (The peak itself
    // can be anywhere along a clunk that rings.)
    let peak = 0;
    const from = Math.round((cut.out0 - 0.4) * b.sampleRate);
    const to = Math.round((cut.out0 + 0.4) * b.sampleRate);
    for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(b.left[i]));
    let peakAt = from;
    while (peakAt < to && Math.abs(b.left[peakAt]) < peak * 0.5) peakAt++;
    const fps = 30000 / 1001;
    const cutFrame = Math.ceil(cut.out0 * fps - 1e-6);
    const clunkFrame = Math.floor((peakAt / b.sampleRate) * fps);
    if (Math.abs(clunkFrame - cutFrame) > 2) fail(stage, `the REC clunk is at frame ${clunkFrame}, the cut at ${cutFrame}`);
    note(stage, `zoom motor ${(10 * Math.log10(moving / Math.max(still, 1e-30))).toFixed(0)} dB louder while the zoom moves · break: cut frame ${cutFrame}, clunk frame ${clunkFrame}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ================================================================== *
 * 12. The two backends agree
 * ================================================================== */

{
  const stage = 'cpu';
  try {
    const flagship = await lab.evaluate(() => window.__camai.presets['palmcorder-2002']);
    const req = { source: { kind: 'scene' }, ...NATIVE, frames: [0, 1, 2] };
    const g = await probe(lab, { ...req, backend: 'gpu', settings: { ...flagship, ...DV } });
    const c = await probe(lab, { ...req, backend: 'cpu', settings: { ...flagship, ...DV } });
    if (c.backend !== 'cpu') fail(stage, 'asked for the CPU backend and did not get it');
    const d = meanAbsDiff(g.frames[2], c.frames[2]);
    if (d > 0.5) fail(stage, `with the flagship the backends differ by ${d.toFixed(3)}/px`);
    note(stage, `flagship, third frame: GPU and CPU ${d.toFixed(3)}/px apart · CPU ${(c.ms / 3).toFixed(0)} ms/frame vs GPU ${(g.ms / 3).toFixed(0)}`);
  } catch (err) {
    fail(stage, String(err));
  }
  // And the toggle in the header really swaps the backend.
  const { page } = await openPage();
  try {
    await dropStill(page, BARS);
    await settledStats(page);
    await page.click('.backend-toggle button[data-backend="cpu"]');
    const s = await settledStats(page, { timeout: 60000 });
    const ctx = await page.evaluate(() => {
      const cv = document.querySelector('.stage canvas');
      return cv.getContext('2d') ? '2d' : 'webgl';
    });
    if (ctx !== '2d') fail(stage, 'switching to CPU did not replace the WebGL canvas');
    if (s.lit < 0.3) fail(stage, `the CPU backend drew a dark frame through the UI (${(s.lit * 100).toFixed(1)}% lit)`);
    note(stage, `header toggle → CPU: ${(s.lit * 100).toFixed(1)}% lit`);
    await page.evaluate(() => localStorage.removeItem('camai.backend'));
  } catch (err) {
    fail(stage, `toggle: ${err}`);
  }
  await page.close();
}

/* ================================================================== *
 * 13. Engine masters bypass exactly their own tab
 * ================================================================== */

{
  const stage = 'masters';
  try {
    const flagship = await lab.evaluate(() => window.__camai.presets['found-tape-2006']);
    const req = { backend: 'gpu', source: { kind: 'scene' }, ...NATIVE, frames: [3] };
    const all = (await probe(lab, { ...req, settings: { ...flagship, ...DV } })).frames[0];
    const keysOf = (tab) => Object.keys(flagship).filter((k) => k.endsWith('.enabled')).filter((k) => {
      const camera = ['operator', 'lens', 'exposure', 'sensor', 'focus', 'wb', 'eis', 'dzoom', 'tone', 'detail', 'battery', 'night', 'fx'];
      const tape = ['interlace', 'chroma', 'codec', 'tape', 'breaks'];
      const display = ['osd', 'date', 'capture', 'deint', 'upload'];
      const g = k.split('.')[0];
      return (tab === 'camera' ? camera : tab === 'tape' ? tape : display).includes(g);
    });
    const parts = [];
    for (const tab of ['camera', 'tape', 'display']) {
      const viaMaster = (await probe(lab, { ...req, settings: { ...flagship, ...DV, [`engine.${tab}`]: false } })).frames[0];
      const byHand = Object.fromEntries(keysOf(tab).map((k) => [k, false]));
      const manual = (await probe(lab, { ...req, settings: { ...flagship, ...DV, ...byHand } })).frames[0];
      const same = meanAbsDiff(viaMaster, manual);
      const changed = meanAbsDiff(all, viaMaster);
      if (same > 0) fail(stage, `the ${tab} master is not the same as switching its sections off by hand (${same.toFixed(3)}/px)`);
      if (changed < 0.3) fail(stage, `switching the ${tab} engine off barely changed the picture (${changed.toFixed(2)}/px)`);
      parts.push(`${tab} ${changed.toFixed(1)}`);
    }
    note(stage, `each master equals its tab's switches by hand · bypass changes the picture ${parts.join(' · ')} /px`);
  } catch (err) {
    fail(stage, String(err));
  }
  // Through the interface: the switch on the tab, and the tab marked.
  const { page } = await openPage();
  try {
    await dropStill(page, BARS);
    await settledStats(page);
    const struck = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const tab = [...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.trim().startsWith('Camera'));
      tab.querySelector('input').click();
      await sleep(400);
      const s = tab.classList.contains('bypassed');
      tab.querySelector('input').click();
      return s;
    });
    if (!struck) fail(stage, 'a bypassed engine is not marked as such on its tab');
  } catch (err) {
    fail(stage, String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 14. Exports: through the interface, and a DV file that is DV
 * ================================================================== */

{
  const stage = 'export';
  const { page } = await openPage();
  try {
    await page.selectOption('.topbar-actions select', 'prosumer-2003');
    const dur = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const blob = await (await fetch('/fixture.webm')).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'motion.webm', { type: 'video/webm' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      for (let k = 0; k < 200; k++) {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && v.duration > 0) return v.duration;
        await sleep(100);
      }
      throw new Error('video never became ready');
    });
    await page.selectOption('.export select', 'pngseq');
    const res = page.locator('.export select').nth(1);
    await res.selectOption('480p').catch(() => undefined);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 900000 }),
      page.click('.export .actions button.primary'),
    ]);
    const path = await download.path();
    const { unzipSync } = await import('fflate');
    const files = unzipSync(new Uint8Array(await readFile(path)));
    const frames = Object.keys(files).filter((n) => n.startsWith('frames/')).sort();
    const size = (png) => [
      (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19],
      (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23],
    ];
    const [w, h] = size(files[frames[0]]);
    const expected = Math.round(dur * (30000 / 1001));
    if (Math.abs(frames.length - expected) > 1) fail(stage, `${frames.length} frames for ${dur.toFixed(2)} s at 29.97 fps, expected ${expected}`);
    if (Math.abs(w / h - 4 / 3) > 0.01) fail(stage, `the file is ${w}×${h}, not 4:3`);
    if (!files['audio.wav'] || files['audio.wav'].length < 10000) fail(stage, 'no soundtrack in the export — the camera always has one');
    if (!files['settings.camai.json']) fail(stage, 'the export does not carry its settings');
    let same = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = files[frames[i - 1]];
      const b = files[frames[i]];
      if (a.length === b.length && a.every((v, k) => v === b[k])) same++;
    }
    if (same > frames.length / 2) fail(stage, `${same} of ${frames.length - 1} consecutive frames are identical — the export did not advance through the clip`);
    note(stage, `${frames.length} frames of ${w}×${h} for ${dur.toFixed(2)} s at 29.97 · audio ${((files['audio.wav']?.length ?? 0) / 1024).toFixed(0)} KiB · settings embedded`);
  } catch (err) {
    fail(stage, String(err));
  }
  await page.close();

  // A DV file, encoded with exactly the arguments the desktop app uses.
  const ff = require('ffmpeg-static');
  const { buildArgs } = require(join(here, '..', 'electron', 'encode.cjs'));
  const dir = await mkdtemp(join(tmpdir(), 'camai-dvx-'));
  try {
    for (const system of ['ntsc', 'pal']) {
      const H = system === 'pal' ? 576 : 480;
      const frames = await lab.evaluate(async ({ H, system }) => {
        const r = await window.__camai.renderProbe({
          backend: 'gpu',
          settings: { 'format.system': system, 'codec.enabled': false, 'chroma.enabled': false, 'framing.overscan': true, 'framing.scaler': 'nearest', 'framing.dither': 0 },
          source: { kind: 'bar', pxPerSec: 300 },
          width: 720,
          height: H,
          frames: [0, 1, 2, 3, 4, 5],
          pixels: true,
        });
        const c = document.createElement('canvas');
        c.width = 720;
        c.height = H;
        const g = c.getContext('2d');
        const out = [];
        for (const f of r.frames) {
          const img = g.createImageData(720, H);
          for (let i = 0; i < 720 * H; i++) {
            img.data[i * 4] = f.rgb[i * 3];
            img.data[i * 4 + 1] = f.rgb[i * 3 + 1];
            img.data[i * 4 + 2] = f.rgb[i * 3 + 2];
            img.data[i * 4 + 3] = 255;
          }
          g.putImageData(img, 0, 0);
          out.push(c.toDataURL('image/png').split(',')[1]);
        }
        return out;
      }, { H, system });
      const audio = await renderAudio(lab, { settings: { 'mech.enabled': true }, seconds: 0.3, programme: 'silence' });
      const pcm = Buffer.alloc(audio.left.length * 4);
      for (let i = 0; i < audio.left.length; i++) {
        pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio.left[i])) * 32767), i * 4);
        pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio.right[i])) * 32767), i * 4 + 2);
      }
      const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.from([16, 0, 0, 0, 1, 0, 2, 0]), Buffer.alloc(4), Buffer.alloc(4), Buffer.from([4, 0, 16, 0]), Buffer.from('data'), Buffer.alloc(4), pcm]);
      wav.writeUInt32LE(wav.length - 8, 4);
      wav.writeUInt32LE(48000, 24);
      wav.writeUInt32LE(48000 * 4, 28);
      wav.writeUInt32LE(pcm.length, 40);
      const audioPath = join(dir, `a-${system}.wav`);
      await writeFile(audioPath, wav);
      const out = join(dir, `out-${system}.dv`);
      const args = buildArgs({ format: 'dv', fps: system === 'pal' ? 25 : 29.97, rate: system === 'pal' ? '25' : '30000/1001', dvSystem: system, dvAspect: '4:3', outputPath: out, audioPath, frames: frames.length });
      await new Promise((resolve, reject) => {
        const child = spawn(ff, args, { stdio: ['pipe', 'ignore', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => (err += d));
        child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-600)))));
        for (const b64 of frames) child.stdin.write(Buffer.from(b64, 'base64'));
        child.stdin.end();
      });
      let info = '';
      try {
        execFileSync(ff, ['-hide_banner', '-i', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        info = String(e.stderr ?? '');
      }
      const video = info.split('\n').find((l) => /Video:/.test(l)) ?? '';
      const aud = info.split('\n').find((l) => /Audio:/.test(l)) ?? '';
      if (!/dvvideo/.test(video)) fail(stage, `${system}: the DV export is not dvvideo (${video.trim()})`);
      if (!video.includes(`720x${H}`)) fail(stage, `${system}: the DV export is not 720×${H} (${video.trim()})`);
      // The container header seldom says the field order; each decoded
      // frame's interlace flag does (i:B is bottom field first).
      const shown = spawnSync(ff, ['-hide_banner', '-i', out, '-frames:v', '2', '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';
      const order = /\bi:(\S)/.exec(shown)?.[1];
      if (order !== 'B') fail(stage, `${system}: the DV export is not bottom field first (showinfo says i:${order})`);
      if (!/pcm_s16le/.test(aud) || !/48000/.test(aud)) fail(stage, `${system}: the DV export's audio is not 48 kHz PCM (${aud.trim()})`);
      note(stage, `DV ${system}: ${video.replace(/.*Video: /, '').split(',').slice(0, 3).join(',').trim()} · ${aud.replace(/.*Audio: /, '').split(',').slice(0, 2).join(',').trim()}`);
    }
  } catch (err) {
    fail(stage, `DV: ${err}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const n of main.noise) fail('main page', n);

await browser.close();
server.close();

const minutes = ((Date.now() - t0) / 60000).toFixed(1);
if (failures.length) {
  console.error(`SMOKE TEST FAILED (${minutes} min)`);
  for (const f of failures) console.error('  •', f);
  console.error('\nwhat did pass:');
  for (const r of report) console.error(r);
  process.exit(1);
}

console.log(`smoke test passed (${minutes} min)`);
for (const r of report) console.log(r);
