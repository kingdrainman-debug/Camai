/**
 * The film audio chain.
 *
 * The graph follows the path the sound physically takes, from a strip of film
 * moving past a sound head to the ear of someone sitting in front of a screen:
 *
 *   programme
 *     → input trim and channel matrix   (a film soundtrack is one channel)
 *     → transport                       (wow, flutter, sprocket modulation,
 *                                        a camera's speed drift)
 *     → the track                       (magnetic stripe or optical track:
 *                                        its noise, its distortion, its dirt,
 *                                        its splices)
 *     → the track's own bandwidth       (set by how fast the film moves past
 *                                        the head — Super 8 at 18 fps is
 *                                        76 mm/s, and sounds like it)
 *     → playback curve and amplifier    (the Academy curve; a valve amp)
 *     → speaker and cabinet
 *     → + the projector                 (in the room, not in the signal)
 *     → booth glass and room
 *     → master limiter
 *
 * The projector is added after the speaker for the same reason CRTBOX added
 * its flyback whine there: it is not part of the soundtrack at all. It is a
 * machine making a noise beside you, and filtering it through the speaker
 * would take away exactly what makes it sound like it is in the room.
 */

import { Settings, bool, code, num, str } from '../core/params';
import { gauge } from '../film/formats';
import { playbackRate, rates } from '../film/clock';
import { makeBreakupCurve, makeCabinetIR, makeRoomIR, makeSaturationCurve } from './ir';

// Resolved against the document base so the same bundle works from a web
// server (/worklets/...) and from file:// inside Electron (dist/worklets/...).
export const WORKLET_URL = new URL('worklets/filmbox-dsp.js', document.baseURI).href;

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
const WORKLET_PREFIXES = [
  'audio.', 'transport.', 'magnetic.', 'optical.', 'projnoise.', 'link.',
];
const WORKLET_KEYS = [
  'camera.enabled', 'camera.speedDrift', 'splice.enabled', 'splice.rate',
  'filmdirt.enabled', 'filmdirt.dust', 'filmdirt.fibres',
  'projector.enabled', 'projector.lampRipple', 'playback.enabled', 'playback.hum',
];

/** Everything the worklets need, as plain numbers — they have no access to the schema. */
export function workletParams(s: Settings): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const key in s) {
    if (WORKLET_PREFIXES.some((p) => key.startsWith(p)) || WORKLET_KEYS.includes(key)) {
      const v = s[key];
      if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    }
  }
  const r = rates(s);
  const g = gauge(str(s, 'format.gauge'));
  out['film.cameraFps'] = r.camera;
  out['film.projectorFps'] = r.projector;
  out['film.perfsPerFrame'] = g.perf.perFrame;
  out['film.mediaRate'] = playbackRate(r);
  out['track.code'] = code(s, 'audio.track');
  out['projector.mainsHz'] = Number(str(s, 'projector.mains')) || 60;
  out['projector.bladesCount'] = Math.max(2, Number(str(s, 'projector.blades')) || 3);
  return out;
}

/**
 * How fast the film passes the sound head, in mm/s — the quantity that sets a
 * soundtrack's treble. Projection speed times frame pitch.
 */
export function filmSpeedMm(s: Settings): number {
  return gauge(str(s, 'format.gauge')).pitch * rates(s).projector;
}

/** Upper limit of the track itself, before any playback EQ. */
export function trackBandwidth(s: Settings): number {
  const v = filmSpeedMm(s);
  const track = str(s, 'audio.track');
  if (track === 'magnetic') {
    // Roughly 90 Hz per mm/s of tape speed for a narrow stripe and a small
    // head: about 7 kHz for Super 8 at 18 fps, 9 kHz at 24.
    const wear = bool(s, 'magnetic.enabled') ? num(s, 'magnetic.headWear') : 0;
    return Math.min(16000, 92 * v * (1 - 0.5 * wear));
  }
  if (track === 'silent') return 20000;
  // Slit loss and image spread: about 6 kHz for 16 mm, 10+ for 35 mm.
  const spread = bool(s, 'optical.enabled') ? num(s, 'optical.imageSpread') : 0;
  return Math.min(13000, 30 * v) * (1 - 0.45 * spread);
}

