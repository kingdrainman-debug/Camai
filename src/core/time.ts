/**
 * Timecode formatting and parsing for the export range.
 *
 * Durations are held in seconds everywhere internally; this is purely how they
 * are shown to and taken from the user.
 */

/** `1:02:03.4`, `2:03.4` or `3.4` — the largest unit present is the first shown. */
export function formatTimecode(seconds: number, alwaysHours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const s = secs.toFixed(1).padStart(4, '0');
  if (hours > 0 || alwaysHours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${s}`;
  }
  return `${minutes}:${s}`;
}

/**
 * Accepts `h:mm:ss.s`, `m:ss.s` or a bare number of seconds, so the field can be
 * typed into naturally rather than demanding a fixed shape.
 *
 * Returns null when the text cannot be read as a time, which the caller uses to
 * keep the previous value rather than snapping the field to zero mid-edit.
 */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part === '' || !/^\d*\.?\d*$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0) return null;
    // Rightmost component is seconds, then minutes, then hours.
    total += value * Math.pow(60, parts.length - 1 - i);
  }
  return total;
}

/** Human duration for a summary line: "4.0 s", "1 min 04 s", "1 h 02 min". */
export function describeDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s';
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}
