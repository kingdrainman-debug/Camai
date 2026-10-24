/*
 * Headless smoke test.
 *
 * Type-checking cannot catch a shader that fails to compile or a worklet that
 * fails to register, and those are the two ways this app actually breaks. So
 * the built bundle is loaded in Chromium and driven for real:
 *
 *   1. every GLSL program links and the app mounts without a fatal screen
 *   2. a test pattern pushed through the pipeline comes out lit, with contrast,
 *      and with visible horizontal line structure — i.e. the beam pass ran
 *   3. a real video clip reaches the tube — this is the one that matters most,
 *      because uploading a <video> through texSubImage2D silently writes
 *      nothing while every API call reports success, which once shipped a build
 *      where stills worked perfectly and video was a black screen
 *   4. the DSP worklet registers both processors, passes audio through the
 *      transport, and generates a non-silent noise bed
 *   5. keyframing works through the real UI — arming a parameter, writing a
 *      second key, and confirming the rendered output actually changes between
 *      them and interpolates in the middle
 *
 *   node scripts/smoke.mjs
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');

const MIME = {
  '.webm': 'video/webm',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const fixtures = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'tests', 'fixtures');

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

const failures = [];
// Use an explicit binary when one is provided or present, otherwise let
// playwright resolve the browser it installed. Keeps this runnable both in the
// dev container and on a CI runner.
const explicitChromium = process.env.CRTBOX_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(existsSync(explicitChromium) ? { executablePath: explicitChromium } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    // The packaged app loads its bundle over file://, where a module script is
    // a cross-origin request unless this is set. Electron permits it by default;
    // Chromium does not, so stage 8 needs it to reproduce the shipped condition.
    '--allow-file-access-from-files',
  ],
});

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' && !/favicon/.test(text) && !/status of 404/.test(text)) {
    failures.push(`console: ${text}`);
  }
});
page.on('response', (res) => {
  if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) {
    failures.push(`http ${res.status()}: ${res.url()}`);
  }
});

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

/* -------- 1. the app mounted and every shader linked -------- */

if (await page.locator('.fatal').count()) {
  failures.push(`fatal: ${await page.locator('.fatal p').innerText()}`);
}

const gl = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { ok: false, error: 'no canvas in the document' };
  const ctx = canvas.getContext('webgl2');
  return ctx
    ? { ok: true, version: ctx.getParameter(ctx.VERSION) }
    : { ok: false, error: 'no webgl2 context' };
});
if (!gl.ok) failures.push(`gl: ${gl.error}`);

/* -------- 2. drive a test pattern through the whole pipeline -------- */

const picture = await page.evaluate(async () => {
  const out = { lit: 0, contrast: 0, lineStructure: 0, lineSamples: 0, error: null };
  try {
    // Colour bars over a black pedestal with a white block: enough for the
    // mask, the beam profile and the halation pass to all have something to
    // bite on.
    const src = document.createElement('canvas');
    src.width = 640;
    src.height = 480;
    const ctx = src.getContext('2d');
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect((i * src.width) / bars.length, 0, src.width / bars.length + 1, 360);
    });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 360, src.width, 120);
    ctx.fillStyle = '#fff';
    ctx.fillRect(40, 385, 160, 70);

    const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
    const file = new File([blob], 'pattern.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));

    await new Promise((resolve, reject) => {
      const t0 = performance.now();
      const poll = () => {
        const img = document.querySelector('img');
        if (img && img.naturalWidth > 0) resolve();
        else if (performance.now() - t0 > 10000) reject(new Error('image never decoded'));
        else setTimeout(poll, 60);
      };
      poll();
    });
    // Several frames, so the persistence and burn-in feedback buffers fill.
    await new Promise((r) => setTimeout(r, 900));

    const app = document.querySelector('canvas');
    const probe = document.createElement('canvas');
    probe.width = app.width;
    probe.height = app.height;
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(app, 0, 0);
    const { data } = p.getImageData(0, 0, probe.width, probe.height);

    let lit = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (l > 24) lit++;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    out.lit = lit / (probe.width * probe.height);
    out.contrast = (max - min) / 255;

    // Scanlines: a vertical run through a *lit* part of the picture must
    // alternate light and dark. Black areas stay black whatever the beam does,
    // so they are excluded rather than diluting the measurement.
    let deltas = 0;
    let samples = 0;
    for (let x = 8; x < probe.width - 8; x += 7) {
      for (let y = 8; y < probe.height - 9; y++) {
        const a = data[(y * probe.width + x) * 4 + 1];
        const b = data[((y + 1) * probe.width + x) * 4 + 1];
        if (a < 40 && b < 40) continue;
        deltas += Math.abs(a - b);
        samples++;
      }
    }
    out.lineStructure = samples ? deltas / samples / 255 : 0;
    out.lineSamples = samples;
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
});

if (picture.error) failures.push(`picture: ${picture.error}`);
if (picture.lit < 0.15) {
  failures.push(`picture: only ${(picture.lit * 100).toFixed(1)}% of the canvas is lit`);
}
if (picture.contrast < 0.4) {
  failures.push(`picture: contrast is only ${picture.contrast.toFixed(2)}`);
}
if (picture.lineStructure < 0.01) {
  failures.push(
    `picture: no horizontal line structure (${picture.lineStructure.toFixed(4)}) — the beam pass did not run`,
  );
}

/* -------- 3. a real video clip reaches the tube -------- */

const videoResult = await page.evaluate(async () => {
  const out = { presented: 0, lit: 0, error: null };
  try {
    const blob = await (await fetch('/fixture.webm')).blob();
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'motion.webm', { type: 'video/webm' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));

    const video = await new Promise((resolve, reject) => {
      const t0 = performance.now();
      const poll = () => {
        const v = document.querySelector('video');
        if (v && v.readyState >= 2 && v.videoWidth > 0) resolve(v);
        else if (performance.now() - t0 > 20000) reject(new Error('video never decoded'));
        else setTimeout(poll, 80);
      };
      poll();
    });

    document.querySelector('.transport .play')?.click();
    await new Promise((r) => setTimeout(r, 2500));

    // Is the element handing out frames at all?
    const vp = document.createElement('canvas');
    vp.width = 48; vp.height = 36;
    const vg = vp.getContext('2d', { willReadFrequently: true });
    vg.drawImage(video, 0, 0, 48, 36);
    const vd = vg.getImageData(0, 0, 48, 36).data;
    for (let i = 0; i < vd.length; i += 4) {
      out.presented = Math.max(out.presented, (vd[i] + vd[i + 1] + vd[i + 2]) / 3);
    }

    // And did those frames make it through the pipeline onto the tube?
    const app = document.querySelector('canvas');
    const probe = document.createElement('canvas');
    probe.width = app.width; probe.height = app.height;
    const p = probe.getContext('2d', { willReadFrequently: true });
    p.drawImage(app, 0, 0);
    const { data } = p.getImageData(0, 0, probe.width, probe.height);
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 > 24) lit++;
    }
    out.lit = lit / (probe.width * probe.height);
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
});

