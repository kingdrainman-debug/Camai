/**
 * Realtime capture of the preview canvas plus the processed audio.
 *
 * This is the browser path. It is honest about what it is: the clip plays once
 * through in real time and the composited result is muxed straight into WebM.
 * Anything the machine cannot keep up with is a dropped frame.
 *
 * The desktop build has a second path that pipes deterministic frames into a
 * bundled ffmpeg instead — see electron/main.cjs.
 */

export interface RecordOptions {
  fps: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  onStop?: () => void;
}

export interface Recording {
  stop(): Promise<Blob>;
  readonly mimeType: string;
}

const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export function pickMimeType(): string {
  for (const type of CANDIDATES) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export function startRecording(
  canvas: HTMLCanvasElement,
  audioStream: MediaStream | null,
  opts: RecordOptions,
): Recording {
  const stream = canvas.captureStream(opts.fps);
  if (audioStream) {
    for (const track of audioStream.getAudioTracks()) stream.addTrack(track);
  }

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: opts.videoBitsPerSecond ?? 12_000_000,
    audioBitsPerSecond: opts.audioBitsPerSecond ?? 192_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  return {
    mimeType: recorder.mimeType || mimeType || 'video/webm',
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          for (const track of stream.getVideoTracks()) track.stop();
          opts.onStop?.();
          resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob(chunks, { type: 'video/webm' }));
      });
    },
  };
}
