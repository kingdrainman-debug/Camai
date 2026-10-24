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
 * A CRT seen head on: dark bezel, curved screen, colour bars behind the
 * scanline structure, and the phosphor glow leaking past the glass edge.
 */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  // Supersample; at 16px the scanlines otherwise alias into a grey smear.
  const ss = size <= 64 ? 4 : 2;

  const bars = [
    [0.72, 0.72, 0.72],
    [0.75, 0.72, 0.15],
    [0.15, 0.68, 0.72],
    [0.16, 0.66, 0.24],
    [0.68, 0.18, 0.66],
    [0.72, 0.18, 0.18],
    [0.16, 0.22, 0.70],
  ];

  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Normalised coordinates in [-1, 1].
          const u = ((ix + (sx + 0.5) / ss) / size) * 2 - 1;
          const v = ((iy + (sy + 0.5) / ss) / size) * 2 - 1;

          // --- body ---
          const bodyD = roundedRect(u, v, 0.94, 0.94, 0.30);
          const bodyA = 1 - smoothstep(-0.012, 0.012, bodyD);
          let cr = 0.075;
          let cg = 0.080;
          let cb = 0.085;

          // Faceplate curvature: sample the picture through a barrel warp so
          // the bars bow the way they do on real glass.
          const wu = u * (1 + 0.13 * v * v);
          const wv = v * (1 + 0.17 * u * u);
          const screenD = roundedRect(wu, wv, 0.70, 0.60, 0.20);
          const screenA = 1 - smoothstep(-0.010, 0.010, screenD);

          if (screenA > 0) {
            const bx = clamp01((wu / 0.70) * 0.5 + 0.5);
            const [pr, pg, pb] = bars[Math.min(bars.length - 1, Math.floor(bx * bars.length))];

            // Scanlines, tied to the icon's own pixel grid so they stay crisp.
            const lines = Math.max(6, Math.round(size / 7));
            const phase = ((wv / 0.60) * 0.5 + 0.5) * lines;
            const d = Math.abs(phase - Math.floor(phase) - 0.5) / 0.30;
            const beam = Math.exp(-d * d);
            const lit = 0.34 + 0.66 * beam;

            // Vignette, and the beam blooming towards the middle.
            const vig = 1 - 0.42 * (wu * wu + wv * wv);

            const sr = pr * lit * vig;
            const sg = pg * lit * vig;
            const sb = pb * lit * vig;

            cr = cr * (1 - screenA) + sr * screenA;
            cg = cg * (1 - screenA) + sg * screenA;
            cb = cb * (1 - screenA) + sb * screenA;
          }

          // Phosphor glow spilling past the glass onto the bezel.
          const glow = Math.exp(-Math.max(screenD, 0) * 11) * 0.30;
          cr += glow * 0.55;
          cg += glow * 0.60;
          cb += glow * 0.42;

          // A highlight along the top edge of the moulding.
          const sheen = Math.exp(-Math.pow((v + 0.80) * 7, 2)) * (1 - screenA) * 0.10;
          cr += sheen;
          cg += sheen;
          cb += sheen;

          r += cr * bodyA;
          g += cg * bodyA;
          b += cb * bodyA;
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
