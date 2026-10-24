import type { Settings } from './params';
import { geometry } from '../film/clock';

/**
 * Output framing.
 *
 * One place decides the shape of a rendered frame, because the preview and the
 * export have to agree. They did not: the export took the source dimensions and
 * multiplied by a scale factor, while the shader letterboxed the picture inside
 * whatever frame it was handed. Choose 4:3 on a 16:9 source and you got a 16:9
 * file with bars baked in — the aspect setting changed the picture but never
 * the file. Film has stronger opinions about aspect than television ever did,
 * so the frame is always computed from the projection aspect, here.
 *
 * Height is the quantity that is preserved, not width, so matching the source
 * height keeps the detail of the picture and only the framing changes.
 */

export type ResolutionTarget =
  | 'source'
  | '480p'
  | '576p'
  | '720p'
  | '1080p'
  | '1440p'
  | '2160p'
  | 'custom';

export interface OutputSize {
  width: number;
  height: number;
}

/** Fixed heights for the named targets. */
const TARGET_HEIGHTS: Partial<Record<ResolutionTarget, number>> = {
  '480p': 480,
  '576p': 576,
  '720p': 720,
  '1080p': 1080,
  '1440p': 1440,
  '2160p': 2160,
};

export const RESOLUTION_TARGETS: { value: ResolutionTarget; label: string }[] = [
  { value: 'source', label: 'Match source' },
  { value: '480p', label: '480p · NTSC' },
  { value: '576p', label: '576p · PAL' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '1440p', label: '1440p' },
  { value: '2160p', label: '2160p · 4K' },
  { value: 'custom', label: 'Custom height…' },
];

/**
 * The aspect ratio of the projected picture, which is what the frame should be.
 *
 * Comes from the same geometry the renderers use, so the preview, the export
 * and the shaders can never disagree about the shape of the frame.
 */
export function frameAspect(settings: Settings, srcWidth: number, srcHeight: number): number {
  return geometry(settings, srcWidth, srcHeight).outAspect;
}

/** Encoders want even dimensions; an odd one fails or silently crops. */
function evenize(n: number): number {
  const v = Math.max(2, Math.round(n));
  return v % 2 === 0 ? v : v + 1;
}

/**
 * The dimensions a frame should be rendered at.
 *
 * `scale` stays as a plain multiplier on top of the chosen target so the
 * existing `--scale` CLI flag keeps working, and so a quick half-size test
 * render is still one control away.
 */
export function outputSize(
  srcWidth: number,
  srcHeight: number,
  settings: Settings,
  target: ResolutionTarget,
  customHeight: number,
  scale = 1,
): OutputSize {
  const aspect = frameAspect(settings, srcWidth, srcHeight);
  const baseHeight =
    target === 'source'
      ? Math.max(srcHeight, 2)
      : target === 'custom'
        ? Math.max(32, Math.min(4320, Math.round(customHeight)))
        : (TARGET_HEIGHTS[target] ?? Math.max(srcHeight, 2));

  const height = evenize(baseHeight * Math.max(scale, 0.05));
  return { width: evenize(height * aspect), height };
}

/**
 * Is this render asking for more pixels than the source has?
 *
 * Used to tell the user plainly when they are upscaling, since the grain is
 * generated at the output resolution and genuinely gains detail, while the
 * underlying photographic detail cannot.
 */
export function upscaleFactor(srcHeight: number, out: OutputSize): number {
  return out.height / Math.max(srcHeight, 1);
}
