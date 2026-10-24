/*
 * Headless smoke test.
 *
 * Type-checking cannot catch a shader that fails to compile, a worklet that
 * fails to register, or a parameter that moves its slider and reaches nothing.
 * So the built bundle is loaded in Chromium and driven for real.
 *
 * Two kinds of stage:
 *
 *   - The application, through its own interface: it mounts, footage reaches
 *     the film, keyframes animate, the frame is the shape you asked for, the
 *     guide and the ⓘ panels work, the engine masters bypass, and all of it
 *     still works over file:// the way the packaged build loads it.
 *
 *   - The film, measured. Film artefacts are measurable, so the physics is
 *     asserted from pixels rather than trusted: the characteristic curve has a
 *     toe and a shoulder, reversal clips sooner and harder than negative, grain
 *     is fixed to the film and scales with the format, gate dirt persists and
 *     film dirt does not, fading goes magenta, pulldown is 3:2, a splice is
 *     both a jump and a pop. These use window.__filmbox.renderProbe, which
 *     drives the real renderers with synthetic sources it controls exactly.
 *
 * Every stage that waits for the picture polls for a condition rather than
 * sleeping a fixed time; a fixed sleep samples an undrawn frame under load and
 * fails for reasons unrelated to the thing under test.
 *
 *   node scripts/smoke.mjs
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', 'dist');
const fixtures = join(here, '..', 'tests', 'fixtures');

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
const fail = (stage, msg) => failures.push(`${stage}: ${msg}`);
const note = (stage, msg) => report.push(`  ${stage.padEnd(10)}${msg}`);

// Use an explicit binary when one is given or present, otherwise let
// playwright resolve the browser it installed — runnable both in the dev
// container and on a CI runner.
const explicit = process.env.FILMBOX_CHROMIUM ?? '/opt/pw-browsers/chromium';
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
        localStorage.setItem('filmbox.guide.hideOnStart', '1');
      } catch {
        /* private window */
      }
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__filmbox && !!document.querySelector('.stage canvas'), null, {
    timeout: 60000,
  });
  return { page, noise };
}

/** Run a probe render in the page and return frames with RGB pixels. */
function probe(page, req) {
  return page.evaluate((r) => window.__filmbox.renderProbe(r), { pixels: true, seed: 1337, ...req });
}

/* ------------------------------------------------------------------ *
 * Image analysis, on the Node side
 * ------------------------------------------------------------------ */

function luma(frame, w, h) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.2126 * frame.rgb[i * 3] + 0.7152 * frame.rgb[i * 3 + 1] + 0.0722 * frame.rgb[i * 3 + 2];
  }
  return out;
}

function channel(frame, w, h, c) {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = frame.rgb[i * 3 + c];
  return out;
}

/** Subtract a (2r+1)² box mean: what is left is grain, dirt and fine detail. */
function highpass(g, w, h, r = 3) {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          s += g[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = g[y * w + x] - s / n;
    }
  }
  return out;
}

/** Normalised correlation of a against b shifted by (dx, dy), over a central window. */
function correlate(a, b, w, h, dx, dy, margin = 12) {
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const va = a[y * w + x];
      const vb = b[(y + dy) * w + (x + dx)];
      sab += va * vb;
      saa += va * va;
      sbb += vb * vb;
    }
  }
  return sab / Math.sqrt(saa * sbb + 1e-12);
}

function bestShift(a, b, w, h, range) {
  let best = { dx: 0, dy: 0, c: -2 };
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const c = correlate(a, b, w, h, dx, dy, range + 4);
      if (c > best.c) best = { dx, dy, c };
    }
  }
  return best;
}

function stdOf(a, w, h, margin = 10) {
  let s = 0;
  let s2 = 0;
  let n = 0;
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const v = a[y * w + x];
      s += v;
      s2 += v * v;
      n++;
    }
  }
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

function meanAbsDiff(fa, fb) {
  let d = 0;
  for (let i = 0; i < fa.rgb.length; i++) d += Math.abs(fa.rgb[i] - fb.rgb[i]);
  return d / fa.rgb.length;
}

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** Settings that leave only the stock: no machinery, no lens, no grain. */
const CLEAN = {
  'engine.gate': false,
  'lens.enabled': false,
  'grain.enabled': false,
  'halation.enabled': false,
  'framing.aspect': 'gate',
  'framing.overscan': -0.2,
};

/* ================================================================== *
 * 1. The app mounts and every shader links
 * ================================================================== */

const main = await openPage();
{
  const { page } = main;
  if (await page.locator('.fatal').count()) fail('mount', await page.locator('.fatal p').innerText());
  const kind = await page.evaluate(async () => {
    const r = await window.__filmbox.renderProbe({
      backend: 'gpu',
      settings: {},
      source: { kind: 'bars' },
      width: 64,
      height: 44,
      frames: [0],
    });
    return r.backend;
  });
  if (kind !== 'gpu') fail('mount', `the GPU backend did not start (got ${kind}) — a shader failed to compile or link`);
  else note('mount', 'app mounted · camera, glow, film and present programs linked on WebGL2');
}

