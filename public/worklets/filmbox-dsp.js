/*
 * FILMBOX AudioWorklet DSP.
 *
 * Three processors, in the order the sound meets them:
 *
 *   film-transport  the film moving past the sound head: wow, flutter, the
 *                   pull-down leaking through the loop at the perforation rate,
 *                   and a camera's speed drift carried into the sound it
 *                   recorded. A modulated fractional delay, which is what
 *                   pitch instability physically is.
 *
 *   film-track      the soundtrack itself: a magnetic stripe (hiss, oxide
 *                   saturation, dropouts, print-through) or an optical track
 *                   (clipping at full modulation, the curve distortion of
 *                   variable density, crackle from dirt, the exciter lamp's
 *                   hum, a bloop at every splice).
 *
 *   film-projector  the machine in the room: the claw striking once a frame,
 *                   the shutter, the fan and the motor. Not in the signal path
 *                   at all — it is a sound source beside the listener.
 *
 * Every discrete event — a splice, how hard the claw struck frame n — comes
 * from film-events.js, the same module the picture's frame clock evaluates,
 * so the sound and the picture agree without exchanging a single message.
 *
 * Each processor keeps its own media clock so the same code produces the same
 * result in a realtime AudioContext and in an OfflineAudioContext during
 * export. The host corrects the clock with `sync` messages on seek.
 */

import { bhash, clawStrike, ihash, speedOffset, spliceAt, snoise } from './film-events.js';

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** xorshift32 — fast, seedable, good enough for noise. */
class Rng {
  constructor(seed) {
    this.s = (seed | 0) || 0x9e3779b9;
  }
  next() {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x | 0;
    return (x >>> 0) / 4294967296;
  }
  bipolar() {
    return this.next() * 2 - 1;
  }
}

/** A two-pole resonator, rung by impulses: the sound of a struck part. */
class Resonator {
  constructor() {
    this.y1 = 0;
    this.y2 = 0;
    this.a1 = 0;
    this.a2 = 0;
  }
  tune(freq, decaySec) {
    const r = Math.exp(-1 / (Math.max(decaySec, 1e-4) * sampleRate));
    const w = (2 * Math.PI * clamp(freq, 20, sampleRate * 0.45)) / sampleRate;
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
  }
  step(x) {
    const y = x + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

class BaseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = (options && options.processorOptions) || {};
    this.params = po.params || {};
    this.seed = po.seed | 0;
    this.rng = new Rng(Math.floor((this.seed + 1) * 2654435761) ^ (po.salt || 0x5f356495));
    this.time = 0;
    this.playing = true;
    this.alive = true;
    this.port.onmessage = (event) => this.onMessage(event.data);
  }

  onMessage(msg) {
    if (!msg) return;
    switch (msg.type) {
      case 'params':
        this.params = msg.params || {};
        break;
      case 'sync':
        if (typeof msg.time === 'number') this.time = msg.time;
        if (typeof msg.playing === 'boolean') this.playing = msg.playing;
        break;
      case 'dispose':
        this.alive = false;
        break;
    }
  }

