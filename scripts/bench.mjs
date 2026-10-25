/*
 * Render throughput, both backends.
 *
 *   npm run bench
 *
 * Two numbers per size, because a camcorder frame has two costs. A new DV
 * frame has to be shot and recorded: two fields of camera and sensor, the
 * DSP, and a full DV encode and decode, all in the 720-sample raster
 * whatever the output size. A held frame — the same DV frame shown again, as
 * at field rate or in the web upload's low frame rate — needs only the
 * display passes, because the decoded frame is cached.
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

const explicit = process.env.CAMAI_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(explicit) ? { executablePath: explicit } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__camai);

const sizes = [
  [720, 540],
  [1440, 1080],
];

const rows = [];
for (const backend of ['gpu', 'cpu']) {
  for (const [w, h] of sizes) {
    const r = await page.evaluate(
      async ({ backend, w, h }) => {
        const settings = window.__camai.presets['palmcorder-2002'];
        const base = { backend, settings, source: { kind: 'scene' }, width: w, height: h, srcWidth: 1280, srcHeight: 960, readback: false };
        // Warm up: compile, allocate.
        await window.__camai.renderProbe({ ...base, frames: [0] });
        const N = backend === 'cpu' ? 3 : 8;
        const fresh = await window.__camai.renderProbe({ ...base, frames: Array.from({ length: N }, (_, i) => i + 1) });
        // At field rate, output frames 2 and 3 are the same DV frame.
        const held = await window.__camai.renderProbe({ ...base, settings: { ...settings, 'framing.fps': 'field' }, frames: Array.from({ length: N + 1 }, (_, i) => 2 + (i % 2)) });
        // `held` includes one fresh frame; take it out.
        const heldMs = (held.ms - fresh.ms / N) / N;
        return { fresh: fresh.ms / N, held: Math.max(heldMs, 0) };
      },
      { backend, w, h },
    );
    rows.push({ backend, size: `${w}×${h}`, ...r });
  }
}

console.log('CAMAI render throughput — the palmcorder flagship preset, 1280×960 source.');
console.log('');
console.log('backend  output       new DV frame          held frame');
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
