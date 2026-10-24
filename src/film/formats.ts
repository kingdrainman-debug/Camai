/**
 * Film formats.
 *
 * A gauge is a physical object: a strip of a given width with holes punched in
 * it at a given pitch, and a camera aperture of a given size exposed between
 * them. Almost everything that makes one format look different from another
 * follows from those few millimetres, so they are recorded here once and
 * everything else is derived from them:
 *
 *   - grain:      the same emulsion is enlarged more from a smaller frame
 *   - halation:   the halo is a fixed distance on the film, so a larger
 *                 fraction of a small frame
 *   - weave:      registration error is measured in micrometres of film
 *   - lens:       resolving power is in line pairs per millimetre of film
 *   - dirt:       a speck of dust is the same size whatever it lands on
 *
 * Dimensions are camera apertures from the SMPTE / Kodak references, rounded
 * to the precision those documents quote. Perforation positions are
 * simplified: they are drawn where they sit relative to the frame, which is
 * what an overscan transfer shows, not to the tolerance of a print.
 */

export type GaugeId = 'reg8' | 'super8' | 'mm16' | 'super16' | 'mm35' | 'super35' | 'mm65';

export interface Perforation {
  /** Perforation width and height, mm. */
  w: number;
  h: number;
  /** Perforations per frame on each perforated edge. */
  perFrame: number;
  /** Which edges are perforated. */
  sides: 'left' | 'both';
  /** Vertical position of the first perforation's centre relative to the frame centre, in frame pitches. */
  phase: number;
  /** Corner radius of the hole, mm. */
  radius: number;
}

export interface Gauge {
  id: GaugeId;
  label: string;
  /** Camera aperture, mm. */
  width: number;
  height: number;
  /** Distance from one frame to the next, mm. */
  pitch: number;
  /** Width of the film strip, mm. */
  filmWidth: number;
  /** Horizontal offset of the frame centre from the strip centre, mm (positive = right). */
  frameOffset: number;
  /** Corner radius of the camera gate, mm. Small gates were filed round. */
  gateRadius: number;
  perf: Perforation;
  /** Native camera speed, frames per second. */
  fps: number;
  /** Frames on one load: a cartridge, a daylight spool or a magazine. */
  rollFrames: number;
  /** Base thickness, µm — sets the halation radius. */
  baseThickness: number;
  /** What a load was, for the help text. */
  rollNote: string;
}

export const GAUGES: Record<GaugeId, Gauge> = {
  reg8: {
    id: 'reg8',
    label: 'Regular 8 (Double 8)',
    width: 4.5,
    height: 3.3,
    pitch: 3.81,
    filmWidth: 8,
    frameOffset: 0.9,
    gateRadius: 0.35,
    // Regular 8 is 16 mm film perforated at twice the rate and split after
    // processing, so its holes are 16 mm holes sitting on the frame line.
    perf: { w: 1.83, h: 1.27, perFrame: 1, sides: 'left', phase: 0.5, radius: 0.25 },
    fps: 16,
    rollFrames: 4000,
    baseThickness: 135,
    rollNote: 'a 25 ft spool run through the camera twice — 4,000 frames, a little over four minutes at 16 fps',
  },
  super8: {
    id: 'super8',
    label: 'Super 8',
    width: 5.79,
    height: 4.01,
    pitch: 4.234,
    filmWidth: 8,
    frameOffset: 0.55,
    gateRadius: 0.3,
    // Smaller holes than Regular 8, which is where the bigger frame came from.
    // The hole sits alongside the frame rather than on the frame line.
    perf: { w: 0.91, h: 1.14, perFrame: 1, sides: 'left', phase: 0, radius: 0.13 },
    fps: 18,
    rollFrames: 3600,
    baseThickness: 135,
    rollNote: 'a 50 ft cartridge — 3,600 frames, three minutes twenty at 18 fps',
  },
  mm16: {
    id: 'mm16',
    label: '16 mm',
    width: 10.26,
    height: 7.49,
    pitch: 7.62,
    filmWidth: 16,
    frameOffset: 0.6,
    gateRadius: 0.25,
    perf: { w: 1.83, h: 1.27, perFrame: 1, sides: 'left', phase: 0.5, radius: 0.25 },
    fps: 24,
    rollFrames: 4000,
    baseThickness: 135,
    rollNote: 'a 100 ft daylight spool — 4,000 frames, two minutes forty-seven at 24 fps',
  },
  super16: {
    id: 'super16',
    label: 'Super 16',
    width: 12.52,
    height: 7.41,
    pitch: 7.62,
    filmWidth: 16,
    frameOffset: 1.3,
    gateRadius: 0.2,
    perf: { w: 1.83, h: 1.27, perFrame: 1, sides: 'left', phase: 0.5, radius: 0.25 },
    fps: 24,
    rollFrames: 16000,
    baseThickness: 135,
    rollNote: 'a 400 ft magazine — 16,000 frames, eleven minutes at 24 fps',
  },
  mm35: {
    id: 'mm35',
    label: '35 mm Academy',
    width: 22.0,
    height: 16.0,
    pitch: 19.0,
    filmWidth: 35,
    frameOffset: 1.2,
    gateRadius: 0.4,
    perf: { w: 2.8, h: 1.98, perFrame: 4, sides: 'both', phase: -0.375, radius: 0.5 },
    fps: 24,
    rollFrames: 16000,
    baseThickness: 140,
    rollNote: 'a 1,000 ft magazine — 16,000 frames, eleven minutes at 24 fps',
  },
  super35: {
    id: 'super35',
    label: 'Super 35 (full aperture)',
    width: 24.89,
    height: 18.66,
    pitch: 19.0,
    filmWidth: 35,
    frameOffset: 0,
    gateRadius: 0.4,
    perf: { w: 2.8, h: 1.98, perFrame: 4, sides: 'both', phase: -0.375, radius: 0.5 },
    fps: 24,
    rollFrames: 16000,
    baseThickness: 140,
    rollNote: 'a 1,000 ft magazine — 16,000 frames, eleven minutes at 24 fps',
  },
  mm65: {
    id: 'mm65',
    label: '65 mm (5-perf)',
    width: 52.48,
    height: 23.01,
    pitch: 23.75,
    filmWidth: 65,
    frameOffset: 0,
    gateRadius: 0.6,
    perf: { w: 2.8, h: 1.98, perFrame: 5, sides: 'both', phase: -0.4, radius: 0.5 },
    fps: 24,
    rollFrames: 12800,
    baseThickness: 140,
    rollNote: 'a 1,000 ft magazine — 12,800 frames, under nine minutes at 24 fps',
  },
};

export const GAUGE_IDS = Object.keys(GAUGES) as GaugeId[];

export function gauge(id: string): Gauge {
  return GAUGES[id as GaugeId] ?? GAUGES.super8;
}

/** Aspect ratio of the camera aperture. */
export function gateAspect(g: Gauge, squeeze = 1): number {
  return (g.width * squeeze) / g.height;
}
