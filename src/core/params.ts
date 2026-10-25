/**
 * FILMBOX parameter schema.
 *
 * This file is the single source of truth for the whole application. The
 * settings panel, the shader uniforms, the Web Audio graph, the preset format,
 * the CLI flags, the randomiser and the keyframe timeline are all generated
 * from it, so a parameter only ever has to be described once.
 *
 * Settings themselves are a flat `Record<dottedKey, number | boolean | string>`
 * which makes presets trivially diffable and hand-editable.
 *
 * The groups follow the chain a piece of film actually travels: light through
 * a lens onto an emulsion (Lens, Stock), through a camera and a projector or a
 * telecine (Gate), and then out through a soundtrack and a loudspeaker
 * (Sound). Where a quantity is physical — a weave in micrometres of film, a
 * lens in line pairs per millimetre — it is specified in those units and the
 * format converts it, so that the same camera looks worse on Super 8 than on
 * 35 mm for the reason it really did.
 */

import { GAUGES, GAUGE_IDS } from '../film/formats';
import { PRINT_STOCKS, STOCKS } from '../film/stocks';

export type ParamValue = number | boolean | string;

export interface ParamCommon {
  /** Dotted key, e.g. `grain.amount`. Unique across the whole schema. */
  key: string;
  label: string;
  /** Shown in the panel as a tooltip; also used to generate the docs. */
  hint?: string;
  /** Hide unless the user has switched on "Advanced parameters". */
  advanced?: boolean;
}

export interface FloatParam extends ParamCommon {
  type: 'float';
  min: number;
  max: number;
  step: number;
  def: number;
  unit?: string;
  /** Slider travels logarithmically (frequencies, times). */
  log?: boolean;
  /** Excluded from the randomiser (framing, output levels, …). */
  noRandom?: boolean;
}

export interface IntParam extends ParamCommon {
  type: 'int';
  min: number;
  max: number;
  def: number;
  unit?: string;
  noRandom?: boolean;
}

export interface BoolParam extends ParamCommon {
  type: 'bool';
  def: boolean;
  noRandom?: boolean;
}

export interface EnumOption {
  value: string;
  label: string;
  /** Numeric value handed to shaders / DSP. Defaults to the option index. */
  code?: number;
  hint?: string;
}

export interface EnumParam extends ParamCommon {
  type: 'enum';
  options: EnumOption[];
  def: string;
  noRandom?: boolean;
}

export type Param = FloatParam | IntParam | BoolParam | EnumParam;

export type GroupKind = 'global' | 'stock' | 'lens' | 'gate' | 'audio' | 'link';

export interface Group {
  id: string;
  label: string;
  /** Which tab the group lives in. 'global' groups are never drawn as a tab. */
  kind: GroupKind;
  hint?: string;
  /** Key of the bool param that arms/disarms the whole group. */
  enableKey?: string;
  /** Collapsed on first run. */
  collapsed?: boolean;
  params: Param[];
}

export type Settings = Record<string, ParamValue>;

/* ------------------------------------------------------------------ *
 * Shared enum vocabularies
 * ------------------------------------------------------------------ */

const GAUGE_OPTIONS: EnumOption[] = GAUGE_IDS.map((id, i) => ({
  value: id,
  label: GAUGES[id].label,
  code: i,
  hint: `${GAUGES[id].width} × ${GAUGES[id].height} mm, ${GAUGES[id].fps} fps native.`,
}));

const STOCK_OPTIONS: EnumOption[] = STOCKS.map((s, i) => ({
  value: s.id,
  label: s.label,
  code: i,
  hint: s.note,
}));

const PRINT_OPTIONS: EnumOption[] = PRINT_STOCKS.map((s, i) => ({
  value: s.id,
  label: s.label,
  code: i,
  hint: s.note,
}));

const CAMERA_SPEEDS: EnumOption[] = [
  { value: 'native', label: 'Native for the gauge', code: 0, hint: '16 fps for Regular 8, 18 for Super 8, 24 for everything else.' },
  { value: '12', label: '12 fps', code: 12 },
  { value: '16', label: '16 fps (silent)', code: 16 },
  { value: '18', label: '18 fps (Super 8)', code: 18 },
  { value: '24', label: '24 fps (sound)', code: 24 },
  { value: '25', label: '25 fps (PAL television)', code: 25 },
];

const PROJECTOR_SPEEDS: EnumOption[] = [
  { value: 'match', label: 'Same as the camera', code: 0 },
  { value: '16', label: '16 fps', code: 16 },
  { value: '18', label: '18 fps', code: 18 },
  { value: '24', label: '24 fps', code: 24 },
  { value: '25', label: '25 fps', code: 25 },
];

const OUTPUT_RATES: EnumOption[] = [
  { value: 'film', label: 'Film rate (one frame per frame)', code: 0 },
  { value: '23.976', label: '23.976', code: 1 },
  { value: '24', label: '24', code: 2 },
  { value: '25', label: '25 (PAL)', code: 3 },
  { value: '29.97', label: '29.97 (NTSC)', code: 4 },
  { value: '30', label: '30', code: 5 },
  { value: '50', label: '50', code: 6 },
  { value: '59.94', label: '59.94', code: 7 },
];

const ASPECTS: EnumOption[] = [
  { value: 'gate', label: 'Full camera gate', code: 0, hint: 'Whatever shape the format’s aperture is: 1.44 for Super 8, 1.37 for 16 mm, 1.69 for Super 16.' },
  { value: '1.33', label: '1.33 (4:3)', code: 1 },
  { value: '1.37', label: '1.37 Academy', code: 2 },
  { value: '1.66', label: '1.66 European', code: 3 },
  { value: '1.78', label: '1.78 (16:9)', code: 4 },
  { value: '1.85', label: '1.85 American', code: 5 },
  { value: '2.39', label: '2.39 Scope', code: 6 },
  { value: 'source', label: 'Match source', code: 7 },
];

const PROCESSES: EnumOption[] = [
  { value: 'print', label: 'Contact print', code: 0, hint: 'Printed onto print stock through the printer lights, as every release print was. The print’s own curve is where most of the film look comes from.' },
  { value: 'scan', label: 'Scanned negative', code: 1, hint: 'The negative scanned and inverted digitally — the modern route. Flatter, with all of the negative’s latitude and none of the print’s roll-off.' },
  { value: 'raw', label: 'The negative itself', code: 2, hint: 'Show the developed negative as it sits on a light box: inverted, and orange from its mask.' },
];

const LIGHTS: EnumOption[] = [
  { value: 'matched', label: 'Matched to the stock', code: 0, hint: 'The footage is treated as lit for the stock, so no cast.' },
  { value: 'daylight', label: 'Daylight (5500 K)', code: 1 },
  { value: 'tungsten', label: 'Tungsten (3200 K)', code: 2 },
  { value: 'overcast', label: 'Overcast / shade (7500 K)', code: 3 },
  { value: 'fluorescent', label: 'Fluorescent tube', code: 4, hint: 'A spiky spectrum film never liked: everything goes green.' },
];

