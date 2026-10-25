import { useEffect, useState } from 'react';
import { isDesktop } from '../platform/desktop';
import { describeDuration, formatTimecode, parseTimecode } from '../core/time';
import { RESOLUTION_TARGETS, ResolutionTarget } from '../core/output';

export type ExportFormat = 'h264' | 'hevc' | 'prores' | 'dv' | 'gif' | 'webm' | 'pngseq' | 'wav';

export interface ExportSettings {
  format: ExportFormat;
  quality: number;
  scale: number;
  /** Output height target. The width follows from the projection aspect. */
  resolution: ResolutionTarget;
  /** Used only when `resolution` is 'custom'. */
  customHeight: number;
  start: number;
  end: number;
  useSourceRange: boolean;
  /** How long a still image runs for when it is rendered as a clip. */
  stillDuration: number;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: isDesktop ? 'h264' : 'webm',
  quality: 18,
  scale: 1,
  resolution: '1080p',
  customHeight: 1080,
  start: 0,
  end: 0,
  useSourceRange: true,
  stillDuration: 10,
};

interface Props {
  value: ExportSettings;
  duration: number;
  /** The loaded media is a still image, so the clip length is chosen not read. */
  isStill: boolean;
  busy: boolean;
  progress: number;
  status: string;
  /** Pixel dimensions the current settings will produce, for the readout. */
  outputSize: { width: number; height: number };
  /** Output height ÷ source height. Above 1 the render is an upscale. */
  upscale: number;
  /** Frame rate of the output, from Framing & Output. */
  fps: number;
  /** DV frames per second, for the field note. */
  dvFps: number;
  onChange(next: ExportSettings): void;
  onRenderDeterministic(): void;
  onRecordRealtime(): void;
  onSnapshot(): void;
  onCancel(): void;
}

const FORMATS: { value: ExportFormat; label: string; desktopOnly?: boolean; hint: string }[] = [
  { value: 'h264', label: 'H.264 · .mp4', desktopOnly: true, hint: 'Plays everywhere. Muxed with the processed audio.' },
  { value: 'hevc', label: 'HEVC · .mp4', desktopOnly: true, hint: 'Smaller at the same quality; fussier about players.' },
  { value: 'dv', label: 'DV · .dv', desktopOnly: true, hint: 'A real DV file, 720 × 480 or 720 × 576, interlaced, bottom field first, with PCM audio, cut as DV by any editor. The picture is rendered up to the codec and FFmpeg’s own dvvideo encoder does the DV encoding, so the codec in the file is the codec in the file; the display stages, which are not on a tape, are left out.' },
  { value: 'prores', label: 'ProRes 422 HQ · .mov', desktopOnly: true, hint: 'For handing to an edit. Large files, uncompressed audio.' },
  { value: 'gif', label: 'Animated GIF', desktopOnly: true, hint: 'Palette-optimised. No audio, obviously.' },
  { value: 'webm', label: 'WebM · VP9 + Opus', hint: 'Captured in real time from the preview. The only video format a browser tab can write on its own.' },
  { value: 'pngseq', label: 'PNG sequence (.zip)', hint: 'Deterministic frames plus a WAV of the processed audio, zipped.' },
  { value: 'wav', label: 'Audio only · .wav', hint: 'Renders the audio chain offline at 48 kHz / 24-bit.' },
];

