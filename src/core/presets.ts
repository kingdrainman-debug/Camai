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
 * Each one is a particular camera in a particular situation — a machine, a
 * year, a light, an operator, a tape — rather than an intensity level,
 * because "a palmcorder at Christmas" and "a fisheye in the sun" are not the
 * same effect turned up. "Camcorder 60%" is not a preset. Sections that are
 * inert by default get their character here, so changing the defaults never
 * changes a saved look.
 *
 * The presets describe objects, never brands: no model numbers, no maker's
 * names, no trademarked mode names.
 */

/** The parts every consumer camera shares: its own operator, sound and screen. */
const HANDHELD = {
  'operator.enabled': true,
  'operator.tremor': 0.07,
  'operator.sway': 0.4,
  'lens.enabled': true,
  'exposure.enabled': true,
  'sensor.enabled': true,
  'wb.enabled': true,
  'focus.enabled': true,
  'tone.enabled': true,
  'detail.enabled': true,
  'mic.enabled': true,
  'mech.enabled': true,
  'agc.enabled': true,
};

export const PRESETS: Preset[] = [
  preset('palmcorder-2002', 'MiniDV palmcorder, 2002', 'A single-chip MiniDV palmcorder from 2002 on an ordinary afternoon: a 1/4-inch CCD under a complementary mosaic, a 10× zoom, automatic everything, the detail enhancer of its day, the LCD display on its AV output, and a battery that is not new. The flagship: fields, the codec, sharpening and smear, a date that jumps at every break, and a zoom you can hear.', {
    ...HANDHELD,
    'format.system': 'ntsc',
    'format.sensor': 'ccd1',
    'format.sensorSize': '1/4',
    'exposure.scene': 6,
    'wb.light': 'daylight',
    'detail.gain': 1.3,
    'detail.freq': 1.1,
    'focus.hunts': 0.5,
    'breaks.enabled': true,
    'breaks.rate': 2,
    'breaks.gap': 9,
    'osd.enabled': true,
    'osd.insert': 'decode',
    'date.enabled': true,
    'date.year': 2002,
    'date.month': 7,
    'date.day': 14,
    'date.hour': 15.4,
    'battery.enabled': true,
    'battery.charge': 55,
    'battery.capacity': 50,
    'audio.mode': '12',
  }),

  preset('christmas-2002', 'Christmas morning, 2002', 'The same single-chip MiniDV palmcorder indoors under tungsten bulbs: the automatic white balance gives up two-thirds of the way and leaves everything orange, the gain is up and the noise is in the signal before the codec, which then starves for bits everywhere. 12-bit sound, the AGC breathing between voices, and the LCD display on the AV output.', {
    ...HANDHELD,
    'format.sensorSize': '1/6',
    'exposure.scene': -1,
    'exposure.maxGain': 18,
    'wb.light': 'tungsten',
    'wb.range': 0.4,
    'focus.hunts': 2,
    'detail.gain': 1.2,
    'breaks.enabled': true,
    'breaks.rate': 3,
    'breaks.skip': 1,
    'breaks.gap': 5,
    'osd.enabled': true,
    'osd.insert': 'decode',
    'date.enabled': true,
    'date.year': 2002,
    'date.month': 12,
    'date.day': 25,
    'date.hour': 8.25,
    'battery.enabled': true,
    'battery.charge': 80,
    'audio.mode': '12',
    'mic.room': -60,
    'agc.release': 3.5,
    'agc.maxGain': 28,
  }),

  preset('skate-2001', 'Skate video, 2001', 'A three-chip DV camera with a fisheye adapter screwed on, in hard sun: the camera raises the shutter to 1/1000 s and beyond rather than stop down into diffraction, so motion is staccato and blur-free; the detail enhancer is turned up; the operator is running alongside, bumping and whipping. 16-bit sound full of wind and wheels.', {
    ...HANDHELD,
    'format.sensor': 'ccd3',
    'format.sensorSize': '1/3',
    'operator.walk': 1.5,
    'operator.cadence': 2.6,
    'operator.bumps': 6,
    'operator.whips': 2,
    'operator.whipAngle': 30,
    'lens.adapter': 'fisheye',
    'lens.softness': 0.4,
    'exposure.scene': 10,
    'exposure.maxGain': 12,
    'sensor.smear': 0.008,
    'focus.enabled': false,
    'detail.gain': 2.2,
    'detail.freq': 1.0,
    'detail.limit': 0.3,
    'detail.coring': 0.008,
    'tone.knee': 0.8,
    'tone.slope': 0.18,
    'tone.saturation': 1.25,
    'mic.wind': 0.45,
    'agc.attack': 4,
  }),

  preset('wedding-lp-2004', 'Wedding reception, LP mode, 2004', 'A PAL MiniDV palmcorder recording in LP to make the tape last the evening: low light under household bulbs, the gain at its limit, dancing that combs on every frame, dropouts from the narrower tracks, recording breaks between the speeches, and an AGC that pumps with the music and breathes in the pauses.', {
    ...HANDHELD,
    'format.system': 'pal',
    'format.sensorSize': '1/6',
    'operator.sway': 0.7,
    'exposure.scene': -2,
    'exposure.maxGain': 18,
    'exposure.speed': 1.2,
    'wb.light': 'household',
    'wb.range': 0.5,
    'focus.hunts': 3,
    'tape.enabled': true,
    'tape.speed': 'lp',
    'tape.dropouts': 3,
    'tape.size': 0.18,
    'breaks.enabled': true,
    'breaks.rate': 1.5,
    'breaks.gap': 20,
    'date.enabled': true,
    'date.format': 'eu',
    'date.clock': '24',
    'date.year': 2004,
    'date.month': 6,
    'date.day': 19,
    'date.hour': 21.6,
    'agc.maxGain': 32,
    'agc.release': 4.5,
    'mic.room': -58,
  }),

  preset('night-woods', 'Night mode in the woods', 'An infrared night mode on a single-chip palmcorder: the IR-cut filter swung out and the camera’s own infrared lamp lit, so the woods are a green monochrome with a hot spot in the middle that falls away into black, eyes that glow, a slow shutter that smears and stutters, the gain flat out, and the AGC lifting the room tone — the forest — between footsteps.', {
    ...HANDHELD,
    'format.sensorSize': '1/4',
    'operator.walk': 0.9,
    'operator.cadence': 1.7,
    'operator.bumps': 3,
    'exposure.scene': -4,
    'exposure.shutter': '30',
    'exposure.maxGain': 24,
    'sensor.noise': 0.009,
    'night.enabled': true,
    'night.ir': 1.6,
    'night.spot': 0.38,
    'night.green': 0.75,
    'night.eyes': 0.6,
    'focus.hunts': 4,
    'osd.enabled': true,
    'osd.insert': 'decode',
    'battery.enabled': true,
    'battery.charge': 22,
    'audio.mode': '12',
    'mic.room': -54,
    'mic.wind': 0.15,
    'agc.maxGain': 34,
    'agc.release': 5,
  }),

  preset('found-tape-2006', 'Found tape, captured in 2006', 'A MiniDV tape recorded on a palmcorder, found years later, played in the camera and captured through a cheap composite card, one field thrown away, scaled to 320 × 240, re-encoded at 15 frames a second for a 2006 video site. A chain of generations, each with its own loss.', {
    ...HANDHELD,
    'exposure.scene': 3,
    'wb.light': 'overcast',
    'tape.enabled': true,
    'tape.dropouts': 4,
    'tape.size': 0.12,
    'breaks.enabled': true,
    'breaks.rate': 2.5,
    'capture.enabled': true,
    'capture.path': 'composite',
    'capture.decoder': 'notch',
    'capture.bandwidth': 3.4,
    'capture.noise': 0.012,
    'upload.enabled': true,
    'upload.width': 320,
    'upload.fps': 15,
    'upload.quality': 11,
    'audio.mode': '12',
  }),

  preset('clock-never-set', 'The camera whose clock was never set', 'The flagship palmcorder bought, charged and used without ever setting its clock: every shot is stamped with the factory default, starting at midnight on the first of January 2000 and running on from there.', {
    ...HANDHELD,
    'exposure.scene': 5,
    'breaks.enabled': true,
    'breaks.rate': 2,
    'osd.enabled': true,
    'date.enabled': true,
    'date.unset': true,
    'battery.enabled': true,
  }),

  preset('prosumer-2003', 'Three-chip camera on a tripod, 2003', 'A three-chip prosumer DV camera handled properly: on sticks, white-balanced by hand, exposure locked, gain off, the detail enhancer at a sensible setting. The clean end of the format, where what is left is DV itself — interlace, 4:1:1 colour and the 8×8 blocks in a busy frame.', {
    'format.sensor': 'ccd3',
    'format.sensorSize': '1/3',
    'lens.enabled': true,
    'lens.softness': 0.35,
    'lens.corners': 0.6,
    'exposure.enabled': true,
    'exposure.mode': 'manual',
    'exposure.scene': 7,
    'exposure.maxGain': 0,
    'sensor.enabled': true,
    'sensor.smear': 0.004,
    'wb.enabled': true,
    'wb.light': 'daylight',
    'wb.mode': 'outdoor',
    'tone.enabled': true,
    'tone.knee': 0.9,
    'tone.slope': 0.35,
    'tone.saturation': 1,
    'detail.enabled': true,
    'detail.gain': 0.7,
    'mic.enabled': true,
    'mech.enabled': true,
    'mech.transport': -66,
  }),

  preset('cmos-2007', 'CMOS palmcorder, 2007', 'One of the first CMOS consumer camcorders, still recording DV: no smear any more, a rolling shutter instead, so verticals lean on every pan and a whip pan bends the world. Otherwise the familiar automatic camera and its display.', {
    ...HANDHELD,
    'format.sensor': 'cmos1',
    'format.sensorSize': '1/3.6',
    'operator.whips': 4,
    'operator.whipAngle': 40,
    'exposure.scene': 7,
    'osd.enabled': true,
    'date.enabled': true,
    'date.year': 2007,
    'date.month': 4,
    'date.day': 3,
    'date.hour': 11.2,
    'breaks.enabled': true,
  }),

  preset('found-footage-imitation', 'Found-footage imitation', 'Not a camera but a convention: the REC indicator, the battery and the date burned into the picture before the codec, the way later films imitated home video. Labelled honestly — a real camera never recorded its own display to tape — and here because the difference is visible: the overlay rings and bleeds with the picture instead of sitting crisply on top.', {
    ...HANDHELD,
    'format.sensorSize': '1/6',
    'exposure.scene': -1.5,
    'exposure.maxGain': 24,
    'operator.walk': 1,
    'operator.bumps': 4,
    'focus.hunts': 3,
    'osd.enabled': true,
    'osd.insert': 'precodec',
    'date.enabled': true,
    'date.insert': 'precodec',
    'date.year': 2006,
    'date.month': 10,
    'date.day': 31,
    'date.hour': 23.2,
    'battery.enabled': true,
    'battery.charge': 12,
    'audio.mode': '12',
    'agc.maxGain': 30,
  }),
];

export const PRESET_BY_ID: Record<string, Preset> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
);

/* ------------------------------------------------------------------ *
 * Serialisation
 * ------------------------------------------------------------------ */

export const PRESET_FORMAT = 'camai-preset';
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
