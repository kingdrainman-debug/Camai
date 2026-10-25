/**
 * Film stocks.
 *
 * Each entry is a particular emulsion, described by the handful of numbers a
 * data sheet actually gives you: the slope of its characteristic curve, where
 * a correctly exposed grey card lands on it, how far the straight line runs,
 * how its density range is bounded, its RMS granularity, and — for the dyes —
 * how fast they fade.
 *
 * The figures are approximations assembled from published Kodak data sheets
 * and from the behaviour the stocks are known for, rounded to what can be
 * read off a printed curve. They are close enough that the relationships
 * between stocks are right — reversal clips two stops before negative,
 * Ektachrome 160 is twice as grainy as Kodachrome 40, 5381 prints go pink
 * and 2383 prints do not — which matters more than the third decimal place.
 *
 * Conventions used throughout the tone model (see tone.ts):
 *
 *   x       log10 exposure relative to a correctly exposed 18% grey card
 *   γ       density per unit of x along the straight line
 *   toe     the shadow end of the curve, where shadows compress into black
 *   shoulder the highlight end, where highlights roll off (negative) or clip
 *           (reversal)
 *
 * "Toe" and "shoulder" are used in exposure terms for every stock, so that
 * the same control always means the same end of the picture. On a reversal
 * film's density curve the two are physically the other way up — the picture's
 * highlights are the film's thinnest areas — and the help text says so.
 */

export type StockKind = 'negative' | 'reversal';

/** Red, green, blue — or, for dyes, cyan, magenta, yellow. */
export type RGB = [number, number, number];

export interface Stock {
  id: string;
  label: string;
  kind: StockKind;
  /** Single-layer black-and-white silver emulsion. */
  mono: boolean;
  iso: number;
  /** Colour temperature the stock is balanced for, kelvin. */
  balance: number;
  /** Straight-line slope, per layer (R,G,B). */
  gamma: RGB;
  /**
   * Density of a correctly exposed grey card. For a negative this is net of
   * base and fog; for reversal it is the total density you would project.
   */
  grey: number;
  /** Negative only: log exposure from grey to the shoulder's centre. */
  latitude: number;
  /** Softness of the shadow end, in log exposure. */
  toeSoft: number;
  /** Softness of the highlight end, in log exposure. */
  shoulderSoft: number;
  /** Base plus fog, per layer. A colour negative's includes its orange mask. */
  dmin: RGB;
  /** Reversal only: maximum density, per layer. */
  dmax: RGB;
  /** Diffuse RMS granularity × 1000, measured at a 48 µm aperture. */
  granularity: number;
  /** Size of a grain clump (a dye cloud, or a silver cluster), µm. */
  grainSize: number;
  /** Relative granularity of the red, green and blue sensitive layers. */
  layerGrain: RGB;
  /** Fraction of light that returns from the base to re-expose the emulsion. */
  halation: number;
  /** Sharpness of the emulsion itself: frequency at 50% modulation, lp/mm. */
  mtf50: number;
  /** Interlayer interimage effect — how strongly layers inhibit each other. */
  saturation: number;
  /** How far the dyes are from ideal (1 = typical). */
  impurity: number;
  /** Dye loss per year at room temperature, cyan / magenta / yellow. */
  fade: RGB;
  /** Blue-channel stain gained per year as the base and couplers yellow. */
  stain: number;
  note: string;
}

export interface PrintStock {
  id: string;
  label: string;
  mono: boolean;
  gamma: RGB;
  dmin: RGB;
  dmax: RGB;
  /** Laboratory aim density: what a grey card on the negative should print to. */
  aim: number;
  toeSoft: number;
  shoulderSoft: number;
  granularity: number;
  grainSize: number;
  fade: RGB;
  stain: number;
  saturation: number;
  impurity: number;
  /**
   * Dye layers from the emulsion surface down, by the dye each holds. An
   * emulsion scratch removes them in this order, which is why a shallow
   * scratch on a print is coloured and a deep one is white.
   */
  layers: ('c' | 'm' | 'y')[];
  note: string;
}

const g3 = (r: number, g: number, b: number): RGB => [r, g, b];

