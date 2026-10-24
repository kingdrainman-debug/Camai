/*
 * CRTBOX AudioWorklet DSP.
 *
 * Two processors live here:
 *
 *   crt-transport — pitch instability (wow, flutter, drift, scrape) and tape
 *                   dropouts. Needs a modulated fractional delay line, which is
 *                   not expressible with the built-in Web Audio nodes at the
 *                   quality we want, hence the worklet.
 *
 *   crt-noise     — the noise bed and the crackle generator. Sample-accurate
 *                   Poisson event scheduling is likewise not something the
 *                   built-in nodes can do.
 *
 * Both processors keep their own media clock so that the same code produces
 * identical results in a realtime AudioContext and in an OfflineAudioContext
 * during export. The host corrects the clock with `sync` messages on seek.
 *
 * The deterministic noise functions below mirror the ones in
 * src/video/renderer.ts on purpose: picture and sound have to agree about when
 * the set is glitching, and the cheapest way to guarantee that is for both to
 * evaluate the same function of media time rather than message each other.
 */

/* ------------------------------------------------------------------ *
 * shared helpers
 * ------------------------------------------------------------------ */

function hash1(n) {
  let p = Math.abs(n * 0.1031) % 1;
  p *= p + 33.33;
  p *= p + p;
  return p % 1;
}

function valueNoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return hash1(i) * (1 - s) + hash1(i + 1) * s;
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** xorshift32 — fast, seedable, good enough for noise and event scheduling. */
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

/** Mirrors CrtRenderer.advanceState so audio and picture glitch together. */
function glitchAt(time, seed, tearing, vHold, headSwitch, signalLoss) {
  const r = valueNoise(time * 3.1 + seed * 17.0);
  const burst = valueNoise(time * 0.7 + seed * 3.0);
  const v =
    Math.max(0, r - (1 - tearing * 0.5)) * 2 +
    Math.max(0, burst - (1 - vHold * 0.9)) * 1.5 +
    headSwitch * 0.12;
  return Math.min(1, v + signalLoss);
}

class BaseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.params = (options && options.processorOptions && options.processorOptions.params) || {};
    this.seed = (options && options.processorOptions && options.processorOptions.seed) || 1;
    this.rng = new Rng(Math.floor(this.seed * 2654435761) ^ 0x5f356495);
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
      case 'patch':
        Object.assign(this.params, msg.params || {});
        break;
      case 'sync':
        if (typeof msg.time === 'number') this.time = msg.time;
        if (typeof msg.playing === 'boolean') this.playing = msg.playing;
        break;
      case 'event':
        this.onEvent(msg);
        break;
      case 'dispose':
        this.alive = false;
        break;
    }
  }

  onEvent() {}

  p(key, fallback) {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  b(key, fallback) {
    const v = this.params[key];
    return typeof v === 'boolean' ? v : fallback;
  }

  advance(frames) {
    if (this.playing) this.time += frames / sampleRate;
  }
}

/* ------------------------------------------------------------------ *
 * crt-transport — wow, flutter, drift, scrape, dropouts
 * ------------------------------------------------------------------ */

