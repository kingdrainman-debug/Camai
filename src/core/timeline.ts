/**
 * Keyframe animation.
 *
 * Any parameter in the schema can be animated over time. A timeline is a flat
 * map from parameter key to a sorted list of keyframes, which keeps it as
 * diffable and hand-editable as the settings object it sits alongside, and
 * means adding a new parameter to the schema makes it animatable for free.
 *
 * Numbers interpolate; booleans and enums hold. That is not a shortcut — there
 * is no meaningful value half way between "slot mask" and "aperture grille", so
 * a step is the only honest interpolation, and it is what every editor does for
 * non-numeric properties.
 */

import { PARAM_BY_KEY, Param, ParamValue, Settings } from './params';

/** Easing applied to the segment *leaving* a keyframe, as in After Effects. */
export type Easing = 'linear' | 'hold' | 'in' | 'out' | 'inOut';

export const EASINGS: { value: Easing; label: string; hint: string }[] = [
  { value: 'linear', label: 'Linear', hint: 'Constant rate. Reads as mechanical, which is often exactly right for a fault.' },
  { value: 'hold', label: 'Hold', hint: 'No interpolation at all — the value jumps at the next keyframe. This is how you cut.' },
  { value: 'in', label: 'Ease in', hint: 'Starts slowly, then accelerates. Something building.' },
  { value: 'out', label: 'Ease out', hint: 'Starts fast and settles. Something recovering.' },
  { value: 'inOut', label: 'Ease in-out', hint: 'Smooth at both ends. The least noticeable move.' },
];

export interface Keyframe {
  /** Time in seconds from the start of the clip. */
  t: number;
  value: ParamValue;
  ease: Easing;
}

/** Parameter key → keyframes, always sorted ascending by time. */
export type Timeline = Record<string, Keyframe[]>;

export const EMPTY_TIMELINE: Timeline = {};

/* ------------------------------------------------------------------ *
 * Easing
 * ------------------------------------------------------------------ */

function applyEase(u: number, ease: Easing): number {
  const t = u < 0 ? 0 : u > 1 ? 1 : u;
  switch (ease) {
    case 'hold':
      return 0;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'inOut':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    default:
      return t;
  }
}

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

function interpolable(param: Param | undefined): boolean {
  return !!param && (param.type === 'float' || param.type === 'int');
}

/** Value of one animated parameter at a given time. */
export function valueAt(key: string, keys: Keyframe[], time: number): ParamValue | undefined {
  if (!keys || keys.length === 0) return undefined;
  if (keys.length === 1) return keys[0].value;

  const param = PARAM_BY_KEY[key];
  if (time <= keys[0].t) return keys[0].value;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.value;

  // Small lists, and they are already sorted — a linear scan is cheaper than
  // the branch misprediction of a binary search at this size.
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= time) i++;
  const a = keys[i];
  const b = keys[i + 1];

  if (!interpolable(param) || a.ease === 'hold') return a.value;

  const span = b.t - a.t;
  if (span <= 1e-6) return b.value;
  const u = applyEase((time - a.t) / span, a.ease);
  const av = Number(a.value);
  const bv = Number(b.value);
  const v = av + (bv - av) * u;
  return param && param.type === 'int' ? Math.round(v) : v;
}

/**
 * Settings with every animated parameter replaced by its value at `time`.
 *
 * Returns the base object untouched when nothing is animated, so the common
 * case allocates nothing and the render loop stays free of garbage.
 */
export function evaluateTimeline(base: Settings, timeline: Timeline, time: number): Settings {
  const keys = Object.keys(timeline);
  if (keys.length === 0) return base;

  let out: Settings | null = null;
  for (const key of keys) {
    const value = valueAt(key, timeline[key], time);
    if (value === undefined || value === base[key]) continue;
    if (!out) out = { ...base };
    out[key] = value;
  }
  return out ?? base;
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

/** Keyframes within `tolerance` seconds are treated as the same keyframe. */
export const SNAP = 1e-3;

export function isAnimated(timeline: Timeline, key: string): boolean {
  return Array.isArray(timeline[key]);
}

export function animatedKeys(timeline: Timeline): string[] {
  return Object.keys(timeline).filter((k) => PARAM_BY_KEY[k]);
}

export function indexAt(keys: Keyframe[], time: number, tolerance = SNAP): number {
  return keys.findIndex((k) => Math.abs(k.t - time) <= tolerance);
}

function sorted(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.t - b.t);
}

/**
 * Start animating a parameter, seeding a keyframe at the playhead holding its
 * current value — so switching animation on never changes the picture.
 */