if (videoResult.error) failures.push(`video: ${videoResult.error}`);
if (videoResult.presented < 6) {
  failures.push(`video: the element presented no frame (max ${videoResult.presented.toFixed(1)})`);
}
if (videoResult.lit < 0.10) {
  failures.push(
    `video: frames exist but the tube is black (${(videoResult.lit * 100).toFixed(1)}% lit) — the source texture upload is broken`,
  );
}

/* -------- 4. the DSP worklet -------- */

const audio = await page.evaluate(async (workletUrl) => {
  const out = { registered: false, transportRms: 0, noiseRms: 0, error: null };
  try {
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, sr, sr);
    await ctx.audioWorklet.addModule(workletUrl);
    out.registered = true;

    const params = {
      'transport.enabled': true,
      'transport.wowDepth': 0.4,
      'transport.flutterDepth': 0.2,
      'transport.dropoutRate': 0,
      'noise.enabled': true,
      'noise.flybackLevel': -20,
      'noise.flybackSqueal': 0.4,
      'noise.rumble': 0.4,
      'crackle.enabled': false,
      'link.enabled': false,
    };

    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const transport = new AudioWorkletNode(ctx, 'crt-transport', {
      outputChannelCount: [2],
      processorOptions: { params, seed: 3 },
    });
    const noise = new AudioWorkletNode(ctx, 'crt-noise', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { params, seed: 4, bus: 'acoustic' },
    });
    // Transport on the left, noise bed on the right, so both can be measured
    // from one render.
    const merger = ctx.createChannelMerger(2);
    osc.connect(transport);
    transport.connect(merger, 0, 0);
    noise.connect(merger, 0, 1);
    merger.connect(ctx.destination);
    osc.start();

    const rendered = await ctx.startRendering();
    const rms = (ch) => {
      const d = rendered.getChannelData(ch);
      // Skip past the transport's base delay before measuring.
      const from = Math.floor(sr * 0.2);
      let sum = 0;
      for (let i = from; i < d.length; i++) sum += d[i] * d[i];
      return Math.sqrt(sum / (d.length - from));
    };
    out.transportRms = rms(0);
    out.noiseRms = rms(1);
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}, `http://127.0.0.1:${port}/worklets/crtbox-dsp.js`);

if (audio.error) failures.push(`audio: ${audio.error}`);
if (!audio.registered) failures.push('audio: the worklet module did not register');
if (audio.transportRms < 0.05) {
  failures.push(`audio: the transport passed no signal (rms ${audio.transportRms.toExponential(2)})`);
}
if (audio.noiseRms < 1e-4) {
  failures.push(`audio: the noise bed is silent (rms ${audio.noiseRms.toExponential(2)})`);
}

/* -------- 5. keyframing animates the render -------- */

const keys = await page.evaluate(async () => {
  const out = { armed: '', keyframes: 0, diamonds: 0, sat: [], error: null };
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // React-controlled inputs need the native setter plus a real event.
    const setInput = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // A saturated still makes signal loss (which fades to grey snow) easy to measure.
    const src = document.createElement('canvas');
    src.width = 320; src.height = 240;
    const g = src.getContext('2d');
    const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    bars.forEach((c, i) => { g.fillStyle = c; g.fillRect((i * 320) / 7, 0, 320 / 7 + 1, 240); });
    const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'still.png', { type: 'image/png' }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    await sleep(900);

    // The sidebar now has two engines; these assertions are about the tube, so
    // select that tab rather than relying on which one opens by default.
    const selectTab = async (name) => {
      document.querySelector('.guide-close')?.click();
      await sleep(250);
      [...document.querySelectorAll('.tabs button')]
        .find((b) => b.textContent.trim() === name)
        ?.click();
      await sleep(350);
    };
    await selectTab('Tube');

    const row = [...document.querySelectorAll('.param')].find(
      (r) => r.querySelector('.param-label')?.textContent === 'Signal loss',
    );
    if (!row) throw new Error('could not find the Signal loss parameter');

    row.querySelector('.stopwatch').click();
    await sleep(250);
    out.armed = document.querySelector('.timeline-toggle .count')?.textContent ?? '';

    const scrub = document.querySelector('input.scrub');
    const slider = row.querySelector("input[type='range']");
    setInput(scrub, 4);
    await sleep(250);
    setInput(slider, 1);
    await sleep(250);

    out.diamonds = document.querySelectorAll('.track .key').length;
    out.keyframes = out.diamonds;

    const app = document.querySelector('canvas');
    const probe = document.createElement('canvas');
    probe.width = 110; probe.height = 82;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    for (const t of [0, 2, 4]) {
      setInput(scrub, t);
      await sleep(650);
      pg.drawImage(app, 0, 0, probe.width, probe.height);
      const d = pg.getImageData(0, 0, probe.width, probe.height).data;
      let sat = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]);
        const mn = Math.min(d[i], d[i + 1], d[i + 2]);
        if (mx > 20) { sat += (mx - mn) / mx; n++; }
      }
      out.sat.push(n ? sat / n : 0);
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
});

if (keys.error) failures.push(`keyframes: ${keys.error}`);
if (keys.diamonds !== 2) {
  failures.push(`keyframes: expected 2 keyframe markers, drew ${keys.diamonds}`);
}
if (keys.sat.length === 3) {
  const [a, mid, b] = keys.sat;
  if (a - b < 0.15) {
    failures.push(
      `keyframes: the animated parameter did not change the render (saturation ${a.toFixed(3)} -> ${b.toFixed(3)})`,
    );
  }
  // Midway must land between the ends, or it is stepping rather than easing.
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (mid < lo - 0.02 || mid > hi + 0.02) {
    failures.push(`keyframes: midpoint ${mid.toFixed(3)} is not between ${a.toFixed(3)} and ${b.toFixed(3)}`);
  }
} else {
  failures.push('keyframes: could not sample the animation');
}

/*
 * Stages 6 and 7 get a fresh page. Stage 5 leaves a parameter animated, and an
 * animated parameter is driven by the timeline rather than by its slider — so
 * anything that tried to set up a clean state on the same page would be
 * silently overridden and the assertions would be meaningless.
 */
const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page2.on('pageerror', (err) => failures.push(`page2 error: ${err.message}`));
await page2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page2.waitForTimeout(1200);

/* -------- 6. the output frame is the shape of the tube -------- */

/*
 * The export used to take the source dimensions and multiply by a scale factor,
 * while the tube pass pillarboxes the raster inside whatever frame it is given.
 * Choosing 4:3 on a 16:9 source therefore produced a 16:9 file with the picture
 * floating in the middle of it — the setting changed the picture and never the
 * file. Both the preview canvas and the computed export size now come from one
 * function, so this asserts the canvas actually follows the setting.
 */