  p(key, fallback) {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  b(key, fallback) {
    const v = this.params[key];
    return typeof v === 'boolean' ? v : fallback;
  }

  /**
   * Media time moves faster than sample time when a projector runs faster
   * than the camera did: the source itself is being played faster.
   */
  advance(frames) {
    if (this.playing) this.time += (frames / sampleRate) * this.p('film.mediaRate', 1);
  }

  /** Camera frame rate, projector frame rate, and the source clock's speed. */
  rates() {
    const cam = Math.max(this.p('film.cameraFps', 18), 1);
    const proj = Math.max(this.p('film.projectorFps', cam), 1);
    return { cam, proj };
  }

  /** Splice on film frame n, as the picture sees it. */
  spliceOn(n) {
    if (!this.b('splice.enabled', true)) return false;
    const { proj } = this.rates();
    return spliceAt(n, this.seed, this.p('splice.rate', 0), proj) > 0;
  }
}

/* ------------------------------------------------------------------ *
 * film-transport
 * ------------------------------------------------------------------ */

const MAX_DELAY_SEC = 1.2;
const BASE_DELAY_SEC = 0.06;

class TransportProcessor extends BaseProcessor {
  constructor(options) {
    super(options);
    this.size = Math.ceil(MAX_DELAY_SEC * sampleRate) + 4;
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
    this.writeIndex = 0;
    this.wowPhase = 0;
    this.flutterPhase = 0;
    this.drift = 0;
    this.driftTarget = 0;
    this.smoothDelay = BASE_DELAY_SEC;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    const frames = output[0].length;

    const enabled = this.b('transport.enabled', true);
    const wowRate = this.p('transport.wowRate', 0.8);
    const wowDepth = this.p('transport.wowDepth', 0.15);
    const flutterRate = this.p('transport.flutterRate', 11);
    const flutterDepth = this.p('transport.flutterDepth', 0.08);
    const sprocket = this.p('transport.sprocket', 0);
    const driftAmt = this.p('transport.drift', 0.1);

    const { cam } = this.rates();
    const perfs = this.p('film.perfsPerFrame', 1);
    // The intermittent pull-down is isolated from the sound head by a loop and
    // a flywheel. Some of it always gets through, at the perforation rate.
    const sprocketHz = cam * perfs;

    // A camera running slow recorded its sound slow too (single-system sound).
    const linkOn = this.b('link.enabled', true);
    const speedLink = linkOn ? this.p('link.speedToPitch', 1) : 0;
    const camDrift = this.b('camera.enabled', true) ? this.p('camera.speedDrift', 0) : 0;
    const speedDelayBase = camDrift * speedLink * 1.25;

    // Pitch deviation ε at modulation rate f needs a delay amplitude of
    // ε / (2πf) seconds, so the audible wobble is independent of the rate.
    const wowAmp = enabled ? Math.min((wowDepth * 0.02) / (2 * Math.PI * Math.max(wowRate, 0.05)), 0.04) : 0;
    const flutterAmp = enabled ? Math.min((flutterDepth * 0.008) / (2 * Math.PI * Math.max(flutterRate, 1)), 0.01) : 0;
    const sprocketAmp = enabled ? (sprocket * 0.004) / (2 * Math.PI * sprocketHz) : 0;
    const driftAmp = enabled ? driftAmt * 0.004 : 0;

    const channels = Math.min(output.length, 2);
    const dt = 1 / sampleRate;
    const mediaRate = this.p('film.mediaRate', 1);

    // Speed drift is slow; evaluate it per block, at the block's media time,
    // and glide the delay towards it so there is no zipper.
    const speedTarget = speedLink > 0 && camDrift > 0
      ? speedDelayBase - speedOffset(this.time, this.seed, camDrift) * speedLink
      : 0;

    for (let i = 0; i < frames; i++) {
      this.wowPhase += wowRate * dt;
      if (this.wowPhase > 1) this.wowPhase -= 1;
      this.flutterPhase += flutterRate * dt;
      if (this.flutterPhase > 1) this.flutterPhase -= 1;
      if ((i & 255) === 0) this.driftTarget = this.rng.bipolar();
      this.drift += (this.driftTarget - this.drift) * 0.00012;

      const t = this.time + i * dt * mediaRate;
      const target =
        BASE_DELAY_SEC +
        Math.max(0, speedTarget) +
        Math.sin(this.wowPhase * 2 * Math.PI) * wowAmp +
        Math.sin(this.flutterPhase * 2 * Math.PI) * flutterAmp +
        Math.sin(2 * Math.PI * sprocketHz * t) * sprocketAmp +
        this.drift * driftAmp;
      this.smoothDelay += (target - this.smoothDelay) * 0.002;
      const delaySec = clamp(this.smoothDelay, 0.001, MAX_DELAY_SEC - 0.002);
      const readPos = this.writeIndex - delaySec * sampleRate;

      for (let c = 0; c < channels; c++) {
        const buf = this.buffers[c];
        const inCh = input && input[c] ? input[c] : input && input[0] ? input[0] : null;
        buf[this.writeIndex] = inCh ? inCh[i] : 0;
        output[c][i] = enabled ? cubicRead(buf, readPos, this.size) : inCh ? inCh[i] : 0;
      }
      this.writeIndex = (this.writeIndex + 1) % this.size;
    }

    this.advance(frames);
    return this.alive;
  }
}

/** Catmull-Rom read from a circular buffer at a fractional position. */
function cubicRead(buf, pos, size) {
  let p = pos;
  while (p < 0) p += size;
  const i = Math.floor(p);
  const f = p - i;
  const y0 = buf[(i - 1 + size) % size];
  const y1 = buf[i % size];
  const y2 = buf[(i + 1) % size];
  const y3 = buf[(i + 2) % size];
  const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c = -0.5 * y0 + 0.5 * y2;
  return ((a * f + b) * f + c) * f + y1;
}

/* ------------------------------------------------------------------ *
 * film-track
 * ------------------------------------------------------------------ */

const MAX_CLICKS = 64;
const TRACK = { magnetic: 0, va: 1, vd: 2, silent: 3 };

class TrackProcessor extends BaseProcessor {
  constructor(options) {
    super(options);
    // Print-through needs the programme as it was a reel's turn ago (or a
    // turn ahead, which only an offline render can supply on input 1).
    this.echoSize = Math.ceil(5.5 * sampleRate);
    this.echo = new Float32Array(this.echoSize);
    this.echoIndex = 0;

    this.hissLp = 0;
    this.hissLp2 = 0;
    this.dropRemaining = 0;
    this.dropTotal = 0;
    this.dropDepth = 0;

    this.clickFreq = new Float32Array(MAX_CLICKS);
    this.clickAmp = new Float32Array(MAX_CLICKS);
    this.clickDecay = new Float32Array(MAX_CLICKS);
    this.clickPhase = new Float32Array(MAX_CLICKS);
    this.clickAge = new Float32Array(MAX_CLICKS);
    this.clickActive = new Uint8Array(MAX_CLICKS);
    this.nextClick = 0;

    this.humPhase = 0;
    this.ampHumPhase = 0;
    this.lastFrame = -1;
    this.bloop = 0;
    this.bloopPhase = 0;
    this.pop = 0;
  }

