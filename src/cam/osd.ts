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
  '%': ['##   ', '##  #', '   # ', '  #  ', ' #   ', '#  ##', '   ##'],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
};

/* ------------------------------------------------------------------ *
 * Faces
 *
 * Every face is derived from the 5×7 font above by a rule, or (the seven-
 * segment digits) drawn here, so all of them are original and both
 * backends get identical pixels. A glyph is a grid of booleans.
 * ------------------------------------------------------------------ */

type Grid = boolean[][];

function baseGrid(ch: string): Grid {
  const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS[' '];
  return g.map((row) => [...row].map((c) => c === '#'));
}

function blank(w: number, h: number): Grid {
  return Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
}

/** Each pixel doubled in both directions. */
function doubled(g: Grid): Grid {
  const out = blank(g[0].length * 2, g.length * 2);
  g.forEach((row, y) => row.forEach((on, x) => {
    if (!on) return;
    out[2 * y][2 * x] = out[2 * y][2 * x + 1] = out[2 * y + 1][2 * x] = out[2 * y + 1][2 * x + 1] = true;
  }));
  return out;
}

/** The seven-segment digits, on the same 5 × 7 grid. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g',
};

function segmentGrid(ch: string): Grid | null {
  const segs = SEGMENTS[ch];
  if (segs === undefined) return null;
  const g = blank(5, 7);
  const on = (x: number, y: number) => (g[y][x] = true);
  for (const seg of segs) {
    if (seg === 'a') for (let x = 1; x <= 3; x++) on(x, 0);
    if (seg === 'g') for (let x = 1; x <= 3; x++) on(x, 3);
    if (seg === 'd') for (let x = 1; x <= 3; x++) on(x, 6);
    if (seg === 'f') [1, 2].forEach((y) => on(0, y));
    if (seg === 'b') [1, 2].forEach((y) => on(4, y));
    if (seg === 'e') [4, 5].forEach((y) => on(0, y));
    if (seg === 'c') [4, 5].forEach((y) => on(4, y));
  }
  return g;
}

export const OSD_FACES = ['classic', 'bold', 'italic', 'segment', 'large', 'dotmatrix', 'hollow'] as const;

function faceGrid(face: string, ch: string): Grid {
  const g = baseGrid(ch);
  switch (face) {
    case 'bold': {
      // Every stroke a pixel wider, to the right.
      const out = blank(6, 7);
      g.forEach((row, y) => row.forEach((on, x) => {
        if (on) out[y][x] = out[y][x + 1] = true;
      }));
      return out;
    }
    case 'italic': {
      // Leaning two pixels over its height.
      const out = blank(7, 7);
      g.forEach((row, y) => row.forEach((on, x) => {
        if (on) out[y][x + Math.floor((6 - y) / 3)] = true;
      }));
      return out;
    }
    case 'segment':
      return segmentGrid(ch) ?? g;
    case 'large':
      return doubled(g);
    case 'dotmatrix': {
      // Twice the size, each dot on its own with a gap round it.
      const out = blank(10, 14);
      g.forEach((row, y) => row.forEach((on, x) => {
        if (on) out[2 * y][2 * x] = true;
      }));
      return out;
    }
    case 'hollow': {
      // Twice the size, outline only.
      const d = doubled(g);
      const out = blank(d[0].length, d.length);
      d.forEach((row, y) => row.forEach((on, x) => {
        if (!on) return;
        const inside =
          y > 0 && y < d.length - 1 && x > 0 && x < row.length - 1 &&
          d[y - 1][x] && d[y + 1][x] && d[y][x - 1] && d[y][x + 1];
        out[y][x] = !inside;
      }));
      return out;
    }
    default:
      return g;
  }
}

const faceCache = new Map<string, Grid>();

function glyph(face: string, ch: string): Grid {
  const key = `${face}|${ch}`;
  let g = faceCache.get(key);
  if (!g) {
    g = faceGrid(face, ch);
    faceCache.set(key, g);
  }
  return g;
}

/** A face's cell: advance and height in OSD pixels. */
export function faceMetrics(face: string): { cell: number; height: number } {
  const g = glyph(face, '0');
  return { cell: g[0].length + 1, height: g.length };
}

