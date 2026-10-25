// Camera pass 6 — the camera's DSP, building the frame from its two fields.
//
// In order, as the camera did it: the digital zoom's enlarged crop of each
// field; the transfer curve with its short knee and its wall; the detail
// enhancer's peaking filter, on luma, with coring and a limiter, whose
// vertical half works across the lines of one field; the night mode's green;
// the effects button and the fader; and, if the date imprint is burned in,
// the character generator mixing it into the picture — all before the codec,
// which then has to pay for every halo and every glyph edge.
//
// Output: Y′CbCr (BT.601), Y′ 0..1 black to reference white with headroom
// above for superwhites, chroma centred on zero.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_G0;
uniform sampler2D u_G1;
uniform int u_par0;
uniform vec2 u_raster;
uniform float u_dz;
uniform int u_dzNearest;
uniform int u_toneOn;
uniform float u_gamma;
uniform float u_knee;
uniform float u_slope;
uniform float u_clip;
uniform float u_pedestal;
uniform float u_sat;
uniform int u_detailOn;
uniform float u_dGain;
uniform float u_dFreq;
uniform float u_dVert;
uniform float u_dCoring;
uniform float u_dLimit;
uniform float u_dDark;
uniform float u_green;
uniform int u_effect;
uniform float u_effectSize;
uniform vec2 u_fade;
uniform float u_fadeWhite;
uniform sampler2D u_prev;
uniform int u_hasPrev;
uniform sampler2D u_osd0;
uniform sampler2D u_osd1;
uniform int u_osdPre0;
uniform int u_osdPre1;
uniform float u_flicker;

vec3 fieldFetch(int j, int x, int r) {
  if (j == 0) return fetch(u_G0, x, r).rgb;
  return fetch(u_G1, x, r).rgb;
}

// Linear signal at a frame pixel, through the digital zoom.
vec3 signalAt(int x, int y) {
  if (u_effect == 4) {
    int c = int(u_effectSize);
    x = (x / c) * c + c / 2;
    y = (y / c) * c + c / 2;
  }
  int j = (y & 1) == u_par0 ? 0 : 1;
  int p = y & 1;
  if (u_dz <= 1.0001) return fieldFetch(j, x, y >> 1);
  float cx = u_raster.x * 0.5;
  float cy = u_raster.y * 0.5;
  float xs = cx + (float(x) + 0.5 - cx) / u_dz - 0.5;
  float ys = cy + (float(y) + 0.5 - cy) / u_dz - 0.5;
  float rs = (ys - float(p)) * 0.5;
  if (u_dzNearest == 1) return fieldFetch(j, int(floor(xs + 0.5)), int(floor(rs + 0.5)));
  int x0 = int(floor(xs));
  int r0 = int(floor(rs));
  float fx = xs - float(x0);
  float fr = rs - float(r0);
  vec3 a = fieldFetch(j, x0, r0);
  vec3 b = fieldFetch(j, x0 + 1, r0);
  vec3 c = fieldFetch(j, x0, r0 + 1);
  vec3 d = fieldFetch(j, x0 + 1, r0 + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fr);
}

float oetf(float v) {
  if (u_toneOn == 0) return v <= 0.0 ? v : linearToSrgb(v);
  v = max(v, 0.0);
  float e = v < 0.018 ? 4.5 * v : 1.099 * pow(v, u_gamma) - 0.099;
  if (e > u_knee) e = u_knee + (e - u_knee) * u_slope;
  return min(e, u_clip) + u_pedestal;
}

vec3 yccAt(int x, int y) {
  vec3 s = signalAt(x, y);
  vec3 e = vec3(oetf(s.r), oetf(s.g), oetf(s.b));
  vec3 c = rgbToYcc(e);
  if (u_toneOn == 1) c.yz *= u_sat;
  return c;
}

float lumaAt(int x, int y) {
  return yccAt(x, y).x;
}

float core(float h) {
  float a = max(abs(h) - u_dCoring, 0.0) * sign(h);
  if (a < 0.0) a *= u_dDark;
  return clamp(a, -u_dLimit, u_dLimit);
}

vec4 overlay(sampler2D s, int x, int y) {
  ivec2 sz = textureSize(s, 0);
  return texelFetch(s, ivec2(clamp(x >> 1, 0, sz.x - 1), clamp(y >> 1, 0, sz.y - 1)), 0);
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  vec3 c = yccAt(P.x, P.y);

  if (u_detailOn == 1) {
    // Horizontal peaking at a fractional reach, by interpolation.
    float d = u_dFreq;
    int di = int(floor(d));
    float df = d - float(di);
    float l1 = mix(lumaAt(P.x - di, P.y), lumaAt(P.x - di - 1, P.y), df);
    float r1 = mix(lumaAt(P.x + di, P.y), lumaAt(P.x + di + 1, P.y), df);
    float hp = c.x - 0.5 * (l1 + r1);
    // Vertical peaking across the lines of the same field: two frame lines.
    float hv = c.x - 0.5 * (lumaAt(P.x, P.y - 2) + lumaAt(P.x, P.y + 2));
    c.x += u_dGain * (core(hp) + u_dVert * core(hv));
  }

  if (u_green > 0.0) c.yz = mix(c.yz, vec2(-0.06, -0.08) * clamp(c.x * 1.5, 0.0, 1.0), u_green);

  if (u_effect == 1 || u_effect == 3) {
    c.yz = vec2(-0.045, 0.055) * clamp(c.x * 2.0, 0.0, 1.0);
    if (u_effect == 3) c.x *= u_flicker;
  } else if (u_effect == 2) {
    c.yz = vec2(0.0);
  } else if (u_effect == 7) {
    c = vec3(1.0 - c.x, -c.y, -c.z);
  } else if (u_effect == 6 && u_hasPrev == 1) {
    c = mix(c, texelFetch(u_prev, P, 0).xyz, 0.55);
  }

  float f = (P.y & 1) == u_par0 ? u_fade.x : u_fade.y;
  if (f > 0.0) c = mix(c, vec3(u_fadeWhite, 0.0, 0.0), f);

  // The character generator, when the imprint is burned in.
  if (u_osdPre0 == 1) {
    vec4 o = overlay(u_osd0, P.x, P.y);
    c = mix(c, rgbToYcc(o.rgb), o.a);
  }
  if (u_osdPre1 == 1) {
    vec4 o = overlay(u_osd1, P.x, P.y);
    c = mix(c, rgbToYcc(o.rgb), o.a);
  }
  fragColor = vec4(c, 1.0);
}
