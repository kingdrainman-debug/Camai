// Tape pass 3 — each block's activity class.
//
// The encoder sorts blocks into four classes by their largest AC
// coefficient, and a busier class is quantised more coarsely: the eye
// forgives error in detail more than in flat areas.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_coef;
uniform int u_classes;
uniform vec3 u_classBounds;

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 o = P * 8;
  float mx = 0.0;
  for (int v = 0; v < 8; v++) for (int u = 0; u < 8; u++) {
    if (u == 0 && v == 0) continue;
    mx = max(mx, abs(texelFetch(u_coef, o + ivec2(u, v), 0).x));
  }
  float cls = 1.0;
  if (u_classes == 1) cls = mx <= u_classBounds.x ? 0.0 : mx <= u_classBounds.y ? 1.0 : mx <= u_classBounds.z ? 2.0 : 3.0;
  fragColor = vec4(cls, mx, 0.0, 1.0);
}