const MAX_DELAY_SEC = 0.5;
const BASE_DELAY_SEC = 0.08;

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
    this.scrapeState = 0;

    // Dropout state machine.
    this.dropoutRemaining = 0;
    this.dropoutTotal = 0;
    this.dropoutDepth = 0;
    this.clickEnv = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    const frames = output[0].length;

    const enabled = this.b('transport.enabled', true);
    const wowRate = this.p('transport.wowRate', 0.62);
    const wowDepth = this.p('transport.wowDepth', 0.18);
    const flutterRate = this.p('transport.flutterRate', 9.3);
    const flutterDepth = this.p('transport.flutterDepth', 0.09);
    const driftAmt = this.p('transport.drift', 0.2);
    const scrape = this.p('transport.scrape', 0.12);
    const dropRate = this.p('transport.dropoutRate', 4) / 60;
    const dropDepth = this.p('transport.dropoutDepth', 0.7);
    const dropLen = this.p('transport.dropoutLength', 45) / 1000;

    // A/V link: the same damaged patch of tape tears the picture and drops the
    // sound, so picture glitches raise the dropout probability.
    const linkOn = this.b('link.enabled', true);
    const glitchLink = linkOn ? this.p('link.glitchToDropout', 0.6) : 0;
    const glitch = glitchLink > 0
      ? glitchAt(
          this.time,
          this.seed,
          this.p('sync.tearing', 0),
          this.p('sync.vHold', 0),
          this.p('sync.headSwitch', 0),
          this.p('signal.signalLoss', 0),
        )
      : 0;

    // Pitch deviation ε at modulation rate f needs a delay amplitude of
    // ε / (2πf) seconds, so the audible wobble is independent of the rate.
    const wowAmp = enabled ? Math.min((wowDepth * 0.032) / (2 * Math.PI * Math.max(wowRate, 0.05)), 0.03) : 0;
    const flutterAmp = enabled ? Math.min((flutterDepth * 0.012) / (2 * Math.PI * Math.max(flutterRate, 1)), 0.01) : 0;
    const driftAmp = enabled ? driftAmt * 0.006 : 0;
    const scrapeAmp = enabled ? scrape * 0.00006 : 0;

    const channels = Math.min(output.length, 2);
    const dt = 1 / sampleRate;

    for (let i = 0; i < frames; i++) {
      // --- modulation ---
      this.wowPhase += wowRate * dt;
      if (this.wowPhase > 1) this.wowPhase -= 1;
      this.flutterPhase += flutterRate * dt;
      if (this.flutterPhase > 1) this.flutterPhase -= 1;

      // Random walk, smoothed. Without this the wobble reads as an LFO rather
      // than as a mechanism that is genuinely wearing out.
      if ((i & 255) === 0) this.driftTarget = this.rng.bipolar();
      this.drift += (this.driftTarget - this.drift) * 0.00012;

      this.scrapeState += (this.rng.bipolar() - this.scrapeState) * 0.35;

      let delaySec =
        BASE_DELAY_SEC +
        Math.sin(this.wowPhase * 2 * Math.PI) * wowAmp +
        Math.sin(this.flutterPhase * 2 * Math.PI) * flutterAmp +
        this.drift * driftAmp +
        this.scrapeState * scrapeAmp;
      delaySec = clamp(delaySec, 0.001, MAX_DELAY_SEC - 0.002);

      // --- dropouts ---
      if (this.dropoutRemaining <= 0) {
        const rate = dropRate * (1 + glitch * glitchLink * 12);
        if (this.rng.next() < rate * dt) {
          this.dropoutTotal = dropLen * (0.4 + this.rng.next() * 1.6);
          this.dropoutRemaining = this.dropoutTotal;
          this.dropoutDepth = dropDepth * (0.5 + this.rng.next() * 0.5);
          this.clickEnv = 1;
        }
      }
      let dropGain = 1;
      if (this.dropoutRemaining > 0) {
        const t = 1 - this.dropoutRemaining / Math.max(this.dropoutTotal, 1e-6);
        // Fast in, slower out — oxide loss is abrupt, contact recovery is not.
        const shape = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
        dropGain = 1 - this.dropoutDepth * clamp(shape, 0, 1);
        this.dropoutRemaining -= dt;
      }
      // The edge of a dropout is a click, not a fade.
      const click = this.clickEnv > 0.0001 ? this.clickEnv * this.rng.bipolar() * 0.12 : 0;
      this.clickEnv *= 0.9986;

      const readPos = this.writeIndex - delaySec * sampleRate;

      for (let c = 0; c < channels; c++) {
        const buf = this.buffers[c];
        const inCh = input && input[c] ? input[c] : input && input[0] ? input[0] : null;
        buf[this.writeIndex] = inCh ? inCh[i] : 0;

        let v;
        if (!enabled) {
          v = inCh ? inCh[i] : 0;
        } else {
          v = cubicRead(buf, readPos, this.size);
        }
        output[c][i] = v * dropGain + click;
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
  const i0 = (i - 1 + size) % size;
  const i1 = i % size;
  const i2 = (i + 1) % size;
  const i3 = (i + 2) % size;
  const y0 = buf[i0], y1 = buf[i1], y2 = buf[i2], y3 = buf[i3];
  const a = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
  const b = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c = -0.5 * y0 + 0.5 * y2;
  return ((a * f + b) * f + c) * f + y1;
}

/* ------------------------------------------------------------------ *
 * crt-noise — hum, whine, hiss, static, rumble, crackle
 * ------------------------------------------------------------------ */

const MAX_CLICKS = 96;

class NoiseProcessor extends BaseProcessor {
  constructor(options) {
    super(options);
    // 'signal' sits in front of the speaker (it is part of the programme the
    // amplifier is fed). 'acoustic' is added after it, because the flyback
    // transformer and the cabinet are not in the signal path at all — they are
    // sound sources in the room, and low-passing them through a paper cone
    // would be wrong.
    this.bus = (options && options.processorOptions && options.processorOptions.bus) || 'signal';

    this.humPhases = new Float32Array(32);
    for (let i = 0; i < this.humPhases.length; i++) this.humPhases[i] = this.rng.next();
    this.flybackPhase = 0;
    this.hissState = 0;
    this.hissHp = 0;
    this.rumbleState = 0;
    this.rumbleState2 = 0;
    this.envelope = 0;

    // Crackle voices: each is a resonator rung by an impulse, which is exactly
    // what a decaying click is.
    this.clickFreq = new Float32Array(MAX_CLICKS);
    this.clickAmp = new Float32Array(MAX_CLICKS);
    this.clickDecay = new Float32Array(MAX_CLICKS);
    this.clickPhase = new Float32Array(MAX_CLICKS);
    this.clickAge = new Float32Array(MAX_CLICKS);
    this.clickActive = new Uint8Array(MAX_CLICKS);
    this.nextClick = 0;

    this.burstRemaining = 0;
    this.burstDensity = 0;

    this.thump = 0;
    this.thumpPhase = 0;
    this.humSwell = 0;
  }

  onEvent(msg) {
    if (msg.name === 'degauss') {
      // The degauss coil is a big inductive load switched straight onto the
      // mains. You hear the surge as much as you see the ripple.
      this.thump = clamp(msg.amount || 1, 0, 1);
      this.thumpPhase = 0;
      this.humSwell = 1;
    } else if (msg.name === 'power') {
      this.thump = 0.6 * clamp(msg.amount || 1, 0, 1);
      this.thumpPhase = 0;
    }
  }

  spawnClick(tone, spread, impulsiveness, decayMs) {
    const idx = this.nextClick;
    this.nextClick = (this.nextClick + 1) % MAX_CLICKS;
    const octaves = (this.rng.bipolar()) * spread * 2.2;
    this.clickFreq[idx] = clamp(tone * Math.pow(2, octaves), 60, sampleRate * 0.45);
    // Power-law amplitudes: mostly tiny ticks, occasionally a bang. A uniform
    // distribution sounds like rain on a tent; this sounds like a bad joint.
    const u = Math.max(this.rng.next(), 1e-4);
    const alpha = 0.6 + impulsiveness * 3.4;
    this.clickAmp[idx] = Math.min(Math.pow(u, alpha), 1);
    const jitter = 0.35 + this.rng.next() * 1.7;
    this.clickDecay[idx] = Math.exp(-1 / (Math.max(decayMs, 0.15) * 0.001 * jitter * sampleRate));
    this.clickPhase[idx] = this.rng.next();
    this.clickAge[idx] = 1;
    this.clickActive[idx] = 1;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return this.alive;
    const frames = output[0].length;
    const input = inputs[0];

    const enabled = this.b('noise.enabled', true);
    const crackleOn = this.b('crackle.enabled', true);
    const isSignal = this.bus === 'signal';
    const dt = 1 / sampleRate;

    const region = this.p('audio.regionCode', 0);
    const mains = region > 0.5 ? 50 : 60;
    const lineRate = region > 0.5 ? 15625 : 15734.264;

    // ---- A/V link ----
    const linkOn = this.b('link.enabled', true);
    const humBarLink = linkOn ? this.p('link.humBarToHum', 0.7) : 0;
    const lossLink = linkOn ? this.p('link.lossToStatic', 0.9) : 0;
    const humBarPhase = this.p('link.humPhase', 0);
    const humBar = this.p('tube.humBar', 0);
    // Same Gaussian the tube shader draws the bar with, evaluated at the centre
    // of the screen: when the bright band is crossing, the hum is loudest.
    const barPos = Math.abs(((0.5 + humBarPhase) % 1) - 0.5);
    const barWidth = Math.max(this.p('tube.humBarWidth', 0.35), 0.02);
    const bar = Math.exp(-(barPos * barPos) / (2 * barWidth * barWidth * 0.25));
    const humBoost = 1 + humBarLink * humBar * (bar * 1.6 - 0.4);

    const signalLoss = this.p('signal.signalLoss', 0);

    // ---- levels ----
    const humGain = enabled && isSignal ? dbToGain(this.p('noise.humLevel', -44)) : 0;
    const hissGain = enabled && isSignal ? dbToGain(this.p('noise.hissLevel', -54)) : 0;
    const staticBase = enabled && isSignal ? dbToGain(this.p('noise.staticLevel', -70)) : 0;
    const staticGain = staticBase + (isSignal && enabled ? lossLink * signalLoss * 0.5 : 0);
    const flybackGain = enabled && !isSignal ? dbToGain(this.p('noise.flybackLevel', -52)) : 0;
    const rumbleGain = enabled && !isSignal ? this.p('noise.rumble', 0.15) * 0.06 : 0;
    const crackleGain = crackleOn && isSignal ? dbToGain(this.p('crackle.level', -30)) : 0;

    const humHarmonics = Math.max(1, Math.round(this.p('noise.humHarmonics', 7)));
    const humMode = this.p('noise.humModeCode', 2);
    const humTilt = this.p('noise.humTilt', 0.35);
    const humDrift = this.p('noise.humDrift', 0.15);
    const hissTone = this.p('noise.hissTone', 2200);
    const hissBreathing = this.p('noise.hissBreathing', 0.3);
    const flybackDrift = this.p('noise.flybackDrift', 0.12);
    const flybackSqueal = this.p('noise.flybackSqueal', 0.3);
    const flybackAudible = this.b('noise.flybackAudible', false);

    const crackleRate = this.p('crackle.rate', 14);
    const crackleTone = this.p('crackle.tone', 2600);
    const crackleSpread = this.p('crackle.spread', 0.6);
    const crackleImpulse = this.p('crackle.impulsiveness', 0.6);
    const crackleDecay = this.p('crackle.decay', 3.5);
    const burstRate = this.p('crackle.burstRate', 3) / 60;
    const burstDensityP = this.p('crackle.burstDensity', 0.6);
    const burstLen = this.p('crackle.burstLength', 320) / 1000;

    const powerOpen = this.p('link.powerOpen', 1);
    const powerLink = linkOn ? this.p('link.powerToAudio', 0.9) : 0;
    const powerGate = 1 - powerLink * (1 - clamp(powerOpen, 0, 1));

    // Mains frequency wanders, so the hum breathes instead of sitting still.
    const mainsNow = mains * (1 + (valueNoise(this.time * 0.23 + this.seed) - 0.5) * humDrift * 0.006);
    const flybackHz = (flybackAudible ? lineRate * 0.5 : lineRate) *
      (1 + (valueNoise(this.time * 1.7 + this.seed * 5) - 0.5) * flybackDrift * 0.004);

    const hissAlpha = Math.exp((-2 * Math.PI * clamp(hissTone, 20, sampleRate * 0.45)) / sampleRate);

    const left = output[0];
    const right = output.length > 1 ? output[1] : null;

    for (let i = 0; i < frames; i++) {
      let sig = 0;
      let acoustic = 0;

      // ---- programme envelope (for hiss breathing) ----
      if (input && input[0]) {
        const x = Math.abs(input[0][i]);
        this.envelope += (x - this.envelope) * (x > this.envelope ? 0.01 : 0.0004);
      }

      if (isSignal) {
        // ---- mains hum ----
        if (humGain > 0) {
          let acc = 0;
          let norm = 0;
          for (let h = 1; h <= humHarmonics; h++) {
            // A ground loop buzzes on odd harmonics of the mains fundamental.
            // A transformer sings at twice line frequency because
            // magnetostriction does not care which way the field points.
            let weight;
            const odd = h % 2 === 1;
            if (humMode < 0.5) weight = odd ? 1 : 0.18;
            else if (humMode < 1.5) weight = odd ? 0.15 : 1;
            else weight = odd ? 0.65 : 0.8;
            const amp = weight / Math.pow(h, 1.9 - humTilt * 1.35);
            this.humPhases[h] += (mainsNow * h) * dt;
            if (this.humPhases[h] > 1) this.humPhases[h] -= 1;
            acc += Math.sin(this.humPhases[h] * 2 * Math.PI) * amp;
            norm += amp;
          }
          sig += (acc / Math.max(norm, 1e-6)) * humGain * humBoost * (1 + this.humSwell * 1.8);
        }

        // ---- tape hiss ----
        if (hissGain > 0) {
          const white = this.rng.bipolar();
          this.hissState = hissAlpha * this.hissState + (1 - hissAlpha) * white;
          const hp = white - this.hissState;   // one-pole high-pass
          // Companding noise reduction mis-tracks: hiss swells back up in the
          // gaps, which is exactly when you notice it.
          const breathe = 1 + hissBreathing * (1 - clamp(this.envelope * 6, 0, 1)) * 1.6;
          sig += hp * hissGain * breathe;
        }

        // ---- broadband RF static ----
        if (staticGain > 0) {
          sig += this.rng.bipolar() * staticGain;
        }

        // ---- crackle ----
        if (crackleGain > 0) {
          if (this.burstRemaining > 0) {
            this.burstRemaining -= dt;
          } else if (this.rng.next() < burstRate * dt) {
            this.burstRemaining = burstLen * (0.5 + this.rng.next());
            this.burstDensity = burstDensityP;
          }
          const density = 1 + (this.burstRemaining > 0 ? this.burstDensity * 40 : 0);
          const rate = crackleRate * density;
          if (rate > 0 && this.rng.next() < rate * dt) {
            this.spawnClick(crackleTone, crackleSpread, crackleImpulse, crackleDecay);
          }
          let sum = 0;
          for (let v = 0; v < MAX_CLICKS; v++) {
            if (!this.clickActive[v]) continue;
            this.clickPhase[v] += this.clickFreq[v] * dt;
            if (this.clickPhase[v] > 1) this.clickPhase[v] -= 1;
            this.clickAge[v] *= this.clickDecay[v];
            if (this.clickAge[v] < 1e-4) {
              this.clickActive[v] = 0;
              continue;
            }
            sum += Math.sin(this.clickPhase[v] * 2 * Math.PI) * this.clickAge[v] * this.clickAmp[v];
          }
          sig += sum * crackleGain;
        }
      } else {
        // ---- flyback whine ----
        // The line-output transformer's windings physically vibrate at the
        // horizontal scan rate. 15.734 kHz on NTSC, 15.625 kHz on PAL — the
        // single most identifiable sound a CRT makes, and the one nobody thinks
        // to add.
        if (flybackGain > 0) {
          this.flybackPhase += flybackHz * dt;
          if (this.flybackPhase > 1) this.flybackPhase -= 1;
          const ph = this.flybackPhase * 2 * Math.PI;
          let w = Math.sin(ph);
          if (flybackSqueal > 0) {
            w += Math.sin(ph * 2) * flybackSqueal * 0.35 + Math.sin(ph * 3) * flybackSqueal * 0.18;
          }
          // Slow amplitude wander — a real set is never a steady sine.
          const am = 1 + (valueNoise(this.time * 0.9 + this.seed * 11) - 0.5) * 0.5;
          acoustic += w * flybackGain * am;
        }

        // ---- mechanical rumble ----
        if (rumbleGain > 0) {
          const white = this.rng.bipolar();
          this.rumbleState += (white - this.rumbleState) * 0.004;
          this.rumbleState2 += (this.rumbleState - this.rumbleState2) * 0.004;
          acoustic += this.rumbleState2 * rumbleGain * 8;
        }

        // ---- degauss / power thump ----
        if (this.thump > 0.0005) {
          this.thumpPhase += 42 * dt;
          const env = this.thump;
          acoustic += Math.sin(this.thumpPhase * 2 * Math.PI) * env * 0.5
                    + this.rng.bipolar() * env * 0.08;
          this.thump *= 0.99965;
        }
      }

      this.humSwell *= 0.99988;

      const v = (isSignal ? sig : acoustic) * powerGate;
      left[i] = v;
      if (right) {
        // Noise is never perfectly correlated between two microphones' worth of
        // air, but a mono set has one speaker, so keep it near-mono with a
        // touch of decorrelation.
        right[i] = v * 0.94 + this.rng.bipolar() * (isSignal ? hissGain : flybackGain) * 0.2;
      }
    }

    this.advance(frames);
    return this.alive;
  }
}

registerProcessor('crt-transport', TransportProcessor);
registerProcessor('crt-noise', NoiseProcessor);
