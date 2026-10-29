/*
 * CAMAI AudioWorklet DSP: the camcorder's sound.
 *
 * One processor, cam-recorder, in the order the sound meets the camera:
 *
 *   the microphone on the body   the programme, plus everything the camera
 *                                itself makes: the transport's whine locked
 *                                to the frame rate, the zoom motor while the
 *                                zoom moves, the focus motor ticking while it
 *                                hunts, the REC button's clunk, a thump when
 *                                the operator's hand shifts, wind, and the
 *                                room. A small capsule's EQ, and the wind cut.
 *   automatic gain control       attack, release and a maximum gain: loud
 *                                sounds duck everything, and in quiet passages
 *                                the room tone rises (breathing)
 *   the DV recording             16-bit at 48 kHz, or 12-bit non-linear and
 *                                band-limited for 32 kHz
 *   the tape                     a dropout mutes or repeats a block at the
 *                                moment the picture conceals; a recording
 *                                break cuts dead, with a click; after the
 *                                battery dies there is nothing
 *
 * Every event comes from camai-events.js, the module the picture's clock
 * evaluates, so a dropout that freezes blocks of picture is the same dropout
 * that mutes the sound, and a bump that jolts the frame thumps the
 * microphone at the same moment. The processor keeps its own clock in tape
 * (output) time so the same code gives the same result live and offline; the
 * host corrects it with `sync` messages.
 *
 * The camera always has audio: with a silent source, this is the camera.
 */

