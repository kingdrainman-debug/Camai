// The film: one frame of it, developed, printed and aged.
//
// Coordinates are millimetres on the film, with the camera aperture centred
// at the origin, so everything that belongs to the film — grain, dust, a
// scratch, mould — is fixed to the film and travels with it when the
// projector weaves. The image itself arrives through the camera's own
// registration error, which moves it relative to all of those.
//
// Output is density, not light: the projector has to average light through
// the film (for its focus) and multiply in its lamp before the telecine sees
// it, and both of those are done in the present pass.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_E;   // exposure
uniform sampler2D u_H;   // exposure, blurred by the halation distance
uniform sampler2D u_V;   // exposure, blurred very wide, for veiling flare
uniform sampler2D u_S;   // thresholded exposure, streaked sideways

uniform vec2 u_apMm;
uniform vec2 u_fSizeMm;
uniform vec2 u_eSizeMm;
uniform float u_pixUm;      // one film-frame pixel, µm on the film
uniform float u_gateRadius;

// This frame.
uniform vec2 u_camWeave;
uniform float u_expStops;
uniform float u_frameSeed;
uniform float u_frameN;
uniform float u_splice;
uniform float u_spliceFlash;
uniform float u_spliceKind;
uniform float u_cue;
uniform float u_leak;
uniform float u_leakAngle;
uniform float u_rollFog;
uniform float u_edgeFog;
uniform float u_leakWarmth;
uniform vec4 u_scratch[6];

// The stock.
uniform int u_mode;          // 0 negative, 1 reversal, 2 linear
uniform float u_mono;
uniform vec3 u_monoW;
uniform vec3 u_expGain;
uniform vec3 u_gamma;
uniform vec3 u_xt;
uniform vec3 u_xs;
uniform float u_toeSoft;
uniform float u_shoulderSoft;
uniform vec3 u_dmin;
uniform vec3 u_dmax;
uniform float u_interimage;
uniform vec3 u_grainSigma;
uniform vec3 u_grainCell;
uniform float u_grainRough;
uniform float u_grainExp;
uniform float u_grainIndep;
uniform float u_printSigma;
uniform float u_printCell;
uniform float u_dupeSigma;
uniform vec3 u_halW;
uniform float u_flare;
uniform vec3 u_flareTint;
uniform float u_streak;
uniform vec3 u_streakTint;

// Negative to positive.
uniform int u_process;       // 0 print, 1 scan, 2 raw negative
uniform float u_pMono;
uniform vec3 u_pGamma;
uniform vec3 u_pXt;
uniform vec3 u_pXs;
uniform float u_pToeSoft;
uniform float u_pShoulderSoft;
uniform vec3 u_pDmin;
uniform vec3 u_pDmax;
uniform vec3 u_pK;
uniform vec3 u_scanGrey;
uniform float u_scanRatio;
uniform int u_generations;
uniform float u_bleach;

// The final positive.
uniform float u_aim;
uniform vec3 u_finalDmin;
uniform mat3 u_dye;
uniform vec3 u_stain;
uniform float u_fadeNeg;
uniform vec3 u_layers;
uniform vec3 u_origLayers;

// Dirt and decay.
uniform float u_dust;
uniform float u_fibres;
uniform float u_dirtSize;
uniform float u_dirtNeg;
uniform float u_vinegar;
uniform float u_channelling;
uniform float u_mould;
uniform float u_water;
uniform float u_flaking;
uniform float u_seed;

const float LOG10_GREY = -0.744727495;   // log10(0.18)

/* ---------------- the curve ---------------- */

vec3 sp3(vec3 z) {
  return max(z, 0.0) + log(1.0 + exp(-abs(z)));
}

vec3 response(vec3 x, vec3 g, vec3 xt, vec3 xs, float t, float s) {
  return g * (t * sp3((x - xt) / t) - s * sp3((x - xs) / s));
}

/* ---------------- grain ---------------- */

// Unit-variance value noise. The smoothstep interpolation leaves value noise
// with a standard deviation of about 0.19; dividing it back out lets the
// granularity figures mean what the data sheets say.
float gnoise(vec2 p) {
  return (vnoise(p) - 0.5) * 5.26;
}

