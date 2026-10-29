/*
 * Sequential source decoding for exports.
 *
 * An export asks for the source at every field's moment, in order. Asking a
 * <video> element means a seek per field, and a browser seek in a long-GOP
 * file (most camera and phone MP4s) decodes forward from the last keyframe
 * every time. FFmpeg instead decodes the clip once, front to back, and hands
 * over raw frames on a constant grid: frame k is the picture at
 * start + k / fps.
 *
 * Frames are square-pixel RGBA, top row first, at most 1920 × 1080 (the
 * camera samples a 720-wide raster; more source than that costs transfer
 * time and buys nothing but a deeper digital zoom).
 */

const { spawn } = require('node:child_process');

/** Frames read ahead of the renderer before ffmpeg is paused. */
const READ_AHEAD = 6;

/** Parse the input frame rate and the output size from FFmpeg's banner. */
function parseBanner(text) {
  const out = {};
  const input = text.slice(0, Math.max(0, text.indexOf('Output #0')) || text.length);
  const v = /Stream #\d+:\d+[^\n]*Video:[^\n]*/.exec(input);
  if (v) {
    const fps = /([\d.]+) fps/.exec(v[0]) || /([\d.]+) tbr/.exec(v[0]);
    if (fps) out.fps = Number(fps[1]);
  }
  const o = text.indexOf('Output #0');
  if (o >= 0) {
    const sv = /Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(text.slice(o));
    if (sv) {
      out.width = Number(sv[1]);
      out.height = Number(sv[2]);
    }
  }
  return out;
}

/** The exact rational for common NTSC-family rates, which FFmpeg prints rounded. */
function rateArg(fps) {
  const table = { 23.98: '24000/1001', 29.97: '30000/1001', 59.94: '60000/1001', 47.95: '48000/1001', 119.88: '120000/1001' };
  for (const [k, v] of Object.entries(table)) if (Math.abs(fps - Number(k)) < 0.01) return v;
  return String(fps);
}

const sessions = new Map();
let nextId = 1;

function probeArgs(filePath, start) {
  return ['-hide_banner', '-ss', String(Math.max(0, start)), '-i', filePath, '-t', '0.001', '-f', 'null', '-'];
}

/** Run FFmpeg briefly to learn the source's frame rate. */
function probeRate(ffmpeg, filePath, start) {
  return new Promise((resolve) => {
    const child = spawn(ffmpeg, probeArgs(filePath, start), { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(parseBanner(err).fps || null));
  });
}

async function open(ffmpeg, { filePath, start = 0 }) {
  const fps = (await probeRate(ffmpeg, filePath, start)) || 30;
  const rate = rateArg(fps);
  const vf = [
    // Square pixels, as the <video> element shows them.
    "scale='trunc(iw*sar/2)*2':ih",
    'setsar=1',
    "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    // A constant grid from the start: frame k is start + k / fps.
    `fps=${rate}`,
  ].join(',');
  const args = ['-hide_banner', '-nostdin', '-ss', String(Math.max(0, start)), '-i', filePath, '-an', '-sn', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'];
  const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const s = {
    child,
    fps: Number(eval_(rate)),
    width: 0,
    height: 0,
    frameBytes: 0,
    chunks: [],
    buffered: 0,
    frames: [],
    index: 0,
    ended: false,
    error: null,
    waiters: [],
    banner: '',
  };
  const id = nextId++;
  sessions.set(id, s);

  const wake = () => {
    const w = s.waiters;
    s.waiters = [];
    for (const f of w) f();
  };

  child.stderr.on('data', (d) => {
    if (s.frameBytes) return;
    s.banner += d.toString();
    const info = parseBanner(s.banner);
    if (info.width && info.height) {
      s.width = info.width;
      s.height = info.height;
      s.frameBytes = s.width * s.height * 4;
      drain();
      wake();
    }
  });
  child.stdout.on('data', (d) => {
    s.chunks.push(d);
    s.buffered += d.length;
    drain();
  });
  child.on('error', (err) => {
    s.error = err.message;
    wake();
  });
  child.on('close', (code) => {
    s.ended = true;
    if (code && !s.frames.length && !s.error) s.error = `ffmpeg exited with ${code}: ${s.banner.slice(-400)}`;
    wake();
  });

  function drain() {
    if (!s.frameBytes) return;
    while (s.buffered >= s.frameBytes) {
      const frame = Buffer.allocUnsafe(s.frameBytes);
      let filled = 0;
      while (filled < s.frameBytes) {
        const c = s.chunks[0];
        const take = Math.min(c.length, s.frameBytes - filled);
        c.copy(frame, filled, 0, take);
        filled += take;
        if (take === c.length) s.chunks.shift();
        else s.chunks[0] = c.subarray(take);
      }
      s.buffered -= s.frameBytes;
      s.frames.push(frame);
    }
    if (s.frames.length >= READ_AHEAD) child.stdout.pause();
    wake();
  }

  // Wait for the size, so the caller knows what it will be getting.
  await new Promise((resolve) => {
    const check = () => (s.frameBytes || s.error || s.ended ? resolve() : s.waiters.push(check));
    check();
  });
  if (!s.frameBytes) {
    close(id);
    throw new Error(s.error || 'ffmpeg produced no video');
  }
  return { id, width: s.width, height: s.height, fps: s.fps };
}

/**
 * Frame k of the grid. Frames before it are dropped; asking for an earlier
 * frame than the last one returned is an error (the caller seeks instead).
 * Returns null past the end of the clip.
 */
async function frame(id, k) {
  const s = sessions.get(id);
  if (!s) throw new Error('unknown decode session');
  if (k < s.index - 1) throw new Error('decoder cannot go backwards');
  if (k === s.index - 1 && s.last) return s.last;
  for (;;) {
    while (s.frames.length && s.index < k) {
      s.frames.shift();
      s.index++;
    }
    if (s.frames.length) {
      const f = s.frames.shift();
      s.index++;
      s.last = f;
      if (s.frames.length < READ_AHEAD) s.child.stdout.resume();
      return f;
    }
    if (s.ended) return null;
    if (s.error) throw new Error(s.error);
    s.child.stdout.resume();
    await new Promise((resolve) => s.waiters.push(resolve));
  }
}

function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    s.child.kill();
  } catch {
    /* already gone */
  }
}

function eval_(rate) {
  const [n, d] = String(rate).split('/').map(Number);
  return d ? n / d : n;
}

module.exports = { open, frame, close, parseBanner };
