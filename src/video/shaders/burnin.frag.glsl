// Slow running average of the picture, used as a burn-in map.
//
// Phosphor that has been driven hard for years never fully recovers. Whatever
// sat still on the screen — a station logo, a menu, a pause bar — is permanently
// dimmer than the phosphor around it.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cur;
uniform sampler2D u_prev;
uniform float u_rate;
uniform float u_dt;

void main() {
  vec3 cur = texture(u_cur, v_uv).rgb;
  vec3 prev = texture(u_prev, v_uv).rgb;
  float k = clamp(u_rate * u_dt * 60.0, 0.0, 1.0);
  fragColor = vec4(mix(prev, cur, k), 1.0);
}
