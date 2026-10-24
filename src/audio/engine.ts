/**
 * The CRT audio chain.
 *
 * The graph follows the path a signal physically takes on its way from a tape
 * or a transmitter to the listener's ear, because that ordering is what makes
 * the result sound like a television rather than like a preset:
 *
 *   programme
 *     → input trim
 *     → channel matrix        (a set has one speaker; stereo is the anomaly)
 *     → transport             (wow, flutter, drift, dropouts)
 *     → + signal-path noise   (hum, hiss, RF static, contact crackle)
 *     → speaker & enclosure   (band limits, box modes, cone breakup)
 *     → broadcast processing  (compression, saturation)
 *     → + acoustic noise      (flyback whine, cabinet rumble, degauss thump)
 *     → distance              (off-axis loss, through-the-wall, room tail)
 *     → master limiter
 *
 * Two details are worth calling out because they are usually got wrong.
 *
 * First, the noise bed is split in two. Hiss, hum and static are *in the
 * signal*, so they are added before the speaker and are shaped by it. The
 * flyback whine is not — it is the line-output transformer's windings
 * vibrating, radiating straight into the room. Low-passing it through a paper
 * cone would destroy the one artefact that most unmistakably says "CRT".
 *
 * Second, the compressor runs after the band limiting rather than before it.
 * A television's audio stage only ever saw the band-limited signal, so it
 * pumps in response to what survived the filters, not to the full-range mix.
 */

import { Settings, bool, code, num, str } from '../core/params';
import { RenderTelemetry } from '../video/renderer';
import {
  SaturationModel,
  makeBreakupCurve,
  makeCabinetIR,
  makeRoomIR,
  makeSaturationCurve,
} from './ir';

// Resolved against the document base so the same bundle works from a web
// server (/worklets/...) and from file:// inside Electron (dist/worklets/...).
export const WORKLET_URL = new URL('worklets/crtbox-dsp.js', document.baseURI).href;

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();

export function ensureWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = workletReady.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL);
    workletReady.set(ctx, p);
  }
  return p;
}

/** Keys the worklets read. Everything else stays on the main thread. */
const WORKLET_KEYS = [
  'transport.enabled', 'transport.wowRate', 'transport.wowDepth', 'transport.flutterRate',
  'transport.flutterDepth', 'transport.drift', 'transport.scrape', 'transport.dropoutRate',
  'transport.dropoutDepth', 'transport.dropoutLength',
  'noise.enabled', 'noise.humLevel', 'noise.humHarmonics', 'noise.humTilt', 'noise.humDrift',
  'noise.flybackLevel', 'noise.flybackDrift', 'noise.flybackSqueal', 'noise.flybackAudible',
  'noise.hissLevel', 'noise.hissTone', 'noise.hissBreathing', 'noise.staticLevel', 'noise.rumble',
  'crackle.enabled', 'crackle.rate', 'crackle.level', 'crackle.tone', 'crackle.spread',
  'crackle.impulsiveness', 'crackle.decay', 'crackle.burstRate', 'crackle.burstDensity',
  'crackle.burstLength',
  'sync.tearing', 'sync.vHold', 'sync.headSwitch', 'signal.signalLoss',
  'tube.humBar', 'tube.humBarWidth',
  'link.enabled', 'link.humBarToHum', 'link.lossToStatic', 'link.glitchToDropout',
  'link.powerToAudio',
];

function workletParams(s: Settings): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const key of WORKLET_KEYS) {
    const v = s[key];
    if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
  }
  // Enums are sent as codes; the worklet has no access to the schema.
  out['audio.regionCode'] = code(s, 'audio.region');
  out['noise.humModeCode'] = code(s, 'noise.humMode');
  return out;
}

export interface ChainOptions {
  seed: number;
  /** Skip the analyser in offline renders — nothing reads it. */
  withAnalyser?: boolean;
  /**
   * Mute the output while transport is paused. On for the live preview, off for
   * offline rendering, where there is no transport to pause and gating would
   * simply export silence.
   */
  gateOnPause?: boolean;
}

export interface AudioChain {
  input: AudioNode;
  output: AudioNode;
  update(settings: Settings, telemetry: TelemetryInput): void;
  fire(name: 'degauss' | 'power', amount: number): void;
  sync(time: number, playing: boolean): void;
  /** Smoothed programme level 0..1, fed back into the picture. */
  level(): number;
  dispose(): void;
}

