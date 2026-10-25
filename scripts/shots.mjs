/*
 * Render the built-in presets over a drawn scene and write PNGs.
 * Used to eyeball the looks and to make documentation images; not part of
 * the test suite, and never to be run alongside it (the contention makes the
 * smoke test's timing-sensitive stages fail).
 *
 *   node scripts/shots.mjs [outputDir] [frame]
 *
 * Each preset is rendered from frame 0 to the chosen frame in order, so the
 * camera's automatics have had the time they need, and the indoor presets
 * are pointed at the drawn living room rather than the garden.
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '..', 'dist');
const outDir = process.argv[2] ?? join(here, '..', 'shots');
const frame = Number(process.argv[3] ?? 24);
await mkdir(outDir, { recursive: true });

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
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__camai);

/** Minimal PNG encoder: RGB, no filtering. */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = rgb[y * w * 3 + i];
  }
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buf) => {
    let x = 0xffffffff;
    for (const b of buf) x = table[(x ^ b) & 255] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const INDOOR = new Set(['christmas-2002', 'wedding-lp-2004', 'found-footage-imitation']);

const ids = await page.evaluate(() => Object.keys(window.__camai.presets));
for (const id of ids) {
  const res = await page.evaluate(
    async ({ id, frame, indoor }) => {
      const settings = window.__camai.presets[id];
      // Height fixed; width follows the picture's own aspect.
      const height = 540;
      const width = Math.round((height * window.__camai.aspect(settings)) / 2) * 2;
      const frames = [];
      for (let k = Math.max(0, frame - 12); k <= frame; k++) frames.push(k);
      return window.__camai.renderProbeB64({
        backend: 'gpu',
        settings,
        source: { kind: indoor ? 'interior' : 'scene' },
        width,
        height,
        srcWidth: 1280,
        srcHeight: 960,
        frames,
        pixels: true,
      });
    },
    { id, frame, indoor: INDOOR.has(id) },
  );
  const f = res.frames[res.frames.length - 1];
  await writeFile(join(outDir, `${id}.png`), png(res.width, res.height, Buffer.from(f.rgb, 'base64')));
  console.log(`${id.padEnd(24)} ${res.ms.toFixed(0)} ms`);
}

await browser.close();
server.close();
