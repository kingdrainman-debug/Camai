// Box downsample by four, for the glow chains. Four bilinear taps one source
// texel apart average a 4×4 block, and an optional threshold keeps only what
// is bright enough to streak through an anamorphic lens.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_srcTexel;
uniform float u_threshold;   // exposure; 0 disables

void main() {
  vec3 c = vec3(0.0);
  c += texture(u_src, v_uv + u_srcTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_srcTexel * vec2(1.0, -1.0)).rgb;
  c += texture(u_src, v_uv + u_srcTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(u_src, v_uv + u_srcTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (u_threshold > 0.0) {
    float l = luma(c);
    c *= max(l - u_threshold, 0.0) / max(l, 1e-4);
  }
  fragColor = vec4(c, 1.0);
}