const framing = await page2.evaluate(async () => {
  const out = { ratios: {}, error: null };
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The sidebar now has two engines; these assertions are about the tube, so
    // select that tab rather than relying on which one opens by default.
    const selectTab = async (name) => {
      document.querySelector('.guide-close')?.click();
      await sleep(250);
      [...document.querySelectorAll('.tabs button')]
        .find((b) => b.textContent.trim() === name)
        ?.click();
      await sleep(350);
    };
    await selectTab('Tube');
    const openGroup = (title) => {
      const toggle = [...document.querySelectorAll('.group')].find(
        (s) => s.querySelector('.group-title')?.textContent === title,
      );
      if (!toggle) throw new Error(`no group called ${title}`);
      if (!toggle.classList.contains('open')) toggle.querySelector('.group-toggle').click();
    };

    openGroup('Tube Geometry');
    await sleep(300);

    const row = [...document.querySelectorAll('.param')].find(
      (r) => r.querySelector('.param-label')?.textContent === 'Aspect',
    );
    if (!row) throw new Error('could not find the Aspect parameter');
    const select = row.querySelector('select');

    for (const value of ['4:3', '16:9']) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(500);
      const c = document.querySelector('.stage canvas');
      out.ratios[value] = c.width / c.height;
    }
  } catch (err) {
    out.error = String(err);
  }
  return out;
});

if (framing.error) {
  failures.push(`framing: ${framing.error}`);
} else {
  for (const [label, want] of [['4:3', 4 / 3], ['16:9', 16 / 9]]) {
    const got = framing.ratios[label];
    if (!got || Math.abs(got - want) > 0.03) {
      failures.push(
        `framing: with aspect ${label} the frame is ${got?.toFixed(3)}, expected ${want.toFixed(3)} — the export would carry baked-in bars`,
      );
    }
  }
}

/* -------- 7. persistence survives frame-stepped rendering -------- */

/*
 * The <video> element reset the phosphor buffers on `seeking`, which is right
 * for a user scrubbing and catastrophic for an export: stepping frame by frame
 * seeks every frame, so the trails were wiped before each one and no rendered
 * video ever had them.
 *
 * Measured by loading a lit still, swapping it for black, and checking the
 * screen is still glowing immediately afterwards.
 */

const trails = await page2.evaluate(async () => {
  const out = { bright: 0, afterDark: 0, settled: 0, error: null };
  try {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const setInput = (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const openGroup = (title) => {
      const s = [...document.querySelectorAll('.group')].find(
        (g) => g.querySelector('.group-title')?.textContent === title,
      );
      if (s && !s.classList.contains('open')) s.querySelector('.group-toggle').click();
    };
    const setParam = (label, v) => {
      const row = [...document.querySelectorAll('.param')].find(
        (r) => r.querySelector('.param-label')?.textContent === label,
      );
      if (!row) return false;
      const slider = row.querySelector("input[type='range']");
      if (!slider) return false;
      setInput(slider, v);
      return true;
    };

    const drop = async (paint, name) => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      paint(c.getContext('2d'));
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    };

    // A white field, so the only thing that can be lit afterwards is phosphor.
    await drop((g) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 320, 240);
    }, 'white.png');
    await sleep(1000);

    // The sidebar now has two engines; these assertions are about the tube, so
    // select that tab rather than relying on which one opens by default.
    const selectTab = async (name) => {
      document.querySelector('.guide-close')?.click();
      await sleep(250);
      [...document.querySelectorAll('.tabs button')]
        .find((b) => b.textContent.trim() === name)
        ?.click();
      await sleep(350);
    };
    await selectTab('Tube');

    // Long persistence; everything else that could light the screen on its own
    // goes to zero so the measurement is unambiguous.
    openGroup('Phosphor & Mask');
    openGroup('Signal & Reception');
    openGroup('Faults & Wear');
    openGroup('Output');
    await sleep(350);
    const missing = [];
    for (const [label, v] of [
      ['Persistence', 0.95],
      ['Snow', 0],
      ['Signal loss', 0],
      ['Dust & smears', 0],
      ['Ambient light', 0],
    ]) {
      if (!setParam(label, v)) missing.push(label);
    }
    if (missing.length) throw new Error(`could not set ${missing.join(', ')}`);
    await sleep(700);


    const app = document.querySelector('.stage canvas');
    const probe = document.createElement('canvas');
    probe.width = 96;
    probe.height = 72;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    const meanLuma = () => {
      pg.drawImage(app, 0, 0, probe.width, probe.height);
      const d = pg.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return sum / (d.length / 4);
    };

    for (let i = 0; i < 40 && meanLuma() < 20; i++) await sleep(250);
    out.bright = meanLuma();

    // Drive the picture to black by closing the video amplifier down rather
    // than by loading a black frame: swapping media legitimately clears the
    // phosphor, so that would measure the reset and not the decay.
    if (!setParam('Contrast', 0)) throw new Error('could not set Contrast');
    if (!setParam('Brightness', -0.5)) throw new Error('could not set Brightness');

    // Immediately after the picture goes black the phosphor must still be lit.
    await sleep(150);
    out.afterDark = meanLuma();
    await sleep(3000);
    out.settled = meanLuma();
  } catch (err) {
    out.error = String(err);
  }
  return out;
});

if (trails.error) {
  failures.push(`trails: ${trails.error}`);
} else if (trails.bright < 8) {
  failures.push(
    `trails: the reference frame was not lit (${trails.bright.toFixed(1)}), so decay cannot be measured`,
  );
} else if (trails.afterDark <= trails.settled + 1) {
  failures.push(
    `trails: no afterglow — ${trails.afterDark.toFixed(1)} just after the picture went black vs ${trails.settled.toFixed(1)} once settled. The phosphor buffer is being cleared.`,
  );
}

/* -------- 8. the app runs the way the packaged build loads it -------- */

/*
 * Everything above is served over HTTP, which is how the dev server and the web
 * build work — and is exactly why a file://-only defect shipped to Windows
 * without anything failing. The desktop app calls loadFile(), so the bundle,
 * the worklet and the media all arrive over file://. This stage loads the built
 * output that way and asserts the app still mounts and lights the tube.
 */

const packaged = { url: pathToFileURL(join(root, 'index.html')).href, mounted: 0, lit: 0, error: null };
{
  const page3 = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const noise = [];
  page3.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));
  page3.on('console', (msg) => {
    const text = msg.text();
    if (
      msg.type() === 'error' &&
      !/favicon/.test(text) &&
      !/status of 404/.test(text) &&
      !/Automatic fallback to software WebGL/.test(text)
    ) {
      noise.push(`console: ${text}`);
    }
  });

  try {
    await page3.goto(packaged.url, { waitUntil: 'load' });
    await page3.waitForTimeout(2500);
    const probe = await page3.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Drop a lit still in so the tube has something to show.
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const g = c.getContext('2d');
      g.fillStyle = '#d8d8d8';
      g.fillRect(0, 0, 320, 240);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'still.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));

      // Poll rather than sleep a fixed time. Over file:// the decode and the
      // first rAF-driven upload land later than over HTTP, and how much later
      // depends on how loaded the machine is — a fixed wait here is a flaky
      // test, which is worse than no test.
      const p = document.createElement('canvas');
      p.width = 80;
      p.height = 60;
      const pg = p.getContext('2d', { willReadFrequently: true });
      const litFraction = () => {
        const app = document.querySelector('.stage canvas');
        if (!app || app.width < 2) return 0;
        pg.drawImage(app, 0, 0, p.width, p.height);
        const d = pg.getImageData(0, 0, p.width, p.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) {
          if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 24) lit++;
        }
        return lit / (p.width * p.height);
      };

      let lit = 0;
      for (let i = 0; i < 40 && lit < 0.1; i++) {
        await sleep(250);
        lit = litFraction();
      }

      return {
        mounted: (document.getElementById('root')?.innerHTML || '').length,
        lit,
      };
    });
    packaged.mounted = probe.mounted;
    packaged.lit = probe.lit;
  } catch (err) {
    packaged.error = String(err);
  }
  await page3.close();

  if (packaged.error) {
    failures.push(`packaged: ${packaged.error}`);
  } else {
    if (packaged.mounted < 500) {
      failures.push(
        `packaged: the app did not mount over file:// (root is ${packaged.mounted} chars) — the desktop build would open to an empty window`,
      );
    }
    if (packaged.lit < 0.1) {
      failures.push(
        `packaged: mounted over file:// but the tube is black (${(packaged.lit * 100).toFixed(1)}% lit)`,
      );
    }
    for (const n of noise) failures.push(`packaged ${n}`);
  }
}

