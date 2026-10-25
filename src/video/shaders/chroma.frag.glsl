// Tape pass 1 — chroma subsampling.
//
// 525/60 DV keeps a quarter of the horizontal colour resolution (4:1:1): one
// Cb and one Cr for every four pixels of a line, at full vertical
// resolution. 625/50 keeps half in each direction (4:2:0), and its vertical
// average spans two frame lines, so it mixes the two fields' colour. Either
// way red text smears: sideways in 525, sideways and down in 625.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_pre;
uniform int u_cx;
uniform int u_cy;

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  vec2 acc = vec2(0.0);
  for (int j = 0; j < 2; j++) {
    if (j >= u_cy) break;
    for (int i = 0; i < 4; i++) {
      if (i >= u_cx) break;
      acc += texelFetch(u_pre, ivec2(P.x * u_cx + i, P.y * u_cy + j), 0).yz;
    }
  }
  fragColor = vec4(acc / float(u_cx * u_cy), 0.0, 1.0);
}
