import { DEFAULTS, PARAM_BY_KEY, Settings, coerce, diffFromDefaults, sanitize } from './params';
import { EMPTY_TIMELINE, Timeline, countKeyframes, sanitizeTimeline } from './timeline';

export interface Preset {
  id: string;
  name: string;
  description: string;
  settings: Settings;
}

/**
 * Keys a built-in preset names that the schema does not have. sanitize()
 * drops unknown keys silently — right for a pasted file, wrong for a preset
 * shipped with the app, where it means a look quietly lost a setting when a
 * parameter was renamed. `npm run help:check` fails the build on any.
 */
export const PRESET_PROBLEMS: string[] = [];

function preset(
  id: string,
  name: string,
  description: string,
  overrides: Record<string, number | boolean | string>,
): Preset {
  for (const [key, value] of Object.entries(overrides)) {
    const param = PARAM_BY_KEY[key];
    if (!param) PRESET_PROBLEMS.push(`${id}: ${key} is not a parameter`);
    else if (coerce(param, value) !== value) PRESET_PROBLEMS.push(`${id}: ${key} = ${String(value)} is out of range`);
  }
  return { id, name, description, settings: sanitize(overrides, DEFAULTS) };
}

/**
 * Built-in presets.
 *
 * Each one is a particular piece of film in a particular state — a cartridge,
 * a camera, a lab, a projector, a cupboard — rather than an intensity level,
 * because "a Kodachrome cartridge from 1974" and "a print left in a loft" are
 * not the same effect turned up. Sections that are inert by default get their
 * character here, so changing the defaults never changes a saved look.
 */