/* -------- 9. the colour and glitch sections are actually wired -------- */

/*
 * A new parameter group is easy to add to the schema and easy to forget to
 * plumb into the shader, and the failure is silent: the control moves, the
 * uniform is never set, nothing happens. So this drives the real controls and
 * asserts the picture responds.
 *
 * Glitching is compared off-versus-on at one instant rather than frame to
 * frame. Its event clock runs on transport time, which does not advance on a
 * paused still, so a perfectly working tear can be completely static — a
 * frame-to-frame diff would call that a failure.
 */

const sections = await (async () => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  const out = await p.evaluate(async () => {
    const res = { satFull: 0, satZero: 0, warmRB: 0, coldRB: 0, glitchOnVsOff: 0, error: null };
    try {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const setInput = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const sect = (t) =>
        [...document.querySelectorAll('.group')].find(
          (g) => g.querySelector('.group-title')?.textContent === t,
        );
      const open = (t) => {
        const s = sect(t);
        if (s && !s.classList.contains('open')) s.querySelector('.group-toggle').click();
      };
      const enable = (t, v) => {
        const c = sect(t)?.querySelector(".group-actions input[type='checkbox']");
        if (!c) throw new Error(`no enable switch on ${t}`);
        if (c.checked !== v) c.click();
      };
      const setP = (label, v) => {
        const row = [...document.querySelectorAll('.param')].find(
          (r) => r.querySelector('.param-label')?.textContent === label,
        );
        const slider = row?.querySelector("input[type='range']");
        if (!slider) throw new Error(`no slider for ${label}`);
        setInput(slider, v);
      };
      const selectTab = async (name) => {
        document.querySelector('.guide-close')?.click();
        await sleep(250);
        [...document.querySelectorAll('.tabs button')]
          .find((b) => b.textContent.trim() === name)
          ?.click();
        await sleep(350);
      };

      const src = document.createElement('canvas');
      src.width = 320;
      src.height = 240;
      const g = src.getContext('2d');
      ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach(
        (c, i) => {
          g.fillStyle = c;
          g.fillRect((i * 320) / 7, 0, 320 / 7 + 1, 240);
        },
      );
      const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'bars.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));

      const app = document.querySelector('.stage canvas');
      const probe = document.createElement('canvas');
      probe.width = 160;
      probe.height = 120;
      const pg = probe.getContext('2d', { willReadFrequently: true });
      const pixels = () => {
        pg.drawImage(app, 0, 0, probe.width, probe.height);
        return pg.getImageData(0, 0, probe.width, probe.height).data;
      };
      const measure = () => {
        const d = pixels();
        let sat = 0;
        let n = 0;
        let rb = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mx > 18) {
            sat += (mx - mn) / mx;
            n++;
          }
          rb += d[i + 2] - d[i];
        }
        return { sat: n ? sat / n : 0, rb: rb / (d.length / 4) };
      };

      await selectTab('Tube');
      open('Colour');
      // The poll below can exit without ever sleeping when the picture is
      // already drawn, so the group has to be given a chance to render first or
      // every lookup after this runs against the previous DOM.
      await sleep(400);

      // Poll for the picture rather than assuming a fixed decode time; a fixed
      // wait here turns a passing test into an occasionally-failing one.
      for (let i = 0; i < 40 && measure().sat < 0.2; i++) await sleep(250);

      res.satFull = measure().sat;
      setP('Saturation', 0);
      await sleep(600);
      res.satZero = measure().sat;
      setP('Saturation', 1);
      await sleep(400);

      setP('Temperature', -1);
      await sleep(600);
      res.warmRB = measure().rb;
      setP('Temperature', 1);
      await sleep(600);
      res.coldRB = measure().rb;
      setP('Temperature', 0);
      await sleep(400);

      // Freeze everything that moves on its own, so the only difference between
      // the two captures is the glitch section.
      enable('Sync & Timebase', false);
      enable('Faults & Wear', false);
      open('Signal & Reception');
      await sleep(300);
      for (const [l, v] of [['Snow', 0], ['Signal loss', 0], ['Interference', 0]]) setP(l, v);
      await sleep(600);

      const off = pixels();
      enable('Glitching', true);
      open('Glitching');
      await sleep(350);
      for (const [l, v] of [
        ['Event rate', 1],
        ['Tape dropout', 1],
        ['Line repeat', 1],
        ['Sync slip', 1],
        ['Chroma burst', 1],
        ['Polarity flip', 1],
      ]) {
        setP(l, v);
      }
      await sleep(900);
      const on = pixels();
      let sum = 0;
      for (let i = 0; i < off.length; i += 4) {
        sum += Math.abs(off[i] - on[i]) + Math.abs(off[i + 1] - on[i + 1]) + Math.abs(off[i + 2] - on[i + 2]);
      }
      res.glitchOnVsOff = sum / (off.length / 4);
    } catch (err) {
      res.error = String(err);
    }
    return res;
  });
  await p.close();
  return out;
})();

if (sections.error) {
  failures.push(`sections: ${sections.error}`);
} else {
  if (sections.satFull < 0.2) {
    failures.push(`colour: the reference frame is not saturated (${sections.satFull.toFixed(3)})`);
  } else if (sections.satZero > 0.05) {
    failures.push(
      `colour: Saturation 0 left ${sections.satZero.toFixed(3)} saturation — the control is not reaching the shader`,
    );
  }
  if (sections.coldRB - sections.warmRB < 10) {
    failures.push(
      `colour: Temperature barely moved blue-minus-red (warm ${sections.warmRB.toFixed(1)} vs cold ${sections.coldRB.toFixed(1)})`,
    );
  }
  if (sections.glitchOnVsOff < 8) {
    failures.push(
      `glitch: turning the section on changed the picture by only ${sections.glitchOnVsOff.toFixed(1)} per pixel — it is not wired up`,
    );
  }
}

/* -------- 10. the guide and the information widgets -------- */

