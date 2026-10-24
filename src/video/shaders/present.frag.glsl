// The projector and the telecine: light through the film onto video.
//
// Screen pixels are mapped back onto the film through the projector's own
// faults — the strip weaving and tilting in the gate, a splice jumping the
// loop, the framing knob — so here, unlike the camera's registration error,
// grain and dirt move with the picture. Things fixed to the gate rather than
// the film (a hair, a speck of grit) are drawn in screen space and stay put.
//
// When pulldown is on, alternate lines come from the two fields, which may
// show different film frames: that is the 3:2 cadence's combing.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_F0;      // film frame of the first field (density)
uniform sampler2D u_F1;      // film frame of the second field
uniform sampler2D u_src;     // the untouched source, for the split view

uniform vec2 u_outSize;
uniform vec2 u_visMm;
uniform vec2 u_fSizeMm;
uniform vec2 u_apMm;
uniform float u_squeeze;
uniform float u_srcAspect;
uniform float u_fields;      // interlaced pulldown on
uniform float u_lowerFirst;
uniform vec4 u_weave0;       // x mm, y mm, tilt rad, splice jump mm
uniform vec4 u_weave1;
uniform vec2 u_lamp;         // shutter and ripple, per field
uniform float u_framing;

uniform float u_pitch;
uniform float u_stripL;
uniform float u_stripR;
uniform vec4 u_perf;         // w, h, corner radius, per frame
uniform vec2 u_perfX;        // centre of the left and right rows; huge if absent
uniform float u_perfPhase;
uniform vec3 u_unexposed;

uniform float u_focusMm;
uniform float u_buckleMm;
uniform float u_fPixMm;
uniform float u_hotspot;
uniform float u_warmth;
uniform float u_audioDim;

uniform vec2 u_hair[27];
uniform float u_hairW[3];
uniform vec4 u_speck[8];
uniform float u_aspect;

uniform float u_raw;
uniform float u_aim;
uniform float u_tkGamma;
uniform float u_tkGrey;
uniform float u_tkFloor;
uniform float u_tkBlack;
uniform float u_tkSat;

uniform float u_splitX;
uniform float u_dither;
uniform float u_frame;

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

bool inPerf(vec2 p) {
  float yy = p.y / u_pitch - u_perfPhase;
  float j = floor(yy * u_perf.w + 0.5) / u_perf.w;
  float dy = (yy - j) * u_pitch;
  vec2 hs = u_perf.xy * 0.5;
  if (sdRoundRect(vec2(p.x - u_perfX.x, dy), hs, u_perf.z) < 0.0) return true;
  if (sdRoundRect(vec2(p.x - u_perfX.y, dy), hs, u_perf.z) < 0.0) return true;
  return false;
}

