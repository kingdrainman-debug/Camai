/**
 * Explanatory text for the interface.
 *
 * This lives apart from the schema on purpose. `params.ts` is a machine-read
 * description of nearly two hundred controls — ranges, defaults, types — and
 * burying several paragraphs of prose in each entry would make the thing
 * nobody can skim. Here the prose can be written as prose.
 *
 * Two levels:
 *
 *   SECTION_HELP  what a whole section is for, and how to use it together
 *   PARAM_HELP    what one control physically is, what each end of its range
 *                 looks like, and when to reach for it
 *
 * The short `hint` already on each parameter is the one-line version shown as a
 * tooltip. What is written here is the longer answer, revealed by the ⓘ button,
 * and it should add something the hint does not already say rather than repeat
 * it in more words.
 *
 * Coverage is enforced: `npm run help:check` fails the build if a parameter or
 * a section has no entry here, or if an entry is too short to be saying
 * anything.
 */

export interface SectionHelp {
  /** What this section models, in a sentence or two. */
  what: string;
  /** How to drive it — the practical advice a manual would give. */
  how: string;
}

export const SECTION_HELP: Record<string, SectionHelp> = {
  engine: {
    what: 'A master switch for each of the three engines. Camera is everything up to the picture leaving the camera’s DSP: the operator, the lens, the sensor, the automatics and the sharpening. Tape is what DV does to it: interlace, chroma subsampling, the codec, dropouts and recording breaks. Display is how it was finally watched: overlays, capture, deinterlacing, the web upload.',
    how: 'Use them to find out where something comes from. If blocks survive switching the Tape engine off they are not the codec — they are the digital zoom or the upload. If a halo survives switching the Camera off, it is the capture card’s sharpening. The Format section belongs to no engine: it says which machine this is, and every engine reads it.',
  },
  format: {
    what: 'Which machine this is: the television system (raster, field rate, chroma subsampling), the tape, the kind of sensor and its size, and the camera’s 4:3 or 16:9 mode. These are not effects to dial in; they are the facts every other section is derived from.',
    how: 'Choose them first. 525/60 gives 4:1:1 colour that smears sideways; 625/50 gives 4:2:0 that smears down. A single complementary CCD is the cheap palmcorder; three CCDs the prosumer camera; CMOS is 2006 onwards. A smaller sensor needs more gain and is noisier and softer at small apertures.',
  },
  operator: {
    what: 'The person holding the camera, who is not a camera operator. Hand tremor at 8–12 Hz, the slow sway of unbraced arms, the bob and roll of walking, a hand shifting its grip, whip pans, and wherever they are deliberately pointing. All of it is camera rotation, so the zoom magnifies it, exactly as it did.',
    how: 'Leave tremor and sway near their defaults for anything handheld; they are small and they are always there. Add walking for anything shot on the move. Bumps are the jolt of a grip changing, and each is a thump in the sound too. Keyframe Pan and Tilt for a deliberate move; the stabiliser treats it as shake at first, which is how real stabilisers behaved.',
  },
  lens: {
    what: 'A small, slow 10× to 25× zoom on a fingernail-sized sensor: soft in the corners, vignetting at the wide end, lateral colour at the long end, flaring easily — and, screwed onto the front, a wide-angle or fisheye converter. The zoom is an animatable parameter: the picture follows it, the shake is magnified by it, and the motor is heard while it moves.',
    how: 'Keyframe Zoom for the slow push in on the birthday cake. Past the optical range, the Digital Zoom section takes over if it is enabled. The source is treated as the camera’s widest view; zooming in enlarges part of it. The fisheye adapter with a three-chip camera is the skate-video look. There is no shallow depth of field here, and there should not be: everything was in focus.',
  },
  exposure: {
    what: 'How much light the world had, and the automatic camera chasing it. The iris, the electronic shutter and the gain are steered together, with lag: in sun the camera raises the shutter speed rather than stop down into diffraction, which is why daylight camcorder footage is so crisp and so jittery; in the dark it opens up and then adds gain, up to about +18 dB.',
    how: 'Set Scene light for where you are — about 0 indoors at night, 6 under cloud, 10 in sun — and leave the mode automatic. Keyframe Scene light from a room into daylight and the picture blows out, then pumps down over a second or so; Damping below 1 makes it overshoot. Backlight compensation opens up for a subject against a window and burns the window out.',
  },
  sensor: {
    what: 'The chip. Each photosite collects charge through its colour filter and stops at its full well; what overflows blooms into its neighbours. On an interline-transfer CCD light also leaks into the vertical registers during readout, so a bright point draws a stripe the full height of the frame: smear. CMOS does not smear; it reads out row by row instead. Then read noise and photon noise, before the gain.',
    how: 'The defaults are a mid-range consumer CCD. Smear is relative to a 1/60 s shutter and grows as the shutter gets faster, so it is strongest in sun — exactly where the bright points are. Headroom decides how far beyond its own white the source’s clipped highlights are taken to be. Filter overlap is the complementary mosaic’s muddy colour; turn it down for cleaner colour.',
  },
  focus: {
    what: 'Contrast-detection autofocus: the camera racks the focus back and forth looking for maximum contrast. It hunts — breathes in and out — when the subject changes, when the light falls, and at the start of every shot, and it can lock onto the background behind a near subject.',
    how: 'Hunting sets how often it loses focus on its own; every recording break adds a hunt at the start of the shot as well. Hunt depth is how far it goes out. Missed focus is a constant error, the background-locked look. Each hunt is heard as the focus motor ticking, through the A/V Link.',
  },
  wb: {
    what: 'The light the scene was lit by, and the camera’s attempt to make it white. Consumer automatic white balance averaged the whole frame, drifted slowly, and was wrong in recognisable ways: it corrected only part of the way towards tungsten, leaving it orange, and hardly at all along green–magenta, leaving fluorescent tubes green. Because it averages the frame, it shifts when a coloured object fills it.',
    how: 'Set Light to what the scene was lit by. Automatic follows slowly and stops short; Correction range is how far it gets. The indoor and outdoor presets are what a careful owner would have used. Held keeps whatever the camera had settled on when the clip began, which is right for a locked-off shot.',
  },
  eis: {
    what: 'Electronic image stabilisation: the sensor is read out as a crop with a margin, and the crop moves each field against the shake. The view is narrower and slightly softer. Most tellingly, the frame stays steady while the motion blur in it does not, because blur cannot be stabilised after the fact.',
    how: 'Use with an Operator. Strength is how much of the fast part of the shake is cancelled; slow drift and deliberate pans are left alone, after a lag in which the stabiliser fights them. A larger margin can correct bigger shakes but costs more of the view.',
  },
  dzoom: {
    what: 'Digital zoom: once the lens is at its longest, the camera keeps going by enlarging a shrinking crop of the sensor — the “500×” on the box. The upscale is coarse, so the picture turns to blocks of sensor pixels, and the display shows the digital magnification beyond the zoom bar.',
    how: 'Enable it and push Zoom past the optical range in the Lens section. Pixel repeat is the cheap camera’s blocky look; linear interpolation is softer. It happens in the camera, before the codec, so the codec then codes those enlarged pixels.',
  },
  tone: {
    what: 'Video’s tone curve, the opposite of film’s. A gamma of about 0.45 with a linear toe, then a knee that compresses the top of the range, then a hard clip. Perhaps five or six stops of usable range. DV codes up to about 109 IRE, and consumer cameras used the headroom: superwhites above reference white.',
    how: 'Knee point and slope set how much highlight detail survives; a low knee and a shallow slope hold more sky before the wall. The clip is in IRE; at 100 the superwhites are gone. On a single-chip camera the channels clip at different points, so a blown sky goes cyan or yellow at its edge before it goes white — that comes from the Sensor section, not from here.',
  },
  detail: {
    what: 'Aperture correction, the early-2000s sharpness. A peaking filter adds an overshoot to every edge — a bright fringe on the light side and a dark one on the dark side — horizontally along the line and vertically across the lines of one field. Coring leaves low-level noise alone; a limiter caps the halo. It happens before the codec, and halos are expensive to code, so the codec then rings around them.',
    how: 'Gain is the strength; Frequency is the halo’s width in DV pixels. Raise Coring if gain-up noise is being sharpened into grit. The vertical share acting within a field is why sharpened DV twitters on horizontal edges. This is not an unsharp mask turned to 11; turned to 11 it looks like one.',
  },
  battery: {
    what: 'The battery drains as the camera records — and, more slowly, in standby between shots. The display’s gauge follows it and blinks when it is nearly empty. When it runs out the camera stops recording: a cut, not a fade, and after it the tape holds nothing.',
    how: 'Set the charge it started at and its capacity. Short of capacity is the camera that dies halfway through the cake. The display needs the Camera Display section on to show the gauge.',
  },
  night: {
    what: 'An infrared night mode: the IR-cut filter swings out of the light path and an infrared LED beside the lens lights the scene. A colour sensor seeing only infrared sees it equally through every filter, so the picture is near monochrome, given a greenish cast; the lamp makes a hot spot in the middle that falls away to black; eyes retro-reflect and glow; and some fabrics go translucent.',
    how: 'Pair it with a dark scene (Scene light around −4), a slow shutter and the gain at its limit. IR lamp is the beam’s strength; Hot spot its width. Found-footage horror lives in this mode. The trademarked names for it belonged to camera makers; this is the thing itself.',
  },
  fx: {
    what: 'The effects button: sepia, black and white, “old movie”, mosaic, strobe, trail and negative, as the camera’s DSP and field memory did them, and the fader that faded each shot in from black or white when REC was pressed.',
    how: 'Small, well known and cheap; they ship off. The fader fades the sound in with the picture, as the cameras did. Strobe holds frames in the field memory; trail mixes in the frame before.',
  },
  interlace: {
    what: 'Fields. The CCD delivers 59.94 or 50 a second, each its own moment, and DV puts two in a frame, bottom field first. In field integration mode adjacent sensor rows are summed in pairs, the pairing alternating between the fields, so each field has less vertical resolution than half a frame and the two fields sample different row pairs.',
    how: 'Leave it on: it is the video motion. Off records progressive frames, both fields from one moment, which a DV camcorder did not do. Field integration off is frame integration, sharper vertically; the complementary mosaic always sums its pairs, because it needs them to decode colour.',
  },
  chroma: {
    what: 'Chroma subsampling. DV keeps full-resolution luma and much less colour: 4:1:1 in 525/60, a quarter of the horizontal colour resolution; 4:2:0 in 625/50, half horizontally and half vertically, averaged across the two fields. Red text and red edges smear sideways in one and down in the other.',
    how: 'It is always on while the DV codec is, because it is part of DV. Off with the codec off shows the camera’s full-resolution colour. The decoder’s upsampling is the playback side’s choice: repeat gives hard colour steps every four pixels, interpolation a softer bleed.',
  },
  codec: {
    what: 'The DV codec: intra-frame 8×8 DCT at a constant 25 Mbit/s. Blocks choose an 8-8 or a 2-4-8 transform; are sorted into four classes by activity; and each segment of five macroblocks — shuffled from five places across the frame — gets the finest quantiser at which it fits a fixed number of bits. When even the coarsest does not fit, the highest frequencies are lost.',
    how: 'The budget is fixed, so quality is whatever is left after the picture has paid for its detail: a busy, noisy, gained-up frame blocks everywhere at once, including where the noise is not. Bit budget scales the 25 Mbit/s; below 1 is a starved encoder. The rate control is an approximation calibrated against FFmpeg’s dvvideo encoder; the README gives the figures.',
  },
  tape: {
    what: 'Tape errors, digital ones. A damaged stretch of tape loses DIF blocks from a run of tracks, and the decoder conceals the loss macroblock by macroblock — from the previous frame, or as grey or green blocks — on the macroblock grid, scattered across the picture by the shuffle. At worst a whole frame freezes and the audio mutes. A clogged head freezes and mosaics everything until it cleans itself.',
    how: 'Dropouts and size together set how damaged the tape is; LP multiplies the rate. It is never a horizontal streak: that is VHS. The audio is on the same tracks, so the sound mutes or stutters at the same moment through the A/V Link.',
  },
  breaks: {
    what: 'Recording breaks. Each press of REC starts a new shot. A DV camera backs the tape up slightly before recording, so the cut is seamless and the timecode continuous. Time passed between shots, so the camera’s clock jumps; the tape is continuous, so the counter does not. Each break is a cut in the picture, a REC-button clunk and a dead cut in the sound.',
    how: 'Shots per minute sets how often the camera was stopped. Source skipped is how much of the world went unrecorded at each break, which is what makes the cut visible as a jump. Turn off the backspace to get the garbage frame and the restarted timecode of recording over an unrecorded gap.',
  },
  osd: {
    what: 'The viewfinder and LCD display: REC or STBY with its red dot, the counter, the battery, the zoom bar, the mode readout and blinking warnings. None of it was ever recorded to DV tape. Footage “with the REC overlay” is the AV output recorded with the display on, a screen filmed by another camera, or a later imitation.',
    how: 'Path is where it enters the chain, and the chain then does to it what it does. After decode (the default, the AV output) it is crisp over blocky picture, and softens with any analogue capture after it. Burned in before the codec it rings and bleeds with the picture — the imitation. On the display it is sharp on the output’s own pixels.',
  },
  date: {
    what: 'The date and time, as a model rather than a string: wall-clock time that advances while recording and jumps at every recording break by the time that passed between shots. Many analogue cameras imprinted it into the picture before recording; DV recorded it as data and drew it at playback when the data-code display was on.',
    how: 'Set the date and time of the first shot and the regional format. The path works as the camera display’s does: after decode for DV’s data code, before the codec for an imprint. A camera whose clock was never set shows its factory default instead.',
  },
  capture: {
    what: 'How the tape got into a computer. FireWire copied the DV stream bit for bit. A cheap capture card took the camera’s S-Video or composite output instead, and composite put the colour on a subcarrier in the luma band that the card then had to take out again: dot crawl, cross-colour on fine detail, a softer picture, colour arriving late — with every overlay on the AV output degraded along with it.',
    how: 'FireWire is identity. Composite with a notch decoder is the cheapest card; the comb is sharper but fringes on vertical colour edges. Levels decides whether superwhites clip or the whole coding range is shown. Adapted from CRTBOX’s composite chain, at the DV raster’s sampling rate.',
  },
  deint: {
    what: 'Deinterlacing, chosen by whatever played or converted the footage. Weave keeps both fields and combs on anything that moves. Bob shows each field on its own, line-doubled: no combing, but thin lines twitter. Blend averages the fields: motion ghosts. Discard throws a field away: half the vertical resolution, the early web look.',
    how: 'With the section off the output is a weave of the full frame. For bob at its best set Output rate to field rate, and every field becomes a frame. A CRT showed fields in sequence and was smooth; for that, hand the footage to CRTBOX rather than looking for it here.',
  },
  upload: {
    what: 'The 2006 web upload: one field discarded, the picture scaled down to around 320 × 240, the frame rate cut to 15 or so, and a second lossy codec on top of DV’s. A found tape captured badly and re-encoded is a chain of generations, and each has its own loss.',
    how: 'Width sets the upload’s raster; the frame rate holds frames, so motion stutters; Quantiser is the second codec’s step size, bigger being blockier, with blocks eight pixels on the small raster — far bigger than DV’s on the screen.',
  },
  framing: {
    what: 'The file you make: its shape, how the 720-sample DV raster is scaled to it, and its frame rate. Everything is rendered in the DV raster first, so an artefact is sized in the medium — an 8×8 block is 8×8 DV pixels — and only then scaled to the output with the right pixel aspect.',
    how: 'As recorded is 4:3, or 16:9 in the camera’s 16:9 mode. Forcing the other aspect crops to fill rather than adding bars. Full raster shows the 8 samples either side of the 704-wide active picture. Nearest, bilinear and good resampling look very different at 1080p.',
  },
  audio: {
    what: 'What the tape records. DV audio is 16-bit at 48 kHz in stereo, or 12-bit at 32 kHz with four channels, using a non-linear 12-bit code. Many consumer cameras shipped set to 12-bit, so a great deal of real footage is band-limited to about 15 kHz with its own quantisation texture.',
    how: 'Switch to 12-bit for the authentic consumer sound. Programme level is how loud the world was at the microphone. The output level is only what you hear here. Off passes the source through untouched.',
  },
  mic: {
    what: 'The built-in microphone, on the camera body: a small capsule with little bass, a presence peak and a soft top, that hears the room and the wind as well as the subject — and hears the camera, whose own noises are in the Camera Noise section.',
    how: 'Low and high cut shape the capsule; presence is its forward upper midrange. Room tone is the air and the preamp’s hiss, which the automatic gain will lift in quiet passages. The wind cut thins everything below 200 Hz, wind and voice alike.',
  },
  mech: {
    what: 'What the microphone hears of the camera itself: the transport’s whine — the head drum turning at 9000 rpm, locked to the frame rate — and the capstan; the zoom motor whirring whenever the rocker is pressed; the focus motor ticking while it hunts; the REC button’s clunk at the start of every shot; fingers on the body and the thump of a bump.',
    how: 'The camera always has audio: with a silent source, this is the soundtrack. Each is a level in dB. The zoom motor follows the zoom’s keyframes; the ticks follow the autofocus; the clunk follows the recording breaks; the thump follows the operator’s bumps — all through the A/V Link.',
  },
  agc: {
    what: 'Automatic gain control. Loud sounds duck everything; in quiet passages the gain creeps back up and the noise floor and the room tone rise with it — the breathing that every consumer camera’s sound has. Modelled with an attack, a release and a maximum gain, not as a compressor.',
    how: 'A fast attack and a slow release is the classic pump; a large maximum gain makes a silent room roar. The target is the level it tries to hold. Turn it off for the sound of a camera with a manual level, which few consumer cameras had.',
  },
  link: {
    what: 'The couplings that make the camera one machine rather than two effects, and only physical ones: the zoom’s speed is the motor’s whirr; a focus hunt is the focus motor ticking; a recording break is a cut, a clunk and a dead stop of the sound; a dropout mutes the audio blocks on the same damaged track; a bump is a jolt and a thump; the drum’s whine is locked to the frame rate.',
    how: 'Each coupling is a share from 0 to 1 of its full strength. Turn one down to hear what it adds. They are computed from the same event clock the picture uses, so they agree to the frame.',
  },
};