// Grain as clumps: a fine octave at the clump size and a coarser one where
// clumps gather, weighted by the roughness.
float grainField(vec2 um, float cell, vec2 off) {
  vec2 p = um / cell + off;
  float f = gnoise(p);
  float c = gnoise(p * 0.5 + 37.1);
  return (f + u_grainRough * c) * inversesqrt(1.0 + u_grainRough * u_grainRough);
}

vec3 grainNoise(vec2 um, vec3 cell, vec2 off) {
  float shared = grainField(um, cell.g, off + vec2(3.1, 7.7));
  if (u_mono > 0.5) return vec3(shared);
  vec3 n = vec3(
    grainField(um, cell.r, off + vec2(17.3, 91.7)),
    grainField(um, cell.g, off + vec2(53.9, 11.3)),
    grainField(um, cell.b, off + vec2(29.1, 63.7)));
  float k = u_grainIndep;
  return mix(vec3(shared), n, k) * inversesqrt((1.0 - k) * (1.0 - k) + k * k);
}

// Granularity is quoted through a 48 µm aperture and falls with aperture size
// (Selwyn's law: σ·√area is constant). A pixel smaller than a clump cannot
// see below the clump, so the effective aperture is whichever is larger.
vec3 grainSigma(vec3 sigma48, vec3 cell) {
  return sigma48 * 48.0 / max(cell, vec3(u_pixUm));
}

/* ---------------- dirt ---------------- */

// Dust: at most one speck per cell, a cell being a few speck-widths across.
// Returns density added on the negative (x) and on the positive (y).
vec2 dust(vec2 mm) {
  if (u_dust <= 0.0) return vec2(0.0);
  float cs = u_dirtSize * 9.0;
  vec2 cell = floor(mm / cs);
  vec2 key = cell + u_frameSeed * 419.0;
  vec3 h = hash32(key);
  if (h.x > u_dust * 0.24) return vec2(0.0);
  vec2 c = (cell + 0.25 + 0.5 * hash22(key + 7.1)) * cs;
  float r = u_dirtSize * (0.3 + 1.4 * h.y * h.y);
  vec2 d = mm - c;
  float edge = r * (0.7 + 0.6 * vnoise(d / max(r, 1e-4) * 1.7 + h.z * 40.0));
  float a = 1.0 - smoothstep(edge * 0.6, edge, length(d));
  float dens = a * 2.6;
  return h.z < u_dirtNeg ? vec2(dens, 0.0) : vec2(0.0, dens);
}

// Lint and short hairs on the film: a gently curved stroke per larger cell.
vec2 fibre(vec2 mm) {
  if (u_fibres <= 0.0) return vec2(0.0);
  float cs = u_dirtSize * 40.0;
  vec2 cell = floor(mm / cs);
  vec2 key = cell + u_frameSeed * 263.0 + 11.0;
  vec3 h = hash32(key);
  if (h.x > u_fibres * 0.3) return vec2(0.0);
  vec2 c = (cell + 0.5) * cs;
  float ang = h.y * TAU;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  float len = cs * (0.35 + 0.5 * h.z);
  vec2 d = mm - c;
  float s = clamp(dot(d, dir) / len + 0.5, 0.0, 1.0);
  float curl = (hash12(key + 3.3) - 0.5) * 0.6;
  float off = dot(d, nrm) - curl * len * sin(PI * s) - curl * len * 0.4 * sin(TAU * s);
  float along = abs(dot(d, dir)) < len * 0.5 ? 1.0 : 0.0;
  float w = u_dirtSize * 0.09;
  float a = (1.0 - smoothstep(w * 0.5, w, abs(off))) * along;
  return hash12(key + 9.9) < u_dirtNeg ? vec2(a * 2.0, 0.0) : vec2(0.0, a * 2.0);
}

/* ---------------- scratches ---------------- */

// Removes dye layers from the emulsion surface down. A shallow scratch takes
// only the top layer and is coloured; a deep one takes all three and is clear.
vec3 removeLayers(vec3 D, vec3 base, vec3 order, float amount, float depth) {
  float layersGone = depth * 3.0 + 0.2;
  for (int i = 0; i < 3; i++) {
    float rem = clamp(layersGone - float(i), 0.0, 1.0) * amount;
    int ch = int(order[i] + 0.5);
    D[ch] = base[ch] + (D[ch] - base[ch]) * (1.0 - rem);
  }
  return D;
}

