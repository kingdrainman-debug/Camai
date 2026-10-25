import { Settings, num } from '../core/params';
import { EMPTY_TIMELINE, Timeline, countKeyframes, evaluateTimeline } from '../core/timeline';
import { buildChain, zoomVelocityAt } from '../audio/engine';
import { shotsFor } from '../cam/clock';

export interface OfflineAudioOptions {
  seed: number;
  sampleRate?: number;
  /** Clip range in source seconds. Omit for the whole file. */
  start?: number;
  end?: number;
  onProgress?: (fraction: number) => void;
  /** Coarse progress reporting, for batch renders with no UI. */
  onStage?: (stage: string) => void;
  /**
   * Clip length to render when there is no source file — a still image being
   * rendered as a video. The camera still hears itself, so the result is a
   * camcorder's soundtrack of its own transport and the room, not silence.
   */
  duration?: number;
  /** Keyframes to follow while rendering. */
  timeline?: Timeline;
}

/**
 * How often an offline render re-applies animated parameters.
 *
 * OfflineAudioContext renders as fast as it can and never yields, so a chain
 * configured once would keep its opening settings for the whole clip and every
 * audio keyframe — the zoom the motor follows, above all — would be silently
 * ignored. Suspending on a schedule is the only way to get automation in.
 */
const AUTOMATION_HZ = 50;

/**
 * Render the processed audio deterministically, off the clock.
 *
 * Recording breaks are honoured the way the picture honours them: each shot
 * plays its own stretch of the source, butted against the next on the tape,
 * so the sound cuts dead exactly where the picture cuts. The worklet keeps
 * tape time, so it puts the click, the REC clunk, the dropouts and the
 * motor at the same frames the picture shows them.
 */
export async function renderProcessedAudio(
  file: Blob | null,
  settings: Settings,
  opts: OfflineAudioOptions,
): Promise<AudioBuffer | null> {
  const sampleRate = opts.sampleRate ?? 48000;
  let decoded: AudioBuffer | null = null;
  if (file) {
    const raw = await file.arrayBuffer();
    opts.onStage?.('decoding');
    const decodeCtx = new AudioContext();
    try {
      decoded = await decodeCtx.decodeAudioData(raw);
    } catch {
      // Plenty of video files have no audio track at all, and some containers
      // cannot be decoded by decodeAudioData even when they play fine in a
      // <video>. Neither stops an export: the camera still has its own sound.
      decoded = null;
    }
    await decodeCtx.close().catch(() => undefined);
  }

  const srcEnd = decoded ? decoded.duration : Math.max(0.1, (opts.start ?? 0) + (opts.duration ?? 0));
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(srcEnd, opts.end ?? srcEnd);
  const shots = shotsFor(settings, opts.seed);
  const outStart = shots.srcToOut(start).out;
  const outEnd = Math.max(outStart + 0.01, shots.srcToOut(end).out);
  const outSec = outEnd - outStart;
  const frames = Math.ceil(outSec * sampleRate);

  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(2, Math.max(frames, 1), sampleRate);
  const mix = ctx.createGain();
  silence.connect(mix);

  opts.onStage?.('building chain');
  const chain = await buildChain(ctx, mix, settings, { seed: opts.seed, withAnalyser: false, gateOnPause: false });
  chain.output.connect(ctx.destination);
  chain.sync(outStart, true);
  silence.start(0);

  if (decoded) {
    // One source per shot, each placed on the tape where the shot is.
    shots.atOutput(outEnd);
    const list = shots.list;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      const next = list[k + 1];
      const segOut0 = Math.max(s.out0, outStart);
      const segOut1 = Math.min(next ? next.out0 : Infinity, outEnd);
      if (segOut1 <= segOut0) continue;
      const offset = s.src0 + (segOut0 - s.out0);
      if (offset >= decoded.duration) continue;
      const node = ctx.createBufferSource();
      node.buffer = decoded;
      node.connect(mix);
      node.start(segOut0 - outStart, offset, Math.min(segOut1 - segOut0, decoded.duration - offset));
    }
  }

  opts.onStage?.('rendering');
  const timeline = opts.timeline ?? EMPTY_TIMELINE;
  const settingsAt = (outT: number) => {
    const srcT = shots.outToSrc(outT);
    const active = countKeyframes(timeline) ? evaluateTimeline(settings, timeline, srcT) : settings;
    const zv = countKeyframes(timeline)
      ? zoomVelocityAt((t) => num(evaluateTimeline(settings, timeline, t), 'lens.zoom'), srcT)
      : 0;
    return { active, zv };
  };
  if (countKeyframes(timeline) > 0) {
    const steps = Math.max(1, Math.ceil(outSec * AUTOMATION_HZ));
    for (let i = 1; i < steps; i++) {
      const at = i / AUTOMATION_HZ;
      if (at >= outSec) break;
      ctx.suspend(at).then(() => {
        const { active, zv } = settingsAt(outStart + at);
        chain.update(active, { time: outStart + at, playing: true, zoomVelocity: zv });
        void ctx.resume();
      });
    }
  }
  const first = settingsAt(outStart);
  chain.update(first.active, { time: outStart, playing: true, zoomVelocity: first.zv });
  const rendered = await ctx.startRendering();
  opts.onProgress?.(1);
  chain.dispose();
  return rendered;
}
