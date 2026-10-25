/**
 * The geometry of a DV frame: macroblocks, superblocks and video segments.
 *
 * DV codes a frame as 8×8 DCT blocks grouped into macroblocks of four luma
 * blocks and one block each of Cb and Cr. In 525/60 4:1:1 a macroblock is
 * 32×8 luma pixels (the chroma plane is a quarter as wide), except down the
 * right-hand edge, where 720 does not divide by 32 and the last 16 columns are
 * coded as 16×16 macroblocks whose 4-wide chroma is folded into 8×8 blocks.
 * In 625/50 4:2:0 a macroblock is 16×16.
 *
 * The bit budget is not per macroblock but per video segment of five, and the
 * five are taken from five different places in the frame — one from each
 * superblock column, in superblock rows spread down the picture (IEC 61834:
 * rows i+2, i+6, i+8, i, i+4 for columns 2, 1, 3, 0, 4). A busy area therefore
 * borrows bits from four unrelated places, which is why DV quality is fairly
 * even across a frame, and why it gets worse everywhere at once.
 *
 * The superblock partition here follows the standard's shape — bands of 135
 * macroblocks, five columns of 27 — but the order of macroblocks inside a
 * superblock is a simple one rather than the standard's serpentine. Nothing
 * visible depends on that order; what matters is that a segment's five
 * macroblocks are far apart, and they are.
 */

export interface DvLayout {
  system: 0 | 1;
  /** Luma raster. */
  W: number;
  H: number;
  /** Chroma plane. */
  CW: number;
  CH: number;
  /** Chroma subsampling in each direction. */
  cx: number;
  cy: number;
  nMB: number;
  mbX0: Int32Array;
  mbY0: Int32Array;
  /** 0: 32×8 (4:1:1), 1: 16×16 edge (4:1:1, folded chroma), 2: 16×16 (4:2:0). */
  mbShape: Int32Array;
  nSeg: number;
  /** Segment of each macroblock, shuffled. */
  segOfMB: Int32Array;
  /** Five macroblocks per segment, shuffled. */
  segMBs: Int32Array;
  /** The same without the shuffle: five raster neighbours. */
  segOfMBPlain: Int32Array;
  segMBsPlain: Int32Array;
  /** DIF sequences (tracks) per frame; 27 segments each. */
  tracks: number;
  /** Coefficient storage: macroblock tiles of 48×8 (six blocks side by side). */
  tilesX: number;
  coefW: number;
  coefH: number;
}

const cache: Record<number, DvLayout> = {};

