/**
 * The camcorder's audio chain.
 *
 * The sound physically takes this path:
 *
 *   programme (the world, as the source's soundtrack)
 *     → the microphone on the camera body, hearing the camera too
 *     → automatic gain control
 *     → the DV recording (16-bit 48 kHz, or 12-bit non-linear 32 kHz)
 *     → the tape (dropouts, recording breaks, a dead battery)
 *     → output level and a safety limiter
 *
 * All of it but the limiter is one AudioWorklet (public/worklets/camai-dsp.js),
 * because every stage after the microphone has to agree sample by sample
 * with the event clock the picture uses: a dropout mutes the frame the
 * picture conceals, a break cuts at the frame the picture cuts.
 */

import { Settings, bool, str } from '../core/params';
import { systemOf } from '../cam/clock';

// Resolved against the document base so the same bundle works from a web
// server (/worklets/...) and from file:// inside Electron (dist/worklets/...).
export const WORKLET_URL = new URL('worklets/camai-dsp.js', document.baseURI).href;

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();

export function ensureWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = workletReady.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(WORKLET_URL);
    workletReady.set(ctx, p);
  }
  return p;
}

/** Keys the worklet reads directly. */
const WORKLET_PREFIXES = ['audio.', 'mic.', 'mech.', 'agc.', 'link.', 'breaks.', 'battery.', 'tape.'];
const WORKLET_KEYS = ['focus.enabled', 'focus.hunts', 'operator.enabled', 'operator.bumps', 'fx.faderTime'];

/** Everything the worklet needs, as plain numbers — it has no access to the schema. */
export function workletParams(s: Settings, zoomVelocity = 0): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const key in s) {
    if (WORKLET_PREFIXES.some((p) => key.startsWith(p)) || WORKLET_KEYS.includes(key)) {
      const v = s[key];
      if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
    }
  }
  const sys = systemOf(s);
  out['sys.fps'] = sys.fps;
  out['sys.tracks'] = sys.tracks;
  out['tape.lp'] = str(s, 'tape.speed') === 'lp';
  out['tape.digital8'] = str(s, 'format.tape') === 'digital8';
  out['audio.mono'] = str(s, 'audio.channels') === 'mono';
  out['audio.twelve'] = str(s, 'audio.mode') === '12';
  out['fx.fader'] = bool(s, 'fx.enabled') && str(s, 'fx.fader') !== 'none';
  out['zoom.velocity'] = bool(s, 'lens.enabled') ? zoomVelocity : 0;
  return out;
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
}

export interface AudioChain {
  input: AudioNode;
  output: AudioNode;
  update(settings: Settings, telemetry: TelemetryInput): void;
  sync(time: number, playing: boolean): void;
  /** Smoothed programme level 0..1. */
  level(): number;
  dispose(): void;
}

export interface TelemetryInput {
  /** Tape (output) time in seconds — keeps the worklet clock aligned. */
  time: number;
  playing: boolean;
  /** How fast the zoom is moving, in natural-log zoom units per second. */
  zoomVelocity?: number;
}

export async function buildChain(
  ctx: BaseAudioContext,
  source: AudioNode,
  settings: Settings,
  opts: ChainOptions,
): Promise<AudioChain> {
  await ensureWorklet(ctx);

  const input = ctx.createGain();
  source.connect(input);
  const params = workletParams(settings);
  const recorder = new AudioWorkletNode(ctx, 'cam-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { params, seed: opts.seed },
  });
  input.connect(recorder);

  const master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.ratio.value = 20;
  limiter.knee.value = 0;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  limiter.threshold.value = -1;
  recorder.connect(master);
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

  let lastJson = '';
  let lastSync = -1;

  function update(s: Settings, tel: TelemetryInput): void {
    const t = ctx.currentTime;
    if (gateOnPause) {
      const gate = tel.playing ? 1 : 0;
      if (Math.abs(master.gain.value - gate) > 1e-4) master.gain.setTargetAtTime(gate, t, 0.012);
    }
    const wp = workletParams(s, tel.zoomVelocity ?? 0);
    const json = JSON.stringify(wp);
    if (json !== lastJson) {
      lastJson = json;
      recorder.port.postMessage({ type: 'params', params: wp });
    }
    // Keep the worklet clock on the media clock. Throttled — it free-runs
    // accurately between corrections.
    if (Math.abs(tel.time - lastSync) > 0.25 || lastSync < 0) {
      lastSync = tel.time;
      recorder.port.postMessage({ type: 'sync', time: tel.time, playing: tel.playing });
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
    input,
    output: limiter,
    update,
    sync(time, playing) {
      lastSync = time;
      recorder.port.postMessage({ type: 'sync', time, playing });
    },
    level,
    dispose() {
      recorder.port.postMessage({ type: 'dispose' });
      for (const n of [input, recorder, master, limiter]) n.disconnect();
      analyser?.disconnect();
    },
  };
}

/** How fast the zoom is moving at time t, from the keyframes. */
export function zoomVelocityAt(zoomAt: (t: number) => number, t: number): number {
  const dt = 0.05;
  const a = Math.log(Math.max(zoomAt(t - dt), 1));
  const b = Math.log(Math.max(zoomAt(t + dt), 1));
  return (b - a) / (2 * dt);
}

/**
 * Realtime wrapper around {@link buildChain} that owns the AudioContext and the
 * MediaElementSource for the preview player.
 *
 * A media element can be connected to Web Audio once in its lifetime: a
 * second createMediaElementSource throws, even from a new AudioContext. The
 * app reuses one <video> for every file it opens, so the context and each
 * element's source are made once and kept; opening another file only
 * rebuilds the chain behind them.
 */
export class CamAudioEngine {
  private ctx: AudioContext | null = null;
  private readonly sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
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
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    let source = this.sources.get(element);
    if (!source) {
      source = ctx.createMediaElementSource(element);
      this.sources.set(element, source);
    }
    this.element = element;
    this.source = source;
    this.chain = await buildChain(ctx, source, settings, { seed: this.seed });
    this.chain.output.connect(ctx.destination);
    this.destination = ctx.createMediaStreamDestination();
    this.chain.output.connect(this.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') await this.ctx.resume();
  }

  update(settings: Settings, time: number, playing: boolean, zoomVelocity = 0): void {
    this.chain?.update(settings, { time, playing, zoomVelocity });
  }

  sync(time: number, playing: boolean): void {
    this.chain?.sync(time, playing);
  }

  level(): number {
    return this.chain?.level() ?? 0;
  }

  /**
   * Take the chain down. The context and the element's source stay, ready
   * for the next attach; the source is disconnected, so the element is
   * silent until then rather than playing around the camera.
   */
  async detach(): Promise<void> {
    this.chain?.dispose();
    this.chain = null;
    this.source?.disconnect();
    this.source = null;
    this.destination?.disconnect();
    this.destination = null;
    this.element = null;
  }
}
