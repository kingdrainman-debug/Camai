// Final pass — the tube itself.
//
// Order matters here, and it follows the physics: the raster is scanned onto a
// curved faceplate, three guns land in slightly different places, a spot of
// finite size deposits energy into a line, a steel mask blocks most of it, the
// phosphor responds non-linearly, the glass scatters what escapes, and only
// then does a room with a lamp in it get to look at the result.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_screen;      // persisted signal
uniform sampler2D u_raw;         // untouched source, for the split preview
uniform sampler2D u_bloom;       // tight glow
uniform sampler2D u_halation;    // wide warm scatter
uniform sampler2D u_burn;        // slow running average

uniform vec2 u_outputSize;
uniform vec2 u_screenSize;
uniform float u_srcAspect;
uniform float u_time;
uniform float u_frame;
uniform float u_seed;
uniform float u_splitX;          // > 1.0 disables the split preview
uniform float u_damage;          // 0..1 picture-glitch level, from the signal pass

// geometry
uniform float u_geomOn;
uniform float u_curvatureX;
uniform float u_curvatureY;
uniform float u_cornerRadius;
uniform float u_overscan;
uniform float u_hSize;
uniform float u_vSize;
uniform float u_hPos;
uniform float u_vPos;
uniform float u_pincushion;
uniform float u_trapezoid;
uniform float u_rotation;
uniform float u_aspectMode;

// beam
uniform float u_beamOn;
uniform float u_scanMode;
uniform float u_lineCount;
uniform float u_scanlineDepth;
uniform float u_beamWidth;
uniform float u_beamBloom;
uniform float u_beamShape;
uniform float u_brightBoost;
uniform float u_beamNorm;    // integral of the beam profile over one line pitch
uniform float u_interlaceFlicker;
uniform float u_fieldBlend;

// phosphor
uniform float u_phosphorOn;
uniform float u_maskType;
uniform float u_maskPitch;
uniform float u_maskStrength;
uniform float u_maskBoost;
uniform float u_maskNorm;    // reciprocal of the mask's spatial mean
uniform float u_slotStagger;
uniform float u_gamut;

// colour
uniform float u_colourOn;
uniform float u_temperature;
uniform float u_tintGM;
uniform vec3 u_gunGain;
uniform vec3 u_gunLift;
uniform float u_hue;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_chromaCrush;
uniform float u_colourKiller;
uniform float u_chromaClip;

// upscaling
uniform float u_reconstruct;   // 0 nearest, 1 bilinear, 2 bicubic

// glow
uniform float u_glowOn;
uniform float u_bloomAmount;
uniform float u_halationAmount;
uniform float u_halationTint;
uniform float u_diffusion;
uniform float u_vignette;
uniform float u_glare;

// convergence
uniform float u_convOn;
uniform vec2 u_convRed;
uniform vec2 u_convBlue;
uniform float u_convRadial;
uniform float u_focus;
uniform float u_edgeFocus;

// tube response
uniform float u_tubeOn;
uniform float u_gamma;
uniform float u_blackCrush;
uniform float u_whiteClip;
uniform float u_humBar;
uniform float u_humPhase;
uniform float u_humBarWidth;
uniform float u_agcPump;
uniform float u_psuSag;
uniform float u_flicker;

// faults
uniform float u_faultsOn;
uniform float u_burnIn;
uniform float u_dirt;
uniform float u_moire;
uniform float u_degauss;         // decaying 0..1 envelope
uniform float u_powerOpen;       // 1 = fully scanned, 0 = collapsed to nothing
uniform float u_powerDot;        // lingering centre dot after switch-off

// output
uniform float u_bezel;
uniform float u_bezelShadow;
uniform float u_roomLight;
uniform float u_dither;
uniform float u_exposure;

// A/V link
uniform float u_audioLevel;      // 0..1 smoothed programme level
uniform float u_linkBrightness;
uniform float u_linkBloom;

/* ------------------------------------------------------------------ *
 * Source reconstruction
 *
 * This is where upscaling actually happens: the signal chain runs at the
 * source resolution and the tube is drawn at the output resolution, so every
 * read of u_screen is a resample. Bilinear is what the hardware gives for
 * free and it goes mushy on a large upscale; Catmull-Rom keeps edges crisp
 * with a touch of overshoot, which on a CRT reads as correct rather than as
 * sharpening. Nearest exists because a soft upscale of pixel art is simply
 * wrong.
 * ------------------------------------------------------------------ */

