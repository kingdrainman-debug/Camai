/**
 * CAMAI parameter schema.
 *
 * This file is the single source of truth for the whole application. The
 * settings panel, the shader uniforms, the Web Audio graph, the preset format,
 * the CLI flags, the randomiser and the keyframe timeline are all generated
 * from it, so a parameter only ever has to be described once.
 *
 * Settings themselves are a flat `Record<dottedKey, number | boolean | string>`
 * which makes presets trivially diffable and hand-editable.
 *
 * The groups follow the chain the picture actually travels through a
 * consumer camcorder: an operator holding it, a small lens, a CCD the size of
 * a fingernail read out in fields, an automatic camera chasing exposure,
 * focus and colour, a DSP that sharpens every edge (Camera); a codec with a
 * fixed bit budget and a tape that drops out (Tape); and the screen it was
 * finally watched on, the overlays drawn on the way, the capture card and the
 * 2006 web upload (Display). Then the sound, which the camera always has.
 *
 * Where a quantity belongs to the medium — a smear column, an 8×8 block, an
 * OSD glyph, a grain of gain noise — it is specified in sensor or DV-raster
 * pixels and converted once at the end, so that a block is 8×8 in the DV
 * raster whatever size the output is.
 */

export type ParamValue = number | boolean | string;

export interface ParamCommon {
  /** Dotted key, e.g. `codec.budget`. Unique across the whole schema. */
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

export type GroupKind = 'global' | 'camera' | 'tape' | 'display' | 'audio' | 'link';

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

const SYSTEMS: EnumOption[] = [
  { value: 'ntsc', label: '525/60 (NTSC)', code: 0, hint: '720 × 480, 29.97 frames and 59.94 fields a second, 4:1:1 chroma.' },
  { value: 'pal', label: '625/50 (PAL)', code: 1, hint: '720 × 576, 25 frames and 50 fields a second, 4:2:0 chroma.' },
];

const TAPES: EnumOption[] = [
  { value: 'minidv', label: 'MiniDV', code: 0, hint: 'The DV stream on 6.35 mm metal-evaporated tape.' },
  { value: 'digital8', label: 'Digital8', code: 1, hint: 'The same DV stream recorded on Hi8 tape at twice the speed. Decodes identically; the tape drops out a little more.' },
];

const SENSORS: EnumOption[] = [
  { value: 'ccd1', label: 'Single CCD, complementary mosaic', code: 0, hint: 'The consumer palmcorder: one interline CCD under cyan, magenta, yellow and green filters, read in field-summed pairs. Low colour resolution, false colour, muddy reds, and it smears.' },
  { value: 'ccd3', label: 'Three CCDs on a prism', code: 1, hint: 'The prosumer camera: a prism splits the light onto three chips. Clean colour, and it still smears.' },
  { value: 'cmos1', label: 'Single CMOS, Bayer mosaic', code: 2, hint: 'From about 2006. No smear; a rolling shutter instead, so verticals lean on a pan.' },
];

const SENSOR_SIZES: EnumOption[] = [
  { value: '1/6', label: '1/6 inch (2.4 × 1.8 mm)', code: 0, hint: 'The cheapest palmcorders. Tiny photosites: noisy, and diffraction-limited early.' },
  { value: '1/4', label: '1/4 inch (3.6 × 2.7 mm)', code: 1, hint: 'Most mid-range consumer cameras.' },
  { value: '1/3.6', label: '1/3.6 inch (4.0 × 3.0 mm)', code: 2 },
  { value: '1/3', label: '1/3 inch (4.8 × 3.6 mm)', code: 3, hint: 'Three-chip prosumer cameras, per chip.' },
];

const ASPECTS: EnumOption[] = [
  { value: '4:3', label: '4:3', code: 0, hint: 'The sensor’s own shape.' },
  { value: '16:9', label: '16:9 (cropped sensor)', code: 1, hint: 'What most consumer cameras called 16:9: the middle three quarters of a 4:3 sensor’s rows, stretched to fill the raster and flagged anamorphic. Less vertical resolution, not more picture.' },
];

const ADAPTERS: EnumOption[] = [
  { value: 'none', label: 'None', code: 0 },
  { value: 'wide', label: 'Wide-angle (0.6×)', code: 1, hint: 'A screw-on converter: wider, with barrel distortion and soft corners.' },
  { value: 'fisheye', label: 'Fisheye (0.3×)', code: 2, hint: 'The skate-video adapter: very heavy barrel distortion, a soft rim and a hard round vignette.' },
];

const AE_MODES: EnumOption[] = [
  { value: 'auto', label: 'Automatic', code: 0, hint: 'Iris, shutter and gain chased together, with lag.' },
  { value: 'manual', label: 'Locked', code: 1, hint: 'Exposure held where the settings below put it.' },
];

const SHUTTERS: EnumOption[] = [
  { value: 'auto', label: 'Automatic', code: 0, hint: 'The camera raises the shutter speed in bright light rather than stopping the iris down into diffraction.' },
  { value: '15', label: '1/15 s (slow)', code: 15, hint: 'Integrates over four fields: fields repeat and motion smears into stuttering trails.' },
  { value: '30', label: '1/30 s (slow)', code: 30 },
  { value: '60', label: '1/60 s (1/50 PAL)', code: 60, hint: 'One field period: the normal video shutter.' },
  { value: '100', label: '1/100 s', code: 100 },
  { value: '250', label: '1/250 s', code: 250 },
  { value: '500', label: '1/500 s', code: 500 },
  { value: '1000', label: '1/1000 s', code: 1000 },
  { value: '2000', label: '1/2000 s', code: 2000 },
  { value: '4000', label: '1/4000 s', code: 4000 },
];

const ILLUMINANTS: EnumOption[] = [
  { value: 'neutral', label: 'As the footage was', code: 0, hint: 'Treat the source as already lit for the camera: no cast for the white balance to fight.' },
  { value: 'daylight', label: 'Daylight (5600 K)', code: 1 },
  { value: 'tungsten', label: 'Tungsten (3200 K)', code: 2, hint: 'Living-room bulbs. An automatic camera never fully corrects it.' },
  { value: 'household', label: 'Household bulb (2800 K)', code: 3 },
  { value: 'fluorescent', label: 'Fluorescent tube', code: 4, hint: 'A spiky green spectrum; consumer AWB left it green.' },
  { value: 'overcast', label: 'Overcast or shade (7500 K)', code: 5 },
];

const WB_MODES: EnumOption[] = [
  { value: 'auto', label: 'Automatic', code: 0, hint: 'Grey world over the whole frame, slow, and limited in range.' },
  { value: 'indoor', label: 'Indoor preset (3200 K)', code: 1 },
  { value: 'outdoor', label: 'Outdoor preset (5600 K)', code: 2 },
  { value: 'hold', label: 'Held', code: 3, hint: 'Whatever the camera had settled on when the clip began.' },
];

const DZOOM_FILTERS: EnumOption[] = [
  { value: 'nearest', label: 'Pixel repeat', code: 0, hint: 'The cheapest cameras: sensor pixels simply duplicated.' },
  { value: 'linear', label: 'Linear interpolation', code: 1 },
];

const EFFECTS: EnumOption[] = [
  { value: 'none', label: 'None', code: 0 },
  { value: 'sepia', label: 'Sepia', code: 1 },
  { value: 'bw', label: 'Black and white', code: 2 },
  { value: 'oldmovie', label: '“Old movie”', code: 3, hint: 'Sepia, a jittering frame and a field-rate flicker, as the in-camera effect did it.' },
  { value: 'mosaic', label: 'Mosaic', code: 4 },
  { value: 'strobe', label: 'Strobe', code: 5, hint: 'Holds every frame for several, in the camera’s field memory.' },
  { value: 'trail', label: 'Trail', code: 6, hint: 'Mixes in the previous field from memory, so motion leaves a ghost.' },
  { value: 'negative', label: 'Negative art', code: 7 },
];

const FADERS: EnumOption[] = [
  { value: 'none', label: 'None', code: 0 },
  { value: 'black', label: 'From black', code: 1 },
  { value: 'white', label: 'From white', code: 2 },
];

const TAPE_SPEEDS: EnumOption[] = [
  { value: 'sp', label: 'SP (18.81 mm/s)', code: 0 },
  { value: 'lp', label: 'LP (12.56 mm/s)', code: 1, hint: 'Narrower tracks: more errors, and worse on any other deck.' },
];

const CONCEALS: EnumOption[] = [
  { value: 'previous', label: 'Previous frame', code: 0, hint: 'What most decoders did: the lost macroblock is taken from the frame before.' },
  { value: 'grey', label: 'Grey blocks', code: 1 },
  { value: 'green', label: 'Green blocks', code: 2, hint: 'An undecoded block, zero in Y′CbCr, comes out green.' },
];

const INSERTS: EnumOption[] = [
  { value: 'precodec', label: 'Burned in, before the codec', code: 0, hint: 'Mixed into the picture before it was recorded, so it carries DCT ringing and chroma bleed.' },
  { value: 'decode', label: 'After decode', code: 1, hint: 'Drawn over the decoded picture by the camera or deck: crisp on top of the blocks. Whatever follows still softens it.' },
  { value: 'display', label: 'On the display', code: 2, hint: 'Drawn on the final screen’s own pixel grid, after every stage.' },
];

const DATE_FORMATS: EnumOption[] = [
  { value: 'us', label: 'JAN 15 2003', code: 0 },
  { value: 'eu', label: '15.1.2003', code: 1 },
  { value: 'iso', label: '2003 1 15', code: 2 },
];

const TIME_FORMATS: EnumOption[] = [
  { value: '12', label: '12-hour (12:34:56 PM)', code: 0 },
  { value: '24', label: '24-hour', code: 1 },
];

const OSD_COLOURS: EnumOption[] = [
  { value: 'white', label: 'White', code: 0 },
  { value: 'yellow', label: 'Yellow', code: 1 },
  { value: 'orange', label: 'Orange', code: 2, hint: 'The colour of many analogue date imprints.' },
];

const OSD_FONTS: EnumOption[] = [
  { value: 'classic', label: 'Classic 5 × 7', code: 0, hint: 'The plain dot-matrix characters most cameras drew.' },
  { value: 'bold', label: 'Bold', code: 1, hint: 'Strokes a pixel wider: heavier and easier to read on a busy picture.' },
  { value: 'italic', label: 'Italic', code: 2, hint: 'Leaning to the right.' },
  { value: 'segment', label: 'Seven-segment', code: 3, hint: 'Digits built from segments, like a clock radio’s display. Letters stay dot-matrix.' },
  { value: 'large', label: 'Large', code: 4, hint: 'Twice the size: the chunky imprint of many cameras’ date.' },
  { value: 'dotmatrix', label: 'Dot matrix', code: 5, hint: 'Twice the size, every dot separate.' },
  { value: 'hollow', label: 'Hollow', code: 6, hint: 'Twice the size, in outline.' },
];

const OSD_EDGES: EnumOption[] = [
  { value: 'outline', label: 'Black outline', code: 0, hint: 'A one-pixel black edge all round, so it reads on any picture.' },
  { value: 'shadow', label: 'Drop shadow', code: 1, hint: 'A black shadow below and to the right.' },
  { value: 'none', label: 'None', code: 2, hint: 'Bare ink, which disappears against a bright sky.' },
];

const BATTERY_STYLES: EnumOption[] = [
  { value: 'bars4', label: 'Four bars', code: 0 },
  { value: 'bars3', label: 'Three bars', code: 1 },
  { value: 'bars5', label: 'Five thin bars', code: 2 },
  { value: 'fill', label: 'Continuous fill', code: 3 },
  { value: 'vertical', label: 'Upright', code: 4, hint: 'Standing on end, filling from the bottom.' },
  { value: 'percent', label: 'Percentage', code: 5, hint: 'A small gauge with the charge as a number.' },
  { value: 'minutes', label: 'Minutes left', code: 6, hint: 'The time remaining, as later batteries reported it.' },
  { value: 'lowonly', label: 'Only when low', code: 7, hint: 'Nothing until the battery is nearly flat, then an empty outline.' },
];

const COUNTERS: EnumOption[] = [
  { value: 'timecode', label: 'Timecode', code: 0 },
  { value: 'remain', label: 'Minutes remaining', code: 1 },
];

const CAPTURE_PATHS: EnumOption[] = [
  { value: 'firewire', label: 'FireWire (bit-exact)', code: 0, hint: 'The DV stream copied as it is. Identity.' },
  { value: 'svideo', label: 'S-Video to a capture card', code: 1, hint: 'Luma and chroma on separate wires: no dot crawl, softer, chroma delayed.' },
  { value: 'composite', label: 'Composite to a capture card', code: 2, hint: 'One wire. Dot crawl, cross-colour and a soft picture, overlays included.' },
];

const COMBS: EnumOption[] = [
  { value: 'notch', label: 'Notch filter', code: 1, hint: 'A cheap card: soft luma and plenty of cross-colour.' },
  { value: 'comb', label: 'Two-line comb', code: 3, hint: 'A better card: sharper, with fringes on vertical colour edges.' },
];

const DEINTERLACERS: EnumOption[] = [
  { value: 'weave', label: 'Weave', code: 0, hint: 'Both fields kept: combing (“mice teeth”) on anything that moves.' },
  { value: 'bob', label: 'Bob', code: 1, hint: 'Each field line-doubled on its own: no combing, but thin lines twitter. At field rate when the output rate allows.' },
  { value: 'blend', label: 'Blend', code: 2, hint: 'The two fields averaged: motion ghosts.' },
  { value: 'discard', label: 'Discard one field', code: 3, hint: 'Half the lines thrown away: the early web-video look.' },
];

const SCALERS: EnumOption[] = [
  { value: 'nearest', label: 'Nearest', code: 0 },
  { value: 'bilinear', label: 'Bilinear', code: 1 },
  { value: 'good', label: 'Good resampling', code: 2, hint: 'A windowed-sinc resampler.' },
];

const OUTPUT_RATES: EnumOption[] = [
  { value: 'native', label: 'Frame rate (29.97 / 25)', code: 0 },
  { value: 'field', label: 'Field rate (59.94 / 50)', code: 1, hint: 'One output frame per field: what bob deinterlacing wants.' },
];

const OUTPUT_ASPECTS: EnumOption[] = [
  { value: 'camera', label: 'As recorded', code: 0, hint: '4:3, or 16:9 when the camera was in its 16:9 mode.' },
  { value: '4:3', label: '4:3', code: 1 },
  { value: '16:9', label: '16:9', code: 2 },
];

const LEVELS: EnumOption[] = [
  { value: 'studio', label: 'Studio (16–235)', code: 0, hint: 'Reference white is white; superwhites above it clip.' },
  { value: 'full', label: 'Full range', code: 1, hint: 'The whole coding range mapped to the screen: superwhites kept, blacks grey.' },
];

const AUDIO_MODES: EnumOption[] = [
  { value: '16', label: '16-bit, 48 kHz, stereo', code: 0 },
  { value: '12', label: '12-bit, 32 kHz, four channels', code: 1, hint: 'What many cameras shipped set to: non-linear 12-bit, band-limited near 15 kHz.' },
];

const CHANNEL_MODES: EnumOption[] = [
  { value: 'stereo', label: 'Stereo', code: 0 },
  { value: 'mono', label: 'Mono (L+R)', code: 1 },
];

/* ------------------------------------------------------------------ *
 * Engine masters
 *
 * One switch per engine. Each section already has its own bypass, but turning
 * off "the camera" meant flipping a dozen of them. They are real parameters
 * rather than interface state so that they travel in a preset, and they fold
 * down into the section switches (see applyEngineMasters) so that the
 * renderers never learn about them.
 *
 * Each covers exactly the tab of its name. The format group (system, tape,
 * sensor type) has no switch at all: it is not an effect, it is which machine
 * this is, and every engine reads it.
 * ------------------------------------------------------------------ */

const ENGINE_GROUP: Group[] = [
  {
    id: 'engine',
    label: 'Engines',
    kind: 'global',
    hint: 'Master bypass for each of the three engines.',
    params: [
      { key: 'engine.camera', type: 'bool', label: 'Camera engine', def: true, noRandom: true, hint: 'The operator, lens, sensor, automatics and DSP.' },
      { key: 'engine.tape', type: 'bool', label: 'Tape engine', def: true, noRandom: true, hint: 'Interlace, chroma subsampling, the DV codec, the tape and recording breaks.' },
      { key: 'engine.display', type: 'bool', label: 'Display engine', def: true, noRandom: true, hint: 'Overlays, capture, deinterlacing, the web upload.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Camera
 * ------------------------------------------------------------------ */

const CAMERA_GROUPS: Group[] = [
  {
    id: 'format',
    label: 'Format',
    kind: 'camera',
    hint: 'Which machine this is. Every other section reads these.',
    params: [
      { key: 'format.system', type: 'enum', label: 'System', options: SYSTEMS, def: 'ntsc', noRandom: true, hint: 'Raster, field rate and chroma subsampling.' },
      { key: 'format.tape', type: 'enum', label: 'Tape', options: TAPES, def: 'minidv', noRandom: true, hint: 'What the DV stream was recorded on.' },
      { key: 'format.sensor', type: 'enum', label: 'Sensor', options: SENSORS, def: 'ccd1', noRandom: true, hint: 'One CCD, three CCDs or one CMOS: a fork, not a slider.' },
      { key: 'format.sensorSize', type: 'enum', label: 'Sensor size', options: SENSOR_SIZES, def: '1/4', noRandom: true, hint: 'Sets noise, the gain the camera needs and where diffraction starts.' },
      { key: 'format.aspect', type: 'enum', label: 'Aspect', options: ASPECTS, def: '4:3', noRandom: true, hint: 'The camera’s 4:3 or cropped 16:9 mode.' },
    ],
  },
  {
    id: 'operator',
    label: 'Operator',
    kind: 'camera',
    enableKey: 'operator.enabled',
    hint: 'The person holding it, who is not a camera operator.',
    params: [
      { key: 'operator.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'operator.tremor', type: 'float', label: 'Hand tremor', min: 0, max: 0.5, step: 0.001, def: 0.06, unit: '°', hint: 'Physiological tremor, 8–12 Hz, in degrees of camera rotation.' },
      { key: 'operator.sway', type: 'float', label: 'Sway', min: 0, max: 3, step: 0.001, def: 0.35, unit: '°', hint: 'The slow drift of arms that are not braced, below 2 Hz.' },
      { key: 'operator.walk', type: 'float', label: 'Walking', min: 0, max: 3, step: 0.001, def: 0, unit: '°', hint: 'The bob and roll of every step, while walking.' },
      { key: 'operator.cadence', type: 'float', label: 'Step rate', min: 1, max: 3, step: 0.01, def: 1.9, unit: 'Hz', advanced: true, hint: 'Steps per second.' },
      { key: 'operator.bumps', type: 'float', label: 'Handling bumps', min: 0, max: 20, step: 0.1, def: 0, unit: '/min', hint: 'A hand shifting its grip: a jolt, and a thump on the microphone.' },
      { key: 'operator.bumpSize', type: 'float', label: 'Bump size', min: 0.1, max: 5, step: 0.01, def: 1.2, unit: '°', advanced: true, hint: 'How far a bump throws the frame.' },
      { key: 'operator.whips', type: 'float', label: 'Whip pans', min: 0, max: 10, step: 0.1, def: 0, unit: '/min', hint: 'Fast swings to somewhere else, and back.' },
      { key: 'operator.whipAngle', type: 'float', label: 'Whip angle', min: 5, max: 90, step: 0.1, def: 35, unit: '°', advanced: true, hint: 'How far a whip pan swings.' },
      { key: 'operator.pan', type: 'float', label: 'Pan', min: -60, max: 60, step: 0.01, def: 0, unit: '°', hint: 'Where the camera is pointing, left and right. Keyframe it for a deliberate pan.' },
      { key: 'operator.tilt', type: 'float', label: 'Tilt', min: -40, max: 40, step: 0.01, def: 0, unit: '°', hint: 'Where the camera is pointing, up and down.' },
      { key: 'operator.roll', type: 'float', label: 'Roll', min: -20, max: 20, step: 0.01, def: 0, unit: '°', advanced: true, hint: 'A horizon that is not level.' },
    ],
  },
  {
    id: 'lens',
    label: 'Lens',
    kind: 'camera',
    enableKey: 'lens.enabled',
    hint: 'A small, slow 10× to 25× zoom, and whatever is screwed onto its front.',
    params: [
      { key: 'lens.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'lens.zoom', type: 'float', label: 'Zoom', min: 1, max: 500, step: 0.001, def: 1, log: true, unit: '×', hint: 'The zoom position, optical and then digital. Animate it: the motor is heard while it moves.' },
      { key: 'lens.range', type: 'float', label: 'Optical range', min: 6, max: 25, step: 0.1, def: 10, unit: '×', advanced: true, hint: 'The longest optical zoom. Beyond it, digital zoom takes over if enabled.' },
      { key: 'lens.fov', type: 'float', label: 'Widest view', min: 30, max: 70, step: 0.1, def: 48, unit: '°', advanced: true, hint: 'Horizontal field of view at the wide end. The source frame is treated as this wide.' },
      { key: 'lens.softness', type: 'float', label: 'Softness', min: 0, max: 3, step: 0.001, def: 0.55, unit: 'px', hint: 'Blur at the centre, in DV-raster pixels.' },
      { key: 'lens.corners', type: 'float', label: 'Corner softness', min: 0, max: 4, step: 0.001, def: 1.2, unit: 'px', hint: 'Extra blur towards the corners.' },
      { key: 'lens.vignette', type: 'float', label: 'Vignetting', min: 0, max: 1.5, step: 0.001, def: 0.25, unit: 'stops', hint: 'Light falloff at the corners, more at the wide end.' },
      { key: 'lens.chromatic', type: 'float', label: 'Chromatic aberration', min: 0, max: 4, step: 0.001, def: 1, unit: 'px', hint: 'Lateral colour at the corners at the long end, in pixels.' },
      { key: 'lens.flare', type: 'float', label: 'Veiling flare', min: 0, max: 0.2, step: 0.0001, def: 0.025, hint: 'Light scattered across the frame by cheap coatings, lifting the blacks around bright things.' },
      { key: 'lens.diffraction', type: 'float', label: 'Diffraction', min: 0, max: 2, step: 0.001, def: 1, unit: '×', advanced: true, hint: 'Softening at small apertures, as a multiple of the physical Airy disc for this sensor size.' },
      { key: 'lens.adapter', type: 'enum', label: 'Adapter', options: ADAPTERS, def: 'none', hint: 'A converter screwed onto the front.' },
      { key: 'lens.distortion', type: 'float', label: 'Distortion', min: -0.3, max: 0.3, step: 0.001, def: 0.02, hint: 'Barrel (positive) distortion of the zoom itself at the wide end.' },
    ],
  },
  {
    id: 'exposure',
    label: 'Exposure',
    kind: 'camera',
    enableKey: 'exposure.enabled',
    hint: 'How much light there was, and the automatic camera chasing it with iris, shutter and gain.',
    params: [
      { key: 'exposure.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'exposure.scene', type: 'float', label: 'Scene light', min: -4, max: 12, step: 0.01, def: 4, unit: 'stops', hint: 'How bright the world is, in stops above the light that needs f/1.6 at 1/60 s with no gain: about 0 in a lamp-lit room, 6 under cloud, 10 in sun. Animate it to walk outside.' },
      { key: 'exposure.mode', type: 'enum', label: 'Mode', options: AE_MODES, def: 'auto', hint: 'Automatic, or held.' },
      { key: 'exposure.comp', type: 'float', label: 'Compensation', min: -2, max: 2, step: 0.01, def: 0, unit: 'stops', hint: 'The exposure wheel, or the manual exposure setting when locked.' },
      { key: 'exposure.speed', type: 'float', label: 'Reaction time', min: 0.1, max: 4, step: 0.01, def: 0.8, unit: 's', log: true, hint: 'How long the automatic exposure takes to catch up.' },
      { key: 'exposure.damping', type: 'float', label: 'Damping', min: 0.2, max: 1.5, step: 0.001, def: 0.55, advanced: true, hint: 'Below 1 the exposure overshoots and pumps back; 1 is a smooth approach.' },
      { key: 'exposure.backlight', type: 'bool', label: 'Backlight compensation', def: false, hint: 'Meters for the middle and opens up 1.5 stops, so a bright window burns out.' },
      { key: 'exposure.shutter', type: 'enum', label: 'Shutter', options: SHUTTERS, def: 'auto', hint: 'The CCD’s electronic shutter.' },
      { key: 'exposure.maxGain', type: 'float', label: 'Gain limit', min: 0, max: 30, step: 0.1, def: 18, unit: 'dB', hint: 'How far the camera will boost the signal in the dark. Gain is in steps of 3 dB.' },
      { key: 'exposure.hunt', type: 'float', label: 'Flicker hunting', min: 0, max: 1, step: 0.001, def: 0, advanced: true, hint: 'How much the exposure chases mains flicker and changing light rather than averaging it.' },
    ],
  },
  {
    id: 'sensor',
    label: 'Sensor',
    kind: 'camera',
    enableKey: 'sensor.enabled',
    hint: 'The chip: its mosaic, its wells, its smear and its noise.',
    params: [
      { key: 'sensor.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'sensor.well', type: 'float', label: 'Full well', min: 0.6, max: 3, step: 0.001, def: 1.25, unit: '× white', hint: 'Where each photosite stops collecting charge, relative to reference white. It clips there, colour by colour.' },
      { key: 'sensor.smear', type: 'float', label: 'Vertical smear', min: 0, max: 0.1, step: 0.00001, def: 0.01, hint: 'Charge leaking into the vertical registers during readout, at 1/60 s. Grows as the shutter gets faster. CCD only.' },
      { key: 'sensor.bloom', type: 'float', label: 'Blooming', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'How far an overflowing well spills into its neighbours, mostly up and down the column.' },
      { key: 'sensor.crosstalk', type: 'float', label: 'Filter overlap', min: 0, max: 0.4, step: 0.001, def: 0.15, hint: 'How much each colour filter passes of the colours it should block. The complementary mosaic’s broad filters are why its reds are muddy.' },
      { key: 'sensor.noise', type: 'float', label: 'Read noise', min: 0, max: 0.05, step: 0.0001, def: 0.006, hint: 'Noise at 0 dB, before gain multiplies it. Coarse and coloured once the mosaic is decoded.' },
      { key: 'sensor.shot', type: 'float', label: 'Shot noise', min: 0, max: 0.05, step: 0.0001, def: 0.01, advanced: true, hint: 'Photon noise, rising with the square root of the signal.' },
      { key: 'sensor.headroom', type: 'float', label: 'Highlight headroom', min: 0, max: 10, step: 0.01, def: 3, unit: 'stops', hint: 'How far above its own clip the source’s brightest highlights are taken to be. A source clipped at white cannot say how bright the sun was; a CCD can tell, by smearing.' },
      { key: 'sensor.rolling', type: 'float', label: 'Readout time', min: 0, max: 1, step: 0.001, def: 0.85, unit: '× field', advanced: true, hint: 'How long a rolling shutter takes to read top to bottom, as a fraction of the field period. CMOS only.' },
    ],
  },
  {
    id: 'focus',
    label: 'Autofocus',
    kind: 'camera',
    enableKey: 'focus.enabled',
    hint: 'Contrast-detection autofocus: it hunts.',
    params: [
      { key: 'focus.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'focus.hunts', type: 'float', label: 'Hunting', min: 0, max: 10, step: 0.01, def: 0.6, unit: '/min', hint: 'How often it loses focus and breathes in and out looking for it. It also hunts after every recording break.' },
      { key: 'focus.depth', type: 'float', label: 'Hunt depth', min: 0, max: 8, step: 0.01, def: 3, unit: 'px', hint: 'How far out of focus a hunt goes, in DV pixels of blur.' },
      { key: 'focus.miss', type: 'float', label: 'Missed focus', min: 0, max: 4, step: 0.01, def: 0, unit: 'px', hint: 'A constant error: focus locked on the background behind a near subject.' },
    ],
  },
  {
    id: 'wb',
    label: 'White Balance',
    kind: 'camera',
    enableKey: 'wb.enabled',
    hint: 'The light the scene was lit by, and the camera’s automatic attempt to make it white.',
    params: [
      { key: 'wb.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'wb.light', type: 'enum', label: 'Light', options: ILLUMINANTS, def: 'neutral', hint: 'What the scene was lit by.' },
      { key: 'wb.mode', type: 'enum', label: 'Mode', options: WB_MODES, def: 'auto', hint: 'Automatic, a preset or held.' },
      { key: 'wb.speed', type: 'float', label: 'Drift time', min: 0.5, max: 20, step: 0.01, def: 4, unit: 's', log: true, hint: 'How slowly the automatic balance follows.' },
      { key: 'wb.range', type: 'float', label: 'Correction range', min: 0, max: 1, step: 0.001, def: 0.45, hint: 'How much of a cast the automatic balance can remove. Consumer cameras stopped well short of tungsten.' },
      { key: 'wb.tint', type: 'float', label: 'Fixed tint', min: -1, max: 1, step: 0.001, def: 0, advanced: true, hint: 'A residual green–magenta error in the camera’s matrix.' },
    ],
  },
  {
    id: 'eis',
    label: 'Stabiliser',
    kind: 'camera',
    enableKey: 'eis.enabled',
    hint: 'Electronic image stabilisation: a moving crop of the sensor.',
    params: [
      { key: 'eis.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'eis.margin', type: 'float', label: 'Margin', min: 0.03, max: 0.25, step: 0.001, def: 0.1, hint: 'The share of the sensor kept in reserve on each side. A narrower view and a little less resolution.' },
      { key: 'eis.strength', type: 'float', label: 'Strength', min: 0, max: 1, step: 0.001, def: 0.85, hint: 'How much of the shake the crop cancels. It cannot cancel the blur.' },
    ],
  },
  {
    id: 'dzoom',
    label: 'Digital Zoom',
    kind: 'camera',
    enableKey: 'dzoom.enabled',
    hint: 'Past the optical range by enlarging a shrinking crop of the sensor.',
    params: [
      { key: 'dzoom.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'dzoom.max', type: 'float', label: 'Digital limit', min: 1, max: 50, step: 0.1, def: 20, unit: '×', log: true, hint: 'How far past the optical zoom the camera will go (“500×” on the box was this times that).' },
      { key: 'dzoom.filter', type: 'enum', label: 'Upscaling', options: DZOOM_FILTERS, def: 'nearest', hint: 'How the crop is enlarged.' },
    ],
  },
  {
    id: 'tone',
    label: 'Knee & Gamma',
    kind: 'camera',
    enableKey: 'tone.enabled',
    hint: 'Video’s tone curve: a short knee and then a wall. The opposite of film.',
    params: [
      { key: 'tone.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'tone.gamma', type: 'float', label: 'Gamma', min: 0.35, max: 0.6, step: 0.001, def: 0.45, hint: 'The camera’s transfer exponent, with a linear toe as Rec. 601 cameras had.' },
      { key: 'tone.knee', type: 'float', label: 'Knee point', min: 0.6, max: 1, step: 0.001, def: 0.85, hint: 'Where, in signal level, the knee starts compressing highlights.' },
      { key: 'tone.slope', type: 'float', label: 'Knee slope', min: 0.05, max: 1, step: 0.001, def: 0.25, hint: 'How steep the compressed top of the curve is.' },
      { key: 'tone.clip', type: 'float', label: 'White clip', min: 100, max: 109, step: 0.1, def: 108, unit: 'IRE', hint: 'Where the signal hits the wall. DV codes up to about 109 IRE and consumer cameras used it.' },
      { key: 'tone.pedestal', type: 'float', label: 'Black level', min: -0.05, max: 0.1, step: 0.0001, def: 0, hint: 'Lifted or crushed blacks.' },
      { key: 'tone.saturation', type: 'float', label: 'Colour gain', min: 0, max: 2, step: 0.001, def: 1.1, hint: 'The camera’s chroma gain. Consumer cameras ran a little hot.' },
    ],
  },
  {
    id: 'detail',
    label: 'Detail Enhancement',
    kind: 'camera',
    enableKey: 'detail.enabled',
    hint: 'Aperture correction: the early-2000s sharpness. A peaking filter with coring and a limiter, before the codec.',
    params: [
      { key: 'detail.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'detail.gain', type: 'float', label: 'Gain', min: 0, max: 3, step: 0.001, def: 1, hint: 'How hard edges are boosted.' },
      { key: 'detail.freq', type: 'float', label: 'Frequency', min: 0.5, max: 3, step: 0.001, def: 1.2, unit: 'px', hint: 'The peaking filter’s reach in DV pixels: small is fine detail and thin halos, large is wide halos.' },
      { key: 'detail.vertical', type: 'float', label: 'Vertical share', min: 0, max: 1.5, step: 0.001, def: 0.6, hint: 'Vertical enhancement, as a share of the horizontal. It works across lines of one field, so it acts on interlace.' },
      { key: 'detail.coring', type: 'float', label: 'Coring', min: 0, max: 0.1, step: 0.0001, def: 0.012, hint: 'Detail below this is left alone, so low-level noise is not sharpened.' },
      { key: 'detail.limit', type: 'float', label: 'Limiter', min: 0.02, max: 0.5, step: 0.001, def: 0.18, hint: 'The largest boost any edge gets, so a halo has a ceiling.' },
      { key: 'detail.dark', type: 'float', label: 'Dark-side share', min: 0, max: 1.5, step: 0.001, def: 0.8, advanced: true, hint: 'How strong the dark fringe is compared with the bright one.' },
    ],
  },
  {
    id: 'battery',
    label: 'Battery',
    kind: 'camera',
    enableKey: 'battery.enabled',
    hint: 'It drains over the session, blinks when low, and at the end the camera stops recording.',
    params: [
      { key: 'battery.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'battery.charge', type: 'float', label: 'Charge at start', min: 0, max: 100, step: 0.1, def: 80, unit: '%', hint: 'How full it was at the first frame.' },
      { key: 'battery.capacity', type: 'float', label: 'Capacity', min: 0.2, max: 180, step: 0.1, def: 60, unit: 'min', log: true, hint: 'Minutes of recording on a full charge.' },
    ],
  },
  {
    id: 'night',
    label: 'Infrared Night Mode',
    kind: 'camera',
    enableKey: 'night.enabled',
    hint: 'The IR-cut filter swung out and an infrared LED lit.',
    params: [
      { key: 'night.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'night.ir', type: 'float', label: 'IR lamp', min: 0, max: 3, step: 0.001, def: 1.4, hint: 'How much the camera’s own infrared light adds, falling off from the middle of the frame.' },
      { key: 'night.spot', type: 'float', label: 'Hot spot', min: 0.1, max: 1, step: 0.001, def: 0.42, hint: 'The width of the lamp’s beam, as a share of the frame.' },
      { key: 'night.green', type: 'float', label: 'Green cast', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'The greenish monochrome of a colour sensor seeing only infrared.' },
      { key: 'night.eyes', type: 'float', label: 'Eye-shine', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'How strongly the brightest small highlights, the retro-reflections of eyes, glow.' },
    ],
  },
  {
    id: 'fx',
    label: 'Digital Effects',
    kind: 'camera',
    enableKey: 'fx.enabled',
    hint: 'The camera’s effects button and its fader.',
    params: [
      { key: 'fx.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'fx.effect', type: 'enum', label: 'Effect', options: EFFECTS, def: 'none', hint: 'The picture effect.' },
      { key: 'fx.fader', type: 'enum', label: 'Fader', options: FADERS, def: 'none', hint: 'A fade in at the start of each shot.' },
      { key: 'fx.faderTime', type: 'float', label: 'Fade length', min: 0.2, max: 4, step: 0.01, def: 1.5, unit: 's', hint: 'How long the fade takes.' },
      { key: 'fx.size', type: 'float', label: 'Effect size', min: 2, max: 32, step: 1, def: 12, unit: 'px', advanced: true, hint: 'Mosaic cell size, or strobe hold in frames.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Tape
 * ------------------------------------------------------------------ */

const TAPE_GROUPS: Group[] = [
  {
    id: 'interlace',
    label: 'Interlace',
    kind: 'tape',
    enableKey: 'interlace.enabled',
    hint: 'Fields: two moments to a frame, bottom first.',
    params: [
      { key: 'interlace.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'interlace.integration', type: 'bool', label: 'Field integration', def: true, hint: 'Sensor rows summed in pairs, the pairing alternating between fields: each field has less vertical resolution than half a frame.' },
      { key: 'interlace.lowerFirst', type: 'bool', label: 'Bottom field first', def: true, advanced: true, hint: 'DV is bottom field first in both systems. Off swaps the order, which is wrong for DV and here to prove it.' },
    ],
  },
  {
    id: 'chroma',
    label: 'Chroma Subsampling',
    kind: 'tape',
    enableKey: 'chroma.enabled',
    hint: '4:1:1 in 525/60, 4:2:0 in 625/50.',
    params: [
      { key: 'chroma.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'chroma.upsample', type: 'enum', label: 'Decoder upsampling', options: [{ value: 'nearest', label: 'Repeat', code: 0 }, { value: 'linear', label: 'Interpolate', code: 1 }], def: 'linear', hint: 'How the playback side fills chroma back out to full resolution.' },
    ],
  },
  {
    id: 'codec',
    label: 'DV Codec',
    kind: 'tape',
    enableKey: 'codec.enabled',
    hint: 'Intra-frame DCT at a constant 25 Mbit/s: quality is whatever the bit budget leaves.',
    params: [
      { key: 'codec.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'codec.budget', type: 'float', label: 'Bit budget', min: 0.25, max: 2, step: 0.001, def: 1, log: true, unit: '×', hint: 'The fixed size of each five-macroblock segment, as a multiple of DV’s. Below 1 is a starved encoder; above it is not DV.' },
      { key: 'codec.dct248', type: 'bool', label: '2-4-8 DCT', def: true, hint: 'Let blocks whose two fields differ code their sum and difference separately.' },
      { key: 'codec.shuffle', type: 'bool', label: 'Segment shuffle', def: true, advanced: true, hint: 'Build each segment from five macroblocks scattered across the frame, as DV does. Off takes five neighbours, which makes quality uneven.' },
      { key: 'codec.classes', type: 'bool', label: 'Activity classes', def: true, advanced: true, hint: 'Quantise busy blocks more coarsely than flat ones.' },
    ],
  },
  {
    id: 'tape',
    label: 'Tape Errors',
    kind: 'tape',
    enableKey: 'tape.enabled',
    hint: 'Dropouts are digital: lost DIF blocks, concealed on the macroblock grid.',
    params: [
      { key: 'tape.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'tape.speed', type: 'enum', label: 'Speed', options: TAPE_SPEEDS, def: 'sp', hint: 'SP or LP. LP multiplies the dropout rate.' },
      { key: 'tape.dropouts', type: 'float', label: 'Dropouts', min: 0, max: 60, step: 0.1, def: 2, unit: '/min', hint: 'Damaged stretches of track per minute.' },
      { key: 'tape.size', type: 'float', label: 'Dropout size', min: 0.02, max: 1, step: 0.001, def: 0.15, hint: 'How much of a track a dropout takes. At 1 the whole frame freezes and the sound mutes.' },
      { key: 'tape.conceal', type: 'enum', label: 'Concealment', options: CONCEALS, def: 'previous', hint: 'What the decoder puts in place of a lost macroblock.' },
      { key: 'tape.clogs', type: 'float', label: 'Head clogs', min: 0, max: 5, step: 0.01, def: 0, unit: '/min', hint: 'A clogged head: the whole picture freezes and breaks into blocks until the head cleans itself.' },
      { key: 'tape.clogLength', type: 'float', label: 'Clog length', min: 0.1, max: 5, step: 0.01, def: 0.8, unit: 's', advanced: true, hint: 'How long a clog lasts.' },
    ],
  },
  {
    id: 'breaks',
    label: 'Recording Breaks',
    kind: 'tape',
    enableKey: 'breaks.enabled',
    hint: 'Each press of REC is a new shot: a cut, a clunk and a clock that jumps.',
    params: [
      { key: 'breaks.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'breaks.rate', type: 'float', label: 'Shots per minute', min: 0, max: 20, step: 0.1, def: 3, unit: '/min', hint: 'How often the camera was stopped and started.' },
      { key: 'breaks.skip', type: 'float', label: 'Source skipped', min: 0, max: 5, step: 0.01, def: 0.6, unit: 's', hint: 'How much of the source is not recorded at each break, so the cut is a jump in the picture.' },
      { key: 'breaks.gap', type: 'float', label: 'Time between shots', min: 0.1, max: 240, step: 0.1, def: 12, unit: 'min', log: true, hint: 'Average wall-clock time that passed between shots. The date and time jump by it; the tape counter does not.' },
      { key: 'breaks.seamless', type: 'bool', label: 'Seamless backspace', def: true, hint: 'The camera backs the tape up before recording, so the cut is clean and the timecode continuous. Off leaves a frame of garbage and restarts the timecode.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

const DISPLAY_GROUPS: Group[] = [
  {
    id: 'osd',
    label: 'Camera Display',
    kind: 'display',
    enableKey: 'osd.enabled',
    hint: 'The viewfinder and LCD readout. Never recorded to tape: it is on the AV output when the display-output setting is on.',
    params: [
      { key: 'osd.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'osd.insert', type: 'enum', label: 'Path', options: INSERTS, def: 'decode', hint: 'Where it enters the chain. The default is the camera’s AV output with the display on.' },
      { key: 'osd.rec', type: 'bool', label: 'REC / STBY', def: true, hint: 'The recording indicator with its red dot.' },
      { key: 'osd.counter', type: 'enum', label: 'Counter', options: COUNTERS, def: 'timecode', hint: 'Tape position, or the tape left.' },
      { key: 'osd.battery', type: 'bool', label: 'Battery', def: true, hint: 'The battery gauge, which drains.' },
      { key: 'osd.batteryStyle', type: 'enum', label: 'Battery style', options: BATTERY_STYLES, def: 'bars4', hint: 'The shape of the gauge.' },
      { key: 'osd.zoomBar', type: 'bool', label: 'Zoom bar', def: true, hint: 'W to T, shown while zooming, with the digital zoom readout beyond it.' },
      { key: 'osd.mode', type: 'bool', label: 'Mode readout', def: true, hint: 'SP or LP, 12-bit or 16-bit, 16:9.' },
      { key: 'osd.warnings', type: 'bool', label: 'Warnings', def: true, advanced: true, hint: 'Blinking low-battery and end-of-tape warnings.' },
      { key: 'osd.font', type: 'enum', label: 'Font', options: OSD_FONTS, def: 'classic', hint: 'The character generator’s lettering.' },
      { key: 'osd.edge', type: 'enum', label: 'Edge', options: OSD_EDGES, def: 'outline', hint: 'How the lettering is set off from the picture.' },
      { key: 'osd.colour', type: 'enum', label: 'Colour', options: OSD_COLOURS, def: 'white', advanced: true, hint: 'The character generator’s ink.' },
    ],
  },
  {
    id: 'date',
    label: 'Date & Time',
    kind: 'display',
    enableKey: 'date.enabled',
    hint: 'A clock that is a model, not a string: wall time that jumps at each break.',
    params: [
      { key: 'date.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'date.insert', type: 'enum', label: 'Path', options: INSERTS, def: 'decode', hint: 'Imprinted before recording, or the data code drawn at playback.' },
      { key: 'date.format', type: 'enum', label: 'Date format', options: DATE_FORMATS, def: 'us', hint: 'Regional order.' },
      { key: 'date.clock', type: 'enum', label: 'Time format', options: TIME_FORMATS, def: '12', hint: '12-hour with AM and PM, or 24-hour.' },
      { key: 'date.year', type: 'int', label: 'Year', min: 1985, max: 2015, def: 2002, noRandom: true, hint: 'When the first shot was taken.' },
      { key: 'date.month', type: 'int', label: 'Month', min: 1, max: 12, def: 12, noRandom: true, hint: 'Month of the first shot.' },
      { key: 'date.day', type: 'int', label: 'Day', min: 1, max: 31, def: 25, noRandom: true, hint: 'Day of the first shot.' },
      { key: 'date.hour', type: 'float', label: 'Time of day', min: 0, max: 23.99, step: 0.01, def: 8.25, unit: 'h', noRandom: true, hint: 'Hour of the first shot, as a decimal.' },
      { key: 'date.unset', type: 'bool', label: 'Clock never set', def: false, hint: 'The camera shows its factory default instead of the date.' },
      { key: 'date.font', type: 'enum', label: 'Font', options: OSD_FONTS, def: 'classic', hint: 'The lettering of the date and time.' },
      { key: 'date.edge', type: 'enum', label: 'Edge', options: OSD_EDGES, def: 'outline', hint: 'How the date is set off from the picture.' },
      { key: 'date.colour', type: 'enum', label: 'Colour', options: OSD_COLOURS, def: 'white', advanced: true, hint: 'The ink of the date characters.' },
    ],
  },
  {
    id: 'capture',
    label: 'Capture',
    kind: 'display',
    enableKey: 'capture.enabled',
    hint: 'How the tape got into a computer.',
    params: [
      { key: 'capture.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'capture.path', type: 'enum', label: 'Path', options: CAPTURE_PATHS, def: 'firewire', hint: 'FireWire is identity; the analogue paths are not.' },
      { key: 'capture.decoder', type: 'enum', label: 'Card decoder', options: COMBS, def: 'notch', hint: 'How a composite capture separates colour from brightness.' },
      { key: 'capture.bandwidth', type: 'float', label: 'Luma bandwidth', min: 2, max: 5.5, step: 0.01, def: 4.2, unit: 'MHz', hint: 'How sharp the analogue path is.' },
      { key: 'capture.chromaDelay', type: 'float', label: 'Chroma delay', min: -4, max: 4, step: 0.01, def: 1.5, unit: 'px', hint: 'Colour arriving late, shifted right of the picture.' },
      { key: 'capture.noise', type: 'float', label: 'Noise', min: 0, max: 0.1, step: 0.0001, def: 0.008, hint: 'Noise picked up on the cable and the card.' },
      { key: 'capture.levels', type: 'enum', label: 'Levels', options: LEVELS, def: 'studio', advanced: true, hint: 'How the coding range was mapped: superwhites clipped or kept.' },
    ],
  },
  {
    id: 'deint',
    label: 'Deinterlacing',
    kind: 'display',
    enableKey: 'deint.enabled',
    hint: 'Whatever played or converted it chose this.',
    params: [
      { key: 'deint.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'deint.mode', type: 'enum', label: 'Method', options: DEINTERLACERS, def: 'weave', hint: 'Weave, bob, blend or discard.' },
    ],
  },
  {
    id: 'upload',
    label: 'Web Upload, 2006',
    kind: 'display',
    enableKey: 'upload.enabled',
    hint: 'A second lossy generation: small, one field gone, low frame rate.',
    params: [
      { key: 'upload.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'upload.width', type: 'int', label: 'Width', min: 160, max: 640, def: 320, unit: 'px', hint: 'The upload’s frame width; height follows the aspect.' },
      { key: 'upload.fps', type: 'float', label: 'Frame rate', min: 5, max: 30, step: 0.01, def: 15, unit: 'fps', hint: 'Frames kept per second.' },
      { key: 'upload.quality', type: 'float', label: 'Quantiser', min: 2, max: 31, step: 0.1, def: 9, hint: 'The second codec’s step size: bigger is blockier.' },
    ],
  },
  {
    id: 'framing',
    label: 'Output',
    kind: 'display',
    hint: 'The shape and rate of the file you make.',
    params: [
      { key: 'framing.aspect', type: 'enum', label: 'Aspect', options: OUTPUT_ASPECTS, def: 'camera', noRandom: true, hint: 'The output frame’s shape. The export is exactly this shape.' },
      { key: 'framing.overscan', type: 'bool', label: 'Full raster', def: false, noRandom: true, hint: 'Show all 720 samples rather than the 704-wide active picture.' },
      { key: 'framing.scaler', type: 'enum', label: 'Scaling', options: SCALERS, def: 'good', noRandom: true, hint: 'How the SD raster is enlarged to the output.' },
      { key: 'framing.fps', type: 'enum', label: 'Output rate', options: OUTPUT_RATES, def: 'native', noRandom: true, hint: 'One frame per DV frame, or one per field.' },
      { key: 'framing.dither', type: 'float', label: 'Dither', min: 0, max: 2, step: 0.01, def: 0.5, noRandom: true, advanced: true, hint: 'Breaks up banding when writing 8 bits.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Sound
 * ------------------------------------------------------------------ */

const AUDIO_GROUPS: Group[] = [
  {
    id: 'audio',
    label: 'DV Audio',
    kind: 'audio',
    enableKey: 'audio.enabled',
    hint: 'What the tape records: 16-bit at 48 kHz, or 12-bit at 32 kHz.',
    params: [
      { key: 'audio.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'audio.mode', type: 'enum', label: 'Recording mode', options: AUDIO_MODES, def: '16', hint: '16-bit or 12-bit.' },
      { key: 'audio.inputGain', type: 'float', label: 'Programme level', min: -30, max: 12, step: 0.1, def: 0, unit: 'dB', hint: 'Level of the source sound reaching the microphone.' },
      { key: 'audio.channels', type: 'enum', label: 'Channels', options: CHANNEL_MODES, def: 'stereo', hint: 'The built-in stereo microphone, or summed.' },
      { key: 'audio.output', type: 'float', label: 'Output level', min: -24, max: 6, step: 0.1, def: 0, unit: 'dB', noRandom: true, hint: 'Overall level of what you hear.' },
    ],
  },
  {
    id: 'mic',
    label: 'Microphone',
    kind: 'audio',
    enableKey: 'mic.enabled',
    hint: 'The microphone on the camera body, which hears the camera.',
    params: [
      { key: 'mic.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'mic.low', type: 'float', label: 'Low cut', min: 20, max: 400, step: 1, def: 120, unit: 'Hz', log: true, hint: 'A small capsule’s bass.' },
      { key: 'mic.high', type: 'float', label: 'High cut', min: 4000, max: 20000, step: 10, def: 12000, unit: 'Hz', log: true, hint: 'A small capsule’s treble.' },
      { key: 'mic.presence', type: 'float', label: 'Presence', min: -6, max: 9, step: 0.1, def: 4, unit: 'dB', hint: 'The capsule’s peak in the upper midrange.' },
      { key: 'mic.room', type: 'float', label: 'Room tone', min: -90, max: -30, step: 0.1, def: -66, unit: 'dB', hint: 'The air in the room and the preamp’s hiss, which the AGC lifts in quiet passages.' },
      { key: 'mic.wind', type: 'float', label: 'Wind', min: 0, max: 1, step: 0.001, def: 0, hint: 'Wind across the grille.' },
      { key: 'mic.windCut', type: 'bool', label: 'Wind cut', def: false, hint: 'The wind filter: rumble gone and the sound thinned.' },
    ],
  },
  {
    id: 'mech',
    label: 'Camera Noise',
    kind: 'audio',
    enableKey: 'mech.enabled',
    hint: 'What the microphone hears of the camera itself. The camera always has audio.',
    params: [
      { key: 'mech.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'mech.transport', type: 'float', label: 'Transport', min: -90, max: -20, step: 0.1, def: -58, unit: 'dB', hint: 'The head drum’s whine and the capstan, locked to the frame rate.' },
      { key: 'mech.zoom', type: 'float', label: 'Zoom motor', min: -90, max: -10, step: 0.1, def: -34, unit: 'dB', hint: 'The whirr whenever the rocker is pressed, at full speed.' },
      { key: 'mech.focus', type: 'float', label: 'Focus motor', min: -90, max: -10, step: 0.1, def: -44, unit: 'dB', hint: 'Ticks of the focus motor stepping while it hunts.' },
      { key: 'mech.rec', type: 'float', label: 'REC button', min: -90, max: -6, step: 0.1, def: -22, unit: 'dB', hint: 'The clunk at the start of every shot.' },
      { key: 'mech.handling', type: 'float', label: 'Handling', min: -90, max: -6, step: 0.1, def: -26, unit: 'dB', hint: 'Fingers on the body, and the thump of a bump.' },
    ],
  },
  {
    id: 'agc',
    label: 'Automatic Gain',
    kind: 'audio',
    enableKey: 'agc.enabled',
    hint: 'Loud sounds duck everything; in quiet passages the room comes up.',
    params: [
      { key: 'agc.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'agc.target', type: 'float', label: 'Target', min: -30, max: -6, step: 0.1, def: -18, unit: 'dBFS', hint: 'The level the AGC tries to hold.' },
      { key: 'agc.maxGain', type: 'float', label: 'Maximum gain', min: 0, max: 40, step: 0.1, def: 24, unit: 'dB', hint: 'How far it will turn up a quiet room.' },
      { key: 'agc.maxCut', type: 'float', label: 'Maximum cut', min: 0, max: 30, step: 0.1, def: 3, unit: 'dB', hint: 'How far the camera will turn loud sound down. Small, so the source’s own sound survives; raise it for a camera that flattens everything.' },
      { key: 'agc.attack', type: 'float', label: 'Attack', min: 1, max: 200, step: 0.1, def: 8, unit: 'ms', log: true, hint: 'How quickly it ducks.' },
      { key: 'agc.release', type: 'float', label: 'Release', min: 0.2, max: 10, step: 0.01, def: 2.5, unit: 's', log: true, hint: 'How slowly it recovers: the breathing.' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * A/V link
 * ------------------------------------------------------------------ */

const LINK_GROUPS: Group[] = [
  {
    id: 'link',
    label: 'A/V Link',
    kind: 'link',
    enableKey: 'link.enabled',
    hint: 'One machine: a fault in it shows in the picture and the sound at once.',
    params: [
      { key: 'link.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'link.zoomMotor', type: 'float', label: 'Zoom → motor', min: 0, max: 1, step: 0.001, def: 1, hint: 'The zoom’s speed is the motor’s whirr.' },
      { key: 'link.focusTicks', type: 'float', label: 'Focus hunt → ticks', min: 0, max: 1, step: 0.001, def: 1, hint: 'A hunt in the picture is the focus motor stepping.' },
      { key: 'link.breakClunk', type: 'float', label: 'Break → clunk', min: 0, max: 1, step: 0.001, def: 1, hint: 'A recording break is a cut, a clunk and a dead stop of the sound.' },
      { key: 'link.dropoutMute', type: 'float', label: 'Dropout → mute', min: 0, max: 1, step: 0.001, def: 1, hint: 'A damaged track loses its audio blocks as well as its picture.' },
      { key: 'link.bumpThump', type: 'float', label: 'Bump → thump', min: 0, max: 1, step: 0.001, def: 1, hint: 'A handling bump is a jolt and a thump.' },
      { key: 'link.frameWhine', type: 'float', label: 'Frame rate → whine', min: 0, max: 1, step: 0.001, def: 1, hint: 'The drum turns once a frame, so its whine is locked to the frame rate.' },
    ],
  },
];

export const GROUPS: Group[] = [
  ...ENGINE_GROUP,
  ...CAMERA_GROUPS,
  ...TAPE_GROUPS,
  ...DISPLAY_GROUPS,
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
  camera: 'engine.camera',
  tape: 'engine.tape',
  display: 'engine.display',
};

/**
 * Fold the engine masters down into the per-section bypasses.
 *
 * Rather than teaching both renderers about a second layer of switches, a
 * master simply forces every enable key in its tab off. That means the bypass
 * logic stays in one place, the GPU and CPU backends cannot disagree about it,
 * and a master behaves exactly as if you had flipped the sections by hand —
 * because that is what it does.
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

/**
 * Keys and values in an untrusted settings object that sanitize() would
 * change: unknown keys, and values it would clamp or replace. The schema
 * clamps silently, which is right for a pasted file and wrong for a test,
 * which would then measure something it did not ask for.
 */
export function settingsProblems(raw: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    const param = PARAM_BY_KEY[key];
    if (!param) out.push(`${key} is not a parameter`);
    else if (coerce(param, value) !== value) out.push(`${key} = ${String(value)} is out of range`);
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