/*
 * The guide is the first thing a new user sees, so a regression that leaves it
 * stuck open, impossible to close, or never shown at all is a bad one. This
 * drives the whole lifecycle through the real controls: shown on first run,
 * closes, reopens from the header, remembers "don't show" across a reload, and
 * F1 brings it back.
 *
 * Then it opens a parameter's ⓘ and a section's ⓘ and asserts real text
 * appears, which is the half that check-help.mjs cannot see — the data can be
 * complete while the widget fails to render it.
 */

const guide = await (async () => {
  const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const out = {
    shownOnStart: false,
    closed: false,
    reopened: false,
    hiddenAfterReload: false,
    f1Reopened: false,
    tubes: 0,
    paramInfo: '',
    sectionInfo: '',
    error: null,
  };
  try {
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForTimeout(1500);

    out.shownOnStart = (await p.$('.guide')) !== null;

    // Close with the × and confirm it is gone.
    await p.evaluate(() => document.querySelector('.guide-close')?.click());
    await p.waitForTimeout(400);
    out.closed = (await p.$('.guide')) === null;

    // Reopen from the header.
    await p.evaluate(() =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === 'Guide')?.click(),
    );
    await p.waitForTimeout(400);
    out.reopened = (await p.$('.guide')) !== null;

    // Count the reference tubes offered.
    out.tubes = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      [...document.querySelectorAll('.guide-tabs button')]
        .find((b) => b.textContent.includes('Reference'))
        ?.click();
      await sleep(250);
      return document.querySelectorAll('.guide-tube').length;
    });

    // Tick "don't show", close, reload: it must stay shut.
    await p.evaluate(() => {
      const box = document.querySelector('.guide-foot .check input');
      if (box && !box.checked) box.click();
    });
    await p.waitForTimeout(250);
    await p.evaluate(() => document.querySelector('.guide-close')?.click());
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1500);
    out.hiddenAfterReload = (await p.$('.guide')) === null;

    // F1 brings it back, and closes it again.
    await p.keyboard.press('F1');
    await p.waitForTimeout(400);
    out.f1Reopened = (await p.$('.guide')) !== null;
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);

    // Information widgets.
    const info = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const sect = (t) =>
        [...document.querySelectorAll('.group')].find(
          (g) => g.querySelector('.group-title')?.textContent === t,
        );
      [...document.querySelectorAll('.tabs button')]
        .find((b) => b.textContent.trim() === 'Tube')
        ?.click();
      await sleep(400);
      const beam = sect('Beam & Scanlines');
      if (!beam) throw new Error('no Beam & Scanlines section');
      beam.querySelector('.group-info-btn').click();
      if (!beam.classList.contains('open')) beam.querySelector('.group-toggle').click();
      await sleep(400);

      const row = [...document.querySelectorAll('.param')].find(
        (r) => r.querySelector('.param-label')?.textContent === 'Beam blooming',
      );
      if (!row) throw new Error('no Beam blooming parameter');
      row.querySelector('.param-info-btn').click();
      await sleep(400);

      return {
        section: document.querySelector('.group-info')?.textContent?.trim() ?? '',
        param: row.querySelector('.param-info')?.textContent?.trim() ?? '',
      };
    });
    out.sectionInfo = info.section;
    out.paramInfo = info.param;
  } catch (err) {
    out.error = String(err);
  }
  await p.close();
  return out;
})();

if (guide.error) {
  failures.push(`guide: ${guide.error}`);
} else {
  if (!guide.shownOnStart) failures.push('guide: not shown on first run');
  if (!guide.closed) failures.push('guide: the close button did not close it');
  if (!guide.reopened) failures.push('guide: the header button did not reopen it');
  if (guide.tubes < 5) {
    failures.push(`guide: only ${guide.tubes} reference tubes listed, expected all of them`);
  }
  if (!guide.hiddenAfterReload) {
    failures.push('guide: "don\'t show on startup" did not survive a reload');
  }
  if (!guide.f1Reopened) failures.push('guide: F1 did not reopen it');
  if (guide.paramInfo.length < 80) {
    failures.push(
      `guide: a parameter's ⓘ revealed only ${guide.paramInfo.length} characters — the widget is not showing its help`,
    );
  }
  if (guide.sectionInfo.length < 150) {
    failures.push(
      `guide: a section's ⓘ revealed only ${guide.sectionInfo.length} characters`,
    );
  }
}

/* -------- 11. the tape engine -------- */

/*
 * The second emulator: composite encode and decode, and the videotape. Almost
 * nothing in it is drawn on, so the assertions here are about emergent
 * behaviour rather than about pixels being different.
 *
 *   - Cross-colour: a pure greyscale stripe pattern must come back coloured,
 *     because fine luma detail lands in the chroma band. Box demodulation must
 *     leave substantially more of it than a 2-line comb, which is the entire
 *     reason those filters existed.
 *   - Dot crawl must actually crawl: with a 180 degree scanline phase shift the
 *     pattern inverts frame to frame, and at 0 degrees it stands still.
 *
 * The crawl measurement is taken 1:1 on a crop. The subcarrier runs at 227.5
 * cycles across a line, so downsampling the frame aliases the pattern away and
 * a whole-frame comparison shows nothing whether it works or not.
 */