vec3 screenBilinear(vec2 uv) {
  return texture(u_screen, uv).rgb;
}

vec3 screenNearest(vec2 uv) {
  vec2 px = uv * u_screenSize;
  return texture(u_screen, (floor(px) + 0.5) / u_screenSize).rgb;
}

// Nine-tap Catmull-Rom built from bilinear fetches.
vec3 screenBicubic(vec2 uv) {
  vec2 texel = 1.0 / u_screenSize;
  vec2 px = uv * u_screenSize - 0.5;
  vec2 f = fract(px);
  vec2 base = floor(px);

  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = -0.5 * f3 + f2 - 0.5 * f;
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w2 = -1.5 * f3 + 2.0 * f2 + 0.5 * f;
  vec2 w3 = 0.5 * f3 - 0.5 * f2;

  // Fold each pair of taps into one bilinear fetch: four reads, not sixteen.
  // The taps sit at base-1, base, base+1 and base+2, so each pair's fetch goes
  // at that pair's weighted centroid — getting these offsets wrong shifts the
  // whole picture by a texel and changes its exposure.
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 o0 = (base - 1.0 + w1 / s0 + 0.5) * texel;
  vec2 o1 = (base + 1.0 + w3 / s1 + 0.5) * texel;

  vec3 a = texture(u_screen, vec2(o0.x, o0.y)).rgb;
  vec3 b = texture(u_screen, vec2(o1.x, o0.y)).rgb;
  vec3 c = texture(u_screen, vec2(o0.x, o1.y)).rgb;
  vec3 d = texture(u_screen, vec2(o1.x, o1.y)).rgb;

  // s0 + s1 == 1 for Catmull-Rom, so the pair weights are the blend factors.
  return max(mix(mix(a, b, s1.x), mix(c, d, s1.x), s1.y), vec3(0.0));
}

vec3 screenSample(vec2 uv) {
  if (u_reconstruct < 0.5) return screenNearest(uv);
  if (u_reconstruct < 1.5) return screenBilinear(uv);
  return screenBicubic(uv);
}

/* ------------------------------------------------------------------ *
 * Colour
 *
 * Grey-scale tracking first (the gun drives and cutoffs, which are physically
 * upstream of the faceplate), then the chroma behaviour of the decoder.
 * ------------------------------------------------------------------ */

/**
 * Per-gun multipliers for the two white-balance axes.
 *
 * Normalised so white stays at the same luminance: the controls change the
 * colour of white, not the exposure of the picture, which keeps them usable
 * without chasing Output ▸ Exposure after every nudge.
 */
vec3 whiteBalance(float temp, float gm) {
  vec3 w = vec3(
    1.0 - temp * 0.20 - gm * 0.05,
    1.0 + gm * 0.09,
    1.0 + temp * 0.26 - gm * 0.05);
  w = max(w, vec3(0.02));
  return w / max(luma(w), 1e-4);
}

