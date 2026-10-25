/**
 * The camera's character generator.
 *
 * Camcorder displays were drawn by a character generator running at a lower
 * pixel clock than the video: small cells of wide pixels, white or yellow,
 * with a black edge so they read on any picture, in fixed positions inside
 * the safe area. This draws that, into a bitmap of "OSD pixels", each of
 * which is two DV samples wide and two lines tall. It is drawn by setting
 * bytes from an original 5×7 font defined below, not by rendering text, so
 * that both backends receive identical pixels on every platform.
 *
 * The font and the layouts are drawn for this project in the style of the
 * period; they are not copied from any manufacturer's firmware, manual or
 * screen.
 *
 * Two layers, because the camera's display (REC, counter, battery, zoom) and
 * the date and time are separate things with separate paths through the
 * chain: one may be burned in while the other is drawn at playback.
 */

import { Settings, bool, str } from '../core/params';
import type { FrameState } from './clock';

/* ------------------------------------------------------------------ *
 * The font: 5 columns × 7 rows, one string per row, '#' set.
 * ------------------------------------------------------------------ */

const GLYPHS: Record<string, string[]> = {
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': ['#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
  D: ['###  ', '#  # ', '#   #', '#   #', '#   #', '#  # ', '###  '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  J: ['  ###', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '#   #', '##  #', '# # #', '#  ##', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '# # #', ' # # '],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  ':': ['     ', '  #  ', '  #  ', '     ', '  #  ', '  #  ', '     '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '/': ['    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    '],
  'x': ['     ', '     ', '#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
};

const CELL_W = 6;

export interface OsdImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** Changes whenever the pixels do. */
  key: string;
}

type RGB = [number, number, number];

const INKS: Record<string, RGB> = {
  white: [236, 236, 236],
  yellow: [236, 222, 40],
  orange: [244, 150, 40],
};
const RED: RGB = [226, 28, 24];

class Canvas {
  readonly data: Uint8ClampedArray;
  /** Ink mask, before the edge is added. */
  private ink: Uint8Array;
  private col: Uint8ClampedArray;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
    this.ink = new Uint8Array(width * height);
    this.col = new Uint8ClampedArray(width * height * 3);
  }

  dot(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    this.ink[i] = 1;
    this.col[i * 3] = c[0];
    this.col[i * 3 + 1] = c[1];
    this.col[i * 3 + 2] = c[2];
  }

  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(x + i, y + j, c);
  }

  text(x: number, y: number, s: string, c: RGB): number {
    for (const ch of s) {
      const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[' '];
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k] === '#') this.dot(x + k, y + r, c);
      x += CELL_W;
    }
    return x;
  }

  /** Ink plus a one-pixel black edge round it, as the character generator keyed it. */
  finish(): void {
    const { width: W, height: H, ink, col, data } = this;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const o = i * 4;
        if (ink[i]) {
          data[o] = col[i * 3];
          data[o + 1] = col[i * 3 + 1];
          data[o + 2] = col[i * 3 + 2];
          data[o + 3] = 255;
          continue;
        }
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && ink[yy * W + xx]) {
              edge = true;
              break;
            }
          }
        }
        if (edge) {
          data[o] = data[o + 1] = data[o + 2] = 16;
          data[o + 3] = 230;
        }
      }
    }
  }
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function pad(n: number, w = 2): string {
  return String(Math.floor(n)).padStart(w, '0');
}

/** The camera's date and time as it would have shown it. */
export function formatDate(s: Settings, wallMs: number): [string, string] {
  const d = new Date(wallMs);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const fmt = str(s, 'date.format');
  const date = fmt === 'eu' ? `${day}.${mo + 1}.${y}` : fmt === 'iso' ? `${y} ${mo + 1} ${day}` : `${MONTHS[mo]} ${day} ${y}`;
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const se = d.getUTCSeconds();
  let time: string;
  if (str(s, 'date.clock') === '24') time = `${pad(h)}:${pad(mi)}:${pad(se)}`;
  else time = `${((h + 11) % 12) + 1}:${pad(mi)}:${pad(se)} ${h < 12 ? 'AM' : 'PM'}`;
  return [date, time];
}