const tapeEngine = await (async () => {
  const p = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const out = { rainbowBox: 0, rainbowComb: 0, combVsBox: 0, crawlMoves: 0, staticPhase: 0, spVsEp: 0, tabs: [], error: null };
  try {
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const setInput = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      document.querySelector('.guide-close')?.click();
      await sleep(400);
      const tabs = [...document.querySelectorAll('.tabs button')].map((b) => b.textContent.trim());

      // Colour bars over fine single-pixel greyscale stripes: the pattern that
      // provokes cross-colour hardest.
      const c = document.createElement('canvas');
      c.width = 384;
      c.height = 288;
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, 384, 288);
      ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff'].forEach((col, i) => {
        g.fillStyle = col;
        g.fillRect((i * 384) / 7, 0, 384 / 7 + 1, 180);
      });
      g.fillStyle = '#fff';
      for (let x = 0; x < 384; x += 3) g.fillRect(x, 190, 1, 98);
      const blob = await new Promise((x) => c.toBlob(x, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'bars.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      await sleep(1800);

      const app = document.querySelector('.stage canvas');
      const probe = document.createElement('canvas');
      probe.width = 240;
      probe.height = 180;
      const pg = probe.getContext('2d', { willReadFrequently: true });
      const grab = () => {
        pg.drawImage(app, 0, 0, probe.width, probe.height);
        return pg.getImageData(0, 0, probe.width, probe.height).data;
      };
      const stripeSat = () => {
        const d = grab();
        let sat = 0;
        let n = 0;
        for (let y = Math.floor(probe.height * 0.68); y < Math.floor(probe.height * 0.95); y++) {
          for (let x = 20; x < probe.width - 20; x++) {
            const i = (y * probe.width + x) * 4;
            const mx = Math.max(d[i], d[i + 1], d[i + 2]);
            const mn = Math.min(d[i], d[i + 1], d[i + 2]);
            if (mx > 26) {
              sat += (mx - mn) / mx;
              n++;
            }
          }
        }
        return n ? sat / n : 0;
      };
      const diff = (a, b) => {
        let s = 0;
        for (let i = 0; i < a.length; i += 4) {
          s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        }
        return s / (a.length / 4);
      };

      const sect = (t) =>
        [...document.querySelectorAll('.group')].find((x) => x.querySelector('.group-title')?.textContent === t);
      const enable = (t, v) => {
        const cb = sect(t)?.querySelector(".group-actions input[type='checkbox']");
        if (cb && cb.checked !== v) cb.click();
      };
      const open = (t) => {
        const x = sect(t);
        if (x && !x.classList.contains('open')) x.querySelector('.group-toggle').click();
      };
      const tab = (name) =>
        [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === name)?.click();
      const setP = (l, v) => {
        const row = [...document.querySelectorAll('.param')].find(
          (r) => r.querySelector('.param-label')?.textContent === l,
        );
        const sl = row?.querySelector("input[type='range']");
        if (sl) setInput(sl, v);
      };
      const setSel = (l, v) => {
        const row = [...document.querySelectorAll('.param')].find(
          (r) => r.querySelector('.param-label')?.textContent === l,
        );
        const se = row?.querySelector('select');
        if (!se) throw new Error(`no control for ${l}`);
        se.value = v;
        se.dispatchEvent(new Event('change', { bubbles: true }));
      };

      // Silence the tube so what is measured is the tape engine alone.
      tab('Tube');
      await sleep(300);
      for (const t of [
        'Signal & Reception', 'Sync & Timebase', 'Faults & Wear', 'Phosphor & Mask',
        'Halation & Bloom', 'Convergence & Focus', 'Beam & Scanlines', 'Tube Geometry',
      ]) {
        enable(t, false);
      }
      await sleep(500);

      tab('Tape');
      await sleep(350);
      open('Composite Signal');
      open('Signal Noise');
      open('VHS Tape');
      await sleep(350);
      for (const l of ['Composite noise', 'Luma noise', 'Chroma noise', 'Chroma phase noise']) setP(l, 0);
      await sleep(600);

      const res = {};
      setSel('Chroma demodulation', 'box');
      await sleep(800);
      res.rainbowBox = stripeSat();
      const boxFrame = grab();
      setSel('Chroma demodulation', 'twoline');
      await sleep(800);
      res.rainbowComb = stripeSat();
      res.combVsBox = diff(boxFrame, grab());

      const crop = document.createElement('canvas');
      crop.width = 200;
      crop.height = 60;
      const cg = crop.getContext('2d', { willReadFrequently: true });
      const grabCrop = () => {
        cg.drawImage(app, Math.floor(app.width * 0.3), Math.floor(app.height * 0.25), 200, 60, 0, 0, 200, 60);
        return cg.getImageData(0, 0, 200, 60).data;
      };
      setSel('Chroma demodulation', 'box');
      setSel('Scanline phase shift', '180');
      await sleep(900);
      const f1 = grabCrop();
      await sleep(300);
      const f2 = grabCrop();
      await sleep(300);
      const f3 = grabCrop();
      res.crawlMoves = Math.max(diff(f1, f2), diff(f2, f3), diff(f1, f3));

      setSel('Scanline phase shift', '0');
      await sleep(900);
      const s1 = grabCrop();
      await sleep(300);
      const s2 = grabCrop();
      await sleep(300);
      const s3 = grabCrop();
      res.staticPhase = Math.max(diff(s1, s2), diff(s2, s3), diff(s1, s3));

      setSel('Tape speed', 'sp');
      await sleep(800);
      const sp = grab();
      setSel('Tape speed', 'ep');
      await sleep(800);
      res.spVsEp = diff(sp, grab());

      return { ...res, tabs };
    });
    Object.assign(out, r);
  } catch (err) {
    out.error = String(err);
  }
  await p.close();
  return out;
})();

if (tapeEngine.error) {
  failures.push(`tape: ${tapeEngine.error}`);
} else {
  const want = ['Tape', 'Tube', 'Sound', 'A/V Link'];
  if (tapeEngine.tabs.join(',') !== want.join(',')) {
    failures.push(`tape: tabs are ${tapeEngine.tabs.join(', ')}, expected ${want.join(', ')}`);
  }
  if (tapeEngine.rainbowBox < 0.12) {
    failures.push(
      `tape: greyscale stripes came back only ${tapeEngine.rainbowBox.toFixed(3)} saturated — cross-colour is not emerging from the encode/decode`,
    );
  }
  if (tapeEngine.rainbowBox < tapeEngine.rainbowComb * 1.5) {
    failures.push(
      `tape: box demodulation (${tapeEngine.rainbowBox.toFixed(3)}) should leave far more cross-colour than a 2-line comb (${tapeEngine.rainbowComb.toFixed(3)})`,
    );
  }
  if (tapeEngine.combVsBox < 10) {
    failures.push(`tape: the demodulation filter barely changed the picture (${tapeEngine.combVsBox.toFixed(1)}/px)`);
  }
  if (tapeEngine.crawlMoves < tapeEngine.staticPhase * 2.5) {
    failures.push(
      `tape: dot crawl is not crawling — ${tapeEngine.crawlMoves.toFixed(1)} of frame-to-frame change at 180° vs ${tapeEngine.staticPhase.toFixed(1)} at 0°`,
    );
  }
  if (tapeEngine.spVsEp < 1.5) {
    failures.push(`tape: SP and EP render almost identically (${tapeEngine.spVsEp.toFixed(1)}/px)`);
  }
}

/* -------- 12. the CPU backend -------- */

/*
 * A second renderer that needs no GPU. The assertion that matters is not that
 * it draws something, but that it draws the *same* picture: a backend that
 * quietly diverges is worse than one that fails, because the fallback would
 * silently change people's work.
 *
 * Compared with the time-varying sections switched off, since snow, glitching
 * and sync faults are reseeded per page load and would swamp the comparison.
 * A per-pixel difference remains even so, because the composite subcarrier
 * pattern depends on the frame counter at the moment of capture and the two
 * backends are measured in separate page loads — so the mean is asserted
 * tightly and the per-pixel figure loosely.
 */

