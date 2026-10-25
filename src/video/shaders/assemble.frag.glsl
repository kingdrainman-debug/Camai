// Tape pass 8 — the decoded frame, with whatever the tape lost concealed.
//
// The luma and chroma planes come back from the inverse DCT (or straight
// from the camera when the codec is bypassed), chroma is filled back out to
// full resolution the way the playback side does it, and then the tape:
//
//   - a macroblock whose DIF blocks were lost is concealed on the macroblock
//     grid — from the previous frame, as most decoders did, or as grey or
//     green blocks. Never a streak: that is VHS.
//   - a clogged head freezes the whole picture and breaks it into blocks;
//   - the first frame of a shot recorded without backspace is garbage;
//   - after the battery died, nothing was recorded at all.
//
// This frame, clean of anything drawn over it later, is what the next frame
// conceals from.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_Y;
uniform sampler2D u_C;
uniform int u_planes;      // 1: Y and C planes from the codec; 0: u_Y is the camera's Y′CbCr frame
uniform int u_subsample;   // chroma subsampled (u_C is the chroma plane)
uniform int u_cx;
uniform int u_cy;
uniform int u_linear;
uniform sampler2D u_lost;
uniform int u_anyLost;
uniform sampler2D u_prev;
uniform int u_hasPrev;
uniform int u_conceal;
uniform float u_clog;
uniform int u_garbage;
uniform int u_dead;
uniform int u_frame;
uniform int u_seed;

vec2 chromaAt(int x, int y) {
  if (u_linear == 0) return texelFetch(u_C, ivec2(x / u_cx, y / u_cy), 0).xy;
  vec2 p = vec2((float(x) + 0.5) / float(u_cx), (float(y) + 0.5) / float(u_cy));
  return bilinear(u_C, p).xy;
}

vec3 decoded(int x, int y) {
  if (u_planes == 1) return vec3(texelFetch(u_Y, ivec2(x, y), 0).x, chromaAt(x, y));
  vec3 c = texelFetch(u_Y, ivec2(x, y), 0).xyz;
  if (u_subsample == 1) c.yz = chromaAt(x, y);
  return c;
}

vec3 substitute(int x, int y, int m) {
  if (u_conceal == 0 && u_hasPrev == 1) return texelFetch(u_prev, ivec2(x, y), 0).xyz;
  if (u_conceal == 2) return vec3(-16.0 / 219.0, -128.0 / 224.0, -128.0 / 224.0);
  return vec3(0.5, 0.0, 0.0);
}

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  if (u_dead == 1) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  int m = lumaOwner(P.x, P.y).x;
  vec3 c;
  if (u_clog >= 0.0) {
    // A clogged head: the last good frame, broken into 16-pixel blocks that
    // slip about as the head reads fragments.
    int bx = P.x >> 4;
    int by = P.y >> 4;
    int frame = u_frame;
    float h = ihash(bx + 97 * by, frame, u_seed + 31);
    ivec2 Q = ivec2(bx * 16 + 8, by * 16 + 8);
    if (h < 0.35) Q += ivec2(int(ihash(bx, by, frame + 7) * 64.0) - 32, int(ihash(by, bx, frame + 11) * 32.0) - 16);
    if (u_hasPrev == 1 && h < 0.85) c = fetch(u_prev, Q.x, Q.y).xyz;
    else c = h < 0.93 ? vec3(0.5, 0.0, 0.0) : vec3(-16.0 / 219.0, -128.0 / 224.0, -128.0 / 224.0);
  } else if (u_garbage == 1 && ihash(m, u_frame, u_seed + 53) < 0.6) {
    c = ihash(m, u_frame, u_seed + 59) < 0.5 ? vec3(0.5, 0.0, 0.0) : vec3(-16.0 / 219.0, -128.0 / 224.0, -128.0 / 224.0);
  } else if (u_anyLost == 1 && texelFetch(u_lost, ivec2(m, 0), 0).x > 0.5) {
    c = substitute(P.x, P.y, m);
  } else {
    c = decoded(P.x, P.y);
  }
  fragColor = vec4(c, 1.0);
}
