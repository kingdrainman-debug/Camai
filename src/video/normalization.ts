/**
 * Exposure normalisation for the beam profile and the phosphor mask.
 *
 * Both of these throw light away: the beam only illuminates part of each line's
 * height, and the mask blocks roughly two thirds of what reaches it. A real set
 * compensated by running far more beam current — which is why a CRT's gun works
 * so much harder than the picture suggests.
 *
 * Emulating that with a hand-set "brightness boost" slider means every change
 * to beam width, mask type or mask pitch silently changes exposure, so the
 * picture gets brighter or darker every time you adjust its texture. Instead
 * both stages are normalised to unit mean here, and the boost controls are left
 * as genuine artistic gain on top of a correct starting point.
 *
 * The mask integral below must stay in step with `phosphorMask()` in
 * tube.frag.glsl. It is the same function, evaluated on the CPU once per
 * parameter change rather than per pixel.
 */

/** Lanczos approximation of the gamma function, good to ~1e-10 for x > 0.5. */
function gammaFn(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/**
 * Mean of the beam profile `exp(-(|d| / halfWidth)^shape)` integrated over one
 * scanline pitch. Closed form: 2·h·Γ(1 + 1/s).
 *
 * The *unbloomed* half width is used deliberately, so that beam blooming still
 * brightens bright areas — on a real tube a blown highlight genuinely does put
 * more total light on the glass, because the gun is drawing more current.
 */
export function beamNormalisation(beamWidth: number, beamShape: number): number {
  const h = Math.max(beamWidth, 0.05) * 0.5;
  const s = Math.max(beamShape, 0.5);
  return Math.max(2 * h * gammaFn(1 + 1 / s), 0.05);
}

/* ------------------------------------------------------------------ *
 * Phosphor mask — CPU mirror of the shader's phosphorMask()
 * ------------------------------------------------------------------ */

function stripeWeights(phase: number, softness: number): [number, number, number] {
  const w: [number, number, number] = [0, 0, 0];
  let peak = 0;
  for (let i = 0; i < 3; i++) {
    let d = Math.abs(phase - (i + 0.5));
    d = Math.min(d, 3 - d);
    w[i] = Math.exp(-(d * d) / (2 * softness * softness));
    peak = Math.max(peak, w[i]);
  }
  const k = 1 / Math.max(peak, 1e-4);
  return [w[0] * k, w[1] * k, w[2] * k];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function maskAt(x: number, y: number, type: number, pitch: number, stagger: number): number {
  if (type === 0) return 1;
  const soft = Math.min(Math.max(0.28 + 0.55 / pitch, 0.28), 0.75);

  if (type === 1) {
    const w = stripeWeights(fract(x / pitch) * 3, soft);
    return (w[0] + w[1] + w[2]) / 3;
  }

  if (type === 2) {
    const col = Math.floor(x / pitch);
    const rowPitch = pitch * 2;
    const shift = (col % 2) * stagger * rowPitch * 0.5;
    const rowPhase = fract((y + shift) / rowPitch);
    const slot = smoothstep(0, 0.16, rowPhase) * smoothstep(1, 0.84, rowPhase);
    const w = stripeWeights(fract(x / pitch) * 3, soft);
    return ((w[0] + w[1] + w[2]) / 3) * (0.62 + 0.38 * slot);
  }

  const rowPitch = pitch * 1.732;
  const row = Math.floor(y / rowPitch);
  const offset = (row % 2) * 0.5;
  const phase = fract(x / pitch + offset) * 3;
  const rowPhase = fract(y / rowPitch);
  const dot = smoothstep(0, 0.3, rowPhase) * smoothstep(1, 0.7, rowPhase);
  const w = stripeWeights(phase, soft * 1.15);
  return ((w[0] + w[1] + w[2]) / 3) * (0.7 + 0.3 * dot);
}

const maskCache = new Map<string, number>();

/**
 * Reciprocal of the mask's spatial mean, so that
 * `mask * maskNormalisation(...)` averages to 1 whatever the mask is.
 */
export function maskNormalisation(type: number, pitch: number, stagger: number): number {
  const key = `${type}|${pitch.toFixed(3)}|${stagger.toFixed(3)}`;
  const hit = maskCache.get(key);
  if (hit !== undefined) return hit;

  const p = Math.max(pitch, 1);
  const spanX = p * 6;
  const spanY = p * 4 * 1.732;
  const steps = 48;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      sum += maskAt(((i + 0.5) / steps) * spanX, ((j + 0.5) / steps) * spanY, type, p, stagger);
    }
  }
  const mean = sum / (steps * steps);
  const value = 1 / Math.max(mean, 1e-3);
  if (maskCache.size > 256) maskCache.clear();
  maskCache.set(key, value);
  return value;
}
