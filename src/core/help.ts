/**
 * Explanatory text for the interface.
 *
 * This lives apart from the schema on purpose. `params.ts` is a machine-read
 * description of ~210 controls — ranges, defaults, types — and burying several
 * paragraphs of prose in each entry would make the thing nobody can skim. Here
 * the prose can be written as prose.
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
 * Coverage is asserted by the smoke test: every parameter in the schema must
 * have an entry here, so a new control cannot ship undocumented.
 */

export interface SectionHelp {
  /** What this section models, in a sentence or two. */
  what: string;
  /** How to drive it — the practical advice a manual would give. */
  how: string;
}

export const SECTION_HELP: Record<string, SectionHelp> = {
  composite: {
    what: 'The composite signal itself. Luma and the two colour-difference channels are modulated onto a single subcarrier at 227.5 cycles per line, band-limited, and then separated again at the other end. Nothing in this section is drawn on: dot crawl, rainbow cross-colour and comb fringing all fall out of doing that round trip for real.',
    how: 'Chroma demodulation is the decision that matters most — Box is a cheap set and leaves maximum dot crawl, a 2-line comb is a good late-model one and leaves almost none. Scanline phase shift decides whether the dot pattern creeps diagonally, straight up, or sits still. If you render at a higher resolution and the artefacts look too fine, raise Bandwidth scale rather than touching anything else.',
  },
  tape: {
    what: 'The videotape itself: what a domestic deck could store and read back. Tape speed is not a style control, it is a pair of bandwidth numbers, and everything people recognise about a long-play recording follows from those numbers being small.',
    how: 'Set the speed first and judge everything else after. SP is a careful recording, EP is six hours crammed onto one cassette and barely has colour left. Output sharpen is the deck trying to put back what the tape lost and overdoing it — that halo is one of the most recognisable VHS signatures, so leave some of it in. Edge wave belongs with it: a tape that does not wander at all does not read as a tape.',
  },
  vnoise: {
    what: 'Noise introduced in the signal domain rather than painted onto the finished picture. Because it is added before decoding, it goes through the same filters and the same chroma separation as the picture does, which is why it lands as horizontal streaks and blotchy colour rather than as film grain.',
    how: 'Composite noise is the honest one — it hits brightness and colour together the way real noise did. Chroma noise at a low frequency gives the blotchy, drifting colour of a tired tape and is worth more than any amount of luma noise. Keep Snow sparse; it models dropouts, not static, and the Signal & Reception section upstairs already does static properly.',
  },
  headswitch: {
    what: 'The rotating head drum and the tracking servo. The drum swaps heads near the bottom of every field, and when the tracking is not quite right a band of the picture tears and fills with noise.',
    how: 'Head switching along the bottom edge should essentially always be on — every helical-scan playback that has ever existed had it, and its absence is more noticeable than its presence. Tracking noise is the dramatic one: a band drifting up the screen, the thing you used to fix by holding the tracking button down. Keyframe it so it arrives and passes rather than leaving it running.',
  },
  engine: {
    what: 'A master bypass for each of the two emulators. The Tape engine is the signal — composite encode and decode, the videotape, signal noise, head switching. The Tube engine is the display — reception, geometry, beam, phosphor, glow, tube response and wear.',
    how: 'Use these to work out where something is coming from. If an artefact you do not want survives switching the Tape engine off, it belongs to the tube, and the other way round. They are also the quickest route to the two half-looks that are genuinely useful on their own: a clean signal on a bad tube, and a bad tape shown flat.',
  },
  picture: {
    what: 'The four knobs that were on the front of every television, plus how the source file is read. These act on the signal before it reaches the tube, exactly where they sat on a real set — which is why turning Contrast up makes the beam bloom rather than simply making the image lighter.',
    how: 'Set these first and leave them roughly alone. They are the baseline the rest of the app is tuned against: if you find yourself fighting a preset, it is usually Brightness and Contrast that want nudging, not the twenty controls further down.',
  },
  colour: {
    what: 'Grey-scale tracking and the behaviour of the colour decoder. A CRT was never colour-accurate — the white point drifted with brightness, the three guns aged at different rates, and the decoder gave up entirely on a weak signal.',
    how: 'Temperature is the one to reach for: most consumer sets ran a cold blue-white near 9300 K rather than the D65 that broadcast assumed, and pushing it positive is an instant period cue. Colour killer is the quiet star — turn it up and a degraded signal falls to monochrome the way a real set did, which reads as far more broken than simply desaturating.',
  },
  signal: {
    what: 'Everything that happened to the picture between the transmitter and the video amplifier: band-limiting, the crosstalk between luma and chroma that composite video cannot avoid, multipath reflections, and tuner noise.',
    how: 'Signal path at the top sets the character of everything else — Component is a clean feed and bypasses most of this, RF is the worst case. Luma and chroma bandwidth are the real softness controls; they do far more for believability than any blur. Signal loss is a master fade all the way to static, and it drags the audio with it when A/V Link is on.',
  },
  sync: {
    what: 'The timebase: when each line and each field actually starts. Tape machines could not hold this steady, and the ways they failed are the most recognisable thing about tape.',
    how: 'Small amounts go a long way. Horizontal jitter at 1–2 px with coherence around 0.5 gives a picture that breathes; past about 6 px it stops reading as a tape and starts reading as an effect. Head-switch noise along the bottom edge is the single most VHS-specific control here.',
  },
  geometry: {
    what: 'The shape of the raster on the glass: faceplate curvature, the size and position of the scanned area, and the geometric errors every set had because the deflection yoke was aligned by hand.',
    how: 'Aspect decides the shape of the exported file, not just the preview — the frame is always the shape of the tube, so there are never bars baked in. Overscan is the honest one: sets really did scan 4–8% past the bezel, so the edges of your footage were never meant to be seen. A little Rotation is more convincing than none, because almost every real set had some.',
  },
  beam: {
    what: 'How the electron spot paints the picture one line at a time. Not a scanline overlay — the image is reconstructed as a sum of beam profiles, so a bright line is physically fatter than a dim one.',
    how: 'Beam blooming is the control that matters: it is what separates this from a scanline filter laid over a video. Active lines should match the material — 240 for a console or camcorder, 480 for broadcast. Exposure is already compensated for whatever the scanlines throw away, so leave Bright boost at 1.0 unless you want it brighter on purpose.',
  },
  phosphor: {
    what: 'The steel mask behind the glass and the phosphor dots it exposes. Three different mask geometries, each belonging to a different kind of set, plus the afterglow that makes motion smear.',
    how: 'Mask type is a strong identity choice: aperture grille for a Trinitron or an arcade monitor, slot for a normal consumer television, shadow for an older or softer set. Watch Mask pitch against your output resolution — below about 3 screen pixels per triad the mask stops being texture and becomes moiré. Persistence is what gives motion its trail, and the tilt biases that trail green, which is what P22 phosphor actually did.',
  },
  glow: {
    what: 'What happens to light after it leaves the phosphor: a tight bloom around bright areas, a wide warm halation from light bouncing around inside the thick faceplate, and the state of the glass itself.',
    how: 'Bloom threshold is the control people set wrong. Put it low and a flat mid-grey field glows, which no tube has ever done; keep it high enough that only genuine highlights scatter. Halation should be wider and weaker than you think, and warm — red scatters furthest through glass.',
  },
  convergence: {
    what: 'Three separate electron guns aimed at the same spot, and never quite succeeding. Convergence was adjusted at the centre of the screen, so the error is smallest there and grows towards the corners.',
    how: 'Sub-pixel offsets are plenty — half a pixel of red one way and blue the other already reads as a real set. Radial error is what sells it, because uniform fringing everywhere looks like a filter while fringing that worsens towards the corners looks like a tube. Edge defocus does the same job for sharpness.',
  },
  tube: {
    what: 'The electro-optical transfer function and the power supply behind it: how grid voltage becomes light, and what happens to that relationship when the rail is loaded or the mains ripples through it.',
    how: 'CRT gamma around 2.4 is the number the entire video standard was built around, so it is a sensible place to stay. The hum bar is the most useful control in the section — a soft bright band drifting slowly up the screen, and if you link it to the audio hum under A/V Link the picture and the sound become the same fault.',
  },
  faults: {
    what: 'A set that has been in the corner of a room for decades: phosphor burned by a static image, dust pulled onto the glass by static charge, and the colour-warping ripple of the degauss coil.',
    how: 'Burn-in accumulates over the length of the clip rather than being painted on, so it wants a long clip to show. Dust is subtle and worth leaving on. Degauss is a one-shot event — fire it on a cut for a jolt of colour distortion that resolves over about a second.',
  },
  glitch: {
    what: 'Discrete failures rather than continuous wear. Everything here fires in bursts on an event clock, so it punctuates a shot instead of sitting on it, which is what makes a cut land.',
    how: 'Event rate is the master: at zero the whole section is silent however high the individual amounts are, so use it to dial the whole thing in and out over a scene. Tape dropout and Sync slip are the analogue failures; Block corruption is deliberately digital, for the moment a transfer rather than a tape gives up. Keyframe Event rate for a glitch that arrives and passes.',
  },
  output: {
    what: 'The last few things between the glass and you: the plastic bezel, the light in the room, and the final exposure of the rendered frame.',
    how: 'Ambient light matters more than it looks — a screen is never truly black in a lit room, and a tiny amount of lift makes the whole image sit in a space rather than float in a void. Leave Dither on; it costs nothing and removes banding from the dark end of the gradient.',
  },

  audio: {
    what: 'What reaches the television\'s audio stage in the first place. Nearly every set before the mid-eighties was mono, and the ones that were not used a difference channel that fails in a very particular way.',
    how: 'Mono collapse is the first thing to reach for — 0.7 kills the modern stereo image while keeping a hint of width. The Difference (L−R) channel mode is the uncanny one: it is the stereo subcarrier alone, so centre-panned dialogue simply vanishes and what is left is reverb and whatever was panned wide.',
  },
  transport: {
    what: 'The mechanical parts of a tape machine, modelled as real pitch modulation through a fractional delay rather than as a pitch effect. Wow is once per revolution, flutter is faster, scrape is the tape juddering against the heads.',
    how: 'Depth before rate. A little wow with a little random drift is what stops the wobble sounding like an LFO, which is the usual giveaway. Dropouts are worth enabling even at a low rate — the level falling out for an instant does more for "this is a tape" than any amount of hiss.',
  },
  speaker: {
    what: 'A small paper cone in an unsealed plastic box, pointing at a carpet. The band limits matter, but the resonant peaks matter more: a cabinet honk is what the ear recognises as a television.',
    how: 'Box resonance is the single most effective control in the app for the sound. Set the filters first to get the band roughly right, then find the honk. Cabinet IR convolves with a synthesised small-box response for real modal ringing instead of static EQ, and Through the wall is a one-control macro for a set playing in another room.',
  },
  dynamics: {
    what: 'Broadcast processing: the compression and limiting that every transmission chain applied to keep levels up, plus the saturation of the stages it passed through.',
    how: 'Pumping is the point, not a fault to be avoided — short release times make it audible, and audible pumping is the sound of broadcast. The three saturation models are genuinely different: tape is soft and symmetric, transformer adds a second harmonic, output stage hard-clips the way a cheap amplifier does when you turn it up.',
  },
  noise: {
    what: 'The bed of noise a television made while doing nothing at all: mains hum through the chassis, the line-output transformer singing, tape hiss, RF roar and mechanical rumble.',
    how: 'Flyback whine is the most identifiable sound a CRT makes — 15.734 kHz on NTSC, 15.625 kHz on PAL. If your audience will hear it on laptop speakers or through a lossy codec, switch on "Shift whine into range" to drop it an octave where it survives. Hum character is worth understanding: a ground loop gives odd harmonics and buzzes, a transformer gives even ones and hums.',
  },
  crackle: {
    what: 'Contact faults: a corroded connector, a dry solder joint, a worn volume control. Events are Poisson-distributed so the spacing never falls into a rhythm, and amplitudes follow a power law so most clicks are tiny and the occasional one is enormous.',
    how: 'Keep the rate low and the impulsiveness high — that combination gives long quiet stretches broken by a single loud pop, which is far more unsettling than constant crackle. Burst rate adds clusters, for a joint that arcs rather than a connector that merely ticks.',
  },
  link: {
    what: 'The reason the picture and the sound belong to the same object. On a real set they shared a power supply, a chassis and an aerial, so faults showed up in both at once — and nothing else in this application matters as much as this section.',
    how: 'Turn these up before you reach for anything else. Hum bar → hum locks the band drifting up the screen to the hum in the speaker so they are audibly the same ripple. Signal loss → static takes the sound down with the picture. Audio → brightness sags the rail on loud passages so the image dims and swells with the soundtrack, which is real and almost never emulated.',
  },
};

