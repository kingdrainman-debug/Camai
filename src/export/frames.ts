import { zip } from 'fflate';

/**
 * Deterministic frame-by-frame export.
 *
 * Unlike the realtime recorder this never drops a frame: the video element is
 * seeked to each frame time, the renderer is stepped with a fixed dt, and the
 * canvas is read back. Slow, but exact — which is what you want when the output
 * is going into an edit rather than straight to a browser tab.
 */

export interface FrameExportOptions {
  fps: number;
  start: number;
  end: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface FrameSink {
  /** Called for every rendered frame, in order. */
  (index: number, blob: Blob): Promise<void> | void;
}

export async function exportFrames(
  video: HTMLVideoElement,
  renderFrame: (time: number, index: number, dt: number) => void,
  canvas: HTMLCanvasElement,
  sink: FrameSink,
  opts: FrameExportOptions,
): Promise<number> {
  const dt = 1 / opts.fps;
  const total = Math.max(1, Math.round((opts.end - opts.start) * opts.fps));

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) return i;
    const time = opts.start + i * dt;
    await seek(video, time);
    // Feedback effects (persistence, burn-in) need to be stepped with the same
    // dt they would have had in playback, or trails come out the wrong length.
    renderFrame(time, i, dt);
    const blob = await canvasToBlob(canvas);
    await sink(i, blob);
    opts.onProgress?.(i + 1, total);
  }
  return total;
}

export function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 1e-4 && video.readyState >= 2) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      // One extra turn of the event loop: `seeked` can fire fractionally before
      // the new frame is actually available to texImage2D.
      requestAnimationFrame(() => resolve());
    };
    video.addEventListener('seeked', done);
    video.currentTime = time;
    // Some containers never fire `seeked` for a time past the last keyframe.
    setTimeout(done, 2000);
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, type);
  });
}

/** Bundle a rendered sequence into a single zip for download. */
export async function zipFrames(
  frames: { name: string; data: Uint8Array }[],
  extra: { name: string; data: Uint8Array }[] = [],
): Promise<Blob> {
  const tree: Record<string, Uint8Array> = {};
  for (const f of frames) tree[f.name] = f.data;
  for (const f of extra) tree[f.name] = f.data;
  return new Promise((resolve, reject) => {
    // Level 0: PNG is already deflated, so re-compressing costs time and saves
    // nothing worth having on a few thousand frames.
    zip(tree, { level: 0 }, (err, data) => {
      if (err) reject(err);
      else resolve(new Blob([data as unknown as BlobPart], { type: 'application/zip' }));
    });
  });
}

export function padIndex(i: number, width = 6): string {
  return String(i).padStart(width, '0');
}
