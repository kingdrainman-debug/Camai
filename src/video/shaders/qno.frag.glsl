// Tape pass 5 — rate control: the finest quantiser at which each segment fits.
// Output: the quantisation number and the scan cut-off (64 for the whole scan).
//
// A video segment is five macroblocks from five places in the frame, and it
// must fit a fixed number of bits. Whatever the picture spends on detail in
// one of them is not available to the other four.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cost;
uniform sampler2D u_segMB;
uniform float u_budget;

void main() {
  int s = int(gl_FragCoord.x);
  int mbs[5];
  for (int j = 0; j < 5; j++) mbs[j] = int(texelFetch(u_segMB, ivec2(s, j), 0).x + 0.5);
  // The finest quantiser that fits; failing that, the longest scan that fits
  // at the coarsest; failing that, almost nothing but DC.
  float chosen = 0.0;
  float cut = 3.0;
  for (int row = 0; row < 24; row++) {
    int r = row < 16 ? 15 - row : row;
    float total = 0.0;
    for (int j = 0; j < 5; j++) total += texelFetch(u_cost, ivec2(mbs[j], r), 0).x;
    if (total <= u_budget) {
      ivec2 qk = costRow(r);
      chosen = float(qk.x);
      cut = float(qk.y);
      break;
    }
  }
  fragColor = vec4(chosen, cut, 0.0, 1.0);
}
