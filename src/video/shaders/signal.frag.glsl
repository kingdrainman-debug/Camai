// Pass 1 — everything that happens between the transmitter and the video
// amplifier: timebase faults, band-limiting, chroma/luma crosstalk, multipath,
// noise, and the front-panel picture controls.
//
// Runs in signal space (roughly gamma-encoded 0..1). The tube pass applies the
// real electro-optical transfer function later.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_srcSize;
uniform float u_time;
uniform float u_frame;
uniform float u_seed;

// picture
uniform float u_brightness;
uniform float u_contrast;
uniform float u_color;
uniform float u_tint;
uniform float u_sharpness;

// signal
uniform float u_signalOn;
uniform float u_path;          // 0 rf, 1 composite, 2 svideo, 3 component
uniform float u_lumaBw;        // MHz
uniform float u_chromaBw;      // MHz
uniform float u_chromaDelay;   // px
uniform float u_dotCrawl;
uniform float u_crossColor;
uniform float u_ringing;
uniform float u_ringingFreq;
uniform float u_ghosting;
uniform float u_ghostDelay;
uniform float u_snow;
uniform float u_snowSize;
uniform float u_signalLoss;
uniform float u_interference;
uniform float u_interferenceFreq;
uniform float u_interferenceDrift;

// sync
uniform float u_syncOn;
uniform float u_hJitter;
uniform float u_jitterCorrelation;
uniform float u_tearing;
uniform float u_flagging;
uniform float u_headSwitch;
uniform float u_headSwitchHeight;
uniform float u_vRoll;
uniform float u_vHold;
uniform float u_timebaseWobble;

// glitch — discrete failures rather than continuous wear
uniform float u_glitchOn;
uniform float u_glitchRate;
uniform float u_dropout;
uniform float u_dropoutLength;
uniform float u_lineRepeat;
uniform float u_syncSlip;
uniform float u_chromaBurst;
uniform float u_blockCorrupt;
uniform float u_blockSize;
uniform float u_blockColour;
uniform float u_posterize;
uniform float u_invert;

/* Active-line length in microseconds; used to turn a bandwidth in MHz into a
   filter width in pixels. NTSC gives ~52.6 us of picture per 63.5 us line. */
const float ACTIVE_LINE_US = 52.6;

// How many source pixels one cycle of a given bandwidth spans.
float bandwidthToPixels(float mhz) {
  float cycles = max(mhz, 0.02) * ACTIVE_LINE_US;   // cycles across the line
  return max(u_srcSize.x / max(cycles * 2.0, 1.0), 0.5);
}