export const PRESETS: Preset[] = [
  preset('super8-1974', 'Super 8 Kodachrome, 1974', 'A 50 ft Kodachrome 40 sound cartridge, shot in daylight through the camera’s built-in 85 filter on a cheap zoom, projected at home a dozen times since. The flagship: 18 fps, reversal, a soft slow lens, a plastic pressure plate and a cartridge that leaks at both ends.', {
    'format.gauge': 'super8',
    'format.stock': 'kodachrome40',
    'exposure.light': 'daylight',
    'exposure.filter85': true,
    'exposure.stops': 0.15,
    'lens.resolution': 32,
    'lens.corners': 1.8,
    'lens.vignette': 0.9,
    'lens.chromatic': 9,
    'lens.flare': 0.02,
    'lens.distortion': 0.025,
    'camera.weave': 26,
    'camera.weaveSpeed': 1.4,
    'camera.jitter': 0.45,
    'camera.flicker': 0.09,
    'camera.speedDrift': 0.015,
    'camera.flashRate': 3,
    'camera.flashFrames': 2,
    'projector.weave': 14,
    'projector.hotspot': 0.45,
    'projector.warmth': 0.25,
    'projector.buckle': 6,
    'gatedirt.hair': 0.3,
    'gatedirt.specks': 0.35,
    'filmdirt.dust': 0.25,
    'filmdirt.fibres': 0.15,
    'scratch.rate': 0.18,
    'scratch.base': 0.6,
    'scratch.width': 18,
    'splice.rate': 1.5,
    'splice.kind': 'tape',
    'leak.rollFog': 1.1,
    'leak.edgeFog': 0.12,
    'leak.amount': 0.15,
    'fade.years': 50,
    'halation.amount': 1.4,
    'audio.track': 'magnetic',
    'magnetic.hiss': -46,
    'magnetic.headWear': 0.45,
    'magnetic.dropouts': 6,
    'transport.wowDepth': 0.3,
    'transport.flutterDepth': 0.16,
    'transport.sprocket': 0.15,
    'playback.curve': 'projector',
    'speaker.cabinetSize': 0.08,
    'speaker.honkFreq': 1700,
    'speaker.honkGain': 5,
    'speaker.resonanceFreq': 240,
    'speaker.breakup': 0.25,
    'projnoise.level': -27,
    'projnoise.claw': 0.8,
    'projnoise.tone': 2600,
    'projnoise.wear': 0.35,
    'projnoise.distance': 0.15,
  }),

  preset('reference', 'Super 8, Fresh From the Lab', 'The same Kodachrome cartridge the week it came back from processing: the emulsion, the lens and the camera, with no dirt, no fading and nothing worn. Start here to see what the stock alone does.', {
    'format.gauge': 'super8',
    'format.stock': 'kodachrome40',
    'lens.resolution': 40,
    'camera.weave': 14,
  }),

  preset('reg8-1958', 'Regular 8, Silent Holiday, 1958', 'A 25 ft spool run twice through a spring-wound camera on a beach holiday, silent, and shown on a three-blade projector that has since been filmed off the living-room wall. The motor slows as the spring runs down, so frames get longer and brighter, and motion speeds up on the screen.', {
    'format.gauge': 'reg8',
    'format.stock': 'kodachrome40',
    'exposure.light': 'daylight',
    'exposure.stops': 0.3,
    'lens.resolution': 32,
    'lens.corners': 2,
    'lens.vignette': 1.1,
    'lens.chromatic': 10,
    'lens.flare': 0.05,
    'camera.weave': 30,
    'camera.jitter': 0.5,
    'camera.flicker': 0.12,
    'camera.speedDrift': 0.08,
    'camera.flashRate': 4,
    'camera.flashFrames': 3,
    'projector.weave': 18,
    'projector.blades': '3',
    'projector.captureShutter': 0.35,
    'projector.lampRipple': 0.03,
    'projector.hotspot': 0.8,
    'projector.warmth': 0.4,
    'projector.focus': 4,
    'projector.buckle': 6,
    'gatedirt.hair': 0.4,
    'gatedirt.specks': 0.5,
    'filmdirt.dust': 0.35,
    'filmdirt.fibres': 0.25,
    'scratch.rate': 0.3,
    'scratch.base': 0.5,
    'splice.rate': 2.5,
    'splice.kind': 'cement',
    'leak.rollFog': 1.4,
    'leak.edgeFog': 0.2,
    'fade.years': 66,
    'fade.storage': 'cool',
    'audio.track': 'silent',
    'speaker.room': 0.45,
    'projnoise.level': -20,
    'projnoise.claw': 0.85,
    'projnoise.tone': 2200,
    'projnoise.wear': 0.5,
    'projnoise.shutter': 0.5,
    'projnoise.distance': 0.1,
  }),

  preset('news16-1974', '16 mm News Film, as Broadcast, 1974', 'Ektachrome Video News Film shot on a shoulder camera, processed in a hurry and run straight through a telecine onto air: reversal, optical sound, and the 3:2 judder of 24 fps film on 29.97 fps television.', {
    'format.gauge': 'mm16',
    'format.stock': 'ektachrome7240',
    'exposure.light': 'tungsten',
    'exposure.stops': -0.2,
    'lens.resolution': 55,
    'lens.vignette': 0.5,
    'lens.flare': 0.03,
    'camera.weave': 9,
    'camera.flicker': 0.05,
    'projector.weave': 5,
    'framing.aspect': '1.33',
    'framing.fps': '29.97',
    'telecine.fields': true,
    'telecine.black': 0.02,
    'telecine.saturation': 0.9,
    'filmdirt.dust': 0.12,
    'scratch.rate': 0.12,
    'splice.rate': 1,
    'splice.kind': 'tape',
    'gatedirt.hair': 0.15,
    'audio.track': 'optical-va',
    'optical.crackle': 3,
    'optical.noise': -52,
    'playback.curve': 'flat',
    'playback.highCut': 7000,
    'speaker.cabinetSize': 0.35,
    'projnoise.enabled': false,
  }),

  preset('print35-4th', '35 mm Release Print, Fourth Generation', 'A 1978 feature on Eastman 5247, duplicated through an interpositive and internegative twice more for a late run, printed on 5381, shown in a lot of cinemas and then kept at room temperature for forty-five years. Contrasty, grainy, dirty, turning pink, with a cue mark at the end of every reel.', {
    'format.gauge': 'mm35',
    'format.stock': 'eastman5247',
    'print.stock': 'eastman5381',
    'print.generations': 3,
    'lens.resolution': 70,
    'halation.amount': 1.2,
    'projector.weave': 8,
    'projector.hotspot': 0.35,
    'projector.warmth': -0.2,
    'filmdirt.dust': 0.35,
    'filmdirt.fibres': 0.2,
    'filmdirt.negative': 0.35,
    'scratch.rate': 0.45,
    'scratch.life': 7,
    'scratch.negative': 0.25,
    'scratch.depth': 0.4,
    'splice.rate': 0.6,
    'splice.kind': 'cement',
    'splice.cueMarks': true,
    'splice.reel': 60,
    'fade.years': 45,
    'framing.aspect': '1.85',
    'audio.track': 'optical-va',
    'optical.crackle': 8,
    'optical.crackleLevel': -20,
    'optical.ticks': 0.2,
    'optical.exciterHum': -64,
    'playback.curve': 'academy',
    'playback.lowCut': 50,
    'speaker.cabinetSize': 0.9,
    'speaker.honkFreq': 900,
    'speaker.honkGain': 4,
    'speaker.room': 0.6,
    'projnoise.level': -40,
    'projnoise.distance': 0.85,
  }),

  preset('faded-eastman', 'Faded Eastman, 16 mm Reduction Print', 'A 16 mm television print of a 1975 feature, struck on Eastman Color Print 5381 and kept for decades in a broadcaster’s warm store. The cyan dye has gone and much of the yellow with it: everything is pink-magenta, and no amount of saturation brings it back.', {
    'format.gauge': 'mm16',
    'format.stock': 'eastman5247',
    'print.stock': 'eastman5381',
    'print.generations': 1,
    'fade.years': 48,
    'fade.storage': 'warm',
    'framing.aspect': '1.33',
    'camera.weave': 4,
    'projector.weave': 6,
    'filmdirt.dust': 0.15,
    'scratch.rate': 0.2,
    'splice.rate': 0.4,
    'splice.kind': 'cement',
    'audio.track': 'optical-va',
    'optical.crackle': 5,
    'playback.curve': 'academy',
    'projnoise.enabled': false,
  }),

  preset('loft', 'Home Movie Found in a Loft', 'A Super 8 Ektachrome 160 cartridge from 1977, shot indoors without a lamp, put in a biscuit tin and left in a damp loft for forty-eight years. The acetate has started to turn, something has grown on it, and water got in once.', {
    'format.gauge': 'super8',
    'format.stock': 'ektachrome160',
    'exposure.stops': -0.6,
    'exposure.light': 'tungsten',
    'lens.resolution': 26,
    'lens.corners': 2,
    'lens.vignette': 1.2,
    'lens.flare': 0.06,
    'camera.weave': 32,
    'camera.jitter': 0.5,
    'camera.flicker': 0.12,
    'camera.flashRate': 4,
    'projector.weave': 16,
    'projector.hotspot': 0.5,
    'projector.buckle': 14,
    'gatedirt.hair': 0.35,
    'gatedirt.specks': 0.4,
    'filmdirt.dust': 0.55,
    'filmdirt.fibres': 0.35,
    'scratch.rate': 0.4,
    'scratch.base': 0.5,
    'splice.rate': 3,
    'leak.rollFog': 1.2,
    'leak.edgeFog': 0.25,
    'leak.amount': 0.3,
    'fade.years': 48,
    'fade.storage': 'warm',
    'decay.vinegar': 0.45,
    'decay.channelling': 0.25,
    'decay.mould': 0.35,
    'decay.water': 0.3,
    'decay.flaking': 0.12,
    'audio.track': 'magnetic',
    'magnetic.hiss': -42,
    'magnetic.headWear': 0.6,
    'magnetic.dropouts': 22,
    'magnetic.dropoutDepth': 0.8,
    'magnetic.printThrough': -44,
    'transport.wowDepth': 0.45,
    'transport.flutterDepth': 0.25,
    'transport.drift': 0.4,
    'playback.curve': 'projector',
    'speaker.cabinetSize': 0.08,
    'speaker.breakup': 0.3,
    'projnoise.level': -26,
    'projnoise.wear': 0.6,
  }),

  preset('vision3-scan', '35 mm Vision3 500T, Scanned', 'Modern night exteriors on 5219, scanned rather than printed: the negative’s full latitude, grain in the shadows, a red halo round every practical light, and no dirt at all.', {
    'format.gauge': 'super35',
    'format.stock': 'vision3_500t',
    'print.process': 'scan',
    'exposure.stops': -0.5,
    'lens.resolution': 90,
    'lens.vignette': 0.3,
    'lens.flare': 0.01,
    'halation.amount': 1.6,
    'camera.weave': 2,
    'projector.weave': 1.5,
    'framing.aspect': '2.39',
    'framing.fps': '24',
    'audio.track': 'optical-va',
    'optical.crackle': 0,
    'optical.noise': -70,
    'playback.curve': 'flat',
    'playback.highCut': 16000,
    'projnoise.enabled': false,
  }),

  preset('remjet', 'Backing Removed', 'The same 500T with its anti-halation layer stripped off before processing, as CineStill does for still cameras. Every light source blooms into a red-orange halo.', {
    'format.gauge': 'super35',
    'format.stock': 'vision3_500t',
    'print.process': 'scan',
    'halation.noBacking': true,
    'halation.radius': 1.3,
    'halation.green': 0.35,
    'exposure.stops': -0.3,
    'lens.resolution': 80,
    'camera.weave': 2,
    'projector.weave': 1.5,
    'framing.aspect': '1.85',
    'framing.fps': '24',
    'projnoise.enabled': false,
  }),

  preset('trix16-1993', 'Tri-X Reversal, 16 mm, 1993', 'Black-and-white reversal pushed a stop for a music video: silver grain, crushed blacks, a hand-held Bolex with a hair in the gate, transferred on a telecine at 25 fps.', {
    'format.gauge': 'mm16',
    'format.stock': 'trix7266',
    'curve.push': 1,
    'exposure.stops': -0.4,
    'lens.resolution': 60,
    'lens.vignette': 0.7,
    'camera.weave': 12,
    'camera.speedDrift': 0.03,
    'camera.flashRate': 2,
    'projector.weave': 6,
    'gatedirt.hair': 0.5,
    'gatedirt.wiggle': 0.7,
    'filmdirt.dust': 0.2,
    'scratch.rate': 0.15,
    'framing.aspect': '1.33',
    'framing.fps': '25',
    'audio.enabled': false,
    'projnoise.enabled': false,
  }),

  preset('technicolor-1954', 'Technicolor Dye Transfer, 1954', 'A three-strip-era feature printed by dye transfer: no silver, purer dyes, colours that have not moved in seventy years, a two-blade projector in a big hall and a variable-density optical track through the Academy curve.', {
    'format.gauge': 'mm35',
    'format.stock': 'eastman5247',
    'print.stock': 'technicolor',
    'dye.saturation': 1.3,
    'lens.resolution': 60,
    'lens.flare': 0.02,
    'halation.amount': 0.8,
    'projector.weave': 6,
    'projector.hotspot': 0.3,
    'projector.warmth': 0.3,
    'filmdirt.dust': 0.1,
    'scratch.rate': 0.1,
    'fade.years': 70,
    'framing.aspect': '1.37',
    'framing.fps': '24',
    'audio.track': 'optical-vd',
    'optical.noise': -50,
    'optical.crackle': 4,
    'playback.curve': 'academy',
    'speaker.cabinetSize': 1,
    'speaker.honkFreq': 800,
    'speaker.honkGain': 5,
    'speaker.room': 0.7,
    'projnoise.level': -44,
    'projnoise.distance': 0.9,
  }),

  preset('newsreel', '35 mm Newsreel, Second Generation', 'Black-and-white Double-X negative, duplicated once and printed for distribution, run through every cinema in the country. Silver does not fade, but everything else has happened to it.', {
    'format.gauge': 'mm35',
    'format.stock': 'doublex7222',
    'print.stock': 'bw2302',
    'print.generations': 1,
    'lens.resolution': 55,
    'lens.vignette': 0.6,
    'camera.weave': 10,
    'camera.flicker': 0.06,
    'projector.weave': 12,
    'projector.blades': '2',
    'projector.captureShutter': 0.6,
    'gatedirt.hair': 0.2,
    'filmdirt.dust': 0.5,
    'filmdirt.fibres': 0.3,
    'filmdirt.negative': 0.3,
    'scratch.rate': 0.6,
    'scratch.life': 5,
    'scratch.base': 0.5,
    'splice.rate': 3,
    'splice.kind': 'cement',
    'framing.aspect': '1.37',
    'audio.track': 'optical-vd',
    'optical.crackle': 12,
    'optical.crackleLevel': -18,
    'optical.noise': -46,
    'playback.curve': 'academy',
    'playback.highCut': 6000,
    'speaker.honkFreq': 1000,
    'speaker.honkGain': 6,
    'projnoise.level': -42,
  }),

  preset('roadshow70', '65 mm Roadshow', 'Shot on 65 mm Vision3 50D and shown as a 70 mm print with magnetic stripes: almost no grain, almost no weave, and six-track magnetic sound so clean the projector is the loudest flaw in the room.', {
    'format.gauge': 'mm65',
    'format.stock': 'vision3_50d',
    'lens.resolution': 100,
    'lens.vignette': 0.3,
    'lens.flare': 0.008,
    'camera.weave': 1.5,
    'projector.weave': 2,
    'framing.aspect': 'gate',
    'framing.fps': '24',
    'filmdirt.dust': 0.05,
    'audio.track': 'magnetic',
    'audio.channelMode': 'stereo',
    'magnetic.hiss': -68,
    'magnetic.headWear': 0,
    'magnetic.dropouts': 0.5,
    'magnetic.printThrough': -66,
    'transport.wowDepth': 0.04,
    'transport.flutterDepth': 0.02,
    'playback.curve': 'flat',
    'playback.lowCut': 30,
    'playback.highCut': 14000,
    'speaker.cabinetSize': 1,
    'speaker.room': 0.65,
    'projnoise.level': -50,
    'projnoise.distance': 0.95,
  }),
];

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
);

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