  spawnClick(tone, spread, amp, decayMs) {
    const idx = this.nextClick;
    this.nextClick = (this.nextClick + 1) % MAX_CLICKS;
    this.clickFreq[idx] = clamp(tone * Math.pow(2, this.rng.bipolar() * spread * 2), 60, sampleRate * 0.45);
    this.clickAmp[idx] = amp;
    this.clickDecay[idx] = Math.exp(-1 / (Math.max(decayMs, 0.15) * 0.001 * (0.4 + this.rng.next() * 1.4) * sampleRate));
    this.clickPhase[idx] = this.rng.next();
    this.clickAge[idx] = 1;
    this.clickActive[idx] = 1;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const future = inputs[1];
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    const frames = output[0].length;
    const dt = 1 / sampleRate;

    const audioOn = this.b('audio.enabled', true);
    const type = this.p('track.code', 0);
    const silent = type === TRACK.silent;
    const magnetic = type === TRACK.magnetic;
    const optical = type === TRACK.va || type === TRACK.vd;
    const magOn = magnetic && this.b('magnetic.enabled', true) && audioOn;
    const optOn = optical && this.b('optical.enabled', true) && audioOn;
    const linkOn = this.b('link.enabled', true);

    // ---- magnetic ----
    const hiss = magOn ? dbToGain(this.p('magnetic.hiss', -50)) : 0;
    const magSat = magOn ? this.p('magnetic.saturation', 0.3) : 0;
    const dropRate = magOn ? this.p('magnetic.dropouts', 3) / 60 : 0;
    const dropDepth = this.p('magnetic.dropoutDepth', 0.6);
    const printGain = magOn ? dbToGain(this.p('magnetic.printThrough', -52)) : 0;
    const printDelay = clamp(this.p('magnetic.printDelay', 1.8), 0.05, 5);
    const preEcho = this.b('magnetic.preEcho', true);

    // ---- optical ----
    const modulation = this.p('optical.modulation', 0.8);
    const spread = optOn ? this.p('optical.imageSpread', 0.3) : 0;
    const trackNoise = optOn ? dbToGain(this.p('optical.noise', -56)) : 0;
    const pictureDirt = this.b('filmdirt.enabled', true)
      ? this.p('filmdirt.dust', 0) + this.p('filmdirt.fibres', 0) * 0.5
      : 0;
    const dirtLink = linkOn ? this.p('link.dirtToCrackle', 0.5) : 0;
    const crackleRate = optOn ? this.p('optical.crackle', 2) + dirtLink * pictureDirt * 40 : 0;
    const crackleGain = dbToGain(this.p('optical.crackleLevel', -24));
    const ticks = optOn ? this.p('optical.ticks', 0) : 0;
    const mains = this.p('projector.mainsHz', 60);
    const ripple = this.b('projector.enabled', true) ? this.p('projector.lampRipple', 0) : 0;
    const lampLink = linkOn ? this.p('link.lampToHum', 0.5) : 0;
    // One supply: the ripple the picture shows as flicker is heard as hum.
    const exciter = optOn ? dbToGain(this.p('optical.exciterHum', -72)) + lampLink * ripple * 0.25 : 0;

    // ---- splices ----
    const popLink = linkOn ? this.p('link.spliceToPop', 0.7) : 0;
    const { cam } = this.rates();

    // ---- amplifier hum ----
    const ampHum = this.b('playback.enabled', true) && audioOn ? dbToGain(this.p('playback.hum', -70)) : 0;

    const left = output[0];
    const right = output.length > 1 ? output[1] : null;

    const mediaRate = this.p('film.mediaRate', 1);
    for (let i = 0; i < frames; i++) {
      const t = this.time + i * dt * mediaRate;
      const inL = input && input[0] ? input[0][i] : 0;
      const inR = input && input[1] ? input[1][i] : inL;
      let x = silent ? 0 : (inL + inR) * 0.5;

      // Film frame passing the sound head right now. A splice is heard when
      // its frame passes, as the picture jumps.
      const n = Math.floor(t * cam + 1e-6);
      if (n !== this.lastFrame && this.playing) {
        this.lastFrame = n;
        if (popLink > 0 && this.spliceOn(n)) {
          if (optical) {
            // A splice through an optical track is a "bloop": a low thump the
            // laboratories painted over to hide. They did not always manage.
            this.bloop = popLink;
            this.bloopPhase = 0;
          } else {
            this.pop = popLink;
            this.dropRemaining = 0.03;
            this.dropTotal = 0.03;
            this.dropDepth = 0.9;
            this.spawnClick(2600, 0.6, popLink * 0.8, 2);
          }
        }
        if (ticks > 0) this.spawnClick(1800, 0.3, ticks * (0.4 + 0.6 * Math.abs(bhash(n, this.seed, 401))) * 0.25, 1.2);
      }

      // ---- the medium ----
      if (magnetic && magOn) {
        // Print-through: the adjacent winding's programme, faintly.
        this.echo[this.echoIndex] = x;
        let echo;
        if (preEcho && future && future[0]) {
          echo = future[0][i];
        } else {
          let r = this.echoIndex - Math.round(printDelay * sampleRate);
          if (r < 0) r += this.echoSize;
          echo = this.echo[r];
        }
        this.echoIndex = (this.echoIndex + 1) % this.echoSize;
        x += echo * printGain;

        // Oxide saturation: soft and symmetric.
        if (magSat > 0) {
          // Unity gain for quiet signals; loud ones run into the oxide.
          const k = 1 + magSat * 4;
          x = Math.tanh(x * k) / k;
        }

        // Hiss: a narrow stripe is a noisy one, and its noise is bright.
        if (hiss > 0) {
          const w = this.rng.bipolar();
          this.hissLp += (w - this.hissLp) * 0.35;
          x += (w - this.hissLp * 0.6) * hiss;
        }

        // Dropouts: oxide flaked off, abrupt in, slower out.
        if (this.dropRemaining <= 0 && dropRate > 0 && this.rng.next() < dropRate * dt) {
          this.dropTotal = 0.02 + this.rng.next() * 0.12;
          this.dropRemaining = this.dropTotal;
          this.dropDepth = dropDepth * (0.4 + this.rng.next() * 0.6);
        }
      } else if (optical && optOn) {
        // Modulation against the track's full width. Past 100% the variable
        // area trace simply runs out of track: a hard, ugly clip.
        let m = x * modulation * 1.25;
        if (type === TRACK.va) {
          m = clamp(m, -1, 1);
          // Image spread fills in the troughs more than the peaks.
          m += spread * 0.12 * (m * m - 0.33);
        } else {
          // Variable density is recorded through the film's own curve, so its
          // distortion is the curve's: asymmetric, even-harmonic.
          const g = 1.35 + spread * 0.4;
          const base = Math.max(1 + 0.8 * clamp(m, -1.2, 1.2), 0.02);
          m = (Math.pow(base, g) - 1) / (0.8 * g);
          m = clamp(m, -1.2, 1.4);
        }
        x = m / (modulation * 1.25);

        // Grain in the track, heard as hiss; variable density's is louder and darker.
        if (trackNoise > 0) {
          const w = this.rng.bipolar();
          this.hissLp2 += (w - this.hissLp2) * (type === TRACK.vd ? 0.18 : 0.45);
          x += (type === TRACK.vd ? this.hissLp2 * 1.6 : w - this.hissLp2 * 0.4) * trackNoise;
        }

        // Dirt on the track: each speck crossing the slit is a click.
        if (crackleRate > 0 && this.rng.next() < crackleRate * dt) {
          const u = Math.max(this.rng.next(), 1e-4);
          this.spawnClick(2200, 0.7, Math.min(Math.pow(u, 2.6), 1), 1.6);
        }

        // The exciter lamp on AC: hum at twice the mains frequency, with its
        // harmonics, because the filament cools a little every half cycle.
        if (exciter > 0) {
          this.humPhase += 2 * mains * dt;
          if (this.humPhase > 1) this.humPhase -= 1;
          const ph = this.humPhase * 2 * Math.PI;
          x += (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)) * exciter;
        }
      }

      // Dropout envelope (magnetic dropouts and splices).
      let gain = 1;
      if (this.dropRemaining > 0) {
        const u = 1 - this.dropRemaining / Math.max(this.dropTotal, 1e-6);
        const shape = u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9;
        gain = 1 - this.dropDepth * clamp(shape, 0, 1);
        this.dropRemaining -= dt;
      }
      x *= gain;

      // Clicks: resonators rung by an impulse.
      let clicks = 0;
      for (let v = 0; v < MAX_CLICKS; v++) {
        if (!this.clickActive[v]) continue;
        this.clickPhase[v] += this.clickFreq[v] * dt;
        if (this.clickPhase[v] > 1) this.clickPhase[v] -= 1;
        this.clickAge[v] *= this.clickDecay[v];
        if (this.clickAge[v] < 1e-4) {
          this.clickActive[v] = 0;
          continue;
        }
        clicks += Math.sin(this.clickPhase[v] * 2 * Math.PI) * this.clickAge[v] * this.clickAmp[v];
      }
      x += clicks * (optical ? crackleGain : 0.5);

      // The bloop: a falling low thump.
      if (this.bloop > 0.0005) {
        this.bloopPhase += (55 + 40 * this.bloop) * dt;
        x += Math.sin(this.bloopPhase * 2 * Math.PI) * this.bloop * 0.45;
        this.bloop *= 0.9992;
      }
      this.pop *= 0.999;

      // The amplifier's own hum, at the mains fundamental and its odd harmonics.
      if (ampHum > 0) {
        this.ampHumPhase += mains * dt;
        if (this.ampHumPhase > 1) this.ampHumPhase -= 1;
        const ph = this.ampHumPhase * 2 * Math.PI;
        x += (Math.sin(ph) + 0.5 * Math.sin(3 * ph) + 0.25 * Math.sin(5 * ph)) * ampHum;
      }

      if (!audioOn) x = (inL + inR) * 0.5;
      left[i] = x;
      if (right) right[i] = x;
    }

