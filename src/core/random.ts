import {
  GROUPS,
  Param,
  Settings,
  DEFAULTS,
} from './params';

/** Seedable PRNG so a "random" look can be reproduced from its seed alone. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RandomizeOptions {
  seed: number;
  /** 0 nudges the current settings, 1 replaces them outright. */
  amount: number;
  /** Group ids to touch. Omitted means every group. */
  groups?: string[];
  /** Leave enable toggles, geometry trims and output levels alone. */
  respectLocks?: boolean;
}

/**
 * Randomise a settings object.
 *
 * Two rules keep the results usable rather than merely chaotic. Parameters
 * marked `noRandom` — enable toggles, geometry trim, output levels, region —
 * are never touched, because randomising them produces a broken app rather than
 * an interesting set. And values are pulled towards the middle of their range
 * with a raised-cosine weighting, so extremes stay rare and every roll does not
 * come out looking like the same maximal mess.
 */
export function randomize(
  base: Settings,
  { seed, amount, groups, respectLocks = true }: RandomizeOptions,
): Settings {
  const rng = mulberry32(seed);
  const out: Settings = { ...base };
  const allowed = groups && groups.length ? new Set(groups) : null;

  for (const group of GROUPS) {
    if (allowed && !allowed.has(group.id)) continue;
    for (const param of group.params) {
      if (respectLocks && isLocked(param)) continue;
      out[param.key] = rollParam(param, base[param.key], rng, amount);
    }
  }
  return out;
}

function isLocked(param: Param): boolean {
  if ('noRandom' in param && param.noRandom) return true;
  return param.type === 'bool';
}

function rollParam(
  param: Param,
  current: Settings[string],
  rng: () => number,
  amount: number,
): Settings[string] {
  switch (param.type) {
    case 'enum': {
      // Enums flip only in proportion to the amount, otherwise every roll
      // changes the mask type and nothing else reads as a variation.
      if (rng() > amount * 0.6) return current ?? param.def;
      return param.options[Math.floor(rng() * param.options.length)].value;
    }
    case 'int':
    case 'float': {
      const target = biased(rng, param.min, param.max, param.def);
      const from = typeof current === 'number' ? current : param.def;
      const v = from + (target - from) * amount;
      const clamped = Math.max(param.min, Math.min(param.max, v));
      return param.type === 'int' ? Math.round(clamped) : quantize(clamped, param.step);
    }
    default:
      return current ?? param.def;
  }
}

/** Raised-cosine weighting towards the default, so extremes stay uncommon. */
function biased(rng: () => number, min: number, max: number, def: number): number {
  const u = (rng() + rng() + rng()) / 3;   // ~triangular, peaked at 0.5
  const span = max - min;
  const centre = (def - min) / Math.max(span, 1e-9);
  const skew = centre + (u - 0.5) * 1.35;
  return min + Math.max(0, Math.min(1, skew)) * span;
}

function quantize(v: number, step: number): number {
  if (!step || step <= 0) return v;
  return Math.round(v / step) * step;
}

/** Reset one group back to its shipped defaults. */
export function resetGroup(settings: Settings, groupId: string): Settings {
  const group = GROUPS.find((g) => g.id === groupId);
  if (!group) return settings;
  const out = { ...settings };
  for (const p of group.params) out[p.key] = DEFAULTS[p.key];
  return out;
}