export const PRESET_FORMAT = 'filmbox-preset';
export const PRESET_VERSION = 1;

export interface PresetFile {
  format: string;
  version: number;
  name?: string;
  settings: Settings;
  /** Keyframes, omitted entirely when nothing is animated. */
  timeline?: Timeline;
}

/** Only non-default values are written, so a preset file stays readable. */
export function serializePreset(
  settings: Settings,
  name?: string,
  timeline: Timeline = EMPTY_TIMELINE,
): string {
  const file: PresetFile = {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    ...(name ? { name } : {}),
    settings: diffFromDefaults(settings),
    ...(countKeyframes(timeline) > 0 ? { timeline } : {}),
  };
  return JSON.stringify(file, null, 2);
}

export interface ParseResult {
  ok: boolean;
  settings?: Settings;
  name?: string;
  timeline?: Timeline;
  error?: string;
}

/**
 * Accepts a full preset file, or a bare settings object, so that pasting a
 * fragment out of a chat window still works.
 */
export function parsePreset(text: string, base: Settings): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON.' };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Expected a JSON object.' };
  }
  const obj = data as Record<string, unknown>;
  const body = obj.settings && typeof obj.settings === 'object' ? obj.settings : obj;
  const known = Object.keys(body as object).filter((k) => k.includes('.'));
  if (known.length === 0) {
    return { ok: false, error: 'No recognisable parameters in that JSON.' };
  }
  return {
    ok: true,
    settings: sanitize(body, base),
    name: typeof obj.name === 'string' ? obj.name : undefined,
    timeline: sanitizeTimeline(obj.timeline),
  };
}