// Transmission of the film at a point on the strip.
vec3 transmission(vec2 p, bool second) {
  float k = floor(p.y / u_pitch + 0.5);
  vec2 q = vec2(p.x, p.y - k * u_pitch);
  vec2 uv = q / u_fSizeMm + 0.5;
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    vec3 d = second ? texture(u_F1, uv).rgb : texture(u_F0, uv).rgb;
    return exp2(-d * 3.321928);
  }
  if (p.x < u_stripL || p.x > u_stripR) return vec3(1.0);
  if (inPerf(p)) return vec3(1.0);
  return exp2(-u_unexposed * 3.321928);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 sn = frag / u_outSize - 0.5;

  // Which field this line belongs to. Lines are counted from the top.
  bool second = false;
  if (u_fields > 0.5) {
    float rowFromTop = u_outSize.y - 1.0 - floor(frag.y);
    bool even = mod(rowFromTop, 2.0) < 0.5;
    second = u_lowerFirst > 0.5 ? even : !even;
  }
  vec4 wv = second ? u_weave1 : u_weave0;
  float lampField = second ? u_lamp.y : u_lamp.x;

  // Untouched source on the left of the split.
  if (sn.x + 0.5 < u_splitX) {
    vec2 mm = sn * u_visMm;
    float apWs = u_apMm.x * u_squeeze;
    vec2 sizeMm = u_srcAspect > apWs / u_apMm.y
      ? vec2(u_apMm.y * u_srcAspect, u_apMm.y)
      : vec2(apWs, apWs / u_srcAspect);
    fragColor = vec4(texture(u_src, vec2(mm.x * u_squeeze, mm.y) / sizeMm + 0.5).rgb, 1.0);
    return;
  }

  // Screen to strip: the window, the framing knob, a splice's jump, then the
  // strip's own wander and tilt in the gate.
  vec2 p = sn * u_visMm;
  p.y += u_framing + wv.w;
  p -= wv.xy;
  float c = cos(-wv.z);
  float s = sin(-wv.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);

  float rr2 = (sn.x * sn.x * 4.0 * u_aspect * u_aspect + sn.y * sn.y * 4.0) / (u_aspect * u_aspect + 1.0);

  // Projection focus. The film bows towards the lamp as it heats, so the
  // centre goes soft before the edges.
  float radius = u_focusMm + u_buckleMm * (1.0 - 0.7 * rr2);
  vec3 T;
  if (radius > u_fPixMm * 0.35) {
    T = transmission(p, second) * 0.2;
    float wsum = 0.2;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float r = sqrt((fi + 0.5) / 8.0);
      float th = fi * 2.399963;
      T += transmission(p + vec2(cos(th), sin(th)) * r * radius, second);
      wsum += 1.0;
    }
    T /= wsum;
  } else {
    T = transmission(p, second);
  }

  // The lamp: shutter and ripple, the hot spot, its colour, and the supply
  // sagging on loud passages.
  vec3 tint = u_warmth >= 0.0
    ? mix(vec3(1.0), vec3(1.0, 0.9, 0.72), u_warmth)
    : mix(vec3(1.0), vec3(0.9, 0.96, 1.08), -u_warmth);
  T *= lampField * exp2(-u_hotspot * rr2) * tint * (1.0 - u_audioDim);

  // Grit in the gate: in screen space, still while the film runs past.
  vec2 w = frag / u_outSize;
  vec2 wa = vec2(w.x * u_aspect, w.y);
  float block = 0.0;
  for (int h = 0; h < 3; h++) {
    float hw = u_hairW[h];
    if (hw <= 0.0) continue;
    float d = 1e9;
    for (int k = 0; k < 8; k++) {
      vec2 a = u_hair[h * 9 + k] * vec2(u_aspect, 1.0);
      vec2 b = u_hair[h * 9 + k + 1] * vec2(u_aspect, 1.0);
      d = min(d, segDist(wa, a, b));
    }
    block = max(block, 1.0 - smoothstep(hw * 0.5, hw * 1.3, d));
  }
  for (int k = 0; k < 8; k++) {
    vec4 sp = u_speck[k];
    if (sp.z <= 0.0) continue;
    // Grit is not round: its outline wanders.
    vec2 dv = wa - vec2(sp.x * u_aspect, sp.y);
    float edge = sp.z * (0.65 + 0.7 * vnoise(dv / sp.z * 1.6 + float(k) * 17.0));
    block = max(block, sp.w * (1.0 - smoothstep(edge * 0.7, edge, length(dv))));
  }
  T *= 1.0 - 0.94 * block;

  // The transfer: aim density to mid grey, clear film to white, a straight
  // line in log between them.
  vec3 v;
  if (u_raw > 0.5) {
    v = T * 1.6;
  } else {
    v = u_tkGrey * exp2(u_tkGamma * (log2(max(T, vec3(1e-7))) + u_aim * 3.321928));
    v = (v - u_tkFloor) / (1.0 - u_tkFloor);
  }
  v = u_tkBlack + (1.0 - u_tkBlack) * v;
  float y = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = max(vec3(y) + (v - y) * u_tkSat, 0.0);

  vec3 o = linearToSrgb(v);
  if (u_dither > 0.0) {
    o += (ign(frag + mod(u_frame, 64.0) * 5.588) - 0.5) * u_dither * (1.5 / 255.0);
  }
  fragColor = vec4(o, 1.0);
}