export const PARAM_HELP: Record<string, string> = {
  /* ---------------- engines ---------------- */
  'engine.camera': 'Bypasses every section in the Camera tab at once: the operator, lens, exposure, sensor, focus, white balance, stabiliser, digital zoom, tone, detail, battery, night mode and effects. The Format section stays, because it is not an effect.',
  'engine.tape': 'Bypasses every section in the Tape tab: interlace, chroma subsampling, the DV codec, tape errors and recording breaks. With it off the picture is the camera’s DSP output, progressive and at full colour resolution.',
  'engine.display': 'Bypasses every section in the Display tab: the camera’s display, the date, the capture, deinterlacing and the web upload. The Output section has no switch and stays, since the file has to have a shape.',

  /* ---------------- format ---------------- */
  'format.system': '525/60 is 720 × 480 at 29.97 frames (59.94 fields) with 4:1:1 colour; 625/50 is 720 × 576 at 25 frames (50 fields) with 4:2:0. It also sets the mains frequency fluorescent light flickers at, so a 525 camera under 50 Hz light would beat — not modelled across regions.',
  'format.tape': 'MiniDV and Digital8 record the same DV stream and decode identically. Digital8 ran Hi8 tape at twice the speed, and old Hi8 stock drops out a little more, so the dropout rate is raised by about half.',
  'format.sensor': 'A fork, not a slider. The single complementary CCD decodes colour from filter sums and differences, with low colour resolution, false colour and muddy reds; three CCDs on a prism give clean colour; CMOS swaps smear for a rolling shutter.',
  'format.sensorSize': 'The sensor’s optical format. Smaller means smaller photosites: more read noise relative to the signal (the gain needed sooner) and diffraction setting in at wider apertures. The depth of field is enormous whichever you choose.',
  'format.aspect': 'Most consumer cameras made 16:9 by recording the middle three quarters of a 4:3 sensor’s rows stretched to the full raster and flagged anamorphic. The picture is wider and has less vertical detail; the output frame follows the flag.',

  /* ---------------- operator ---------------- */
  'operator.enabled': 'Switches the person holding the camera on. Off is a camera on a tripod that nobody touches, which a consumer camcorder seldom was.',
  'operator.tremor': 'The fine, fast shake of a hand holding something at arm’s length, in degrees. Invisible at the wide end and impossible to miss at full zoom, because the zoom multiplies it.',
  'operator.sway': 'The slow wander of unbraced arms, a fraction of a degree to a few degrees. The stabiliser leaves most of it alone, being slow.',
  'operator.walk': 'The vertical bob of each step and the sideways roll at half the step rate, in degrees. A degree or two is walking with the camera; more is running.',
  'operator.cadence': 'Steps per second while walking. About 1.9 is a stroll; 2.5 and up is a jog. The bob is locked to it.',
  'operator.bumps': 'How often a hand shifts its grip, per minute. Each bump is a jolt that rings out over a fraction of a second, and a thump on the microphone at the same moment.',
  'operator.bumpSize': 'How far a bump throws the camera, in degrees, at its peak. One or two degrees is a jolt; five is someone being knocked.',
  'operator.whips': 'Fast swings to look at something else and back, per minute. A whip pan is too fast for the shutter, so it smears; on a CMOS camera it also bends.',
  'operator.whipAngle': 'How far a whip pan swings, in degrees. The view beyond the edge of the source is the source mirrored, so very large swings show it.',
  'operator.pan': 'Where the camera points, left and right, in degrees. Keyframe it for a deliberate pan; the stabiliser fights it briefly before it lets go, and a rolling shutter leans verticals while it moves.',
  'operator.tilt': 'Where the camera points, up and down, in degrees. Keyframe it for a tilt up the tree or down to the cake.',
  'operator.roll': 'A horizon that is not level, in degrees. The stabiliser does not correct roll, as most did not.',

  /* ---------------- lens ---------------- */
  'lens.enabled': 'Switches the lens model on: zoom, softness, vignetting, lateral colour, flare, diffraction and adapters. Off is a perfect lens at the widest view.',
  'lens.zoom': 'The zoom position: 1 is the wide end. Up to the optical range it narrows the view of the source; beyond it, with Digital Zoom enabled, the camera enlarges a crop of the sensor. Keyframe it: the zoom motor is heard while it moves and the display shows the zoom bar.',
  'lens.range': 'The longest optical zoom: 10× was common, 25× the boast of the late 1990s. It sets where the digital zoom takes over and how the zoom bar reads.',
  'lens.fov': 'The horizontal field of view at the wide end, in degrees. The source frame is taken to be this wide, which sets how many pixels a degree of shake moves the picture.',
  'lens.softness': 'The lens’s blur at the centre of the frame, in DV pixels. A good consumer zoom was around half a pixel; a cheap one or a soft converter a pixel or more.',
  'lens.corners': 'Extra blur towards the corners, in DV pixels at the extreme corner. Small zooms were sharp in the middle and soft at the edges.',
  'lens.vignette': 'Light falloff at the corners at the wide end, in stops. It lessens as the zoom moves to the long end, as it did on these lenses.',
  'lens.chromatic': 'Lateral colour: red and blue images of different sizes, so edges near the corners get colour fringes. In DV pixels at the corner at the long end, where these zooms were worst.',
  'lens.flare': 'Veiling glare: light scattered by cheap coatings across the whole frame, proportional to how bright the scene is. It lifts the blacks and lowers the contrast round bright subjects.',
  'lens.diffraction': 'Softening at small apertures, as a multiple of the physical Airy disc for the sensor size and the f-number the automatic exposure chose. At 1 it is physics; why the camera raises the shutter instead of stopping down in sun.',
  'lens.adapter': 'A converter on the front of the lens. The wide-angle widens with barrel distortion and soft corners; the fisheye bends everything round the centre, with a soft rim and a hard round vignette.',
  'lens.distortion': 'The zoom’s own barrel distortion at the wide end, falling to slight pincushion at the long end. Positive is barrel. Adapters add their own on top.',

  /* ---------------- exposure ---------------- */
  'exposure.enabled': 'Switches the light and the automatic exposure on. Off passes the source’s brightness straight through, at a nominal shutter and no gain.',
  'exposure.scene': 'How bright the world is, in stops relative to the light needing f/1.6, 1/60 s and no gain. The automatic exposure works to correct it, using iris, shutter and gain, and how it gets there is the look. Keyframe it to walk outside.',
  'exposure.mode': 'Automatic chases the light with lag; Locked holds an exposure correct for the scene light, ignoring what is in the frame, which is what a careful operator with a manual iris would do.',
  'exposure.comp': 'Exposure compensation in stops: the little wheel. Locked, it is the offset from a correct exposure.',
  'exposure.speed': 'How long the automatic exposure takes to settle after the light changes, in seconds. Consumer cameras took about a second; slower is smoother and more visible.',
  'exposure.damping': 'How the exposure settles: below about 0.7 it overshoots and pumps back — the blow-out-then-darken of walking into daylight — and at 1 it approaches smoothly.',
  'exposure.backlight': 'Backlight compensation: the meter favours the centre and opens up by a stop and a half, so a subject against a bright window is visible and the window burns out.',
  'exposure.shutter': 'The CCD’s electronic shutter. Automatic raises it in bright light. 1/60 s (1/50 in 625) is one field; faster freezes motion into staccato steps and strengthens smear; 1/30 and 1/15 integrate over two and four fields, repeating fields and smearing motion into trails.',
  'exposure.maxGain': 'The most the camera will boost the signal in the dark, in dB. +18 dB was typical. Gain noise is in the signal before the codec, so a gained-up picture costs bits everywhere.',
  'exposure.hunt': 'How much the exposure chases mains flicker and other fast light changes instead of averaging them. Under fluorescent light at a fast shutter the picture flickers; this makes the exposure chase the flicker too.',

  /* ---------------- sensor ---------------- */
  'sensor.enabled': 'Switches the sensor model on: the mosaic and its colour decoding, full wells, blooming, smear and noise. Off is an ideal three-colour sensor with no noise and no clip.',
  'sensor.well': 'Where each photosite stops collecting charge, as a multiple of the charge reference white produces. With gain up, the well clips sooner relative to white. On the mosaic each filter clips at its own point, which colours the edge of a blown sky.',
  'sensor.smear': 'Charge leaking into the vertical registers during readout, as a share of each column’s total light, at 1/60 s. It is a fixed amount per readout while the signal shrinks with the shutter time, so smear grows as the shutter gets faster. CCD only.',
  'sensor.bloom': 'How far a full photosite’s overflow spills into its neighbours: mostly up and down the column, a little sideways. It fattens a point light into a blob before the smear draws its stripe.',
  'sensor.crosstalk': 'How much each colour filter passes of the colours it should block. The camera’s decoding matrix undoes about half of it, so saturated colours — reds especially — come out muddy and noise is amplified. On a Bayer CMOS it is halved; a prism hardly has any.',
  'sensor.noise': 'Read noise at 0 dB, as a share of reference white, scaled by the sensor size. The gain multiplies it; on the mosaic it is decoded into coarse, coloured blotches rather than fine grain.',
  'sensor.shot': 'Photon shot noise, rising with the square root of the signal: grainier highlights than shadows, in absolute terms, until the gain makes the shadows worse.',
  'sensor.headroom': 'A clipped source cannot say how bright a highlight really was. Values within the source’s top few percent are opened up by this many stops, so a sun or a bulb has the energy to fill wells, bloom and smear while a white shirt barely changes. Zero takes the source literally.',
  'sensor.rolling': 'How long a CMOS sensor takes to read from the top row to the bottom, as a share of the field period. The camera’s own motion — pans, shake, whips — is sampled row by row, so verticals lean. Subject motion is sampled once a field.',

  /* ---------------- focus ---------------- */
  'focus.enabled': 'Switches the autofocus model on. Off is perfect focus, which the enormous depth of field of a small sensor almost always gave anyway.',
  'focus.hunts': 'How often the autofocus loses focus by itself, per minute; it also hunts once at the start of every shot. A hunt racks out, back through focus to the other side and settles, over a second or so.',
  'focus.depth': 'How far out of focus a hunt goes at its worst, as blur in DV pixels. Three or four is clearly soft; eight is a smear.',
  'focus.miss': 'A constant focus error in DV pixels: the camera locked on the background behind a near subject, or a lens that never quite got there.',

  /* ---------------- white balance ---------------- */
  'wb.enabled': 'Switches the light’s colour and the white balance on. Off treats the source as already balanced.',
  'wb.light': 'What the scene was lit by, as a colour cast on the light. The camera then tries to remove it. Tungsten and household bulbs are orange; fluorescent tubes green; shade blue.',
  'wb.mode': 'Automatic averages the frame and follows slowly, part of the way; the indoor and outdoor presets correct exactly for 3200 K and 5600 K; Held freezes what it had at the first frame.',
  'wb.speed': 'How slowly the automatic white balance drifts towards its target, in seconds. Consumer cameras took several; walk from a tungsten room to a window and watch it catch up.',
  'wb.range': 'How much of the cast the automatic balance removes, along the amber–blue axis. Green–magenta it barely touches. Around half leaves tungsten clearly orange, as most consumer cameras did.',
  'wb.tint': 'A residual green–magenta error in the camera’s colour matrix, independent of the light. A little is the slightly-off colour every cheap camera had.',

  /* ---------------- stabiliser ---------------- */
  'eis.enabled': 'Switches electronic stabilisation on: a narrower, slightly softer view whose crop moves against the shake once a field.',
  'eis.margin': 'The share of the sensor kept in reserve on each side. A tenth is typical; more corrects bigger shakes but narrows the view and enlarges the crop more.',
  'eis.strength': 'How much of the shake’s fast part the crop cancels. Even at 1 the blur from shake during the exposure remains, which is the stabiliser’s giveaway.',

  /* ---------------- digital zoom ---------------- */
  'dzoom.enabled': 'Lets the zoom go past the optical range by enlarging a crop of the sensor in the camera.',
  'dzoom.max': 'The most the digital zoom will enlarge, on top of the optical range. The box’s “500×” was 25× optical times 20× digital.',
  'dzoom.filter': 'How the crop is enlarged: pixel repeat makes square blocks of sensor pixels, in each field separately; linear interpolation is softer but still has no detail to show.',

  /* ---------------- tone ---------------- */
  'tone.enabled': 'Switches the camera’s transfer curve on. Off uses a plain sRGB curve with no knee and no clip, so the camera adds nothing to the tones.',
  'tone.gamma': 'The transfer exponent, about 0.45 for a video camera, with the linear toe of Rec. 601. Lower is flatter and lighter in the midtones.',
  'tone.knee': 'The signal level at which the knee starts compressing highlights. 0.85 to 0.9 was usual; lower holds more highlight detail at the cost of flatter highs.',
  'tone.slope': 'The slope of the curve above the knee. Shallow holds bright skies further before the wall; steep reaches the clip quickly.',
  'tone.clip': 'The white clip in IRE. 100 is reference white; consumer DV cameras ran to about 108 or 109, the superwhites a FireWire capture kept and a display might clip.',
  'tone.pedestal': 'Black level. Positive lifts the blacks into grey; negative crushes shadow detail, which some cameras did to hide noise.',
  'tone.saturation': 'The camera’s chroma gain. Consumer cameras ran a little hot to look vivid in the shop; more also amplifies the mosaic’s colour noise.',

  /* ---------------- detail ---------------- */
  'detail.enabled': 'Switches the detail enhancer on: the peaking filter every camcorder applied before recording.',
  'detail.gain': 'How strongly edges are boosted. 1 is a normal consumer setting; 2 and above is the brittle early-2000s look that also rings in the codec.',
  'detail.freq': 'The peaking filter’s reach in DV pixels. Around one pixel gives thin halos that sharpen fine detail; two or three gives wide halos round everything.',
  'detail.vertical': 'Vertical enhancement as a share of the horizontal. It compares lines of the same field, two frame lines apart, so horizontal edges twitter between fields.',
  'detail.coring': 'Detail below this amplitude is not boosted. It keeps the enhancer from sharpening gain noise into grit; set it too high and fine texture goes flat.',
  'detail.limit': 'The largest boost any edge receives. It caps the halo on the strongest edges, which is why they look outlined rather than glowing.',
  'detail.dark': 'Strength of the dark fringe relative to the bright one. Cameras often clipped the dark side less, giving a black line under bright edges.',

  /* ---------------- battery ---------------- */
  'battery.enabled': 'Switches the battery model on: it drains with recording and standby, and when it is empty the camera stops recording.',
  'battery.charge': 'How full the battery was at the first frame, in percent. Below about 10 percent the display’s gauge blinks.',
  'battery.capacity': 'Minutes of recording on a full charge. Standby between shots drains it at a third of the rate, so long gaps between shots shorten the evening.',

  /* ---------------- night ---------------- */
  'night.enabled': 'Swings the IR-cut filter out and lights the IR lamp: near-monochrome green, a central hot spot, glowing eyes.',
  'night.ir': 'The infrared lamp’s strength, as light comparable to the scene. It is metered like any other light, so a bright lamp pulls the exposure down and the edges fall to black.',
  'night.spot': 'The lamp’s beam width as a share of the frame’s half-diagonal. Narrow is a torch-like hot spot; wide is an even wash.',
  'night.green': 'How strongly the near-monochrome picture is tinted green, as these cameras’ colour processing rendered infrared.',
  'night.eyes': 'Retro-reflection: the brightest small reflectors under the lamp — eyes, above all — glow. At 0 they are merely bright.',

  /* ---------------- effects ---------------- */
  'fx.enabled': 'Switches the camera’s digital effects and its fader on. They ship off; they were a button most owners pressed once and then forgot.',
  'fx.effect': 'The picture effect. Sepia and black-and-white tint the chroma; “old movie” adds a field-rate flicker; mosaic quantises to cells; strobe holds frames; trail mixes in the frame before; negative inverts.',
  'fx.fader': 'A fade in from black or white at the start of each shot, as pressing REC with the fader armed did. The sound fades in with it.',
  'fx.faderTime': 'How long the fade in takes, in seconds, picture and sound together. A second and a half was the usual built-in fader.',
  'fx.size': 'For mosaic, the cell size in DV pixels; for strobe, how many fields a frame is held for.',

  /* ---------------- interlace ---------------- */
  'interlace.enabled': 'Records two fields a frame, each a separate moment. Off records progressive frames, both fields from one instant, which a DV camcorder never did — here to compare.',
  'interlace.integration': 'Field integration sums adjacent sensor rows in pairs, offset by one row between fields: less vertical resolution per field, less aliasing and twitter. Off reads single rows. The complementary mosaic always uses the pairs.',
  'interlace.lowerFirst': 'DV is bottom field first in both systems. Turning this off makes the top field the earlier one, which is wrong for DV and makes motion judder on any correctly configured player.',

  /* ---------------- chroma ---------------- */
  'chroma.enabled': 'Subsamples the colour as DV does: 4:1:1 or 4:2:0. It is forced on while the codec is enabled, because DV cannot code full-resolution colour.',
  'chroma.upsample': 'How the playback side fills the colour back out to full resolution. Repeat shows the hard four-pixel steps of 4:1:1; interpolation spreads them into a bleed.',

  /* ---------------- codec ---------------- */
  'codec.enabled': 'Encodes and decodes every frame with the DV codec model: DCT, classes, segment rate control, quantisation and the inverse DCT. Off leaves the camera’s picture uncompressed.',
  'codec.budget': 'The bits available to each five-macroblock segment, as a multiple of DV’s 25 Mbit/s. At 1 simple pictures are near transparent and busy, noisy ones block; at 0.5 everything does.',
  'codec.dct248': 'Allows blocks whose two fields differ to use the 2-4-8 transform, coding field sum and difference separately. Off codes interlaced motion with the 8-8 transform, which costs more bits and rings vertically.',
  'codec.shuffle': 'Builds each segment from five macroblocks scattered across the frame, as DV does, so a busy area borrows bits from quiet ones elsewhere. Off takes five neighbours, and busy areas starve locally while quiet ones are pristine.',
  'codec.classes': 'Sorts blocks into four activity classes and quantises busy blocks more coarsely. Off treats every block alike.',

  /* ---------------- tape ---------------- */
  'tape.enabled': 'Switches tape errors on: dropouts and head clogs, concealed as a DV decoder conceals them.',
  'tape.speed': 'SP or LP. LP’s narrower tracks give about three times the dropouts, and the timecode readout shows the longer remaining time.',
  'tape.dropouts': 'Damaged stretches of track per minute of tape. Each takes some segments from a run of tracks, so blocks drop out all over the frame at once.',
  'tape.size': 'How much of the damaged tracks is lost. Small takes a few segments and the audio stutters; 1 takes every track of the frame, so the picture freezes and the sound mutes.',
  'tape.conceal': 'What replaces a lost macroblock: the same macroblock of the previous frame (frozen or misplaced rectangles on the block grid), or grey or green blocks from a decoder that did not conceal.',
  'tape.clogs': 'Head clogs per minute: the whole picture freezes on the last good frame and breaks into slipping blocks until the head clears.',
  'tape.clogLength': 'How long a clog lasts, in seconds, before the head cleans itself and the picture returns as suddenly as it went.',

  /* ---------------- breaks ---------------- */
  'breaks.enabled': 'Switches recording breaks on: the tape is a sequence of shots, each a stretch of the world, butted together.',
  'breaks.rate': 'How often the camera was stopped and started, per minute of source. Each break is a cut, a clunk, a jump of the clock and a fresh autofocus hunt.',
  'breaks.skip': 'How many seconds of the source go unrecorded at each break, on average. Zero keeps the picture continuous, so the break is only heard and seen on the clock.',
  'breaks.gap': 'The average time that passed on the wall between shots, in minutes. The date stamp jumps by it; the battery drains a little during it.',
  'breaks.seamless': 'The camera backs up over the end of the last shot before recording, so the cut is clean and the timecode runs on. Off leaves a garbage frame at the cut and restarts the timecode at zero.',

  /* ---------------- camera display ---------------- */
  'osd.enabled': 'Draws the camera’s viewfinder display into the chain at the chosen point.',
  'osd.insert': 'Where the display enters the chain. After decode is the AV output with the display on; before the codec burns it into the recording, which no camera did; on the display draws it on the output’s own pixel grid.',
  'osd.rec': 'REC with a red dot while recording; STBY once the battery has died and the camera has stopped.',
  'osd.counter': 'The tape counter in hours, minutes and seconds — tape time, which runs straight across breaks — or the minutes of tape remaining.',
  'osd.battery': 'The battery gauge. It follows the Battery section when that is on, and blinks when nearly empty.',
  'osd.batteryStyle': 'The shape of the battery gauge: four, three or five bars in a case with a nub, a continuous fill, an upright cell filling from the bottom, the charge as a percentage, the minutes left as later batteries reported them, or nothing at all until it is nearly flat. All drawn for this project in the manner of the period.',
  'osd.zoomBar': 'The W–T bar with its marker, shown while the zoom is moving, and the digital magnification once past the optical range.',
  'osd.mode': 'The recording mode: SP or LP, 12-bit or 16-bit audio, and 16:9 when the camera is in its wide mode.',
  'osd.warnings': 'Lets the low-battery warning blink. Off shows the gauge steadily however empty.',
  'osd.font': 'The lettering of the display. Classic is the plain 5 × 7 dot matrix; bold, italic and seven-segment digits are the same size; large, dot matrix and hollow are twice the size, as some cameras drew their imprints. Every face is drawn for this project.',
  'osd.edge': 'How the lettering is keyed over the picture: a black outline all round, as most character generators did, a drop shadow, or bare ink that vanishes against bright sky.',
  'osd.colour': 'The character generator’s ink: white, or yellow as some cameras used. Orange is the third choice. The Edge setting keeps it readable on a bright picture.',

  /* ---------------- date ---------------- */
  'date.enabled': 'Draws the date and time of recording into the chain at the chosen point.',
  'date.insert': 'Where the date enters the chain. Before the codec is an imprint, as analogue cameras did; after decode is DV’s data code drawn at playback; on the display is sharp on the output’s pixels.',
  'date.format': 'Regional date order: JAN 15 2003 as American cameras showed it, 15.1.2003 as European ones did, or 2003 1 15.',
  'date.clock': '12-hour time with AM and PM, as American cameras showed it, or 24-hour as most others did.',
  'date.year': 'The year the first shot was taken. The clock runs on from the date and time set here.',
  'date.month': 'The month the first shot was taken, 1 to 12. The clock runs on from here, across midnight and the end of the month.',
  'date.day': 'The day of the month the first shot was taken. A day past the month’s end is taken as its last day.',
  'date.hour': 'The time of day of the first shot, in hours as a decimal: 8.25 is quarter past eight in the morning.',
  'date.unset': 'The camera’s clock was never set, so every recording is stamped with its factory default — midnight on the first of January 2000 — and runs on from there.',
  'date.font': 'The lettering of the date and time, chosen apart from the display’s, as the imprint and the viewfinder were often different. The large faces suit an imprint burned in before the codec.',
  'date.edge': 'How the date is keyed over the picture: outline, drop shadow, or bare ink.',
  'date.colour': 'The ink of the date characters. Orange was the colour of many analogue imprints.',

  /* ---------------- capture ---------------- */
  'capture.enabled': 'Switches the capture stage on. With it off, or set to FireWire, the decoded DV is the picture.',
  'capture.path': 'FireWire copies the stream exactly. S-Video sends luma and chroma separately to an analogue card. Composite sends one signal and the card must separate colour from brightness.',
  'capture.decoder': 'How a composite card separates chroma: a notch filter is cheap, soft and full of cross-colour; a two-line comb is sharper but fringes where colour changes vertically.',
  'capture.bandwidth': 'The analogue path’s luma bandwidth in MHz. 4.2 is broadcast NTSC; a cheap card or a long cable is closer to 3. Lower is softer.',
  'capture.chromaDelay': 'Colour arriving late through the card’s chroma path, in DV pixels: colour shifted right of the edges it belongs to.',
  'capture.noise': 'Noise picked up on the cable and in the card, added to the analogue signal before it is decoded.',
  'capture.levels': 'Studio levels map reference white to white and clip the superwhites; full range shows the whole coding range, superwhites included, with greyish blacks.',

  /* ---------------- deinterlace ---------------- */
  'deint.enabled': 'Applies a deinterlacer. Off shows the full woven frame, which is what a progressive display does with interlaced video by default.',
  'deint.mode': 'Weave keeps both fields (combing), bob shows each field line-doubled (twitter), blend averages them (ghosts), discard keeps one field (half resolution).',

  /* ---------------- upload ---------------- */
  'upload.enabled': 'Passes the picture through a 2006 web upload: a field discarded, a small raster, a low frame rate and a second codec.',
  'upload.width': 'The upload’s width in pixels; the height follows the aspect. 320 was the standard of the early video sites.',
  'upload.fps': 'Frames kept per second. Frames are held between, so motion steps; 15 was common to save bandwidth.',
  'upload.quality': 'The second codec’s quantiser step. Higher is blockier, with blocks eight pixels on the small raster — over thirty on a 1080p screen.',

  /* ---------------- output ---------------- */
  'framing.aspect': 'The shape of the output frame. As recorded follows the camera’s 4:3 or 16:9 flag; forcing the other crops the picture to fill rather than adding bars.',
  'framing.overscan': 'Shows the full 720 samples of the raster rather than the 704-wide active picture that 4:3 and 16:9 refer to. The edges were never meant to be seen.',
  'framing.scaler': 'How the DV raster is enlarged to the output: nearest shows the pixels as blocks; bilinear is soft; good resampling is a sharper windowed kernel.',
  'framing.fps': 'One output frame per DV frame (29.97 or 25), or one per field (59.94 or 50), each showing its own field — what bob deinterlacing needs to be smooth.',
  'framing.dither': 'Dither added when writing 8-bit output, in code values. It breaks up banding in smooth gradients; zero is undithered.',

  /* ---------------- audio ---------------- */
  'audio.enabled': 'Records the sound through the camera’s chain. Off passes the source’s soundtrack through untouched.',
  'audio.mode': '16-bit at 48 kHz, or the non-linear 12-bit code at 32 kHz, which is band-limited near 15 kHz and quantises loud passages more coarsely.',
  'audio.inputGain': 'The level of the source’s sound at the microphone, in dB. The automatic gain then fights whatever you set here.',
  'audio.channels': 'The camera’s stereo microphone, or the two channels summed to mono as many cameras effectively recorded them.',
  'audio.output': 'The level of everything you hear here and in exports, in dB, after the recording. It changes nothing about how the camera recorded.',

  /* ---------------- microphone ---------------- */
  'mic.enabled': 'Switches the microphone model on: the capsule’s response, the room tone and the wind.',
  'mic.low': 'The capsule’s low cut in Hz. A small camera microphone has little below 100–150 Hz.',
  'mic.high': 'The capsule’s high cut in Hz. 12 kHz is a cheap capsule; 16 kHz and up a good one, which 12-bit recording would cut anyway.',
  'mic.presence': 'A peak in the upper midrange, around 4 kHz, in dB: the forward, slightly harsh voice of a camcorder microphone.',
  'mic.room': 'The level of the room’s air and the preamp’s hiss, in dB. Quiet in itself; the automatic gain lifts it in every pause.',
  'mic.wind': 'Wind across the grille: low, gusting rumble that overloads the microphone. The wind cut thins it.',
  'mic.windCut': 'The wind filter: everything below about 200 Hz removed, wind and voice alike.',

  /* ---------------- camera noise ---------------- */
  'mech.enabled': 'Lets the microphone hear the camera. With the source silent, this is the camera’s whole soundtrack.',
  'mech.transport': 'The head drum’s whine and the capstan, in dB. The drum turns at 9000 rpm, so its fundamental is about 150 Hz and locked to the frame rate.',
  'mech.zoom': 'The zoom motor at full speed, in dB: a whirr and a gear buzz that rise in pitch with the zoom’s speed.',
  'mech.focus': 'The focus motor’s ticks while the autofocus hunts, in dB: a fast train of clicks, quicker as the hunt moves faster.',
  'mech.rec': 'The REC button’s clunk at the start of every shot, in dB, recorded as the first thing on the shot.',
  'mech.handling': 'A hand shifting its grip, in dB: the thump of each bump and the rustle round it.',

  /* ---------------- AGC ---------------- */
  'agc.enabled': 'Switches the automatic gain control on: the pumping and breathing of consumer camera sound.',
  'agc.target': 'The level the AGC tries to hold, in dBFS. Higher is louder and closer to the limit.',
  'agc.maxGain': 'The most it will turn up a quiet passage, in dB. 20–30 dB makes a silent room roar with its own air.',
  'agc.maxCut': 'The most it will turn down a loud passage, in dB. A few dB keeps the soundtrack you brought in as it was recorded, with the camera’s breathing in the quiet parts; tens of dB squash everything to one level, the way the cheapest cameras did.',
  'agc.attack': 'How quickly the gain comes down when something loud happens, in milliseconds. Fast ducks everything at once.',
  'agc.release': 'How slowly the gain comes back up afterwards, in seconds. A second or more is the audible breathing.',

  /* ---------------- link ---------------- */
  'link.enabled': 'Switches all the picture–sound couplings off, leaving the picture and the sound as two separate effects.',
  'link.zoomMotor': 'How much the zoom’s speed drives the zoom motor’s whirr. The motor is heard only while the zoom moves.',
  'link.focusTicks': 'How much a focus hunt in the picture is heard as the focus motor ticking, at the same moments.',
  'link.breakClunk': 'How loud the REC clunk and the cut are at each recording break, at the frame the picture cuts.',
  'link.dropoutMute': 'How much a dropout mutes or stutters the sound. The audio is on the same damaged tracks as the picture.',
  'link.bumpThump': 'How loud a handling bump’s thump is, at the moment the frame jolts.',
  'link.frameWhine': 'How tightly the transport’s whine is locked to the frame rate. At 0 the drum wanders in pitch like an unlocked motor.',
};
