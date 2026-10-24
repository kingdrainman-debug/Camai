// Shared helpers, concatenated after the #version line of every fragment shader.
precision highp float;
precision highp sampler2D;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

/* ---------------- hashing & noise ---------------- */

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * vnoise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/* ---------------- colour ---------------- */

// The colour space NTSC actually transmits in: one wideband luma channel and
// two narrowband colour-difference channels sharing a quadrature subcarrier.
vec3 rgb2yiq(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(0.5959, -0.2746, -0.3213)),
    dot(c, vec3(0.2115, -0.5227, 0.3112)));
}

vec3 yiq2rgb(vec3 c) {
  return vec3(
    c.x + 0.9560 * c.y + 0.6190 * c.z,
    c.x - 0.2720 * c.y - 0.6470 * c.z,
    c.x - 1.1060 * c.y + 1.7030 * c.z);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

vec3 safePow(vec3 c, float g) {
  return pow(max(c, vec3(0.0)), vec3(g));
}

/* ---------------- misc ---------------- */

float gauss(float x, float sigma) {
  return exp(-(x * x) / (2.0 * sigma * sigma));
}

// Interleaved gradient noise: a cheap ordered dither with no visible pattern.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float remap(float v, float a, float b) {
  return clamp((v - a) / max(b - a, 1e-5), 0.0, 1.0);
}