/** A text field that reads and writes h:mm:ss.s but stores plain seconds. */
function TimeField({
  label,
  seconds,
  disabled,
  onCommit,
}: {
  label: string;
  seconds: number;
  disabled?: boolean;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatTimecode(seconds);

  const commit = (text: string) => {
    const parsed = parseTimecode(text);
    // Unparseable input keeps the old value rather than snapping to zero.
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };

  return (
    <label className="field time">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={shown}
        disabled={disabled}
        placeholder="0:00.0"
        title="h:mm:ss.s — or just a number of seconds"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    </label>
  );
}

export function ExportPanel({
  value,
  duration,
  isStill,
  busy,
  progress,
  status,
  outputSize,
  upscale,
  fps,
  dvFps,
  onChange,
  onRenderDeterministic,
  onRecordRealtime,
  onSnapshot,
  onCancel,
}: Props) {
  const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isDesktop) {
      setFfmpeg(false);
      return;
    }
    window.camai?.ffmpegAvailable().then(setFfmpeg).catch(() => setFfmpeg(false));
  }, []);

  const set = <K extends keyof ExportSettings>(key: K, v: ExportSettings[K]) =>
    onChange({ ...value, [key]: v });

  const available = FORMATS.filter((f) => !f.desktopOnly || (isDesktop && ffmpeg !== false));
  const active = FORMATS.find((f) => f.value === value.format);
  const realtime = value.format === 'webm';
  const audioOnly = value.format === 'wav';

  const start = isStill ? 0 : value.useSourceRange ? 0 : value.start;
  const end = isStill ? value.stillDuration : value.useSourceRange ? duration : value.end;

  return (
    <div className="export">
      <div className="row">
        <label className="field">
          <span>Format</span>
          <select
            value={value.format}
            onChange={(e) => set('format', e.target.value as ExportFormat)}
            disabled={busy}
          >
            {available.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        {!audioOnly && (
          <label
            className="field small"
            title="Set under Display ▸ Output: one frame per DV frame, or one per field."
          >
            <span>FPS</span>
            <input type="text" value={formatFps(fps)} readOnly disabled />
          </label>
        )}

        {!audioOnly && (value.format === 'h264' || value.format === 'hevc') && (
          <label className="field small">
            <span>CRF</span>
            <input
              type="number"
              min={0}
              max={51}
              value={value.quality}
              onChange={(e) => set('quality', Number(e.target.value) || 18)}
              disabled={busy}
            />
          </label>
        )}

        {!audioOnly && (
          <label className="field">
            <span>Resolution</span>
            <select
              value={value.resolution}
              onChange={(e) => set('resolution', e.target.value as ResolutionTarget)}
              disabled={busy}
            >
              {RESOLUTION_TARGETS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {!audioOnly && value.resolution === 'custom' && (
          <label className="field small">
            <span>Height</span>
            <input
              type="number"
              min={32}
              max={4320}
              step={2}
              value={value.customHeight}
              onChange={(e) =>
                set('customHeight', Math.max(32, Math.min(4320, Number(e.target.value) || 1080)))
              }
              disabled={busy}
            />
          </label>
        )}
      </div>

      {!audioOnly && (
        <p className="export-hint size">
          <strong>
            {outputSize.width}×{outputSize.height}
          </strong>{' '}
          {' '}at {formatFps(fps)} fps — the frame is the shape of the picture at
          the DV raster’s pixel aspect, with no bars baked in. Everything is
          rendered in the 720-sample DV raster first and scaled to this size at
          the end, so an 8×8 block stays 8×8 DV pixels whatever the output.
          {fps > dvFps * 1.5 && (
            <>
              {' '}
              Field rate: each DV frame is shown as its two fields in turn.
            </>
          )}
          {upscale > 1.02 && (
            <>
              {' '}
              The source is {upscale.toFixed(1)}× smaller than the output; the
              camera only ever sees it at 720 samples a line in any case.
            </>
          )}
        </p>
      )}

      {active && <p className="export-hint">{active.hint}</p>}

      {isStill && !audioOnly && (
        <div className="row">
          <TimeField
            label="Clip length"
            seconds={value.stillDuration}
            disabled={busy}
            onCommit={(v) => set('stillDuration', Math.max(0.1, Math.min(3600, v)))}
          />
          <span className="range-note">
            The camera is pointed at the still for this long, and runs: the
            operator’s hand, the automatics, the noise and the tape keep moving,
            so the result is a recording rather than a frozen frame.
          </span>
        </div>
      )}

      {!isStill && duration > 0 && !audioOnly && (
        <div className="row">
          <label className="field check">
            <input
              type="checkbox"
              checked={value.useSourceRange}
              onChange={(e) => set('useSourceRange', e.target.checked)}
              disabled={busy}
            />
            <span>Whole clip</span>
          </label>
          {!value.useSourceRange && (
            <>
              <TimeField
                label="In"
                seconds={value.start}
                disabled={busy}
                onCommit={(v) => set('start', Math.max(0, Math.min(duration, v)))}
              />
              <TimeField
                label="Out"
                seconds={value.end}
                disabled={busy}
                onCommit={(v) => set('end', Math.max(0, Math.min(duration, v)))}
              />
            </>
          )}
          <span className="range-note">
            Length {describeDuration(Math.max(0, end - start))}
          </span>
        </div>
      )}

      {isDesktop && ffmpeg === false && (
        <p className="warn">
          ffmpeg was not found, so the .mp4/.mov/.dv/.gif targets are hidden. Install the optional
          <code> ffmpeg-static </code> dependency, or set <code>CAMAI_FFMPEG</code> to a binary.
        </p>
      )}

      <div className="row actions">
        {busy ? (
          <>
            <div className="progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <button className="danger" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              onClick={realtime ? onRecordRealtime : onRenderDeterministic}
              disabled={duration <= 0 && !audioOnly && !isStill}
            >
              {realtime ? 'Record in real time' : audioOnly ? 'Render audio' : 'Render'}
            </button>
            <button onClick={onSnapshot}>Snapshot frame</button>
          </>
        )}
      </div>

      {status && <p className={`status${status.startsWith('Error') ? ' error' : ''}`}>{status}</p>}
    </div>
  );
}

function formatFps(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(3).replace(/0+$/, '');
}
