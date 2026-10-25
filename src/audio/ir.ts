/**
 * Synthesised impulse responses.
 *
 * Everything here is generated from parameters rather than shipped as an audio
 * file, so the app stays a single self-contained bundle and the cabinet can be
 * resized by a slider instead of by swapping samples.
 */

/**
 * A small sealed-ish plastic box with a paper cone in it.
 *
 * Two things are happening: the enclosure has a handful of strongly excited
 * standing-wave modes that ring for a few milliseconds, and the cone itself
 * smears the initial impulse. Between them they produce the "boxy" colouration
 * that static EQ can only approximate, because a mode is a resonance in time as
 * well as in frequency.
 */
export function makeCabinetIR(ctx: BaseAudioContext, size: number, seed = 1): AudioBuffer {
  const sr = ctx.sampleRate;
  // 0 = a 5" portable, 1 = a wooden console cabinet.
  const lengthSec = 0.018 + size * 0.055;
  const frames = Math.max(64, Math.floor(lengthSec * sr));
  const buffer = ctx.createBuffer(2, frames, sr);
  const rng = mulberry32(Math.floor(seed * 104729) >>> 0);

  // Internal dimensions in metres, scaled by the size control.
  const w = 0.11 + size * 0.34;
  const h = 0.09 + size * 0.26;
  const d = 0.06 + size * 0.2;
  const c = 343;

  const modes: { f: number; q: number; a: number }[] = [];
  for (let nx = 0; nx <= 2; nx++) {
    for (let ny = 0; ny <= 2; ny++) {
      for (let nz = 0; nz <= 1; nz++) {
        if (nx + ny + nz === 0) continue;
        const f = (c / 2) * Math.hypot(nx / w, ny / h, nz / d);
        if (f < 90 || f > 5200) continue;
        const order = nx + ny + nz;
        modes.push({
          f,
          q: 6 + rng() * 10 - order * 1.2,
          a: 1 / Math.pow(order, 1.7),
        });
      }
    }
  }

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    // Direct sound from the cone: an impulse smeared by its own mass.
    const smear = Math.max(2, Math.floor(sr * 0.00018));
    for (let i = 0; i < smear; i++) {
      out[i] += (1 - i / smear) * 0.9;
    }
    for (const m of modes) {
      const decay = Math.exp(-Math.PI * m.f / Math.max(m.q, 0.5) / sr);
      const phase = rng() * Math.PI * 2;
      const gain = m.a * (0.35 + rng() * 0.5) * (ch === 0 ? 1 : 0.92);
      let env = gain;
      for (let i = 0; i < frames; i++) {
        out[i] += Math.sin((2 * Math.PI * m.f * i) / sr + phase) * env;
        env *= decay;
        if (env < 1e-5) break;
      }
    }
    // A little diffuse rubbish from the grille cloth and the cabinet walls.
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      out[i] += (rng() * 2 - 1) * 0.06 * Math.exp(-t * 9);
    }
  }

  normalize(buffer);
  return buffer;
}

/**
 * A small hard room — the kind of room a television is actually in. Short,
 * bright, and far too early to read as reverb, which is the point: it should
 * sound like distance, not like a plate.
 */
export function makeRoomIR(ctx: BaseAudioContext, size: number, seed = 7): AudioBuffer {
  const sr = ctx.sampleRate;
  const lengthSec = 0.12 + size * 0.5;
  const frames = Math.max(128, Math.floor(lengthSec * sr));
  const buffer = ctx.createBuffer(2, frames, sr);
  const rng = mulberry32(Math.floor(seed * 40503) >>> 0);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    // Early reflections off the walls, floor and whatever the set is standing on.
    const reflections = 9;
    for (let r = 0; r < reflections; r++) {
      const t = 0.004 + rng() * (0.03 + size * 0.05);
      const idx = Math.floor(t * sr);
      if (idx < frames) out[idx] += (rng() * 2 - 1) * (0.55 / (1 + r * 0.7));
    }
    // Exponentially decaying diffuse tail, low-passed as it decays.
    let lp = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / frames;
      const white = rng() * 2 - 1;
      lp += (white - lp) * (0.45 - t * 0.3);
      out[i] += lp * Math.exp(-t * (7 - size * 3.5)) * 0.5;
    }
  }

  normalize(buffer);
  return buffer;
}

function normalize(buffer: AudioBuffer): void {
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak <= 1e-6) return;
  const k = 0.85 / peak;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] *= k;
  }
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Waveshaper curves
 * ------------------------------------------------------------------ */

const CURVE_LEN = 4096;

export type SaturationModel = 'tape' | 'transformer' | 'transistor';

export function makeSaturationCurve(model: SaturationModel, amount: number) {
  const curve = new Float32Array(CURVE_LEN);
  const drive = 1 + amount * 14;
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    let y: number;
    switch (model) {
      case 'transformer': {
        // Asymmetric, so it generates second harmonic as well as third — the
        // reason iron sounds "fat" rather than merely compressed.
        const xd = x * drive;
        y = Math.tanh(xd + 0.22 * xd * Math.abs(xd) * 0.5) / Math.tanh(drive * 1.1);
        break;
      }
      case 'transistor': {
        // A cheap single-ended output stage clips one half before the other.
        const hi = 0.85;
        const lo = -0.62;
        const xd = x * drive;
        y = xd > hi ? hi + (xd - hi) * 0.06 : xd < lo ? lo + (xd - lo) * 0.06 : xd;
        y /= Math.max(hi * drive * 0.35, 1);
        break;
      }
      default: {
        y = Math.tanh(x * drive) / Math.tanh(drive);
        break;
      }
    }
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

/**
 * Cone breakup: clean until the excursion limit, then increasingly ugly. Unlike
 * the saturation curve this one has a hard knee, because a cone that has run
 * out of travel does not politely compress.
 */
export function makeBreakupCurve(amount: number) {
  const curve = new Float32Array(CURVE_LEN);
  const knee = 1 - amount * 0.72;
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    const a = Math.abs(x);
    let y: number;
    if (a <= knee) {
      y = x;
    } else {
      const over = (a - knee) / Math.max(1 - knee, 1e-4);
      // Rattle: a small non-monotonic wrinkle past the knee reads as buzz.
      const wrinkle = Math.sin(over * Math.PI * 3) * amount * 0.12;
      y = Math.sign(x) * (knee + (1 - knee) * (Math.tanh(over * 2.4) * 0.9 + wrinkle));
    }
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}
