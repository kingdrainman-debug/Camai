/**
 * The camera's automatics: exposure and white balance.
 *
 * Professional video is defined by its controls and consumer video by their
 * absence, so this is where the camcorder's character lives. Both loops
 * measure the picture the lens delivers and steer towards a target with lag:
 * walk from a room into daylight and the picture blows out, then pumps down
 * over a second; switch on a tungsten lamp and the balance drifts orange and
 * only part of the way back.
 *
 * Unlike everything else in the chain these have memory. A field's exposure
 * depends on the fields before it. That is handled the way FILMBOX handled
 * seeking (CRTBOX lesson 3): the state steps once per field in order, and on
 * any discontinuity — a seek, the first frame of an export — it settles
 * instantly on the target for the current picture, which is where a camera
 * that had been pointing at it for a while would be. An export always steps
 * from its first frame in order, so it is reproducible.
 *
 * The meter reads a 64×48 thumbnail of the source through the current view,
 * computed identically for both renderers (see sources.ts), so the GPU and
 * the CPU backends steer to the same exposure.
 */

import { Settings, bool, num, str } from '../core/params';
import { SystemInfo, manualShutter } from './clock';

export interface Meter {
  /** Mean linear RGB of what the lens sees. */
  rgb: [number, number, number];
  /** Centre-weighted mean luminance. */
  centre: number;
  /** Plain mean luminance. */
  lum: number;
}

export interface Exposure {
  /** Total exposure relative to f/1.6, a field period and 0 dB, stops. */
  X: number;
  irisStops: number;
  shutterStops: number;
  gainStops: number;
  fNumber: number;
  /** Seconds. */
  shutter: number;
  gainDb: number;
  /** Linear multiplier from scene light to charge, per channel (illuminant and flicker included). */
  light: [number, number, number];
  /** The camera's own light, for the IR lamp: charge multiplier without the scene. */
  ownLight: number;
  /** Signal gain applied after the sensor. */
  gain: number;
  /** White balance gains, R G B. */
  wb: [number, number, number];
}

/** Illuminant colour relative to daylight, green normalised to 1. */
export const ILLUMINANT: Record<string, [number, number, number]> = {
  neutral: [1, 1, 1],
  daylight: [1, 1, 1],
  tungsten: [1.46, 1, 0.52],
  household: [1.62, 1, 0.44],
  fluorescent: [0.86, 1, 0.8],
  overcast: [0.88, 1, 1.17],
};

const IRIS_WIDE = 1.6;
/** Stopping down past this softens the picture, so the camera raises the shutter first. */
const IRIS_SHUTTER_POINT = -2 * Math.log2(5.6 / IRIS_WIDE);
const IRIS_MIN = -2 * Math.log2(16 / IRIS_WIDE);
const SHUTTER_FASTEST = 1 / 4000;

/** Mains flicker of a fluorescent tube, integrated over the shutter. */
function flicker(light: string, mains: number, tEnd: number, T: number): number {
  if (light !== 'fluorescent') return 1;
  const w = 2 * Math.PI * 2 * mains;
  const depth = 0.32;
  // Mean of 1 + depth·cos(w t) over [tEnd − T, tEnd].
  return 1 + (depth * (Math.sin(w * tEnd) - Math.sin(w * (tEnd - T)))) / (w * T);
}

interface State {
  m: number;
  X: number;
  V: number;
  /** log gains of R and B relative to G. */
  lr: number;
  lb: number;
  /** Long-run average of the metered flicker, for the AE's averaging. */
  flick: number;
  key: string;
}

export class Automatics {
  private st: State | null = null;
  private cache = new Map<number, Exposure>();

  reset(): void {
    this.st = null;
    this.cache.clear();
  }