const cpuBackend = await (async () => {
  const out = { gpuMean: 0, cpuMean: 0, gpuLit: 0, cpuLit: 0, perPixel: 0, selected: '', toggle: [], error: null };

  const grab = async (backend) => {
    const p = await browser.newPage({ viewport: { width: 1100, height: 820 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.addInitScript((b) => {
      try {
        localStorage.setItem('crtbox.backend', b);
        localStorage.setItem('crtbox.guide.hideOnStart', '1');
      } catch {
        /* private window */
      }
    }, backend);
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForTimeout(1600);
    const r = await p.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const g = c.getContext('2d');
      ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => {
        g.fillStyle = col;
        g.fillRect((i * 320) / 7, 0, 320 / 7 + 1, 150);
      });
      g.fillStyle = '#fff';
      for (let x = 0; x < 320; x += 3) g.fillRect(x, 160, 1, 80);
      const blob = await new Promise((x) => c.toBlob(x, 'image/png'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 't.png', { type: 'image/png' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
      await sleep(700);

      const sect = (t) =>
        [...document.querySelectorAll('.group')].find((x) => x.querySelector('.group-title')?.textContent === t);
      const enable = (t, v) => {
        const cb = sect(t)?.querySelector(".group-actions input[type='checkbox']");
        if (cb && cb.checked !== v) cb.click();
      };
      const tab = (n) =>
        [...document.querySelectorAll('.tabs button')].find((b) => b.textContent.trim() === n)?.click();

      tab('Tape');
      await sleep(250);
      enable('Signal Noise', false);
      enable('Head Switching & Tracking', false);
      tab('Tube');
      await sleep(250);
      enable('Sync & Timebase', false);
      enable('Faults & Wear', false);
      enable('Glitching', false);
      await sleep(400);
      const row = (l) =>
        [...document.querySelectorAll('.param')].find((r) => r.querySelector('.param-label')?.textContent === l);
      const setI = (el, v) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      for (const [l, v] of [['Snow', 0], ['Dither', 0], ['Flicker', 0], ['Hum bar', 0]]) {
        const rw = row(l);
        if (rw) setI(rw.querySelector("input[type='range']"), v);
      }
      await sleep(2000);

      const app = document.querySelector('.stage canvas');
      const probe = document.createElement('canvas');
      probe.width = 180;
      probe.height = 135;
      const pg = probe.getContext('2d', { willReadFrequently: true });
      pg.drawImage(app, 0, 0, probe.width, probe.height);
      const d = pg.getImageData(0, 0, probe.width, probe.height).data;
      let sum = 0;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        const m = (d[i] + d[i + 1] + d[i + 2]) / 3;
        sum += m;
        if (m > 24) lit++;
      }
      return {
        px: Array.from(d),
        mean: sum / (d.length / 4),
        lit: lit / (probe.width * probe.height),
        selected:
          document.querySelector('.backend-toggle button.active')?.dataset.backend ?? '',
        resolved:
          document.querySelector('.backend-toggle button.resolved')?.dataset.backend ?? '',
      };
    });
    await p.close();
    return { ...r, errs };
  };

  try {
    const g = await grab('gpu');
    const c = await grab('cpu');
    out.toggle = await (async () => {
      // Start on Auto and click through the segments, checking each takes.
      const p = await browser.newPage({ viewport: { width: 1100, height: 820 } });
      await p.addInitScript(() => {
        try {
          localStorage.removeItem('crtbox.backend');
          localStorage.setItem('crtbox.guide.hideOnStart', '1');
        } catch {
          /* private window */
        }
      });
      await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await p.waitForTimeout(1500);
      const seen = await p.evaluate(async () => {
        const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
        const seg = (b) => document.querySelector(`.backend-toggle button[data-backend="${b}"]`);
        const active = () => document.querySelector('.backend-toggle button.active')?.dataset.backend;
        const order = [];
        order.push(`start:${active()}`);
        for (const b of ['cpu', 'gpu', 'auto']) {
          seg(b)?.click();
          await sleep(900);
          order.push(`${b}:${active()}`);
        }
        // Auto must still mark which backend actually won.
        order.push(`resolved:${document.querySelector('.backend-toggle button.resolved')?.dataset.backend}`);
        return order;
      });
      await p.close();
      return seen;
    })();
    if (c.errs.length) throw new Error(`CPU backend threw: ${c.errs[0]}`);
    out.gpuMean = g.mean;
    out.cpuMean = c.mean;
    out.gpuLit = g.lit;
    out.cpuLit = c.lit;
    out.selected = c.selected;
    let diff = 0;
    let n = 0;
    for (let i = 0; i < g.px.length; i += 4) {
      diff += Math.abs(g.px[i] - c.px[i]) + Math.abs(g.px[i + 1] - c.px[i + 1]) + Math.abs(g.px[i + 2] - c.px[i + 2]);
      n++;
    }
    out.perPixel = diff / n;
  } catch (err) {
    out.error = String(err);
  }
  return out;
})();

if (cpuBackend.error) {
  failures.push(`cpu backend: ${cpuBackend.error}`);
} else {
  if (cpuBackend.selected !== 'cpu') {
    failures.push(`cpu backend: the toggle reads "${cpuBackend.selected}", so the choice did not take`);
  }
  const want = ['start:auto', 'cpu:cpu', 'gpu:gpu', 'auto:auto'];
  const got = cpuBackend.toggle.slice(0, 4).join(' ');
  if (got !== want.join(' ')) {
    failures.push(`backend toggle: clicking through gave "${got}", expected "${want.join(' ')}"`);
  }
  if (!/^resolved:(gpu|cpu)$/.test(cpuBackend.toggle[4] ?? '')) {
    failures.push(
      `backend toggle: on Auto, neither segment is marked as the one actually in use (${cpuBackend.toggle[4]})`,
    );
  }
  if (cpuBackend.cpuLit < 0.3) {
    failures.push(`cpu backend: only ${(cpuBackend.cpuLit * 100).toFixed(1)}% of the frame is lit — it is not rendering`);
  }
  const meanDelta = Math.abs(cpuBackend.cpuMean - cpuBackend.gpuMean);
  if (meanDelta > 6) {
    failures.push(
      `cpu backend: mean brightness ${cpuBackend.cpuMean.toFixed(1)} against the GPU's ${cpuBackend.gpuMean.toFixed(1)} — the two backends have diverged`,
    );
  }
  if (cpuBackend.perPixel > 30) {
    failures.push(
      `cpu backend: ${cpuBackend.perPixel.toFixed(1)} per-pixel difference from the GPU, which is more than subcarrier phase can explain`,
    );
  }
}

/* -------- 13. engine masters, and advanced parameters -------- */

/*
 * Two assertions that are easy to break and silent when broken:
 *
 *   - Each engine has a master bypass on its tab, and it genuinely bypasses
 *     rather than only greying out the label. Checked by rendering the same
 *     source in all four combinations and requiring them to differ.
 *   - Advanced parameters are shown by default. They used to be hidden, which
 *     made two thirds of the application invisible until you found a tickbox,
 *     so a regression to that is worth catching.
 */

const masters = await (async () => {
  const out = { advancedShown: false, states: {}, tapeStruck: false, error: null };
  const p = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  try {
    await p.addInitScript(() => {
      try {
        localStorage.clear();
        localStorage.setItem('crtbox.guide.hideOnStart', '1');
      } catch {
        /* private window */
      }
    });
    await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await p.waitForTimeout(1600);
    Object.assign(
      out,
      await p.evaluate(async () => {
        const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
        const res = {};

        // 'Dropout length' is flagged advanced; with nothing configured it
        // must be on screen once its section is open.
        const sect = (t) =>
          [...document.querySelectorAll('.group')].find(
            (x) => x.querySelector('.group-title')?.textContent === t,
          );
        const open = (t) => {
          const x = sect(t);
          if (x && !x.classList.contains('open')) x.querySelector('.group-toggle').click();
        };
        open('VHS Tape');
        await sleep(500);
        res.advancedShown = [...document.querySelectorAll('.param-label')].some(
          (l) => l.textContent === 'Edge wave detail',
        );

        const c = document.createElement('canvas');
        c.width = 320;
        c.height = 240;
        const g = c.getContext('2d');
        ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => {
          g.fillStyle = col;
          g.fillRect((i * 320) / 7, 0, 320 / 7 + 1, 160);
        });
        g.fillStyle = '#fff';
        for (let x = 0; x < 320; x += 3) g.fillRect(x, 170, 1, 70);
        const blob = await new Promise((x) => c.toBlob(x, 'image/png'));
        const dt = new DataTransfer();
        dt.items.add(new File([blob], 't.png', { type: 'image/png' }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
        await sleep(1800);

        const app = document.querySelector('.stage canvas');
        const probe = document.createElement('canvas');
        probe.width = 180;
        probe.height = 135;
        const pg = probe.getContext('2d', { willReadFrequently: true });
        const stats = () => {
          pg.drawImage(app, 0, 0, probe.width, probe.height);
          const d = pg.getImageData(0, 0, probe.width, probe.height).data;
          let sum = 0;
          let struct = 0;
          for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          for (let y = 1; y < probe.height; y++) {
            for (let x = 0; x < probe.width; x += 4) {
              struct += Math.abs(d[(y * probe.width + x) * 4] - d[((y - 1) * probe.width + x) * 4]);
            }
          }
          return { mean: sum / (d.length / 4), struct: struct / ((probe.height * probe.width) / 4) };
        };
        // Wait for the picture to settle rather than sleeping a fixed time.
        // Under load a fixed wait samples a frame that has not been drawn yet,
        // which reads as "perfectly flat" and fails the comparison below for
        // reasons that have nothing to do with the engines.
        const settle = async (minMean = 20) => {
          let last = stats();
          for (let i = 0; i < 40; i++) {
            await sleep(250);
            const now = stats();
            const moved = Math.abs(now.mean - last.mean) + Math.abs(now.struct - last.struct);
            if (now.mean >= minMean && moved < 0.05) return now;
            last = now;
          }
          return last;
        };

        const tabSwitch = (name) =>
          [...document.querySelectorAll('.tabs .tab')]
            .find((t) => t.textContent.trim().startsWith(name))
            ?.querySelector('input');
        const tabEl = (name) =>
          [...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.trim().startsWith(name));

        res.states = {};
        res.states.both = await settle();
        tabSwitch('Tape').click();
        res.states.tubeOnly = await settle();
        res.tapeStruck = !!tabEl('Tape')?.classList.contains('bypassed');
        tabSwitch('Tape').click();
        await settle();
        tabSwitch('Tube').click();
        res.states.tapeOnly = await settle();
        tabSwitch('Tape').click();
        res.states.neither = await settle();
        return res;
      }),
    );
  } catch (err) {
    out.error = String(err);
  }
  await p.close();
  return out;
})();

if (masters.error) {
  failures.push(`engine masters: ${masters.error}`);
} else {
  if (!masters.advancedShown) {
    failures.push('advanced: fine-detail parameters are hidden on a fresh profile — they should be shown by default');
  }
  if (!masters.tapeStruck) {
    failures.push('engine masters: a bypassed engine is not marked as such on its tab');
  }
  const st = masters.states;
  const d = (a, b) => Math.abs(a.mean - b.mean) + Math.abs(a.struct - b.struct);
  if (d(st.both, st.tubeOnly) < 1.5) {
    failures.push(`engine masters: switching the tape engine off barely changed the picture (${d(st.both, st.tubeOnly).toFixed(2)})`);
  }
  if (d(st.both, st.tapeOnly) < 1.5) {
    failures.push(`engine masters: switching the tube engine off barely changed the picture (${d(st.both, st.tapeOnly).toFixed(2)})`);
  }
  // Both off is the flattest thing the app can produce: no scanlines, no tape.
  if (!(st.neither.struct < st.both.struct && st.neither.struct < st.tapeOnly.struct)) {
    failures.push(
      `engine masters: with both engines off the picture is not the flattest (${st.neither.struct.toFixed(2)} against ${st.both.struct.toFixed(2)} and ${st.tapeOnly.struct.toFixed(2)})`,
    );
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error('SMOKE TEST FAILED');
  for (const f of failures) console.error('  •', f);
  process.exit(1);
}

console.log('smoke test passed');
console.log(`  gl        ${gl.version}`);
console.log(
  `  picture   ${(picture.lit * 100).toFixed(1)}% lit · contrast ${picture.contrast.toFixed(2)} · line structure ${picture.lineStructure.toFixed(3)}`,
);
console.log(
  `  video     element ${videoResult.presented.toFixed(0)} · tube ${(videoResult.lit * 100).toFixed(1)}% lit`,
);
console.log(
  `  audio     transport rms ${audio.transportRms.toFixed(4)} · noise rms ${audio.noiseRms.toFixed(4)}`,
);
console.log(
  `  keyframes ${keys.diamonds} markers · saturation ${keys.sat.map((v) => v.toFixed(2)).join(' → ')}`,
);
console.log(
  `  framing   4:3 ${framing.ratios['4:3']?.toFixed(3)} · 16:9 ${framing.ratios['16:9']?.toFixed(3)}`,
);
console.log(
  `  packaged  file:// mounted ${packaged.mounted} chars · ${(packaged.lit * 100).toFixed(1)}% lit`,
);
console.log(
  `  trails    lit ${trails.bright.toFixed(1)} → ${trails.afterDark.toFixed(1)} just after black → ${trails.settled.toFixed(1)} settled`,
);
console.log(
  `  colour    saturation ${sections.satFull.toFixed(2)} → ${sections.satZero.toFixed(2)} at zero · temperature B−R ${sections.warmRB.toFixed(0)} → ${sections.coldRB.toFixed(0)}`,
);
console.log(`  glitch    ${sections.glitchOnVsOff.toFixed(1)} per-pixel change when switched on`);
console.log(
  `  guide     shown on start, closes, reopens, ${guide.tubes} tubes · ⓘ reveals ${guide.paramInfo.length} chars (param) / ${guide.sectionInfo.length} (section)`,
);
console.log(
  `  cpu       mean ${cpuBackend.cpuMean.toFixed(1)} vs GPU ${cpuBackend.gpuMean.toFixed(1)} · ${cpuBackend.perPixel.toFixed(1)}/px apart · ${(cpuBackend.cpuLit * 100).toFixed(1)}% lit`,
);
console.log(`  toggle    ${cpuBackend.toggle.join('  ')}`);
console.log(
  `  masters   both ${masters.states.both.struct.toFixed(1)} · tube-only ${masters.states.tubeOnly.struct.toFixed(1)} · tape-only ${masters.states.tapeOnly.struct.toFixed(1)} · neither ${masters.states.neither.struct.toFixed(1)} (vertical structure) · advanced shown`,
);
console.log(
  `  tape      cross-colour ${tapeEngine.rainbowBox.toFixed(3)} box vs ${tapeEngine.rainbowComb.toFixed(3)} comb · dot crawl ${tapeEngine.crawlMoves.toFixed(1)} moving vs ${tapeEngine.staticPhase.toFixed(1)} static · SP→EP ${tapeEngine.spVsEp.toFixed(1)}/px`,
);