const STORAGE: EnumOption[] = [
  { value: 'vault', label: 'Cold vault (−5 °C)', code: 0 },
  { value: 'cool', label: 'Cool cupboard', code: 1 },
  { value: 'room', label: 'Room temperature', code: 2 },
  { value: 'warm', label: 'Warm and humid', code: 3 },
  { value: 'loft', label: 'A loft that bakes every summer', code: 4 },
];

const BLADES: EnumOption[] = [
  { value: '0', label: 'None — direct transfer', code: 0, hint: 'A telecine or scanner. Continuous light, no shutter to beat against.' },
  { value: '2', label: 'Two-blade shutter', code: 2 },
  { value: '3', label: 'Three-blade shutter', code: 3, hint: 'What most 8 mm and 16 mm projectors used, to push flicker above what the eye notices at 16–18 fps.' },
];

const MAINS: EnumOption[] = [
  { value: '50', label: '50 Hz', code: 50 },
  { value: '60', label: '60 Hz', code: 60 },
];

const FIELD_ORDERS: EnumOption[] = [
  { value: 'upper', label: 'Upper field first', code: 0 },
  { value: 'lower', label: 'Lower field first', code: 1 },
];

const SPLICE_KINDS: EnumOption[] = [
  { value: 'tape', label: 'Tape splice', code: 0, hint: 'Clear tape across the join. Its edges show for a frame either side and the frames under it go hazy.' },
  { value: 'cement', label: 'Cement splice', code: 1, hint: 'Overlapped and welded. A thin line at the frame line and a frame that is slightly denser.' },
];

const TRACK_TYPES: EnumOption[] = [
  { value: 'magnetic', label: 'Magnetic stripe', code: 0, hint: 'A narrow stripe of oxide along the edge of the film. Super 8 sound.' },
  { value: 'optical-va', label: 'Optical, variable area', code: 1, hint: 'A wiggling clear line photographed beside the picture. The cinema standard.' },
  { value: 'optical-vd', label: 'Optical, variable density', code: 2, hint: 'A band of varying grey. Older; distorts through the film’s own curve.' },
  { value: 'silent', label: 'Silent film', code: 3, hint: 'No soundtrack at all — just the projector in the room.' },
];

const CHANNEL_MODES: EnumOption[] = [
  { value: 'mono', label: 'Mono (L+R)', code: 1, hint: 'A film soundtrack is one channel. This is what any projector would have played.' },
  { value: 'stereo', label: 'Stereo', code: 0 },
  { value: 'left', label: 'Left only', code: 2 },
  { value: 'right', label: 'Right only', code: 3 },
];

const PLAYBACK_CURVES: EnumOption[] = [
  { value: 'flat', label: 'Flat', code: 0 },
  { value: 'academy', label: 'Academy curve', code: 1, hint: 'The deliberate treble roll-off cinema playback applied from 1938 into the 1970s, to hide the hiss of the optical track.' },
  { value: 'projector', label: 'Home projector amp', code: 2, hint: 'A small sound projector’s amplifier: narrow, mid-forward, built to be heard over its own motor.' },
];

const SATURATION_MODELS: EnumOption[] = [
  { value: 'valve', label: 'Valve', code: 0, hint: 'Soft, even-harmonic. A cinema amplifier before the 1970s.' },
  { value: 'transistor', label: 'Transistor', code: 1, hint: 'Harder and odd-harmonic. A home projector from the 1970s on.' },
];

/* ------------------------------------------------------------------ *
 * Engine masters
 *
 * One switch per engine. Each section already has its own bypass, but turning
 * off "the stock" meant flipping seven of them, which is not a thing anyone
 * wants to do twice. They are real parameters rather than interface state so
 * that they travel in a preset, and they fold down into the section switches
 * (see applyEngineMasters) so that the renderers never learn about them.
 * ------------------------------------------------------------------ */

