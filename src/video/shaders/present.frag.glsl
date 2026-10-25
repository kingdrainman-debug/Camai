// Display pass 2 — the screen.
//
// The SD raster scaled to the output frame, honouring the pixel aspect, by
// whichever deinterlacer and scaler played it. Then anything drawn on the
// display itself, on the display's own pixel grid: sharp, after everything.
// Then dither and the flip onto the canvas.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_img;
uniform vec4 u_map;        // x0, y0, width, height of the picture in image pixels
uniform vec2 u_out;
uniform int u_deint;       // 0 weave, 1 bob, 2 blend, 3 discard
uniform int u_field;       // parity shown by bob and discard
uniform int u_scaler;
uniform sampler2D u_osd0;
uniform sampler2D u_osd1;
uniform int u_osdDisp0;
uniform int u_osdDisp1;
uniform vec4 u_osdMap;     // the same, in DV pixels, for the display overlay
uniform float u_dither;
uniform int u_frame;
uniform float u_split;
uniform sampler2D u_src;
uniform vec4 u_srcMap;

int lines() {
  ivec2 sz = textureSize(u_img, 0);
  return u_deint == 1 || u_deint == 3 ? sz.y / 2 : sz.y;
}

vec3 lineFetch(int x, int l) {
  ivec2 sz = textureSize(u_img, 0);
  int row = (u_deint == 1 || u_deint == 3) ? 2 * clamp(l, 0, sz.y / 2 - 1) + u_field : clamp(l, 0, sz.y - 1);
  return texelFetch(u_img, ivec2(clamp(x, 0, sz.x - 1), clamp(row, 0, sz.y - 1)), 0).xyz;
}

float cubicW(float t) {
  t = abs(t);
  if (t < 1.0) return 1.5 * t * t * t - 2.5 * t * t + 1.0;
  if (t < 2.0) return -0.5 * t * t * t + 2.5 * t * t - 4.0 * t + 2.0;
  return 0.0;
}

// Sample in texel space (x) and line space (l), centres at +0.5.
vec3 sampleLines(float x, float l) {
  if (u_scaler == 0) return lineFetch(int(floor(x)), int(floor(l)));
  float qx = x - 0.5;
  float ql = l - 0.5;
  int x0 = int(floor(qx));
  int l0 = int(floor(ql));
  float fx = qx - float(x0);
  float fl = ql - float(l0);
  if (u_scaler == 1) {
    vec3 a = lineFetch(x0, l0);
    vec3 b = lineFetch(x0 + 1, l0);
    vec3 c = lineFetch(x0, l0 + 1);
    vec3 d = lineFetch(x0 + 1, l0 + 1);
    return mix(mix(a, b, fx), mix(c, d, fx), fl);
  }
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 2; j++) {
    float wy = cubicW(float(j) - fl);
    for (int i = -1; i <= 2; i++) acc += lineFetch(x0 + i, l0 + j) * cubicW(float(i) - fx) * wy;
  }
  return acc;
}

vec3 pictureAt(vec2 n) {
  float sx = u_map.x + n.x * u_map.z;
  float sy = u_map.y + n.y * u_map.w;
  if (u_deint == 1 || u_deint == 3) return sampleLines(sx, (sy - float(u_field) + 0.5) * 0.5);
  if (u_deint == 2) return 0.25 * sampleLines(sx, sy - 1.0) + 0.5 * sampleLines(sx, sy) + 0.25 * sampleLines(sx, sy + 1.0);
  return sampleLines(sx, sy);
}

void main() {
  ivec2 F = ivec2(gl_FragCoord.xy);
  ivec2 P = ivec2(F.x, int(u_out.y) - 1 - F.y);
  vec2 n = (vec2(P) + 0.5) / u_out;
  vec3 rgb;
  if (u_split >= 0.0 && n.x < u_split) {
    vec2 sp = (u_srcMap.xy + n * u_srcMap.zw) * vec2(textureSize(u_src, 0));
    rgb = bilinear(u_src, sp).rgb;
  } else {
    rgb = clamp(yccToRgb(pictureAt(n)), 0.0, 1.0);
    vec2 d = u_osdMap.xy + n * u_osdMap.zw;
    ivec2 cell = ivec2(floor(d * 0.5));
    if (u_osdDisp0 == 1) {
      ivec2 sz = textureSize(u_osd0, 0);
      vec4 o = texelFetch(u_osd0, clamp(cell, ivec2(0), sz - 1), 0);
      rgb = mix(rgb, o.rgb, o.a);
    }
    if (u_osdDisp1 == 1) {
      ivec2 sz = textureSize(u_osd1, 0);
      vec4 o = texelFetch(u_osd1, clamp(cell, ivec2(0), sz - 1), 0);
      rgb = mix(rgb, o.rgb, o.a);
    }
  }
  if (u_dither > 0.0) {
    float h = ihash(P.x + 4096 * P.y, u_frame, 977);
    rgb += (h - 0.5) * u_dither / 255.0;
  }
  fragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