/** How the character generator separated its ink from the picture. */
export type EdgeStyle = 'outline' | 'shadow' | 'none';

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

  face = 'classic';

  text(x: number, y: number, s: string, c: RGB): number {
    for (const ch of s) {
      const g = glyph(this.face, ch);
      for (let r = 0; r < g.length; r++) for (let k = 0; k < g[r].length; k++) if (g[r][k]) this.dot(x + k, y + r, c);
      x += g[0].length + 1;
    }
    return x;
  }

  /** Width of a string in the current face. */
  measure(s: string): number {
    let w = 0;
    for (const ch of s) w += glyph(this.face, ch)[0].length + 1;
    return w;
  }

  /**
   * Ink plus its key against the picture: a one-pixel black edge round it, as
   * most character generators keyed it, a drop shadow below and to the
   * right, or nothing.
   */
  finish(edgeStyle: EdgeStyle = 'outline'): void {
    if (edgeStyle !== 'outline') {
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
          } else if (edgeStyle === 'shadow' && x > 0 && y > 0 && ink[(y - 1) * W + x - 1]) {
            data[o] = data[o + 1] = data[o + 2] = 16;
            data[o + 3] = 200;
          }
        }
      }
      return;
    }
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
  c.face = str(s, 'osd.font');
  const fm = faceMetrics(c.face);
  const line = fm.height + 4;
  const ink = INKS[str(s, 'osd.colour')] ?? INKS.white;
  const t = fs.outT;
  const blink = Math.floor(t * 2) % 2 === 0;
  const left = 22;
  const right = W - 22;
  const top = 14;

  const recording = !fs.dead;
  if (bool(s, 'osd.rec')) {
    if (recording) {
      const d = Math.max(5, Math.round(fm.height * 0.7));
      const dy = top + Math.round((fm.height - d) / 2);
      c.rect(left, dy, d, d, RED);
      c.dot(left, dy, [0, 0, 0]);
      c.text(left + d + 3, top, 'REC', ink);
    } else {
      c.text(left, top, 'STBY', ink);
    }
  }
  {
    if (bool(s, 'osd.battery')) {
      const pct = bool(s, 'battery.enabled') ? fs.clock.battery : 100;
      const low = pct < 10;
      const style = str(s, 'osd.batteryStyle');
      const show = style !== 'lowonly' || pct < 25;
      if (show && !(low && bool(s, 'osd.warnings') && !blink)) {
        drawBattery(c, style, left, top + line, fm.height, pct, ink, s);
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
    c.text(right - c.measure(label), top, label, ink);
  }
  if (bool(s, 'osd.mode')) {
    const parts = [str(s, 'tape.speed') === 'lp' ? 'LP' : 'SP'];
    if (bool(s, 'audio.enabled')) parts.push(str(s, 'audio.mode') === '12' ? '12BIT' : '16BIT');
    if (str(s, 'format.aspect') === '16:9') parts.push('16:9');
    const label = parts.join(' ');
    c.text(right - c.measure(label), top + line, label, ink);
  }
  if (bool(s, 'osd.zoomBar') && inp.zoomMoving) {
    // W to T with a marker, the digital range drawn beyond the T.
    const bw = 60;
    const bx = Math.round(W / 2 - bw / 2);
    const by = top + 2;
    c.text(bx - c.measure('W') - 2, by, 'W', ink);
    c.text(bx + bw + 3, by, 'T', ink);
    const mid = by + Math.floor(fm.height / 2);
    c.rect(bx, mid, bw, 1, ink);
    const frac = Math.log(Math.max(inp.zoomOptical, 1)) / Math.log(Math.max(inp.zoomRange, 1.0001));
    const mx = bx + Math.round(Math.min(1, frac) * (bw - 2));
    c.rect(mx, by, 2, fm.height, ink);
    if (inp.zoom > inp.zoomOptical * 1.01) {
      const z = `${Math.round(inp.zoom)}x`;
      c.text(bx + Math.round(bw / 2 - c.measure(z) / 2), by + line, z, ink);
    }
  }
  c.finish(str(s, 'osd.edge') as EdgeStyle);
  let key = '';
  for (let i = 0; i < c.data.length; i += 997) key += c.data[i];
  key += `|${fs.outFrame}|${W}`;
  return { width: W, height: H, data: c.data, key };
}

/**
 * The battery gauge, in one of several styles. All are drawn for this
 * project; none is any manufacturer's.
 */
function drawBattery(c: Canvas, style: string, bx: number, rowTop: number, rowH: number, pct: number, ink: RGB, s: Settings): void {
  // The gauge sits centred on its line, whatever the size of the lettering.
  const by = rowTop + Math.max(0, Math.round((rowH - 7) / 2));
  const frac = Math.max(0, Math.min(1, pct / 100));
  const bars = (n: number) => Math.max(0, Math.min(n, Math.ceil(frac * n - 0.0001)));
  // A horizontal case of the given size with its nub on the right.
  const body = (w: number, h: number) => {
    c.rect(bx, by, w, 1, ink);
    c.rect(bx, by + h - 1, w, 1, ink);
    c.rect(bx, by, 1, h, ink);
    c.rect(bx + w - 1, by, 1, h, ink);
    const nh = Math.max(2, Math.round(h / 2.5));
    c.rect(bx + w, by + Math.round((h - nh) / 2), 2, nh, ink);
  };
  switch (style) {
    case 'bars3': {
      body(17, 7);
      for (let k = 0; k < bars(3); k++) c.rect(bx + 2 + k * 5, by + 2, 4, 3, ink);
      break;
    }
    case 'bars5': {
      body(18, 7);
      for (let k = 0; k < bars(5); k++) c.rect(bx + 2 + k * 3, by + 2, 2, 3, ink);
      break;
    }
    case 'fill': {
      body(19, 7);
      const w = Math.round(frac * 15);
      if (w > 0) c.rect(bx + 2, by + 2, w, 3, ink);
      break;
    }
    case 'vertical': {
      // Standing up, nub on top, bars stacked from the bottom.
      const by = rowTop;
      c.rect(bx + 3, by, 3, 1, ink);
      c.rect(bx, by + 1, 9, 1, ink);
      c.rect(bx, by + 14, 9, 1, ink);
      c.rect(bx, by + 1, 1, 14, ink);
      c.rect(bx + 8, by + 1, 1, 14, ink);
      for (let k = 0; k < bars(4); k++) c.rect(bx + 2, by + 11 - k * 3, 5, 2, ink);
      break;
    }
    case 'percent': {
      body(11, 7);
      const n = bars(2);
      for (let k = 0; k < n; k++) c.rect(bx + 2 + k * 4, by + 2, 3, 3, ink);
      c.text(bx + 16, rowTop, `${Math.round(pct)}%`, ink);
      break;
    }
    case 'minutes': {
      // The time left, as the later "intelligent" batteries reported it.
      body(11, 7);
      const n = bars(2);
      for (let k = 0; k < n; k++) c.rect(bx + 2 + k * 4, by + 2, 3, 3, ink);
      const capacity = bool(s, 'battery.enabled') ? Number(s['battery.capacity'] ?? 60) : 60;
      c.text(bx + 16, rowTop, `${Math.max(0, Math.round(frac * capacity))}min`, ink);
      break;
    }
    case 'lowonly': {
      // An empty outline, shown only when the battery is running low.
      body(17, 7);
      break;
    }
    default: {
      body(17, 7);
      for (let k = 0; k < bars(4); k++) c.rect(bx + 2 + k * 4, by + 2, 3, 3, ink);
    }
  }
}

/** The date and time layer. */
export function drawDate(s: Settings, fs: FrameState): OsdImage {
  const W = fs.sys.W / 2;
  const H = fs.sys.H / 2;
  const c = new Canvas(W, H);
  c.face = str(s, 'date.font');
  const fm = faceMetrics(c.face);
  const ink = INKS[str(s, 'date.colour')] ?? INKS.white;
  const [date, time] = formatDate(s, fs.clock.wallMs);
  const y = H - 14 - fm.height - (fm.height + 4);
  c.text(22, y, date, ink);
  c.text(W - 22 - c.measure(time), y + fm.height + 4, time, ink);
  const edge = str(s, 'date.edge') as EdgeStyle;
  c.finish(edge);
  return { width: W, height: H, data: c.data, key: `${date}|${time}|${W}|${str(s, 'date.colour')}|${c.face}|${edge}` };
}

/** Where each overlay layer enters the chain: 0 before the codec, 1 after decode, 2 on the display; −1 off. */
export function overlayPaths(s: Settings): [number, number] {
  const code = (k: string) => (str(s, k) === 'precodec' ? 0 : str(s, k) === 'display' ? 2 : 1);
  return [bool(s, 'osd.enabled') ? code('osd.insert') : -1, bool(s, 'date.enabled') ? code('date.insert') : -1];
}