export interface TelemetryInput {
  humPhase: number;
  glitch: number;
  powerOpen: number;
  /** Media time in seconds — keeps the worklet clocks aligned. */
  time: number;
  playing: boolean;
}

interface Cached {
  cabinetSize: number;
  roomSize: number;
  satModel: SaturationModel;
  satAmount: number;
  breakup: number;
}

export async function buildChain(
  ctx: BaseAudioContext,
  source: AudioNode,
  settings: Settings,
  opts: ChainOptions,
): Promise<AudioChain> {
  await ensureWorklet(ctx);

  const inputGain = ctx.createGain();

  // ---- channel matrix ----
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const mLL = ctx.createGain();
  const mLR = ctx.createGain();
  const mRL = ctx.createGain();
  const mRR = ctx.createGain();
  splitter.connect(mLL, 0);
  splitter.connect(mLR, 0);
  splitter.connect(mRL, 1);
  splitter.connect(mRR, 1);
  mLL.connect(merger, 0, 0);
  mRL.connect(merger, 0, 0);
  mLR.connect(merger, 0, 1);
  mRR.connect(merger, 0, 1);

  source.connect(inputGain);
  inputGain.connect(splitter);

  // ---- transport ----
  const transport = new AudioWorkletNode(ctx, 'crt-transport', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params: workletParams(settings), seed: opts.seed },
  });
  merger.connect(transport);

  // ---- signal-path noise (added before the speaker, so the speaker shapes it) ----
  const signalNoise = new AudioWorkletNode(ctx, 'crt-noise', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params: workletParams(settings), seed: opts.seed + 1, bus: 'signal' },
  });
  // Feeds the noise node the programme so it can duck and breathe against it.
  transport.connect(signalNoise);

  const preSpeaker = ctx.createGain();
  transport.connect(preSpeaker);
  signalNoise.connect(preSpeaker);

  // ---- speaker & enclosure ----
  const hp1 = ctx.createBiquadFilter();
  const hp2 = ctx.createBiquadFilter();
  hp1.type = hp2.type = 'highpass';
  const lp1 = ctx.createBiquadFilter();
  const lp2 = ctx.createBiquadFilter();
  lp1.type = lp2.type = 'lowpass';
  const boxPeak = ctx.createBiquadFilter();
  boxPeak.type = 'peaking';
  const honkPeak = ctx.createBiquadFilter();
  honkPeak.type = 'peaking';
  const notch = ctx.createBiquadFilter();
  notch.type = 'peaking';

  preSpeaker.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(boxPeak);
  boxPeak.connect(honkPeak);
  honkPeak.connect(notch);

  // Cabinet convolution in parallel with the filtered dry path.
  const cabinetConv = ctx.createConvolver();
  cabinetConv.normalize = true;
  const cabinetWet = ctx.createGain();
  const cabinetDry = ctx.createGain();
  const speakerSum = ctx.createGain();
  notch.connect(cabinetDry);
  notch.connect(cabinetConv);
  cabinetConv.connect(cabinetWet);
  cabinetDry.connect(speakerSum);
  cabinetWet.connect(speakerSum);

  const breakup = ctx.createWaveShaper();
  breakup.oversample = '2x';
  const breakupDrive = ctx.createGain();
  const breakupTrim = ctx.createGain();
  speakerSum.connect(breakupDrive);
  breakupDrive.connect(breakup);
  breakup.connect(breakupTrim);

  // ---- broadcast processing ----
  const comp = ctx.createDynamicsCompressor();
  const sat = ctx.createWaveShaper();
  sat.oversample = '4x';
  const satDrive = ctx.createGain();
  const makeup = ctx.createGain();
  breakupTrim.connect(comp);
  comp.connect(satDrive);
  satDrive.connect(sat);
  sat.connect(makeup);

  // ---- acoustic noise (not in the signal path, so not speaker-filtered) ----
  const acousticNoise = new AudioWorkletNode(ctx, 'crt-noise', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params: workletParams(settings), seed: opts.seed + 2, bus: 'acoustic' },
  });
  const acousticSum = ctx.createGain();
  makeup.connect(acousticSum);
  acousticNoise.connect(acousticSum);

  // ---- distance: off-axis, through a wall, room tail ----
  const offAxis = ctx.createBiquadFilter();
  offAxis.type = 'lowshelf';
  const wall = ctx.createBiquadFilter();
  wall.type = 'lowpass';
  const roomConv = ctx.createConvolver();
  roomConv.normalize = true;
  const roomWet = ctx.createGain();
  const roomDry = ctx.createGain();
  const roomSum = ctx.createGain();
  acousticSum.connect(offAxis);
  offAxis.connect(wall);
  wall.connect(roomDry);
  wall.connect(roomConv);
  roomConv.connect(roomWet);
  roomDry.connect(roomSum);
  roomWet.connect(roomSum);

  // ---- master ----
  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.ratio.value = 20;
  limiter.knee.value = 0;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  roomSum.connect(master);
  master.connect(limiter);

  const gateOnPause = opts.gateOnPause !== false;
  // Start closed when gating, so arming the chain over a paused clip does not
  // blip a frame of hum before the first update closes it.
  master.gain.value = gateOnPause ? 0 : 1;

  let analyser: AnalyserNode | null = null;
  let levelBuf = new Float32Array(1024);
  let smoothedLevel = 0;
  if (opts.withAnalyser !== false && 'createAnalyser' in ctx) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    levelBuf = new Float32Array(analyser.fftSize);
    limiter.connect(analyser);
  }

  const cached: Cached = {
    cabinetSize: -1,
    roomSize: -1,
    satModel: 'tape',
    satAmount: -1,
    breakup: -1,
  };

  let lastWorkletJson = '';
  let lastTelemetrySend = -1;

  function post(node: AudioWorkletNode, msg: unknown): void {
    node.port.postMessage(msg);
  }

  function update(s: Settings, tel: TelemetryInput): void {
    const t = ctx.currentTime;
    const audioOn = bool(s, 'audio.enabled');
    const set = (p: AudioParam, v: number) => {
      if (Math.abs(p.value - v) > 1e-6) p.setTargetAtTime(v, t, 0.01);
    };

    inputGain.gain.value = audioOn ? Math.pow(10, num(s, 'audio.inputGain') / 20) : 1;

    // ---- channel matrix ----
    {
      const mode = str(s, 'audio.channelMode');
      const m = audioOn ? num(s, 'audio.monoAmount') : 0;
      const width = num(s, 'audio.width');
      let a = 1, b = 0, c = 0, d = 1;
      if (!audioOn || mode === 'stereo') {
        a = 1 - m / 2; b = m / 2; c = m / 2; d = 1 - m / 2;
      } else if (mode === 'mono') {
        const k = 0.5 * m + (1 - m);
        a = m * 0.5 + (1 - m); b = m * 0.5; c = m * 0.5; d = m * 0.5 + (1 - m);
        void k;
      } else if (mode === 'left') {
        a = 1; b = 0; c = 1; d = 0;
      } else if (mode === 'right') {
        a = 0; b = 1; c = 0; d = 1;
      } else if (mode === 'side') {
        // The MTS stereo subcarrier on its own: anything panned centre — which
        // is almost always the dialogue — cancels out completely.
        a = 1; b = -1; c = 1; d = -1;
      }
      // Re-widen whatever stereo survived.
      const mid = [(a + c) / 2, (b + d) / 2];
      const side = [(a - c) / 2, (b - d) / 2];
      const w = mode === 'stereo' ? width : 0;
      set(mLL.gain, mid[0] + w * side[0]);
      set(mLR.gain, mid[1] + w * side[1]);
      set(mRL.gain, mid[0] - w * side[0]);
      set(mRR.gain, mid[1] - w * side[1]);
    }

    // ---- speaker ----
    {
      const on = audioOn && bool(s, 'speaker.enabled');
      const wall01 = on ? num(s, 'speaker.throughWall') : 0;
      const lowCut = on ? num(s, 'speaker.lowCut') : 20;
      const highCut = on ? num(s, 'speaker.highCut') : 20000;
      const loSlope = num(s, 'speaker.lowCutSlope');
      const hiSlope = num(s, 'speaker.highCutSlope');

      set(hp1.frequency, lowCut);
      set(hp1.Q, 0.707);
      // Second stage only engages above 12 dB/oct; below that it sits out of
      // the way rather than being rewired.
      set(hp2.frequency, loSlope >= 18 ? lowCut : 20);
      set(hp2.Q, loSlope >= 24 ? 1.0 : 0.6);

      set(lp1.frequency, highCut);
      set(lp1.Q, 0.707);
      set(lp2.frequency, hiSlope >= 18 ? highCut : 20000);
      set(lp2.Q, hiSlope >= 24 ? 1.0 : 0.6);

      set(boxPeak.frequency, num(s, 'speaker.resonanceFreq'));
      set(boxPeak.Q, num(s, 'speaker.resonanceQ'));
      set(boxPeak.gain, on ? num(s, 'speaker.resonanceGain') : 0);

      set(honkPeak.frequency, num(s, 'speaker.honkFreq'));
      set(honkPeak.Q, 1.6);
      set(honkPeak.gain, on ? num(s, 'speaker.honkGain') : 0);

      set(notch.frequency, num(s, 'speaker.notchFreq'));
      set(notch.Q, 3.2);
      set(notch.gain, on ? -num(s, 'speaker.notchDepth') : 0);

      const cabSize = num(s, 'speaker.cabinetSize');
      if (Math.abs(cabSize - cached.cabinetSize) > 0.02) {
        cached.cabinetSize = cabSize;
        cabinetConv.buffer = makeCabinetIR(ctx, cabSize, opts.seed);
      }
      const wet = on ? num(s, 'speaker.cabinet') : 0;
      set(cabinetWet.gain, wet);
      set(cabinetDry.gain, 1 - wet * 0.55);

      const br = on ? num(s, 'speaker.breakup') : 0;
      if (Math.abs(br - cached.breakup) > 0.005) {
        cached.breakup = br;
        breakup.curve = makeBreakupCurve(br);
      }
      set(breakupDrive.gain, 1 + br * 1.8);
      set(breakupTrim.gain, 1 / (1 + br * 1.2));

      // Off-axis: the cone beams, so pointing away costs treble, not level.
      const off = on ? num(s, 'speaker.offAxis') : 0;
      set(offAxis.frequency, 1400);
      set(offAxis.gain, off * 5.5);

      set(wall.frequency, wall01 > 0.001 ? 4000 * Math.pow(0.12, wall01) : 20000);
      set(wall.Q, 0.6);

      const roomSize = Math.min(1, num(s, 'speaker.roomTail') + wall01 * 0.6);
      if (Math.abs(roomSize - cached.roomSize) > 0.03) {
        cached.roomSize = roomSize;
        roomConv.buffer = makeRoomIR(ctx, roomSize, opts.seed);
      }
      const roomAmount = on ? Math.min(1, num(s, 'speaker.roomTail') * 0.7 + wall01 * 0.55) : 0;
      set(roomWet.gain, roomAmount);
      set(roomDry.gain, 1 - roomAmount * 0.4);
    }

    // ---- dynamics ----
    {
      const on = audioOn && bool(s, 'dynamics.enabled');
      const amount = on ? num(s, 'dynamics.amount') : 0;
      set(comp.threshold, on ? num(s, 'dynamics.threshold') * amount : 0);
      set(comp.ratio, on ? 1 + (num(s, 'dynamics.ratio') - 1) * amount : 1);
      set(comp.knee, 6);
      set(comp.attack, num(s, 'dynamics.attack') / 1000);
      set(comp.release, num(s, 'dynamics.release') / 1000);

      const satAmount = on ? num(s, 'dynamics.saturation') : 0;
      const model = str(s, 'dynamics.saturationModel') as SaturationModel;
      if (Math.abs(satAmount - cached.satAmount) > 0.005 || model !== cached.satModel) {
        cached.satAmount = satAmount;
        cached.satModel = model;
        sat.curve = makeSaturationCurve(model, satAmount);
      }
      set(satDrive.gain, 1);
      // Rough make-up for what the compressor took away.
      set(makeup.gain, 1 + amount * 0.55);
      set(limiter.threshold, num(s, 'dynamics.ceiling'));
    }

  // Pause has to silence everything, not just the programme. The noise bed —
    // hum, hiss, flyback whine, crackle — is generated in the worklets and
    // free-runs regardless of whether anything is playing, so muting the source
    // alone would leave a television humming away over a frozen picture.
    // A short ramp rather than a hard cut, or pausing clicks.
    if (gateOnPause) {
      const gate = tel.playing ? 1 : 0;
      if (Math.abs(master.gain.value - gate) > 1e-4) {
        master.gain.setTargetAtTime(gate, t, 0.012);
      }
    }

    // ---- worklets ----
    const wp = workletParams(s);
    const json = JSON.stringify(wp);
    if (json !== lastWorkletJson) {
      lastWorkletJson = json;
      for (const n of [transport, signalNoise, acousticNoise]) post(n, { type: 'params', params: wp });
    }

    // Telemetry from the picture, throttled — it only needs to be perceptually
    // continuous, not sample-accurate.
    if (tel.time - lastTelemetrySend > 0.03 || lastTelemetrySend < 0) {
      lastTelemetrySend = tel.time;
      const patch = {
        'link.humPhase': tel.humPhase,
        'link.powerOpen': tel.powerOpen,
      };
      for (const n of [transport, signalNoise, acousticNoise]) {
        post(n, { type: 'patch', params: patch });
        post(n, { type: 'sync', time: tel.time, playing: tel.playing });
      }
    }
  }

  function level(): number {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const rms = Math.sqrt(sum / levelBuf.length);
    // Perceptual-ish, then smoothed so the picture does not strobe.
    const target = Math.min(1, Math.pow(rms * 3.2, 0.6));
    smoothedLevel += (target - smoothedLevel) * (target > smoothedLevel ? 0.35 : 0.06);
    return smoothedLevel;
  }

  update(settings, { humPhase: 0, glitch: 0, powerOpen: 1, time: 0, playing: false });

  return {
    input: inputGain,
    output: limiter,
    update,
    fire(name, amount) {
      for (const n of [signalNoise, acousticNoise]) {
        post(n, { type: 'event', name, amount });
      }
    },
    sync(time, playing) {
      for (const n of [transport, signalNoise, acousticNoise]) {
        post(n, { type: 'sync', time, playing });
      }
    },
    level,
    dispose() {
      for (const n of [transport, signalNoise, acousticNoise]) {
        post(n, { type: 'dispose' });
        n.disconnect();
      }
      for (const n of [inputGain, splitter, merger, mLL, mLR, mRL, mRR, preSpeaker, hp1, hp2,
        lp1, lp2, boxPeak, honkPeak, notch, cabinetConv, cabinetWet, cabinetDry, speakerSum,
        breakup, breakupDrive, breakupTrim, comp, sat, satDrive, makeup, acousticSum, offAxis,
        wall, roomConv, roomWet, roomDry, roomSum, master, limiter]) {
        n.disconnect();
      }
      analyser?.disconnect();
    },
  };
}