vec3 gradeChroma(vec3 c) {
  vec3 yiq = rgb2yiq(c);
  float mag = length(yiq.yz);

  // Hue rotation acts after decoding, so unlike Tint the set cannot undo it.
  float a = radians(u_hue);
  yiq.yz = mat2(cos(a), -sin(a), sin(a), cos(a)) * yiq.yz;

  // Vibrance lifts weak colour and leaves saturated colour alone.
  float weak = 1.0 - clamp(mag * 2.4, 0.0, 1.0);
  yiq.yz *= u_saturation * (1.0 + u_vibrance * weak * 1.3);

  // Chroma crush: the floor where tape chroma noise lived. Squashing it is
  // what a noise reducer did, and it takes the colour speckle with it.
  if (u_chromaCrush > 0.0001) {
    float knee = u_chromaCrush * 0.14;
    yiq.yz *= smoothstep(0.0, max(knee, 1e-4), mag);
  }

  // Colour killer: below a burst threshold the decoder gives up entirely and
  // shows a monochrome picture rather than confetti.
  if (u_colourKiller > 0.0001) {
    float threshold = u_colourKiller * 0.3;
    yiq.yz *= smoothstep(threshold * 0.55, threshold, mag);
  }

  // Chroma overload: past the clip point colour stops getting more saturated
  // and the excess leaks into luma, which is the blazing red bloom you get out
  // of overdriven composite.
  float lim = max(u_chromaClip, 0.05);
  float newMag = length(yiq.yz);
  if (newMag > lim) {
    float excess = newMag - lim;
    yiq.yz *= lim / max(newMag, 1e-5);
    yiq.x += excess * 0.35;
  }

  return yiq2rgb(yiq);
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

vec2 warp(vec2 p) {
  if (u_geomOn < 0.5) return p;

  float a = radians(u_rotation);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;

  // Trapezoid: one end of the raster is wider than the other.
  p.x *= 1.0 + u_trapezoid * p.y;

  // Pincushion: the sides bow in or out at their midpoints.
  p.x *= 1.0 + u_pincushion * p.y * p.y;
  p.y *= 1.0 + u_pincushion * p.x * p.x;

  // Faceplate curvature. Straight lines bow outward because the phosphor is
  // further from the gun at the centre of each edge than at the corners.
  vec2 c = p;
  p.x *= 1.0 + u_curvatureX * c.y * c.y;
  p.y *= 1.0 + u_curvatureY * c.x * c.x;

  p /= vec2(max(u_hSize, 0.01), max(u_vSize, 0.01));
  p -= vec2(u_hPos, u_vPos) * 2.0;
  return p;
}

// Signed distance to a rounded rectangle; negative inside the visible raster.
float screenSdf(vec2 p) {
  float r = u_geomOn > 0.5 ? u_cornerRadius : 0.0;
  vec2 q = abs(p) - (1.0 - r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

/* ------------------------------------------------------------------ *
 * Phosphor mask
 * ------------------------------------------------------------------ */

vec3 stripeWeights(float phase, float softness) {
  // phase in 0..3, one unit per primary
  vec3 w;
  for (int i = 0; i < 3; i++) {
    float d = abs(phase - (float(i) + 0.5));
    d = min(d, 3.0 - d);
    w[i] = exp(-(d * d) / (2.0 * softness * softness));
  }
  return w / max(max(w.r, max(w.g, w.b)), 1e-4);
}

vec3 phosphorMask(vec2 px) {
  float pitch = max(u_maskPitch, 1.0);
  int type = int(u_maskType + 0.5);
  if (type == 0) return vec3(1.0);

  // Softness scales with pitch: a coarse mask has hard, visible stripes, a fine
  // one is barely resolved by the time it reaches the viewer.
  float soft = clamp(0.28 + 0.55 / pitch, 0.28, 0.75);

  if (type == 1) {
    // Aperture grille: uninterrupted vertical stripes, no vertical structure.
    return stripeWeights(fract(px.x / pitch) * 3.0, soft);
  }

  if (type == 2) {
    // Slot mask: stripes chopped into slots, alternate columns staggered.
    float col = floor(px.x / pitch);
    float rowPitch = pitch * 2.0;
    float stagger = mod(col, 2.0) * u_slotStagger * rowPitch * 0.5;
    float rowPhase = fract((px.y + stagger) / rowPitch);
    float slot = smoothstep(0.0, 0.16, rowPhase) * smoothstep(1.0, 0.84, rowPhase);
    vec3 w = stripeWeights(fract(px.x / pitch) * 3.0, soft);
    return mix(vec3(1.0), w, 1.0) * mix(0.62, 1.0, slot);
  }

  // Delta-gun dot triad on a hexagonal lattice: alternate rows offset by half
  // a triad. Softest of the three, and what most consumer sets actually used.
  float rowPitch = pitch * 1.732;
  float row = floor(px.y / rowPitch);
  float offset = mod(row, 2.0) * 0.5;
  float phase = fract(px.x / pitch + offset) * 3.0;
  float rowPhase = fract(px.y / rowPitch);
  float dot_ = smoothstep(0.0, 0.3, rowPhase) * smoothstep(1.0, 0.7, rowPhase);
  return stripeWeights(phase, soft * 1.15) * mix(0.7, 1.0, dot_);
}

/* ------------------------------------------------------------------ *
 * Beam sampling
 * ------------------------------------------------------------------ */

vec3 sampleGuns(vec2 uv, vec2 p, float blurPx) {
  vec2 texel = 1.0 / u_screenSize;

  vec2 rOff = vec2(0.0);
  vec2 bOff = vec2(0.0);
  if (u_convOn > 0.5) {
    // Convergence is adjusted at the centre of the screen, so the residual
    // error is smallest there and grows towards the corners.
    float radial = 1.0 + u_convRadial * dot(p, p);
    rOff = u_convRed * radial * texel;
    bOff = u_convBlue * radial * texel;
    rOff += p * u_convRadial * 0.6 * texel;
    bOff -= p * u_convRadial * 0.6 * texel;
  }

  // Three horizontal taps approximate the finite width of the spot. Only the
  // centre tap is reconstructed: the side taps model the spot's own blur, so
  // resampling them precisely would cost three times the fetches to no visible
  // end.
  float s = blurPx * texel.x;
  vec3 acc = vec3(0.0);
  const float W0 = 0.5, W1 = 0.25;

  acc.r = screenSample(uv + rOff).r * W0
        + texture(u_screen, uv + rOff + vec2(s, 0.0)).r * W1
        + texture(u_screen, uv + rOff - vec2(s, 0.0)).r * W1;
  acc.g = screenSample(uv).g * W0
        + texture(u_screen, uv + vec2(s, 0.0)).g * W1
        + texture(u_screen, uv - vec2(s, 0.0)).g * W1;
  acc.b = screenSample(uv + bOff).b * W0
        + texture(u_screen, uv + bOff + vec2(s, 0.0)).b * W1
        + texture(u_screen, uv + bOff - vec2(s, 0.0)).b * W1;
  return acc;
}

void main() {
  vec2 outUv = v_uv;

  // ---- screen-space coordinates, pillarboxed to the tube's aspect ----
  float tubeAspect = u_aspectMode < 0.5 ? (4.0 / 3.0)
                   : (u_aspectMode < 1.5 ? (16.0 / 9.0) : u_srcAspect);
  float outAspect = u_outputSize.x / max(u_outputSize.y, 1.0);
  vec2 p = outUv * 2.0 - 1.0;
  if (outAspect > tubeAspect) {
    p.x *= outAspect / tubeAspect;
  } else {
    p.y *= tubeAspect / outAspect;
  }

  vec3 bezelColor = vec3(0.055, 0.052, 0.049);
  vec2 warped = warp(p);

  // ---- power state: the raster opens and collapses vertically ----
  float open = clamp(u_powerOpen, 0.0, 1.0);
  if (open < 0.999) {
    if (open < 0.002) {
      float dotGlow = u_powerDot * exp(-dot(warped * vec2(1.0, 1.0), warped) * 900.0);
      fragColor = vec4(vec3(dotGlow) + bezelColor * u_bezel, 1.0);
      return;
    }
    warped.y /= max(open, 0.002);
  }

  // ---- degauss: a decaying radial ripple through the shadow mask ----
  float degaussHue = 0.0;
  if (u_faultsOn > 0.5 && u_degauss > 0.0001) {
    float d = length(warped);
    float wave = sin(d * 22.0 - u_time * 26.0) * exp(-d * 1.4);
    warped += normalize(warped + 1e-5) * wave * u_degauss * 0.035;
    degaussHue = wave * u_degauss;
  }

  float sdf = screenSdf(warped);
  vec2 uv = warped * 0.5 + 0.5;

  // Overscan: the raster is scanned larger than the visible glass, so the
  // outermost few percent of the picture was never seen by anyone.
  float os = u_geomOn > 0.5 ? u_overscan : 0.0;
  uv = (uv - 0.5) * (1.0 - os * 2.0) + 0.5;

  if (sdf > 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    // Outside the tube: bezel, with the glass edge shading into it.
    float shade = 1.0 - u_bezelShadow * exp(-max(sdf, 0.0) * 26.0);
    vec3 c = bezelColor * shade * u_bezel;
    fragColor = vec4(c, 1.0);
    return;
  }

  // ---- split preview ----
  if (outUv.x < u_splitX) {
    vec3 raw = texture(u_raw, uv).rgb;
    float edge = smoothstep(u_splitX - 0.0012, u_splitX, outUv.x);
    fragColor = vec4(mix(raw, vec3(0.85, 0.9, 0.55), edge), 1.0);
    return;
  }

  // The wide halation blur doubles as a cheap local average picture level.
  vec3 halation = texture(u_halation, uv).rgb;
  vec3 bloomTex = texture(u_bloom, uv).rgb;
  float localLevel = clamp(luma(halation) * 1.6, 0.0, 1.0);

  // ---- beam reconstruction ----
  float blurPx = 0.0;
  if (u_convOn > 0.5) {
    blurPx = (u_focus + u_edgeFocus * dot(p, p) * 0.9) * 2.4;
  }

  vec3 color;
  if (u_beamOn > 0.5 && u_scanMode < 1.5) {
    bool interlaced = u_scanMode > 0.5;
    float parity = interlaced ? mod(u_frame, 2.0) : 0.0;
    float lines = interlaced ? max(u_lineCount * 0.5, 1.0) : max(u_lineCount, 1.0);
    float shift = interlaced ? parity * 0.5 : 0.0;

    float ly = uv.y * lines - shift;
    float base = floor(ly - 0.5);

    // Bright audio drags the high-tension rail down, which widens the spot.
    float sagBloom = u_linkBloom * u_audioLevel;

    // Four neighbouring lines. Two is enough for a tight spot, but a wide or
    // heavily blooming one deposits energy further than that, and truncating it
    // would darken bright areas exactly where they should be swelling.
    vec3 sum = vec3(0.0);
    vec3 flat_ = vec3(0.0);
    for (int i = -1; i <= 2; i++) {
      float n = base + float(i);
      float centre = (n + 0.5 + shift) / lines;
      vec3 c = sampleGuns(vec2(uv.x, clamp(centre, 0.0, 1.0)), p, blurPx);
      float l = luma(c);
      // Blooming: the brighter the line, the fatter it physically is. This is
      // the detail that separates a real CRT from a scanline overlay.
      float halfWidth = max(u_beamWidth, 0.05) * 0.5
                      * (1.0 + (u_beamBloom + sagBloom) * l * 1.25);
      float d = abs(ly - (n + 0.5)) / max(halfWidth, 0.02);
      // No broadening factor here: the profile has to fall to near zero between
      // line centres, or the contributions of adjacent lines sum to a constant
      // and the scanlines cancel themselves out entirely.
      float w = exp(-pow(d, max(u_beamShape, 0.5)));
      sum += c * w;
      // The two nearest lines are the un-scanlined reference.
      if (i == 0 || i == 1) flat_ += c * 0.5;
    }
    // Normalising by the profile's own integral means changing the beam
    // width alters the texture of the picture without altering its exposure.
    color = mix(flat_, sum / max(u_beamNorm, 0.05), clamp(u_scanlineDepth, 0.0, 1.0)) * u_brightBoost;

    if (interlaced && u_interlaceFlicker > 0.0) {
      float shimmer = (parity * 2.0 - 1.0) * u_interlaceFlicker * 0.06;
      color *= 1.0 + shimmer;
      color = mix(color, flat_ * u_brightBoost, u_fieldBlend * 0.5);
    }
  } else {
    color = sampleGuns(uv, p, blurPx);
  }

  // ---- grey-scale tracking ----
  // The gun drives and cutoffs sit between the video amplifier and the screen,
  // so they act on the reconstructed beam and before the mask blocks any of it.
  if (u_colourOn > 0.5) {
    color = color * whiteBalance(u_temperature, u_tintGM) * u_gunGain + u_gunLift;
    color = max(color, vec3(0.0));
  }

  // ---- phosphor mask ----
  if (u_phosphorOn > 0.5 && u_maskStrength > 0.001) {
    // Likewise normalised: the mask blocks most of the light, and the set
    // compensated with more beam current rather than getting darker.
    vec3 mask = phosphorMask(gl_FragCoord.xy) * u_maskNorm;
    color *= mix(vec3(1.0), mask, u_maskStrength) * u_maskBoost;
  }

  // ---- P22 gamut ----
  if (u_phosphorOn > 0.5 && u_gamut > 0.001) {
    // Real phosphor primaries are not sRGB primaries: the green is yellowish
    // and impure, the red sits closer to orange, the blue skews violet.
    mat3 p22 = mat3(
      0.93, 0.055, 0.015,
      0.045, 0.90, 0.055,
      0.02, 0.075, 0.905);
    color = mix(color, p22 * color, u_gamut);
  }

  // ---- chroma behaviour of the decoder ----
  if (u_colourOn > 0.5) {
    color = gradeChroma(color);
  }

  // ---- tube transfer function ----
  if (u_tubeOn > 0.5) {
    color = safePow(max(color, vec3(0.0)), u_gamma / 2.2);

    // Below cut-off the gun simply stops conducting.
    float crush = u_blackCrush * 0.06;
    color = max(color - crush, vec3(0.0)) / max(1.0 - crush, 1e-3);

    // Highlights stop getting brighter and start getting wider instead; the
    // widening already happened in the beam stage, so here they just clip.
    float clipLevel = max(u_whiteClip, 0.05);
    color = min(color, vec3(clipLevel)) + max(color - clipLevel, vec3(0.0)) * 0.15;
  }

  // ---- glass: bloom, halation, diffusion ----
  if (u_glowOn > 0.5) {
    color += bloomTex * u_bloomAmount;
    // Red scatters furthest through the faceplate, so the wide haze is warm.
    vec3 warm = vec3(1.0, 0.72, 0.48);
    vec3 tint = mix(vec3(1.0), warm, u_halationTint);
    color += halation * tint * u_halationAmount * 0.8;
    color += vec3(localLevel) * u_diffusion * 0.14;
  }

  // ---- rail and gain behaviour ----
  if (u_tubeOn > 0.5) {
    // Hum bar: mains ripple riding on the video rail, drifting because mains
    // frequency and frame rate are never exactly locked.
    if (u_humBar > 0.001) {
      float d = abs(fract(uv.y + u_humPhase) - 0.5);
      float bar = exp(-(d * d) / (2.0 * max(u_humBarWidth, 0.02) * max(u_humBarWidth, 0.02) * 0.25));
      color *= 1.0 + u_humBar * 0.28 * bar;
      color += u_humBar * 0.03 * bar;
    }

    // AGC chasing the picture level, always a beat behind.
    float agc = 1.0 - u_agcPump * 0.35 * (localLevel - 0.35);
    color *= clamp(agc, 0.4, 1.6);

    // The rail sags under load — both picture load and audio load.
    float sag = u_psuSag * (localLevel * 0.7 + u_linkBrightness * u_audioLevel);
    color *= 1.0 - clamp(sag, 0.0, 0.9) * 0.22;

    if (u_flicker > 0.001) {
      float f = vnoise(vec2(u_time * 9.0 + u_seed, 0.0)) - 0.5;
      color *= 1.0 + f * u_flicker * 0.14;
    }
  }

  if (degaussHue != 0.0) {
    // The mask is momentarily magnetised and the guns land on the wrong dots.
    vec3 yiq = rgb2yiq(color);
    float a = degaussHue * 2.2;
    yiq.yz = mat2(cos(a), -sin(a), sin(a), cos(a)) * yiq.yz * (1.0 + abs(degaussHue) * 0.8);
    color = yiq2rgb(yiq);
    color *= 1.0 + abs(degaussHue) * 0.25;
  }

  // ---- wear ----
  if (u_faultsOn > 0.5) {
    if (u_burnIn > 0.001) {
      float retained = luma(texture(u_burn, uv).rgb);
      color *= 1.0 - u_burnIn * 0.55 * clamp(retained, 0.0, 1.0);
    }
    if (u_dirt > 0.001) {
      // Static charge on the faceplate pulls dust in, worst at the edges where
      // nobody's sleeve ever reached.
      float smear = fbm(uv * vec2(6.0, 4.0) + u_seed);
      float specks = smoothstep(0.86, 1.0, vnoise(uv * 90.0 + u_seed * 3.0));
      float edgeBias = 0.35 + 0.65 * dot(p, p);
      color *= 1.0 - u_dirt * (smear * 0.22 + specks * 0.5) * edgeBias;
      color += u_dirt * specks * 0.02;
    }
    if (u_moire > 0.001) {
      float beat = sin(uv.y * u_lineCount * PI) * sin(gl_FragCoord.x / max(u_maskPitch, 1.0) * PI);
      float detail = clamp(abs(luma(bloomTex)) * 3.0, 0.0, 1.0);
      color *= 1.0 + u_moire * 0.12 * beat * detail;
    }
  }

  // ---- the room ----
  if (u_glowOn > 0.5 && u_vignette > 0.001) {
    float r = dot(p, p);
    color *= 1.0 - u_vignette * 0.45 * r * r;
  }
  if (u_glare > 0.001) {
    // A window somewhere behind the viewer, reflected in the glass.
    vec2 g = p - vec2(-0.45, 0.5);
    float sheet = exp(-dot(g * vec2(1.1, 2.4), g * vec2(1.1, 2.4)) * 1.6);
    color += u_glare * sheet * 0.09;
  }
  color += u_roomLight;

  // Glass edge shading just inside the bezel.
  color *= 1.0 - u_bezelShadow * 0.9 * smoothstep(-0.12, 0.0, sdf);

  color *= u_exposure;

  // ---- dither ----
  if (u_dither > 0.001) {
    float n = ign(gl_FragCoord.xy + vec2(mod(u_frame, 64.0) * 5.588, 0.0)) - 0.5;
    color += n * u_dither * (1.5 / 255.0);
  }

  fragColor = vec4(max(color, vec3(0.0)), 1.0);
}
