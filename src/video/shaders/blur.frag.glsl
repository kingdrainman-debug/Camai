// Camera pass 2 — the lens's softness, one direction at a time.
//
// A spatially varying Gaussian: the centre's softness, more towards the
// corners, the focus error of a hunting autofocus, diffraction at a small
// aperture, and a fisheye adapter's soft rim, added in quadrature. Sizes are
// in DV-raster pixels.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform ivec2 u_dir;
uniform float u_sigma0;
uniform float u_sigmaCorner;
uniform vec3 u_rim;        // radius, width, extra sigma
uniform vec2 u_raster;
uniform float u_aspect;

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  vec2 pix = vec2(P) + 0.5;
  vec2 q = vec2((pix.x - u_raster.x * 0.5) / 704.0 * u_aspect, (pix.y - u_raster.y * 0.5) / u_raster.y);
  float rc = length(vec2(u_aspect * 0.5, 0.5));
  float rho = length(q) / rc;
  float sc = u_sigmaCorner * rho * rho;
  float s = sqrt(u_sigma0 * u_sigma0 + sc * sc);
  if (u_rim.z > 0.0) s += u_rim.z * clamp((length(q) - (u_rim.x - u_rim.y)) / max(u_rim.y, 1e-4), 0.0, 1.0);
  if (s < 0.05) {
    fragColor = fetch(u_src, P.x, P.y);
    return;
  }
  int R = min(int(ceil(3.0 * s)), 24);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  float k = -1.0 / (2.0 * s * s);
  for (int i = -24; i <= 24; i++) {
    if (i < -R || i > R) continue;
    float w = exp(float(i * i) * k);
    ivec2 Q = P + u_dir * i;
    acc += fetch(u_src, Q.x, Q.y) * w;
    wsum += w;
  }
  fragColor = acc / wsum;
}