/**
 * Per-parameter detail.
 *
 * Written to answer "what happens if I move this, and why would I", since the
 * one-line hint already answers "what is it".
 */
export const PARAM_HELP: Record<string, string> = {
  /* ---------------- engine masters ---------------- */
  'engine.tape': 'Switches off the entire signal half in one go — composite encode and decode, the videotape, signal noise and head switching — rather than making you find four separate section switches. Travels in presets, so a look that is deliberately a clean feed on a bad tube records that fact.',
  'engine.tube': 'Switches off the entire display half: reception, sync, geometry, beam and scanlines, phosphor and mask, glow, convergence, tube response, wear and glitching. What you are left with is the signal shown flat, which is the honest way to judge what the tape engine alone is doing.',

  /* ---------------- composite (tape engine) ---------------- */
  'composite.enabled': 'Bypasses the composite encode and decode entirely, so the tape section acts on an untouched picture. Switch it off to see how much of the look is coming from the signal model rather than from the tube.',
  'composite.bandwidthScale': 'Multiplies every frequency in the signal model at once. The artefacts are defined in cycles across a line, so at a higher render resolution they would otherwise become too fine to see — raise this and the look stays put as the pixel count changes.',
  'composite.demodulation': 'How colour is pulled back out of the composite signal, and the single biggest decision in this section. Box is a flat average and leaves the most dot crawl and rainbow, which is what a cheap set did. Notch removes the subcarrier band and takes real detail with it. The comb filters compare against neighbouring lines, cancelling almost all dot crawl at the cost of colour fringing wherever the picture changes vertically.',
  'composite.phaseShift': 'How far the subcarrier advances from one line to the next. This is what makes dot crawl crawl rather than sit still: at 90° it creeps diagonally over a four-field cycle, at 180° it climbs straight up, and at 0° it is stationary and immediately looks wrong.',
  'composite.phaseShiftOffset': 'Which field of the four-field colour sequence the first frame starts on. Changes where in the cycle the pattern begins; useful only when matching a specific capture.',
  'composite.preemphasis': 'Transmission chains boosted high frequencies before sending and cut them again on receipt, to get above the noise floor. At 1.0 the two match. Away from 1.0 they do not, and you get the sharpened, ringing edge that every analogue picture had.',
  'composite.ringing': 'Overshoot from the band-limiting filter, seen as a bright echo trailing each hard vertical edge. Distinct from the tube\u2019s own ringing in that it happens in the signal, so it is encoded and decoded along with the picture.',
  'composite.ringingFrequency': 'Where in the band the filter rings. Lower values put the echo further from the edge and make it broader and more obvious.',
  'composite.ringingPower': 'How sharply the filter cuts off, and therefore how many visible ripples follow an edge before it settles. Higher is a steeper filter and a busier fringe.',
  'composite.chromaLowpassIn': 'How hard colour is filtered before it is encoded onto the carrier. Real equipment filtered it heavily because the chroma channel is narrow, so some of this is correct rather than a fault. Raising it smears colour horizontally before anything else happens to it.',
  'composite.chromaLowpassOut': 'A second filter after decoding, to suppress what is left of the subcarrier. Raising it cleans up the dot pattern at the cost of colour detail; lowering it leaves the decoded picture visibly fizzing.',
  'composite.chromaDelayH': 'Colour is filtered harder than brightness, which delays it, so it arrives late and sits to one side of the object it belongs to. A pixel or so is typical of a real decoder.',
  'composite.chromaDelayV': 'The same error vertically, which is rarer and comes from the comb filter rather than the band-limiting. Small values only.',
  'composite.chromaPhaseError': 'A constant error in the decoder\u2019s reference phase. Because hue is carried as the phase of the subcarrier, getting that reference wrong rotates every colour in the picture at once — this is the fault the Tint knob on an NTSC set existed to cancel.',
  'composite.lumaSmear': 'The video amplifier fails to settle coming off a bright area, so brightness drags to the right out of highlights. Reads as a cheap deck or a long cable rather than as a blur.',

  /* ---------------- tape ---------------- */
  'tape.enabled': 'Bypasses the videotape stage, leaving the composite signal model running on its own. That combination is a broadcast feed rather than a recording, and is the right starting point for something that was meant to be live.',
  'tape.speed': 'Which recording mode the tape was made in, which sets the luma and chroma bandwidth together exactly as the real format did. SP is the best a domestic deck managed; LP is softer with the colour starting to go; EP crams six hours onto one cassette and has barely any chroma left. Choose this before touching anything else in the section.',
  'tape.chromaLoss': 'Colour drops out completely on random lines. This is what a genuinely worn tape does — chroma is recorded at a lower frequency and in a more fragile way than luma, so it fails first and brightness carries on long after the picture has gone monochrome in patches.',
  'tape.chromaVertBlend': 'VHS averaged colour between adjacent lines to save bandwidth, so vertical colour detail is half what the luma has. Leave it on for anything claiming to be a tape; switching it off is a broadcast signal.',
  'tape.sharpen': 'The deck\u2019s output stage trying to put back the detail the tape lost, and overshooting. The resulting bright halo on every edge is one of the most recognisable VHS signatures, and leaving it at zero makes footage look soft rather than taped.',
  'tape.sharpenFrequency': 'Which band the sharpener works on. Higher values target finer detail and give a tighter halo; lower values give a broad, obvious glow around edges.',
  'tape.edgeWave': 'The tape wanders against the head, so each line starts at a slightly wrong place and the left edge of the picture ripples. Measured in pixels of displacement. A small amount is present on every real tape.',
  'tape.edgeWaveSpeed': 'How quickly the ripple changes over time. Slow values breathe, fast values shimmer.',
  'tape.edgeWaveFrequency': 'How quickly the displacement varies down the picture. Low values bend the whole frame as one; high values make neighbouring lines disagree and the edge goes ragged.',
  'tape.edgeWaveDetail': 'Octaves of noise in the ripple. One octave is a smooth bend; more adds finer wobble on top, which reads as a worse-maintained transport.',

  /* ---------------- signal noise ---------------- */
  'vnoise.enabled': 'Bypasses all four noise sources in the signal domain. The tube has its own snow and grain upstairs — this section is the noise that existed before the picture was ever displayed.',
  'vnoise.compositeNoise': 'Noise added to the composite signal itself, before anything is decoded. The most physically honest of the four, because it goes through chroma separation along with the picture and therefore disturbs brightness and colour together the way real noise did.',
  'vnoise.compositeNoiseFrequency': 'How fine the noise is. Low frequencies give broad horizontal bands rolling through the picture; high frequencies give a fizz close to grain.',
  'vnoise.compositeNoiseDetail': 'How many octaves of noise are summed. One is smooth and banded; more adds finer structure on top without changing the overall scale.',
  'vnoise.lumaNoise': 'Noise on brightness alone, applied after decoding. Less physically motivated than composite noise but easier to control when you want grain without disturbing the colour.',
  'vnoise.lumaNoiseFrequency': 'How fine the brightness noise is, from slow banding to fine grain.',
  'vnoise.lumaNoiseDetail': 'Octaves summed into the brightness noise. One octave is smooth and banded; adding more layers finer structure on top without changing the overall scale of the noise.',
  'vnoise.chromaNoise': 'Noise on colour alone. At a low frequency this is the blotchy, drifting colour of a tired tape, and it does more for the impression of age than luma noise does — the eye forgives grain and does not forgive wandering colour.',
  'vnoise.chromaNoiseFrequency': 'How fine the colour noise is. Keep it low: large, slow blotches read as a tape, fine colour speckle reads as a digital fault.',
  'vnoise.chromaNoiseDetail': 'Octaves summed into the colour noise. Keep this low — multiple octaves of chroma noise start to look like coloured grain, and the blotchy single-octave version is the one that reads as a worn tape.',
  'vnoise.chromaPhaseNoise': 'Random jitter in the decoder\u2019s reference phase from line to line, so hue wanders down the picture. Because it is phase rather than amplitude, colours shift rather than getting noisier, which is a very specific and very analogue kind of wrong.',
  'vnoise.snow': 'Sparse bright specks from dropouts in the signal. Distinct from the tuner snow in Signal & Reception, which is dense grain from a weak aerial — this is an occasional hard hit on an otherwise good signal.',
  'vnoise.snowAnisotropy': 'How far each speck smears along the line. At 0 they are dots; at 1 they are short horizontal streaks, which is what a dropout actually looks like once it has been through the band-limiting.',

  /* ---------------- head switching ---------------- */
  'headswitch.enabled': 'Bypasses head switching and tracking noise. Worth toggling to see how much of the tape impression is coming from the bottom few lines alone — usually more than expected.',
  'headswitch.height': 'How many lines at the bottom of the picture are torn by the drum swapping from one head to the other. Real decks put it in the last handful of lines, mostly below the visible area, so a small number with some overscan is the honest setting.',
  'headswitch.offset': 'How far up from the bottom edge the torn band sits. Raising it lifts the damage into the visible picture, which is what a misaligned deck did.',
  'headswitch.shift': 'How far the torn lines are thrown sideways. Large values give the hard diagonal slash across the bottom of the frame that is instantly recognisable as videotape.',
  'headswitch.midLine': 'The head switch happens part way along a line rather than neatly at its start, so the tear begins in the middle of the picture. This is what really happened, and it looks considerably more convincing than a clean full-width band.',
  'headswitch.midLinePosition': 'Where along the line the switch occurs, from the left edge to the right. Near the right-hand edge is typical.',
  'headswitch.midLineJitter': 'How much that position wanders from line to line, so the left edge of the tear is ragged rather than a straight vertical cut.',
  'headswitch.tracking': 'A band of torn, noisy picture drifting slowly up the screen — the fault you used to correct by holding the tracking button down. The single most evocative control in the tape engine, and the one most worth keyframing so it arrives and passes rather than sitting there.',
  'headswitch.trackingHeight': 'How many lines tall the tracking band is. Tall bands swallow a large part of the picture; short ones read as a brief glitch passing through.',
  'headswitch.trackingWave': 'How much the band bends the picture sideways in addition to adding noise. Without some of this the band looks like an overlay rather than like the signal breaking down.',
  'headswitch.trackingSnow': 'How much extra snow fills the tracking band. High values turn the band into pure static, which is the worst case of a tape that has been paused in the same place too many times.',

  /* ---------------- picture ---------------- */
  'picture.brightness': 'Adds a constant offset to luma, which is what the Brightness knob on a television actually did — it set the black level, not the overall lightness. Positive values grey the blacks the way a mis-set or ageing set does; negative values crush them. Small amounts: ±0.05 is already visible.',
  'picture.contrast': 'Scales luma around mid-grey, which is the drive into the tube. Because the beam blooms with current, pushing this past 1.0 does not simply brighten the picture — highlights swell and smear outward, which is the correct and slightly ugly behaviour of a set turned up too far.',
  'picture.color': 'Chroma gain, applied in the colour-difference space the signal is actually carried in. Consumer sets shipped oversaturated from the factory because showrooms rewarded it, so values slightly above 1.0 are period-correct. At 0 the picture is monochrome.',
  'picture.tint': 'Rotates the colour-difference axes, which is the NTSC hue error that earned the system its nickname. PAL corrected this automatically by alternating phase line by line; NTSC left it as a knob on the front of the set, and nobody ever got it right.',
  'picture.sharpness': 'A peaking filter, not a modern unsharp mask. Above 1.0 it adds overshoot before each edge, producing the bright white fringe that every set with the sharpness turned up had. Below 1.0 it softens. The overshoot is the point — a clean sharpen would be wrong here.',
  'picture.inputGamma': 'What gamma the source file is assumed to be encoded in, so the tube transfer function is applied to the right numbers. 2.2 is correct for essentially all ordinary video and images; change it only if your source is genuinely linear or log.',
  'picture.reconstruct': 'How the source is sampled when the render is larger than the file. Bicubic keeps edges crisp with a touch of overshoot, which on a CRT reads as correct rather than sharpened. Bilinear is softer and more classic. Nearest preserves hard pixel edges and is the right answer for pixel art, where a smooth upscale is simply wrong.',

  /* ---------------- colour ---------------- */
  'colour.enabled': 'Bypasses the whole colour section. With it off the picture goes straight from the phosphor gamut to the tube transfer function, which is what earlier versions of this app did.',
  'colour.temperature': 'Moves the white point along the blue–amber axis, normalised so white changes colour without changing brightness. Negative is the warm D65 that film and broadcast were graded for; positive is the cold blue-white most consumer sets actually ran at, because a bluer white looks brighter in a shop. Around +0.3 is a very strong period cue.',
  'colour.tintGM': 'The second white-balance axis, green against magenta. Ageing sets tend to drift green because the green gun is driven hardest and its phosphor is the most efficient, so a small positive value reads as "old" rather than as "wrong".',
  'colour.redGain': 'Drive for the red gun, equivalent to the service-menu gain control. Affects the bright end far more than the dark end, so this is the control for a set whose whites have gone pink or cyan.',
  'colour.greenGain': 'Drive for the green gun. Pulling this down is an efficient way to make a set look tired, since green carries most of the luminance.',
  'colour.blueGain': 'Drive for the blue gun. Blue phosphor ages fastest in real sets, so values slightly below 1.0 are the realistic direction of travel.',
  'colour.redLift': 'Black level for the red gun, the service-menu cutoff control. Affects the dark end far more than the bright end: this is what gives an old set its coloured blacks rather than neutral ones.',
  'colour.greenLift': 'Black level for the green gun. A touch positive gives the slightly swampy blacks of a set that has not been set up in twenty years.',
  'colour.blueLift': 'Black level for the blue gun. A small positive value is the most common real-world mis-set cutoff, giving blacks that sit slightly blue.',
  'colour.hue': 'Rotates the entire colour wheel after decoding. This is different from Picture ▸ Tint, which models an error in the decoder and could be dialled out on the set — this one cannot, so it is the right control for a deliberate, unnatural colour shift.',
  'colour.saturation': 'Overall chroma gain applied after the tube, so it acts on everything including the phosphor gamut bend. Use this for a final grade; use Picture ▸ Colour when you want the front-panel knob upstream of the whole tube.',
  'colour.vibrance': 'Lifts weak colours while leaving already-saturated ones alone, so skin and sky come up without the reds blowing out. Entirely anachronistic — no television had anything like it — but useful when the source is flat and you want the CRT to look rich rather than muddy.',
  'colour.chromaCrush': 'Collapses nearly-grey pixels to true grey. Tape chroma noise lived in exactly this region, so squashing it is what a noise reducer did, and it cleans up the coloured speckle in shadows. Pushed hard it leaves only strongly coloured objects coloured, which looks like a bad transfer.',
  'colour.colourKiller': 'Real decoders measured the colour burst and, below a threshold, muted chroma entirely rather than display confetti. Turn this up and weak or damaged areas fall to monochrome. It is a much more convincing way to degrade colour than desaturating, because it is what the hardware genuinely did.',
  'colour.chromaClip': 'The point where oversaturated colour stops getting more saturated; the excess bleeds into luma instead. Low values give the blazing, smearing red of overdriven composite — the classic unwatchable red titles. High values effectively disable it.',

  /* ---------------- signal ---------------- */
  'signal.enabled': 'Bypasses the entire signal chain, feeding the tube a clean picture. Useful for isolating what the tube itself is doing.',
  'signal.path': 'The single most consequential control in this section. RF is a modulated carrier and gets everything: snow, ghosting, interference, heavy chroma damage. Composite shares one wire between luma and chroma, so it gets dot crawl and rainbows. S-Video separates them and loses both. Component is clean and only the tube degrades the picture.',
  'signal.lumaBandwidth': 'How much horizontal detail the brightness channel can carry, in MHz. Broadcast NTSC allowed 4.2 MHz, VHS managed barely 3, and a worn tape less. This is the main horizontal softness control and it is far more faithful than a blur, because it only softens horizontally — vertical detail is carried by the scan lines and is untouched.',
  'signal.chromaBandwidth': 'The same for colour, and the number is brutally lower — a small fraction of the luma bandwidth. This asymmetry is the most recognisable signature of analogue video: edges stay reasonably sharp while colour smears across them, which is why red objects bleed.',
  'signal.chromaDelay': 'Colour is filtered harder than brightness, which delays it, so it arrives late and sits to one side of the object it belongs to. Around 1 px is typical of a decent feed; larger values give the misregistered colour of a bad one.',
  'signal.dotCrawl': 'Chroma misread as luma. Because the colour subcarrier is locked to the line rate and inverts every frame, the resulting dot pattern visibly creeps up sharp colour edges. Only present on RF and composite, because it requires luma and chroma to share a wire.',
  'signal.crossColor': 'The opposite error: fine luma detail misread as colour. Striped shirts, brickwork and herringbone jackets shimmer with rainbows that are not in the source at all. Like dot crawl, it only exists on a shared-wire path.',
  'signal.ringing': 'Overshoot from the band-limiting filters, appearing as a bright fringe trailing each hard vertical edge. Distinct from Sharpness in that it is a fault of the transmission path rather than a deliberate enhancement, though they look similar and stack.',
  'signal.ringingFreq': 'How tightly the overshoot oscillates — effectively how many ripples follow an edge before it settles. Higher values give a finer, busier fringe.',
  'signal.ghosting': 'Multipath: the signal arrives twice, once direct and once reflected off a building or a hill, so a faint displaced copy of the picture sits over the original. A defining artefact of rooftop-aerial reception.',
  'signal.ghostDelay': 'How far the reflected copy is displaced, in pixels. Positive puts the ghost to the right, which is the usual case since the reflection travels further. Large values give the long, soft second image of a distant reflector.',
  'signal.snow': 'Thermal noise in the tuner front end, visible as coarse fast-moving grain. RF is grainier and carries a colour component; a composite feed from a VCR is finer and closer to monochrome, and the model follows that.',
  'signal.snowSize': 'How large each grain of snow is in source pixels. Larger values give the chunky noise of a badly tuned analogue channel rather than fine digital grain.',
  'signal.signalLoss': 'A master fade from the picture to complete static. The last thing to disappear is a faint torn residue of the image, which is what loss of lock actually looked like. With A/V Link on this drags the audio down with it, so one control takes the whole transmission away.',
  'signal.interference': 'A carrier from an adjacent channel beating against this one, producing diagonal herringbone bars that drift across the picture. Strongly associated with crowded analogue bands and cheap tuners.',
  'signal.interferenceFreq': 'The pitch of the herringbone — how many bars across the screen. Low values give wide rolling bands, high values a fine diagonal weave.',
  'signal.interferenceDrift': 'How fast the bars crawl. Interfering carriers were never exactly locked to the channel, so some drift is correct; zero looks artificially static.',

  /* ---------------- sync ---------------- */
  'sync.enabled': 'Bypasses all timebase errors, giving a perfectly stable raster. Switch it off to tell whether an artefact you are chasing is sync or signal.',
  'sync.hJitter': 'Each line starts a little early or late, so the left edge of the picture becomes ragged and vertical lines develop a shimmer. The amount is in pixels of error; 1–2 px is a working tape, 6 px and above stops reading as a tape and starts reading as an effect.',
  'sync.jitterCorrelation': 'Whether neighbouring lines make the same error. At 0 each line is independent, which reads as noise and gives a fizzing edge. At 1 adjacent lines agree, which reads as a slow wobble of the whole picture. Real machines sit in between, around 0.5.',
  'sync.tearing': 'Rare, violent sideways displacement of a single line. Unlike jitter this is an outright failure rather than imprecision, so keep it low — a handful of torn lines per second is far more effective than a constant mess.',
  'sync.flagging': 'The top few lines of the frame bend to one side because the timebase has not settled after the vertical interval. Named for the way the top of the picture waves like a flag. Characteristic of tape, and almost never seen on broadcast.',
  'sync.headSwitch': 'The torn, noisy band along the very bottom of the picture where the rotating drum swaps from one head to the other. Present on every helical-scan tape playback that has ever existed, which makes it the single most VHS-specific control in the app.',
  'sync.headSwitchHeight': 'How tall the head-switch band is, as a fraction of the picture height. Real machines put it in the last few per cent; larger values exaggerate it into a deliberate effect.',
  'sync.vRoll': 'Vertical hold has lost lock and the picture scrolls continuously, in frames per second. Negative scrolls the other way. Set it to a small non-integer value for a picture that will not quite settle.',
  'sync.vHold': 'Rather than a constant scroll, random bursts where lock is lost and regained. More unsettling than steady rolling because it is unpredictable, and much closer to how a failing set actually behaved.',
  'sync.timebaseWobble': 'Slow breathing of the overall picture width as the tape speed varies. Subtle on its own and very effective in combination — it is the thing that makes a still frame read as "this is a tape" even with nothing else enabled.',

  /* ---------------- geometry ---------------- */
  'geometry.enabled': 'Bypasses curvature, overscan and all geometric error, giving a flat rectangular raster.',
  'geometry.curvatureX': 'How much the faceplate bulges towards the viewer horizontally, bowing straight vertical lines outward. Later sets were flatter; a 1980s tube had a lot of this.',
  'geometry.curvatureY': 'The same vertically. Slightly more than the horizontal is typical, because tubes were usually wider than they were tall and curved more over the short axis.',
  'geometry.cornerRadius': 'How rounded the visible corners of the tube are. The picture is cut off by the glass, not by the bezel, so this rounds the image itself.',
  'geometry.overscan': 'Sets deliberately scanned the raster larger than the visible glass so that no edge of the transmission could ever show, which is why 4–8% of every broadcast frame was never seen by anyone. Honest and worth leaving on; it also hides whatever is wrong at the edges of your source.',
  'geometry.hSize': 'Width of the scanned area. Below 1.0 leaves an unscanned margin at the sides; above 1.0 pushes more of the picture past the glass.',
  'geometry.vSize': 'Height of the scanned area. A set with the vertical size slightly wrong — squashed or stretched — is extremely common and rarely noticed until you look for it.',
  'geometry.hPos': 'Horizontal centring of the raster. Real sets drifted off centre as components aged.',
  'geometry.vPos': 'Vertical centring. Combined with a little H position, a slightly off-centre raster is one of the cheapest ways to make the set feel physical.',
  'geometry.pincushion': 'The sides bow inward or outward at their midpoints while the corners stay put. Positive is barrel, negative is pincushion. Cheap sets had visible amounts and no control to correct it.',
  'geometry.trapezoid': 'One end of the raster is wider than the other, so the picture is a trapezium rather than a rectangle. Caused by an asymmetric deflection yoke.',
  'geometry.rotation': 'The yoke was glued to the neck of the tube by hand, so it was never quite straight. A fraction of a degree is more convincing than zero, because a perfectly level picture is the one thing no real set had.',
  'geometry.aspect': 'The shape of the tube, and therefore the shape of the exported file. 4:3 for anything before the late nineties. The frame is always the shape of the tube, so choosing 4:3 on a 16:9 source produces a genuinely 4:3 file rather than a widescreen one with bars drawn into it.',

  /* ---------------- beam ---------------- */
  'beam.enabled': 'Bypasses beam reconstruction, so the picture is sampled flat with no line structure at all.',
  'beam.scanMode': '240p draws every field at the same place, giving the fat, obvious scanlines of a games console or a camcorder. 480i alternates fields, giving finer lines and a 30 Hz shimmer. "No line structure" turns the raster off entirely while keeping the rest of the tube.',
  'beam.lineCount': 'How many active lines the raster has. Match it to the material: 240 for a console or home camcorder, 480 for broadcast interlaced. Setting it far above your output resolution will produce moiré rather than detail.',
  'beam.scanlineDepth': 'How dark the unscanned gap between lines is. At 0 the lines vanish and the picture is flat; at 1 the gaps go fully black. The exposure lost to the gaps is automatically given back, so this changes the texture of the picture without changing how bright it is.',
  'beam.beamWidth': 'The vertical thickness of the electron spot, measured in scanline units. Narrow beams leave obvious black gaps; wide beams fill them in and the line structure softens into a continuous image.',
  'beam.beamBloom': 'How much fatter a bright line is than a dim one. This is the detail that separates a real CRT from a scanline overlay laid over a video: on a tube, brightness and thickness are the same physical quantity, so highlights swell into their neighbours. If you change one control in this section, change this one.',
  'beam.beamShape': 'The profile of the spot. 2.0 is a true Gaussian, which is what an electron beam actually produces. Higher values square the profile off for a harder, more modern-looking line; lower values make it softer and more diffuse.',
  'beam.brightBoost': 'Plain gain on the reconstructed beam. The light the scanlines throw away is already compensated automatically, so 1.0 is correct exposure — this is a contrast control for taste, not a correction for something the model got wrong.',
  'beam.interlaceFlicker': 'Only meaningful in 480i. Alternating fields are never quite equally bright, which produces the 30 Hz shimmer that made interlaced displays tiring to look at.',
  'beam.fieldBlend': 'How much the two interlaced fields are blended together. Zero gives hard field separation and maximum shimmer; higher values smooth it toward a progressive look, which is what a later set with a line doubler did.',

  /* ---------------- phosphor ---------------- */
  'phosphor.enabled': 'Bypasses the mask and the phosphor gamut, leaving the beam structure but no RGB triad texture.',
  'phosphor.maskType': 'Aperture grille is continuous vertical stripes with no vertical structure — Trinitron, Diamondtron, most arcade monitors. Slot mask breaks those stripes into staggered slots and is what the overwhelming majority of consumer televisions used. Shadow mask is delta-gun dot triads on a hexagonal lattice, the softest and oldest of the three.',
  'phosphor.maskPitch': 'How many screen pixels one RGB triad occupies. This is the control to watch when you change output resolution: below about 3 pixels per triad the mask can no longer be resolved and turns into moiré instead of texture. Raise it when you render larger.',
  'phosphor.maskStrength': 'How much of the mask is applied, from invisible to fully modulated. The light the mask blocks is compensated automatically, so raising this changes the texture rather than darkening the picture.',
  'phosphor.maskBoost': 'Extra gain on the masked picture. The mask blocks roughly two thirds of the light and that is already corrected for, so 1.0 is correct — push it only if you want the mask to read as brighter than the tube really was.',
  'phosphor.slotStagger': 'How far alternate columns of slots are offset vertically. Only affects the slot mask. At 0.5 the columns interlock in the classic brickwork pattern.',
  'phosphor.persistence': 'How long the phosphor keeps emitting after the beam has passed, which smears motion into trails. The control maps to a half-life rather than a per-frame factor, so the trail is the same length whatever frame rate you render at. Long values give the ghosting of a security monitor.',
  'phosphor.persistenceTilt': 'The three phosphors do not decay together — P22 green outlasts red and blue by a wide margin, which is why motion trails on a consumer television skew green. Positive biases the trail green, negative biases it blue.',
  'phosphor.gamut': 'Bends the primaries from sRGB toward real P22 phosphor, whose green is yellowish and impure, whose red sits closer to orange and whose blue skews violet. Subtle but it is a large part of why CRT footage never quite matches a modern screen.',

  /* ---------------- glow ---------------- */
  'glow.enabled': 'Bypasses bloom, halation, diffusion, vignette and glare — everything that happens to light after it leaves the phosphor.',
  'glow.threshold': 'The signal level at which the glass starts to scatter visibly. This is the control people set wrong: put it low and a flat mid-grey field glows, which no tube has ever done. Keep it high enough that only genuine highlights bloom.',
  'glow.bloom': 'The tight glow immediately around bright areas, from scattering close to the phosphor. Stronger and narrower than halation.',
  'glow.bloomRadius': 'How far the tight glow spreads. Keep it small — a few pixels — or it stops being bloom and becomes a soft-focus filter.',
  'glow.halation': 'The wide, weak haze around bright objects caused by light bouncing between the front and back surfaces of the thick glass faceplate. Should be much wider and much weaker than bloom.',
  'glow.halationRadius': 'How far the haze spreads. Large values are correct here; halation on a real tube extends a long way from the source.',
  'glow.halationTint': 'Red scatters furthest through glass, so the haze around a white highlight is warm rather than neutral. At 1 the halation is strongly orange, which is what a bright object on a real tube looks like.',
  'glow.diffusion': 'A flat veil over the whole screen rather than a glow around bright things. Old glass is not clear glass, and a layer of this lifts the blacks uniformly in a way that reads as age.',
  'glow.vignette': 'Corners are further from the gun than the centre and receive less beam energy, so they are genuinely dimmer. Unlike a photographic vignette this is a property of the display rather than a lens.',
  'glow.glare': 'A window or a lamp somewhere behind the viewer, reflected in the glass. Lifts the blacks unevenly across the screen, which immediately puts the set in a physical room.',

  /* ---------------- convergence ---------------- */
  'convergence.enabled': 'Bypasses gun misregistration and defocus, giving three perfectly aligned, perfectly sharp guns.',
  'convergence.redX': 'Horizontal misalignment of the red gun, in pixels. Sub-pixel values are plenty — half a pixel already reads as a real set.',
  'convergence.redY': 'Vertical misalignment of the red gun. Vertical convergence error is less common than horizontal on real sets, so keep it smaller.',
  'convergence.blueX': 'Horizontal misalignment of the blue gun. Offsetting red and blue in opposite directions gives the classic coloured fringing on either side of a white edge.',
  'convergence.blueY': 'Vertical misalignment of the blue gun. Offsetting this against the red gun\u2019s vertical error gives the horizontal colour banding you see on the edges of white text, which is a different and subtler artefact than the usual side fringing.',
  'convergence.radial': 'How much the misconvergence grows towards the corners. This is what sells the effect: uniform fringing everywhere looks like a filter, while fringing that is clean in the centre and worsens at the edges looks like a tube that was aligned by a technician in the middle of the screen.',
  'convergence.focus': 'Spot size at the centre of the screen. A little defocus everywhere is realistic; a lot makes the set look broken.',
  'convergence.edgeFocus': 'How much larger the spot grows towards the corners. The beam travels further to reach a corner and strikes the glass at an angle, so it lands as a bigger, softer blob — real, and the reason the edges of a CRT picture were always softer than the middle.',

  /* ---------------- tube ---------------- */
  'tube.enabled': 'Bypasses the transfer function, the hum bar and all the power-supply behaviour.',
  'tube.gamma': 'The relationship between grid voltage and beam current, and therefore between signal and light. Around 2.4 is the number the entire video standard was built around, so staying near it keeps the picture looking correct. Higher values deepen the shadows and raise contrast.',
  'tube.blackCrush': 'Below cut-off the gun stops conducting entirely, so shadow detail does not merely get dark — it disappears. This is a hard floor rather than a gentle roll-off, which is why detail in the blacks of CRT footage is simply gone rather than recoverable.',
  'tube.whiteClip': 'Where highlights slam into the limit. Past this point they stop getting brighter and only get fatter, because the widening already happened in the beam stage. Lower values clip earlier and bloom more.',
  'tube.humBar': 'Mains ripple riding on the video rail, visible as a soft bright band drifting slowly up the screen. One of the most useful controls in the app, and much more so when linked to the audio hum under A/V Link so the band and the buzz are audibly the same fault.',
  'tube.humBarSpeed': 'How fast the bar drifts, which is the beat between the mains frequency and the frame rate. These were never exactly locked, so a small non-zero value is correct. At exactly 0 the bar is suspiciously static.',
  'tube.humBarWidth': 'How tall and soft the bar is. Narrow values give a defined band; wide ones give a gentle breathing of the whole picture brightness.',
  'tube.agcPump': 'Automatic gain control chasing the average picture level and always arriving a beat late, so a cut to a bright scene briefly overshoots before settling. Subtle, and one of those things that is only noticed when it is missing.',
  'tube.psuSag': 'A bright picture draws more beam current and pulls the high-tension rail down, so large white areas dim and swell rather than staying put. With A/V Link on, loud audio loads the same rail and does the same thing.',
  'tube.flicker': 'Small random variation in overall brightness, from an unstable supply or a tired tube. Keep it low; a little is life, a lot is a strobe.',

  /* ---------------- faults ---------------- */
  'faults.enabled': 'Bypasses burn-in, dust, moir\u00e9 and the degauss ripple \u2014 everything that models age rather than design. Switch it off to see what the same set would have looked like in the shop, which is a useful comparison when a look has drifted too far into decay.',
  'faults.burnIn': 'Phosphor permanently dimmed where a static image sat for years — a station logo, a menu, a paused frame. The map builds up over the length of the clip rather than being painted on, so it needs a reasonably long render to become visible.',
  'faults.burnInRate': 'How fast the burn-in map accumulates. Higher values let burn-in appear within a short clip, which is not physically honest but is often what you want when the shot is only a few seconds long.',
  'faults.dirt': 'Static charge on the faceplate pulls dust onto the glass, worst at the edges where nobody\'s sleeve ever reached. A mixture of broad smears and fine specks. Subtle and worth leaving on.',
  'faults.moire': 'Interference between the mask pitch and fine detail in the picture, appearing as a shimmering pattern on textured areas. Real, and the reason striped clothing looked awful on a television.',
  'faults.degauss': 'How violent the ripple fired by the Degauss button is. The coil briefly magnetises the mask so the guns land on the wrong phosphor dots, producing a wave of colour distortion that decays over about a second. Fire it on a cut.',
  'faults.powerState': 'On is a normal running set. Warming is the raster opening up and the picture fading in from a cold start. Collapsing is switch-off: the raster falls to a horizontal line and then to a single fading dot in the centre of the screen.',
  'faults.warmup': 'How long the warm-up or collapse takes, in seconds. Around two seconds is realistic for a valve-era set; shorter is a later solid-state one.',

  /* ---------------- glitch ---------------- */
  'glitch.enabled': 'The whole glitch section. It ships off, because glitching is an effect you choose rather than a property of a tube — switching it on gives you tuned starting values immediately.',
  'glitch.rate': 'How often anything in this section fires. At 0 the section is completely silent however high the individual amounts are, which makes this the control to keyframe: ramp it up for a few frames and the picture falls apart, then back down and it recovers.',
  'glitch.dropout': 'The head loses contact with the oxide and a run of the line reads as full white or full black. The single most recognisable VHS failure. Decided per line, so the streaks are ragged rather than rectangular.',
  'glitch.dropoutLength': 'How far across the line a dropout runs, as a fraction of the width. Short values give flecks, long values give streaks that cross most of the picture.',
  'glitch.lineRepeat': 'The timebase corrector loses lines and holds the last good one, so a band of the picture is smeared downward in steps. Reads as a machine struggling rather than a tape being damaged.',
  'glitch.syncSlip': 'Horizontal sync is briefly lost and a band of the picture tears sideways. The most violent of the analogue failures here, and extremely effective on a cut.',
  'glitch.chromaBurst': 'Colour detaches from brightness and slides off sideways in a band, so objects are briefly outlined in the wrong place by their own colour. A failure of the chroma delay line.',
  'glitch.blockCorrupt': 'Deliberately digital rather than analogue: macroblocks fetch from the wrong address, so rectangles of the picture come from somewhere else. Use it for the moment a digital transfer of a tape fails, which is a different and more modern kind of wrong.',
  'glitch.blockSize': 'How large the corrupted blocks are, in pixels. 8 or 16 matches real codec macroblocks; larger values are more obviously stylised.',
  'glitch.blockColour': 'Corrupted blocks also take the wrong chroma, not just the wrong pixels. This is what makes digital breakup read as digital — without it the corruption looks like a smear rather than a decode failure.',
  'glitch.posterize': 'Collapses luma to a handful of levels inside a band, turning smooth gradients into hard steps. Banding used as a rhythmic event rather than as a constant.',
  'glitch.invert': 'Bands of inverted video. A single frame of it is deeply unpleasant, which is precisely the point — keyframe it to a single frame on a cut rather than leaving it running.',

  /* ---------------- output ---------------- */
  'output.bezel': 'How strongly the plastic surround and the dark edge of the glass are drawn around the picture. At 0 the tube fills the frame with no surround at all.',
  'output.bezelShadow': 'How much the glass darkens as it curves away into the bezel. Gives the picture a sense of depth at the edges rather than stopping abruptly.',
  'output.roomLight': 'A constant lift across the whole screen, because a television in a lit room is never truly black. A very small amount does a lot: it stops the image floating in a void and puts it in a space.',
  'output.dither': 'Adds a tiny amount of ordered noise to break up banding in the dark parts of the gradient, where 8-bit output cannot represent the roll-off smoothly. Costs nothing and fixes a real artefact — leave it on.',
  'output.exposure': 'Final gain on the rendered frame, after everything else. Use it to match the output to surrounding footage rather than to correct the model.',

  /* ---------------- audio ---------------- */
  'audio.enabled': 'Processes the source audio through the whole chain. With it off the original audio passes through untouched, which is the quickest way to hear how much the chain is doing.',
  'audio.inputGain': 'Level into the chain, before any processing. Because compression and saturation downstream are level-dependent, this changes the character and not just the volume — drive it harder for a more processed sound.',
  'audio.channelMode': 'Stereo leaves the source alone. Mono sums both channels, which is how essentially every set before the mid-eighties played back. Left or Right takes one channel only. Difference (L−R) is the stereo subcarrier on its own, and it is the uncanny one.',
  'audio.monoAmount': 'How far towards mono the signal is collapsed, so you do not have to choose between full stereo and full mono. Around 0.7 kills the modern stereo image while keeping a hint of width, which usually sits better than a hard collapse.',
  'audio.width': 'How wide whatever stereo survives the collapse is allowed to be. Above 1 it is exaggerated, which no television could do but which is occasionally useful.',
  'audio.region': 'Sets the mains frequency and the line-scan rate together, because they are properties of the same place: 60 Hz and 15.734 kHz for NTSC, 50 Hz and 15.625 kHz for PAL. Getting this right matters — the hum and the flyback whine are the two most identifiable sounds here.',

  /* ---------------- transport ---------------- */
  'transport.enabled': 'Bypasses all tape transport modulation, so pitch is perfectly stable.',
  'transport.wowRate': 'How many times per second the slow pitch error repeats, which on a real machine is once per revolution of an eccentric capstan or a warped reel. Low single figures.',
  'transport.wowDepth': 'How far the pitch drifts. Sustained notes sag and recover, which is the sound everybody recognises as tape. Small amounts are effective; past a point it becomes seasick.',
  'transport.flutterRate': 'The faster wobble, from the idler wheels and tape guides rather than the capstan. Tens of hertz.',
  'transport.flutterDepth': 'How deep the fast wobble is. Adds a shimmer or warble on top of the slow sag of wow, and is more audible on bright, sustained sounds.',
  'transport.drift': 'A slow random walk on top of the periodic errors. This is the control that stops the wobble sounding like an LFO, which is the usual giveaway of a cheap tape emulation — without it the ear locks onto the period and the illusion collapses.',
  'transport.scrape': 'Very fast stick-slip as the tape judders against the heads. Not a pitch effect so much as a grainy roughness in the texture of the sound.',
  'transport.dropoutRate': 'How often the level falls out, from bad patches of oxide on the tape. Even a low rate is worth having — a momentary hole in the audio does more for "this is a tape" than any amount of hiss.',
  'transport.dropoutDepth': 'How far the level falls during a dropout. Partial dropouts are more common and more believable than total silence.',
  'transport.dropoutLength': 'How long each dropout lasts. Short ones click; long ones swallow a word.',

  /* ---------------- speaker ---------------- */
  'speaker.enabled': 'Bypasses the speaker and cabinet model entirely, leaving the signal full-range.',
  'speaker.lowCut': 'Where the bottom end stops. A small cone in an unsealed plastic box simply cannot move enough air below this, so the figure is much higher than it feels like it should be.',
  'speaker.lowCutSlope': 'How steeply the low end rolls off. Steeper slopes sound more like a sealed box, gentler ones more like an open-backed cabinet leaking bass out of the rear.',
  'speaker.highCut': 'Where the top end stops, from the paper cone and the audio IF bandwidth together. Broadcast television sound rarely managed much above 10 kHz even at its best.',
  'speaker.highCutSlope': 'How steeply the top rolls off. Steep values give the abruptly closed-in sound of a cheap set.',
  'speaker.resonanceFreq': 'The frequency of the cabinet honk. This single peak does more for the illusion than either filter — find it by ear with the gain up, then back the gain off.',
  'speaker.resonanceGain': 'How pronounced the cabinet resonance is. Even a few decibels is plenty; this is a peak the ear is very good at spotting.',
  'speaker.resonanceQ': 'How narrow the resonance is. High Q gives a specific ringing note, low Q a broad coloration. High Q sounds more like a small hard plastic box.',
  'speaker.honkFreq': 'A second, more nasal peak higher up, where the cone itself starts to break up rather than the box resonating. Usually a few times the box resonance.',
  'speaker.honkGain': 'How strong the cone breakup peak is. Adds the boxy, nasal quality of a speaker being asked to do more than it can.',
  'speaker.notchFreq': 'Sound leaving the back of the cone travels round and meets the front out of phase, cancelling at a specific frequency. A real and rarely modelled property of an unsealed box.',
  'speaker.notchDepth': 'How complete the cancellation is. Deep notches are characteristic of a cone with no proper enclosure behind it at all.',
  'speaker.cabinet': 'Convolves with a synthesised small-box impulse response, which gives real modal ringing — the box responding over time — rather than the static frequency shaping the filters above provide. Costs more to compute and sounds considerably more physical.',
  'speaker.cabinetSize': 'The size of the box being synthesised. 0 is a five-inch portable on a kitchen counter, 1 is a wooden console the size of a sideboard, and the modal pattern changes accordingly.',
  'speaker.breakup': 'Level-dependent buzz: loud passages tear and distort while quiet ones stay clean. This dynamic behaviour is what distinguishes a small speaker being overdriven from simple distortion.',
  'speaker.offAxis': 'The speaker is not pointing at you, because on a television it never was — it fired downward, or sideways, or into the back of the cabinet. Rolls off the top end in the particular way that being off-axis does.',
  'speaker.throughWall': 'A one-control macro: heavy low-pass plus a room tail, for a set playing in another room. One of the most atmospheric settings in the app and almost impossible to dial in by hand as quickly.',
  'speaker.roomTail': 'Short early reflections off the walls of a small hard room. Not reverb so much as the sound of the set being somewhere rather than nowhere.',

  /* ---------------- dynamics ---------------- */
  'dynamics.enabled': 'Bypasses broadcast compression, saturation and limiting. Worth toggling while you work: this section changes loudness as well as character, so it is easy to mistake \u201clouder\u201d for \u201cbetter\u201d until you hear it against the unprocessed signal.',
  'dynamics.amount': 'How much of the compressed signal is mixed in. Lets you dial the whole processing chain in and out without rebuilding the settings below.',
  'dynamics.threshold': 'The level above which compression starts. Lower thresholds compress more of the programme, which is what broadcast did — the aim was loudness, not transparency.',
  'dynamics.ratio': 'How hard the signal is held down above the threshold. High ratios approach limiting and flatten the dynamics entirely.',
  'dynamics.attack': 'How quickly the compressor reacts. Fast attack catches transients and dulls percussive sounds; slow attack lets them through and then clamps down, which is more audible and more characterful.',
  'dynamics.release': 'How quickly it lets go. Short releases pump audibly as the background noise swells up between words, and pumping is the sound of broadcast — it is a feature here, not a fault to avoid.',
  'dynamics.saturation': 'How hard the signal is driven into the non-linearity of the chosen model. A little adds density and harmonics; a lot is overt distortion.',
  'dynamics.saturationModel': 'Tape is soft and symmetric and dominated by the third harmonic. Transformer is hysteresis-flavoured, depends on frequency and adds a second harmonic. Output stage hard-clips asymmetrically, which is what a cheap television amplifier does when you turn it up.',
  'dynamics.ceiling': 'The hard limit nothing is allowed to exceed, after everything else. Lower it to keep headroom for the noise bed, which is added after this stage.',

  /* ---------------- noise ---------------- */
  'noise.enabled': 'Bypasses the entire noise bed — hum, whine, hiss, static and rumble. The quickest way to hear how much of the atmosphere is coming from noise rather than from the programme.',
  'noise.humLevel': 'Level of the mains hum. Worth having even when it is barely audible, because it is the floor everything else sits on.',
  'noise.humMode': 'Ground loop gives odd harmonics of the mains fundamental and buzzes. Transformer gives energy at twice the line frequency with even harmonics and hums. They are genuinely different sounds and worth choosing between deliberately.',
  'noise.humHarmonics': 'How many harmonics are generated. A few gives a smooth hum; many turns it into an angry buzz, which is the sound of a bad earth rather than a quiet one.',
  'noise.humTilt': 'How slowly the harmonics roll off in level. High values keep the upper harmonics strong and the hum buzzes; low values roll them away for a rounder, deeper hum.',
  'noise.humDrift': 'Mains frequency is never exactly nominal, so the hum breathes slightly in pitch. Without this the hum is a dead static tone and the ear notices.',
  'noise.flybackLevel': 'Level of the line-output transformer singing at the horizontal scan rate — 15.734 kHz on NTSC, 15.625 kHz on PAL. The single most identifiable sound a CRT makes, and the one that instantly tells a listener a tube is switched on in the room.',
  'noise.flybackDrift': 'Slight wander in the whine\'s pitch as the set warms and the supply varies. Keeps it from sounding like a test tone.',
  'noise.flybackSqueal': 'Adds the second and third partials to the whine. The difference between a clean set and a sick one: a pure tone is a healthy flyback, a complex squeal is a failing one.',
  'noise.flybackAudible': 'Drops the whine an octave to around 7.9 kHz. The real frequency is above what many people can hear, what many speakers reproduce, and what lossy codecs preserve — so if your audience is on laptop speakers or the result is going through compression, switch this on or the most characteristic sound in the mix will simply not arrive.',
  'noise.hissLevel': 'Level of tape hiss. The broadband background of any magnetic medium.',
  'noise.hissTone': 'How bright the hiss is. Brighter hiss reads as a cheaper or more worn tape; darker hiss sits further back.',
  'noise.hissBreathing': 'Noise reduction mis-tracking: the hiss swells back up whenever the programme goes quiet, then ducks again when it returns. The characteristic failure of consumer noise reduction, and much more evocative than steady hiss.',
  'noise.staticLevel': 'Broadband RF roar. Rides the video Signal loss parameter when A/V Link is on, so taking the picture to snow takes the sound to static at the same moment.',
  'noise.rumble': 'Motor and mains transformer vibration coupling into the cabinet below 120 Hz. Felt more than heard, and it gives the set physical mass.',

  /* ---------------- crackle ---------------- */
  'crackle.enabled': 'Bypasses contact crackle and arcing bursts. These are the only events in the audio chain that are genuinely sporadic rather than continuous, so switching the section off is the quickest way to tell whether a noise you are chasing is the bed or a click.',
  'crackle.rate': 'Events per second, Poisson-distributed so the spacing is genuinely random rather than metronomic. Low rates are more effective than high ones — anticipation does the work.',
  'crackle.level': 'Overall level of the clicks. Because the amplitude distribution is heavily skewed, raising this mostly makes the rare large pops larger rather than making everything louder.',
  'crackle.tone': 'The centre of the band each click is filtered into. Low is a dull thud from a loose power connection, high is a sharp tick from a dirty signal contact.',
  'crackle.spread': 'How much the tone of each individual click is randomised around that centre. Some spread is essential; identical clicks sound synthetic immediately.',
  'crackle.impulsiveness': 'Skews the amplitude distribution. High values mean most clicks are nearly inaudible and occasionally one is enormous, which is far more unsettling than a steady crackle because you cannot brace for it.',
  'crackle.decay': 'How quickly each click dies away. Short is a tick, longer is a small thump with a ring to it.',
  'crackle.burstRate': 'How often clusters of crackle occur, as opposed to isolated clicks. A corroded connector or a dry joint arcing rather than a single bad contact.',
  'crackle.burstDensity': 'How many clicks are packed into each burst. Dense bursts sound like frying; sparse ones like something intermittently failing.',
  'crackle.burstLength': 'How long each burst lasts. Short bursts punctuate; long ones become a texture in their own right.',

  /* ---------------- link ---------------- */
  'link.enabled': 'The whole cross-modulation section. Leave it on — this is what makes the picture and the sound belong to the same object rather than being two effects running side by side.',
  'link.humBarToHum': 'Locks the bright band drifting up the screen to the hum in the speaker, because on a real set they are the same mains ripple arriving by two routes. Instantly convincing, and the single highest-value control in this section.',
  'link.lossToStatic': 'When the picture goes to snow the sound goes with it. One Signal loss control then takes the entire transmission away rather than just the image.',
  'link.audioToBrightness': 'Loud audio draws current from the same supply as the high-tension rail, so the picture dims and swells with the soundtrack. Real, and almost never emulated — it is the effect that makes people ask how the picture is reacting to the sound.',
  'link.audioToBloom': 'The same sag widens the electron spot, so loud passages bloom as well as dim. Use it with the control above rather than instead of it.',
  'link.glitchToDropout': 'Head-switch tears, dropouts and sync failures happen on the same physically damaged patch of tape, so a tear in the picture should come with a hole in the sound. Without this the two tracks fail independently and the illusion breaks.',
  'link.degaussToThump': 'The degauss coil dumps a large current surge through the chassis, which you hear as much as you see. Fires a low thump whenever the Degauss button is pressed.',
  'link.powerToAudio': 'Ties the audio stage to the power state: a switch-on thump and a slow fade-up as the amplifier comes alive, and the corresponding collapse on switch-off.',
};
