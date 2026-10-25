// Upload pass 2 — the second codec's forward DCT, 8×8 blocks on the upload
// raster, all three channels at once.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_up;

float cu(int k) {
  return k == 0 ? 0.7071067811865476 : 1.0;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 o = (P / 8) * 8;
  int u = P.x & 7;
  int v = P.y & 7;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    float cv = cos(float((2 * j + 1) * v) * PI / 16.0);
    for (int i = 0; i < 8; i++) {
      vec3 c = fetch(u_up, o.x + i, o.y + j).xyz * vec3(219.0, 224.0, 224.0) + vec3(16.0 - 128.0, 0.0, 0.0);
      acc += c * cos(float((2 * i + 1) * u) * PI / 16.0) * cv;
    }
  }
  fragColor = vec4(acc * 0.25 * cu(u) * cu(v), 1.0);
}
