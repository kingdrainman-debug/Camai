// Display pass 1 — what left the camera or the deck, and how it was captured.
//
// First, anything drawn over the decoded picture at playback: the camera's
// display on its AV output, or the data code. It is crisp, on top of the
// blocks rather than under them. Then the capture:
//
//   - FireWire copies the DV stream: identity.
//   - S-Video carries luma and chroma on separate wires: softer, chroma
//     late, but no cross-talk.
//   - Composite puts chroma on a subcarrier in the luma band and the capture
//     card has to take it out again: dot crawl, cross-colour on fine detail,
//     and a softer picture — with the overlays degraded along with it,
//     because by now they are part of the signal. Adapted from CRTBOX's
//     composite pass, at the DV raster's 13.5 MHz sampling.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_dec;
uniform sampler2D u_osd0;
uniform sampler2D u_osd1;
uniform int u_osdDec0;
uniform int u_osdDec1;
uniform int u_path;
uniform int u_comb;
uniform float u_sigY;
uniform float u_sigC;
uniform float u_delay;
uniform float u_noise;
uniform int u_levels;
uniform int u_frame;
uniform int u_seed;
uniform int u_pal;

vec3 sig(int x, int y) {
  vec3 c = fetch(u_dec, x, y).xyz;
  if (u_osdDec0 == 1) {
    ivec2 sz = textureSize(u_osd0, 0);
    vec4 o = texelFetch(u_osd0, ivec2(clamp(x >> 1, 0, sz.x - 1), clamp(y >> 1, 0, sz.y - 1)), 0);
    c = mix(c, rgbToYcc(o.rgb), o.a);
  }
  if (u_osdDec1 == 1) {
    ivec2 sz = textureSize(u_osd1, 0);
    vec4 o = texelFetch(u_osd1, ivec2(clamp(x >> 1, 0, sz.x - 1), clamp(y >> 1, 0, sz.y - 1)), 0);
    c = mix(c, rgbToYcc(o.rgb), o.a);
  }
  return c;
}

float phaseAt(int x, int y) {
  int fl = y >> 1;
  int p = y & 1;
  if (u_pal == 1) return float(x) * 2.0635449 + float(fl) * 4.712389 + float(p) * 1.5707963 + float(u_frame) * 1.5707963;
  return float(x) * 1.6660082 + float(fl) * PI + float(p) * 1.5707963 + float(u_frame) * PI;
}

float vSwitch(int y) {
  return u_pal == 1 && (((y >> 1) + (y & 1)) & 1) == 1 ? -1.0 : 1.0;
}

float noiseAt(int x, int y, int ch) {
  return u_noise > 0.0 ? u_noise * gaussHash(x + 1024 * y, u_frame * 3 + ch, u_seed + 211) : 0.0;
}

float comp(int x, int y) {
  vec3 c = sig(x, y);
  float ph = phaseAt(x, y);
  return c.x + c.y * sin(ph) + c.z * vSwitch(y) * cos(ph) + noiseAt(x, y, 0);
}

// Luma separated from the composite line.
float ySep(int x, int y) {
  if (u_comb == 3) return 0.5 * comp(x, y) + 0.25 * (comp(x, y - 2) + comp(x, y + 2));
  // Notch: an average over one subcarrier period cancels the carrier.
  float w = u_pal == 1 ? 0.0 : 0.385;
  float e = u_pal == 1 ? 0.523 : 0.0;
  if (u_pal == 1) return (comp(x - 1, y) + comp(x, y) + comp(x + 1, y) + e * (comp(x - 2, y) + comp(x + 2, y))) / (3.0 + 2.0 * e);
  return (w * comp(x - 2, y) + comp(x - 1, y) + comp(x, y) + comp(x + 1, y) + w * comp(x + 2, y)) / (3.0 + 2.0 * w);
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  vec3 out3;
  if (u_path == 0) {
    out3 = sig(P.x, P.y);
  } else {
    int RY = min(int(ceil(3.0 * u_sigY)), 8);
    int RC = min(int(ceil(3.0 * u_sigC)), 12);
    float y = 0.0;
    float wy = 0.0;
    for (int t = -8; t <= 8; t++) {
      if (t < -RY || t > RY) continue;
      float w = u_sigY > 0.05 ? exp(-float(t * t) / (2.0 * u_sigY * u_sigY)) : (t == 0 ? 1.0 : 0.0);
      float v = u_path == 2 ? ySep(P.x + t, P.y) : sig(P.x + t, P.y).x + noiseAt(P.x + t, P.y, 0);
      y += v * w;
      wy += w;
    }
    y /= wy;
    vec2 c = vec2(0.0);
    float wc = 0.0;
    int xc = P.x - int(floor(u_delay + 0.5));
    for (int t = -12; t <= 12; t++) {
      if (t < -RC || t > RC) continue;
      float w = u_sigC > 0.05 ? exp(-float(t * t) / (2.0 * u_sigC * u_sigC)) : (t == 0 ? 1.0 : 0.0);
      int xx = xc + t;
      vec2 v;
      if (u_path == 2) {
        float ch = comp(xx, P.y) - ySep(xx, P.y);
        float ph = phaseAt(xx, P.y);
        v = vec2(2.0 * ch * sin(ph), 2.0 * ch * cos(ph) * vSwitch(P.y));
      } else {
        v = sig(xx, P.y).yz + vec2(noiseAt(xx, P.y, 1), noiseAt(xx, P.y, 2)) * 0.5;
      }
      c += v * w;
      wc += w;
    }
    out3 = vec3(y, c / wc);
  }
  if (u_levels == 1) out3 = vec3((out3.x * 219.0 + 16.0) / 255.0, out3.yz * (224.0 / 255.0));
  fragColor = vec4(out3, 1.0);
}
