// DV codec helpers: the macroblock layout, the scan, and the quantiser
// tables. Mirrors src/cam/dvlayout.ts and src/video/cpu/codec.ts exactly.

uniform int u_system;      // 0: 525/60 4:1:1, 1: 625/50 4:2:0
uniform int u_nMB;

// Top-left luma pixel and shape of macroblock m.
// shape 0: 32×8, 1: 16×16 at the 4:1:1 right edge, 2: 16×16 (4:2:0).
ivec3 mbOrigin(int m) {
  if (u_system == 0) {
    if (m < 1320) return ivec3((m % 22) * 32, (m / 22) * 8, 0);
    return ivec3(704, (m - 1320) * 16, 1);
  }
  return ivec3((m % 45) * 16, (m / 45) * 16, 2);
}

// Plane (0 luma, 1 chroma) and pixel for (i, j) of block b of macroblock m.
ivec3 blockPixel(int m, int b, int i, int j) {
  ivec3 o = mbOrigin(m);
  if (b < 4) {
    if (o.z == 0) return ivec3(0, o.x + b * 8 + i, o.y + j);
    return ivec3(0, o.x + (b & 1) * 8 + i, o.y + (b >> 1) * 8 + j);
  }
  if (o.z == 0) return ivec3(1, o.x / 4 + i, o.y + j);
  if (o.z == 1) return ivec3(1, 176 + (i & 3), o.y + (i >> 2) * 8 + j);
  return ivec3(1, o.x / 2 + i, o.y / 2 + j);
}

// Macroblock, block, i, j of a luma pixel.
ivec4 lumaOwner(int x, int y) {
  if (u_system == 0) {
    if (x < 704) return ivec4((y >> 3) * 22 + (x >> 5), (x & 31) >> 3, x & 7, y & 7);
    int lx = x - 704;
    int ly = y & 15;
    return ivec4(1320 + (y >> 4), (ly >> 3) * 2 + (lx >> 3), lx & 7, ly & 7);
  }
  return ivec4((y >> 4) * 45 + (x >> 4), ((y & 15) >> 3) * 2 + ((x & 15) >> 3), x & 7, y & 7);
}

// Macroblock, i, j of a chroma-plane pixel.
ivec3 chromaOwner(int x, int y) {
  if (u_system == 0) {
    if (x < 176) return ivec3((y >> 3) * 22 + (x >> 3), x & 7, y & 7);
    return ivec3(1320 + (y >> 4), (x - 176) + ((y & 15) >= 8 ? 4 : 0), y & 7);
  }
  return ivec3((y >> 3) * 45 + (x >> 3), x & 7, y & 7);
}

// Where coefficient (u, v) of block b of macroblock m is stored.
ivec2 coefAddr(int m, int b, int u, int v) {
  return ivec2((m % 30) * 48 + b * 8 + u, (m / 30) * 8 + v);
}

// The zigzag scan: position k → (u + 8v).
const int ZIGZAG[64] = int[64](
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63);

// Quantiser shifts by (quantisation number + class offset) and area
// (ff_dv_quant_shifts and ff_dv_quant_offset in FFmpeg's dvdata).
const int SHIFTS[88] = int[88](
  3, 3, 4, 4,  3, 3, 4, 4,  2, 3, 3, 4,  2, 3, 3, 4,
  2, 2, 3, 3,  2, 2, 3, 3,  1, 2, 2, 3,  1, 2, 2, 3,
  1, 1, 2, 2,  1, 1, 2, 2,  0, 1, 1, 2,  0, 1, 1, 2,
  0, 0, 1, 1,  0, 0, 1, 1,  0, 0, 0, 1,  0, 0, 0, 0,
  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,
  0, 0, 0, 0,  0, 0, 0, 0);
const int CLASS_OFFSET[4] = int[4](6, 3, 0, 1);

int areaOf(int k) {
  return k < 6 ? 0 : k < 21 ? 1 : k < 43 ? 2 : 3;
}

uniform float u_qscale;

float stepFor(int q, int cls, int area) {
  int s = SHIFTS[min(q + CLASS_OFFSET[cls], 21) * 4 + area] + (cls == 3 ? 1 : 0);
  return exp2(float(s)) * u_qscale;
}

// DV's coefficient weighting (IEC 61834, the 8-8 table): higher frequencies
// are scaled down before quantisation, so they are quantised more coarsely.
const float DV_W[8] = float[8](1.0, 0.9807, 0.9239, 0.9, 0.875, 0.8504, 0.7654, 0.7210);

float dvWeight(int u, int v) {
  return DV_W[u] * DV_W[v];
}

// Quantised amplitude, with a dead zone as encoders use.
float quantLevel(float c, float step) {
  return floor(abs(c) / step + 0.35);
}

// Approximate length of DV's (run, amplitude) variable-length code with its
// sign bit: short for small amplitudes after short runs, an escape beyond.
// Calibrated against FFmpeg's dvvideo encoder; see the smoke test.
float vlcBits(float run, float amp) {
  float a = amp < 23.0 ? 2.0 + 1.7 * log2(amp) : 16.0;
  float r = run < 0.5 ? 0.0 : (run < 62.0 ? 1.6 + 1.5 * log2(run) : 13.0);
  return min(a + r, 24.0) + 1.0;
}

// When a segment does not fit even at the coarsest quantiser, DV codes as
// much of each block's scan as fits and the rest is lost: the highest
// frequencies go first. These are the scan cut-offs the rate control tries,
// coarsest quantiser, from the full scan down.
const int CUTS[8] = int[8](48, 36, 28, 21, 15, 10, 6, 3);

// Quantiser and scan cut-off for a row of the cost table: rows 0–15 are the
// quantisation numbers with the whole scan, rows 16–23 the cut-offs at 0.
ivec2 costRow(int row) {
  if (row < 16) return ivec2(row, 64);
  return ivec2(0, CUTS[row - 16]);
}
