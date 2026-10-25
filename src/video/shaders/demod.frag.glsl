// Camera pass 5 — decoding colour from the sensor, for one field.
//
// A complementary-mosaic line, read in summed pairs, alternates between two
// filter sums along its length. Their total is luminance-like; their
// difference is one colour-difference signal, and which one depends on the
// line: R-ish on one, B-ish on the next. So each line carries only one of the
// two, the other is borrowed from the lines above and below in the same
// field, and the difference is smoothed along the line because it is only
// sampled every other pixel. That is the single-chip camera's low colour
// resolution and its false colour on fine detail, by construction.
//
// The decoding matrix is the one for ideal filters. Real filters overlap
// (Filter overlap in the Sensor section), so the matrix is slightly wrong for
// them, and saturated colours, reds most of all, come out muddy.
//
// Then the camera's white balance gains and its signal gain.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_F;
uniform int u_sensor;
uniform int u_parity;
uniform mat3 u_minv;
uniform float u_gain;
uniform vec3 u_wb;
uniform int u_chromaTaps;
uniform float u_well;

float S(int x, int r) {
  ivec2 sz = textureSize(u_F, 0);
  return texelFetch(u_F, ivec2(clamp(x, 0, sz.x - 1), clamp(r, 0, sz.y - 1)), 0).r;
}

// The colour-difference signal of field line r at x.
float diffAt(int x, int r) {
  float sg = (x & 1) == 0 ? 1.0 : -1.0;
  return sg * (2.0 * S(x, r) - S(x - 1, r) - S(x + 1, r)) * 0.5;
}

float smoothDiff(int x, int r) {
  float acc = 0.0;
  float n = 0.0;
  for (int i = -4; i <= 4; i++) {
    if (i < -u_chromaTaps || i > u_chromaTaps) continue;
    acc += diffAt(x + i, r);
    n += 1.0;
  }
  return acc / n;
}

void main() {
  int x = int(gl_FragCoord.x);
  int r = int(gl_FragCoord.y);
  vec3 rgb;
  if (u_sensor == 0) {
    int a = 2 * r + u_parity;
    int o = (a & 1) == 1 ? a : a + 1;
    int type = (o >> 1) & 1;
    float P = (S(x - 1, r) + 2.0 * S(x, r) + S(x + 1, r)) * 0.5;
    float D = smoothDiff(x, r);
    float Dn = (smoothDiff(x, r - 1) + smoothDiff(x, r + 1)) * 0.5;
    vec3 m = type == 0 ? vec3(P, D, Dn) : vec3(P, Dn, D);
    rgb = u_minv * m;
    // Highlight chroma suppression: where the wells are filling, the camera
    // fades colour towards white, so a fully clipped highlight is white and
    // only its edge, where the filters clip at different points, is coloured.
    float peak = max(S(x - 1, r), max(S(x, r), S(x + 1, r)));
    float t = clamp((peak - 0.8 * u_well) / (0.18 * u_well), 0.0, 1.0);
    float sup = t * t * (3.0 - 2.0 * t);
    if (sup > 0.0) rgb = mix(rgb, vec3(luma601(rgb)), sup);
  } else {
    rgb = texelFetch(u_F, ivec2(x, r), 0).rgb;
  }
  fragColor = vec4(rgb * u_wb * u_gain, 1.0);
}
