/*
 * Generate the application icon.
 *
 *   node scripts/make-icon.mjs
 *
 * Writes build/icon.png (512px, used for Linux and as the macOS source) and
 * build/icon.ico (a multi-resolution Windows icon). Both are committed, so a
 * packaging run never depends on this script — it exists so the artwork can be
 * regenerated rather than being an opaque binary nobody can change.
 *
 * Everything is drawn with arithmetic and encoded with the built-in zlib, so
 * there is no image library, no headless browser and no design-tool round trip
 * in the dependency graph for a 20 kB file.
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'build');

/* ------------------------------------------------------------------ *
 * Drawing
 * ------------------------------------------------------------------ */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Signed distance to a rounded rectangle centred on the origin. */
function roundedRect(x, y, halfW, halfH, r) {
  const qx = Math.abs(x) - (halfW - r);
  const qy = Math.abs(y) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * A palmcorder in profile on a dark tile: a rounded body with a hand strap
 * over it, a lens barrel out front ending in blue-coated glass, the flip-out
 * screen folded against its side, and the red REC lamp lit — the one detail
 * that still reads at 16 pixels.
 */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const ss = size <= 64 ? 4 : 2;

  const mixIn = (c, col, a) => {
    c[0] = c[0] * (1 - a) + col[0] * a;
    c[1] = c[1] * (1 - a) + col[1] * a;
    c[2] = c[2] * (1 - a) + col[2] * a;
  };
  const fill = (d) => 1 - smoothstep(-0.012, 0.012, d);

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((ix + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((iy + (sy + 0.5) / ss) / size) * 2 - 1;

          // --- tile ---
          const bodyA = fill(roundedRect(u, v, 0.94, 0.94, 0.3));
          const c = [0.07, 0.072, 0.08];

          // --- hand strap over the top ---
          const strap = fill(roundedRect(u + 0.2, v + 0.43, 0.42, 0.045, 0.04));
          mixIn(c, [0.15, 0.15, 0.16], strap);

          // --- body ---
          const bd = roundedRect(u + 0.16, v - 0.06, 0.58, 0.34, 0.15);
          const bA = fill(bd);
          if (bA > 0) {
            const shade = 0.17 + 0.09 * clamp01((-v + 0.3) / 0.7);
            mixIn(c, [shade, shade * 1.02, shade * 1.1], bA);
            // A seam along the body.
            const seam = (1 - smoothstep(0.006, 0.014, Math.abs(v - 0.2))) * bA * 0.6;
            mixIn(c, [0.09, 0.09, 0.1], seam);
          }

          // --- the screen folded against the side ---
          const scr = fill(roundedRect(u + 0.3, v - 0.02, 0.24, 0.17, 0.04));
          mixIn(c, [0.11, 0.115, 0.13], scr);
          const glassScr = fill(roundedRect(u + 0.3, v - 0.02, 0.2, 0.13, 0.03));
          mixIn(c, [0.05, 0.08, 0.1], glassScr * 0.9);

          // --- lens barrel and its glass ---
          const barrel = fill(roundedRect(u - 0.6, v - 0.05, 0.22, 0.24, 0.07));
          mixIn(c, [0.09, 0.09, 0.1], barrel);
          for (const ring of [0.48, 0.58, 0.68]) {
            const rA = (1 - smoothstep(0.006, 0.016, Math.abs(u - ring))) * barrel * 0.8;
            mixIn(c, [0.17, 0.17, 0.19], rA);
          }
          const ge = Math.hypot((u - 0.83) / 0.06, (v - 0.05) / 0.22) - 1;
          const gA = 1 - smoothstep(-0.05, 0.05, ge);
          if (gA > 0) {
            const t = clamp01((v + 0.17) / 0.44);
            mixIn(c, [0.12 + 0.2 * (1 - t), 0.22 + 0.25 * (1 - t), 0.42 + 0.3 * (1 - t)], gA);
            const glint = Math.exp(-(((u - 0.82) / 0.02) ** 2) - (((v + 0.06) / 0.05) ** 2));
            mixIn(c, [0.9, 0.95, 1], glint * gA);
          }

          // --- the REC lamp, lit ---
          const dd = Math.hypot(u + 0.56, v + 0.13);
          const lamp = 1 - smoothstep(0.075, 0.09, dd);
          const glow = Math.exp(-Math.pow((dd - 0.06) / 0.07, 2)) * (1 - lamp) * 0.35;
          mixIn(c, [0.93, 0.12, 0.1], lamp);
          c[0] += glow * 0.8;
          c[1] += glow * 0.08;
          c[2] += glow * 0.06;
          const hot = Math.exp(-(((u + 0.58) / 0.025) ** 2) - (((v + 0.15) / 0.025) ** 2)) * lamp;
          mixIn(c, [1, 0.75, 0.7], hot * 0.8);

          r += c[0] * bodyA;
          g += c[1] * bodyA;
          b += c[2] * bodyA;
          a += bodyA;
        }
      }

      const n = ss * ss;
      const o = (iy * size + ix) * 4;
      // Straight (un-premultiplied) alpha, which is what PNG stores.
      const alpha = a / n;
      const k = alpha > 1e-4 ? 1 / alpha : 0;
      px[o] = Math.round(clamp01((r / n) * k) * 255);
      px[o + 1] = Math.round(clamp01((g / n) * k) * 255);
      px[o + 2] = Math.round(clamp01((b / n) * k) * 255);
      px[o + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return px;
}

/* ------------------------------------------------------------------ *
 * PNG
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  const body = out.subarray(4, 8 + data.length);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // truecolour with alpha
  ihdr[10] = 0;     // deflate
  ihdr[11] = 0;     // adaptive filtering
  ihdr[12] = 0;     // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * ICO
 * ------------------------------------------------------------------ */

/**
 * Windows icons can carry PNG-compressed entries (Vista and later), which keeps
 * the file small and avoids hand-rolling a BMP with an AND mask.
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dirSize = entries.length * 16;
  let offset = header.length + dirSize;
  const dir = Buffer.alloc(dirSize);

  entries.forEach((entry, i) => {
    const at = i * 16;
    dir[at] = entry.size >= 256 ? 0 : entry.size;      // 0 means 256
    dir[at + 1] = entry.size >= 256 ? 0 : entry.size;
    dir[at + 2] = 0;                                   // palette size
    dir[at + 3] = 0;                                   // reserved
    dir.writeUInt16LE(1, at + 4);                      // colour planes
    dir.writeUInt16LE(32, at + 6);                     // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

await mkdir(outDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const entries = icoSizes.map((size) => ({ size, data: encodePng(size, drawIcon(size)) }));
await writeFile(join(outDir, 'icon.ico'), encodeIco(entries));

// electron-builder wants a 512px PNG for Linux, and derives the macOS icns.
const png512 = encodePng(512, drawIcon(512));
await writeFile(join(outDir, 'icon.png'), png512);
await writeFile(join(outDir, 'icon-256.png'), entries[entries.length - 1].data);

console.log(`build/icon.ico  ${icoSizes.join(', ')} px`);
console.log(`build/icon.png  512 px (${(png512.length / 1024).toFixed(1)} kB)`);
