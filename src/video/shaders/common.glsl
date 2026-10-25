// Shared helpers, concatenated after the #version line of every fragment shader.
//
// Conventions, the same in every pass and in the CPU mirror (src/video/cpu):
//
//   - Every image is addressed by integer texel (x, y) with y = 0 the TOP row,
//     i.e. ivec2(gl_FragCoord.xy) taken at face value. Sources are uploaded
//     without a flip, so their row 0 is the top too. Only the final draw to
//     the canvas flips. (gl_FragCoord is the pixel centre with its origin
//     bottom-left: a mirror using top-left integer indices without this
//     agreement is half a pixel out and upside down, which for a block codec
//     is fatal.)
//   - Filtering is done by hand with texelFetch, so both backends interpolate
//     with the same weights and float targets need no linear-filter extension.
//   - Random numbers come from an integer hash identical to the event clock's
//     (Math.imul there, uint arithmetic here), never from a float hash.
precision highp float;
precision highp int;
precision highp sampler2D;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;

/* ---------------- integer hashing ---------------- */

// ihash() from camai-events.js, bit for bit.
uint uhash(int a, int b, int c) {
  uint h = (uint(a) * 0x9e3779b1u) ^ ((uint(b) + 0x632be5abu) * 0x85ebca77u) ^ ((uint(c) + 0x1b873593u) * 0xc2b2ae3du);
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return h;
}

float ihash(int a, int b, int c) {
  return float(uhash(a, b, c) >> 8) / 16777216.0;
}

// A standard normal deviate from two hashes (Box–Muller).
float gaussHash(int a, int b, int c) {
  float u1 = max(ihash(a, b, c), 1.0 / 16777216.0);
  float u2 = ihash(a, b, c + 7919);
  return sqrt(-2.0 * log(u1)) * cos(TAU * u2);
}

/* ---------------- fetching ---------------- */

vec4 fetch(sampler2D s, int x, int y) {
  ivec2 sz = textureSize(s, 0);
  return texelFetch(s, ivec2(clamp(x, 0, sz.x - 1), clamp(y, 0, sz.y - 1)), 0);
}

// Bilinear at a texel-space position (centres at +0.5), clamped at the edges.
vec4 bilinear(sampler2D s, vec2 p) {
  vec2 q = p - 0.5;
  vec2 f0 = floor(q);
  vec2 f = q - f0;
  int x0 = int(f0.x);
  int y0 = int(f0.y);
  vec4 a = fetch(s, x0, y0);
  vec4 b = fetch(s, x0 + 1, y0);
  vec4 c = fetch(s, x0, y0 + 1);
  vec4 d = fetch(s, x0 + 1, y0 + 1);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

int mirrorIndex(int i, int n) {
  int p = 2 * n;
  int k = i - p * int(floor(float(i) / float(p)));
  return k < n ? k : p - 1 - k;
}

// Bilinear with mirrored repeat: the world past the edge of the source.
vec4 bilinearMirror(sampler2D s, vec2 p) {
  ivec2 sz = textureSize(s, 0);
  vec2 q = p - 0.5;
  vec2 f0 = floor(q);
  vec2 f = q - f0;
  int x0 = mirrorIndex(int(f0.x), sz.x);
  int x1 = mirrorIndex(int(f0.x) + 1, sz.x);
  int y0 = mirrorIndex(int(f0.y), sz.y);
  int y1 = mirrorIndex(int(f0.y) + 1, sz.y);
  vec4 a = texelFetch(s, ivec2(x0, y0), 0);
  vec4 b = texelFetch(s, ivec2(x1, y0), 0);
  vec4 c = texelFetch(s, ivec2(x0, y1), 0);
  vec4 d = texelFetch(s, ivec2(x1, y1), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* ---------------- colour ---------------- */

float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

float linearToSrgb(float c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 srgbToLinear3(vec3 c) {
  return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b));
}

// BT.601, the matrix DV is coded in. Y′ 0..1 is black to reference white;
// Cb and Cr are centred on zero, ±0.5 at full scale.
vec3 rgbToYcc(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) / 1.772, (c.r - y) / 1.402);
}

vec3 yccToRgb(vec3 c) {
  return vec3(c.x + 1.402 * c.z, c.x - 0.344136 * c.y - 0.714136 * c.z, c.x + 1.772 * c.y);
}

float luma601(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
