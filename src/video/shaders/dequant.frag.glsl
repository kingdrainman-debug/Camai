// Tape pass 6 — quantise and reconstruct each coefficient, as the decoder
// will see it. DC keeps nine bits; AC is quantised by the segment's number,
// the block's class and the coefficient's area of the scan.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_coef;
uniform sampler2D u_info;
uniform sampler2D u_qno;
uniform sampler2D u_mbSeg;

int ZZ_INDEX(int pos) {
  for (int k = 0; k < 64; k++) if (ZIGZAG[k] == pos) return k;
  return 63;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  int m = (P.y / 8) * 30 + P.x / 48;
  vec4 cm = texelFetch(u_coef, P, 0);
  if (m >= u_nMB) {
    fragColor = vec4(0.0);
    return;
  }
  int b = (P.x % 48) / 8;
  int u = P.x % 8;
  int v = P.y % 8;
  float c = cm.x;
  float r;
  if (u == 0 && v == 0) {
    r = floor(c / 2.0 + 0.5) * 2.0;
  } else {
    int cls = int(texelFetch(u_info, ivec2((m % 30) * 6 + b, m / 30), 0).x + 0.5);
    int seg = int(texelFetch(u_mbSeg, ivec2(m, 0), 0).x + 0.5);
    vec2 qk = texelFetch(u_qno, ivec2(seg, 0), 0).xy;
    int q = int(qk.x + 0.5);
    int k = ZZ_INDEX(u + 8 * v);
    float st = stepFor(q, cls, areaOf(k));
    float w = dvWeight(u, v);
    r = k < int(qk.y + 0.5) ? sign(c) * quantLevel(c * w, st) * st / w : 0.0;
  }
  fragColor = vec4(r, cm.y, 0.0, 1.0);
}