/* ================================================================== *
 * 2. A still pushed through the interface comes out lit, with grain
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
async function settledStats(page, { minMean = 20, tolerance = 2.5, timeout = 15000 } = {}) {
  return page.evaluate(
    async ({ minMean, tolerance, timeout }) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const p = document.createElement('canvas');
      p.width = 160;
      p.height = 112;
      const g = p.getContext('2d', { willReadFrequently: true });
      const sample = () => {
        const app = document.querySelector('.stage canvas');
        g.drawImage(app, 0, 0, p.width, p.height);
        const d = g.getImageData(0, 0, p.width, p.height).data;
        let sum = 0;
        let lit = 0;
        let min = 255;
        let max = 0;
        let sat = 0;
        let satN = 0;
        for (let i = 0; i < d.length; i += 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l;
          if (l > 24) lit++;
          min = Math.min(min, l);
          max = Math.max(max, l);
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mx > 20) {
            sat += (mx - mn) / mx;
            satN++;
          }
        }
        const n = d.length / 4;
        return { mean: sum / n, lit: lit / n, contrast: (max - min) / 255, sat: satN ? sat / satN : 0, w: app.width, h: app.height };
      };
      const t0 = performance.now();
      let last = sample();
      while (performance.now() - t0 < timeout) {
        await sleep(200);
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
  // The flagship is a Super 8 cartridge: there must be texture in a flat bar.
  const texture = await page.evaluate(() => {
    const app = document.querySelector('.stage canvas');
    const p = document.createElement('canvas');
    p.width = app.width;
    p.height = app.height;
    const g = p.getContext('2d', { willReadFrequently: true });
    g.drawImage(app, 0, 0);
    // Inside the grey bar, well clear of its edges.
    const x0 = Math.round(app.width * 0.03);
    const x1 = Math.round(app.width * 0.11);
    const y0 = Math.round(app.height * 0.3);
    const y1 = Math.round(app.height * 0.5);
    const w = x1 - x0;
    const d = g.getImageData(x0, y0, w, y1 - y0).data;
    // Median of neighbour differences, scaled to a standard deviation: grain
    // everywhere counts, a speck of dirt that happens to land here does not.
    const diffs = [];
    for (let i = 0; i + 4 < d.length; i += 4) {
      if ((i / 4) % w === w - 1) continue;
      diffs.push(Math.abs(d[i + 1] - d[i + 5]));
    }
    diffs.sort((a, b) => a - b);
    return (diffs[Math.floor(diffs.length / 2)] * 1.4826) / Math.SQRT2;
  });
  if (texture < 0.6) fail('picture', `a flat area of the Super 8 picture has no grain (σ ${texture.toFixed(2)})`);
  note('picture', `${(s.lit * 100).toFixed(1)}% lit · contrast ${s.contrast.toFixed(2)} · grain σ ${texture.toFixed(1)} in a flat bar`);
}

/* ================================================================== *
 * 3. A real video clip reaches the film
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
      const probe = document.createElement('canvas');
      probe.width = 96;
      probe.height = 64;
      const pg = probe.getContext('2d', { willReadFrequently: true });
      const t1 = performance.now();
      while (performance.now() - t1 < 15000) {
        await sleep(200);
        vg.drawImage(video, 0, 0, 48, 36);
        const vd = vg.getImageData(0, 0, 48, 36).data;
        let pres = 0;
        for (let i = 0; i < vd.length; i += 4) pres = Math.max(pres, (vd[i] + vd[i + 1] + vd[i + 2]) / 3);
        out.presented = pres;
        pg.drawImage(document.querySelector('.stage canvas'), 0, 0, 96, 64);
        const d = pg.getImageData(0, 0, 96, 64).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 24) lit++;
        out.lit = lit / (96 * 64);
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
    if (r.lit < 0.15) fail('video', `frames exist but the film is black (${(r.lit * 100).toFixed(1)}% lit) — the source upload is broken`);
    note('video', `element ${r.presented.toFixed(0)} · film ${(r.lit * 100).toFixed(1)}% lit`);
  }
}

/* ================================================================== *
 * 4. The DSP worklet: three processors, frame-locked clatter
 * ================================================================== */

{
  const { page } = main;
  const a = await page.evaluate(async (url) => {
    const out = { registered: false, transportRms: 0, hissRms: 0, clackInterval: 0, clacks: 0, error: null };
    try {
      const sr = 48000;
      const ctx = new OfflineAudioContext(3, sr * 2, sr);
      await ctx.audioWorklet.addModule(url);
      out.registered = true;
      const params = {
        'film.cameraFps': 18,
        'film.projectorFps': 18,
        'transport.enabled': true,
        'transport.wowDepth': 0.4,
        'audio.enabled': true,
        'track.code': 0,
        'magnetic.enabled': true,
        'magnetic.hiss': -40,
        'magnetic.dropouts': 0,
        'projnoise.enabled': true,
        'projnoise.level': -12,
        'projnoise.claw': 1,
        'projnoise.shutter': 0,
        'projnoise.motor': 0,
        'projnoise.wear': 0,
        'link.enabled': false,
      };
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      const transport = new AudioWorkletNode(ctx, 'film-transport', { outputChannelCount: [2], processorOptions: { params, seed: 3 } });
      const track = new AudioWorkletNode(ctx, 'film-track', { numberOfInputs: 2, outputChannelCount: [2], processorOptions: { params, seed: 3 } });
      const projector = new AudioWorkletNode(ctx, 'film-projector', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { params, seed: 3 } });
      const merger = ctx.createChannelMerger(3);
      osc.connect(transport);
      transport.connect(merger, 0, 0);
      // The track with no programme: only its own hiss.
      track.connect(merger, 0, 1);
      projector.connect(merger, 0, 2);
      merger.connect(ctx.destination);
      osc.start();
      const buf = await ctx.startRendering();
      const rms = (d, from) => {
        let s = 0;
        for (let i = from; i < d.length; i++) s += d[i] * d[i];
        return Math.sqrt(s / (d.length - from));
      };
      out.transportRms = rms(buf.getChannelData(0), sr * 0.2);
      out.hissRms = rms(buf.getChannelData(1), 0);
      // Clack onsets: 2 ms envelope peaks, spaced at least 30 ms.
      const d = buf.getChannelData(2);
      const bin = sr / 500;
      const env = [];
      for (let i = 0; i < d.length; i += bin) {
        let m = 0;
        for (let k = i; k < i + bin && k < d.length; k++) m = Math.max(m, Math.abs(d[k]));
        env.push(m);
      }
      const thr = Math.max(...env) * 0.25;
      const on = [];
      for (let i = 1; i < env.length; i++) {
        if (env[i] > thr && env[i - 1] <= thr && (on.length === 0 || i - on[on.length - 1] > 15)) on.push(i);
      }
      const gaps = on.slice(1).map((v, i) => (v - on[i]) * 2);
      gaps.sort((x, y) => x - y);
      out.clacks = on.length;
      out.clackInterval = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    } catch (err) {
      out.error = String(err);
    }
    return out;
  }, `${base}worklets/filmbox-dsp.js`);
  if (a.error) fail('audio', a.error);
  else {
    if (!a.registered) fail('audio', 'the worklet module did not register');
    if (a.transportRms < 0.05) fail('audio', `the transport passed no signal (rms ${a.transportRms.toExponential(2)})`);
    if (a.hissRms < 1e-3) fail('audio', `the magnetic stripe is silent with no programme (rms ${a.hissRms.toExponential(2)})`);
    if (Math.abs(a.clackInterval - 1000 / 18) > 4) {
      fail('audio', `projector clatter is not locked to 18 fps: median interval ${a.clackInterval} ms against 55.6`);
    }
    note('audio', `transport rms ${a.transportRms.toFixed(3)} · stripe hiss ${a.hissRms.toFixed(4)} · clatter every ${a.clackInterval} ms (${a.clacks} strikes in 2 s)`);
  }
}

/* ================================================================== *
 * 5. Keyframes animate the render, and ease between
 * ================================================================== */

