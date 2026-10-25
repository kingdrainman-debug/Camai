// The camera: scene light through the lens onto the film plane.
//
// Output is linear exposure at the film, in units where a correctly exposed
// 18% grey card is 0.18, before the frame's own exposure error (flicker, a
// camera start) is applied — that happens in the film pass, per frame.
//
// The buffer covers the camera aperture plus a small margin, in film
// millimetres, so that the camera's registration error can move the image
// within it without dragging in an edge.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2 u_eSizeMm;     // aperture plus margin, film mm
uniform vec2 u_apMm;        // camera aperture, film mm
uniform float u_squeeze;    // anamorphic squeeze
uniform float u_srcAspect;
uniform float u_halfDiag;   // half the aperture diagonal, mm
uniform float u_sigmaMm;    // combined lens and emulsion blur, mm on film
uniform float u_srcPxMm;    // one source pixel, in film mm
uniform float u_corner;
uniform float u_vignette;   // stops lost at the corner
uniform float u_ca;         // lateral colour, as a fraction of the half diagonal
uniform float u_distortion;
uniform float u_headroom;   // stops of highlight above source white

vec3 srgbToLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

// Film millimetres (after distortion) to a source texture coordinate. The
// source fills the aperture the way a camera framed it: covering it, cropping
// whichever dimension overhangs.
vec2 sourceUV(vec2 mm) {
  float apWs = u_apMm.x * u_squeeze;
  vec2 sizeMm = u_srcAspect > apWs / u_apMm.y
    ? vec2(u_apMm.y * u_srcAspect, u_apMm.y)
    : vec2(apWs, apWs / u_srcAspect);
  return vec2(mm.x * u_squeeze, mm.y) / sizeMm + 0.5;
}

// Scene light from one source sample. The source is display-referred and
// clipped at white; the scene it shows was not. Highlights are expanded back
// out so that the film's shoulder and the halation have something above white
// to work with, by an amount that is negligible below about 60% grey.
vec3 sceneAt(vec2 mm) {
  vec3 c = srgbToLinear(texture(u_src, sourceUV(mm)).rgb);
  float m = max(c.r, max(c.g, c.b));
  float m2 = m * m;
  return c * exp2(u_headroom * m2 * m2);
}

void main() {
  vec2 mm = (v_uv - 0.5) * u_eSizeMm;
  vec2 pr = mm / u_halfDiag;
  float r2 = dot(pr, pr);
  vec2 dmm = mm * (1.0 + u_distortion * r2);

  float sigma = u_sigmaMm * (1.0 + u_corner * r2);
  // Below about a third of a source pixel the blur cannot be seen, and one
  // tap is exact.
  bool blur = sigma > u_srcPxMm * 0.33;
  bool fringe = u_ca > 1e-6;

  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 off = vec2(0.0);
    float w = 1.0;
    if (blur) {
      float fi = float(i);
      float rr = sqrt((fi + 0.5) / 12.0);
      float th = fi * 2.399963;
      off = vec2(cos(th), sin(th)) * rr * 2.0 * sigma;
      w = exp(-2.0 * rr * rr);
    }
    vec3 c;
    if (fringe) {
      c.r = sceneAt(dmm * (1.0 + u_ca) + off).r;
      c.g = sceneAt(dmm + off).g;
      c.b = sceneAt(dmm * (1.0 - u_ca) + off).b;
    } else {
      c = sceneAt(dmm + off);
    }
    sum += c * w;
    wsum += w;
    if (!blur) break;
  }
  vec3 e = sum / wsum;

  // Natural vignetting, in stops at the corner.
  e *= exp2(-u_vignette * r2);
  fragColor = vec4(e, 1.0);
}
