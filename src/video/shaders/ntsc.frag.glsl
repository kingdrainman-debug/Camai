// Pass 0 — the tape engine.
//
// This is the half of the application that models the signal rather than the
// display: a picture encoded onto a composite carrier, recorded to videotape,
// read back and decoded again. It runs before the tube passes, which is the
// order the physics happened in.
//
// The important thing here is that almost nothing is drawn on. Dot crawl,
// rainbow cross-colour and comb-filter fringing are not effects — they are what
// you get when you genuinely modulate chroma onto a subcarrier, band-limit the
// result, and then try to separate it again. Encoding and decoding for real is
// not much more expensive on a GPU than faking it, and it behaves correctly in
// every case rather than only the ones that were anticipated.
//
// NTSC puts the colour subcarrier at 227.5 cycles per line. The half cycle is
// deliberate: it makes the carrier invert every line and every frame, which is
// what causes the dot pattern to creep rather than sit still.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_srcSize;
uniform float u_time;
uniform float u_frame;
uniform float u_seed;

// composite
uniform float u_compositeOn;
uniform float u_bandwidthScale;
uniform float u_demod;          // 0 box, 1 notch, 2 one-line comb, 3 two-line comb
uniform float u_phaseShift;     // 0/90/180/270 as 0..3
uniform float u_phaseShiftOffset;
uniform float u_preemphasis;
uniform float u_ringing;
uniform float u_ringingFreq;
uniform float u_ringingPower;
uniform float u_chromaLowpassIn;
uniform float u_chromaLowpassOut;
uniform float u_chromaDelayH;
uniform float u_chromaDelayV;
uniform float u_chromaPhaseError;
uniform float u_lumaSmear;

// tape
uniform float u_tapeOn;
uniform float u_tapeSpeed;      // 0 sp, 1 lp, 2 ep, 3 none
uniform float u_chromaLoss;
uniform float u_chromaVertBlend;
uniform float u_sharpen;
uniform float u_sharpenFreq;
uniform float u_edgeWave;
uniform float u_edgeWaveSpeed;
uniform float u_edgeWaveFreq;
uniform float u_edgeWaveDetail;

// noise
uniform float u_noiseOn;
uniform float u_compositeNoise;
uniform float u_compositeNoiseFreq;
uniform float u_compositeNoiseDetail;
uniform float u_lumaNoise;
uniform float u_lumaNoiseFreq;
uniform float u_lumaNoiseDetail;
uniform float u_chromaNoise;
uniform float u_chromaNoiseFreq;
uniform float u_chromaNoiseDetail;
uniform float u_chromaPhaseNoise;
uniform float u_snow;
uniform float u_snowAnisotropy;

// head switching
uniform float u_headOn;
uniform float u_headHeight;
uniform float u_headOffset;
uniform float u_headShift;
uniform float u_headMidLine;
uniform float u_headMidLinePos;
uniform float u_headMidLineJitter;
uniform float u_tracking;
uniform float u_trackingHeight;
uniform float u_trackingWave;
uniform float u_trackingSnow;

/* Cycles of colour subcarrier across one active line. The half cycle is what
   makes the pattern move; dropping it would freeze dot crawl in place. */
const float SUBCARRIER_CYCLES = 227.5;

/* ------------------------------------------------------------------ *
 * Bandwidths
 *
 * Tape speed is not a look, it is a pair of numbers: how much luma and how
 * much chroma bandwidth the format could store. Everything people recognise
 * about EP tapes follows from these being small.
 * ------------------------------------------------------------------ */

// Luma bandwidth in MHz for the current tape speed.
float lumaBandwidth() {
  if (u_tapeOn < 0.5 || u_tapeSpeed > 2.5) return 4.2;   // broadcast NTSC
  if (u_tapeSpeed < 0.5) return 3.0;                      // SP
  if (u_tapeSpeed < 1.5) return 2.6;                      // LP
  return 1.9;                                             // EP
}

