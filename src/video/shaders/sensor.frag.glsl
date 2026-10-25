// Camera pass 4 — the CCD (or CMOS) reading out one field.
//
// Each photosite collects charge through its colour filter and stops at its
// full well; what overflows blooms into the sites above and below. On a CCD
// the column's register adds its smear. In field integration mode adjacent
// rows are summed in pairs, the pairing alternating between fields, so the
// two fields sample different row pairs and each has less vertical
// resolution than half a frame. Then noise: read noise and photon noise,
// which the gain that follows will multiply.
//
// Output, per field line: for the complementary mosaic the summed charge
// (one number, decoded by the next pass); for three chips, or for a CMOS
// sensor's demosaiced Bayer, RGB.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_E;
uniform sampler2D u_smear;
uniform int u_parity;
uniform int u_integrate;
uniform int u_sensor;      // 0 complementary CCD, 1 three CCDs, 2 Bayer CMOS, 3 ideal (sensor off)
uniform float u_crosstalk;
uniform float u_well;
uniform float u_bloom;
uniform float u_smearK;
uniform float u_read;
uniform float u_shot;
uniform int u_field;
uniform int u_seed;
uniform int u_H;

vec3 filterAt(int x, int row) {
  float k = u_crosstalk;
  if (u_sensor == 0) {
    if ((row & 1) == 0) return (x & 1) == 0 ? vec3(k, 1.0, 1.0) : vec3(1.0, 1.0, k);
    bool kk = ((row >> 1) & 1) == 1;
    bool g = ((x & 1) == 0) != kk;
    return g ? vec3(k, 1.0, k) : vec3(1.0, k, 1.0);
  }
  // Bayer, RGGB.
  if ((row & 1) == 0) return (x & 1) == 0 ? vec3(1.0, k, k) : vec3(k, 1.0, k);
  return (x & 1) == 0 ? vec3(k, 1.0, k) : vec3(k, k, 1.0);
}

vec3 lightAt(int x, int row) {
  return texelFetch(u_E, ivec2(clamp(x, 0, textureSize(u_E, 0).x - 1), clamp(row, 0, u_H - 1)), 0).rgb;
}

// Charge in one mosaic photosite, clipped, with its neighbours' overflow.
float siteCharge(int x, int row) {
  vec3 f = filterAt(x, row);
  float q = dot(f, lightAt(x, row));
  float c = min(q, u_well);
  if (u_bloom > 0.0) {
    float spill = 0.0;
    float w = 0.5;
    for (int d = 1; d <= 3; d++) {
      spill += w * (max(dot(filterAt(x, row - d), lightAt(x, row - d)) - u_well, 0.0) +
                    max(dot(filterAt(x, row + d), lightAt(x, row + d)) - u_well, 0.0));
      w *= 0.5;
    }
    spill += 0.15 * (max(dot(filterAt(x - 1, row), lightAt(x - 1, row)) - u_well, 0.0) +
                     max(dot(filterAt(x + 1, row), lightAt(x + 1, row)) - u_well, 0.0));
    c += u_bloom * spill;
  }
  return c;
}

// Charge in one three-chip site, per chip.
vec3 chipCharge(int x, int row) {
  vec3 q = lightAt(x, row);
  vec3 c = min(q, vec3(u_well));
  if (u_bloom > 0.0) {
    vec3 spill = vec3(0.0);
    float w = 0.5;
    for (int d = 1; d <= 3; d++) {
      spill += w * (max(lightAt(x, row - d) - u_well, 0.0) + max(lightAt(x, row + d) - u_well, 0.0));
      w *= 0.5;
    }
    spill += 0.15 * (max(lightAt(x - 1, row) - u_well, 0.0) + max(lightAt(x + 1, row) - u_well, 0.0));
    c += u_bloom * spill;
  }
  return c;
}

float noisy(float q, int x, int line, int ch) {
  if (u_read <= 0.0 && u_shot <= 0.0) return q;
  float sigma = sqrt(u_read * u_read + u_shot * u_shot * max(q, 0.0));
  return q + sigma * gaussHash(x + 1024 * line, u_field * 4 + ch, u_seed);
}

// A CMOS site's charge with its own noise.
float bayerSite(int x, int row) {
  float q = min(dot(filterAt(x, row), lightAt(x, row)), u_well);
  return noisy(q, x, row + 4096, 3);
}

// Bilinear Bayer demosaic at one sensor row.
vec3 bayerRGB(int x, int row) {
  vec3 sum = vec3(0.0);
  vec3 wt = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      int sx = x + dx;
      int sy = row + dy;
      float w = (dx == 0 ? 2.0 : 1.0) * (dy == 0 ? 2.0 : 1.0);
      vec3 f = filterAt(sx, sy);
      vec3 sel = vec3(f.r > 0.99 ? 1.0 : 0.0, f.g > 0.99 ? 1.0 : 0.0, f.b > 0.99 ? 1.0 : 0.0);
      sum += sel * w * bayerSite(sx, sy);
      wt += sel * w;
    }
  }
  return sum / max(wt, vec3(1e-6));
}

void main() {
  int x = int(gl_FragCoord.x);
  int r = int(gl_FragCoord.y);
  int a = 2 * r + u_parity;
  int b = a + 1;
  bool pair = u_integrate == 1;

  if (u_sensor == 3) {
    vec3 L = pair ? (lightAt(x, a) + lightAt(x, b)) * 0.5 : lightAt(x, a);
    fragColor = vec4(L, 1.0);
    return;
  }
  if (u_sensor == 2) {
    vec3 L = pair ? (bayerRGB(x, a) + bayerRGB(x, b)) * 0.5 : bayerRGB(x, a);
    fragColor = vec4(L, 1.0);
    return;
  }

  vec3 smear = texelFetch(u_smear, ivec2(x, 0), 0).rgb * u_smearK;
  if (u_sensor == 0) {
    // The complementary mosaic always sums its pairs: one row alone does not
    // carry enough of the filters to decode colour from.
    float qa = siteCharge(x, a) + dot(filterAt(x, a), smear);
    float qb = siteCharge(x, b) + dot(filterAt(x, b), smear);
    float S = min((qa + qb) * 0.5, u_well * 1.6);
    fragColor = vec4(noisy(S, x, r, 0), 0.0, 0.0, 1.0);
    return;
  }
  vec3 S = pair ? (chipCharge(x, a) + chipCharge(x, b)) * 0.5 : chipCharge(x, a);
  S = min(S + smear, vec3(u_well * 1.6));
  fragColor = vec4(noisy(S.r, x, r, 0), noisy(S.g, x, r, 1), noisy(S.b, x, r, 2), 1.0);
}