vec3 sampleSrc(vec2 uv) {
  return texture(u_src, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb;
}

/* ------------------------------------------------------------------ *
 * Timebase: where does this output line actually read from?
 * ------------------------------------------------------------------ */

struct Timebase {
  vec2 uv;
  float damage;   // 0..1, how badly this line is broken (drives the A/V link)
};

Timebase timebase(vec2 uv) {
  Timebase tb;
  tb.uv = uv;
  tb.damage = 0.0;
  if (u_syncOn < 0.5) return tb;

  // Vertical roll first: it decides which source line we are on.
  float roll = u_vRoll * u_time;
  if (u_vHold > 0.0) {
    // Bursts of lost lock rather than a constant drift.
    float burst = vnoise(vec2(u_time * 0.7 + u_seed, 0.0));
    float gate = smoothstep(1.0 - u_vHold * 0.85, 1.0, burst);
    roll += gate * u_time * 6.0 * u_vHold;
  }
  tb.uv.y = fract(tb.uv.y + roll);

  float line = floor(tb.uv.y * u_srcSize.y);
  float lineSeed = line + u_frame * 131.0 + u_seed * 977.0;

  // Per-line horizontal error. Uncorrelated noise reads as a ragged edge;
  // correlated noise reads as a slow wobble. Real sets sit in between.
  float white = hash11(lineSeed) - 0.5;
  float smooth_ = vnoise(vec2(line * 0.06, u_time * 2.3 + u_seed)) - 0.5;
  float jitter = mix(white, smooth_ * 1.6, u_jitterCorrelation) * u_hJitter;

  // Flagging: the timebase has not settled after the vertical interval, so the
  // first lines of the frame bend away to one side.
  float topDist = 1.0 - tb.uv.y;
  jitter += u_flagging * 26.0 * exp(-topDist * 34.0) * (1.0 + 0.3 * smooth_);

  // Rare violent displacement of a single line.
  if (u_tearing > 0.0) {
    float r = hash11(lineSeed * 1.7);
    float hit = step(1.0 - u_tearing * 0.06, r);
    jitter += hit * (hash11(lineSeed * 3.1) - 0.5) * u_srcSize.x * 0.35;
    tb.damage = max(tb.damage, hit);
  }

  // Slow breathing of the whole raster width.
  float wobble = sin(u_time * 1.7 + u_seed) * 0.5 + sin(u_time * 0.41) * 0.5;
  float scale = 1.0 + u_timebaseWobble * 0.012 * wobble;
  tb.uv.x = (tb.uv.x - 0.5) / scale + 0.5;

  // Head-switch band along the bottom: the drum swaps heads mid-picture.
  if (u_headSwitch > 0.0 && tb.uv.y < u_headSwitchHeight) {
    float t = 1.0 - tb.uv.y / max(u_headSwitchHeight, 1e-4);
    float skew = pow(t, 1.6) * u_headSwitch * 0.16;
    jitter += skew * u_srcSize.x;
    tb.damage = max(tb.damage, u_headSwitch * t);
  }

  tb.uv.x += jitter / u_srcSize.x;
  return tb;
}

/* ------------------------------------------------------------------ *
 * Glitching
 *
 * Everything here is gated on u_glitchRate, so the whole section goes quiet at
 * zero however high the individual amounts are. The gates are steps against a
 * hash rather than smooth noise: a glitch that fades in is not a glitch.
 *
 * The event clock is quantised time, so an event holds for a whole number of
 * ticks instead of flickering per frame — a one-frame tear reads as a compression
 * artefact, while three or four frames reads as the tape failing.
 * ------------------------------------------------------------------ */

// Events per second, from rare punctuation to near-continuous breakup.
float eventClock() {
  return floor(u_time * mix(1.5, 16.0, clamp(u_glitchRate, 0.0, 1.0)));
}

/**
 * A horizontal band of the frame, present for `density` of the ticks.
 *
 * Returns 0 outside the band and ramps to 1 at its centre, so the edges of a
 * tear are soft by a line or two the way a real timebase recovery is.
 */
float bandGate(float y, float salt, float density, float height) {
  if (density <= 0.0001) return 0.0;
  float era = eventClock() + u_seed * 71.0 + salt;
  if (hash11(era) > density) return 0.0;
  float centre = hash11(era * 1.37 + 0.5);
  return 1.0 - smoothstep(height * 0.4, height, abs(y - centre));
}

/**
 * Tape dropout: the head loses contact and the line reads as full white or
 * full black for a short run. Decided per line, so the streaks are ragged.
 */
float dropoutAt(vec2 uv, out float polarity) {
  polarity = 1.0;
  if (u_dropout <= 0.0001) return 0.0;
  float line = floor(uv.y * u_srcSize.y);
  float id = line * 7.13 + eventClock() * 313.0 + u_seed * 97.0;
  if (hash11(id) > u_dropout * clamp(u_glitchRate, 0.0, 1.0) * 0.5) return 0.0;
  float start = hash11(id * 2.17);
  float len = max(u_dropoutLength * hash11(id * 3.31), 0.004);
  // Most dropouts are a bright scratch; a minority drop to black instead.
  polarity = hash11(id * 5.71) > 0.28 ? 1.0 : -1.0;
  float edge = len * 0.18;
  return smoothstep(start - edge, start + edge, uv.x)
       * (1.0 - smoothstep(start + len - edge, start + len + edge, uv.x));
}



/* ------------------------------------------------------------------ *
 * Band-limiting
 * ------------------------------------------------------------------ */

// Horizontal Gaussian of a given pixel width, 9 taps.
vec3 lowpassH(vec2 uv, float widthPx) {
  if (widthPx <= 0.6) return sampleSrc(uv);
  float sigma = widthPx * 0.5;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float x = float(i) * max(widthPx * 0.45, 0.5);
    float w = gauss(x, sigma);
    sum += sampleSrc(uv + vec2(x / u_srcSize.x, 0.0)) * w;
    wsum += w;
  }
  return sum / max(wsum, 1e-5);
}