export interface ChainOptions {
  seed: number;
  /** Skip the analyser in offline renders — nothing reads it. */
  withAnalyser?: boolean;
  /**
   * Mute the output while transport is paused. On for the live preview, off
   * for offline rendering, where there is no transport to pause.
   */
  gateOnPause?: boolean;
  /**
   * The programme a reel's turn ahead, for magnetic pre-echo. Only an offline
   * render can supply it; live, the echo falls after the sound instead.
   */
  future?: AudioNode;
}

export interface AudioChain {
  input: AudioNode;
  output: AudioNode;
  update(settings: Settings, telemetry: TelemetryInput): void;
  sync(time: number, playing: boolean): void;
  /** Smoothed programme level 0..1, fed back into the picture. */
  level(): number;
  dispose(): void;
}

export interface TelemetryInput {
  /** Media time in seconds — keeps the worklet clocks aligned. */
  time: number;
  playing: boolean;
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

  const params = workletParams(settings);

  // ---- transport ----
  const transport = new AudioWorkletNode(ctx, 'film-transport', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params, seed: opts.seed, salt: 11 },
  });
  merger.connect(transport);

  // ---- the track ----
  const track = new AudioWorkletNode(ctx, 'film-track', {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params, seed: opts.seed, salt: 23 },
  });
  transport.connect(track, 0, 0);
  if (opts.future) opts.future.connect(track, 0, 1);

  // ---- the track's bandwidth ----
  const trackHp = ctx.createBiquadFilter();
  trackHp.type = 'highpass';
  const trackLp1 = ctx.createBiquadFilter();
  const trackLp2 = ctx.createBiquadFilter();
  trackLp1.type = trackLp2.type = 'lowpass';
  track.connect(trackHp);
  trackHp.connect(trackLp1);
  trackLp1.connect(trackLp2);

  // ---- playback curve and amplifier ----
  const curveLp = ctx.createBiquadFilter();
  curveLp.type = 'lowpass';
  const curveShelf = ctx.createBiquadFilter();
  curveShelf.type = 'highshelf';
  const curveLow = ctx.createBiquadFilter();
  curveLow.type = 'lowshelf';
  const curvePeak = ctx.createBiquadFilter();
  curvePeak.type = 'peaking';
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  const highCut = ctx.createBiquadFilter();
  highCut.type = 'lowpass';
  trackLp2.connect(curveLp);
  curveLp.connect(curveShelf);
  curveShelf.connect(curveLow);
  curveLow.connect(curvePeak);
  curvePeak.connect(lowCut);
  lowCut.connect(highCut);

  const ampDrive = ctx.createGain();
  const amp = ctx.createWaveShaper();
  amp.oversample = '4x';
  const ampTrim = ctx.createGain();
  highCut.connect(ampDrive);
  ampDrive.connect(amp);
  amp.connect(ampTrim);

  // ---- speaker ----
  const boxPeak = ctx.createBiquadFilter();
  boxPeak.type = 'peaking';
  const honkPeak = ctx.createBiquadFilter();
  honkPeak.type = 'peaking';
  ampTrim.connect(boxPeak);
  boxPeak.connect(honkPeak);

  const cabinetConv = ctx.createConvolver();
  cabinetConv.normalize = true;
  const cabinetWet = ctx.createGain();
  const cabinetDry = ctx.createGain();
  const speakerSum = ctx.createGain();
  honkPeak.connect(cabinetDry);
  honkPeak.connect(cabinetConv);
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

  // The booth glass: the programme heard through a window, muffled.
  const booth = ctx.createBiquadFilter();
  booth.type = 'lowpass';
  breakupTrim.connect(booth);

  // ---- the projector, in the room ----
  const projector = new AudioWorkletNode(ctx, 'film-projector', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { params, seed: opts.seed, salt: 37 },
  });
  const projDistance = ctx.createBiquadFilter();
  projDistance.type = 'lowpass';
  const projGain = ctx.createGain();
  projector.connect(projDistance);
  projDistance.connect(projGain);

  const acousticSum = ctx.createGain();
  booth.connect(acousticSum);
  projGain.connect(acousticSum);

  // ---- room ----
  const roomConv = ctx.createConvolver();
  roomConv.normalize = true;
  const roomWet = ctx.createGain();
  const roomDry = ctx.createGain();
  const roomSum = ctx.createGain();
  acousticSum.connect(roomDry);
  acousticSum.connect(roomConv);
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
  limiter.threshold.value = -1;
  roomSum.connect(master);
  master.connect(limiter);

  const gateOnPause = opts.gateOnPause !== false;
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

  const cached = { cabinetSize: -1, roomSize: -1, ampKey: '', breakup: -1 };
  let lastWorkletJson = '';
  let lastSync = -1;
  const worklets = [transport, track, projector];

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
      let a = 1, b = 0, c = 0, d = 1;
      if (audioOn && mode === 'mono') {
        a = b = c = d = 0.5;
      } else if (audioOn && mode === 'left') {
        a = 1; b = 1; c = 0; d = 0;
      } else if (audioOn && mode === 'right') {
        a = 0; b = 0; c = 1; d = 1;
      }
      set(mLL.gain, a);
      set(mLR.gain, b);
      set(mRL.gain, c);
      set(mRR.gain, d);
    }

    // ---- the track's bandwidth ----
    {
      const bw = audioOn ? trackBandwidth(s) : 20000;
      set(trackHp.frequency, audioOn && str(s, 'audio.track') !== 'silent' ? 50 : 10);
      set(trackHp.Q, 0.6);
      set(trackLp1.frequency, bw);
      set(trackLp1.Q, 0.6);
      set(trackLp2.frequency, Math.min(bw * 1.25, 20000));
      set(trackLp2.Q, 0.55);
    }

    // ---- playback curve and amplifier ----
    {
      const on = audioOn && bool(s, 'playback.enabled');
      const curve = on ? str(s, 'playback.curve') : 'flat';
      if (curve === 'academy') {
        // Flat through the middle, rolling off from about 2 kHz to roughly
        // −10 dB at 8 kHz, with the bottom octave trimmed too.
        set(curveLp.frequency, 7500);
        set(curveLp.Q, 0.5);
        set(curveShelf.frequency, 3000);
        set(curveShelf.gain, -6);
        set(curveLow.frequency, 100);
        set(curveLow.gain, -4);
        set(curvePeak.gain, 0);
      } else if (curve === 'projector') {
        set(curveLp.frequency, 6500);
        set(curveLp.Q, 0.7);
        set(curveShelf.gain, 0);
        set(curveLow.frequency, 160);
        set(curveLow.gain, -8);
        set(curvePeak.frequency, 2200);
        set(curvePeak.Q, 0.9);
        set(curvePeak.gain, 4);
      } else {
        set(curveLp.frequency, 20000);
        set(curveShelf.gain, 0);
        set(curveLow.gain, 0);
        set(curvePeak.gain, 0);
      }
      set(lowCut.frequency, on ? num(s, 'playback.lowCut') : 10);
      set(lowCut.Q, 0.707);
      set(highCut.frequency, on ? num(s, 'playback.highCut') : 20000);
      set(highCut.Q, 0.707);

      const drive = on ? num(s, 'playback.drive') : 0;
      const model = str(s, 'playback.model') === 'transistor' ? 'transistor' : 'transformer';
      const key = `${model}|${drive.toFixed(3)}`;
      if (key !== cached.ampKey) {
        cached.ampKey = key;
        amp.curve = makeSaturationCurve(model, drive);
      }
      set(ampDrive.gain, 1);
      set(ampTrim.gain, 1 + drive * 0.3);
    }

    // ---- speaker and room ----
    {
      const on = audioOn && bool(s, 'speaker.enabled');
      set(boxPeak.frequency, num(s, 'speaker.resonanceFreq'));
      set(boxPeak.Q, 1.4);
      set(boxPeak.gain, on ? num(s, 'speaker.resonanceGain') : 0);
      set(honkPeak.frequency, num(s, 'speaker.honkFreq'));
      set(honkPeak.Q, 1.6);
      set(honkPeak.gain, on ? num(s, 'speaker.honkGain') : 0);

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

      const glass = on ? num(s, 'speaker.booth') : 0;
      set(booth.frequency, glass > 0.001 ? 5000 * Math.pow(0.15, glass) : 20000);
      set(booth.Q, 0.6);

      const roomSize = Math.min(1, num(s, 'speaker.room') + glass * 0.4);
      if (Math.abs(roomSize - cached.roomSize) > 0.03) {
        cached.roomSize = roomSize;
        roomConv.buffer = makeRoomIR(ctx, roomSize, opts.seed);
      }
      const roomAmount = on ? Math.min(1, num(s, 'speaker.room') * 0.7 + glass * 0.3) : 0;
      set(roomWet.gain, roomAmount);
      set(roomDry.gain, 1 - roomAmount * 0.4);

      // In the booth you are standing next to the projector.
      const dist = num(s, 'projnoise.distance');
      set(projDistance.frequency, 14000 * Math.pow(0.12, dist * (1 - glass)));
      set(projDistance.Q, 0.6);
      set(projGain.gain, (1 - 0.65 * dist) * (1 + glass * 1.5));
    }

    // Pause silences everything, the projector included: a projector that is
    // not running is not clattering. A short ramp, or pausing clicks.
    if (gateOnPause) {
      const gate = tel.playing ? 1 : 0;
      if (Math.abs(master.gain.value - gate) > 1e-4) master.gain.setTargetAtTime(gate, t, 0.012);
    }

    const wp = workletParams(s);
    const json = JSON.stringify(wp);
    if (json !== lastWorkletJson) {
      lastWorkletJson = json;
      for (const n of worklets) n.port.postMessage({ type: 'params', params: wp });
    }

    // Keep the worklet clocks on the media clock. Throttled — they free-run
    // accurately between corrections.
    if (Math.abs(tel.time - lastSync) > 0.25 || lastSync < 0) {
      lastSync = tel.time;
      for (const n of worklets) n.port.postMessage({ type: 'sync', time: tel.time, playing: tel.playing });
    }
  }

  function level(): number {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const rms = Math.sqrt(sum / levelBuf.length);
    const target = Math.min(1, Math.pow(rms * 3.2, 0.6));
    smoothedLevel += (target - smoothedLevel) * (target > smoothedLevel ? 0.35 : 0.06);
    return smoothedLevel;
  }

  update(settings, { time: 0, playing: false });

  return {
    input: inputGain,
    output: limiter,
    update,
    sync(time, playing) {
      lastSync = time;
      for (const n of worklets) n.port.postMessage({ type: 'sync', time, playing });
    },
    level,
    dispose() {
      for (const n of worklets) {
        n.port.postMessage({ type: 'dispose' });
        n.disconnect();
      }
      for (const n of [inputGain, splitter, merger, mLL, mLR, mRL, mRR, trackHp, trackLp1, trackLp2,
        curveLp, curveShelf, curveLow, curvePeak, lowCut, highCut, ampDrive, amp, ampTrim, boxPeak,
        honkPeak, cabinetConv, cabinetWet, cabinetDry, speakerSum, breakup, breakupDrive, breakupTrim,
        booth, projDistance, projGain, acousticSum, roomConv, roomWet, roomDry, roomSum, master, limiter]) {
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
export class FilmAudioEngine {
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

  async attach(element: HTMLMediaElement, settings: Settings, seed?: number): Promise<void> {
    if (typeof seed === 'number') this.seed = seed;
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

  update(settings: Settings, time: number, playing: boolean): void {
    this.chain?.update(settings, { time, playing });
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