// Applies every running scratch that is on the given film (0 positive, 1
// negative/original). Emulsion scratches take dye away; base scratches scatter
// the light that crosses them and so read as added density.
vec3 scratches(vec3 D, vec3 base, vec3 order, float x, float onOriginal) {
  for (int i = 0; i < 6; i++) {
    vec4 sc = u_scratch[i];
    if (sc.z <= 0.0) continue;
    float type = floor(sc.w);
    float depth = fract(sc.w);
    float isNeg = type >= 2.0 ? 1.0 : 0.0;
    if (abs(isNeg - onOriginal) > 0.5) continue;
    float isBase = mod(type, 2.0);
    float d = abs(x - sc.x);
    if (isBase > 0.5) {
      // Out of the focal plane by the thickness of the base: soft and wide.
      float hw = sc.y * 2.2;
      D += vec3(0.45 * sc.z * exp(-(d * d) / (2.0 * hw * hw)));
    } else {
      float core = 1.0 - smoothstep(sc.y * 0.45, sc.y, d);
      D = removeLayers(D, base, order, core * sc.z, depth);
      // Displaced gelatin at the edges of the cut catches the light.
      float rim = exp(-pow((d - sc.y) / (sc.y * 0.35 + 1e-5), 2.0));
      D += vec3(0.18 * rim * sc.z);
    }
  }
  return D;
}