void main() {
  Timebase tb = timebase(v_uv);
  vec2 uv = tb.uv;

  /* ---- glitch, coordinate domain ----
     These have to happen before anything is sampled, because they change where
     the picture is read from rather than what it looks like afterwards. */
  float blockErr = 0.0;
  float chromaSlide = 0.0;
  float posterizeBand = 0.0;
  float invertBand = 0.0;
  if (u_glitchOn > 0.5 && u_glitchRate > 0.0001) {
    // Sync slip: horizontal sync is briefly lost and a band tears sideways.
    float slip = bandGate(uv.y, 3.0, u_syncSlip * u_glitchRate, 0.05);
    if (slip > 0.0) {
      uv.x += slip * (hash11(eventClock() * 2.9 + u_seed) - 0.5) * 0.45;
      tb.damage = max(tb.damage, slip);
    }

    // Line repeat: the timebase corrector loses lines and holds the last good
    // one, which smears it down the band in steps.
    float rep = bandGate(uv.y, 17.0, u_lineRepeat * u_glitchRate, 0.07);
    if (rep > 0.5) {
      const float hold = 18.0;
      uv.y = floor(uv.y * u_srcSize.y / hold) * hold / u_srcSize.y;
      tb.damage = max(tb.damage, rep);
    }

    // Block corruption: macroblocks fetch from the wrong address. Digital, and
    // deliberately so — it is the sound of a transfer failing, not a tape.
    if (u_blockCorrupt > 0.0001) {
      float bs = max(u_blockSize, 2.0);
      vec2 blk = floor(uv * u_srcSize / bs);
      float id = blk.x * 31.7 + blk.y * 17.3 + eventClock() * 7.0 + u_seed * 13.0;
      if (hash11(id) < u_blockCorrupt * u_glitchRate * 0.4) {
        uv += (hash22(vec2(id, id * 1.7)) - 0.5) * bs * 6.0 / u_srcSize;
        blockErr = 1.0;
        tb.damage = max(tb.damage, 0.8);
      }
    }

    chromaSlide = bandGate(uv.y, 29.0, u_chromaBurst * u_glitchRate, 0.06);
    posterizeBand = bandGate(uv.y, 41.0, u_posterize * u_glitchRate, 0.09);
    invertBand = bandGate(uv.y, 53.0, u_invert * u_glitchRate, 0.05);
  }

  float pxPerCycleY = bandwidthToPixels(u_lumaBw);
  float pxPerCycleC = bandwidthToPixels(u_chromaBw);

  bool composite = u_signalOn > 0.5 && u_path < 1.5;   // rf or composite
  bool analogue  = u_signalOn > 0.5 && u_path < 2.5;   // + s-video
  float rf = u_signalOn > 0.5 && u_path < 0.5 ? 1.0 : 0.0;

  vec3 sharp = sampleSrc(uv);
  vec3 yiq;

  if (u_signalOn > 0.5 && u_path < 3.0) {
    // Luma and chroma are filtered separately and by very different amounts —
    // this asymmetry is the single most recognisable analogue-video signature.
    vec3 lumaSrc = lowpassH(uv, pxPerCycleY);
    // A chroma burst slides colour off luma by far more than the normal delay.
    vec2 cuv = uv - vec2((u_chromaDelay + chromaSlide * 90.0) / u_srcSize.x, 0.0);
    vec3 chromaSrc = lowpassH(cuv, pxPerCycleC);

    yiq = vec3(rgb2yiq(lumaSrc).x, rgb2yiq(chromaSrc).yz);

    // Peaking filter. The overshoot is what "sharpness" on the front panel
    // really produced: a bright fringe next to every hard edge.
    if (u_sharpness > 0.0 || u_ringing > 0.0) {
      float amount = (u_sharpness - 1.0) * 0.6 + u_ringing * 1.4;
      float step_ = max(pxPerCycleY * 0.6, 1.0) / u_srcSize.x;
      float acc = 0.0;
      for (int i = 1; i <= 3; i++) {
        float d = float(i) * step_;
        float w = cos(float(i) * u_ringingFreq * 0.9) / float(i);
        acc += w * (rgb2yiq(sampleSrc(uv - vec2(d, 0.0))).x
                  + rgb2yiq(sampleSrc(uv + vec2(d, 0.0))).x
                  - 2.0 * yiq.x);
      }
      yiq.x -= amount * acc * 0.5;
    }

    if (composite) {
      // Luma and chroma share one wire, so each leaks into the other.
      // The subcarrier is locked to the line rate and inverts every frame,
      // which is why dot crawl visibly creeps.
      float carrier = uv.x * u_srcSize.x * 0.5 * PI
                    + floor(uv.y * u_srcSize.y) * PI
                    + u_frame * PI;
      float chromaMag = length(yiq.yz);

      // Chroma read as luma: the crawling dot ladder on colour edges.
      float edge = abs(rgb2yiq(sampleSrc(uv + vec2(2.0 / u_srcSize.x, 0.0))).y - yiq.y)
                 + abs(rgb2yiq(sampleSrc(uv + vec2(2.0 / u_srcSize.x, 0.0))).z - yiq.z);
      yiq.x += u_dotCrawl * chromaMag * 0.55 * cos(carrier) * (0.35 + edge * 3.0);

      // Luma read as chroma: fine detail bursts into rainbows.
      float detail = yiq.x - rgb2yiq(lowpassH(uv, pxPerCycleY * 3.0)).x;
      yiq.y += u_crossColor * detail * 1.7 * cos(carrier);
      yiq.z += u_crossColor * detail * 1.7 * sin(carrier);
    }

    // Multipath. The signal also arrives via a reflection off something large.
    if (u_ghosting > 0.0) {
      vec2 guv = uv - vec2(u_ghostDelay / u_srcSize.x, 0.0);
      vec3 g1 = rgb2yiq(lowpassH(guv, pxPerCycleY * 1.8));
      vec3 g2 = rgb2yiq(lowpassH(guv - vec2(u_ghostDelay * 1.9 / u_srcSize.x, 0.0), pxPerCycleY * 2.6));
      yiq.x += u_ghosting * (g1.x * 0.42 + g2.x * 0.16);
      yiq.yz += u_ghosting * g1.yz * 0.2;
    }
  } else {
    yiq = rgb2yiq(sharp);
  }

  // Picture controls, applied in the space the set applied them in.
  yiq.x = (yiq.x - 0.5) * u_contrast + 0.5 + u_brightness;
  float t = radians(u_tint);
  float cs = cos(t), sn = sin(t);
  yiq.yz = mat2(cs, -sn, sn, cs) * yiq.yz * u_color;

  // A beating carrier from an adjacent channel: diagonal herringbone bars.
  if (u_interference > 0.0 && analogue) {
    float drift = u_time * u_interferenceDrift * 3.0;
    float bars = sin((uv.x * u_interferenceFreq + uv.y * u_interferenceFreq * 0.27 + drift) * TAU);
    float envelope = 0.5 + 0.5 * sin(uv.y * 3.1 - u_time * 0.7);
    yiq.x += u_interference * 0.06 * bars * (0.4 + envelope);
    yiq.yz += u_interference * 0.02 * bars;
  }

  vec3 rgb = yiq2rgb(yiq);

  /* ---- glitch, colour domain ---- */
  if (u_glitchOn > 0.5 && u_glitchRate > 0.0001) {
    // A corrupted block takes the wrong chroma as well as the wrong address.
    // Without this the breakup reads as a smear; with it, it reads as digital.
    if (blockErr > 0.5 && u_blockColour > 0.0001) {
      float bs = max(u_blockSize, 2.0);
      vec2 blk = floor(uv * u_srcSize / bs);
      float id = blk.x * 13.1 + blk.y * 7.7 + eventClock() * 3.0 + u_seed * 5.0;
      vec3 c = rgb2yiq(rgb);
      float a = (hash11(id) - 0.5) * TAU;
      c.yz = mat2(cos(a), -sin(a), sin(a), cos(a)) * c.yz * (1.0 + u_blockColour);
      rgb = mix(rgb, yiq2rgb(c), u_blockColour);
    }

    // Bit crush: luma collapses to a handful of levels inside the band.
    if (posterizeBand > 0.0) {
      float levels = mix(26.0, 3.0, u_posterize);
      vec3 crushed = floor(rgb * levels + 0.5) / levels;
      rgb = mix(rgb, crushed, posterizeBand);
    }

    // Polarity flip.
    if (invertBand > 0.0) {
      rgb = mix(rgb, vec3(1.0) - rgb, invertBand * u_invert);
    }

    // Tape dropout rides over everything else: it is an absence of signal, not
    // a modification of one, so it replaces rather than blends with the picture.
    float polarity;
    float drop = dropoutAt(uv, polarity);
    if (drop > 0.0) {
      vec3 level = polarity > 0.0 ? vec3(1.08, 1.06, 1.0) : vec3(0.02);
      rgb = mix(rgb, level, drop);
      tb.damage = max(tb.damage, drop);
    }
  }

  // Tuner noise. RF is grainier and has a chroma component; a composite feed
  // from a VCR is finer and closer to monochrome.
  float snowAmount = u_snow * mix(0.6, 1.0, rf);
  float loss = clamp(u_signalLoss, 0.0, 1.0);
  if (snowAmount > 0.0 || loss > 0.0) {
    vec2 np = floor(v_uv * u_srcSize / max(u_snowSize, 0.25));
    vec3 n = hash32(np + vec2(u_frame * 7.13, u_frame * 3.71) + u_seed);
    float mono = n.x;
    vec3 grain = mix(vec3(mono), n, 0.25 + rf * 0.35);
    rgb += (grain - 0.5) * snowAmount * 0.7;

    // Full loss of lock: the picture is replaced by snow, and the last thing
    // to go is a faint, torn residue of the image.
    vec3 fullSnow = mix(vec3(mono), n, 0.3);
    float residue = smoothstep(0.75, 1.0, loss);
    rgb = mix(rgb, fullSnow * (0.85 + 0.3 * mono), loss * (1.0 - residue * 0.15));
  }

  fragColor = vec4(rgb, max(tb.damage, loss));
}