export function beginAnimating(
  timeline: Timeline,
  key: string,
  time: number,
  current: ParamValue,
  ease: Easing = 'linear',
): Timeline {
  if (isAnimated(timeline, key)) return timeline;
  return { ...timeline, [key]: [{ t: Math.max(0, time), value: current, ease }] };
}

export function stopAnimating(timeline: Timeline, key: string): Timeline {
  if (!isAnimated(timeline, key)) return timeline;
  const out = { ...timeline };
  delete out[key];
  return out;
}

/** Add a keyframe, or overwrite the one already at this time. */
export function setKeyframe(
  timeline: Timeline,
  key: string,
  time: number,
  value: ParamValue,
  ease: Easing = 'linear',
): Timeline {
  const t = Math.max(0, time);
  const keys = timeline[key] ?? [];
  const at = indexAt(keys, t);
  const next =
    at >= 0
      ? keys.map((k, i) => (i === at ? { ...k, value } : k))
      : sorted([...keys, { t, value, ease }]);
  return { ...timeline, [key]: next };
}

export function removeKeyframe(timeline: Timeline, key: string, index: number): Timeline {
  const keys = timeline[key];
  if (!keys || index < 0 || index >= keys.length) return timeline;
  const next = keys.filter((_, i) => i !== index);
  // Removing the last keyframe stops the parameter animating entirely, rather
  // than leaving an empty track that looks animated but does nothing.
  if (next.length === 0) return stopAnimating(timeline, key);
  return { ...timeline, [key]: next };
}

export function moveKeyframe(
  timeline: Timeline,
  key: string,
  index: number,
  time: number,
): Timeline {
  const keys = timeline[key];
  if (!keys || index < 0 || index >= keys.length) return timeline;
  const moved = keys.map((k, i) => (i === index ? { ...k, t: Math.max(0, time) } : k));
  return { ...timeline, [key]: sorted(moved) };
}

export function setEase(
  timeline: Timeline,
  key: string,
  index: number,
  ease: Easing,
): Timeline {
  const keys = timeline[key];
  if (!keys || index < 0 || index >= keys.length) return timeline;
  return { ...timeline, [key]: keys.map((k, i) => (i === index ? { ...k, ease } : k)) };
}

/** Every keyframe time in the timeline, de-duplicated and sorted. */
export function allKeyTimes(timeline: Timeline): number[] {
  const times = new Set<number>();
  for (const keys of Object.values(timeline)) {
    for (const k of keys) times.add(Math.round(k.t * 1000) / 1000);
  }
  return [...times].sort((a, b) => a - b);
}

/** Nearest keyframe time strictly before/after `time`, for jump-to-key. */
export function neighbourKeyTime(
  timeline: Timeline,
  time: number,
  direction: -1 | 1,
): number | null {
  const times = allKeyTimes(timeline);
  if (direction < 0) {
    const before = times.filter((t) => t < time - SNAP);
    return before.length ? before[before.length - 1] : null;
  }
  const after = times.filter((t) => t > time + SNAP);
  return after.length ? after[0] : null;
}

/** Shift every keyframe so the timeline still lines up after a range change. */
export function scaleTimeline(timeline: Timeline, factor: number): Timeline {
  if (!Number.isFinite(factor) || factor <= 0) return timeline;
  const out: Timeline = {};
  for (const [key, keys] of Object.entries(timeline)) {
    out[key] = keys.map((k) => ({ ...k, t: k.t * factor }));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Serialisation — presets carry their animation with them
 * ------------------------------------------------------------------ */

export function sanitizeTimeline(raw: unknown): Timeline {
  const out: Timeline = {};
  if (!raw || typeof raw !== 'object') return out;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const param = PARAM_BY_KEY[key];
    if (!param || !Array.isArray(value)) continue;

    const keys: Keyframe[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue;
      const k = entry as Record<string, unknown>;
      const t = Number(k.t);
      if (!Number.isFinite(t) || t < 0) continue;
      const ease = EASINGS.some((e) => e.value === k.ease) ? (k.ease as Easing) : 'linear';
      keys.push({ t, value: coerceKeyValue(param, k.value), ease });
    }
    if (keys.length) out[key] = sorted(keys);
  }
  return out;
}

function coerceKeyValue(param: Param, raw: unknown): ParamValue {
  switch (param.type) {
    case 'bool':
      return raw === true || raw === 'true' || raw === 1;
    case 'enum':
      return param.options.some((o) => o.value === raw) ? (raw as string) : param.def;
    case 'int': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(Math.max(param.min, Math.min(param.max, n))) : param.def;
    }
    default: {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(param.min, Math.min(param.max, n)) : param.def;
    }
  }
}

export function countKeyframes(timeline: Timeline): number {
  return Object.values(timeline).reduce((n, keys) => n + keys.length, 0);
}