/* ---------------- shapes ---------------- */

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 mm = (v_uv - 0.5) * u_fSizeMm;
  float H = u_apMm.y;

  // Damage that changes slowly along the reel rather than frame to frame.
  vec2 drift = vec2(0.0, mod(u_frameN, 20000.0) * 0.0006 * H);
  vec2 stat = vec2(fract(u_seed * 0.0137) * 300.0, fract(u_seed * 0.0291) * 300.0);

  // Vinegar syndrome: the base has shrunk unevenly, so the film itself is
  // warped. Everything on it — image, grain, dirt — moves together.
  if (u_vinegar > 0.0) {
    vec2 q = mm / (H * 0.45) + stat + drift / H;
    mm += u_vinegar * 0.035 * H * (vec2(fbm(q), fbm(q + 19.7)) - 0.47);
  }
  vec2 um = mm * 1000.0;

  /* ---- exposure ---- */
  vec2 pa = mm - u_camWeave;
  vec2 euv = pa / u_eSizeMm + 0.5;
  vec3 e = texture(u_E, euv).rgb;
  e += texture(u_H, euv).rgb * u_halW;
  e += texture(u_V, euv).rgb * u_flare * u_flareTint;
  e += texture(u_S, euv).rgb * u_streak * u_streakTint;
  e *= u_expGain * exp2(u_expStops);

  // The camera gate's own edge, exposed onto the film around every frame.
  float gate = 1.0 - smoothstep(-0.012, 0.012, sdRoundRect(mm, u_apMm * 0.5, u_gateRadius));
  e *= gate;

  // Light that got in where it should not. It is exposure like any other, so
  // it goes through the curve — which is why a leak is orange: it crosses the
  // base first and reaches the red layer before anything else.
  vec3 warm = mix(vec3(1.0), vec3(1.0, 0.42, 0.1), u_leakWarmth);
  if (u_leak > 0.0) {
    vec2 at = vec2(cos(u_leakAngle) * u_apMm.x * 0.58, sin(u_leakAngle) * H * 0.58);
    vec2 dd = (mm - at) / vec2(u_apMm.x, H);
    float shape = exp(-dot(dd, dd) / (2.0 * 0.3 * 0.3));
    shape *= 0.65 + 0.7 * vnoise(mm / (H * 0.35) + u_frameSeed * 5.0);
    e += warm * u_leak * shape * 1.4;
  }
  float perfSide = exp(-max(mm.x + u_apMm.x * 0.5, 0.0) / (u_apMm.x * 0.14));
  if (u_rollFog > 0.0) {
    float f = 0.55 + 0.45 * fbm(mm / (H * 0.4) + u_frameSeed * 3.0);
    e += warm * u_rollFog * f * (0.5 + 0.8 * perfSide) * 1.1;
  }
  if (u_edgeFog > 0.0) {
    e += warm * u_edgeFog * perfSide * (0.8 + 0.4 * vnoise(vec2(mm.y / H * 6.0, u_frameSeed * 31.0))) * 0.7;
  }

  if (u_mono > 0.5) e = vec3(dot(e, u_monoW));

  /* ---- development ---- */
  vec3 x = log(max(e, vec3(1e-6))) / log(10.0) - LOG10_GREY;
  vec3 D;
  vec3 base;
  if (u_mode == 2) {
    // An ideal positive with a straight line and no ends: the transfer
    // reproduces the exposure exactly. What the curve controls take away.
    D = vec3(u_aim) - x;
    base = u_finalDmin;
  } else if (u_mode == 1) {
    D = clamp(u_dmax - response(x, u_gamma, u_xt, u_xs, u_toeSoft, u_shoulderSoft), u_dmin, u_dmax);
    base = u_dmin;
  } else {
    D = u_dmin + response(x, u_gamma, u_xt, u_xs, u_toeSoft, u_shoulderSoft);
    base = u_dmin;
  }

  // Interimage: each layer's development restrains its neighbours', which
  // pushes the three densities apart. Applied to net density about the mean.
  if (u_interimage != 1.0) {
    vec3 net = D - base;
    float m = (net.r + net.g + net.b) / 3.0;
    D = base + max(vec3(m) + (net - m) * u_interimage, 0.0);
  }

  // Grain in the original. Its power follows density — thin areas have few
  // grains to fluctuate — so it lives in the shadows of a negative and the
  // midtones of what is printed from it.
  vec2 off = u_frameSeed * vec2(911.0, 577.0);
  {
    vec3 cell = max(u_grainCell, vec3(u_pixUm));
    vec3 sig = grainSigma(u_grainSigma, u_grainCell);
    vec3 dn = max(D - base, vec3(0.03));
    D += sig * pow(dn, vec3(u_grainExp)) * grainNoise(um, cell, off);
  }

  // Dirt and scratches on the original. On a negative that is printed,
  // anything opaque holds back the printer light — so it prints white.
  vec2 dirt = dust(mm) + fibre(mm);
  bool negativePath = u_mode == 0;
  D += vec3(dirt.x);
  D = scratches(D, base, u_origLayers, mm.x, 1.0);

  /* ---- to a positive ---- */
  vec3 P;
  vec3 pBase = u_finalDmin;
  if (negativePath) {
    if (u_fadeNeg > 0.5) D = base + u_dye * (D - base) + u_stain;
    // Duplicate generations: interpositive and internegative, each a near
    // unity-contrast copy with grain of its own.
    for (int g = 0; g < 4; g++) {
      if (g >= u_generations) break;
      vec2 goff = off + vec2(float(g) * 71.3, float(g) * 13.9);
      float dsig = u_dupeSigma * 48.0 / max(5.0, u_pixUm);
      D = base + (D - base) * 1.04 + dsig * grainNoise(um, vec3(max(5.0, u_pixUm)), goff + 500.0);
    }
    if (u_process == 0) {
      vec3 xp = u_pMono > 0.5 ? u_pK - vec3(dot(D, vec3(0.15, 0.25, 0.6))) : u_pK - D;
      P = min(u_pDmin + response(xp, u_pGamma, u_pXt, u_pXs, u_pToeSoft, u_pShoulderSoft), u_pDmax);
      float pc = max(u_printCell, u_pixUm);
      float psig = u_printSigma * 48.0 / pc;
      vec3 pn = max(P - u_pDmin, vec3(0.03));
      P += psig * pow(pn, vec3(u_grainExp)) * grainNoise(um, vec3(pc), off + 300.0);
    } else if (u_process == 1) {
      P = vec3(u_aim) + (u_scanGrey - D) * u_scanRatio;
    } else {
      P = D;
      pBase = base;
    }
  } else {
    P = D;
    for (int g = 0; g < 4; g++) {
      if (g >= u_generations) break;
      vec2 goff = off + vec2(float(g) * 71.3, float(g) * 13.9);
      float dsig = u_dupeSigma * 48.0 / max(5.0, u_pixUm);
      P = pBase + (P - pBase) * 1.05 + dsig * grainNoise(um, vec3(max(5.0, u_pixUm)), goff + 500.0);
    }
  }

  // Dirt and scratches on the positive: opaque, so dark.
  P += vec3(dirt.y);
  P = scratches(P, pBase, u_layers, mm.x, 0.0);

  // Bleach bypass leaves the silver in alongside the dye: neutral density in
  // proportion to how much developed.
  if (u_bleach > 0.0) {
    vec3 net = max(P - pBase, 0.0);
    P += vec3(u_bleach * 0.55 * (net.r + net.g + net.b) / 3.0);
  }

  /* ---- splices and cue marks ---- */
  if (u_splice > 0.0) {
    float yN = mm.y / (H * 0.5);
    if (u_spliceKind < 0.5) {
      // Tape: its two edges cross the frame, and the frames under it are
      // hazy and scuffed.
      float edgeLine = exp(-pow((abs(yN) - 0.86) / 0.012, 2.0));
      P = mix(P, vec3(u_aim) + (P - u_aim) * 0.8, u_splice * 0.8);
      P += vec3(0.7 * edgeLine * u_splice + 0.12 * u_splice * fbm(mm / (H * 0.05) + u_frameSeed * 9.0));
    } else {
      float line = exp(-pow((yN - 0.965) / 0.014, 2.0));
      P += vec3(0.9 * line * u_splice + 0.07 * u_splice);
    }
    if (u_splice > 0.99) P = mix(P, pBase, 0.5 * u_spliceFlash);
  }
  if (u_cue > 0.0) {
    vec2 c = vec2(u_apMm.x * 0.37, H * 0.34);
    float r = H * 0.045;
    float d = length(mm - c) - r * (1.0 + 0.08 * (vnoise((mm - c) / r * 3.0) - 0.5));
    float disc = 1.0 - smoothstep(-r * 0.06, r * 0.06, d);
    float rim = exp(-pow(d / (r * 0.12), 2.0));
    P = mix(P, pBase, disc);
    P += vec3(1.2 * rim);
  }

  /* ---- the positive's age ---- */
  if (u_fadeNeg < 0.5) P = pBase + u_dye * (P - pBase) + u_stain;

  if (u_mould > 0.0) {
    vec2 q = mm / (H * 0.2) + stat + vec2(13.1, 7.3) + drift / (H * 0.2);
    float m = fbm(q) + 0.18 * (vnoise(mm / (H * 0.008)) - 0.5);
    float colony = smoothstep(0.86 - u_mould * 0.4, 0.9 - u_mould * 0.4, m);
    P = mix(P, pBase + (P - pBase) * vec3(0.3, 0.45, 0.6), colony);
    P += vec3(0.25 * exp(-pow((m - (0.88 - u_mould * 0.4)) / 0.012, 2.0)));
  }
  if (u_water > 0.0) {
    float w = fbm(mm / (H * 0.4) + stat + vec2(71.0, 3.0) + drift / (H * 0.4));
    float level = 0.6 - 0.18 * u_water;
    float ring = exp(-pow((w - level) / 0.005, 2.0));
    P += vec3(ring * 0.55 * u_water + smoothstep(level, level + 0.03, w) * 0.05 * u_water);
  }
  if (u_flaking > 0.0) {
    float f = fbm(mm / (H * 0.12) + stat + vec2(5.0, 41.0) + drift / (H * 0.12));
    float t = 0.9 - 0.33 * u_flaking;
    float hole = smoothstep(t, t + 0.015, f);
    P = mix(P, vec3(0.03), hole);
    P += vec3(0.6 * exp(-pow((f - t) / 0.008, 2.0)));
  }
  if (u_channelling > 0.0) {
    // Ridges run along the film, where the shrinking base pulls the
    // emulsion into channels.
    vec2 q = vec2(mm.x / (H * 0.05), mm.y / (H * 0.35)) + stat + drift / (H * 0.35);
    float c = abs(fbm(q) - 0.5);
    float ridge = 1.0 - smoothstep(0.0, 0.012 + 0.01 * u_channelling, c);
    P += vec3(ridge * 0.4 * u_channelling);
    P -= vec3(0.12 * u_channelling * exp(-pow((c - 0.02) / 0.006, 2.0)));
  }

  fragColor = vec4(max(P, vec3(0.0)), 1.0);
}