export function formatTimecode(sec: number, fps: number): string {
  const t = Math.max(0, sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * Math.round(fps));
  return `${h}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export interface OsdInput {
  settings: Settings;
  fs: FrameState;
  /** Optical × digital zoom, and whether the rocker is being pressed. */
  zoom: number;
  zoomOptical: number;
  zoomRange: number;
  zoomMoving: boolean;
}

/** The camera display layer (REC, counter, battery, zoom, mode). */
export function drawDisplay(inp: OsdInput): OsdImage {
  const { settings: s, fs } = inp;
  const W = fs.sys.W / 2;
  const H = fs.sys.H / 2;
  const c = new Canvas(W, H);
  const ink = INKS[str(s, 'osd.colour')] ?? INKS.white;
  const t = fs.outT;
  const blink = Math.floor(t * 2) % 2 === 0;
  const left = 22;
  const right = W - 22;
  const top = 14;

  const recording = !fs.dead;
  if (bool(s, 'osd.rec')) {
    if (recording) {
      c.rect(left, top + 1, 5, 5, RED);
      c.dot(left, top + 1, [0, 0, 0]);
      c.text(left + 8, top, 'REC', ink);
    } else {
      c.text(left, top, 'STBY', ink);
    }
  }
  {
    if (bool(s, 'osd.battery')) {
      const pct = bool(s, 'battery.enabled') ? fs.clock.battery : 100;
      const low = pct < 10;
      if (!(low && bool(s, 'osd.warnings') && !blink)) {
        const bx = left;
        const by = top + 12;
        // A battery outline with a nub and up to four bars.
        c.rect(bx, by, 17, 1, ink);
        c.rect(bx, by + 6, 17, 1, ink);
        c.rect(bx, by, 1, 7, ink);
        c.rect(bx + 16, by, 1, 7, ink);
        c.rect(bx + 17, by + 2, 2, 3, ink);
        const bars = Math.max(0, Math.min(4, Math.ceil(pct / 25 - 0.0001)));
        for (let k = 0; k < bars; k++) c.rect(bx + 2 + k * 4, by + 2, 3, 3, ink);
      }
    }
  }
  {
    let label: string;
    if (str(s, 'osd.counter') === 'remain') {
      const tapeMin = str(s, 'tape.speed') === 'lp' ? 90 : 60;
      label = `${Math.max(0, Math.ceil(tapeMin - fs.outT / 60))}min`;
    } else {
      label = formatTimecode(fs.clock.timecode, fs.rates.dv).replace(/:\d\d$/, '');
    }
    c.text(right - label.length * CELL_W, top, label, ink);
  }
  if (bool(s, 'osd.mode')) {
    const parts = [str(s, 'tape.speed') === 'lp' ? 'LP' : 'SP'];
    if (bool(s, 'audio.enabled')) parts.push(str(s, 'audio.mode') === '12' ? '12BIT' : '16BIT');
    if (str(s, 'format.aspect') === '16:9') parts.push('16:9');
    const label = parts.join(' ');
    c.text(right - label.length * CELL_W, top + 11, label, ink);
  }
  if (bool(s, 'osd.zoomBar') && inp.zoomMoving) {
    // W to T with a marker, the digital range drawn beyond the T.
    const bw = 60;
    const bx = Math.round(W / 2 - bw / 2);
    const by = top + 2;
    c.text(bx - 8, by, 'W', ink);
    c.text(bx + bw + 3, by, 'T', ink);
    c.rect(bx, by + 3, bw, 1, ink);
    const frac = Math.log(Math.max(inp.zoomOptical, 1)) / Math.log(Math.max(inp.zoomRange, 1.0001));
    const mx = bx + Math.round(Math.min(1, frac) * (bw - 2));
    c.rect(mx, by, 2, 7, ink);
    if (inp.zoom > inp.zoomOptical * 1.01) c.text(bx + bw / 2 - 12, by + 11, `${Math.round(inp.zoom)}x`, ink);
  }
  c.finish();
  let key = '';
  for (let i = 0; i < c.data.length; i += 997) key += c.data[i];
  key += `|${fs.outFrame}|${W}`;
  return { width: W, height: H, data: c.data, key };
}

/** The date and time layer. */
export function drawDate(s: Settings, fs: FrameState): OsdImage {
  const W = fs.sys.W / 2;
  const H = fs.sys.H / 2;
  const c = new Canvas(W, H);
  const ink = INKS[str(s, 'date.colour')] ?? INKS.white;
  const [date, time] = formatDate(s, fs.clock.wallMs);
  const y = H - 14 - 7 - 11;
  c.text(22, y, date, ink);
  c.text(W - 22 - time.length * CELL_W, y + 11, time, ink);
  c.finish();
  return { width: W, height: H, data: c.data, key: `${date}|${time}|${W}|${str(s, 'date.colour')}` };
}

/** Where each overlay layer enters the chain: 0 before the codec, 1 after decode, 2 on the display; −1 off. */
export function overlayPaths(s: Settings): [number, number] {
  const code = (k: string) => (str(s, k) === 'precodec' ? 0 : str(s, k) === 'display' ? 2 : 1);
  return [bool(s, 'osd.enabled') ? code('osd.insert') : -1, bool(s, 'date.enabled') ? code('date.insert') : -1];
}

