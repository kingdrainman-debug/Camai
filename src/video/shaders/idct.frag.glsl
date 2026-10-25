// Tape pass 7 — the inverse DCT, into the luma plane (u_plane 0) or the
// chroma plane (u_plane 1, Cb and Cr together), honouring each block's mode.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_deq;
uniform int u_plane;

float cu(int k) {
  return k == 0 ? 0.7071067811865476 : 1.0;
}

float invBlock(int m, int b, int i, int j) {
  float mode = texelFetch(u_deq, coefAddr(m, b, 0, 0), 0).y;
  float acc = 0.0;
  if (mode < 0.5) {
    for (int v = 0; v < 8; v++) {
      float cv = cu(v) * cos(float((2 * j + 1) * v) * PI / 16.0);
      for (int u = 0; u < 8; u++) acc += texelFetch(u_deq, coefAddr(m, b, u, v), 0).x * cu(u) * cos(float((2 * i + 1) * u) * PI / 16.0) * cv;
    }
    return acc * 0.25;
  }
  // 2-4-8: rebuild the pair sum and difference for line pair k, then the lines.
  int k = j >> 1;
  float sum = 0.0;
  float dif = 0.0;
  for (int vv = 0; vv < 4; vv++) {
    float cv = (vv == 0 ? 0.5 : 0.7071067811865476) * cos(float((2 * k + 1) * vv) * PI / 8.0);
    for (int u = 0; u < 8; u++) {
      float bu = cu(u) * cos(float((2 * i + 1) * u) * PI / 16.0) * 0.5;
      sum += texelFetch(u_deq, coefAddr(m, b, u, vv), 0).x * bu * cv;
      dif += texelFetch(u_deq, coefAddr(m, b, u, vv + 4), 0).x * bu * cv;
    }
  }
  return (sum + ((j & 1) == 0 ? dif : -dif)) * 0.7071067811865476;
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  if (u_plane == 0) {
    ivec4 o = lumaOwner(P.x, P.y);
    float val = invBlock(o.x, o.y, o.z, o.w);
    fragColor = vec4((clamp(floor(val + 128.5), 0.0, 255.0) - 16.0) / 219.0, 0.0, 0.0, 1.0);
  } else {
    ivec3 o = chromaOwner(P.x, P.y);
    float cb = (clamp(floor(invBlock(o.x, 4, o.y, o.z) + 128.5), 0.0, 255.0) - 128.0) / 224.0;
    float cr = (clamp(floor(invBlock(o.x, 5, o.y, o.z) + 128.5), 0.0, 255.0) - 128.0) / 224.0;
    fragColor = vec4(cb, cr, 0.0, 1.0);
  }
}
