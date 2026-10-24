/*
 * Render throughput.
 *
 *   node scripts/bench.mjs
 *
 * Measures how fast the full chain — tape engine plus tube — turns source
 * frames into finished ones, at several output resolutions.
 *
 * A caveat that matters more than the numbers: in a container there is no GPU,
 * so this runs through SwiftShader, a software rasteriser. Every figure here is
 * therefore a floor. Real hardware runs the same pipeline one to two orders of
 * magnitude faster, because the whole chain is a handful of full-screen draws
 * and that is precisely what a GPU is for. Treat these as a regression guard —
 * "did a change make the pipeline dramatically more expensive" — rather than as
 * a performance claim.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(root, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const explicit = process.env.CRTBOX_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(existsSync(explicit) ? { executablePath: explicit } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

async function measure(backend, sizes) {
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript((b) => {
  try {
    localStorage.setItem('crtbox.backend', b);
    localStorage.setItem('crtbox.guide.hideOnStart', '1');
  } catch {
    /* private window */
  }
}, backend);
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForTimeout(1800);

const results = await page.evaluate(async (sizeList) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.guide-close')?.click();
  await sleep(300);

  // A real picture, so the band-limiting and demodulation have work to do.
  const src = document.createElement('canvas');
  src.width = 640;
  src.height = 480;
  const g = src.getContext('2d');
  ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect((i * 640) / 7, 0, 640 / 7 + 1, 320);
  });
  g.fillStyle = '#fff';
  for (let x = 0; x < 640; x += 3) g.fillRect(x, 330, 1, 150);
  const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'bench.png', { type: 'image/png' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  await sleep(1600);

  const canvas = document.querySelector('.stage canvas');
  const out = [];

  for (const [label, w, h] of sizeList) {
    canvas.width = w;
    canvas.height = h;
    await sleep(500);

    // Warm up: the first frames at a new size allocate buffers.
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));

    const N = 24;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) await new Promise((r) => requestAnimationFrame(r));
    // Force the pipeline to finish rather than measuring queue depth.
    const gl = canvas.getContext('webgl2');
    if (gl) gl.finish();
    const ms = (performance.now() - t0) / N;

    out.push({ label, w, h, ms, fps: 1000 / ms, mpxPerSec: (w * h) / (ms / 1000) / 1e6 });
  }
  return out;
}, sizes);
  await page.close();
  return results;
}

// The CPU path is measured at smaller frames: at 1080p a single frame takes
// long enough that the browser would be considered hung, which tells you
// nothing you could not work out from the 480p figure.
const GPU_SIZES = [
  ['480p  640x480', 640, 480],
  ['720p 1280x720', 1280, 720],
  ['1080p 1920x1080', 1920, 1080],
];
const CPU_SIZES = [
  ['240p  426x240', 426, 240],
  ['480p  640x480', 640, 480],
];

const gpu = await measure('gpu', GPU_SIZES);
const cpu = await measure('cpu', CPU_SIZES);

const show = (name, rows) => {
  console.log(`\n${name}`);
  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(16)} ${r.ms.toFixed(1).padStart(8)} ms/frame   ${r.fps.toFixed(2).padStart(7)} fps   ${r.mpxPerSec.toFixed(2).padStart(6)} Mpx/s`,
    );
  }
};

console.log('CRTBOX render throughput — full chain: tape engine then tube.');
console.log('No GPU in this container, so the GPU backend is itself running on');
console.log('SwiftShader. Both columns are floors; real hardware moves the GPU');
console.log('row by orders of magnitude and the CPU row hardly at all.');

show('GPU backend (WebGL2, here via SwiftShader)', gpu);
show('CPU backend (plain JavaScript, single-threaded)', cpu);

const g480 = gpu.find((r) => r.label.includes('640x480'));
const c480 = cpu.find((r) => r.label.includes('640x480'));
if (g480 && c480) {
  console.log(
    `\n  At 640x480 the CPU backend is ${(c480.ms / g480.ms).toFixed(1)}x slower than a software GPU,`,
  );
  console.log('  and the gap against a real one is far wider. It is a fallback, not a default.');
}

await browser.close();
server.close();