    this.advance(frames);
    return this.alive;
  }
}

/* ------------------------------------------------------------------ *
 * film-projector
 * ------------------------------------------------------------------ */

class ProjectorProcessor extends BaseProcessor {
  constructor(options) {
    super(options);
    this.modes = [new Resonator(), new Resonator(), new Resonator(), new Resonator()];
    this.rattle = [new Resonator(), new Resonator()];
    this.lastFrame = -1;
    this.rattleAt = -1;
    this.rattleAmp = 0;
    this.burst = 0;
    this.fan = 0;
    this.fan2 = 0;
    this.motorPhase = 0;
    this.whinePhase = 0;
    this.tunedTone = -1;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    const frames = output[0].length;
    const dt = 1 / sampleRate;
    const on = this.b('projnoise.enabled', true);
    const level = on ? dbToGain(this.p('projnoise.level', -32)) : 0;
    const claw = this.p('projnoise.claw', 0.7);
    const tone = this.p('projnoise.tone', 1800);
    const wear = this.p('projnoise.wear', 0.3);
    const shutter = this.p('projnoise.shutter', 0.4);
    const motor = this.p('projnoise.motor', 0.3);
    const linkOn = this.b('link.enabled', true);
    const weaveLink = linkOn ? this.p('link.weaveToClatter', 0.6) : 0;
    const { cam, proj } = this.rates();
    const blades = Math.max(this.p('projector.bladesCount', 3), 2);
    const mains = this.p('projector.mainsHz', 60);

    if (tone !== this.tunedTone) {
      this.tunedTone = tone;
      // The mechanism's modes: a cluster of inharmonic resonances, as a
      // struck metal casting has.
      const ratios = [1, 1.47, 2.31, 3.6];
      const decays = [0.018, 0.012, 0.008, 0.005];
      this.modes.forEach((m, k) => m.tune(tone * ratios[k], decays[k]));
      this.rattle[0].tune(tone * 0.62, 0.01);
      this.rattle[1].tune(tone * 1.9, 0.006);
    }

    const left = output[0];
    const right = output.length > 1 ? output[1] : null;
    const framePeriod = 1 / proj;

    const mediaRate = this.p('film.mediaRate', 1);
    for (let i = 0; i < frames; i++) {
      // Frames pass at the projector's rate; in media time that is the
      // camera's rate, because the media itself is playing faster or slower.
      const t = this.time + i * dt * mediaRate;
      const n = Math.floor(t * cam + 1e-6);
      let excite = 0;
      if (this.playing && level > 0 && n !== this.lastFrame) {
        this.lastFrame = n;
        // How hard the claw struck this frame: the same number that throws
        // the picture in the gate. A frame that jumps is a frame that clacks.
        const strike = clawStrike(n, this.seed);
        const amp = claw * (1 - weaveLink * 0.6 + weaveLink * 1.2 * strike);
        excite += amp;
        this.burst = amp * 0.6;
        // A worn mechanism rattles a second time, a little late and uneven.
        if (wear > 0) {
          this.rattleAt = t + framePeriod * (0.28 + 0.08 * bhash(n, this.seed, 503)) * (cam / proj);
          this.rattleAmp = wear * (0.4 + 0.6 * ihash(n, this.seed, 504));
        }
      }
      let rattleExcite = 0;
      if (this.rattleAt > 0 && t >= this.rattleAt) {
        rattleExcite = this.rattleAmp;
        this.rattleAt = -1;
      }

      // Noise burst shaped by the modes: a clack, not a beep.
      const noise = this.rng.bipolar();
      const drive = excite * 0.8 + this.burst * noise;
      this.burst *= 0.993;
      let clack = 0;
      for (let k = 0; k < this.modes.length; k++) clack += this.modes[k].step(drive * 0.02) * (1 - k * 0.18);
      let rat = 0;
      const rd = rattleExcite * 0.8 + rattleExcite * noise * 0.3;
      rat += this.rattle[0].step(rd * 0.02) + this.rattle[1].step(rd * 0.012);

      // The shutter and the fan: air, chopped at the blade rate.
      const bladePhase = (t * proj * blades) % 1;
      const chop = 0.6 + 0.4 * Math.cos(bladePhase * 2 * Math.PI);
      this.fan += (noise - this.fan) * 0.08;
      this.fan2 += (this.fan - this.fan2) * 0.08;
      const air = this.fan2 * chop * shutter * 0.9;

      // The motor: a hum locked to the mains for a synchronous motor, plus
      // the whine of its gearing.
      this.motorPhase += mains * dt;
      if (this.motorPhase > 1) this.motorPhase -= 1;
      this.whinePhase += proj * 24 * dt;
      if (this.whinePhase > 1) this.whinePhase -= 1;
      const mot =
        motor * (Math.sin(this.motorPhase * 2 * Math.PI) * 0.25 + Math.sin(this.whinePhase * 2 * Math.PI) * 0.06 *
        (1 + 0.3 * snoise(t * 0.7, this.seed, 505)));

      const v = this.playing ? (clack * 1.2 + rat + air + mot) * level : 0;
      left[i] = v;
      if (right) right[i] = v;
    }

    this.advance(frames);
    return this.alive;
  }
}

registerProcessor('film-transport', TransportProcessor);
registerProcessor('film-track', TrackProcessor);
registerProcessor('film-projector', ProjectorProcessor);