  /**
   * Exposure for field m. Fields must be asked for in order for the loops to
   * have their lag; anything else settles them.
   */
  step(s: Settings, sys: SystemInfo, m: number, tField: number, meter: Meter, own = 0): Exposure {
    const hit = this.cache.get(m);
    const key = settingsKey(s);
    if (hit && this.st && this.st.key === key) return hit;

    const expOn = bool(s, 'exposure.enabled');
    const wbOn = bool(s, 'wb.enabled');
    const light = wbOn ? str(s, 'wb.light') : 'neutral';
    const illum = ILLUMINANT[light] ?? ILLUMINANT.neutral;
    const dt = 1 / sys.fieldRate;
    const base = 1 / sys.fieldRate;

    // ---- exposure ----
    const scene = expOn ? num(s, 'exposure.scene') : 0;
    const manualT = manualShutter(s, sys);
    const blc = expOn && bool(s, 'exposure.backlight');
    const metered = (blc ? meter.centre * 0.7 + meter.lum * 0.3 : meter.centre * 0.6 + meter.lum * 0.4) *
      (illum[0] * 0.3 + illum[1] * 0.59 + illum[2] * 0.11);
    const maxGainStops = expOn ? num(s, 'exposure.maxGain') / 6.0206 : 0;
    const manualStops = manualT !== null ? Math.log2(manualT / base) : 0;
    const Xmax = maxGainStops + Math.max(0, manualStops);
    const Xmin = IRIS_MIN + (manualT !== null ? Math.min(0, manualStops) : Math.log2(SHUTTER_FASTEST / base));

    // The previous field, or a recent one: a preview that cannot keep up
    // skips frames, and the loops catch up over the gap rather than
    // settling, so the lag is still seen.
    const gap = this.st && this.st.key === key ? m - this.st.m : 0;
    const prev = gap >= 1 && gap <= 240 ? this.st : null;
    const steps = prev ? gap : 1;
    const tGuess = manualT ?? base;
    const fl = flicker(light, sys.mains, tField, tGuess);
    const avgFlick = prev ? prev.flick : fl;
    const hunt = expOn ? num(s, 'exposure.hunt') : 0;
    // `own` is the camera's own lamp, in the same units as the scene: it is
    // metered too, which is why an IR hot spot pulls the exposure down.
    const seen = Math.max(1e-5, metered * Math.pow(2, scene) * (avgFlick + (fl - avgFlick) * hunt) + own * meter.lum);
    const comp = expOn ? num(s, 'exposure.comp') + (blc ? 1.5 : 0) : 0;
    // The level an automatic camera aims for: a little under mid grey.
    const aim = 0.16 * Math.pow(2, comp);

    let X: number;
    let V: number;
    if (!expOn) {
      X = 0;
      V = 0;
    } else if (str(s, 'exposure.mode') === 'manual') {
      X = -scene + comp;
      V = 0;
    } else {
      const current = prev ? prev.X : 0;
      // What the loop sees: the error at the current setting.
      const target = clamp(current + Math.log2(aim / (seen * Math.pow(2, current))), Xmin, Xmax);
      if (!prev) {
        X = target;
        V = 0;
      } else {
        const w = 4 / Math.max(num(s, 'exposure.speed'), 0.05);
        const z = num(s, 'exposure.damping');
        X = prev.X;
        V = prev.V;
        for (let i = 0; i < steps; i++) {
          V += (w * w * (target - X) - 2 * z * w * V) * dt;
          X = clamp(X + V * dt, Xmin - 1, Xmax + 1);
        }
      }
    }
    X = clamp(X, Xmin, Xmax);

    // The program, from the most sensitive setting down: gain off first,
    // then the iris to about f/5.6, then the shutter faster, then the iris
    // the rest of the way into diffraction.
    let gainStops = 0;
    let irisStops = 0;
    let shutterStops = manualStops;
    if (expOn) {
      let deficit = Xmax - X;
      gainStops = maxGainStops;
      const take = (have: number) => {
        const t = Math.min(have, deficit);
        deficit -= t;
        return t;
      };
      gainStops -= take(maxGainStops);
      if (manualStops > 0) shutterStops -= take(manualStops);
      irisStops -= take(-IRIS_SHUTTER_POINT);
      if (manualT === null) shutterStops -= take(-Math.log2(SHUTTER_FASTEST / base));
      irisStops -= take(IRIS_SHUTTER_POINT - IRIS_MIN);
    }
    const shutter = base * Math.pow(2, shutterStops);
    const flk = flicker(light, sys.mains, tField, shutter);
    const lightMul = expOn ? Math.pow(2, scene + irisStops + shutterStops) * flk : 1;

    // ---- white balance ----
    let lr = 0;
    let lb = 0;
    if (wbOn) {
      const mode = str(s, 'wb.mode');
      if (mode === 'indoor') {
        lr = -Math.log(ILLUMINANT.tungsten[0]);
        lb = -Math.log(ILLUMINANT.tungsten[2]);
      } else if (mode === 'outdoor') {
        lr = 0;
        lb = 0;
      } else {
        // Grey world: make the frame's mean neutral, but only along the
        // amber–blue axis of the daylight locus, and only part of the way.
        // Consumer cameras barely touched green–magenta, so fluorescent
        // light stays green.
        const r = meter.rgb[0] * illum[0];
        const g = meter.rgb[1] * illum[1];
        const b = meter.rgb[2] * illum[2];
        const wr = Math.log(Math.max(g, 1e-5) / Math.max(r, 1e-5));
        const wbb = Math.log(Math.max(g, 1e-5) / Math.max(b, 1e-5));
        const range = num(s, 'wb.range');
        const along = ((wbb - wr) / 2) * range;
        const across = ((wr + wbb) / 2) * range * 0.2;
        let tr = across - along;
        let tb = across + along;
        tr = clamp(tr, -0.9, 0.9);
        tb = clamp(tb, -0.9, 1.2);
        const settle = !prev || mode === 'hold';
        if (settle && !(mode === 'hold' && prev)) {
          lr = tr;
          lb = tb;
        } else if (mode === 'hold' && prev) {
          lr = prev.lr;
          lb = prev.lb;
        } else {
          const k = 1 - Math.exp(-(dt * steps) / Math.max(num(s, 'wb.speed'), 0.05));
          lr = prev!.lr + (tr - prev!.lr) * k;
          lb = prev!.lb + (tb - prev!.lb) * k;
        }
      }
    }
    const tintGain = wbOn ? 1 + num(s, 'wb.tint') * 0.1 : 1;

    const exp: Exposure = {
      X,
      irisStops,
      shutterStops,
      gainStops,
      fNumber: IRIS_WIDE * Math.pow(2, -irisStops / 2),
      shutter,
      gainDb: gainStops * 6.0206,
      light: [lightMul * illum[0], lightMul * illum[1], lightMul * illum[2]],
      ownLight: expOn ? Math.pow(2, irisStops + shutterStops) : 1,
      gain: Math.pow(2, gainStops),
      wb: [Math.exp(lr), tintGain, Math.exp(lb)],
    };

    this.st = { m, X, V, lr, lb, flick: prev ? prev.flick + (fl - prev.flick) * 0.1 : fl, key };
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(m, exp);
    return exp;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** The settings the automatics depend on; a change re-settles them. */
function settingsKey(s: Settings): string {
  const keys = [
    'exposure.enabled', 'exposure.mode', 'exposure.comp', 'exposure.speed', 'exposure.damping',
    'exposure.backlight', 'exposure.shutter', 'exposure.maxGain', 'exposure.hunt',
    'wb.enabled', 'wb.light', 'wb.mode', 'wb.speed', 'wb.range', 'wb.tint', 'format.system',
  ];
  return keys.map((k) => String(s[k])).join('|');
}
