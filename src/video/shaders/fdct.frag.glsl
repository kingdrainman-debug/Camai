// Tape pass 2 — the forward DCT, one coefficient per texel.
//
// Coefficients are stored macroblock by macroblock: a tile of 48×8 holds the
// six blocks (four luma, Cb, Cr) side by side. Each block chooses its
// transform first: a block whose two fields differ (an interlaced edge in
// motion) codes the sum and the difference of each field line pair with a
// 2-4-8 DCT instead of the 8-8, so that the motion does not spray energy into
// every vertical frequency. Values are in 8-bit coding units (Y 16–235,
// chroma 16–240) less 128.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pre;
uniform sampler2D u_chroma;
uniform int u_dct248;

float pixelValue(int m, int b, int i, int j) {
  ivec3 p = blockPixel(m, b, i, j);
  // DV stores 8-bit samples: Y′ 1–254, chroma 1–254 about 128.
  if (p.x == 0) return clamp(floor(texelFetch(u_pre, p.yz, 0).x * 219.0 + 16.5), 1.0, 254.0) - 128.0;
  vec2 c = texelFetch(u_chroma, p.yz, 0).xy;
  return clamp(floor((b == 4 ? c.x : c.y) * 224.0 + 128.5), 1.0, 254.0) - 128.0;
}

float cu(int k) {
  return k == 0 ? 0.7071067811865476 : 1.0;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  int m = (P.y / 8) * 30 + P.x / 48;
  if (m >= u_nMB) {
    fragColor = vec4(0.0);
    return;
  }
  int b = (P.x % 48) / 8;
  int u = P.x % 8;
  int v = P.y % 8;

  float x[64];
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) x[j * 8 + i] = pixelValue(m, b, i, j);

  // Field difference against same-field detail decides the mode.
  float mode = 0.0;
  if (u_dct248 == 1) {
    float adj = 0.0;
    float two = 0.0;
    for (int j = 0; j < 7; j++) for (int i = 0; i < 8; i++) adj += abs(x[j * 8 + i] - x[(j + 1) * 8 + i]);
    for (int j = 0; j < 6; j++) for (int i = 0; i < 8; i++) two += abs(x[j * 8 + i] - x[(j + 2) * 8 + i]);
    adj /= 56.0;
    two /= 48.0;
    if (adj > two * 1.5 + 3.0) mode = 1.0;
  }

  float acc = 0.0;
  if (mode < 0.5) {
    for (int j = 0; j < 8; j++) {
      float cv = cos(float((2 * j + 1) * v) * PI / 16.0);
      for (int i = 0; i < 8; i++) acc += x[j * 8 + i] * cos(float((2 * i + 1) * u) * PI / 16.0) * cv;
    }
    acc *= 0.25 * cu(u) * cu(v);
  } else {
    int vv = v & 3;
    float sg = v < 4 ? 1.0 : -1.0;
    for (int k = 0; k < 4; k++) {
      float cv = cos(float((2 * k + 1) * vv) * PI / 8.0);
      for (int i = 0; i < 8; i++) {
        float pr = x[(2 * k) * 8 + i] + sg * x[(2 * k + 1) * 8 + i];
        acc += pr * cos(float((2 * i + 1) * u) * PI / 16.0) * cv;
      }
    }
    // 8-point along the line, 4-point down the pairs, 1/√2 for the pair.
    acc *= 0.5 * cu(u) * (vv == 0 ? 0.5 : 0.7071067811865476) * 0.7071067811865476;
  }
  fragColor = vec4(acc, mode, 0.0, 1.0);
}
