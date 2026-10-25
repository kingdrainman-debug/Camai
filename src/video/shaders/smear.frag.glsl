// Camera pass 3 — what each column's vertical register collects.
//
// On an interline-transfer CCD the charge is shifted down a column of
// vertical registers past every photosite in that column. Light leaking into
// the registers while it does adds charge in proportion to everything bright
// anywhere in the column: a bright point draws a stripe the full height of
// the frame. This pass is that column total, one texel per column.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_E;
uniform int u_H;

void main() {
  int x = int(gl_FragCoord.x);
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 576; y++) {
    if (y >= u_H) break;
    acc += texelFetch(u_E, ivec2(x, y), 0).rgb;
  }
  fragColor = vec4(acc / float(u_H), 1.0);
}
