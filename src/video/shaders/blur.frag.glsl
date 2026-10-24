// Separable Gaussian. Used twice for the tight bloom and twice, much wider,
// for halation.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_texel;
uniform vec2 u_dir;
uniform float u_radius;

void main() {
  float sigma = max(u_radius, 0.35);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i) * max(sigma * 0.42, 0.6);
    float w = gauss(x, sigma);
    sum += texture(u_src, v_uv + u_dir * u_texel * x).rgb * w;
    wsum += w;
  }
  fragColor = vec4(sum / max(wsum, 1e-5), 1.0);
}
