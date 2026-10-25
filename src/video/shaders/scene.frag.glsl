// Camera pass 1 — the light at the focal plane, for one field.
//
// The source is the world. For each pixel of the DV raster this finds where
// the camera was pointing (the operator's hand, the zoom, the stabiliser's
// crop), bends it through the lens (distortion, an adapter, lateral colour),
// and integrates it over the shutter: the view is sampled at several moments
// across the exposure, so shake during a slow or even a normal shutter is a
// real smear — which the stabiliser, moving the crop afterwards, cannot take
// out. On a rolling-shutter sensor each row has its own moment.
//
// Light here is linear and in charge units: 1.0 is the charge reference white
// produces at 0 dB.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src0;
uniform sampler2D u_src1;
uniform sampler2D u_src2;
uniform sampler2D u_src3;
uniform int u_taps;
uniform int u_tapSrc[4];
uniform int u_rows;
uniform vec4 u_view[32];
uniform vec2 u_raster;     // W, H
uniform float u_aspect;    // picture aspect, 4:3 or 16:9
uniform vec2 u_fit;        // source uv per picture unit at zoom 1
uniform vec2 u_dist;       // k1, k2
uniform float u_ca;        // lateral colour: radial scale error at the corner
uniform float u_vignette;  // stops at the corner
uniform float u_circle;    // fisheye image circle radius, picture units; 0 for none
uniform float u_headroom;  // stops of highlight above the source's clip
uniform vec3 u_light;
uniform vec3 u_veil;
uniform float u_ir;
uniform float u_irSpot;
uniform float u_eyes;

vec3 sampleTap(int k, vec2 uv) {
  int i = u_tapSrc[k];
  vec2 p;
  vec3 c;
  if (i == 0) { p = uv * vec2(textureSize(u_src0, 0)); c = bilinearMirror(u_src0, p).rgb; }
  else if (i == 1) { p = uv * vec2(textureSize(u_src1, 0)); c = bilinearMirror(u_src1, p).rgb; }
  else if (i == 2) { p = uv * vec2(textureSize(u_src2, 0)); c = bilinearMirror(u_src2, p).rgb; }
  else { p = uv * vec2(textureSize(u_src3, 0)); c = bilinearMirror(u_src3, p).rgb; }
  return c;
}

vec4 viewAt(int k, float y) {
  if (u_rows <= 1) return u_view[k];
  float f = clamp((y + 0.5) / u_raster.y, 0.0, 1.0) * float(u_rows - 1);
  int i0 = int(floor(f));
  int i1 = min(i0 + 1, u_rows - 1);
  return mix(u_view[i0 * 4 + k], u_view[i1 * 4 + k], f - float(i0));
}

// Linear light of one source sample, with the clipped highlights opened up.
vec3 decode(vec3 s) {
  vec3 lin = srgbToLinear3(s);
  float m = max(lin.r, max(lin.g, lin.b));
  float t = clamp((m - 0.95) / 0.05, 0.0, 1.0);
  return lin * exp2(u_headroom * t * t * (3.0 - 2.0 * t));
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  float rc = length(vec2(u_aspect * 0.5, 0.5));
  vec3 acc = vec3(0.0);
  float ir = 0.0;
  int subs = u_taps == 1 ? 4 : 1;
  float r0 = 0.0;
  for (int k = 0; k < 4; k++) {
    if (k >= u_taps) break;
    for (int j = 0; j < 4; j++) {
      if (j >= subs) break;
      vec2 off = subs == 1 ? vec2(0.5) : vec2(j == 0 || j == 2 ? 0.25 : 0.75, j < 2 ? 0.25 : 0.75);
      vec2 pix = vec2(P) + off;
      vec2 q = vec2((pix.x - u_raster.x * 0.5) / 704.0 * u_aspect, (pix.y - u_raster.y * 0.5) / u_raster.y);
      float rq = length(q) / rc;
      r0 = rq;
      vec4 view = viewAt(k, pix.y);
      float cr = cos(view.z);
      float sr = sin(view.z);
      vec2 qr = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y);
      float rho2 = dot(qr, qr) / (rc * rc);
      float d = (1.0 + u_dist.x * rho2 + u_dist.y * rho2 * rho2) / (1.0 + u_dist.x + u_dist.y);
      vec2 qd = qr * d;
      vec2 scale = u_fit / view.w;
      vec2 uvG = view.xy + qd * scale;
      vec2 uvR = view.xy + qd * (1.0 + u_ca * rho2) * scale;
      vec2 uvB = view.xy + qd * (1.0 - u_ca * rho2) * scale;
      vec3 c;
      c.r = decode(sampleTap(k, uvR)).r;
      c.g = decode(sampleTap(k, uvG)).g;
      c.b = decode(sampleTap(k, uvB)).b;
      acc += c;
      ir += dot(c, vec3(0.55, 0.35, 0.1));
    }
  }
  float nS = float(u_taps * subs);
  acc /= nS;
  ir /= nS;

  float vig = exp2(-u_vignette * r0 * r0);
  vec3 light = acc * u_light * vig + u_veil;
  // The camera's own infrared lamp: a beam from beside the lens, brightest in
  // the middle, seen by every colour filter alike.
  if (u_ir > 0.0) {
    float spot = exp(-(r0 * r0) / (2.0 * u_irSpot * u_irSpot));
    // Retro-reflectors — eyes above all — send the lamp straight back.
    float shine = 1.0 + u_eyes * 6.0 * clamp((ir - 0.55) / 0.35, 0.0, 1.0);
    light += vec3(u_ir * spot * ir * shine);
  }
  if (u_circle > 0.0) {
    vec2 pix = vec2(P) + 0.5;
    vec2 q = vec2((pix.x - u_raster.x * 0.5) / 704.0 * u_aspect, (pix.y - u_raster.y * 0.5) / u_raster.y);
    float r = length(q);
    light *= 1.0 - clamp((r - u_circle) / 0.012 + 0.5, 0.0, 1.0);
  }
  fragColor = vec4(light, 1.0);
}
