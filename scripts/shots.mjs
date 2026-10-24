/*
 * Render a still through a set of presets and write PNGs to scratch/.
 * Used to eyeball the look; not part of the test suite.
 *
 *   node scripts/shots.mjs [outputDir]
 */

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const outDir = process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'shots');
await mkdir(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname));
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

const browser = await chromium.launch({
  executablePath: process.env.CRTBOX_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

await page.evaluate(async () => {
  const src = document.createElement('canvas');
  src.width = 640;
  src.height = 480;
  const ctx = src.getContext('2d');
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  bars.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect((i * 640) / 7, 0, 640 / 7 + 1, 320);
  });
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 320, 640, 160);
  ctx.fillStyle = '#fff';
  ctx.fillRect(30, 350, 150, 100);
  ctx.fillStyle = '#888';
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText('CRTBOX', 230, 415);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#000';
    ctx.fillRect(500 + i * 3, 340, 3, 120);
  }
  const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'bars.png', { type: 'image/png' }));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));
});

const presets = process.env.CRTBOX_SHOTS?.split(',') ?? [
  'reference',
  'livingroom87',
  'vhs3rd',
  'failing',
  'transmission',
];

for (const id of presets) {
  await page.selectOption('.topbar-actions select', id);
  await page.waitForTimeout(1400);
  const shot = await page.evaluate(() => {
    const app = document.querySelector('canvas');
    return app.toDataURL('image/png');
  });
  const data = Buffer.from(shot.split(',')[1], 'base64');
  await writeFile(join(outDir, `${id}.png`), data);
  console.log(`${id}.png  ${(data.length / 1024).toFixed(0)} kB`);
}

// Also grab the full window so the layout can be reviewed.
await page.screenshot({ path: join(outDir, 'ui.png') });
console.log('ui.png');

await browser.close();
server.close();