{
  const { page } = await openPage();
  try {
    // A calm look, so the brightness is not dominated by flicker and leaks.
    await page.selectOption('.topbar-actions select', 'reference');
    await dropStill(page, `g.fillStyle = '#909090'; g.fillRect(0, 0, w, h);`);
    await settledStats(page);
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const setInput = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'Lens')?.click();
      await sleep(300);
      const row = [...document.querySelectorAll('.param')].find((x) => x.querySelector('.param-label')?.textContent === 'Exposure');
      if (!row) throw new Error('could not find the Exposure parameter');
      row.querySelector('.stopwatch').click();
      await sleep(200);
      const scrub = document.querySelector('input.scrub');
      setInput(scrub, 4);
      await sleep(200);
      setInput(row.querySelector("input[type='range']"), -3);
      await sleep(200);
      const diamonds = document.querySelectorAll('.track .key').length;
      const app = document.querySelector('.stage canvas');
      const p = document.createElement('canvas');
      p.width = 64;
      p.height = 44;
      const g = p.getContext('2d', { willReadFrequently: true });
      const mean = () => {
        g.drawImage(app, 0, 0, 64, 44);
        const d = g.getImageData(0, 0, 64, 44).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += d[i + 1];
        return s / (d.length / 4);
      };
      const levels = [];
      for (const t of [0, 2, 4]) {
        setInput(scrub, t);
        // Average a run of samples once the value has stopped moving.
        let last = -1;
        for (let k = 0; k < 40; k++) {
          await sleep(120);
          const m = mean();
          if (Math.abs(m - last) < 3) break;
          last = m;
        }
        let acc = 0;
        for (let k = 0; k < 5; k++) {
          await sleep(60);
          acc += mean();
        }
        levels.push(acc / 5);
      }
      return { diamonds, levels };
    });
    if (r.diamonds !== 2) fail('keyframes', `expected 2 keyframe markers, drew ${r.diamonds}`);
    const [a, mid, b] = r.levels;
    if (a - b < 30) fail('keyframes', `three stops less exposure barely changed the render (${a.toFixed(1)} → ${b.toFixed(1)})`);
    if (mid < Math.min(a, b) + 3 || mid > Math.max(a, b) - 3) {
      fail('keyframes', `midpoint ${mid.toFixed(1)} is not between ${a.toFixed(1)} and ${b.toFixed(1)} — stepping, not easing`);
    }
    note('keyframes', `${r.diamonds} markers · brightness ${r.levels.map((v) => v.toFixed(0)).join(' → ')}`);
  } catch (err) {
    fail('keyframes', String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 6. The output frame is the shape of the projected picture
 * ================================================================== */

{
  const { page } = await openPage();
  try {
    const ratios = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'Gate')?.click();
      await sleep(300);
      const sect = [...document.querySelectorAll('.group')].find((s) => s.querySelector('.group-title')?.textContent === 'Framing & Output');
      if (!sect) throw new Error('no Framing & Output section');
      if (!sect.classList.contains('open')) sect.querySelector('.group-toggle').click();
      await sleep(300);
      const row = [...document.querySelectorAll('.param')].find((r) => r.querySelector('.param-label')?.textContent === 'Aspect');
      const select = row.querySelector('select');
      const out = {};
      for (const v of ['1.85', '1.33', '2.39']) {
        select.value = v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        let ratio = 0;
        for (let k = 0; k < 25; k++) {
          await sleep(100);
          const c = document.querySelector('.stage canvas');
          ratio = c.width / c.height;
          if (Math.abs(ratio - Number(v)) < 0.02) break;
        }
        out[v] = ratio;
      }
      return out;
    });
    for (const [want, got] of Object.entries(ratios)) {
      if (Math.abs(got - Number(want)) > 0.03) fail('framing', `asked for ${want}, the frame is ${got.toFixed(3)}`);
    }
    note('framing', Object.entries(ratios).map(([k, v]) => `${k} → ${v.toFixed(3)}`).join(' · '));
  } catch (err) {
    fail('framing', String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 7. Every frame is a function of its number
 *
 * Nothing in the chain accumulates, so seeking cannot lose anything and an
 * export that steps by seeking renders exactly what playback shows. Asserted
 * by rendering the same frame after different histories.
 * ================================================================== */

{
  const { page } = main;
  const s = (await page.evaluate(() => window.__filmbox.presets?.['super8-1974'])) ?? {};
  for (const backend of ['gpu', 'cpu']) {
    const req = { backend, settings: s, source: { kind: 'texture', panPxPerSec: 90, cell: 6 }, width: 160, height: 110, srcWidth: 160, srcHeight: 110 };
    const a = await probe(page, { ...req, frames: [3, 4, 5, 9] });
    const b = await probe(page, { ...req, frames: [9] });
    const d = meanAbsDiff(a.frames[3], b.frames[0]);
    if (d > 0.01) fail('purity', `${backend}: frame 9 differs by ${d.toFixed(3)}/px depending on what was rendered before it`);
    else note('purity', `${backend}: frame 9 identical whether rendered after 3, 4, 5 or on its own`);
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
    const s = await settledStats(page, { timeout: 20000 });
    const mounted = await page.evaluate(() => (document.getElementById('root')?.innerHTML || '').length);
    if (mounted < 500) fail('packaged', `the app did not mount over file:// (root is ${mounted} chars)`);
    if (s.lit < 0.3) fail('packaged', `mounted over file:// but the film is black (${(s.lit * 100).toFixed(1)}% lit)`);
    // The worklet and its imported event clock have to load over file:// too.
    const worklet = await page.evaluate(async () => {
      try {
        const ctx = new OfflineAudioContext(1, 128, 48000);
        await ctx.audioWorklet.addModule(new URL('worklets/filmbox-dsp.js', document.baseURI).href);
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
 * shader. Each picture section is pushed hard from the same baseline and
 * the render must change.
 * ================================================================== */

{
  const { page } = main;
  const baseline = { 'format.stock': 'vision3_250d', 'camera.weave': 0, 'projector.weave': 0 };
  const cases = [
    ['curve.gamma', 1.6],
    ['curve.toe', 0.6],
    ['curve.shoulder', -1],
    ['curve.push', 2],
    ['grain.amount', 3],
    ['grain.size', 2.5],
    ['halation.amount', 5],
    ['halation.noBacking', true],
    ['dye.saturation', 2],
    ['dye.impurity', 2.5],
    ['print.process', 'scan'],
    ['print.stock', 'eastman5381'],
    ['print.red', 35],
    ['print.generations', 4],
    ['print.bleachBypass', 1],
    ['fade.years', 60],
    ['exposure.stops', 1.5],
    ['exposure.light', 'tungsten'],
    ['exposure.filter85', true],
    ['lens.resolution', 12],
    ['lens.vignette', 2.5],
    ['lens.chromatic', 40],
    ['lens.flare', 0.2],
    ['lens.distortion', 0.2],
    ['anamorphic.enabled', true],
    ['camera.weave', 80],
    ['camera.flicker', 0.6],
    ['projector.weave', 80],
    ['projector.hotspot', 2],
    ['projector.focus', 60],
    ['projector.warmth', 1],
    ['projector.framing', 0.3],
    ['gatedirt.specks', 1],
    ['gatedirt.hair', 1],
    ['filmdirt.dust', 1],
    ['filmdirt.fibres', 1],
    ['scratch.rate', 1],
    ['leak.rollFog', 2],
    ['leak.edgeFog', 1],
    ['decay.vinegar', 1],
    ['decay.mould', 1],
    ['decay.water', 1],
    ['decay.flaking', 1],
    ['decay.channelling', 1],
    ['telecine.black', 0.08],
    ['telecine.saturation', 0],
    ['framing.overscan', 0.5],
  ];
  const req = { backend: 'gpu', source: { kind: 'bars' }, width: 288, height: 200, frames: [2] };
  const ref = (await probe(page, { ...req, settings: baseline })).frames[0];
  const quiet = [];
  for (const [key, value] of cases) {
    const f = (await probe(page, { ...req, settings: { ...baseline, [key]: value } })).frames[0];
    const d = meanAbsDiff(ref, f);
    // The baseline is deterministic — same frame, same seed — so anything wired
    // changes it; sparse things like a speck change it only a little.
    if (d < 0.1) quiet.push(`${key}=${value} (${d.toFixed(2)})`);
  }
  if (quiet.length) fail('sections', `these did not change the picture: ${quiet.join(', ')}`);
  note('sections', `${cases.length - quiet.length}/${cases.length} picture parameters measurably reach the render`);
}

/* ================================================================== *
 * 10. The guide and the information widgets
 * ================================================================== */

{
  const { page } = await openPage(base, { guide: true });
  const out = { shown: false, closed: false, reopened: false, films: 0, hidden: false, f1: false, param: '', section: '' };
  try {
    out.shown = (await page.$('.guide')) !== null;
    await page.evaluate(() => document.querySelector('.guide-close')?.click());
    await page.waitForSelector('.guide', { state: 'detached', timeout: 3000 }).catch(() => undefined);
    out.closed = (await page.$('.guide')) === null;
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Guide')?.click());
    await page.waitForSelector('.guide', { timeout: 3000 }).catch(() => undefined);
    out.reopened = (await page.$('.guide')) !== null;
    await page.evaluate(() => [...document.querySelectorAll('.guide-tabs button')].find((b) => b.textContent.includes('Reference'))?.click());
    await page.waitForSelector('.guide-tube', { timeout: 3000 }).catch(() => undefined);
    out.films = await page.evaluate(() => document.querySelectorAll('.guide-tube').length);
    await page.evaluate(() => {
      const box = document.querySelector('.guide-foot .check input');
      if (box && !box.checked) box.click();
    });
    await page.evaluate(() => document.querySelector('.guide-close')?.click());
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.stage canvas', { timeout: 10000 });
    out.hidden = (await page.$('.guide')) === null;
    await page.keyboard.press('F1');
    await page.waitForSelector('.guide', { timeout: 3000 }).catch(() => undefined);
    out.f1 = (await page.$('.guide')) !== null;
    await page.keyboard.press('Escape');
    await page.waitForSelector('.guide', { state: 'detached', timeout: 3000 }).catch(() => undefined);
    const info = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === 'Stock')?.click();
      await sleep(300);
      const sect = [...document.querySelectorAll('.group')].find((g) => g.querySelector('.group-title')?.textContent === 'Characteristic Curve');
      if (!sect) throw new Error('no Characteristic Curve section');
      sect.querySelector('.group-info-btn').click();
      if (!sect.classList.contains('open')) sect.querySelector('.group-toggle').click();
      await sleep(300);
      const row = [...document.querySelectorAll('.param')].find((r) => r.querySelector('.param-label')?.textContent === 'Toe position');
      if (!row) throw new Error('no Toe position parameter');
      row.querySelector('.param-info-btn').click();
      await sleep(300);
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
  if (out.films < 10) fail('guide', `only ${out.films} reference films listed`);
  if (!out.hidden) fail('guide', '"don\'t show on startup" did not survive a reload');
  if (!out.f1) fail('guide', 'F1 did not reopen it');
  if (out.param.length < 80) fail('guide', `a parameter's ⓘ revealed only ${out.param.length} characters`);
  if (out.section.length < 150) fail('guide', `a section's ⓘ revealed only ${out.section.length} characters`);
  note('guide', `shown, closes, reopens, ${out.films} films, remembered, F1 · ⓘ ${out.param.length} / ${out.section.length} chars`);
  await page.close();
}

/* ================================================================== *
 * 11. The film, measured
 * ================================================================== */

const { page: lab } = main;
const G = { width: 578, height: 400, srcWidth: 578, srcHeight: 400 };

/**
 * Slope of log2(output light) against log2(exposure), across a ramp. With the
 * telecine off, video log-light is an exact straight line in film density, so
 * this slope is the characteristic curve's own, read off the screen.
 */
async function curveProfile(settings, stops, window = 0.8) {
  const res = await probe(lab, {
    backend: 'gpu',
    settings: { ...CLEAN, ...settings, 'exposure.headroom': 0, 'exposure.stops': stops },
    source: { kind: 'ramp', stops: 16 },
    ...G,
    frames: [0],
  });
  const f = res.frames[0];
  const W = res.width;
  const pts = [];
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 180; y < 220; y++) s += f.rgb[(y * W + x) * 3 + 1];
    s /= 40;
    const u = 0.5 + ((x + 0.5) / W - 0.5) * window;
    pts.push({ ev: -16 * (1 - u) + stops - Math.log2(0.18), out: Math.log2(Math.max(srgbToLinear(s), 1e-6)), code: s });
  }
  // Least-squares slope over 1.4-stop windows.
  const slopes = [];
  const span = Math.round(W * (1.4 / (16 * window)));
  for (let i = 0; i + span < W; i += Math.max(4, Math.floor(span / 3))) {
    const seg = pts.slice(i, i + span).filter((p) => p.code > 3 && p.code < 252);
    if (seg.length < span * 0.8) continue;
    const mx = seg.reduce((a, p) => a + p.ev, 0) / seg.length;
    const my = seg.reduce((a, p) => a + p.out, 0) / seg.length;
    let sxy = 0;
    let sxx = 0;
    for (const p of seg) {
      sxy += (p.ev - mx) * (p.out - my);
      sxx += (p.ev - mx) ** 2;
    }
    slopes.push({ ev: mx, slope: sxy / sxx, code: seg[Math.floor(seg.length / 2)].code });
  }
  return slopes;
}

const at = (profile, ev) => profile.reduce((b, p) => (Math.abs(p.ev - ev) < Math.abs(b.ev - ev) ? p : b));

/* ---- 11a. the characteristic curve has a toe and a shoulder ---- */
{
  const stage = 'curve';
  try {
    const shadowsLin = await curveProfile({ 'curve.enabled': false }, 1);
    const linMid = at(shadowsLin, -1).slope;
    const linLow = at(shadowsLin, -5).slope;
    if (Math.abs(linMid - 1) > 0.12 || Math.abs(linLow - 1) > 0.25) {
      fail(stage, `the straight-line control is not straight (slope ${linLow.toFixed(2)} low, ${linMid.toFixed(2)} mid) — the measurement is wrong, not the film`);
    }
    const rows = [];
    for (const [name, stock, shoulderEv] of [
      ['Kodachrome', 'kodachrome40', 2.2],
      ['Vision3 + print', 'vision3_250d', 3.5],
    ]) {
      const shadows = await curveProfile({ 'format.stock': stock }, 1);
      const highs = await curveProfile({ 'format.stock': stock }, 4);
      const mid = Math.max(...shadows.filter((p) => p.ev > -2 && p.ev < 1).map((p) => p.slope));
      const toe = at(shadows, -5.5).slope;
      const shoulder = at(highs, shoulderEv).slope;
      if (!(toe < 0.5 * mid)) fail(stage, `${name}: no toe — slope ${toe.toFixed(2)} at −5.5 stops against ${mid.toFixed(2)} mid`);
      if (!(shoulder < 0.5 * mid)) fail(stage, `${name}: no shoulder — slope ${shoulder.toFixed(2)} at +${shoulderEv} stops against ${mid.toFixed(2)} mid`);
      rows.push(`${name} ${toe.toFixed(2)} / ${mid.toFixed(2)} / ${shoulder.toFixed(2)}`);
    }
    note(stage, `slope toe / mid / shoulder: linear ${linLow.toFixed(2)} / ${linMid.toFixed(2)} · ${rows.join(' · ')}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11b. reversal clips sooner and harder than negative ---- */
{
  const stage = 'latitude';
  try {
    // Clear film has to land below video white here, or the film's own
    // highlight end and the display's clip coincide and cannot be told apart.
    const visible = { 'engine.gate': true, 'camera.enabled': false, 'projector.enabled': false, 'telecine.white': 0.7 };
    const knee = async (stock) => {
      const p = await curveProfile({ 'format.stock': stock, ...visible }, 4);
      const ups = p.filter((q) => q.ev > -1);
      const peak = Math.max(...ups.map((q) => q.slope));
      const peakAt = ups.find((q) => q.slope === peak).ev;
      const after = ups.filter((q) => q.ev > peakAt);
      const cross = (frac) => after.find((q) => q.slope < frac * peak)?.ev ?? 99;
      return { at80: cross(0.8), at20: cross(0.2) };
    };
    const rev = await knee('kodachrome40');
    const neg = await knee('vision3_250d');
    const revWidth = rev.at20 - rev.at80;
    const negWidth = neg.at20 - neg.at80;
    if (!(rev.at20 < neg.at20 - 1)) {
      fail(stage, `reversal does not clip sooner: its highlights flatten at +${rev.at20.toFixed(1)} stops, the negative's at +${neg.at20.toFixed(1)}`);
    }
    if (!(revWidth < negWidth)) {
      fail(stage, `reversal does not clip harder: its shoulder spans ${revWidth.toFixed(1)} stops, the negative's ${negWidth.toFixed(1)}`);
    }
    note(stage, `highlights flatten at +${rev.at20.toFixed(1)} stops on Kodachrome over ${revWidth.toFixed(1)} stops, +${neg.at20 > 50 ? '>' + '6' : neg.at20.toFixed(1)} on Vision3 over ${negWidth > 50 ? '>3' : negWidth.toFixed(1)}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11c. grain is fixed to the film, not to the picture ---- */
{
  const stage = 'grain/gate';
  try {
    // Flat grey: the only structure is grain. Same film frame, same seed.
    const grainy = {
      'engine.lens': false,
      'halation.enabled': false,
      'grain.amount': 2.5,
      'camera.enabled': true,
      'camera.flicker': 0,
      'projector.enabled': true,
      'projector.weave': 0,
      'projector.hotspot': 0,
      'framing.overscan': -0.2,
      'telecine.enabled': false,
    };
    const W = 200;
    const H = 140;
    const req = { backend: 'gpu', source: { kind: 'grey', level: 0.5 }, width: W, height: H, srcWidth: W, srcHeight: H, frames: [5] };
    const grain = async (extra) => highpass(luma((await probe(lab, { ...req, settings: { ...grainy, ...extra } })).frames[0], W, H), W, H, 2);
    const still = await grain({ 'camera.weave': 0 });
    // The camera's registration error moves the image relative to the film:
    // the grain must stay exactly where it was.
    const camera = await grain({ 'camera.weave': 80 });
    const cam = bestShift(still, camera, W, H, 4);
    // The projector moves the strip: grain goes with it. Framing by 0.02
    // frames on Super 8 is 0.085 mm, which at this size is a known shift.
    const shiftMm = 0.02 * 4.234;
    const visH = 4.01 * 0.8;
    const expectPx = Math.round((shiftMm / visH) * H);
    const proj = await grain({ 'camera.weave': 0, 'projector.framing': 0.02 });
    const pr = bestShift(still, proj, W, H, 6);
    if (!(cam.dx === 0 && cam.dy === 0 && cam.c > 0.9)) {
      fail(stage, `grain moved with the camera's registration error (best match at ${cam.dx},${cam.dy}, r=${cam.c.toFixed(2)}) — it is not on the film`);
    }
    if (!(Math.abs(Math.abs(pr.dy) - expectPx) <= 1 && pr.dx === 0 && pr.c > 0.6)) {
      fail(stage, `grain did not travel with the strip in the projector: best match at ${pr.dx},${pr.dy} (r=${pr.c.toFixed(2)}), expected 0,±${expectPx}`);
    }
    note(stage, `camera weave: grain stays (r=${cam.c.toFixed(2)} at 0,0) · projector moves strip ${expectPx}px: grain follows (r=${pr.c.toFixed(2)} at ${pr.dx},${pr.dy})`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11d. grain scales with the format ---- */
{
  const stage = 'grain/size';
  try {
    const W = 240;
    const H = 166;
    const power = async (gauge) => {
      const f = (await probe(lab, {
        backend: 'gpu',
        settings: { 'engine.gate': false, 'engine.lens': false, 'halation.enabled': false, 'format.gauge': gauge, 'format.stock': 'vision3_250d', 'framing.aspect': '1.44' },
        source: { kind: 'grey', level: 0.5 },
        width: W,
        height: H,
        srcWidth: W,
        srcHeight: H,
        frames: [0],
      })).frames[0];
      const hp = highpass(luma(f, W, H), W, H, 3);
      return stdOf(hp, W, H) ** 2;
    };
    const s8 = await power('super8');
    const m16 = await power('mm16');
    const m35 = await power('mm35');
    if (!(s8 > 3 * m35 && s8 > m16 && m16 > m35)) {
      fail(stage, `the same stock is not grainier on a smaller frame: power ${s8.toFixed(2)} Super 8, ${m16.toFixed(2)} 16 mm, ${m35.toFixed(2)} 35 mm`);
    }
    note(stage, `Vision3 250D grain power: Super 8 ${s8.toFixed(2)} · 16 mm ${m16.toFixed(2)} · 35 mm ${m35.toFixed(2)} (${(s8 / m35).toFixed(1)}×)`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11e. gate dirt persists; film dirt lasts one frame ---- */
{
  const stage = 'dirt';
  try {
    const W = 200;
    const H = 140;
    const quiet = {
      'engine.lens': false,
      'grain.enabled': false,
      'halation.enabled': false,
      'camera.weave': 0,
      'camera.flicker': 0,
      'projector.weave': 20,
      'projector.hotspot': 0,
      'format.stock': 'kodachrome40',
    };
    const specks = async (extra) => {
      const res = await probe(lab, {
        backend: 'gpu',
        settings: { ...quiet, ...extra },
        source: { kind: 'grey', level: 0.55 },
        width: W,
        height: H,
        srcWidth: W,
        srcHeight: H,
        frames: [0, 1, 2, 3, 4, 5, 6, 7],
      });
      return res.frames.map((f) => {
        const l = luma(f, W, H);
        const sorted = [...l].sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        const mask = new Uint8Array(W * H);
        for (let i = 0; i < l.length; i++) if (l[i] < med - 25) mask[i] = 1;
        return mask;
      });
    };
    const jaccard = (a, b) => {
      let i = 0;
      let u = 0;
      for (let k = 0; k < a.length; k++) {
        if (a[k] && b[k]) i++;
        if (a[k] || b[k]) u++;
      }
      return u ? i / u : 1;
    };
    const avgOverlap = (masks) => {
      let s = 0;
      for (let k = 1; k < masks.length; k++) s += jaccard(masks[k - 1], masks[k]);
      return s / (masks.length - 1);
    };
    const gate = await specks({ 'gatedirt.specks': 1, 'gatedirt.life': 30 });
    const film = await specks({ 'filmdirt.dust': 1 });
    const gateCount = gate[0].reduce((a, b) => a + b, 0);
    const filmCount = film[0].reduce((a, b) => a + b, 0);
    const go = avgOverlap(gate);
    const fo = avgOverlap(film);
    if (gateCount < 20 || filmCount < 20) fail(stage, `not enough dirt to measure (${gateCount} gate px, ${filmCount} film px)`);
    if (!(go > 0.8)) fail(stage, `gate dirt did not persist from frame to frame (overlap ${go.toFixed(2)})`);
    if (!(fo < 0.15)) fail(stage, `film dirt persisted from frame to frame (overlap ${fo.toFixed(2)}) — it should last one frame`);
    note(stage, `frame-to-frame overlap: gate grit ${go.toFixed(2)} (stays put while the strip weaves) · film dust ${fo.toFixed(2)}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11f. polarity: dirt on the negative prints white ---- */
{
  const stage = 'polarity';
  try {
    const W = 200;
    const H = 140;
    const extreme = async (extra) => {
      const f = (await probe(lab, {
        backend: 'gpu',
        settings: { 'engine.lens': false, 'grain.enabled': false, 'camera.weave': 0, 'projector.weave': 0, 'filmdirt.dust': 1, ...extra },
        source: { kind: 'grey', level: 0.45 },
        width: W,
        height: H,
        srcWidth: W,
        srcHeight: H,
        frames: [1],
      })).frames[0];
      const l = luma(f, W, H);
      const sorted = [...l].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      let dark = 0;
      let bright = 0;
      for (const v of l) {
        if (v < med - 30) dark++;
        if (v > med + 30) bright++;
      }
      return { dark, bright };
    };
    const reversal = await extreme({ 'format.stock': 'kodachrome40' });
    const printed = await extreme({ 'format.stock': 'vision3_250d', 'filmdirt.negative': 1 });
    if (!(reversal.dark > 10 * Math.max(1, reversal.bright))) fail(stage, `dust on reversal is not dark (${reversal.dark} dark, ${reversal.bright} bright px)`);
    if (!(printed.bright > 10 * Math.max(1, printed.dark))) fail(stage, `dust on a printed negative is not white (${printed.bright} bright, ${printed.dark} dark px)`);
    note(stage, `dust on reversal: ${reversal.dark} dark px · on a negative, printed: ${printed.bright} white px`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11g. halation is red ---- */
{
  const stage = 'halation';
  try {
    const W = 240;
    const H = 166;
    const f = (await probe(lab, {
      backend: 'gpu',
      settings: { 'engine.gate': false, 'engine.lens': false, 'grain.enabled': false, 'format.stock': 'vision3_500t', 'halation.amount': 4 },
      source: { kind: 'bars' },
      width: W,
      height: H,
      srcWidth: W,
      srcHeight: H,
      frames: [0],
    })).frames[0];
    // Just above the white box, in what should be black.
    const x0 = Math.round(W * 0.12);
    const x1 = Math.round(W * 0.25);
    const y = Math.round(H * 0.79);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 3;
      r += f.rgb[i];
      g += f.rgb[i + 1];
      b += f.rgb[i + 2];
    }
    const n = x1 - x0;
    r /= n;
    g /= n;
    b /= n;
    if (!(r > g + 4 && g >= b)) fail(stage, `the glow round a highlight is not red-orange (R ${r.toFixed(0)}, G ${g.toFixed(0)}, B ${b.toFixed(0)})`);
    note(stage, `glow beside a white patch on black: R ${r.toFixed(0)} · G ${g.toFixed(0)} · B ${b.toFixed(0)}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11h. fading is per-dye, towards magenta ---- */
{
  const stage = 'fading';
  try {
    const W = 80;
    const H = 56;
    const grey = async (years) => {
      const f = (await probe(lab, {
        backend: 'gpu',
        settings: { 'engine.gate': false, 'engine.lens': false, 'grain.enabled': false, 'format.gauge': 'mm35', 'format.stock': 'eastman5247', 'print.stock': 'eastman5381', 'fade.years': years, 'fade.storage': 'warm' },
        source: { kind: 'grey', level: 0.46 },
        width: W,
        height: H,
        srcWidth: W,
        srcHeight: H,
        frames: [0],
      })).frames[0];
      return f.mean;
    };
    const fresh = await grey(0);
    const old = await grey(40);
    const chroma = (c) => [c[0] - c[1], c[2] - c[1]];
    const [freshR, freshB] = chroma(fresh);
    const [oldR, oldB] = chroma(old);
    if (Math.abs(freshR) > 6 || Math.abs(freshB) > 6) fail(stage, `a fresh print of grey is not grey (${fresh.map((v) => v.toFixed(0)).join(',')})`);
    if (!(oldR > 15 && oldB > 5)) {
      fail(stage, `forty warm years did not turn grey magenta: R−G ${oldR.toFixed(1)}, B−G ${oldB.toFixed(1)} (${old.map((v) => v.toFixed(0)).join(',')})`);
    }
    note(stage, `5381 grey: fresh ${fresh.map((v) => v.toFixed(0)).join(',')} → 40 warm years ${old.map((v) => v.toFixed(0)).join(',')} (R−G +${oldR.toFixed(0)}, B−G +${oldB.toFixed(0)})`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11i. film frames are held: 18 fps is 18 pictures a second ---- */
{
  const stage = 'hold';
  try {
    const W = 120;
    const H = 84;
    const res = await probe(lab, {
      backend: 'gpu',
      settings: { 'engine.gate': false, 'engine.lens': false, 'grain.enabled': false, 'framing.fps': '59.94' },
      source: { kind: 'texture', panPxPerSec: 60, cell: 4 },
      width: W,
      height: H,
      srcWidth: W,
      srcHeight: H,
      frames: Array.from({ length: 60 }, (_, i) => i),
    });
    let changes = 0;
    for (let i = 1; i < res.frames.length; i++) if (meanAbsDiff(res.frames[i - 1], res.frames[i]) > 0.5) changes++;
    // 60 output frames at 59.94 fps is just over a second: 18 film frames.
    if (Math.abs(changes - 17) > 1) fail(stage, `${changes + 1} distinct pictures in 60 frames of 59.94 fps video, expected 18 — film frames are not being held`);
    note(stage, `${changes + 1} distinct pictures in one second of 59.94 fps video from 18 fps film`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11j. 3:2 pulldown ---- */
{
  const stage = 'pulldown';
  try {
    const W = 64;
    const H = 48;
    const settings = {
      'engine.lens': false,
      'grain.enabled': false,
      'halation.enabled': false,
      'camera.enabled': false,
      'projector.enabled': false,
      'format.gauge': 'mm16',
      'format.fps': '24',
      'framing.fps': '29.97',
      'telecine.fields': true,
      'telecine.fieldOrder': 'upper',
    };
    const res = await probe(lab, { backend: 'gpu', settings, source: { kind: 'counter' }, width: W, height: H, srcWidth: W, srcHeight: H, frames: Array.from({ length: 20 }, (_, i) => i) });
    // Each field's level, read from its own lines.
    const fields = [];
    for (const f of res.frames) {
      for (const parity of [0, 1]) {
        let s = 0;
        let n = 0;
        for (let y = parity; y < H; y += 2) {
          for (let x = 8; x < W - 8; x++) {
            s += f.rgb[(y * W + x) * 3 + 1];
            n++;
          }
        }
        fields.push(s / n);
      }
    }
    // Runs of fields showing the same film frame.
    const runs = [];
    let len = 1;
    for (let i = 1; i < fields.length; i++) {
      if (Math.abs(fields[i] - fields[i - 1]) < 2) len++;
      else {
        runs.push(len);
        len = 1;
      }
    }
    const inner = runs.slice(1);
    const pattern = inner.join('');
    const ok = inner.length >= 6 && inner.every((r) => r === 2 || r === 3) && !/22|33/.test(pattern);
    const mixed = res.frames.filter((f) => {
      let a = 0;
      let b = 0;
      for (let x = 8; x < W - 8; x++) {
        a += f.rgb[(20 * W + x) * 3 + 1];
        b += f.rgb[(21 * W + x) * 3 + 1];
      }
      return Math.abs(a - b) / (W - 16) > 2;
    }).length;
    if (!ok) fail(stage, `field cadence is ${pattern}, not alternating 3 and 2`);
    if (mixed !== 8) fail(stage, `${mixed} of 20 video frames mix two film frames, expected 8 (two in every five)`);
    // Without fields the cadence is still uneven: some film frames get two video frames.
    const prog = await probe(lab, { backend: 'gpu', settings: { ...settings, 'telecine.fields': false }, source: { kind: 'counter' }, width: W, height: H, srcWidth: W, srcHeight: H, frames: Array.from({ length: 10 }, (_, i) => i) });
    const holds = [];
    let h = 1;
    for (let i = 1; i < prog.frames.length; i++) {
      if (meanAbsDiff(prog.frames[i - 1], prog.frames[i]) < 0.5) h++;
      else {
        holds.push(h);
        h = 1;
      }
    }
    if (new Set(holds).size < 2) fail(stage, `progressive transfer holds every film frame equally (${holds.join(',')}) — 24 on 29.97 cannot`);
    note(stage, `fields ${pattern} · ${mixed}/20 frames combed · progressive holds ${holds.join(',')}`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ---- 11k. a splice is a jump and a pop, from the same event ---- */
{
  const stage = 'splice';
  try {
    const r = await lab.evaluate(async (workletBase) => {
      const ev = await import(`${workletBase}film-events.js`);
      const seed = 1337;
      const rate = 12;
      const fps = 18;
      const frames = [];
      for (let n = 1; n < 18 * 6; n++) if (ev.spliceAt(n, seed, rate, fps)) frames.push(n);
      // The sound: an optical track through the worklet, silence in.
      const sr = 48000;
      const ctx = new OfflineAudioContext(1, sr * 6, sr);
      await ctx.audioWorklet.addModule(`${workletBase}filmbox-dsp.js`);
      const params = {
        'film.cameraFps': fps,
        'film.projectorFps': fps,
        'audio.enabled': true,
        'track.code': 1,
        'optical.enabled': true,
        'optical.noise': -120,
        'optical.crackle': 0,
        'optical.exciterHum': -120,
        'playback.enabled': false,
        'splice.enabled': true,
        'splice.rate': rate,
        'link.enabled': true,
        'link.spliceToPop': 1,
        'link.dirtToCrackle': 0,
      };
      const track = new AudioWorkletNode(ctx, 'film-track', { numberOfInputs: 2, outputChannelCount: [1], processorOptions: { params, seed } });
      track.connect(ctx.destination);
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      const onsets = [];
      for (let i = 0; i < d.length; i++) {
        if (Math.abs(d[i]) > 0.05 && (onsets.length === 0 || i / sr - onsets[onsets.length - 1] > 0.3)) onsets.push(i / sr);
      }
      return { frames, onsets };
    }, `${base}worklets/`);
    if (r.frames.length < 2) throw new Error(`only ${r.frames.length} splices in six seconds at 12/min — the event clock is off`);
    // Picture: the splice frame jumps.
    const W = 120;
    const H = 84;
    const settings = { 'engine.lens': false, 'grain.enabled': false, 'camera.enabled': false, 'projector.weave': 0, 'splice.rate': 12, 'splice.jump': 1 };
    const n = r.frames[0];
    const frames = await probe(lab, { backend: 'gpu', settings, source: { kind: 'bars' }, width: W, height: H, srcWidth: W, srcHeight: H, frames: [n - 3, n - 2, n] });
    const steady = meanAbsDiff(frames.frames[0], frames.frames[1]);
    const jump = meanAbsDiff(frames.frames[1], frames.frames[2]);
    if (!(jump > steady + 5)) fail(stage, `the picture did not jump on the splice at frame ${n} (${jump.toFixed(1)}/px against ${steady.toFixed(1)})`);
    const times = r.frames.map((k) => k / 18);
    const unmatched = times.filter((t) => !r.onsets.some((o) => Math.abs(o - t) < 1 / 18 + 0.01));
    if (unmatched.length) fail(stage, `splices at ${unmatched.map((t) => t.toFixed(2)).join(', ')} s made no sound (pops at ${r.onsets.map((t) => t.toFixed(2)).join(', ')})`);
    if (r.onsets.length > times.length + 1) fail(stage, `${r.onsets.length} pops for ${times.length} splices`);
    note(stage, `splices on frames ${r.frames.join(', ')} · picture jumps ${jump.toFixed(1)}/px · pops at ${r.onsets.map((t) => t.toFixed(2)).join(', ')} s`);
  } catch (err) {
    fail(stage, String(err));
  }
}

/* ================================================================== *
 * 12. The CPU backend agrees with the GPU
 * ================================================================== */

{
  const stage = 'cpu';
  try {
    const W = 160;
    const H = 110;
    const req = { source: { kind: 'bars' }, width: W, height: H, srcWidth: 320, srcHeight: 240, frames: [4] };
    const clean = { 'grain.enabled': false, 'engine.gate': false };
    const g1 = (await probe(lab, { ...req, backend: 'gpu', settings: clean })).frames[0];
    const c1 = (await probe(lab, { ...req, backend: 'cpu', settings: clean })).frames[0];
    const perPixel = meanAbsDiff(g1, c1);
    if (perPixel > 1.5) fail(stage, `without grain the two backends differ by ${perPixel.toFixed(2)}/px`);
    const flagship = (await lab.evaluate(() => window.__filmbox.presets?.['super8-1974'])) ?? {};
    const g2 = await probe(lab, { ...req, backend: 'gpu', settings: flagship });
    const c2 = await probe(lab, { ...req, backend: 'cpu', settings: flagship });
    const meanGap = Math.max(...g2.frames[0].mean.map((v, i) => Math.abs(v - c2.frames[0].mean[i])));
    if (meanGap > 3) fail(stage, `with the flagship look the backends' means differ by ${meanGap.toFixed(1)}`);
    if (c2.backend !== 'cpu') fail(stage, 'asked for the CPU backend and did not get it');
    note(stage, `${perPixel.toFixed(2)}/px apart without grain · flagship means within ${meanGap.toFixed(1)} · CPU ${c2.ms.toFixed(0)} ms vs GPU ${g2.ms.toFixed(0)} ms`);
  } catch (err) {
    fail(stage, String(err));
  }
  // And the toggle in the header really swaps the backend.
  const { page } = await openPage();
  try {
    await dropStill(page, BARS);
    await settledStats(page);
    await page.click('.backend-toggle button[data-backend="cpu"]');
    const s = await settledStats(page, { timeout: 30000 });
    const ctx = await page.evaluate(() => {
      const c = document.querySelector('.stage canvas');
      return c.getContext('2d') ? '2d' : 'webgl';
    });
    if (ctx !== '2d') fail(stage, 'switching to CPU did not replace the WebGL canvas');
    if (s.lit < 0.3) fail(stage, `the CPU backend drew a dark frame through the UI (${(s.lit * 100).toFixed(1)}% lit)`);
    note(stage, `header toggle → CPU: ${(s.lit * 100).toFixed(1)}% lit`);
    await page.evaluate(() => localStorage.removeItem('filmbox.backend'));
  } catch (err) {
    fail(stage, `toggle: ${err}`);
  }
  await page.close();
}

/* ================================================================== *
 * 13. Engine masters bypass, and advanced parameters are shown
 * ================================================================== */

{
  const stage = 'masters';
  const { page } = await openPage();
  try {
    await dropStill(page, BARS);
    await settledStats(page);
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const sect = (t) => [...document.querySelectorAll('.group')].find((x) => x.querySelector('.group-title')?.textContent === t);
      const s = sect('Characteristic Curve');
      if (s && !s.classList.contains('open')) s.querySelector('.group-toggle').click();
      await sleep(300);
      const advanced = [...document.querySelectorAll('.param-label')].some((l) => l.textContent === 'Layer crossover');
      const tab = (name) => [...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.trim().startsWith(name));
      const app = document.querySelector('.stage canvas');
      const p = document.createElement('canvas');
      p.width = 96;
      p.height = 66;
      const g = p.getContext('2d', { willReadFrequently: true });
      const grab = () => {
        g.drawImage(app, 0, 0, 96, 66);
        return Array.from(g.getImageData(0, 0, 96, 66).data);
      };
      const settle = async () => {
        let last = grab();
        for (let k = 0; k < 30; k++) {
          await sleep(200);
          const now = grab();
          let d = 0;
          let mean = 0;
          for (let i = 0; i < now.length; i += 4) {
            d += Math.abs(now[i + 1] - last[i + 1]);
            mean += now[i + 1];
          }
          if (d / (now.length / 4) < 6 && mean / (now.length / 4) > 10) return now;
          last = now;
        }
        return last;
      };
      const diff = (a, b) => {
        let d = 0;
        for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        return d / (a.length / 4) / 3;
      };
      const all = await settle();
      const out = { advanced, struck: false, d: {} };
      for (const name of ['Stock', 'Lens', 'Gate']) {
        tab(name).querySelector('input').click();
        const off = await settle();
        if (name === 'Stock') out.struck = tab('Stock').classList.contains('bypassed');
        out.d[name] = diff(all, off);
        tab(name).querySelector('input').click();
        await settle();
      }
      return out;
    });
    if (!r.advanced) fail(stage, 'fine-detail parameters are hidden on a fresh profile — they should be shown by default');
    if (!r.struck) fail(stage, 'a bypassed engine is not marked as such on its tab');
    // The lens on bars is mostly softness and vignetting, so its bypass is the
    // smallest change of the three; the bars are a poor lens test and a fine
    // stock or gate test. A paused still is deterministic — the same film frame
    // every time — so even a small difference here is real, not noise.
    const floor = { Stock: 4, Lens: 1, Gate: 4 };
    for (const [name, d] of Object.entries(r.d)) {
      if (d < floor[name]) fail(stage, `switching the ${name} engine off barely changed the picture (${d.toFixed(1)}/px)`);
    }
    note(stage, `bypassing changes the picture by ${Object.entries(r.d).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ')} /px · advanced shown`);
  } catch (err) {
    fail(stage, String(err));
  }
  await page.close();
}

/* ================================================================== *
 * 14. A deterministic export through the interface
 *
 * The path a user takes: load a clip, choose a PNG sequence, Render. Each
 * output frame has to seek to the moment its film frame was exposed, the
 * file has to be the shape asked for, every frame has to be there, and the
 * processed soundtrack has to come with it.
 * ================================================================== */

{
  const stage = 'export';
  const { page } = await openPage();
  try {
    await page.selectOption('.topbar-actions select', 'news16-1974');
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
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 300000 }),
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
    // 16 mm news film at 24 fps on 29.97 fps television.
    const expected = Math.round(dur * (30000 / 1001));
    if (Math.abs(frames.length - expected) > 1) fail(stage, `${frames.length} frames for ${dur.toFixed(2)} s at 29.97 fps, expected ${expected}`);
    if (Math.abs(w / h - 4 / 3) > 0.01) fail(stage, `the file is ${w}×${h}, not the 1.33 frame the preset asks for`);
    // The fixture has no audio track: the soundtrack is the film's own — the
    // projector and the track's noise — which a silent clip still has.
    if (!files['audio.wav'] || files['audio.wav'].length < 10000) fail(stage, 'no soundtrack in the export');
    if (!files['settings.filmbox.json']) fail(stage, 'the export does not carry its settings');
    // The clip moves, so consecutive frames must differ — unless the export
    // never sought and rendered the same film frame throughout.
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
}

for (const n of main.noise) fail('main page', n);

await browser.close();
server.close();

if (failures.length) {
  console.error('SMOKE TEST FAILED');
  for (const f of failures) console.error('  •', f);
  console.error('\nwhat did pass:');
  for (const r of report) console.error(r);
  process.exit(1);
}

console.log('smoke test passed');
for (const r of report) console.log(r);
