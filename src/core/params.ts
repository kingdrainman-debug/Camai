/**
 * CRTBOX parameter schema.
 *
 * This file is the single source of truth for the whole application. The
 * settings panel, the WebGL uniforms, the Web Audio graph, the preset format
 * and the CLI flags are all generated from it, so a parameter only ever has to
 * be described once.
 *
 * Settings themselves are a flat `Record<dottedKey, number | boolean | string>`
 * which makes presets trivially diffable and hand-editable.
 */

export type ParamValue = number | boolean | string;

export interface ParamCommon {
  /** Dotted key, e.g. `signal.dotCrawl`. Unique across the whole schema. */
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
  /** Excluded from the randomiser (geometry trims, output levels, …). */
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

export interface Group {
  id: string;
  label: string;
  /** Which pane the group lives in. */
  /** 'global' groups hold settings surfaced outside the tabs. */
  kind: 'global' | 'tape' | 'video' | 'audio' | 'link';
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

const SIGNAL_PATHS: EnumOption[] = [
  { value: 'rf', label: 'RF / Antenna', code: 0, hint: 'Modulated onto a carrier. Worst case: snow, ghosting, interference, heavy chroma damage.' },
  { value: 'composite', label: 'Composite (CVBS)', code: 1, hint: 'Luma and chroma share one wire. The classic dot crawl and rainbow artefacts.' },
  { value: 'svideo', label: 'S-Video (Y/C)', code: 2, hint: 'Luma and chroma separated. No dot crawl, but chroma is still narrow-band.' },
  { value: 'component', label: 'Component (YPbPr)', code: 3, hint: 'Cleanest analogue path. Only the tube itself degrades the picture.' },
];

const MASK_TYPES: EnumOption[] = [
  { value: 'none', label: 'None', code: 0 },
  { value: 'aperture', label: 'Aperture grille', code: 1, hint: 'Trinitron/Diamondtron. Continuous vertical RGB stripes, no vertical structure.' },
  { value: 'slot', label: 'Slot mask', code: 2, hint: 'Most consumer TVs. Vertical stripes broken into staggered slots.' },
  { value: 'shadow', label: 'Shadow mask (triad)', code: 3, hint: 'Delta-gun dot triads on a hex lattice. Softest, most "TV-like".' },
];

const SCAN_MODES: EnumOption[] = [
  { value: 'progressive', label: '240p progressive', code: 0, hint: 'Every field draws the same lines. Fat, obvious scanlines.' },
  { value: 'interlaced', label: '480i interlaced', code: 1, hint: 'Alternating fields. Finer lines, characteristic 30 Hz shimmer.' },
  { value: 'none', label: 'No line structure', code: 2 },
];

const ASPECTS: EnumOption[] = [
  { value: '4:3', label: '4:3', code: 0 },
  { value: '16:9', label: '16:9', code: 1 },
  { value: 'source', label: 'Match source', code: 2 },
];

/* ------------------------------------------------------------------ *
 * Tape engine vocabularies
 *
 * Names and values follow ntsc-rs's own setting ids wherever there is a
 * counterpart, so anyone who knows that tool can find the same control here
 * and a value means the same thing in both.
 * ------------------------------------------------------------------ */

const TAPE_SPEEDS: EnumOption[] = [
  { value: 'sp', label: 'SP — standard play', code: 0, hint: 'Two hours on an E180. The best a domestic VHS deck managed: roughly 3 MHz of luma.' },
  { value: 'lp', label: 'LP — long play', code: 1, hint: 'Half the tape speed, noticeably softer, and the chroma starts to go.' },
  { value: 'ep', label: 'EP/SLP — extended play', code: 2, hint: 'Six hours on one cassette. Barely 2 MHz of luma, chroma almost gone. The look of a tape recorded by someone who cared more about fitting it all on.' },
  { value: 'none', label: 'No tape (broadcast)', code: 3, hint: 'Skip the tape stage entirely and keep only the composite signal model.' },
];

const DEMOD_FILTERS: EnumOption[] = [
  { value: 'box', label: 'Box', code: 0, hint: 'A flat moving average. Cheapest and worst: maximum dot crawl and rainbows, which is exactly what a cheap set did.' },
  { value: 'notch', label: 'Notch', code: 1, hint: 'Notches out the subcarrier. Cleaner luma, but it takes real detail with it.' },
  { value: 'oneline', label: '1-line comb', code: 2, hint: 'Compares against the line above. Cancels most dot crawl at the cost of vertical colour fringing on horizontal edges.' },
  { value: 'twoline', label: '2-line comb', code: 3, hint: 'Compares against the lines above and below. What a good late-model set used — clean, with artefacts only where the picture moves vertically.' },
];

const PHASE_SHIFTS: EnumOption[] = [
  { value: '0', label: '0°', code: 0 },
  { value: '90', label: '90°', code: 1, hint: 'The classic four-field NTSC sequence. Dot crawl creeps diagonally.' },
  { value: '180', label: '180°', code: 2, hint: 'Two-field alternation. Dot crawl creeps straight up.' },
  { value: '270', label: '270°', code: 3 },
];

const RECONSTRUCT: EnumOption[] = [
  { value: 'nearest', label: 'Nearest (hard pixels)', code: 0, hint: 'No interpolation. For pixel art and 8/16-bit capture, where a soft upscale is simply wrong.' },
  { value: 'bilinear', label: 'Bilinear', code: 1, hint: 'What the GPU does for free. Soft, slightly mushy on a big upscale.' },
  { value: 'bicubic', label: 'Bicubic (Catmull-Rom)', code: 2, hint: 'Four-tap cubic with a touch of overshoot. The best default when rendering above the source resolution.' },
];

const CHANNEL_MODES: EnumOption[] = [
  { value: 'stereo', label: 'Stereo', code: 0 },
  { value: 'mono', label: 'Mono (L+R)', code: 1, hint: 'How every pre-1984 set and most sets after it actually played back.' },
  { value: 'left', label: 'Left only', code: 2 },
  { value: 'right', label: 'Right only', code: 3 },
  { value: 'side', label: 'Difference (L−R)', code: 4, hint: 'The MTS stereo subcarrier on its own. Centre-panned dialogue vanishes — deeply uncanny.' },
];

const SATURATION_MODELS: EnumOption[] = [
  { value: 'tape', label: 'Tape', code: 0, hint: 'Soft symmetric compression, 3rd-harmonic dominant.' },
  { value: 'transformer', label: 'Transformer', code: 1, hint: 'Hysteresis-flavoured, low-frequency-dependent, adds 2nd harmonic.' },
  { value: 'transistor', label: 'Output stage', code: 2, hint: 'Hard asymmetric clip. What a cheap TV amp does when you turn it up.' },
];

const HUM_MODES: EnumOption[] = [
  { value: 'ground', label: 'Ground loop', code: 0, hint: 'Odd harmonics of the mains fundamental. A buzz, not a hum.' },
  { value: 'transformer', label: 'Transformer', code: 1, hint: 'Magnetostriction happens at twice the line frequency — 100/120 Hz dominant.' },
  { value: 'both', label: 'Both', code: 2 },
];

const REGIONS: EnumOption[] = [
  { value: 'ntsc', label: 'NTSC (60 Hz / 15.734 kHz)', code: 0 },
  { value: 'pal', label: 'PAL (50 Hz / 15.625 kHz)', code: 1 },
];

const POWER_STATES: EnumOption[] = [
  { value: 'on', label: 'On', code: 0 },
  { value: 'warming', label: 'Warming up', code: 1, hint: 'Picture blooms open from a horizontal line as the tube heats.' },
  { value: 'collapsing', label: 'Powering off', code: 2, hint: 'The picture collapses to a line, then a dot that fades.' },
];

/* ------------------------------------------------------------------ *
 * Video groups
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Tape engine
 *
 * The second of the two emulators. Where the tube engine models the glass and
 * the set, this models everything upstream of it: the composite signal itself,
 * encoded onto a subcarrier and decoded back off it, and the videotape it was
 * recorded on. The artefacts here are not drawn on — dot crawl and rainbows
 * fall out of modulating and demodulating for real, which is the whole point.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Engine masters
 *
 * One switch per emulator. Each section already has its own bypass, but
 * turning off "the VHS" meant flipping four of them and turning off "the CRT"
 * meant flipping ten, which is not a thing anyone wants to do twice.
 *
 * They are real parameters rather than interface state so that they travel in
 * a preset: a look that is meant to be a clean signal on a bad tube, or a bad
 * tape shown flat, says so in the file rather than depending on which switches
 * the last person happened to leave down. The group is kind 'global', so it is
 * never drawn as a tab — the switches live on the tab bar itself.
 * ------------------------------------------------------------------ */

const ENGINE_GROUP: Group[] = [
  {
    id: 'engine',
    label: 'Engines',
    kind: 'global',
    hint: 'Master bypass for each of the two emulators.',
    params: [
      { key: 'engine.tape', type: 'bool', label: 'Tape engine', def: true, noRandom: true, hint: 'The whole signal half: composite encode and decode, the videotape, signal noise and head switching.' },
      { key: 'engine.tube', type: 'bool', label: 'Tube engine', def: true, noRandom: true, hint: 'The whole display half: reception, geometry, beam, phosphor, glow, tube response and wear.' },
    ],
  },
];

const TAPE_GROUPS: Group[] = [
  {
    id: 'composite',
    label: 'Composite Signal',
    kind: 'tape',
    enableKey: 'composite.enabled',
    hint: 'Luma and chroma are encoded onto one wire at a colour subcarrier and taken off again. Every artefact in this section emerges from that round trip rather than being painted on.',
    params: [
      { key: 'composite.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'composite.bandwidthScale', type: 'float', label: 'Bandwidth scale', min: 0.125, max: 8, step: 0.001, def: 1, log: true, hint: 'Scales every frequency in the model at once. Raise it to keep the same look when you render at a higher resolution.' },
      { key: 'composite.demodulation', type: 'enum', label: 'Chroma demodulation', options: DEMOD_FILTERS, def: 'box', noRandom: true, hint: 'How colour is separated back out of the composite signal. The single biggest decision in this section.' },
      { key: 'composite.phaseShift', type: 'enum', label: 'Scanline phase shift', options: PHASE_SHIFTS, def: '180', noRandom: true, hint: 'How far the subcarrier advances from one line to the next. This is what makes dot crawl crawl.' },
      { key: 'composite.phaseShiftOffset', type: 'int', label: 'Phase shift offset', min: 0, max: 3, def: 0, advanced: true, hint: 'Which field of the four-field sequence this frame starts on.' },
      { key: 'composite.preemphasis', type: 'float', label: 'Preemphasis', min: -1, max: 2, step: 0.001, def: 1, hint: 'High frequencies are boosted before transmission and cut after, to beat the noise floor. Mismatch the two and you get the characteristic sharpened, ringing edge.' },
      { key: 'composite.ringing', type: 'float', label: 'Ringing', min: 0, max: 1, step: 0.001, def: 0.4, hint: 'Overshoot from the band-limiting filter: a bright echo trailing every hard vertical edge.' },
      { key: 'composite.ringingFrequency', type: 'float', label: 'Ringing frequency', min: 0, max: 1, step: 0.001, def: 0.45, advanced: true },
      { key: 'composite.ringingPower', type: 'float', label: 'Ringing power', min: 1, max: 10, step: 0.01, def: 4, advanced: true },
      { key: 'composite.chromaLowpassIn', type: 'float', label: 'Chroma lowpass in', min: 0, max: 1, step: 0.001, def: 0.5, hint: 'How hard colour is filtered before it is encoded. Real equipment filtered it heavily, because the chroma channel is narrow.' },
      { key: 'composite.chromaLowpassOut', type: 'float', label: 'Chroma lowpass out', min: 0, max: 1, step: 0.001, def: 0.25, hint: 'And again after decoding, to hide the subcarrier residue.' },
      { key: 'composite.chromaDelayH', type: 'float', label: 'Chroma delay H', min: -8, max: 8, step: 0.01, def: 0, unit: 'px', hint: 'Colour arrives late and sits to one side of the object it belongs to.' },
      { key: 'composite.chromaDelayV', type: 'float', label: 'Chroma delay V', min: -4, max: 4, step: 0.01, def: 0, unit: 'px', advanced: true },
      { key: 'composite.chromaPhaseError', type: 'float', label: 'Chroma phase error', min: 0, max: 1, step: 0.001, def: 0, hint: 'A constant error in the decoder reference phase, which rotates every hue at once.' },
      { key: 'composite.lumaSmear', type: 'float', label: 'Luma smear', min: 0, max: 1, step: 0.001, def: 0, hint: 'Brightness drags to the right out of bright areas, as the amplifier fails to settle.' },
    ],
  },
  {
    id: 'tape',
    label: 'VHS Tape',
    kind: 'tape',
    enableKey: 'tape.enabled',
    hint: 'What a domestic videotape did to the signal on the way to being stored and read back. Tape speed is the master control: everything else here is a deck that has seen some use.',
    params: [
      { key: 'tape.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'tape.speed', type: 'enum', label: 'Tape speed', options: TAPE_SPEEDS, def: 'lp', noRandom: true, hint: 'Sets the luma and chroma bandwidth together, exactly as the real recording mode did.' },
      { key: 'tape.chromaLoss', type: 'float', label: 'Chroma loss', min: 0, max: 1, step: 0.001, def: 0, hint: 'Colour drops out entirely on random lines, which is what a worn tape does long before brightness goes.' },
      { key: 'tape.chromaVertBlend', type: 'bool', label: 'Chroma vertical blend', def: true, hint: 'VHS averages colour between adjacent lines to save bandwidth. Leave it on for a real tape.' },
      { key: 'tape.sharpen', type: 'float', label: 'Output sharpen', min: 0, max: 5, step: 0.001, def: 1.5, hint: 'The deck tried to put back the detail the tape lost, and overdid it. This halo is one of the most recognisable VHS signatures.' },
      { key: 'tape.sharpenFrequency', type: 'float', label: 'Sharpen frequency', min: 0.5, max: 4, step: 0.001, def: 1, advanced: true },
      { key: 'tape.edgeWave', type: 'float', label: 'Edge wave', min: 0, max: 20, step: 0.01, def: 1, unit: 'px', hint: 'The left edge of the picture ripples as the tape wanders against the head.' },
      { key: 'tape.edgeWaveSpeed', type: 'float', label: 'Edge wave speed', min: 0, max: 10, step: 0.01, def: 4, advanced: true },
      { key: 'tape.edgeWaveFrequency', type: 'float', label: 'Edge wave frequency', min: 0, max: 1, step: 0.001, def: 0.05, advanced: true },
      { key: 'tape.edgeWaveDetail', type: 'int', label: 'Edge wave detail', min: 1, max: 5, def: 2, advanced: true },
    ],
  },
  {
    id: 'vnoise',
    label: 'Signal Noise',
    kind: 'tape',
    enableKey: 'vnoise.enabled',
    hint: 'Noise added in the signal domain rather than on the finished picture, so it is encoded, filtered and decoded along with everything else — which is why it lands as bands and streaks rather than as film grain.',
    params: [
      { key: 'vnoise.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'vnoise.compositeNoise', type: 'float', label: 'Composite noise', min: 0, max: 1, step: 0.001, def: 0.01, hint: 'Noise on the composite signal itself, before anything is decoded. Affects brightness and colour together, the way real noise does.' },
      { key: 'vnoise.compositeNoiseFrequency', type: 'float', label: 'Composite noise frequency', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true },
      { key: 'vnoise.compositeNoiseDetail', type: 'int', label: 'Composite noise detail', min: 1, max: 5, def: 1, advanced: true, hint: 'Octaves of noise. More detail is finer and busier.' },
      { key: 'vnoise.lumaNoise', type: 'float', label: 'Luma noise', min: 0, max: 1, step: 0.001, def: 0.01, hint: 'Noise on brightness alone, after decoding.' },
      { key: 'vnoise.lumaNoiseFrequency', type: 'float', label: 'Luma noise frequency', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true },
      { key: 'vnoise.lumaNoiseDetail', type: 'int', label: 'Luma noise detail', min: 1, max: 5, def: 1, advanced: true },
      { key: 'vnoise.chromaNoise', type: 'float', label: 'Chroma noise', min: 0, max: 1, step: 0.001, def: 0.05, hint: 'Noise on colour alone. Low-frequency chroma noise is the blotchy colour of a tired tape.' },
      { key: 'vnoise.chromaNoiseFrequency', type: 'float', label: 'Chroma noise frequency', min: 0, max: 1, step: 0.001, def: 0.05, advanced: true },
      { key: 'vnoise.chromaNoiseDetail', type: 'int', label: 'Chroma noise detail', min: 1, max: 5, def: 1, advanced: true },
      { key: 'vnoise.chromaPhaseNoise', type: 'float', label: 'Chroma phase noise', min: 0, max: 1, step: 0.001, def: 0.01, hint: 'Random jitter in the decoder reference phase, so hue wanders line by line.' },
      { key: 'vnoise.snow', type: 'float', label: 'Snow', min: 0, max: 1, step: 0.001, def: 0, hint: 'Sparse bright specks from dropouts in the signal, rather than the dense grain of tuner noise.' },
      { key: 'vnoise.snowAnisotropy', type: 'float', label: 'Snow anisotropy', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'How far each speck smears horizontally. At 1 they are streaks rather than dots.' },
    ],
  },
  {
    id: 'headswitch',
    label: 'Head Switching & Tracking',
    kind: 'tape',
    enableKey: 'headswitch.enabled',
    hint: 'The rotating head drum, and what happens when the tracking is not quite right. These are the faults that say "videotape" faster than anything else in the application.',
    params: [
      { key: 'headswitch.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'headswitch.height', type: 'int', label: 'Head switching height', min: 0, max: 48, def: 8, unit: 'lines', hint: 'How many lines at the bottom of the picture are torn by the drum swapping heads.' },
      { key: 'headswitch.offset', type: 'int', label: 'Head switching offset', min: 0, max: 48, def: 3, unit: 'lines', advanced: true },
      { key: 'headswitch.shift', type: 'float', label: 'Horizontal shift', min: -100, max: 100, step: 0.1, def: 72, unit: 'px', hint: 'How far those lines are thrown sideways.' },
      { key: 'headswitch.midLine', type: 'bool', label: 'Start mid-line', def: false, advanced: true, hint: 'The switch happens part way along a line rather than at its start, which is what really happened.' },
      { key: 'headswitch.midLinePosition', type: 'float', label: 'Mid-line position', min: 0, max: 1, step: 0.001, def: 0.95, advanced: true },
      { key: 'headswitch.midLineJitter', type: 'float', label: 'Mid-line jitter', min: 0, max: 1, step: 0.001, def: 0.1, advanced: true },
      { key: 'headswitch.tracking', type: 'float', label: 'Tracking noise', min: 0, max: 1, step: 0.001, def: 0, hint: 'A band of torn, noisy picture drifting up the screen — the thing you used to fix by holding the tracking button down.' },
      { key: 'headswitch.trackingHeight', type: 'int', label: 'Tracking band height', min: 0, max: 60, def: 24, unit: 'lines', advanced: true },
      { key: 'headswitch.trackingWave', type: 'float', label: 'Tracking wave', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'How much the band bends the picture sideways as well as adding noise.' },
      { key: 'headswitch.trackingSnow', type: 'float', label: 'Tracking snow', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true },
    ],
  },
];

const VIDEO_GROUPS: Group[] = [
  {
    id: 'picture',
    label: 'Picture Controls',
    kind: 'video',
    hint: 'The knobs that were on the front of the set. Applied to the signal before it reaches the tube.',
    params: [
      { key: 'picture.brightness', type: 'float', label: 'Brightness', min: -0.5, max: 0.5, step: 0.001, def: 0.0, hint: 'Black level. Lifting it greys the blacks exactly as a mis-set CRT does.' },
      { key: 'picture.contrast', type: 'float', label: 'Contrast', min: 0, max: 2, step: 0.001, def: 1.0, hint: 'Drive into the tube. Above 1.0 the beam blooms.' },
      { key: 'picture.color', type: 'float', label: 'Colour', min: 0, max: 2, step: 0.001, def: 1.05, hint: 'Chroma gain. Consumer sets shipped oversaturated from the factory.' },
      { key: 'picture.tint', type: 'float', label: 'Tint', min: -40, max: 40, step: 0.1, def: 0, unit: '°', hint: 'NTSC hue error — the reason it was nicknamed "Never Twice the Same Colour".' },
      { key: 'picture.sharpness', type: 'float', label: 'Sharpness', min: 0, max: 2, step: 0.001, def: 1.0, hint: 'Peaking filter. Turning it up produces the classic white edge-ringing halo.' },
      { key: 'picture.inputGamma', type: 'float', label: 'Source gamma', min: 1.0, max: 3.0, step: 0.01, def: 2.2, advanced: true, noRandom: true, hint: 'Gamma the source file is assumed to be encoded in.' },
      { key: 'picture.reconstruct', type: 'enum', label: 'Source sampling', options: RECONSTRUCT, def: 'bicubic', noRandom: true, hint: 'How the source is read when the render resolution is higher than the file. Matters a great deal when upscaling.' },
    ],
  },
  {
    id: 'colour',
    label: 'Colour',
    kind: 'video',
    enableKey: 'colour.enabled',
    hint: 'Grey-scale tracking and chroma behaviour. A CRT was never colour-accurate: the white point drifted with brightness, the guns aged at different rates, and the colour decoder gave up on weak signals.',
    params: [
      { key: 'colour.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'colour.temperature', type: 'float', label: 'Temperature', min: -1, max: 1, step: 0.001, def: 0, hint: 'Negative is warm (D65, what film and broadcast assumed); positive is the cold blue-white most sets actually shipped at, around 9300 K.' },
      { key: 'colour.tintGM', type: 'float', label: 'Green / magenta', min: -1, max: 1, step: 0.001, def: 0, hint: 'The second white-balance axis. Ageing sets drift green as the green gun is driven hardest.' },
      { key: 'colour.redGain', type: 'float', label: 'Red gain', min: 0, max: 2, step: 0.001, def: 1, advanced: true, hint: 'Per-gun drive. The service-menu controls.' },
      { key: 'colour.greenGain', type: 'float', label: 'Green gain', min: 0, max: 2, step: 0.001, def: 1, advanced: true },
      { key: 'colour.blueGain', type: 'float', label: 'Blue gain', min: 0, max: 2, step: 0.001, def: 1, advanced: true },
      { key: 'colour.redLift', type: 'float', label: 'Red cutoff', min: -0.2, max: 0.2, step: 0.0005, def: 0, advanced: true, hint: 'Per-gun black level. Mis-set cutoffs are why old sets have coloured blacks.' },
      { key: 'colour.greenLift', type: 'float', label: 'Green cutoff', min: -0.2, max: 0.2, step: 0.0005, def: 0, advanced: true },
      { key: 'colour.blueLift', type: 'float', label: 'Blue cutoff', min: -0.2, max: 0.2, step: 0.0005, def: 0, advanced: true },
      { key: 'colour.hue', type: 'float', label: 'Hue rotate', min: -180, max: 180, step: 0.1, def: 0, unit: '°', hint: 'Rotates the whole colour wheel. Unlike Tint this acts after decoding, so it cannot be cancelled out by the set.' },
      { key: 'colour.saturation', type: 'float', label: 'Saturation', min: 0, max: 2, step: 0.001, def: 1, hint: 'Overall chroma, applied after the tube. Picture ▸ Colour is the front-panel knob upstream of it.' },
      { key: 'colour.vibrance', type: 'float', label: 'Vibrance', min: 0, max: 1, step: 0.001, def: 0, hint: 'Lifts weak colours and leaves already-saturated ones alone. Flattering, and not remotely period-correct.' },
      { key: 'colour.chromaCrush', type: 'float', label: 'Chroma crush', min: 0, max: 1, step: 0.001, def: 0, hint: 'Nearly-grey pixels collapse to grey. Tape chroma noise lived down here, so squashing it is what a noise reducer did.' },
      { key: 'colour.colourKiller', type: 'float', label: 'Colour killer', min: 0, max: 1, step: 0.001, def: 0, hint: 'Below a burst-amplitude threshold the decoder mutes colour entirely rather than show confetti. Turn it up and a weak signal goes monochrome.' },
      { key: 'colour.chromaClip', type: 'float', label: 'Chroma overload', min: 0.5, max: 2, step: 0.001, def: 2, advanced: true, hint: 'Where oversaturated colour stops getting more saturated and starts smearing. Low values give the blazing red bloom of overdriven composite.' },
    ],
  },
  {
    id: 'signal',
    label: 'Signal & Reception',
    kind: 'video',
    enableKey: 'signal.enabled',
    hint: 'Everything that happens to the picture between the transmitter and the video amplifier.',
    params: [
      { key: 'signal.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'signal.path', type: 'enum', label: 'Signal path', options: SIGNAL_PATHS, def: 'composite', noRandom: true, hint: 'Sets the character of the artefacts below. Component bypasses most of them.' },
      { key: 'signal.lumaBandwidth', type: 'float', label: 'Luma bandwidth', min: 0.4, max: 6.0, step: 0.01, def: 3.2, unit: 'MHz', hint: 'Broadcast NTSC allots 4.2 MHz; VHS manages barely 3. Lower = softer horizontally.' },
      { key: 'signal.chromaBandwidth', type: 'float', label: 'Chroma bandwidth', min: 0.05, max: 2.0, step: 0.005, def: 0.55, unit: 'MHz', hint: 'Colour carries far less detail than brightness. This is why reds smear.' },
      { key: 'signal.chromaDelay', type: 'float', label: 'Chroma delay', min: -6, max: 6, step: 0.01, def: 0.9, unit: 'px', hint: 'Colour arrives late and sits to the right of the object it belongs to.' },
      { key: 'signal.dotCrawl', type: 'float', label: 'Dot crawl', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'Chroma misread as luma: a ladder of dots creeping up sharp colour edges.' },
      { key: 'signal.crossColor', type: 'float', label: 'Cross-colour (rainbow)', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Fine luma detail misread as colour. Herringbone jackets shimmer with rainbows.' },
      { key: 'signal.ringing', type: 'float', label: 'Ringing', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'Filter overshoot. A bright fringe trailing every hard vertical edge.' },
      { key: 'signal.ringingFreq', type: 'float', label: 'Ringing frequency', min: 0.5, max: 8, step: 0.01, def: 3.0, advanced: true, hint: 'How tightly the overshoot oscillates.' },
      { key: 'signal.ghosting', type: 'float', label: 'Ghosting', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Multipath: the signal also arrives via a reflection, offset to the right.' },
      { key: 'signal.ghostDelay', type: 'float', label: 'Ghost delay', min: -80, max: 80, step: 0.1, def: 14, unit: 'px', advanced: true },
      { key: 'signal.snow', type: 'float', label: 'Snow', min: 0, max: 1, step: 0.001, def: 0.06, hint: 'Thermal noise in the tuner. Coarse, fast, monochrome.' },
      { key: 'signal.snowSize', type: 'float', label: 'Snow grain', min: 0.5, max: 8, step: 0.01, def: 1.6, unit: 'px', advanced: true },
      { key: 'signal.signalLoss', type: 'float', label: 'Signal loss', min: 0, max: 1, step: 0.001, def: 0, hint: 'Master fade from picture to full static. Drives the audio static too when A/V link is on.' },
      { key: 'signal.interference', type: 'float', label: 'Interference', min: 0, max: 1, step: 0.001, def: 0.05, hint: 'A beating carrier from a nearby channel: diagonal herringbone bars.' },
      { key: 'signal.interferenceFreq', type: 'float', label: 'Interference pitch', min: 1, max: 200, step: 0.1, def: 48, advanced: true },
      { key: 'signal.interferenceDrift', type: 'float', label: 'Interference drift', min: 0, max: 1, step: 0.001, def: 0.4, advanced: true },
    ],
  },
  {
    id: 'sync',
    label: 'Sync & Timebase',
    kind: 'video',
    enableKey: 'sync.enabled',
    hint: 'Faults in the circuits that decide where each line and each field starts.',
    params: [
      { key: 'sync.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'sync.hJitter', type: 'float', label: 'Horizontal jitter', min: 0, max: 24, step: 0.01, def: 1.2, unit: 'px', hint: 'Each line starts at a slightly wrong time. The picture develops a ragged left edge.' },
      { key: 'sync.jitterCorrelation', type: 'float', label: 'Jitter coherence', min: 0, max: 1, step: 0.001, def: 0.55, hint: 'At 0 every line is independent (noise). At 1 neighbouring lines agree (a wobble).' },
      { key: 'sync.tearing', type: 'float', label: 'Line tearing', min: 0, max: 1, step: 0.001, def: 0.06, hint: 'Occasional lines thrown violently sideways.' },
      { key: 'sync.flagging', type: 'float', label: 'Flagging', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'The top few lines bend to the right — the timebase has not settled after the vertical interval.' },
      { key: 'sync.headSwitch', type: 'float', label: 'Head-switch noise', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'The torn, noisy band along the very bottom of every tape playback.' },
      { key: 'sync.headSwitchHeight', type: 'float', label: 'Head-switch height', min: 0, max: 0.2, step: 0.001, def: 0.035, advanced: true },
      { key: 'sync.vRoll', type: 'float', label: 'Vertical roll', min: -3, max: 3, step: 0.001, def: 0, unit: 'frames/s', hint: 'Vertical hold has lost lock and the picture scrolls.' },
      { key: 'sync.vHold', type: 'float', label: 'Vertical hold instability', min: 0, max: 1, step: 0.001, def: 0, hint: 'Random bursts of rolling rather than a constant drift.' },
      { key: 'sync.timebaseWobble', type: 'float', label: 'Timebase wobble', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Slow breathing of the picture width. Reads as "this is a tape".' },
    ],
  },
  {
    id: 'geometry',
    label: 'Tube Geometry',
    kind: 'video',
    enableKey: 'geometry.enabled',
    hint: 'The deflection yoke never scanned a perfect rectangle. These are the service-menu adjustments.',
    params: [
      { key: 'geometry.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'geometry.curvatureX', type: 'float', label: 'Curvature H', min: 0, max: 0.6, step: 0.001, def: 0.14, hint: 'The glass bulges towards you. Straight lines bow outward.' },
      { key: 'geometry.curvatureY', type: 'float', label: 'Curvature V', min: 0, max: 0.6, step: 0.001, def: 0.18 },
      { key: 'geometry.cornerRadius', type: 'float', label: 'Corner radius', min: 0, max: 0.35, step: 0.001, def: 0.06, hint: 'How rounded the visible corners of the tube are.' },
      { key: 'geometry.overscan', type: 'float', label: 'Overscan', min: 0, max: 0.25, step: 0.001, def: 0.045, hint: 'Sets deliberately scanned past the bezel. 4–8% of every edge was never seen.' },
      { key: 'geometry.hSize', type: 'float', label: 'H size', min: 0.8, max: 1.2, step: 0.001, def: 1.0, noRandom: true },
      { key: 'geometry.vSize', type: 'float', label: 'V size', min: 0.8, max: 1.2, step: 0.001, def: 1.0, noRandom: true },
      { key: 'geometry.hPos', type: 'float', label: 'H position', min: -0.1, max: 0.1, step: 0.0005, def: 0, noRandom: true },
      { key: 'geometry.vPos', type: 'float', label: 'V position', min: -0.1, max: 0.1, step: 0.0005, def: 0, noRandom: true },
      { key: 'geometry.pincushion', type: 'float', label: 'Pincushion', min: -0.3, max: 0.3, step: 0.001, def: 0.02, advanced: true, hint: 'Edges pulled in or pushed out at the middle of each side.' },
      { key: 'geometry.trapezoid', type: 'float', label: 'Trapezoid', min: -0.3, max: 0.3, step: 0.001, def: 0, advanced: true, hint: 'One end of the raster wider than the other.' },
      { key: 'geometry.rotation', type: 'float', label: 'Rotation', min: -6, max: 6, step: 0.01, def: 0.25, unit: '°', advanced: true, hint: 'The yoke was glued on slightly crooked. Almost every set had a little.' },
      { key: 'geometry.aspect', type: 'enum', label: 'Aspect', options: ASPECTS, def: '4:3', noRandom: true },
    ],
  },
  {
    id: 'beam',
    label: 'Beam & Scanlines',
    kind: 'video',
    enableKey: 'beam.enabled',
    hint: 'A CRT does not draw pixels. It draws a moving spot whose brightness varies along a line.',
    params: [
      { key: 'beam.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'beam.scanMode', type: 'enum', label: 'Scan mode', options: SCAN_MODES, def: 'progressive', noRandom: true },
      { key: 'beam.lineCount', type: 'int', label: 'Active lines', min: 100, max: 1080, def: 240, hint: '240 for a console or a home camcorder, 480 for broadcast interlaced.' },
      { key: 'beam.scanlineDepth', type: 'float', label: 'Scanline depth', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'How dark the unscanned gap between lines is.' },
      { key: 'beam.beamWidth', type: 'float', label: 'Beam width', min: 0.2, max: 3.0, step: 0.001, def: 0.9, hint: 'Vertical thickness of the spot in scanline units. Wide beams fill in the gaps.' },
      { key: 'beam.beamBloom', type: 'float', label: 'Beam blooming', min: 0, max: 1.5, step: 0.001, def: 0.55, hint: 'Bright lines get physically fatter. This, more than anything, is what makes a CRT look like a CRT.' },
      { key: 'beam.beamShape', type: 'float', label: 'Beam profile', min: 0.5, max: 4, step: 0.01, def: 2.0, advanced: true, hint: '2.0 is a true Gaussian spot; higher is a squarer, more modern line.' },
      { key: 'beam.brightBoost', type: 'float', label: 'Bright boost', min: 0.5, max: 3, step: 0.001, def: 1.0, hint: 'Extra gain on top of the beam. The light the scanlines throw away is already given back automatically, so 1.0 is correct exposure — this is the contrast knob, not a correction.' },
      { key: 'beam.interlaceFlicker', type: 'float', label: 'Interlace flicker', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'Only meaningful in 480i: the 30 Hz shimmer of alternating fields.' },
      { key: 'beam.fieldBlend', type: 'float', label: 'Field blending', min: 0, max: 1, step: 0.001, def: 0.25, advanced: true },
    ],
  },
  {
    id: 'phosphor',
    label: 'Phosphor & Mask',
    kind: 'video',
    enableKey: 'phosphor.enabled',
    hint: 'The screen is a grid of red, green and blue phosphor dots behind a perforated steel mask.',
    params: [
      { key: 'phosphor.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'phosphor.maskType', type: 'enum', label: 'Mask type', options: MASK_TYPES, def: 'slot', noRandom: true },
      { key: 'phosphor.maskPitch', type: 'float', label: 'Mask pitch', min: 1.5, max: 16, step: 0.01, def: 3.0, unit: 'px', hint: 'Screen pixels per RGB triad. Below ~3 the mask turns into moiré rather than texture.' },
      { key: 'phosphor.maskStrength', type: 'float', label: 'Mask strength', min: 0, max: 1, step: 0.001, def: 0.5 },
      { key: 'phosphor.maskBoost', type: 'float', label: 'Mask compensation', min: 0.5, max: 3, step: 0.001, def: 1.0, advanced: true, hint: 'The mask blocks roughly two thirds of the light and that is compensated automatically, so 1.0 is correct. Push it if you want the mask to read as brighter than the tube really was.' },
      { key: 'phosphor.slotStagger', type: 'float', label: 'Slot stagger', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'Vertical offset of alternate slot columns. Only affects the slot mask.' },
      { key: 'phosphor.persistence', type: 'float', label: 'Persistence', min: 0, max: 0.96, step: 0.001, def: 0.22, hint: 'Afterglow. Phosphors keep emitting after the beam has gone, smearing motion.' },
      { key: 'phosphor.persistenceTilt', type: 'float', label: 'Persistence tilt', min: -1, max: 1, step: 0.001, def: 0.45, hint: 'P22 green outlasts red and blue, so trails go green. Negative pushes them blue.' },
      { key: 'phosphor.gamut', type: 'float', label: 'P22 gamut', min: 0, max: 1, step: 0.001, def: 0.4, hint: 'Bend the primaries toward real P22 phosphor: dirty green, orange-red, violet-blue.' },
    ],
  },
  {
    id: 'glow',
    label: 'Halation & Bloom',
    kind: 'video',
    enableKey: 'glow.enabled',
    hint: 'Light leaving a phosphor is scattered inside the glass and reflected back off its front face.',
    params: [
      { key: 'glow.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'glow.threshold', type: 'float', label: 'Bloom threshold', min: 0, max: 1, step: 0.001, def: 0.72, hint: 'Signal level at which the glass starts to scatter visibly. Set it low and a flat mid-grey field glows, which no tube does.' },
      { key: 'glow.bloom', type: 'float', label: 'Bloom', min: 0, max: 2, step: 0.001, def: 0.45, hint: 'Tight glow immediately around bright areas.' },
      { key: 'glow.bloomRadius', type: 'float', label: 'Bloom radius', min: 0.2, max: 4, step: 0.01, def: 1.0 },
      { key: 'glow.halation', type: 'float', label: 'Halation', min: 0, max: 2, step: 0.001, def: 0.35, hint: 'The wide, warm haze around bright objects, caused by internal reflection in the faceplate.' },
      { key: 'glow.halationRadius', type: 'float', label: 'Halation radius', min: 1, max: 12, step: 0.01, def: 5.0 },
      { key: 'glow.halationTint', type: 'float', label: 'Halation warmth', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'Red scatters furthest through glass, so the haze skews orange.' },
      { key: 'glow.diffusion', type: 'float', label: 'Glass diffusion', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'A flat veil over the whole screen. Old glass is not clear glass.' },
      { key: 'glow.vignette', type: 'float', label: 'Vignette', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Corners are further from the gun and get less beam energy.' },
      { key: 'glow.glare', type: 'float', label: 'Room glare', min: 0, max: 1, step: 0.001, def: 0.08, hint: 'A window reflected in the glass. Lifts the blacks unevenly.' },
    ],
  },
  {
    id: 'convergence',
    label: 'Convergence & Focus',
    kind: 'video',
    enableKey: 'convergence.enabled',
    hint: 'Three separate electron guns have to hit the same dot from three different angles. They never quite did.',
    params: [
      { key: 'convergence.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'convergence.redX', type: 'float', label: 'Red offset X', min: -4, max: 4, step: 0.01, def: -0.45, unit: 'px' },
      { key: 'convergence.redY', type: 'float', label: 'Red offset Y', min: -4, max: 4, step: 0.01, def: 0.1, unit: 'px' },
      { key: 'convergence.blueX', type: 'float', label: 'Blue offset X', min: -4, max: 4, step: 0.01, def: 0.5, unit: 'px' },
      { key: 'convergence.blueY', type: 'float', label: 'Blue offset Y', min: -4, max: 4, step: 0.01, def: -0.15, unit: 'px' },
      { key: 'convergence.radial', type: 'float', label: 'Radial error', min: 0, max: 2, step: 0.001, def: 0.7, hint: 'Convergence is set up in the centre, so the error grows towards the corners.' },
      { key: 'convergence.focus', type: 'float', label: 'Defocus', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Spot size in the middle of the screen.' },
      { key: 'convergence.edgeFocus', type: 'float', label: 'Edge defocus', min: 0, max: 1, step: 0.001, def: 0.4, hint: 'The beam travels further to reach a corner, so it lands as a bigger, softer blob.' },
    ],
  },
  {
    id: 'tube',
    label: 'Tube Response',
    kind: 'video',
    enableKey: 'tube.enabled',
    hint: 'The non-linear behaviour of the gun, the power supply and the automatic gain control.',
    params: [
      { key: 'tube.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'tube.gamma', type: 'float', label: 'CRT gamma', min: 1.6, max: 3.2, step: 0.01, def: 2.45, hint: 'Beam current versus grid voltage. ~2.4 is the number the whole video standard was built around.' },
      { key: 'tube.blackCrush', type: 'float', label: 'Black crush', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Below cut-off the gun simply stops. Shadow detail disappears.' },
      { key: 'tube.whiteClip', type: 'float', label: 'White clip', min: 0.6, max: 1.4, step: 0.001, def: 1.06, hint: 'Highlights slam into the limit and stop getting brighter — they only get fatter.' },
      { key: 'tube.humBar', type: 'float', label: 'Hum bar', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Mains ripple on the video rail: a soft bright band drifting slowly up the screen.' },
      { key: 'tube.humBarSpeed', type: 'float', label: 'Hum bar drift', min: -3, max: 3, step: 0.001, def: 0.45, unit: 'Hz', hint: 'The beat between mains frequency and frame rate. Rarely exactly zero.' },
      { key: 'tube.humBarWidth', type: 'float', label: 'Hum bar width', min: 0.05, max: 1, step: 0.001, def: 0.35 },
      { key: 'tube.agcPump', type: 'float', label: 'AGC pumping', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Automatic gain control chasing the average picture level, a beat behind.' },
      { key: 'tube.psuSag', type: 'float', label: 'PSU sag', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'A bright picture pulls the high-tension rail down, so large white areas dim and swell.' },
      { key: 'tube.flicker', type: 'float', label: 'Flicker', min: 0, max: 1, step: 0.001, def: 0.05 },
    ],
  },
  {
    id: 'faults',
    label: 'Faults & Wear',
    kind: 'video',
    enableKey: 'faults.enabled',
    hint: 'A set that has been in a corner of a room since 1987.',
    params: [
      { key: 'faults.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'faults.burnIn', type: 'float', label: 'Burn-in', min: 0, max: 1, step: 0.001, def: 0.0, hint: 'Phosphor permanently dimmed by a static image. Builds up over the clip.' },
      { key: 'faults.burnInRate', type: 'float', label: 'Burn-in rate', min: 0.001, max: 0.2, step: 0.001, def: 0.02, log: true, advanced: true },
      { key: 'faults.dirt', type: 'float', label: 'Dust & smears', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Static charge on the faceplate pulls in dust. Nobody ever cleaned the corners.' },
      { key: 'faults.moire', type: 'float', label: 'Moiré', min: 0, max: 1, step: 0.001, def: 0.08, hint: 'Interference between the mask pitch and fine picture detail.' },
      { key: 'faults.degauss', type: 'float', label: 'Degauss strength', min: 0, max: 1, step: 0.001, def: 0.6, noRandom: true, hint: 'Strength of the colour-warping ripple fired by the Degauss button.' },
      { key: 'faults.powerState', type: 'enum', label: 'Power state', options: POWER_STATES, def: 'on', noRandom: true },
      { key: 'faults.warmup', type: 'float', label: 'Warm-up time', min: 0.2, max: 8, step: 0.01, def: 2.2, unit: 's', noRandom: true },
    ],
  },
  {
    id: 'glitch',
    label: 'Glitching',
    kind: 'video',
    enableKey: 'glitch.enabled',
    hint: 'Discrete failures rather than continuous wear. Everything here fires in bursts driven by Event rate, so it punctuates a shot instead of sitting on it — which is what makes a cut land.',
    params: [
      { key: 'glitch.enabled', type: 'bool', label: 'Enabled', def: false, noRandom: true },
      { key: 'glitch.rate', type: 'float', label: 'Event rate', min: 0, max: 1, step: 0.001, def: 0.25, hint: 'How often anything below fires. At 0 the section is silent however high the individual amounts are.' },
      { key: 'glitch.dropout', type: 'float', label: 'Tape dropout', min: 0, max: 1, step: 0.001, def: 0.25, hint: 'The head loses contact with the oxide and the line goes to white or black. The single most recognisable VHS failure.' },
      { key: 'glitch.dropoutLength', type: 'float', label: 'Dropout length', min: 0.01, max: 1, step: 0.001, def: 0.18, advanced: true, hint: 'How far across the line a dropout runs.' },
      { key: 'glitch.lineRepeat', type: 'float', label: 'Line repeat', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'The timebase corrector loses a line and holds the previous one, smearing it downward in bands.' },
      { key: 'glitch.syncSlip', type: 'float', label: 'Sync slip', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'A band of the picture tears sideways as horizontal sync is briefly lost.' },
      { key: 'glitch.chromaBurst', type: 'float', label: 'Chroma burst', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'Colour detaches from luma and slides off in a violent band.' },
      { key: 'glitch.blockCorrupt', type: 'float', label: 'Block corruption', min: 0, max: 1, step: 0.001, def: 0, hint: 'Digital, not analogue: macroblocks fetch from the wrong place. For the moment in a tape where a digital transfer fails.' },
      { key: 'glitch.blockSize', type: 'float', label: 'Block size', min: 2, max: 64, step: 0.5, def: 16, unit: 'px', advanced: true },
      { key: 'glitch.blockColour', type: 'float', label: 'Block colour error', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, hint: 'Corrupted blocks also take the wrong chroma, which is what makes digital breakup read as digital.' },
      { key: 'glitch.posterize', type: 'float', label: 'Bit crush', min: 0, max: 1, step: 0.001, def: 0, hint: 'Collapses the luma to a few levels in bursts. Banding as a rhythmic event.' },
      { key: 'glitch.invert', type: 'float', label: 'Polarity flip', min: 0, max: 1, step: 0.001, def: 0, hint: 'Bands of inverted video. A single frame of it is deeply unpleasant, which is the point.' },
    ],
  },
  {
    id: 'output',
    label: 'Output',
    kind: 'video',
    hint: 'Where the tube stops and the room begins.',
    params: [
      { key: 'output.bezel', type: 'float', label: 'Bezel', min: 0, max: 1, step: 0.001, def: 0.5, noRandom: true, hint: 'Draw the plastic surround and the dark edge of the glass.' },
      { key: 'output.bezelShadow', type: 'float', label: 'Bezel shadow', min: 0, max: 1, step: 0.001, def: 0.5, advanced: true, noRandom: true },
      { key: 'output.roomLight', type: 'float', label: 'Ambient light', min: 0, max: 0.3, step: 0.001, def: 0.02, hint: 'The screen is never truly black in a lit room.' },
      { key: 'output.dither', type: 'float', label: 'Dither', min: 0, max: 1, step: 0.001, def: 0.25, advanced: true, hint: 'Breaks up banding in the dark parts of the gradient. Leave it on.' },
      { key: 'output.exposure', type: 'float', label: 'Exposure', min: 0.2, max: 3, step: 0.001, def: 1.0, noRandom: true },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Audio groups
 * ------------------------------------------------------------------ */

const AUDIO_GROUPS: Group[] = [
  {
    id: 'audio',
    label: 'Audio Source',
    kind: 'audio',
    enableKey: 'audio.enabled',
    hint: 'What arrives at the set, and how many channels survive.',
    params: [
      { key: 'audio.enabled', type: 'bool', label: 'Process audio', def: true, noRandom: true },
      { key: 'audio.inputGain', type: 'float', label: 'Input gain', min: -24, max: 24, step: 0.1, def: 0, unit: 'dB', noRandom: true },
      { key: 'audio.channelMode', type: 'enum', label: 'Channels', options: CHANNEL_MODES, def: 'mono', noRandom: true },
      { key: 'audio.monoAmount', type: 'float', label: 'Mono collapse', min: 0, max: 1, step: 0.001, def: 1.0, hint: 'Partial collapse is useful: 0.7 keeps a hint of width while killing the modern stereo image.' },
      { key: 'audio.width', type: 'float', label: 'Residual width', min: 0, max: 2, step: 0.001, def: 0.35, hint: 'How wide whatever stereo survives is allowed to be.' },
      { key: 'audio.region', type: 'enum', label: 'Region', options: REGIONS, def: 'ntsc', noRandom: true, hint: 'Sets the mains frequency and the line-scan whine pitch together.' },
    ],
  },
  {
    id: 'transport',
    label: 'Tape Transport',
    kind: 'audio',
    enableKey: 'transport.enabled',
    hint: 'Speed instability in the mechanism that carried the tape past the head.',
    params: [
      { key: 'transport.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'transport.wowRate', type: 'float', label: 'Wow rate', min: 0.1, max: 4, step: 0.01, def: 0.62, unit: 'Hz', hint: 'Once-per-revolution error from an eccentric capstan or a warped reel.' },
      { key: 'transport.wowDepth', type: 'float', label: 'Wow depth', min: 0, max: 1, step: 0.001, def: 0.18, hint: 'Slow pitch drift. Sustained notes sag and recover.' },
      { key: 'transport.flutterRate', type: 'float', label: 'Flutter rate', min: 3, max: 30, step: 0.01, def: 9.3, unit: 'Hz', hint: 'Faster wobble from the idler and guides.' },
      { key: 'transport.flutterDepth', type: 'float', label: 'Flutter depth', min: 0, max: 1, step: 0.001, def: 0.09 },
      { key: 'transport.drift', type: 'float', label: 'Random drift', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'A slow random walk on top of the periodic errors — stops the wobble sounding like an LFO.' },
      { key: 'transport.scrape', type: 'float', label: 'Scrape flutter', min: 0, max: 1, step: 0.001, def: 0.12, hint: 'Very fast stick-slip against the heads. Adds a grainy roughness, not a pitch.' },
      { key: 'transport.dropoutRate', type: 'float', label: 'Dropout rate', min: 0, max: 60, step: 0.1, def: 4, unit: '/min', hint: 'Bad patches of oxide: the level falls out for a moment.' },
      { key: 'transport.dropoutDepth', type: 'float', label: 'Dropout depth', min: 0, max: 1, step: 0.001, def: 0.7 },
      { key: 'transport.dropoutLength', type: 'float', label: 'Dropout length', min: 5, max: 400, step: 1, def: 45, unit: 'ms' },
    ],
  },
  {
    id: 'speaker',
    label: 'Speaker & Enclosure',
    kind: 'audio',
    enableKey: 'speaker.enabled',
    hint: 'A 6 cm paper cone stapled into a hollow plastic box, firing sideways or at the floor. This is where "muffled" actually comes from.',
    params: [
      { key: 'speaker.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'speaker.lowCut', type: 'float', label: 'Low cut', min: 20, max: 800, step: 1, def: 180, unit: 'Hz', log: true, hint: 'A tiny cone in an unsealed box simply cannot move enough air below this.' },
      { key: 'speaker.lowCutSlope', type: 'float', label: 'Low cut slope', min: 6, max: 24, step: 6, def: 12, unit: 'dB/oct', advanced: true },
      { key: 'speaker.highCut', type: 'float', label: 'High cut', min: 800, max: 16000, step: 10, def: 5200, unit: 'Hz', log: true, hint: 'Paper cone plus the audio IF bandwidth. Broadcast TV sound stopped around 10 kHz at best.' },
      { key: 'speaker.highCutSlope', type: 'float', label: 'High cut slope', min: 6, max: 24, step: 6, def: 12, unit: 'dB/oct', advanced: true },
      { key: 'speaker.resonanceFreq', type: 'float', label: 'Box resonance', min: 120, max: 1200, step: 1, def: 420, unit: 'Hz', log: true, hint: 'The honk of the cabinet. This single peak does more for the illusion than either filter.' },
      { key: 'speaker.resonanceGain', type: 'float', label: 'Box resonance gain', min: 0, max: 18, step: 0.1, def: 7.5, unit: 'dB' },
      { key: 'speaker.resonanceQ', type: 'float', label: 'Box resonance Q', min: 0.4, max: 10, step: 0.01, def: 2.4 },
      { key: 'speaker.honkFreq', type: 'float', label: 'Cone honk', min: 800, max: 4000, step: 10, def: 1750, unit: 'Hz', log: true, advanced: true, hint: 'A second, nasal peak where the cone breaks up.' },
      { key: 'speaker.honkGain', type: 'float', label: 'Cone honk gain', min: -6, max: 12, step: 0.1, def: 4, unit: 'dB', advanced: true },
      { key: 'speaker.notchFreq', type: 'float', label: 'Cancellation notch', min: 300, max: 6000, step: 10, def: 900, unit: 'Hz', log: true, advanced: true, hint: 'Sound leaving the back of the cone meets the front and cancels.' },
      { key: 'speaker.notchDepth', type: 'float', label: 'Notch depth', min: 0, max: 24, step: 0.1, def: 5, unit: 'dB', advanced: true },
      { key: 'speaker.cabinet', type: 'float', label: 'Cabinet IR', min: 0, max: 1, step: 0.001, def: 0.45, hint: 'Convolve with a synthesised small-box impulse response: real modal ringing rather than static EQ.' },
      { key: 'speaker.cabinetSize', type: 'float', label: 'Cabinet size', min: 0, max: 1, step: 0.001, def: 0.35, hint: '0 is a portable set on a kitchen counter, 1 is a wooden console the size of a sideboard.' },
      { key: 'speaker.breakup', type: 'float', label: 'Cone breakup', min: 0, max: 1, step: 0.001, def: 0.2, hint: 'Level-dependent buzz. Loud passages tear; quiet ones stay clean.' },
      { key: 'speaker.offAxis', type: 'float', label: 'Off-axis', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'The speaker is not pointing at you. It never was.' },
      { key: 'speaker.throughWall', type: 'float', label: 'Through the wall', min: 0, max: 1, step: 0.001, def: 0, hint: 'Macro: heavy low-pass plus room tail. The set is on in another room.' },
      { key: 'speaker.roomTail', type: 'float', label: 'Room tail', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Short reflections off the walls of a small, hard room.' },
    ],
  },
  {
    id: 'dynamics',
    label: 'Broadcast Processing',
    kind: 'audio',
    enableKey: 'dynamics.enabled',
    hint: 'Stations compressed everything flat to stay loud, and the set compressed it again.',
    params: [
      { key: 'dynamics.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'dynamics.amount', type: 'float', label: 'Compression', min: 0, max: 1, step: 0.001, def: 0.5 },
      { key: 'dynamics.threshold', type: 'float', label: 'Threshold', min: -48, max: 0, step: 0.1, def: -26, unit: 'dB', advanced: true },
      { key: 'dynamics.ratio', type: 'float', label: 'Ratio', min: 1, max: 20, step: 0.1, def: 8, advanced: true },
      { key: 'dynamics.attack', type: 'float', label: 'Attack', min: 0.1, max: 50, step: 0.1, def: 2, unit: 'ms', log: true, advanced: true },
      { key: 'dynamics.release', type: 'float', label: 'Release', min: 20, max: 1200, step: 1, def: 180, unit: 'ms', log: true, hint: 'Short releases pump audibly. Pumping is the sound of broadcast.' },
      { key: 'dynamics.saturation', type: 'float', label: 'Saturation', min: 0, max: 1, step: 0.001, def: 0.25 },
      { key: 'dynamics.saturationModel', type: 'enum', label: 'Saturation model', options: SATURATION_MODELS, def: 'tape', noRandom: true },
      { key: 'dynamics.ceiling', type: 'float', label: 'Limiter ceiling', min: -12, max: 0, step: 0.1, def: -1, unit: 'dB', noRandom: true },
    ],
  },
  {
    id: 'noise',
    label: 'Noise Bed',
    kind: 'audio',
    enableKey: 'noise.enabled',
    hint: 'Several quiet layers always beat one loud one. Silence is the giveaway that something is digital.',
    params: [
      { key: 'noise.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },

      { key: 'noise.humLevel', type: 'float', label: 'Mains hum', min: -90, max: -6, step: 0.1, def: -44, unit: 'dB' },
      { key: 'noise.humMode', type: 'enum', label: 'Hum character', options: HUM_MODES, def: 'both', noRandom: true },
      { key: 'noise.humHarmonics', type: 'int', label: 'Hum harmonics', min: 1, max: 16, def: 7, hint: 'More harmonics turns a smooth hum into an angry buzz.' },
      { key: 'noise.humTilt', type: 'float', label: 'Hum brightness', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'How slowly the harmonics roll off. High values buzz like a bad earth.' },
      { key: 'noise.humDrift', type: 'float', label: 'Hum drift', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Mains frequency is never exactly nominal, so the hum breathes.' },

      { key: 'noise.flybackLevel', type: 'float', label: 'Flyback whine', min: -90, max: -12, step: 0.1, def: -52, unit: 'dB', hint: 'The line-output transformer singing at the horizontal scan rate: 15.734 kHz on NTSC, 15.625 kHz on PAL. The single most identifiable sound a CRT makes.' },
      { key: 'noise.flybackDrift', type: 'float', label: 'Flyback drift', min: 0, max: 1, step: 0.001, def: 0.12 },
      { key: 'noise.flybackSqueal', type: 'float', label: 'Flyback partials', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Adds the second and third partials — the difference between a pure tone and a sick set.' },
      { key: 'noise.flybackAudible', type: 'bool', label: 'Shift whine into range', def: false, noRandom: true, hint: 'Drops the whine an octave to ~7.9 kHz so it survives lossy codecs, small speakers and older ears.' },

      { key: 'noise.hissLevel', type: 'float', label: 'Tape hiss', min: -90, max: -12, step: 0.1, def: -54, unit: 'dB' },
      { key: 'noise.hissTone', type: 'float', label: 'Hiss tone', min: 200, max: 8000, step: 10, def: 2200, unit: 'Hz', log: true },
      { key: 'noise.hissBreathing', type: 'float', label: 'Hiss breathing', min: 0, max: 1, step: 0.001, def: 0.3, hint: 'Noise reduction mis-tracking: the hiss swells back up whenever the programme goes quiet.' },

      { key: 'noise.staticLevel', type: 'float', label: 'RF static', min: -90, max: 0, step: 0.1, def: -70, unit: 'dB', hint: 'Broadband roar. Rides the video Signal loss parameter when A/V link is on.' },
      { key: 'noise.rumble', type: 'float', label: 'Mechanical rumble', min: 0, max: 1, step: 0.001, def: 0.15, hint: 'Motor and mains transformer vibration coupling into the cabinet below 120 Hz.' },
    ],
  },
  {
    id: 'crackle',
    label: 'Crackle & Contact Faults',
    kind: 'audio',
    enableKey: 'crackle.enabled',
    hint: 'Impulsive, sparse and random — the opposite of the continuous noise bed, and what actually sells decay.',
    params: [
      { key: 'crackle.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'crackle.rate', type: 'float', label: 'Crackle rate', min: 0, max: 300, step: 0.5, def: 14, unit: '/s', hint: 'Events per second, Poisson-distributed so the spacing never sounds metronomic.' },
      { key: 'crackle.level', type: 'float', label: 'Crackle level', min: -70, max: 0, step: 0.1, def: -30, unit: 'dB' },
      { key: 'crackle.tone', type: 'float', label: 'Crackle tone', min: 200, max: 12000, step: 10, def: 2600, unit: 'Hz', log: true, hint: 'Centre of the band each click is filtered into. Low is a thud, high is a tick.' },
      { key: 'crackle.spread', type: 'float', label: 'Tone spread', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'How much the tone of each individual click is randomised.' },
      { key: 'crackle.impulsiveness', type: 'float', label: 'Impulsiveness', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'Skews the amplitude distribution: most clicks tiny, occasionally one enormous pop.' },
      { key: 'crackle.decay', type: 'float', label: 'Click decay', min: 0.2, max: 40, step: 0.1, def: 3.5, unit: 'ms', log: true },
      { key: 'crackle.burstRate', type: 'float', label: 'Burst rate', min: 0, max: 60, step: 0.1, def: 3, unit: '/min', hint: 'Clusters of crackle — a corroded connector or a dry joint arcing.' },
      { key: 'crackle.burstDensity', type: 'float', label: 'Burst density', min: 0, max: 1, step: 0.001, def: 0.6 },
      { key: 'crackle.burstLength', type: 'float', label: 'Burst length', min: 20, max: 2000, step: 10, def: 320, unit: 'ms' },
    ],
  },
];

/* ------------------------------------------------------------------ *
 * A/V link — the section that makes picture and sound the same machine
 * ------------------------------------------------------------------ */

const LINK_GROUPS: Group[] = [
  {
    id: 'link',
    label: 'A/V Link',
    kind: 'link',
    enableKey: 'link.enabled',
    hint: 'On a real set the picture and the sound share a power supply, a chassis and an aerial. Faults show up in both at once. Nothing else in this app matters as much as this section.',
    params: [
      { key: 'link.enabled', type: 'bool', label: 'Enabled', def: true, noRandom: true },
      { key: 'link.humBarToHum', type: 'float', label: 'Hum bar → hum', min: 0, max: 1, step: 0.001, def: 0.7, hint: 'The bar crossing the screen and the hum in the speaker are the same ripple. Locking them is instantly convincing.' },
      { key: 'link.lossToStatic', type: 'float', label: 'Signal loss → static', min: 0, max: 1, step: 0.001, def: 0.9, hint: 'When the picture goes to snow the sound goes with it.' },
      { key: 'link.audioToBrightness', type: 'float', label: 'Audio → brightness', min: 0, max: 1, step: 0.001, def: 0.35, hint: 'Loud audio drags the high-tension rail down and the picture dims and swells. Real, and almost never emulated.' },
      { key: 'link.audioToBloom', type: 'float', label: 'Audio → bloom', min: 0, max: 1, step: 0.001, def: 0.25 },
      { key: 'link.glitchToDropout', type: 'float', label: 'Picture glitch → dropout', min: 0, max: 1, step: 0.001, def: 0.6, hint: 'Head-switch tears and tape dropouts happen on the same damaged patch of tape.' },
      { key: 'link.degaussToThump', type: 'float', label: 'Degauss → thump', min: 0, max: 1, step: 0.001, def: 0.8, hint: 'The degauss coil dumps a huge current surge. You hear it as much as you see it.' },
      { key: 'link.powerToAudio', type: 'float', label: 'Power state → audio', min: 0, max: 1, step: 0.001, def: 0.9, hint: 'Switch-on thump and the slow fade-up as the audio stage comes alive.' },
    ],
  },
];

export const GROUPS: Group[] = [
  ...ENGINE_GROUP,
  ...TAPE_GROUPS,
  ...VIDEO_GROUPS,
  ...AUDIO_GROUPS,
  ...LINK_GROUPS,
];

export const TAPE_GROUP_IDS = TAPE_GROUPS.map((g) => g.id);
export const VIDEO_GROUP_IDS = VIDEO_GROUPS.map((g) => g.id);
export const AUDIO_GROUP_IDS = AUDIO_GROUPS.map((g) => g.id);

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

/** Numeric code for an enum value, for shaders and DSP. */
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
  const tapeOn = s['engine.tape'] !== false;
  const tubeOn = s['engine.tube'] !== false;
  if (tapeOn && tubeOn) return s;

  const out: Settings = { ...s };
  for (const g of GROUPS) {
    if (!g.enableKey) continue;
    if (!tapeOn && g.kind === 'tape') out[g.enableKey] = false;
    if (!tubeOn && g.kind === 'video') out[g.enableKey] = false;
  }
  return out;
}

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