export function dvLayout(system: number): DvLayout {
  const sys = system === 1 ? 1 : 0;
  if (cache[sys]) return cache[sys];

  const W = 720;
  const H = sys === 0 ? 480 : 576;
  const mbs: { x0: number; y0: number; shape: number }[] = [];
  if (sys === 0) {
    for (let r = 0; r < 60; r++) for (let c = 0; c < 22; c++) mbs.push({ x0: c * 32, y0: r * 8, shape: 0 });
    for (let r = 0; r < 30; r++) mbs.push({ x0: 704, y0: r * 16, shape: 1 });
  } else {
    for (let r = 0; r < 36; r++) for (let c = 0; c < 45; c++) mbs.push({ x0: c * 16, y0: r * 16, shape: 2 });
  }
  const nMB = mbs.length;
  const nBands = sys === 0 ? 10 : 12;
  const bandH = 48;

  // Superblocks: each band of 48 lines is 135 macroblocks; split it into five
  // columns of 27 by horizontal position.
  const sb: number[][][] = [];
  for (let b = 0; b < nBands; b++) {
    const inBand = mbs
      .map((m, i) => ({ i, cx: m.x0 + (m.shape === 0 ? 16 : 8), cy: m.y0 }))
      .filter((m) => m.cy >= b * bandH && m.cy < (b + 1) * bandH)
      .sort((a, c) => a.cx - c.cx || a.cy - c.cy);
    if (inBand.length !== 135) throw new Error(`DV band ${b} has ${inBand.length} macroblocks, not 135`);
    const cols: number[][] = [];
    for (let c = 0; c < 5; c++) {
      const col = inBand.slice(c * 27, (c + 1) * 27).sort((a, d) => a.cy - d.cy || a.cx - d.cx);
      cols.push(col.map((m) => m.i));
    }
    sb.push(cols);
  }

  const nSeg = nBands * 27;
  const segMBs = new Int32Array(nSeg * 5);
  const segOfMB = new Int32Array(nMB).fill(-1);
  const order: [number, number][] = [[2, 2], [6, 1], [8, 3], [0, 0], [4, 4]];
  for (let i = 0; i < nBands; i++) {
    for (let k = 0; k < 27; k++) {
      const s = i * 27 + k;
      order.forEach(([dr, col], j) => {
        const m = sb[(i + dr) % nBands][col][k];
        segMBs[s * 5 + j] = m;
        segOfMB[m] = s;
      });
    }
  }
  if (segOfMB.some((s) => s < 0)) throw new Error('DV shuffle left a macroblock without a segment');

  const segMBsPlain = new Int32Array(nSeg * 5);
  const segOfMBPlain = new Int32Array(nMB);
  for (let m = 0; m < nMB; m++) {
    segMBsPlain[m] = m;
    segOfMBPlain[m] = Math.floor(m / 5);
  }

  const tilesX = 30;
  const layout: DvLayout = {
    system: sys,
    W,
    H,
    CW: sys === 0 ? 180 : 360,
    CH: sys === 0 ? 480 : 288,
    cx: sys === 0 ? 4 : 2,
    cy: sys === 0 ? 1 : 2,
    nMB,
    mbX0: Int32Array.from(mbs.map((m) => m.x0)),
    mbY0: Int32Array.from(mbs.map((m) => m.y0)),
    mbShape: Int32Array.from(mbs.map((m) => m.shape)),
    nSeg,
    segOfMB,
    segMBs,
    segOfMBPlain,
    segMBsPlain,
    tracks: nBands,
    tilesX,
    coefW: tilesX * 48,
    coefH: Math.ceil(nMB / tilesX) * 8,
  };
  cache[sys] = layout;
  return layout;
}

/**
 * Where coefficient (u, v) of block b of macroblock m reads its pixel (i, j)
 * from: plane 0 is luma, 1 is chroma. Mirrored exactly by blockPixel() in
 * codec.glsl, because the 8×8 grid must start on the same pixel in both
 * backends or the codec is wrong everywhere.
 */
export function blockPixel(L: DvLayout, m: number, b: number, i: number, j: number): [number, number, number] {
  const x0 = L.mbX0[m];
  const y0 = L.mbY0[m];
  const shape = L.mbShape[m];
  if (b < 4) {
    if (shape === 0) return [0, x0 + b * 8 + i, y0 + j];
    return [0, x0 + (b & 1) * 8 + i, y0 + (b >> 1) * 8 + j];
  }
  if (shape === 0) return [1, x0 / 4 + i, y0 + j];
  if (shape === 1) return [1, 176 + (i & 3), y0 + (i >> 2) * 8 + j];
  return [1, x0 / 2 + i, y0 / 2 + j];
}

/** The macroblock, block and in-block position a luma pixel belongs to. */
export function lumaOwner(L: DvLayout, x: number, y: number): [number, number, number, number] {
  if (L.system === 0) {
    if (x < 704) {
      const m = (y >> 3) * 22 + (x >> 5);
      return [m, (x & 31) >> 3, x & 7, y & 7];
    }
    const m = 1320 + (y >> 4);
    const lx = x - 704;
    const ly = y & 15;
    return [m, (ly >> 3) * 2 + (lx >> 3), lx & 7, ly & 7];
  }
  const m = (y >> 4) * 45 + (x >> 4);
  return [m, ((y & 15) >> 3) * 2 + ((x & 15) >> 3), x & 7, y & 7];
}

/** The macroblock and in-block position a chroma-plane pixel belongs to. */
export function chromaOwner(L: DvLayout, x: number, y: number): [number, number, number] {
  if (L.system === 0) {
    if (x < 176) return [(y >> 3) * 22 + (x >> 3), x & 7, y & 7];
    const m = 1320 + (y >> 4);
    return [m, (x - 176) + ((y & 15) >= 8 ? 4 : 0), y & 7];
  }
  return [(y >> 3) * 45 + (x >> 3), x & 7, y & 7];
}
