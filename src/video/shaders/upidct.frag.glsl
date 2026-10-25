// Upload pass 3 — quantise with one coarse step for the whole frame, as the
// web encoders of the day did at a low bitrate, and invert.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_coef;
uniform float u_q;

float cu(int k) {
  return k == 0 ? 0.7071067811865476 : 1.0;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 o = (P / 8) * 8;
  int i = P.x & 7;
  int j = P.y & 7;
  vec3 acc = vec3(0.0);
  for (int v = 0; v < 8; v++) {
    float cv = cu(v) * cos(float((2 * j + 1) * v) * PI / 16.0);
    for (int u = 0; u < 8; u++) {
      vec3 c = texelFetch(u_coef, o + ivec2(u, v), 0).xyz;
      float w = 1.0 + 0.25 * float(u + v);
      vec3 st = (u == 0 && v == 0) ? vec3(8.0) : vec3(2.0 * u_q * w, 3.0 * u_q * w, 3.0 * u_q * w);
      vec3 rec = sign(c) * floor(abs(c) / st + 0.5) * st;
      acc += rec * cu(u) * cos(float((2 * i + 1) * u) * PI / 16.0) * cv;
    }
  }
  acc *= 0.25;
  fragColor = vec4((acc.x + 128.0 - 16.0) / 219.0, acc.y / 224.0, acc.z / 224.0, 1.0);
}