export const STOCKS: Stock[] = [
  {
    id: 'kodachrome40',
    label: 'Kodachrome 40 Type A',
    kind: 'reversal',
    mono: false,
    iso: 40,
    balance: 3400,
    gamma: g3(1.85, 1.9, 1.9),
    grey: 0.95,
    latitude: 0,
    toeSoft: 0.3,
    shoulderSoft: 0.11,
    dmin: g3(0.12, 0.13, 0.15),
    dmax: g3(3.4, 3.5, 3.6),
    granularity: 10,
    grainSize: 8,
    layerGrain: g3(0.9, 0.95, 1.2),
    halation: 0.03,
    mtf50: 45,
    saturation: 1.18,
    impurity: 0.8,
    // Kodachrome's dyes are formed in processing rather than carried in the
    // emulsion, and are famously stable in the dark — yellow goes first.
    fade: g3(0.0012, 0.0016, 0.0035),
    stain: 0.0006,
    note: 'The Super 8 reversal stock from 1974 to 2005. Fine grain for its size, deep blacks, saturated reds, and dyes that have barely moved in fifty years in a drawer.',
  },
  {
    id: 'ektachrome160',
    label: 'Ektachrome 160 Type A',
    kind: 'reversal',
    mono: false,
    iso: 160,
    balance: 3400,
    gamma: g3(1.7, 1.75, 1.8),
    grey: 0.9,
    latitude: 0,
    toeSoft: 0.36,
    shoulderSoft: 0.14,
    dmin: g3(0.17, 0.18, 0.22),
    dmax: g3(3.0, 3.05, 3.1),
    granularity: 17,
    grainSize: 12,
    layerGrain: g3(0.9, 1.0, 1.35),
    halation: 0.06,
    mtf50: 32,
    saturation: 0.95,
    impurity: 1.15,
    // The early Ektachromes lost cyan and yellow far faster than magenta,
    // which is why so many home movies of the period are now pink.
    fade: g3(0.012, 0.004, 0.009),
    stain: 0.002,
    note: 'The fast Super 8 stock of the 1970s, for indoor light without a lamp. Heavy grain, weak blacks, cyan shadows when underexposed, and dyes that have faded towards red.',
  },
  {
    id: 'ektachrome100d',
    label: 'Ektachrome 100D 7294',
    kind: 'reversal',
    mono: false,
    iso: 100,
    balance: 5500,
    gamma: g3(1.85, 1.85, 1.9),
    grey: 0.95,
    latitude: 0,
    toeSoft: 0.3,
    shoulderSoft: 0.12,
    dmin: g3(0.1, 0.1, 0.12),
    dmax: g3(3.5, 3.5, 3.6),
    granularity: 11,
    grainSize: 9,
    layerGrain: g3(0.9, 0.95, 1.25),
    halation: 0.03,
    mtf50: 50,
    saturation: 1.22,
    impurity: 0.8,
    fade: g3(0.002, 0.0015, 0.002),
    stain: 0.0005,
    note: 'The modern E-6 reversal stock. Clean, punchy and daylight balanced — what reversal looks like when nothing has gone wrong yet.',
  },
  {
    id: 'ektachrome7240',
    label: 'Ektachrome VNF 7240',
    kind: 'reversal',
    mono: false,
    iso: 125,
    balance: 3200,
    gamma: g3(1.65, 1.7, 1.75),
    grey: 0.9,
    latitude: 0,
    toeSoft: 0.34,
    shoulderSoft: 0.14,
    dmin: g3(0.15, 0.16, 0.2),
    dmax: g3(3.1, 3.1, 3.2),
    granularity: 13,
    grainSize: 10,
    layerGrain: g3(0.9, 1.0, 1.3),
    halation: 0.05,
    mtf50: 40,
    saturation: 1.0,
    impurity: 1.05,
    fade: g3(0.009, 0.004, 0.007),
    stain: 0.0015,
    note: 'Video News Film: the 16 mm reversal stock television news was shot on through the 1970s, processed in a hurry and run straight onto the air.',
  },
  {
    id: 'trix7266',
    label: 'Tri-X Reversal 7266',
    kind: 'reversal',
    mono: true,
    iso: 200,
    balance: 5500,
    gamma: g3(1.6, 1.6, 1.6),
    grey: 0.9,
    latitude: 0,
    toeSoft: 0.35,
    shoulderSoft: 0.15,
    dmin: g3(0.08, 0.08, 0.08),
    dmax: g3(2.9, 2.9, 2.9),
    granularity: 18,
    grainSize: 12,
    layerGrain: g3(1, 1, 1),
    halation: 0.08,
    mtf50: 45,
    saturation: 1,
    impurity: 1,
    fade: g3(0, 0, 0),
    stain: 0.0004,
    note: 'Black-and-white reversal. Silver rather than dye, so it does not fade, and it has the crisp, gritty grain of every student film and music video that wanted to look like one.',
  },
  {
    id: 'vision3_50d',
    label: 'Vision3 50D 5203',
    kind: 'negative',
    mono: false,
    iso: 50,
    balance: 5500,
    gamma: g3(0.55, 0.58, 0.62),
    grey: 0.62,
    latitude: 2.6,
    toeSoft: 0.28,
    shoulderSoft: 0.45,
    dmin: g3(0.24, 0.62, 0.86),
    dmax: g3(3, 3, 3),
    granularity: 5,
    grainSize: 6,
    layerGrain: g3(0.85, 0.9, 1.25),
    halation: 0.025,
    mtf50: 70,
    saturation: 1.1,
    impurity: 0.9,
    fade: g3(0.002, 0.001, 0.002),
    stain: 0.0005,
    note: 'The finest-grained colour negative there is. Daylight, slow, and with highlights that go on for eight stops above grey before the shoulder.',
  },
  {
    id: 'vision3_250d',
    label: 'Vision3 250D 5207',
    kind: 'negative',
    mono: false,
    iso: 250,
    balance: 5500,
    gamma: g3(0.57, 0.6, 0.64),
    grey: 0.62,
    latitude: 2.5,
    toeSoft: 0.28,
    shoulderSoft: 0.45,
    dmin: g3(0.24, 0.62, 0.86),
    dmax: g3(3, 3, 3),
    granularity: 7,
    grainSize: 8,
    layerGrain: g3(0.85, 0.9, 1.25),
    halation: 0.03,
    mtf50: 60,
    saturation: 1.08,
    impurity: 0.9,
    fade: g3(0.002, 0.001, 0.002),
    stain: 0.0005,
    note: 'The general-purpose daylight negative. A touch of grain, enormous latitude, very forgiving.',
  },
  {
    id: 'vision3_500t',
    label: 'Vision3 500T 5219',
    kind: 'negative',
    mono: false,
    iso: 500,
    balance: 3200,
    gamma: g3(0.57, 0.6, 0.64),
    grey: 0.62,
    latitude: 2.4,
    toeSoft: 0.3,
    shoulderSoft: 0.45,
    dmin: g3(0.25, 0.64, 0.88),
    dmax: g3(3, 3, 3),
    granularity: 8,
    grainSize: 10,
    layerGrain: g3(0.85, 0.92, 1.3),
    halation: 0.035,
    mtf50: 50,
    saturation: 1.05,
    impurity: 0.92,
    fade: g3(0.002, 0.001, 0.002),
    stain: 0.0005,
    note: 'The fast tungsten negative most night-time cinema of the last twenty years was shot on. Visible grain in the shadows, red halation round practical lights.',
  },
  {
    id: 'eastman5247',
    label: 'Eastman Color Negative II 5247',
    kind: 'negative',
    mono: false,
    iso: 100,
    balance: 3200,
    gamma: g3(0.6, 0.62, 0.66),
    grey: 0.6,
    latitude: 2.0,
    toeSoft: 0.25,
    shoulderSoft: 0.35,
    dmin: g3(0.26, 0.66, 0.92),
    dmax: g3(3, 3, 3),
    granularity: 10,
    grainSize: 9,
    layerGrain: g3(0.85, 0.95, 1.3),
    halation: 0.045,
    mtf50: 45,
    saturation: 0.95,
    impurity: 1.15,
    fade: g3(0.006, 0.002, 0.004),
    stain: 0.0015,
    note: 'The camera negative of the 1970s and 80s. Less latitude than its successors, a bit more grain, muddier dyes — and almost always printed on stock that has since faded.',
  },
  {
    id: 'doublex7222',
    label: 'Double-X 7222',
    kind: 'negative',
    mono: true,
    iso: 250,
    balance: 5500,
    gamma: g3(0.65, 0.65, 0.65),
    grey: 0.65,
    latitude: 2.1,
    toeSoft: 0.3,
    shoulderSoft: 0.4,
    dmin: g3(0.22, 0.22, 0.22),
    dmax: g3(3, 3, 3),
    granularity: 16,
    grainSize: 12,
    layerGrain: g3(1, 1, 1),
    halation: 0.06,
    mtf50: 50,
    saturation: 1,
    impurity: 1,
    fade: g3(0, 0, 0),
    stain: 0.0004,
    note: 'The black-and-white negative of documentaries, newsreels and art films since 1959. Silver grain, generous latitude, and a long, gentle shoulder.',
  },
];

