/** Typed view of the bridge exposed by electron/preload.cjs. */

export interface OpenedMedia {
  path: string;
  name: string;
  url: string;
}

export interface EncodeStartOptions {
  format: 'h264' | 'hevc' | 'prores' | 'dv' | 'gif';
  fps: number;
  /** Exact rate as a rational, e.g. "30000/1001", which DV insists on. */
  rate?: string;
  /** For DV: which system, and the picture's aspect. */
  dvSystem?: 'ntsc' | 'pal';
  dvAspect?: '4:3' | '16:9';
  quality: number;
  outputPath: string;
  width?: number;
  height?: number;
  audio?: ArrayBuffer | null;
  /** How many frames will be sent; DV pads its sound to exactly this length. */
  frames?: number;
  /** Frames are raw RGBA of this size, top row first, rather than PNGs. */
  raw?: { width: number; height: number };
}

export interface HeadlessJob {
  input: string;
  output: string;
  preset?: string;
  settings?: unknown;
  /** Keyframes, when supplied separately from a preset file. */
  timeline?: unknown;
  params?: Record<string, number | boolean | string>;
  format?: string;
  fps?: number;
  quality?: number;
  seed?: number;
  start?: number;
  end?: number;
  scale?: number;
  resolution?: string;
  height?: number;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  /** True when launched into headless batch mode. */
  isBatch?: boolean;
  openMedia(): Promise<OpenedMedia | null>;
  chooseSavePath(
    defaultName: string,
    filters?: { name: string; extensions: string[] }[],
  ): Promise<string | null>;
  writeFile(filePath: string, data: ArrayBuffer): Promise<string>;
  readFile(filePath: string): Promise<ArrayBuffer>;
  reveal(filePath: string): Promise<void>;
  onOpenFile?(handler: (file: OpenedMedia) => void): void;
  ffmpegAvailable(): Promise<boolean>;
  encodeStart(opts: EncodeStartOptions): Promise<{ id: string; outputPath: string }>;
  /** Decode a file front to back from `start`; frame k is start + k / fps. */
  decodeOpen?(opts: { filePath: string; start: number }): Promise<{ id: number; width: number; height: number; fps: number }>;
  /** Frame k as RGBA, or null past the end. */
  decodeFrame?(id: number, k: number): Promise<Uint8Array | null>;
  decodeClose?(id: number): Promise<void>;
  /** The file-system path of a dropped File, where there is one. */
  pathForFile?(file: File): string | null;
  encodeFrame(id: string, data: ArrayBuffer): Promise<boolean>;
  encodeFinish(id: string): Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  encodeCancel(id: string): Promise<boolean>;
  onJob(handler: (job: HeadlessJob) => void): void;
  jobReady(): void;
  jobDone(result: { ok: boolean; outputPath?: string; error?: string }): void;
}

declare global {
  interface Window {
    camai?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null =
  typeof window !== 'undefined' && window.camai ? window.camai : null;

export const isDesktop = !!desktop;

/**
 * True when the app was launched into headless batch mode.
 *
 * The preload flag is authoritative; the query string is only a fallback for
 * driving batch mode from a dev server.
 */
export const isBatchMode =
  !!desktop?.isBatch ||
  (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('job'));

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20_000);
}

/** Save through a real dialog on the desktop, fall back to a download in a tab. */
export async function saveBlob(
  blob: Blob,
  filename: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  if (desktop) {
    const target = await desktop.chooseSavePath(filename, filters);
    if (!target) return null;
    await desktop.writeFile(target, await blob.arrayBuffer());
    return target;
  }
  downloadBlob(blob, filename);
  return filename;
}
