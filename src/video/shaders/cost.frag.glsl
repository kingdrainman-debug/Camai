// Tape pass 4 — what each macroblock would cost at each quantiser.
//
// One texel per (macroblock, quantiser row — see costRow): the bits its six blocks'
// AC coefficients would take, scanned in zigzag order as runs and amplitudes
// with an end-of-block code each. The DC terms and headers are a fixed cost
// and are not counted against the AC budget.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_coef;
uniform sampler2D u_info;

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  int m = P.x;
  ivec2 qk = costRow(P.y);
  int q = qk.x;
  float bits = 0.0;
  for (int b = 0; b < 6; b++) {
    int cls = int(texelFetch(u_info, ivec2((m % 30) * 6 + b, m / 30), 0).x + 0.5);
    float run = 0.0;
    for (int k = 1; k < 64; k++) {
      if (k >= qk.y) break;
      int z = ZIGZAG[k];
      float c = texelFetch(u_coef, coefAddr(m, b, z & 7, z >> 3), 0).x * dvWeight(z & 7, z >> 3);
      float lv = quantLevel(c, stepFor(q, cls, areaOf(k)));
      if (lv > 0.0) {
        bits += vlcBits(run, lv);
        run = 0.0;
      } else {
        run += 1.0;
      }
    }
    bits += 4.0;
  }
  fragColor = vec4(bits, 0.0, 0.0, 1.0);
}