export const PRINT_STOCKS: PrintStock[] = [
  {
    id: 'vision2383',
    label: 'Vision Color Print 2383',
    mono: false,
    gamma: g3(2.6, 2.7, 2.75),
    dmin: g3(0.06, 0.06, 0.07),
    dmax: g3(3.9, 4.0, 4.0),
    aim: 1.0,
    toeSoft: 0.22,
    shoulderSoft: 0.28,
    granularity: 3,
    grainSize: 4,
    fade: g3(0.0012, 0.0006, 0.001),
    stain: 0.0004,
    saturation: 1.0,
    impurity: 0.9,
    layers: ['m', 'c', 'y'],
    note: 'The modern release print. Deep blacks, dyes rated for a century in proper storage.',
  },
  {
    id: 'eastman5381',
    label: 'Eastman Color Print 5381',
    mono: false,
    gamma: g3(2.7, 2.75, 2.8),
    dmin: g3(0.08, 0.08, 0.09),
    dmax: g3(3.5, 3.6, 3.6),
    aim: 1.0,
    toeSoft: 0.24,
    shoulderSoft: 0.3,
    granularity: 4,
    grainSize: 5,
    // The notorious one. Cyan goes first, yellow next, magenta hardly at all,
    // so a print left at room temperature for a few decades turns pink.
    fade: g3(0.02, 0.0026, 0.014),
    stain: 0.001,
    saturation: 1.05,
    impurity: 1.1,
    layers: ['m', 'c', 'y'],
    note: 'The release print stock of the 1970s. It is why so many prints of the era are now pink-magenta: its cyan and yellow dyes were not stable at room temperature.',
  },
  {
    id: 'technicolor',
    label: 'Technicolor dye transfer (IB)',
    mono: false,
    gamma: g3(2.35, 2.4, 2.4),
    dmin: g3(0.05, 0.05, 0.06),
    dmax: g3(3.2, 3.3, 3.2),
    aim: 1.0,
    toeSoft: 0.3,
    shoulderSoft: 0.35,
    // No silver, no couplers: dye was imbibed into plain gelatin from three
    // matrices, so the print adds essentially no grain of its own.
    granularity: 1,
    grainSize: 4,
    fade: g3(0.0003, 0.0002, 0.0003),
    stain: 0.0002,
    saturation: 1.22,
    impurity: 0.72,
    // All three dyes sit in the same layer.
    layers: ['c', 'm', 'y'],
    note: 'Dye-transfer printing. Purer, more stable dyes than any chromogenic print, and the saturated, slightly unreal colour that went with them.',
  },
  {
    id: 'bw2302',
    label: 'Fine Grain Positive 2302 (B&W)',
    mono: true,
    gamma: g3(2.5, 2.5, 2.5),
    dmin: g3(0.05, 0.05, 0.05),
    dmax: g3(3.4, 3.4, 3.4),
    aim: 1.0,
    toeSoft: 0.25,
    shoulderSoft: 0.3,
    granularity: 3,
    grainSize: 4,
    fade: g3(0, 0, 0),
    stain: 0.0003,
    saturation: 1,
    impurity: 1,
    layers: ['c', 'm', 'y'],
    note: 'Black-and-white release print stock. Prints a colour negative as monochrome, through the negative’s own dye densities.',
  },
];

export function stock(id: string): Stock {
  return STOCKS.find((s) => s.id === id) ?? STOCKS[0];
}

export function printStock(id: string): PrintStock {
  return PRINT_STOCKS.find((s) => s.id === id) ?? PRINT_STOCKS[0];
}