const ENGINE_GROUP: Group[] = [
  {
    id: 'engine',
    label: 'Engines',
    kind: 'global',
    hint: 'Master bypass for each of the three engines.',
    params: [
      { key: 'engine.stock', type: 'bool', label: 'Stock engine', def: true, noRandom: true, hint: 'The emulsion: curve, grain, halation, dyes, print and fading.' },
      { key: 'engine.lens', type: 'bool', label: 'Lens engine', def: true, noRandom: true, hint: 'Exposure and the lens: softness, vignetting, chromatic aberration, flare.' },
      { key: 'engine.gate', type: 'bool', label: 'Gate engine', def: true, noRandom: true, hint: 'The machinery: camera and projector transport, dirt, scratches, splices, leaks, decay and telecine.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Stock — the emulsion
 * ------------------------------------------------------------------ */

const STOCK_GROUPS: Group[] = [
  {
    id: 'format',
    label: 'Format & Stock',
    kind: 'stock',
    hint: 'The gauge and the emulsion. Every other section scales from these two choices.',
    params: [
      { key: 'format.gauge', type: 'enum', label: 'Gauge', options: GAUGE_OPTIONS, def: 'super8', noRandom: true, hint: 'The width of the film and the size of its frame. Drives grain, halation, weave, lens sharpness, roll length and frame rate.' },
      { key: 'format.stock', type: 'enum', label: 'Stock', options: STOCK_OPTIONS, def: 'kodachrome40', noRandom: true, hint: 'The emulsion. Negative or reversal, its curve, its grain and its dyes.' },
      { key: 'format.fps', type: 'enum', label: 'Camera speed', options: CAMERA_SPEEDS, def: 'native', noRandom: true, hint: 'Frames per second the camera ran at. The picture only changes this often.' },
    ],
  },
  {
    id: 'curve',
    label: 'Characteristic Curve',
    kind: 'stock',
    enableKey: 'curve.enabled',
    hint: 'Density against log exposure: the toe, the straight line and the shoulder. Not grain — this is why film looks like film.',
    params: [
      { key: 'curve.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'curve.gamma', type: 'float', label: 'Contrast (gamma)', min: 0.5, max: 2, step: 0.001, def: 1, log: true, unit: '×', hint: 'Slope of the straight line, as a multiple of the stock’s own.' },
      { key: 'curve.toe', type: 'float', label: 'Toe position', min: -1, max: 1, step: 0.001, def: 0, unit: 'log E', hint: 'Where the shadows start to compress. Positive crushes more of them into black.' },
      { key: 'curve.toeSoftness', type: 'float', label: 'Toe softness', min: 0.25, max: 4, step: 0.001, def: 1, log: true, unit: '×', hint: 'How gradually shadows bend into the toe.' },
      { key: 'curve.shoulder', type: 'float', label: 'Shoulder position', min: -1.5, max: 1.5, step: 0.001, def: 0, unit: 'log E', hint: 'Where the highlights start to roll off. Negative brings the shoulder down into the picture.' },
      { key: 'curve.shoulderSoftness', type: 'float', label: 'Shoulder softness', min: 0.25, max: 4, step: 0.001, def: 1, log: true, unit: '×', hint: 'How gently the highlights bend over.' },
      { key: 'curve.crossover', type: 'float', label: 'Layer crossover', min: -1, max: 1, step: 0.001, def: 0, advanced: true, hint: 'Spreads the three layers’ contrast apart, so shadows and highlights take opposite casts.' },
      { key: 'curve.push', type: 'float', label: 'Push / pull', min: -2, max: 3, step: 0.01, def: 0, unit: 'stops', hint: 'Rated faster and developed longer. More contrast, more grain, more fog, thinner shadows.' },
    ],
  },
  {
    id: 'grain',
    label: 'Grain',
    kind: 'stock',
    enableKey: 'grain.enabled',
    hint: 'Silver and dye clouds in three uncorrelated layers, fixed to the film and scaled by the format.',
    params: [
      { key: 'grain.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'grain.amount', type: 'float', label: 'Amount', min: 0, max: 3, step: 0.001, def: 1, unit: '×', hint: 'Multiple of the stock’s published RMS granularity.' },
      { key: 'grain.size', type: 'float', label: 'Clump size', min: 0.5, max: 3, step: 0.001, def: 1, log: true, unit: '×', hint: 'Multiple of the stock’s own clump size.' },
      { key: 'grain.colour', type: 'float', label: 'Layer independence', min: 0, max: 1, step: 0.001, def: 1, hint: 'At 1 each layer has its own grain, as in real film, and it reads as coloured. At 0 they share one pattern.' },
      { key: 'grain.blue', type: 'float', label: 'Blue layer', min: 0.5, max: 2, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'The blue-sensitive layer is usually the grainiest. This scales it on top of the stock’s own balance.' },
      { key: 'grain.roughness', type: 'float', label: 'Clumping', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'Weight of the coarser octave — how much grains gather into clusters.' },
      { key: 'grain.density', type: 'float', label: 'Density response', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'How grain power follows density. 0.5 is the square-root law silver obeys.' },
      { key: 'grain.print', type: 'float', label: 'Print grain', min: 0, max: 3, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'The print stock’s own, much finer grain, and that of any duplicate generations.' },
    ],
  },
  {
    id: 'halation',
    label: 'Halation',
    kind: 'stock',
    enableKey: 'halation.enabled',
    hint: 'Light through the emulsion, off the back of the base, and back in from behind. The red ring round every light.',
    params: [
      { key: 'halation.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'halation.amount', type: 'float', label: 'Amount', min: 0, max: 5, step: 0.001, def: 1, unit: '×', hint: 'Multiple of how much light the stock’s anti-halation backing lets back.' },
      { key: 'halation.radius', type: 'float', label: 'Radius', min: 0.25, max: 4, step: 0.001, def: 1, log: true, unit: '×', hint: 'Multiple of the distance set by the base thickness.' },
      { key: 'halation.green', type: 'float', label: 'Green reach', min: 0, max: 1, step: 0.001, def: 0.25, hint: 'How much of the returning light reaches the green layer as well as the red. More is orange, less is red.' },
      { key: 'halation.noBacking', type: 'bool', label: 'Backing removed', def: false, hint: 'The anti-halation layer stripped off before processing — the trick that makes CineStill glow.' },
    ],
  },
  {
    id: 'dye',
    label: 'Dyes',
    kind: 'stock',
    enableKey: 'dye.enabled',
    hint: 'What the three dye layers do to one another, and how far the dyes are from pure.',
    params: [
      { key: 'dye.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'dye.saturation', type: 'float', label: 'Interimage', min: 0, max: 2, step: 0.001, def: 1, unit: '×', hint: 'Layers inhibiting each other’s development, which is where film’s colour separation comes from.' },
      { key: 'dye.impurity', type: 'float', label: 'Dye impurity', min: 0, max: 2.5, step: 0.001, def: 1, unit: '×', hint: 'Unwanted absorptions. More muddies the colour, less makes it unreally pure.' },
    ],
  },
  {
    id: 'print',
    label: 'Print & Process',
    kind: 'stock',
    enableKey: 'print.enabled',
    hint: 'What a laboratory did with the negative: printed it, or, today, scanned it. Reversal is projected as it came out of the tank.',
    params: [
      { key: 'print.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'print.process', type: 'enum', label: 'Process', options: PROCESSES, def: 'print', noRandom: true, hint: 'How a negative becomes a picture. Ignored for reversal stocks.' },
      { key: 'print.stock', type: 'enum', label: 'Print stock', options: PRINT_OPTIONS, def: 'vision2383', noRandom: true, hint: 'The positive the negative is printed onto.' },
      { key: 'print.red', type: 'float', label: 'Red printer light', min: 1, max: 50, step: 0.1, def: 25, unit: 'pts', hint: 'Printer points; 25 is the laboratory’s nominal. More red light makes the print more cyan.' },
      { key: 'print.green', type: 'float', label: 'Green printer light', min: 1, max: 50, step: 0.1, def: 25, unit: 'pts', hint: 'More green light makes the print more magenta.' },
      { key: 'print.blue', type: 'float', label: 'Blue printer light', min: 1, max: 50, step: 0.1, def: 25, unit: 'pts', hint: 'More blue light makes the print more yellow.' },
      { key: 'print.density', type: 'float', label: 'Print density', min: -12, max: 12, step: 0.1, def: 0, unit: 'pts', hint: 'All three lights at once: a darker or lighter print.' },
      { key: 'print.generations', type: 'int', label: 'Duplicate generations', min: 0, max: 4, def: 0, hint: 'Interpositive-to-internegative copies before the print. Each adds grain, contrast and softness.' },
      { key: 'print.bleachBypass', type: 'float', label: 'Bleach bypass', min: 0, max: 1, step: 0.001, def: 0, hint: 'Silver left in the print alongside the dye. Contrastier, desaturated, harsher.' },
    ],
  },
  {
    id: 'fade',
    label: 'Dye Fading',
    kind: 'stock',
    enableKey: 'fade.enabled',
    hint: 'Each dye decays at its own rate. Not a desaturation — a specific, recognisable shift.',
    params: [
      { key: 'fade.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'fade.years', type: 'float', label: 'Age', min: 0, max: 80, step: 0.1, def: 0, unit: 'years', hint: 'How long the positive has existed. Rates come from the stock.' },
      { key: 'fade.storage', type: 'enum', label: 'Storage', options: STORAGE, def: 'room', hint: 'Dye fading roughly doubles with every 5–7 °C. Where it was kept matters more than how long.' },
      { key: 'fade.cyan', type: 'float', label: 'Cyan rate', min: 0, max: 3, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'Multiple of the stock’s cyan fade rate.' },
      { key: 'fade.magenta', type: 'float', label: 'Magenta rate', min: 0, max: 3, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'Multiple of the stock’s magenta fade rate.' },
      { key: 'fade.yellow', type: 'float', label: 'Yellow rate', min: 0, max: 3, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'Multiple of the stock’s yellow fade rate.' },
      { key: 'fade.stain', type: 'float', label: 'Yellow stain', min: 0, max: 3, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'Multiple of the stock’s rate of base and coupler yellowing.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Lens — the light before it reaches the film
 * ------------------------------------------------------------------ */

const LENS_GROUPS: Group[] = [
  {
    id: 'exposure',
    label: 'Exposure',
    kind: 'lens',
    enableKey: 'exposure.enabled',
    hint: 'How much light, of what colour, reached the film.',
    params: [
      { key: 'exposure.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'exposure.stops', type: 'float', label: 'Exposure', min: -4, max: 4, step: 0.01, def: 0, unit: 'stops', hint: 'Relative to what the meter asked for.' },
      { key: 'exposure.headroom', type: 'float', label: 'Source headroom', min: 0, max: 4, step: 0.01, def: 2, unit: 'stops', noRandom: true, hint: 'How far above white the source’s brightest highlights are taken to have been in the scene.' },
      { key: 'exposure.light', type: 'enum', label: 'Scene light', options: LIGHTS, def: 'matched', hint: 'What the footage was lit with, against what the stock is balanced for.' },
      { key: 'exposure.filter85', type: 'bool', label: '85 filter', def: false, hint: 'The orange conversion filter. Super 8 cameras had one built in, on a switch.' },
    ],
  },
  {
    id: 'lens',
    label: 'Lens',
    kind: 'lens',
    enableKey: 'lens.enabled',
    hint: 'Sharpness in line pairs per millimetre of film, so a small format loses more of the picture to the same glass.',
    params: [
      { key: 'lens.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'lens.resolution', type: 'float', label: 'Resolving power', min: 10, max: 160, step: 0.1, def: 60, log: true, unit: 'lp/mm', hint: 'Spatial frequency at 50% contrast, on the film.' },
      { key: 'lens.corners', type: 'float', label: 'Corner softness', min: 0, max: 4, step: 0.001, def: 1, hint: 'How much worse the corners are than the centre.' },
      { key: 'lens.defocus', type: 'float', label: 'Defocus', min: 0, max: 60, step: 0.1, def: 0, unit: 'µm', hint: 'A focus miss, as the radius of the blur on the film.' },
      { key: 'lens.vignette', type: 'float', label: 'Vignetting', min: 0, max: 3, step: 0.001, def: 0.4, unit: 'stops', hint: 'Light lost in the corners.' },
      { key: 'lens.chromatic', type: 'float', label: 'Chromatic aberration', min: 0, max: 40, step: 0.1, def: 3, unit: 'µm', hint: 'Lateral colour fringing at the corner of the frame, measured on the film.' },
      { key: 'lens.distortion', type: 'float', label: 'Distortion', min: -0.2, max: 0.2, step: 0.001, def: 0, hint: 'Barrel (positive) or pincushion (negative).' },
      { key: 'lens.flare', type: 'float', label: 'Veiling flare', min: 0, max: 0.25, step: 0.001, def: 0.015, hint: 'Light scattered around inside the lens, lifting the shadows.' },
      { key: 'lens.flareTint', type: 'float', label: 'Flare tint', min: -1, max: 1, step: 0.001, def: 0.2, advanced: true, hint: 'Warm (positive) or cool (negative) flare — the colour of the coatings.' },
    ],
  },
  {
    id: 'anamorphic',
    label: 'Anamorphic',
    kind: 'lens',
    enableKey: 'anamorphic.enabled',
    collapsed: true,
    hint: 'A cylindrical lens squeezing a wide picture onto ordinary film, and everything that drags along with it.',
    params: [
      { key: 'anamorphic.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'anamorphic.squeeze', type: 'float', label: 'Squeeze', min: 1, max: 2, step: 0.01, def: 2, unit: '×', hint: 'Horizontal compression on the film. 2× is CinemaScope.' },
      { key: 'anamorphic.streak', type: 'float', label: 'Streak flare', min: 0, max: 3, step: 0.001, def: 0.6, hint: 'The horizontal line through every bright source.' },
      { key: 'anamorphic.streakLength', type: 'float', label: 'Streak length', min: 0.05, max: 1, step: 0.001, def: 0.45, hint: 'As a fraction of the frame width.' },
      { key: 'anamorphic.streakTint', type: 'float', label: 'Streak tint', min: 0, max: 1, step: 0.001, def: 0.75, hint: 'From neutral to the familiar electric blue.' },
      { key: 'anamorphic.threshold', type: 'float', label: 'Streak threshold', min: 0, max: 5, step: 0.01, def: 2.5, unit: 'stops', advanced: true, hint: 'Stops over grey before a highlight starts to streak.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Gate — the machinery the film went through
 * ------------------------------------------------------------------ */

const GATE_GROUPS: Group[] = [
  {
    id: 'camera',
    label: 'Camera Transport',
    kind: 'gate',
    enableKey: 'camera.enabled',
    hint: 'The camera pulling film down a frame at a time, imperfectly. Faults here are recorded into the picture, under the grain.',
    params: [
      { key: 'camera.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'camera.weave', type: 'float', label: 'Registration error', min: 0, max: 80, step: 0.1, def: 6, unit: 'µm', hint: 'How far each frame lands from where it should, on the film. The image moves; the grain does not.' },
      { key: 'camera.weaveSpeed', type: 'float', label: 'Weave speed', min: 0.1, max: 4, step: 0.001, def: 1, log: true, unit: 'Hz', hint: 'How fast the slow wander of the frame moves.' },
      { key: 'camera.jitter', type: 'float', label: 'Frame jitter', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'Share of the error that changes every frame rather than drifting.' },
      { key: 'camera.flicker', type: 'float', label: 'Exposure flicker', min: 0, max: 0.6, step: 0.001, def: 0.04, unit: 'stops', hint: 'Frame-to-frame exposure variation from a shutter that does not quite repeat.' },
      { key: 'camera.speedDrift', type: 'float', label: 'Speed drift', min: 0, max: 0.25, step: 0.001, def: 0, hint: 'A spring motor winding down: frames come slower, so they are longer exposures and motion speeds up on projection.' },
      { key: 'camera.flashRate', type: 'float', label: 'Camera starts', min: 0, max: 20, step: 0.01, def: 0, unit: '/min', hint: 'How often the camera was started. Each start overexposes the first frames while the motor comes up to speed.' },
      { key: 'camera.flashFrames', type: 'int', label: 'Flash frames', min: 1, max: 6, def: 2, hint: 'How many frames each start burns.' },
    ],
  },
  {
    id: 'projector',
    label: 'Projector',
    kind: 'gate',
    enableKey: 'projector.enabled',
    hint: 'The machine showing the film, or the one transferring it. Its faults move the grain with the picture.',
    params: [
      { key: 'projector.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'projector.weave', type: 'float', label: 'Gate weave', min: 0, max: 80, step: 0.1, def: 4, unit: 'µm', hint: 'The whole strip wandering in the gate. Picture, grain and dirt move together.' },
      { key: 'projector.rotation', type: 'float', label: 'Rotational weave', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'Share of the weave that is a tilt rather than a slide.' },
      { key: 'projector.speed', type: 'enum', label: 'Projection speed', options: PROJECTOR_SPEEDS, def: 'match', hint: 'Silent film at 16 fps run at sound speed comes out half as fast again.' },
      { key: 'projector.blades', type: 'enum', label: 'Shutter', options: BLADES, def: '0', hint: 'The shutter interrupting the light while the film moves. Filmed off the screen, it beats against the camera.' },
      { key: 'projector.captureShutter', type: 'float', label: 'Capture shutter', min: 0.05, max: 1, step: 0.001, def: 0.5, hint: 'Exposure of the camera filming the screen, as a fraction of its frame. Short exposures flicker hardest.' },
      { key: 'projector.mains', type: 'enum', label: 'Mains', options: MAINS, def: '60', noRandom: true, hint: 'Frequency of the supply — lamp ripple and hum are at twice this.' },
      { key: 'projector.lampRipple', type: 'float', label: 'Lamp ripple', min: 0, max: 0.2, step: 0.001, def: 0, hint: 'Brightness ripple at twice the mains frequency from an AC lamp.' },
      { key: 'projector.hotspot', type: 'float', label: 'Hot spot', min: 0, max: 2, step: 0.001, def: 0.25, unit: 'stops', hint: 'Light falling off from the centre of the screen.' },
      { key: 'projector.warmth', type: 'float', label: 'Lamp colour', min: -1, max: 1, step: 0.001, def: 0, hint: 'Tungsten (warm, positive) against xenon (cool, negative).' },
      { key: 'projector.focus', type: 'float', label: 'Focus', min: 0, max: 60, step: 0.1, def: 0, unit: 'µm', hint: 'A projection lens out of focus. Unlike the camera lens, this softens the grain too.' },
      { key: 'projector.buckle', type: 'float', label: 'Film buckle', min: 0, max: 60, step: 0.1, def: 0, unit: 'µm', hint: 'The frame bowing towards the lamp as it heats, so focus breathes and the centre goes soft.' },
      { key: 'projector.framing', type: 'float', label: 'Framing', min: -0.5, max: 0.5, step: 0.001, def: 0, unit: 'frames', hint: 'The framing knob out of adjustment, showing the frame line.' },
    ],
  },
  {
    id: 'gatedirt',
    label: 'Gate Dirt & Hair',
    kind: 'gate',
    enableKey: 'gatedirt.enabled',
    hint: 'Grit stuck in the gate itself. It stays put while the film runs past, for seconds at a time.',
    params: [
      { key: 'gatedirt.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'gatedirt.hair', type: 'float', label: 'Hairs', min: 0, max: 1, step: 0.001, def: 0, hint: 'How often a hair is caught at the edge of the aperture.' },
      { key: 'gatedirt.specks', type: 'float', label: 'Specks', min: 0, max: 1, step: 0.001, def: 0, hint: 'Grit lodged in the gate — still while the picture moves under it.' },
      { key: 'gatedirt.life', type: 'float', label: 'Lifetime', min: 0.5, max: 30, step: 0.1, def: 6, log: true, unit: 's', hint: 'How long before a hair or a speck is dislodged.' },
      { key: 'gatedirt.wiggle', type: 'float', label: 'Hair wiggle', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'How much a hair flutters as each frame is pulled past it.' },
      { key: 'gatedirt.size', type: 'float', label: 'Size', min: 0.3, max: 3, step: 0.001, def: 1, log: true, unit: '×', hint: 'Scales hairs and specks.' },
    ],
  },
  {
    id: 'filmdirt',
    label: 'Film Dirt',
    kind: 'gate',
    enableKey: 'filmdirt.enabled',
    hint: 'Dust and lint on the film itself. A different frame carries different dirt, so it lasts one frame and is gone.',
    params: [
      { key: 'filmdirt.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'filmdirt.dust', type: 'float', label: 'Dust', min: 0, max: 1, step: 0.001, def: 0, hint: 'Specks per frame.' },
      { key: 'filmdirt.fibres', type: 'float', label: 'Fibres', min: 0, max: 1, step: 0.001, def: 0, hint: 'Lint and short hairs on the film, curled.' },
      { key: 'filmdirt.size', type: 'float', label: 'Size', min: 0.3, max: 3, step: 0.001, def: 1, log: true, unit: '×', hint: 'Physical size of the dirt — the same speck covers more of a smaller frame.' },
      { key: 'filmdirt.negative', type: 'float', label: 'On the negative', min: 0, max: 1, step: 0.001, def: 0.4, hint: 'Share of the dirt that was on the negative when it was printed, and so prints white.' },
    ],
  },
  {
    id: 'scratch',
    label: 'Scratches',
    kind: 'gate',
    enableKey: 'scratch.enabled',
    hint: 'Grit in a gate drawing a line along the film. It persists across a shot because the grit does.',
    params: [
      { key: 'scratch.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'scratch.rate', type: 'float', label: 'Scratches', min: 0, max: 1, step: 0.001, def: 0, hint: 'How often a scratch is running.' },
      { key: 'scratch.life', type: 'float', label: 'Duration', min: 0.5, max: 20, step: 0.1, def: 4, log: true, unit: 's', hint: 'How long a piece of grit stays in the gate.' },
      { key: 'scratch.width', type: 'float', label: 'Width', min: 5, max: 120, step: 0.1, def: 25, log: true, unit: 'µm', hint: 'On the film.' },
      { key: 'scratch.depth', type: 'float', label: 'Depth', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'How many dye layers an emulsion scratch cuts through. Shallow ones are coloured.' },
      { key: 'scratch.base', type: 'float', label: 'Base side', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Share of scratches on the base rather than the emulsion.' },
      { key: 'scratch.negative', type: 'float', label: 'On the negative', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Share made on the negative before printing, which reverses their polarity.' },
      { key: 'scratch.wander', type: 'float', label: 'Wander', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'How far a scratch drifts sideways as the film weaves.' },
    ],
  },
  {
    id: 'splice',
    label: 'Splices & Cues',
    kind: 'gate',
    enableKey: 'splice.enabled',
    hint: 'Joins in the film, and the marks a projectionist watched for.',
    params: [
      { key: 'splice.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'splice.rate', type: 'float', label: 'Splices', min: 0, max: 20, step: 0.01, def: 0, unit: '/min', hint: 'How often the film has been joined.' },
      { key: 'splice.kind', type: 'enum', label: 'Kind', options: SPLICE_KINDS, def: 'tape', hint: 'Tape or cement.' },
      { key: 'splice.jump', type: 'float', label: 'Jump', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'How far the picture jumps as the splice goes through the gate.' },
      { key: 'splice.flash', type: 'float', label: 'Flash', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'The light frame at the join.' },
      { key: 'splice.cueMarks', type: 'bool', label: 'Cue marks', def: false, hint: 'The circles in the top right corner before a reel change.' },
      { key: 'splice.reel', type: 'float', label: 'Reel length', min: 5, max: 1200, step: 1, def: 60, log: true, unit: 's', hint: 'Where the reel ends, for the cue marks.' },
    ],
  },
  {
    id: 'leak',
    label: 'Light Leaks & Fog',
    kind: 'gate',
    enableKey: 'leak.enabled',
    hint: 'Light reaching the film where it should not. It exposes the emulsion, so it goes through the curve like any other light.',
    params: [
      { key: 'leak.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'leak.amount', type: 'float', label: 'Leak', min: 0, max: 3, step: 0.001, def: 0, hint: 'A leak from the side of the camera or cartridge, coming and going.' },
      { key: 'leak.position', type: 'float', label: 'Leak position', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Where round the frame the light gets in.' },
      { key: 'leak.speed', type: 'float', label: 'Leak motion', min: 0, max: 2, step: 0.001, def: 0.5, hint: 'How quickly it flares and fades.' },
      { key: 'leak.edgeFog', type: 'float', label: 'Edge fog', min: 0, max: 1, step: 0.001, def: 0, hint: 'Light piped along the perforated edge, fogging that side of every frame.' },
      { key: 'leak.rollFog', type: 'float', label: 'Roll-end fog', min: 0, max: 3, step: 0.001, def: 0, hint: 'The first and last frames of a load, fogged while it was loaded and unloaded.' },
      { key: 'leak.warmth', type: 'float', label: 'Colour', min: 0, max: 1, step: 0.001, def: 0.75, hint: 'Light through the base reaches the red layer first. 1 is that orange; 0 is white light.' },
    ],
  },
  {
    id: 'decay',
    label: 'Decay',
    kind: 'gate',
    enableKey: 'decay.enabled',
    hint: 'Film that has been kept badly. The base shrinks, the emulsion lets go, things grow on it.',
    params: [
      { key: 'decay.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'decay.vinegar', type: 'float', label: 'Vinegar syndrome', min: 0, max: 1, step: 0.001, def: 0, hint: 'Acetate breaking down: the base shrinks and buckles, so the picture warps.' },
      { key: 'decay.channelling', type: 'float', label: 'Channelling', min: 0, max: 1, step: 0.001, def: 0, hint: 'The emulsion lifting in ridges as the base shrinks beneath it.' },
      { key: 'decay.mould', type: 'float', label: 'Mould', min: 0, max: 1, step: 0.001, def: 0, hint: 'Fungus eating the gelatin in soft-edged colonies.' },
      { key: 'decay.water', type: 'float', label: 'Water marks', min: 0, max: 1, step: 0.001, def: 0, hint: 'Tide lines where water dried on the emulsion.' },
      { key: 'decay.flaking', type: 'float', label: 'Emulsion flaking', min: 0, max: 1, step: 0.001, def: 0, hint: 'Patches where the emulsion has come away entirely.' },
    ],
  },
  {
    id: 'telecine',
    label: 'Telecine',
    kind: 'gate',
    enableKey: 'telecine.enabled',
    hint: 'Turning projected film into video: pulldown cadence and the transfer’s tone.',
    params: [
      { key: 'telecine.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'telecine.fields', type: 'bool', label: 'Interlaced pulldown', def: false, hint: 'Build each video frame from two fields that may come from different film frames — the 3:2 cadence.' },
      { key: 'telecine.fieldOrder', type: 'enum', label: 'Field order', options: FIELD_ORDERS, def: 'upper', advanced: true, hint: 'Which field is first in time.' },
      { key: 'telecine.grey', type: 'float', label: 'Mid grey', min: 0.05, max: 0.4, step: 0.001, def: 0.18, hint: 'Where the print’s aim density lands on video, as linear light.' },
      { key: 'telecine.white', type: 'float', label: 'White', min: 0.5, max: 1.5, step: 0.001, def: 1, hint: 'Where clear film lands.' },
      { key: 'telecine.black', type: 'float', label: 'Black lift', min: 0, max: 0.1, step: 0.0001, def: 0, hint: 'Flare in the transfer, lifting the blacks.' },
      { key: 'telecine.saturation', type: 'float', label: 'Saturation', min: 0, max: 2, step: 0.001, def: 1, hint: 'The colourist’s saturation knob.' },
    ],
  },
  {
    id: 'framing',
    label: 'Framing & Output',
    kind: 'gate',
    hint: 'The shape and frame rate of what comes out. Decides the export file, not just the preview.',
    params: [
      { key: 'framing.aspect', type: 'enum', label: 'Aspect', options: ASPECTS, def: 'gate', noRandom: true, hint: 'The projected picture’s shape. The export is exactly this shape.' },
      { key: 'framing.overscan', type: 'float', label: 'Overscan', min: -0.2, max: 0.8, step: 0.001, def: -0.05, noRandom: true, hint: 'Negative crops inside the gate; positive shows the gate edge, the frame lines and the perforations.' },
      { key: 'framing.fps', type: 'enum', label: 'Output rate', options: OUTPUT_RATES, def: 'film', noRandom: true, hint: 'Frame rate of the video. Anything but the film rate produces a cadence.' },
      { key: 'framing.dither', type: 'float', label: 'Dither', min: 0, max: 1, step: 0.001, def: 0.5, noRandom: true, advanced: true, hint: 'A little noise before quantising to 8 bits, so smooth gradients do not band.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Sound
 * ------------------------------------------------------------------ */

const AUDIO_GROUPS: Group[] = [
  {
    id: 'audio',
    label: 'Audio Source',
    kind: 'audio',
    enableKey: 'audio.enabled',
    hint: 'What goes onto the soundtrack. Film sound is one channel.',
    params: [
      { key: 'audio.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'audio.inputGain', type: 'float', label: 'Input gain', min: -24, max: 24, step: 0.1, def: 0, unit: 'dB', noRandom: true, hint: 'Level into the recording.' },
      { key: 'audio.channelMode', type: 'enum', label: 'Channels', options: CHANNEL_MODES, def: 'mono', hint: 'Collapse to the one channel a projector plays.' },
      { key: 'audio.track', type: 'enum', label: 'Soundtrack', options: TRACK_TYPES, def: 'magnetic', hint: 'How the sound was carried on the film.' },
    ],
  },
  {
    id: 'transport',
    label: 'Sound Transport',
    kind: 'audio',
    enableKey: 'transport.enabled',
    hint: 'Film past the sound head: the speed is smoothed by a flywheel, never perfectly.',
    params: [
      { key: 'transport.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'transport.wowRate', type: 'float', label: 'Wow rate', min: 0.1, max: 4, step: 0.001, def: 0.8, log: true, unit: 'Hz', hint: 'Slow pitch wander — a capstan or flywheel out of round.' },
      { key: 'transport.wowDepth', type: 'float', label: 'Wow depth', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Depth of the slow wander.' },
      { key: 'transport.flutterRate', type: 'float', label: 'Flutter rate', min: 4, max: 40, step: 0.01, def: 11, log: true, unit: 'Hz', hint: 'Fast pitch wobble from rollers and sprockets.' },
      { key: 'transport.flutterDepth', type: 'float', label: 'Flutter depth', min: 0, max: 1, step: 0.001, def: 0.08, hint: 'Depth of the fast wobble.' },
      { key: 'transport.sprocket', type: 'float', label: 'Sprocket modulation', min: 0, max: 1, step: 0.001, def: 0, hint: 'The intermittent pull-down leaking through the loop to the sound head, at the perforation rate.' },
      { key: 'transport.drift', type: 'float', label: 'Speed drift', min: 0, max: 1, step: 0.001, def: 0.1, hint: 'A slow random walk in speed.' },
    ],
  },
  {
    id: 'magnetic',
    label: 'Magnetic Stripe',
    kind: 'audio',
    enableKey: 'magnetic.enabled',
    hint: 'A millimetre of oxide along the edge of 8 mm film, moving at a few centimetres a second. Used when the soundtrack is magnetic.',
    params: [
      { key: 'magnetic.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'magnetic.hiss', type: 'float', label: 'Hiss', min: -90, max: -20, step: 0.1, def: -50, unit: 'dB', hint: 'Oxide noise. A narrow stripe is a noisy one.' },
      { key: 'magnetic.headWear', type: 'float', label: 'Head wear', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Treble lost to a worn head and poor contact, on top of what the film speed allows.' },
      { key: 'magnetic.saturation', type: 'float', label: 'Saturation', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'The oxide running out of headroom on loud passages.' },
      { key: 'magnetic.dropouts', type: 'float', label: 'Dropouts', min: 0, max: 60, step: 0.1, def: 3, unit: '/min', hint: 'Oxide flaked off the stripe.' },
      { key: 'magnetic.dropoutDepth', type: 'float', label: 'Dropout depth', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'How much signal a dropout takes.' },
      { key: 'magnetic.printThrough', type: 'float', label: 'Print-through', min: -80, max: -20, step: 0.1, def: -52, unit: 'dB', hint: 'Echo from the adjacent winding of the reel, magnetised by it in storage.' },
      { key: 'magnetic.printDelay', type: 'float', label: 'Echo spacing', min: 0.3, max: 5, step: 0.01, def: 1.8, log: true, unit: 's', advanced: true, hint: 'One turn of the reel at the projection speed.' },
      { key: 'magnetic.preEcho', type: 'bool', label: 'Pre-echo', def: true, hint: 'Stored heads-out the echo comes before the sound; tails-out, after.' },
    ],
  },
  {
    id: 'optical',
    label: 'Optical Track',
    kind: 'audio',
    enableKey: 'optical.enabled',
    hint: 'Sound photographed beside the picture and read back by a lamp and a photocell. Used when the soundtrack is optical.',
    params: [
      { key: 'optical.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'optical.modulation', type: 'float', label: 'Modulation', min: 0.2, max: 1.6, step: 0.001, def: 0.8, hint: 'Programme level against 100% modulation of the track. Above 1 the track runs out.' },
      { key: 'optical.imageSpread', type: 'float', label: 'Image spread', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Light spreading in the track emulsion, softening treble and adding intermodulation.' },
      { key: 'optical.noise', type: 'float', label: 'Track noise', min: -90, max: -20, step: 0.1, def: -56, unit: 'dB', hint: 'Grain in the track, heard as hiss.' },
      { key: 'optical.crackle', type: 'float', label: 'Crackle', min: 0, max: 40, step: 0.01, def: 2, unit: '/s', hint: 'Dirt on the track passing the slit.' },
      { key: 'optical.crackleLevel', type: 'float', label: 'Crackle level', min: -60, max: 0, step: 0.1, def: -24, unit: 'dB', hint: 'Loudness of the biggest pops.' },
      { key: 'optical.ticks', type: 'float', label: 'Perforation ticks', min: 0, max: 1, step: 0.001, def: 0, hint: 'A damaged frame line clicking once a frame.' },
      { key: 'optical.exciterHum', type: 'float', label: 'Exciter hum', min: -90, max: -20, step: 0.1, def: -72, unit: 'dB', hint: 'An AC-powered exciter lamp rippling at twice the mains frequency.' },
    ],
  },
  {
    id: 'playback',
    label: 'Playback & Amplifier',
    kind: 'audio',
    enableKey: 'playback.enabled',
    hint: 'The equalisation and amplifier between the sound head and the speaker.',
    params: [
      { key: 'playback.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'playback.curve', type: 'enum', label: 'Playback curve', options: PLAYBACK_CURVES, def: 'projector', hint: 'The response the theatre or the projector imposed.' },
      { key: 'playback.lowCut', type: 'float', label: 'Low cut', min: 20, max: 400, step: 1, def: 80, log: true, unit: 'Hz', hint: 'Where the bass gives out.' },
      { key: 'playback.highCut', type: 'float', label: 'High cut', min: 1500, max: 20000, step: 1, def: 9000, log: true, unit: 'Hz', hint: 'Where the treble gives out. The magnetic stripe sets its own, lower, ceiling from the film speed.' },
      { key: 'playback.drive', type: 'float', label: 'Drive', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'How hard the amplifier is pushed.' },
      { key: 'playback.model', type: 'enum', label: 'Amplifier', options: SATURATION_MODELS, def: 'valve', hint: 'The character of its overload.' },
      { key: 'playback.hum', type: 'float', label: 'Mains hum', min: -90, max: -20, step: 0.1, def: -70, unit: 'dB', hint: 'The amplifier’s own hum.' },
    ],
  },
  {
    id: 'speaker',
    label: 'Speaker & Room',
    kind: 'audio',
    enableKey: 'speaker.enabled',
    hint: 'The loudspeaker and the space it is in — from a projector’s built-in cone on the coffee table to a horn behind the screen.',
    params: [
      { key: 'speaker.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'speaker.resonanceFreq', type: 'float', label: 'Box resonance', min: 60, max: 600, step: 1, def: 180, log: true, unit: 'Hz', hint: 'The cabinet’s main resonance.' },
      { key: 'speaker.resonanceGain', type: 'float', label: 'Resonance gain', min: 0, max: 12, step: 0.1, def: 3, unit: 'dB', hint: 'How much it rings.' },
      { key: 'speaker.honkFreq', type: 'float', label: 'Horn honk', min: 400, max: 4000, step: 1, def: 1400, log: true, unit: 'Hz', hint: 'The midrange peak of a horn or a small cone.' },
      { key: 'speaker.honkGain', type: 'float', label: 'Honk gain', min: 0, max: 12, step: 0.1, def: 3, unit: 'dB', hint: 'How nasal it is.' },
      { key: 'speaker.cabinet', type: 'float', label: 'Cabinet', min: 0, max: 1, step: 0.001, def: 0.25, hint: 'How much of the box’s own sound is mixed in.' },
      { key: 'speaker.cabinetSize', type: 'float', label: 'Cabinet size', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'From a projector’s plastic case to a theatre horn.' },
      { key: 'speaker.breakup', type: 'float', label: 'Cone breakup', min: 0, max: 1, step: 0.001, def: 0.1, hint: 'A small cone distorting on loud passages.' },
      { key: 'speaker.room', type: 'float', label: 'Room', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Reverberation of the room.' },
      { key: 'speaker.booth', type: 'float', label: 'Through the booth glass', min: 0, max: 1, step: 0.001, def: 0, hint: 'Heard from the projection booth rather than the auditorium.' },
    ],
  },
  {
    id: 'projnoise',
    label: 'Projector Noise',
    kind: 'audio',
    enableKey: 'projnoise.enabled',
    hint: 'The machine itself, in the room: the claw, the shutter, the motor. Locked to the frame rate because it is the frame rate.',
    params: [
      { key: 'projnoise.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'projnoise.level', type: 'float', label: 'Level', min: -80, max: -6, step: 0.1, def: -32, unit: 'dB', hint: 'Overall loudness of the projector.' },
      { key: 'projnoise.claw', type: 'float', label: 'Claw', min: 0, max: 1, step: 0.001, def: 0.7, hint: 'The intermittent pull-down striking once a frame.' },
      { key: 'projnoise.tone', type: 'float', label: 'Mechanism tone', min: 400, max: 6000, step: 1, def: 1800, log: true, unit: 'Hz', hint: 'The pitch of the mechanism’s resonances. Small machines ring higher.' },
      { key: 'projnoise.wear', type: 'float', label: 'Wear', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Slack in the mechanism: uneven strikes and a second, rattling impact.' },
      { key: 'projnoise.shutter', type: 'float', label: 'Shutter & fan', min: 0, max: 1, step: 0.001, def: 0.4, hint: 'Air from the shutter blades and the lamp fan.' },
      { key: 'projnoise.motor', type: 'float', label: 'Motor', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'The motor’s whine and the drive belt.' },
      { key: 'projnoise.distance', type: 'float', label: 'Distance', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'From beside you on the coffee table to behind a wall.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * A/V link — the couplings that make picture and sound one machine
 * ------------------------------------------------------------------ */

const LINK_GROUPS: Group[] = [
  {
    id: 'link',
    label: 'A/V Link',
    kind: 'link',
    enableKey: 'link.enabled',
    hint: 'The picture and the sound go through the same machine. A fault in it shows in both at once.',
    params: [
      { key: 'link.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'link.weaveToClatter', type: 'float', label: 'Weave → clatter', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'A frame that lands badly is a frame the claw hit badly: it jumps and it clacks.' },
      { key: 'link.spliceToPop', type: 'float', label: 'Splice → pop', min: 0, max: 1, step: 0.001, def: 0.7, hint: 'A splice through the gate is a splice past the sound head.' },
      { key: 'link.dirtToCrackle', type: 'float', label: 'Dirt → crackle', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'The same dirty print: dirt on the picture is dirt on the track.' },
      { key: 'link.lampToHum', type: 'float', label: 'Lamp → hum', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'One supply feeds the lamp and the exciter: ripple in one is hum in the other.' },
      { key: 'link.speedToPitch', type: 'float', label: 'Speed → pitch', min: 0, max: 1, step: 0.001, def: 1, hint: 'A camera running slow records its sound slow too.' },
      { key: 'link.audioToLamp', type: 'float', label: 'Audio → lamp', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Loud passages draw on the supply and the picture dims.' },
    ],
  },
];

export const GROUPS: Group[] = [
  ...ENGINE_GROUP,
  ...STOCK_GROUPS,
  ...LENS_GROUPS,
  ...GATE_GROUPS,
  ...AUDIO_GROUPS,
  ...LINK_GROUPS,
];

/* ------------------------------------------------------------------ *
 * Derived lookups
 * ------------------------------------------------------------------ */

export const PARAMS: Param[] = GROUPS.flatMap((g) => g.params);

export const PARAM_BY_KEY: Record<string, Param> = Object.fromEntries(
  PARAMS.map((p) => [p.key, p]),
);

export const GROUP_BY_ID: Record<string, Group> = Object.fromEntries(
  GROUPS.map((g) => [g.id, g]),
);

export const DEFAULTS: Settings = Object.fromEntries(
  PARAMS.map((p) => [p.key, p.def]),
) as Settings;

/** Which master switch owns which tab. */
const ENGINE_OF: Partial<Record<GroupKind, string>> = {
  stock: 'engine.stock',
  lens: 'engine.lens',
  gate: 'engine.gate',
};

/**
 * Fold the engine masters down into the per-section bypasses.
 *
 * Rather than teaching both renderers about a second layer of switches, a
 * master simply forces every enable key in its half off. That means the
 * bypass logic stays in one place, the GPU and CPU backends cannot disagree
 * about it, and a master behaves exactly as if you had flipped the sections
 * by hand — because that is what it does.
 *
 * Returns the settings untouched in the ordinary case, so the common path
 * allocates nothing.
 */
export function applyEngineMasters(s: Settings): Settings {
  const off = Object.values(ENGINE_OF).filter((k) => s[k as string] === false);
  if (off.length === 0) return s;

  const out: Settings = { ...s };
  for (const g of GROUPS) {
    if (!g.enableKey) continue;
    const master = ENGINE_OF[g.kind];
    if (master && s[master] === false) out[g.enableKey] = false;
  }
  return out;
}

/** Numeric code for an enum value, for shaders and DSP. */
export function enumCode(key: string, value: ParamValue): number {
  const p = PARAM_BY_KEY[key];
  if (!p || p.type !== 'enum') return 0;
  const idx = p.options.findIndex((o) => o.value === value);
  if (idx < 0) return p.options[0]?.code ?? 0;
  return p.options[idx].code ?? idx;
}

/* ------------------------------------------------------------------ *
 * Validation / coercion — presets come from the clipboard and from disk,
 * so nothing that arrives is trusted.
 * ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function coerce(param: Param, raw: unknown): ParamValue {
  switch (param.type) {
    case 'bool':
      return typeof raw === 'boolean' ? raw : raw === 'true' || raw === 1;
    case 'int': {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(clamp(n, param.min, param.max)) : param.def;
    }
    case 'float': {
      const n = Number(raw);
      return Number.isFinite(n) ? clamp(n, param.min, param.max) : param.def;
    }
    case 'enum': {
      const s = String(raw);
      return param.options.some((o) => o.value === s) ? s : param.def;
    }
  }
}

/** Merge an untrusted partial settings object onto a base, dropping junk. */
export function sanitize(raw: unknown, base: Settings = DEFAULTS): Settings {
  const out: Settings = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const param = PARAM_BY_KEY[key];
    if (!param) continue;
    out[key] = coerce(param, value);
  }
  return out;
}

/** Only the values that differ from the defaults — presets stay readable. */
export function diffFromDefaults(settings: Settings): Settings {
  const out: Settings = {};
  for (const p of PARAMS) {
    if (settings[p.key] !== undefined && settings[p.key] !== p.def) {
      out[p.key] = settings[p.key];
    }
  }
  return out;
}

export function num(settings: Settings, key: string): number {
  const v = settings[key];
  return typeof v === 'number' ? v : Number(v) || 0;
}

export function bool(settings: Settings, key: string): boolean {
  return settings[key] === true;
}

export function str(settings: Settings, key: string): string {
  const v = settings[key];
  return typeof v === 'string' ? v : String(v ?? '');
}

/** Enum code, read straight out of a settings object. */
export function code(settings: Settings, key: string): number {
  return enumCode(key, settings[key]);
}
