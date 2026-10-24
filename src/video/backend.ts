/**
 * Choosing a rasteriser.
 *
 * Two backends produce the same picture by different means. The GPU one runs
 * the chain as a handful of full-screen draws and is what you want whenever it
 * is available. The CPU one needs nothing but a 2D canvas, and exists because
 * "whenever it is available" turns out not to be always:
 *
 *   - WebGL2 can be missing, blacklisted by the driver, or disabled by policy.
 *     The app previously refused to start at all in that case.
 *   - Headless and batch renders on a server have no GPU, and the software
 *     paths that stand in for one sometimes return black frames rather than
 *     failing honestly.
 *   - GPU floating point differs between vendors, so two machines can render
 *     the same project slightly differently. The CPU path is bit-identical
 *     everywhere, which matters if a render has to be reproducible.
 *
 * Automatic is the sensible default: try the GPU, fall back rather than fail.
 */

import { CrtRenderer, RenderFrame } from './renderer';
import { CpuRenderer } from './cpu/renderer';
import type { RenderTelemetry } from './state';

/**
 * What both backends can take as a frame.
 *
 * TexImageSource and CanvasImageSource overlap but are not the same set — the
 * former has ImageData, the latter has SVG images — so naming the intersection
 * the app actually uses keeps the two implementations interchangeable.
 */
export type FrameSource =
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | OffscreenCanvas;

export type BackendChoice = 'auto' | 'gpu' | 'cpu';
export type BackendKind = 'gpu' | 'cpu';

/** What both backends implement. */
export interface Renderer {
  readonly sourceSize: { width: number; height: number };
  setSource(source: FrameSource | null, width: number, height: number): void;
  render(f: RenderFrame): RenderTelemetry;
  resetHistory(): void;
  triggerDegauss(now: number): void;
  dispose(): void;
}

export interface BackendResult {
  renderer: Renderer;
  kind: BackendKind;
  /** Set when the GPU was wanted but could not be had. */
  fellBack: string | null;
}

/**
 * Build a renderer for a canvas.
 *
 * A canvas can only ever have one kind of context, so switching backend means
 * replacing the canvas element — that is the caller's job, and the reason this
 * returns rather than mutates.
 */
export function createRenderer(canvas: HTMLCanvasElement, choice: BackendChoice): BackendResult {
  if (choice === 'cpu') {
    return { renderer: new CpuRenderer(canvas), kind: 'cpu', fellBack: null };
  }

  try {
    return { renderer: new CrtRenderer(canvas), kind: 'gpu', fellBack: null };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    if (choice === 'gpu') throw err;
    // Automatic: a machine without a usable GPU gets the CPU path rather than
    // an error page.
    return { renderer: new CpuRenderer(canvas), kind: 'cpu', fellBack: why };
  }
}