float chromaBandwidth() {
  if (u_tapeOn < 0.5 || u_tapeSpeed > 2.5) return 0.6;
  if (u_tapeSpeed < 0.5) return 0.4;
  if (u_tapeSpeed < 1.5) return 0.3;
  return 0.19;
}

// Source pixels spanned by one cycle at a given bandwidth.
float cycleWidth(float mhz) {
  float cycles = max(mhz, 0.02) * 52.6;   // active line is ~52.6 us
  return max(u_srcSize.x / max(cycles * 2.0, 1.0), 0.5) / max(u_bandwidthScale, 0.03);
}

vec3 sampleSrc(vec2 uv) {
  return texture(u_src, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb;
}

/* ------------------------------------------------------------------ *
 * Subcarrier phase
 *
 * The phase at a pixel depends on where it is along the line, which line it is,
 * and which field of the four-field sequence the frame sits in. Getting this
 * right is the difference between dot crawl that creeps and a static grid.
 * ------------------------------------------------------------------ */

float carrierPhase(float x, float line) {
  float perLine = u_phaseShift < 0.5 ? 0.0
                : u_phaseShift < 1.5 ? 0.25
                : u_phaseShift < 2.5 ? 0.5
                : 0.75;
  float field = mod(u_frame + u_phaseShiftOffset, 4.0);
  return TAU * (x * SUBCARRIER_CYCLES + line * perLine + field * perLine);
}

/* ------------------------------------------------------------------ *
 * Noise
 * ------------------------------------------------------------------ */

// Band-limited value noise at a controllable frequency and octave count.
float signalNoise(vec2 p, float freq, float detail, float salt) {
  float scale = mix(2.0, 220.0, clamp(freq, 0.0, 1.0));
  float v = 0.0;
  float amp = 0.5;
  float total = 0.0;
  int octaves = int(clamp(detail, 1.0, 5.0));
  vec2 q = p * vec2(scale, scale * 0.35) + salt;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    v += amp * vnoise(q);
    total += amp;
    q *= 2.07;
    amp *= 0.5;
  }
  return (v / max(total, 1e-4)) - 0.5;
}

/* ------------------------------------------------------------------ *
 * Geometry of the tape: where does this output pixel read from?
 * ------------------------------------------------------------------ */

struct Scan {
  vec2 uv;
  float noise;    // extra noise for this line, from tracking
  float snow;     // extra snow for this line
};

Scan tapeScan(vec2 uv) {
  Scan sc;
  sc.uv = uv;
  sc.noise = 0.0;
  sc.snow = 0.0;

  float line = floor(uv.y * u_srcSize.y);
  float lines = u_srcSize.y;

  // Edge wave: the tape wanders against the head, so the whole line shifts.
  if (u_tapeOn > 0.5 && u_edgeWave > 0.001) {
    float w = 0.0;
    float amp = 1.0;
    float total = 0.0;
    int oct = int(clamp(u_edgeWaveDetail, 1.0, 5.0));
    float f = max(u_edgeWaveFreq, 0.0005);
    for (int i = 0; i < 5; i++) {
      if (i >= oct) break;
      w += amp * (vnoise(vec2(line * f * float(i + 1) * 3.0,
                              u_time * u_edgeWaveSpeed + u_seed)) - 0.5);
      total += amp;
      amp *= 0.5;
    }
    sc.uv.x += (w / max(total, 1e-4)) * u_edgeWave * 2.0 / u_srcSize.x;
  }

  if (u_headOn < 0.5) return sc;

  // Tracking noise: a band of damaged picture drifting up the screen.
  if (u_tracking > 0.001 && u_trackingHeight > 0.5) {
    float bandCentre = fract(-u_time * 0.22 + u_seed * 0.31);
    float half_ = (u_trackingHeight * 0.5) / lines;
    float d = abs(fract(uv.y - bandCentre + 0.5) - 0.5);
    float inBand = 1.0 - smoothstep(half_ * 0.6, half_, d);
    if (inBand > 0.0) {
      float g = inBand * u_tracking;
      sc.uv.x += (hash11(line * 3.7 + u_frame * 17.0 + u_seed) - 0.5)
               * g * u_trackingWave * 0.25;
      sc.noise = g;
      sc.snow = g * u_trackingSnow;
    }
  }

  // Head switching: the drum swaps heads near the bottom of the field and the
  // last few lines are thrown sideways with nothing to lock them.
  if (u_headHeight > 0.5) {
    float fromBottom = (1.0 - uv.y) * lines - u_headOffset;
    if (fromBottom >= 0.0 && fromBottom < u_headHeight) {
      float t = 1.0 - fromBottom / max(u_headHeight, 1e-4);
      float amount = pow(clamp(t, 0.0, 1.0), 1.7);

      // The real switch happens part way along a line, so the tear starts
      // mid-picture rather than at the left edge.
      float gate = 1.0;
      if (u_headMidLine > 0.5) {
        float jitter = (hash11(line * 1.3 + u_frame * 7.0 + u_seed) - 0.5)
                     * u_headMidLineJitter;
        gate = step(clamp(u_headMidLinePos + jitter, 0.0, 1.0), uv.x);
      }
      sc.uv.x += amount * gate * u_headShift / u_srcSize.x;
      sc.noise = max(sc.noise, amount * gate * 0.6);
    }
  }

  return sc;
}