import { EVENT_HZ, Shots, batteryDeath, bumpTicks, clogAt, dropoutAt, huntAt, ihash, perTick, snoise } from './camai-events.js';

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
  constructor(freq, decaySec) {
    this.y1 = 0;
    this.y2 = 0;
    const r = Math.exp(-1 / (Math.max(decaySec, 1e-4) * sampleRate));
    const w = (2 * Math.PI * clamp(freq, 20, sampleRate * 0.45)) / sampleRate;
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    this.g = 1 - r;
    this.sinW = Math.sin(w);
  }
  /**
   * Strike it so the ring peaks at about `amp`. (Adding to y1 alone rings at
   * amp / sin(w): 55 times over for a 140 Hz clunk.)
   */
  kick(amp) {
    this.y1 += amp * this.sinW;
  }
  step(x) {
    const y = x * this.g + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** RBJ biquad, one channel. */
class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  set(type, freq, q, gainDb = 0) {
    const f = clamp(freq, 10, sampleRate * 0.49);
    const w = (2 * Math.PI * f) / sampleRate;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else {
      // peaking
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  step(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/**
 * DV's 12-bit non-linear code (IEC 61834): linear for the smallest 512
 * values, then six segments of 256 codes each, the step doubling every
 * segment, up to a step of 64 sixteen-bit units at full scale.
 */
export function dv12(x16) {
  const a = Math.abs(x16);
  let step = 1;
  let base = 0;
  let lim = 512;
  while (a >= lim && step < 64) {
    base = lim;
    step *= 2;
    lim *= 2;
  }
  const q = base + Math.round((a - base) / step) * step;
  return Math.sign(x16) * Math.min(q, 32767);
}

const HISTORY = 8192;

class CamRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po = (options && options.processorOptions) || {};
    this.params = po.params || {};
    this.seed = po.seed | 0;
    this.rng = new Rng(Math.floor((this.seed + 1) * 2654435761) ^ 0x5f356495);
    this.time = 0;
    this.playing = true;
    this.alive = true;
    this.port.onmessage = (event) => this.onMessage(event.data);

    this.phase = new Float64Array(24);
    this.motorPhase = 0;
    this.gearPhase = 0;
    this.zoomSpeed = 0;
    this.capPhase = 0;
    this.pink = [0, 0, 0];
    this.windLp = 0;
    this.thumpLo = new Resonator(70, 0.09);
    this.thumpMid = new Resonator(220, 0.03);
    this.clunkLo = new Resonator(140, 0.06);
    this.clunkHi = new Resonator(1800, 0.008);
    this.tickHi = new Resonator(3200, 0.003);
    this.tickLo = new Resonator(900, 0.004);
    this.noiseBurst = 0;
    this.tickAcc = 0;
    this.huntPrev = 0;
    this.eq = [0, 1].map(() => ({ lo: new Biquad(), pres: new Biquad(), hi: new Biquad(), wind: new Biquad(), aa: [new Biquad(), new Biquad(), new Biquad(), new Biquad()] }));
    this.agcEnv = 0;
    this.agcGain = 1;
    this.history = [new Float32Array(HISTORY), new Float32Array(HISTORY)];
    this.hIdx = 0;
    this.muteGain = 1;
    this.frame = -1;
    this.frameState = { share: 0, clog: -1, dead: false, sinceShot: 0, shot: 0 };
    this.tick = -1;
    this.lastShot = -1;
    this.configure();
  }

  onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'params') {
      this.params = msg.params || {};
      this.configure();
    } else if (msg.type === 'sync') {
      if (typeof msg.time === 'number') {
        this.time = msg.time;
        this.frame = -1;
        this.tick = -1;
      }
      if (typeof msg.playing === 'boolean') this.playing = msg.playing;
    } else if (msg.type === 'dispose') {
      this.alive = false;
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

  configure() {
    const p = this.params;
    this.shots = new Shots(this.seed, {
      enabled: p['breaks.enabled'] === true,
      rate: this.p('breaks.rate', 0),
      skip: this.p('breaks.skip', 0),
      gap: this.p('breaks.gap', 0),
      seamless: p['breaks.seamless'] !== false,
    });
    this.death = p['battery.enabled'] === true ? batteryDeath(this.p('battery.charge', 100), this.p('battery.capacity', 60), this.shots) : Infinity;
    for (const e of this.eq) {
      e.lo.set('highpass', this.p('mic.low', 120), 0.707);
      e.pres.set('peaking', 3800, 1.1, this.p('mic.presence', 0));
      e.hi.set('lowpass', this.p('mic.high', 12000), 0.707);
      e.wind.set('highpass', 220, 0.8);
      // An eighth-order Butterworth for the 32 kHz recording's anti-alias
      // filter: flat to 14 kHz, nothing left by 16.
      [0.5098, 0.6013, 0.9, 2.5629].forEach((q, i) => e.aa[i].set('lowpass', 14500, q));
    }
    this.frame = -1;
  }

  /** Frame-level state at DV frame n: what the tape did to it. */
  frameAt(n, t) {
    const fps = this.p('sys.fps', 29.97);
    let share = 0;
    let clog = -1;
    if (this.b('tape.enabled', false)) {
      const lp = this.b('tape.lp', false);
      const d8 = this.b('tape.digital8', false);
      const rate = this.p('tape.dropouts', 0) * (lp ? 3 : 1) * (d8 ? 1.4 : 1);
      const d = dropoutAt(n, this.seed, rate, fps, this.p('tape.size', 0.15), this.p('sys.tracks', 10));
      if (d) share = d.share;
      clog = clogAt(n, this.seed, this.p('tape.clogs', 0), fps, this.p('tape.clogLength', 0.8));
    }
    const at = this.shots.atOutput(t);
    return { share, clog, dead: n / fps >= this.death, sinceShot: t - at.shot.out0, shot: at.index };
  }

  process(inputs, outputs) {
    if (!this.alive) return false;
    const out = outputs[0];
    const inp = inputs[0];
    const n = out[0].length;
    const sr = sampleRate;
    const inL = inp && inp[0] ? inp[0] : null;
    const inR = inp && inp[1] ? inp[1] : inL;

    if (!this.b('audio.enabled', true)) {
      for (let i = 0; i < n; i++) {
        out[0][i] = inL ? inL[i] : 0;
        if (out[1]) out[1][i] = inR ? inR[i] : 0;
      }
      if (this.playing) this.time += n / sr;
      return true;
    }

    const fps = this.p('sys.fps', 29.97);
    const tracks = this.p('sys.tracks', 10);
    const inGain = dbToGain(this.p('audio.inputGain', 0));
    const mono = this.b('audio.mono', false);
    const micOn = this.b('mic.enabled', false);
    const mechOn = this.b('mech.enabled', false);
    const linkOn = this.b('link.enabled', true);
    const L = (k) => (linkOn ? this.p(k, 1) : 0);
    const transport = mechOn ? dbToGain(this.p('mech.transport', -58)) : 0;
    const zoomLvl = mechOn ? dbToGain(this.p('mech.zoom', -34)) * L('link.zoomMotor') : 0;
    const focusLvl = mechOn ? dbToGain(this.p('mech.focus', -44)) * L('link.focusTicks') : 0;
    const recLvl = mechOn ? dbToGain(this.p('mech.rec', -22)) * L('link.breakClunk') : 0;
    const handLvl = mechOn ? dbToGain(this.p('mech.handling', -26)) * L('link.bumpThump') : 0;
    const room = micOn ? dbToGain(this.p('mic.room', -66)) : 0;
    const wind = micOn ? this.p('mic.wind', 0) : 0;
    const windCut = micOn && this.b('mic.windCut', false);
    const agcOn = this.b('agc.enabled', false);
    const target = dbToGain(this.p('agc.target', -18));
    const maxGain = dbToGain(this.p('agc.maxGain', 24));
    const minGain = dbToGain(-this.p('agc.maxCut', 3));
    const atk = Math.exp(-1 / (Math.max(this.p('agc.attack', 8), 0.1) * 0.001 * sr));
    const rel = Math.exp(-1 / (Math.max(this.p('agc.release', 2.5), 0.01) * sr));
    const twelve = this.b('audio.twelve', false);
    const outGain = dbToGain(this.p('audio.output', 0));
    const huntRate = this.b('focus.enabled', false) ? this.p('focus.hunts', 0) : 0;
    const huntShots = this.b('focus.enabled', false);
    const bumpRate = this.b('operator.enabled', false) ? this.p('operator.bumps', 0) : 0;
    const muteLink = L('link.dropoutMute');
    const faderOn = this.b('fx.fader', false);
    const faderTime = Math.max(this.p('fx.faderTime', 1.5), 0.01);
    // The drum turns once a frame's worth of tracks: about 150 Hz in both
    // systems (9000 rpm). Unlinked, it wanders as an unlocked motor would.
    const lock = L('link.frameWhine');
    const drum = fps * (fps > 27 ? 5 : 6);
    const zv = Math.abs(this.p('zoom.velocity', 0));
    const zoomTarget = clamp(zv / 0.8, 0, 1.4);

    for (let i = 0; i < n; i++) {
      const t = this.time + (this.playing ? i / sr : 0);
      const frame = Math.floor(t * fps + 1e-6);
      if (frame !== this.frame) {
        this.frame = frame;
        this.frameState = this.frameAt(frame, t);
        if (this.frameState.shot !== this.lastShot) {
          // A new shot: the cut is dead, with a click, and the REC button's
          // clunk is the first thing on it.
          if (this.lastShot >= 0 || this.frameState.sinceShot < 0.1) {
            this.clunkLo.kick(recLvl);
            this.clunkHi.kick(recLvl * 0.5);
            this.noiseBurst = 0.012 * sr;
          }
          this.lastShot = this.frameState.shot;
        }
      }
      const fs = this.frameState;

      // ---- the programme ----
      let xL = inL ? inL[i] * inGain : 0;
      let xR = inR ? inR[i] * inGain : 0;
      if (mono) {
        const m = (xL + xR) * 0.5;
        xL = m;
        xR = m;
      }

      // ---- the camera, heard by its own microphone ----
      let mech = 0;
      if (mechOn) {
        const wander = 1 + (1 - lock) * 0.012 * snoise(t * 0.3, this.seed, 401);
        const f0 = drum * wander;
        let whine = 0;
        for (let h = 1; h <= 20; h++) {
          const a = Math.exp(-((h - 12) * (h - 12)) / 30) * 0.6 + (h === 1 ? 0.35 : 0) + (h === 2 ? 0.2 : 0);
          this.phase[h] += (2 * Math.PI * f0 * h) / sr;
          if (this.phase[h] > 1e6) this.phase[h] -= 2 * Math.PI * Math.floor(this.phase[h] / (2 * Math.PI));
          whine += a * Math.sin(this.phase[h]);
        }
        this.capPhase += (2 * Math.PI * fps) / sr;
        const capstan = 0.25 * Math.sin(this.capPhase) + 0.15 * Math.sin(3 * this.capPhase);
        mech += transport * (whine * 0.25 + capstan + 0.08 * this.rng.bipolar());

        // The zoom motor: a whine and a gear buzz, speed following the rocker.
        this.zoomSpeed += (zoomTarget - this.zoomSpeed) * (1 - Math.exp(-1 / (0.04 * sr)));
        if (this.zoomSpeed > 0.002) {
          const s = this.zoomSpeed;
          this.motorPhase += (2 * Math.PI * (700 + 1100 * s)) / sr;
          this.gearPhase += (2 * Math.PI * (60 + 90 * s)) / sr;
          const buzz = (this.gearPhase / (2 * Math.PI)) % 1;
          mech += zoomLvl * Math.min(1, s * 1.5) * (0.6 * Math.sin(this.motorPhase) + 0.25 * Math.sin(2 * this.motorPhase) + 0.4 * (buzz - 0.5) + 0.1 * this.rng.bipolar());
        }

        // Focus motor ticks, as fast as the hunt is moving.
        const tk = Math.floor(t * EVENT_HZ);
        if (tk !== this.tick) {
          this.tick = tk;
          if (huntRate > 0 || huntShots) {
            const starts = huntShots ? this.shots.startsUpTo(t + 1) : null;
            const h = huntAt(tk / EVENT_HZ, this.seed, huntRate, starts);
            this.huntSpeed = Math.abs(h - this.huntPrev) * EVENT_HZ;
            this.huntPrev = h;
          } else this.huntSpeed = 0;
          // A bump starting on this tick: the hand hitting the body.
          if (bumpRate > 0 && ihash(tk, this.seed, 41) < perTick(bumpRate)) {
            const a = 0.5 + ihash(tk, this.seed, 42);
            this.thumpLo.kick(handLvl * a);
            this.thumpMid.kick(handLvl * 0.4 * a);
            this.noiseBurst = Math.max(this.noiseBurst, 0.05 * sr);
          }
        }
        if (this.huntSpeed > 0.05) {
          this.tickAcc += (30 + 70 * Math.min(this.huntSpeed, 3)) / sr;
          if (this.tickAcc >= 1) {
            this.tickAcc -= 1;
            this.tickHi.kick(focusLvl);
            this.tickLo.kick(focusLvl * 0.5);
          }
        }
        mech += this.tickHi.step(0) + this.tickLo.step(0);
        mech += this.clunkLo.step(0) + this.clunkHi.step(0);
        mech += this.thumpLo.step(0) + this.thumpMid.step(0);
        if (this.noiseBurst > 0) {
          this.noiseBurst--;
          mech += Math.max(recLvl, handLvl) * 0.3 * this.rng.bipolar() * Math.min(1, this.noiseBurst / (0.004 * sr));
        }
      }

      // ---- wind and the room ----
      let air = 0;
      if (micOn) {
        const w = this.rng.bipolar();
        this.pink[0] = 0.997 * this.pink[0] + 0.03 * w;
        this.pink[1] = 0.96 * this.pink[1] + 0.12 * w;
        this.pink[2] = 0.6 * this.pink[2] + 0.4 * w;
        air += room * (this.pink[0] + this.pink[1] + this.pink[2]) * 0.8;
        if (wind > 0) {
          this.windLp += (this.rng.bipolar() - this.windLp) * 0.02;
          const gust = 0.5 + 0.5 * snoise(t * 0.7, this.seed, 501);
          air += Math.tanh(this.windLp * 6 * wind * gust * gust) * 0.4 * wind;
        }
      }

      let yL = xL + mech + air;
      let yR = xR + mech * 0.9 + air;
      if (micOn) {
        const e0 = this.eq[0];
        const e1 = this.eq[1];
        yL = e0.hi.step(e0.pres.step(e0.lo.step(yL)));
        yR = e1.hi.step(e1.pres.step(e1.lo.step(yR)));
        if (windCut) {
          yL = e0.wind.step(yL);
          yR = e1.wind.step(yR);
        }
      }

      // ---- automatic gain control ----
      if (agcOn) {
        const lvl = Math.max(Math.abs(yL), Math.abs(yR));
        this.agcEnv = lvl > this.agcEnv ? lvl + (this.agcEnv - lvl) * atk : lvl + (this.agcEnv - lvl) * rel;
        // It lifts quiet passages a long way and turns loud ones down only a
        // little: a programme recorded at a sensible level stays as it was.
        const want = clamp(target / Math.max(this.agcEnv, 1e-6), minGain, maxGain);
        // Gain comes down fast and goes back up slowly: the breathing.
        this.agcGain = want < this.agcGain ? want + (this.agcGain - want) * atk : want + (this.agcGain - want) * rel;
        yL *= this.agcGain;
        yR *= this.agcGain;
      }

      // ---- the DV recording ----
      if (twelve) {
        const e0 = this.eq[0];
        const e1 = this.eq[1];
        if (sr > 33000) {
          for (let k = 0; k < 4; k++) {
            yL = e0.aa[k].step(yL);
            yR = e1.aa[k].step(yR);
          }
        }
        yL = dv12(Math.round(clamp(yL, -1, 1) * 32767)) / 32767;
        yR = dv12(Math.round(clamp(yR, -1, 1) * 32767)) / 32767;
      } else {
        yL = Math.round(clamp(yL, -1, 1) * 32767) / 32767;
        yR = Math.round(clamp(yR, -1, 1) * 32767) / 32767;
      }

      // ---- the tape ----
      const hi = this.hIdx;
      this.history[0][hi] = yL;
      this.history[1][hi] = yR;
      this.hIdx = (hi + 1) % HISTORY;
      let mute = 1;
      if (fs.dead) mute = 0;
      else if (fs.clog >= 0 || fs.share >= 0.5) mute = 1 - muteLink;
      else if (fs.share > 0 && muteLink > 0) {
        // A few tracks lost: the decoder repeats the block before.
        const back = Math.round(sr / (fps * tracks));
        const j = (hi - back + HISTORY) % HISTORY;
        yL += (this.history[0][j] - yL) * muteLink;
        yR += (this.history[1][j] - yR) * muteLink;
      }
      this.muteGain += (mute - this.muteGain) * 0.25;
      let g = this.muteGain * outGain;
      if (faderOn) g *= clamp(fs.sinceShot / faderTime, 0, 1);
      out[0][i] = yL * g;
      if (out[1]) out[1][i] = yR * g;
    }
    if (this.playing) this.time += n / sr;
    return true;
  }
}

registerProcessor('cam-recorder', CamRecorder);
