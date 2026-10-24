// Bright pass for the bloom and halation chains.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform float u_threshold;

void main() {
  vec3 c = texture(u_src, v_uv).rgb;
  float l = luma(c);
  float k = max(l - u_threshold, 0.0) / max(1.0 - u_threshold, 1e-3);
  fragColor = vec4(c * k * k, 1.0);
}