/**
 * Realtime wrapper around {@link buildChain} that owns the AudioContext and the
 * MediaElementSource for the preview player.
 */
export class CrtAudioEngine {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private chain: AudioChain | null = null;
  private element: HTMLMediaElement | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get ready(): boolean {
    return !!this.chain;
  }

  /** A MediaStream carrying the processed audio, for MediaRecorder export. */
  get stream(): MediaStream | null {
    return this.destination ? this.destination.stream : null;
  }

  async attach(element: HTMLMediaElement, settings: Settings): Promise<void> {
    if (this.element === element && this.chain) return;
    await this.detach();
    // A MediaElementSource can only be created once per element per context, so
    // the context is recreated alongside it whenever the media changes.
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.element = element;
    this.source = ctx.createMediaElementSource(element);
    this.chain = await buildChain(ctx, this.source, settings, { seed: this.seed });
    this.chain.output.connect(ctx.destination);
    this.destination = ctx.createMediaStreamDestination();
    this.chain.output.connect(this.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  update(settings: Settings, telemetry: RenderTelemetry, time: number, playing: boolean): void {
    this.chain?.update(settings, {
      humPhase: telemetry.humPhase,
      glitch: telemetry.glitch,
      powerOpen: telemetry.powerOpen,
      time,
      playing,
    });
  }

  fire(name: 'degauss' | 'power', amount = 1): void {
    this.chain?.fire(name, amount);
  }

  sync(time: number, playing: boolean): void {
    this.chain?.sync(time, playing);
  }

  level(): number {
    return this.chain?.level() ?? 0;
  }

  async detach(): Promise<void> {
    this.chain?.dispose();
    this.chain = null;
    this.source?.disconnect();
    this.source = null;
    this.destination?.disconnect();
    this.destination = null;
    if (this.ctx) {
      await this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.element = null;
  }
}
