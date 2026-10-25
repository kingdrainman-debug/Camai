/*
 * Render throughput, both backends.
 *
 *   npm run bench
 *
 * Two numbers per size, because film has two costs. A new film frame has to
 * be exposed, developed and printed: the camera, glow and film passes. A held
 * frame — the same film frame shown again, three times over at 18 fps on a
 * 60 Hz display — only needs the projector pass, because the developed frame
 * is cached.
 *
 * An honest caveat: in a container with no GPU, the "GPU" backend runs on
 * SwiftShader, a software rasteriser, so its numbers here are a floor rather
 * than anything a real graphics card would show. The CPU backend's numbers are
 * real, and do not depend on the machine having a GPU at all.
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
  let path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
  if (path === '/' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const explicit = process.env.FILMBOX_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(explicit) ? { executablePath: explicit } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__filmbox);

const sizes = [
  [640, 444],
  [1280, 888],
  [1920, 1332],
];

const rows = [];
for (const backend of ['gpu', 'cpu']) {
  for (const [w, h] of sizes) {
    const r = await page.evaluate(
      async ({ backend, w, h }) => {
        const settings = window.__filmbox.presets['super8-1974'];
        const base = { backend, settings, source: { kind: 'scene' }, width: w, height: h, srcWidth: 1280, srcHeight: 720, readback: false };
        // Warm up: compile, allocate.
        await window.__filmbox.renderProbe({ ...base, frames: [0] });
        const N = backend === 'cpu' ? 3 : 8;
        const fresh = await window.__filmbox.renderProbe({ ...base, frames: Array.from({ length: N }, (_, i) => i + 1) });
        const held = await window.__filmbox.renderProbe({ ...base, frames: Array.from({ length: N + 1 }, () => 1) });
        // `held` includes one fresh frame; take it out.
        const heldMs = (held.ms - fresh.ms / N) / N;
        return { fresh: fresh.ms / N, held: Math.max(heldMs, 0) };
      },
      { backend, w, h },
    );
    rows.push({ backend, size: `${w}×${h}`, ...r });
  }
}

console.log('FILMBOX render throughput — the Super 8 flagship preset, 1280×720 source.');
console.log('');
console.log('backend  output       new film frame        held frame');
for (const r of rows) {
  console.log(
    `${r.backend.padEnd(8)} ${r.size.padEnd(12)} ${r.fresh.toFixed(0).padStart(6)} ms (${(1000 / r.fresh).toFixed(1).padStart(5)} fps)   ${r.held.toFixed(0).padStart(5)} ms`,
  );
}
console.log('');
console.log('In a container with no GPU the "gpu" rows are SwiftShader, a software rasteriser:');
console.log('treat them as a floor. Real hardware is far faster; the CPU rows are what they are.');

await browser.close();
server.close();