/* ------------------------------------------------------------------ *
 * Encode, band-limit, decode
 * ------------------------------------------------------------------ */

// The composite sample at a point: luma plus chroma on the subcarrier.
float compositeAt(vec2 uv, float line, out float lumaOut) {
  vec3 yiq = rgb2yiq(sampleSrc(uv));
  lumaOut = yiq.x;
  float phase = carrierPhase(uv.x, line);
  return yiq.x + yiq.y * cos(phase) + yiq.z * sin(phase);
}

void main() {
  if (u_compositeOn < 0.5 && u_tapeOn < 0.5 && u_noiseOn < 0.5 && u_headOn < 0.5) {
    fragColor = vec4(sampleSrc(v_uv), 0.0);
    return;
  }

  Scan sc = tapeScan(v_uv);
  vec2 uv = sc.uv;
  float line = floor(uv.y * u_srcSize.y);
  float texelX = 1.0 / u_srcSize.x;
  float texelY = 1.0 / u_srcSize.y;

  if (u_compositeOn < 0.5) {
    // Tape geometry only — no encode/decode round trip.
    vec3 rgb = sampleSrc(uv);
    fragColor = vec4(rgb, sc.noise);
    return;
  }

  /* ---- chroma band-limiting before encoding ---- */
  float cW = cycleWidth(chromaBandwidth()) * mix(0.5, 2.0, u_chromaLowpassIn);
  vec2 cuv = uv - vec2(u_chromaDelayH * texelX, u_chromaDelayV * texelY);
  vec3 chroma = vec3(0.0);
  {
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float x = float(i) * max(cW * 0.4, 0.5);
      float w = gauss(x, max(cW * 0.5, 0.5));
      chroma += rgb2yiq(sampleSrc(cuv + vec2(x * texelX, 0.0))) * w;
      wsum += w;
    }
    chroma /= max(wsum, 1e-5);
  }

  // VHS averages chroma vertically between neighbouring lines.
  if (u_tapeOn > 0.5 && u_chromaVertBlend > 0.5) {
    vec3 above = rgb2yiq(sampleSrc(cuv - vec2(0.0, texelY)));
    chroma.yz = mix(chroma.yz, (chroma.yz + above.yz) * 0.5, 0.75);
  }

  // Chroma loss: whole lines lose colour before brightness goes.
  if (u_tapeOn > 0.5 && u_chromaLoss > 0.001) {
    float r = hash11(line * 5.17 + floor(u_time * 30.0) * 13.0 + u_seed);
    if (r < u_chromaLoss * 0.35) chroma.yz = vec2(0.0);
  }

  /* ---- modulate onto the subcarrier ---- */
  float phaseErr = u_chromaPhaseError * PI;
  if (u_noiseOn > 0.5 && u_chromaPhaseNoise > 0.001) {
    phaseErr += (hash11(line * 2.3 + u_frame * 31.0 + u_seed) - 0.5)
              * u_chromaPhaseNoise * PI;
  }

  float lumaCentre;
  float centre = compositeAt(uv, line, lumaCentre);

  /* ---- luma band-limiting, in the composite domain ---- */
  float yW = cycleWidth(lumaBandwidth());
  float composite = 0.0;
  {
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float x = float(i) * max(yW * 0.4, 0.5);
      float w = gauss(x, max(yW * 0.5, 0.5));
      float ignored;
      composite += compositeAt(uv + vec2(x * texelX, 0.0), line, ignored) * w;
      wsum += w;
    }
    composite /= max(wsum, 1e-5);
  }

  /* ---- preemphasis mismatch: the ringing every analogue edge had ---- */
  if (u_ringing > 0.001 || abs(u_preemphasis - 1.0) > 0.001) {
    float step_ = max(yW * mix(1.4, 0.4, u_ringingFreq), 0.8) * texelX;
    float acc = 0.0;
    for (int i = 1; i <= 3; i++) {
      float d = float(i) * step_;
      float ignored;
      acc += (compositeAt(uv - vec2(d, 0.0), line, ignored)
            + compositeAt(uv + vec2(d, 0.0), line, ignored)
            - 2.0 * centre) / float(i);
    }
    composite -= acc * u_ringing * 0.35 * (u_ringingPower * 0.18);
    composite += (centre - composite) * (u_preemphasis - 1.0) * 0.5;
  }

  /* ---- noise, added on the composite where real noise lived ---- */
  float lineNoise = sc.noise;
  if (u_noiseOn > 0.5) {
    float n = u_compositeNoise + lineNoise * 0.6;
    if (n > 0.0001) {
      composite += signalNoise(vec2(uv.x, line / u_srcSize.y),
                               u_compositeNoiseFreq, u_compositeNoiseDetail,
                               u_seed + u_frame * 0.37) * n * 0.6;
    }
    float snowAmount = u_snow + sc.snow;
    if (snowAmount > 0.0001) {
      // Sparse specks, smeared along the line by anisotropy.
      float sx = floor(uv.x * u_srcSize.x / mix(1.0, 14.0, u_snowAnisotropy));
      float h = hash12(vec2(sx, line) + u_frame * 9.71 + u_seed);
      if (h > 1.0 - snowAmount * 0.06) composite += (hash11(h * 31.0) * 1.4 - 0.2);
    }
  }

  /* ---- demodulate ----
     Each filter is a genuinely different way of separating chroma from luma,
     and each fails in its own characteristic way. That failure is the look. */
  float phase = carrierPhase(uv.x, line) + phaseErr;
  float y;
  vec2 iq;

  int mode = int(u_demod + 0.5);
  if (mode >= 2) {
    // Comb filters: the subcarrier inverts line to line, so averaging with a
    // neighbour cancels chroma and leaves luma. Clean, until the picture moves
    // vertically — then it fringes, which is exactly what real combs did.
    float ignoredA;
    float above = 0.0;
    float below = 0.0;
    {
      float tmp;
      above = compositeAt(uv - vec2(0.0, texelY), line - 1.0, tmp);
      if (mode >= 3) below = compositeAt(uv + vec2(0.0, texelY), line + 1.0, tmp);
      ignoredA = tmp;
    }
    float neighbour = mode >= 3 ? (above + below) * 0.5 : above;
    y = (composite + neighbour) * 0.5;
    float chromaSignal = composite - y;
    iq = vec2(chromaSignal * cos(phase), chromaSignal * sin(phase)) * 2.0;
  } else if (mode == 1) {
    // Notch: remove a narrow band around the subcarrier from luma.
    float notch = 0.0;
    float wsum = 0.0;
    for (int i = -2; i <= 2; i++) {
      float d = float(i) * (u_srcSize.x / SUBCARRIER_CYCLES) * 0.25 * texelX;
      float tmp;
      notch += compositeAt(uv + vec2(d, 0.0), line, tmp);
      wsum += 1.0;
    }
    y = notch / max(wsum, 1.0);
    float chromaSignal = composite - y;
    iq = vec2(chromaSignal * cos(phase), chromaSignal * sin(phase)) * 2.0;
  } else {
    // Box: a flat average over one subcarrier period. Cheapest, and the one
    // that leaves the most dot crawl and rainbow behind.
    float period = (u_srcSize.x / SUBCARRIER_CYCLES);
    float acc = 0.0;
    vec2 acci = vec2(0.0);
    float n = 0.0;
    for (int i = -3; i <= 3; i++) {
      float d = float(i) * period * 0.25 * texelX;
      float tmp;
      float c = compositeAt(uv + vec2(d, 0.0), line, tmp);
      float ph = carrierPhase(uv.x + d, line) + phaseErr;
      acc += c;
      acci += vec2(c * cos(ph), c * sin(ph));
      n += 1.0;
    }
    y = acc / max(n, 1.0);
    iq = acci / max(n, 1.0) * 2.0;
  }

  /* ---- chroma lowpass on the way out, to hide subcarrier residue ---- */
  iq *= mix(1.0, 0.55, u_chromaLowpassOut);

  /* ---- post-decode noise ---- */
  if (u_noiseOn > 0.5) {
    if (u_lumaNoise > 0.0001) {
      y += signalNoise(vec2(uv.x, line / u_srcSize.y), u_lumaNoiseFreq,
                       u_lumaNoiseDetail, u_seed + 11.0 + u_frame * 0.53)
         * u_lumaNoise * 0.35;
    }
    if (u_chromaNoise > 0.0001) {
      iq += vec2(
        signalNoise(vec2(uv.x, line / u_srcSize.y), u_chromaNoiseFreq,
                    u_chromaNoiseDetail, u_seed + 23.0 + u_frame * 0.29),
        signalNoise(vec2(uv.x, line / u_srcSize.y), u_chromaNoiseFreq,
                    u_chromaNoiseDetail, u_seed + 41.0 + u_frame * 0.31)) * u_chromaNoise * 0.5;
    }
  }

  /* ---- luma smear: the amplifier does not settle coming off a bright area ---- */
  if (u_lumaSmear > 0.001) {
    float trail = 0.0;
    float wsum = 0.0;
    for (int i = 1; i <= 4; i++) {
      float w = 1.0 / float(i);
      float tmp;
      trail += compositeAt(uv - vec2(float(i) * 2.0 * texelX, 0.0), line, tmp) * w;
      wsum += w;
    }
    y = mix(y, max(y, trail / max(wsum, 1e-4) * 0.9), u_lumaSmear * 0.55);
  }

  /* ---- the deck's output sharpener, putting back what the tape lost ---- */
  if (u_tapeOn > 0.5 && u_sharpen > 0.001) {
    float sW = max(cycleWidth(lumaBandwidth()) / max(u_sharpenFreq, 0.1), 0.8);
    float blurred = 0.0;
    float wsum = 0.0;
    for (int i = -3; i <= 3; i++) {
      float x = float(i) * sW * 0.6;
      float w = gauss(x, max(sW, 0.6));
      float tmp;
      blurred += compositeAt(uv + vec2(x * texelX, 0.0), line, tmp) * w;
      wsum += w;
    }
    y += (y - blurred / max(wsum, 1e-5)) * u_sharpen * 0.55;
  }

  vec3 rgb = yiq2rgb(vec3(y, iq));

  // The alpha channel carries how damaged this line is, which the tube pass and
  // the audio engine both read so a tear in the picture is heard as well as seen.
  fragColor = vec4(clamp(rgb, -0.2, 2.0), clamp(lineNoise, 0.0, 1.0));
}
