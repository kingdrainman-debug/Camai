/**
 * Explanatory text for the interface.
 *
 * This lives apart from the schema on purpose. `params.ts` is a machine-read
 * description of ~200 controls — ranges, defaults, types — and burying several
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
    what: 'A master switch for each of the three engines. Stock is the emulsion — its curve, grain, halation, dyes, the print and its fading. Lens is everything before the light reaches the film. Gate is the machinery: camera and projector transport, dirt, scratches, splices, leaks, decay and the telecine.',
    how: 'Use them to find out where something is coming from. If a colour cast survives switching the Stock engine off it is the light or the lens; if a wobble survives switching the Gate off it is not the gate. They are also the quickest route to useful half-looks: a perfect stock in a terrible camera, or a ruined stock in a perfect one.',
  },
  format: {
    what: 'The gauge and the emulsion. The gauge is millimetres of film — the size of the frame, the pitch between frames, where the perforations are — and almost everything else is derived from it: grain is enlarged more from a small frame, halation is a fixed distance on the film, registration error is measured in micrometres of strip.',
    how: 'Choose these two first and judge everything else afterwards. The same stock on Super 8 and on 35 mm is two different pictures, and that difference is not something you should have to dial in twice — so it is not exposed twice. Camera speed sets how often the picture changes; Super 8 at 18 fps is half the reason Super 8 looks like itself.',
  },
  curve: {
    what: 'The characteristic curve: the density the film develops to against the logarithm of the exposure it received. A toe where the shadows compress, a long straight line, and a shoulder where highlights roll off. This curve — not grain — is why film looks like film: a highlight that would clip hard on a sensor bends over gently instead.',
    how: 'Every stock has its own curve, and these controls are offsets from it, so changing stock still matters. Reversal stocks clip highlights early and hard because their curve has to span their whole density range; negatives hold eight stops above grey. Push/pull is the lab control: rating the film faster and developing longer, with all the consequences at once.',
  },
  grain: {
    what: 'Silver crystals and dye clouds, in three emulsion layers with independent grain, clumped rather than white, and fixed to the film. Its amplitude follows Selwyn’s law from the stock’s published RMS granularity, so it scales with the format: a smaller frame is enlarged more, and the same emulsion is several times grainier on Super 8 than on 35 mm.',
    how: 'Leave Amount at 1 to get what the data sheet says, and change the stock or the gauge rather than the slider when you want a different grain — that is how real grain changes. Grain power follows density, so it sits in the shadows of a negative and the midtones of the print. It is on the film: the projector’s weave carries it, the camera’s does not.',
  },
  halation: {
    what: 'Light passes through the emulsion, reflects off the back of the film base, and re-exposes the emulsion from behind in a ring round anything bright. The red-sensitive layer is nearest the base, so the halo is red-orange. The radius is set by the thickness of the base, which makes it a much larger fraction of a small frame.',
    how: 'Most stocks have an anti-halation backing and halate only a little; the effect is strongest round practical lights and specular highlights in the dark. Backing removed is the dramatic version. Green reach decides between a red halo and an orange one. Because halation is exposure, it goes through the curve: on reversal it is crisp, on a negative it is soft.',
  },
  dye: {
    what: 'The dyes the three layers form, and their effect on one another. Interimage effects — each layer’s development restraining its neighbours’ — push colours apart and give film its separation. Unwanted absorptions in imperfect dyes pull them back together and make colours muddy.',
    how: 'These are subtle and best left near 1. Interimage at 0 is a film whose layers ignore each other: correct but flat. Raise impurity to imitate older, cheaper dye sets; lower it for the purity of dye transfer. The dyes’ ageing is a separate section, Dye Fading.',
  },
  print: {
    what: 'What happened to a negative: it was printed. The print stock has its own, much steeper curve, and the combination of negative and print — not either alone — produces the look. Printer lights are set as a real laboratory sets them: by printing a grey card on the negative to the print’s aim density, then offsetting in printer points.',
    how: 'Process decides the route. A contact print has the print’s soft highlight roll-off and deep blacks; a scanned negative has all the negative’s latitude and looks flatter; the negative itself is orange and inverted, and is there to look at. Printer lights correct or create casts, 25 being nominal. Duplicate generations are how a fourth-generation release print got its contrast and grain.',
  },
  fade: {
    what: 'Chromogenic dyes decay, each at its own rate, and the rates depend on the dye set and the storage temperature. Eastman Color Print 5381’s cyan and yellow dyes faded fast at room temperature while its magenta held, which is why so many prints of the 1970s are now pink. Not a desaturation: a specific, recognisable shift.',
    how: 'Set the age and the storage; the stock supplies the rates, so the same thirty years turns 5381 pink and leaves Kodachrome nearly untouched. Storage matters more than age — a cold vault slows fading by a factor of twenty. The per-dye rate controls are for imitating a particular faded print rather than a stock.',
  },
  exposure: {
    what: 'How much light reached the film, and what colour it was. Exposure is relative to what the meter asked for. The scene light is weighed against the colour temperature the stock is balanced for, which is how tungsten film shot outdoors goes blue, and daylight film indoors goes orange.',
    how: 'Exposure is where the curve’s character shows: underexpose reversal and its shadows block up; overexpose it and its highlights clip; a negative shrugs off both. The 85 filter is the orange conversion filter Super 8 cameras carried on a switch — leave it in indoors and everything turns amber. Source headroom decides how much highlight the source is assumed to have clipped.',
  },
  lens: {
    what: 'The lens, specified as it would be on a bench: resolving power in line pairs per millimetre of film, corner falloff, vignetting in stops, lateral chromatic aberration in micrometres at the corner, distortion, and veiling flare. Because these are measured on the film, the same lens takes a larger bite out of a small frame.',
    how: 'Super 8 cameras had small, slow zooms: 25–40 lp/mm, soft corners, a stop of vignetting, visible colour fringes, and enough flare to lift the blacks. A good 35 mm prime is 80–120 lp/mm with almost none of that. Veiling flare is the most underrated control here: a few percent of it is what takes the digital edge off the shadows.',
  },
  anamorphic: {
    what: 'A cylindrical lens squeezing a wide picture onto ordinary film, unsqueezed again in projection. The film itself is untouched by the squeeze, so the grain and everything else on the film are stretched sideways on the screen, the lens’s blur is oval, and bright sources throw a horizontal streak across the frame.',
    how: 'Squeeze 2 with the Scope aspect is CinemaScope. The streak is the famous one: keep it subtle and tinted blue, raise the threshold so only real light sources streak. Notice the grain: it is wider than it is tall, because it was on the film before the projector stretched it.',
  },
  camera: {
    what: 'The camera’s intermittent movement: a claw pulls the film down a frame and holds it while the shutter opens. Registration error moves the image relative to the film — under the grain, which stays put. The shutter and a spring or battery motor that does not hold speed vary the exposure from frame to frame.',
    how: 'Super 8’s plastic pressure plate gives 20–40 µm of registration error; a pin-registered 35 mm camera, a few. Frame jitter is the share that changes every frame — the twitch — against the slow wander. Speed drift is the spring-wound camera running down: longer, brighter frames, and motion that speeds up on projection. Camera starts burn a flash frame or two at the head of every shot.',
  },
  projector: {
    what: 'The machine the film runs through to be seen: a projector, or a telecine. Its gate weave moves the whole strip, so picture, grain and dirt move together. Its shutter interrupts the light two or three times a frame, which beats against a camera filming the screen. Its lamp has a hot spot, a colour, and — on AC — a ripple.',
    how: 'For a clean transfer leave the shutter at none. For the look of film filmed off a wall, use a three-blade shutter with a short capture shutter: the beat between the blade rate and the capture rate is the shimmer. Film buckle is the focus breathing as the frame heats and bows. Projection speed is how silent film ended up running too fast for half a century.',
  },
  gatedirt: {
    what: 'Grit and hair lodged in the gate itself. The film runs past it, so it does not move with the picture or with the weave: it sits still on the screen for seconds at a time, until it is dislodged. A hair at the edge of the aperture flutters as each frame is pulled past it.',
    how: 'This is the kind of dirt most emulations forget. One hair at the edge of frame, now and then, sells "projected film" faster than a screen full of specks. Keep Specks low; grit in a gate collects at the edges. Lifetime decides how long each one stays.',
  },
  filmdirt: {
    what: 'Dust and lint on the film. Every frame is a different piece of film carrying different dirt, so it lasts exactly one frame. On a print it is opaque and shows black; dirt that was on the negative when it was printed held back the printer light, so it shows white. Reversal has no negative: its dirt is always black.',
    how: 'Dust is the per-frame sparkle; fibres are the curled bits of lint. On the negative is the share that prints white — a print from a dirty negative sparkles, and that sparkle is a very different texture from black dust. Size is physical: a speck covers more of a smaller frame.',
  },
  scratch: {
    what: 'A piece of grit in a gate draws a line along the film as it runs, and keeps drawing it for as long as it stays there, so a scratch persists across seconds of picture at the same place on the film. An emulsion scratch removes dye, top layer first; a base scratch scatters the light that crosses it. Which film it was made on decides which way round that reads.',
    how: 'On a print an emulsion scratch is bright and, if shallow, coloured — it has taken only the top dye layer — while a base scratch is dark and soft. On the negative both reverse: an emulsion scratch prints dark, a base scratch prints bright. Depth decides how coloured emulsion scratches are; Wander lets them drift with the strip.',
  },
  splice: {
    what: 'Joins in the film. A splice jumps the picture as it goes through the gate, flashes as the join passes, and leaves the tape’s edges or the cement line visible. Cue marks are the circles a projectionist watched for in the top right corner: eight seconds before the end of a reel to start the second projector’s motor, one second before to change over.',
    how: 'A splice every minute or two is an edited home movie; several a minute is a well-worn print. Tape splices are hazy for a frame either side; cement splices are a thin line. With A/V Link on, every splice pops in the soundtrack as well. Set Reel length to the clip length to put cue marks at the end of your clip.',
  },
  leak: {
    what: 'Light reaching the film where it should not: a leak at the side of a camera or cartridge, fog piped along the perforated edge, and the first and last frames of a load fogged while it was loaded and unloaded. It is exposure, so it goes through the curve — and because it crosses the base before it reaches the emulsion, it hits the red layer first and comes out orange.',
    how: 'Roll-end fog is the most authentic of these: Super 8 cartridges fogged at both ends every time, and the opening seconds of almost every home movie are washed out in orange. The roll length comes from the gauge — 3,600 frames for a Super 8 cartridge. Keep the leak itself occasional; constant leaking reads as a filter.',
  },
  decay: {
    what: 'Film kept badly. Acetate base breaks down — vinegar syndrome — and shrinks unevenly, warping the frame; the emulsion, unable to shrink with it, lifts in ridges along the film. Mould eats the gelatin in soft colonies. Water dries in tide lines. In places the emulsion flakes off entirely.',
    how: 'All of these are on the film, so they weave with it, and they change slowly along a reel rather than frame by frame. Use them sparingly and together: a little vinegar warp with a little channelling and a mould colony or two reads as a film found in a loft; any one of them at full strength reads as an effect.',
  },
  telecine: {
    what: 'Turning projected film into video. Pulldown builds each video frame from two fields, which on mixed frames come from different film frames: the 3:2 cadence of 24 fps film on 29.97 fps video, with its judder and its combing. The transfer’s tone maps the print’s aim density to mid grey and clear film to white.',
    how: 'Turn on interlaced pulldown with an output rate of 29.97 for the look of film broadcast on NTSC television. Mid grey and White are the colourist’s two anchors; Black lift is flare in the transfer, the milky blacks of an old telecine. Black is otherwise set on the film’s own unexposed density, as a colourist would.',
  },
  framing: {
    what: 'The shape and frame rate of what comes out. The aspect is the projected picture’s shape, cropped out of the camera aperture; the export file is exactly that shape. Overscan widens the window beyond the gate to show the frame edge, frame lines, the next frame, perforations and the edge of the strip, as a scanner with an oversized gate does.',
    how: 'Full camera gate is the format’s own shape. Positive overscan is the fashionable "sprocket holes" look — and here the perforations sit where they do on the real gauge. Output rate is where the cadence comes from: anything other than the film rate means some film frames are held longer than others.',
  },
  audio: {
    what: 'What goes onto the soundtrack, and what kind of soundtrack it is. A film soundtrack is one channel: a magnetic stripe on Super 8 and 70 mm, a photographed optical track on most 16 mm and 35 mm, or nothing at all on a silent film, when the only sound is the projector.',
    how: 'Choose the track type first — it decides which of the Magnetic Stripe and Optical Track sections apply, and how much treble survives. Silent film is worth trying on anything: the projector’s clatter alone is the most evocative sound in the application.',
  },
  transport: {
    what: 'The film moving past the sound head. Flywheels and loops isolate the head from the intermittent pull-down, never completely: slow wow from an out-of-round capstan, faster flutter from rollers and sprockets, and a modulation at the perforation rate that is the pull-down itself leaking through.',
    how: 'Small home projectors had audible wow; cinema machines very little. Sprocket modulation is a subtle, specific buzz at the frame or perforation rate — 18 Hz on Super 8, 96 Hz on 35 mm. A camera’s speed drift is carried into the pitch through the A/V Link, because a camera running slow recorded its sound slow too.',
  },
  magnetic: {
    what: 'A stripe of iron oxide along the edge of the film, recorded and played like tape. On Super 8 it is under a millimetre wide and moves at 76 mm/s, so it is noisy and its treble stops near 7 kHz — set by the film speed, not by a slider. Print-through is the faint echo of the adjacent winding of the reel, magnetised by it in storage.',
    how: 'Hiss and head wear do most of the work. Dropouts are flakes of missing oxide. Print-through is a lovely, rarely emulated detail: on a reel stored heads-out the echo arrives before the sound. That needs the future, so only an export renders it as a true pre-echo; the live preview plays it after.',
  },
  optical: {
    what: 'Sound photographed beside the picture and read by a lamp and a photocell. Variable area is a clear wiggling trace that clips hard when it runs out of track; variable density is a band of grey recorded through the film’s own curve, so its distortion is the curve’s. Dirt on the track crackles; a splice bloops; an AC exciter lamp hums at twice the mains frequency.',
    how: 'Keep modulation under 1 for clean sound, push it over for the ugly clip of an overcut track. Crackle and the picture’s dirt come from the same dirty print when the A/V Link is on. Variable density is the older, softer, noisier sound of the 1930s and 40s.',
  },
  playback: {
    what: 'The equalisation and amplifier between the sound head and the speaker. The Academy curve was a deliberate treble roll-off cinemas applied from 1938 into the 1970s to hide the hiss of optical tracks. A home sound projector’s amplifier was small, mid-forward and built to be heard over its own motor.',
    how: 'Academy for theatrical prints of any era before Dolby; the projector curve for anything shown at home. Drive pushes the amplifier into the gentle overload of valves or the harder clipping of a transistor stage.',
  },
  speaker: {
    what: 'The loudspeaker and the space it is in: anything from the little cone in the side of a home projector to a horn behind a cinema screen. The cabinet is a synthesised impulse response, not just an EQ, because a box resonance rings in time as well as in frequency.',
    how: 'Small cabinet, high honk and some breakup is a projector on a coffee table. Large cabinet, low honk and a big room is a picture palace. Through the booth glass puts you in the projection booth: the film sound muffled through the window, the projector loud beside you.',
  },
  projnoise: {
    what: 'The projector itself, in the room: the claw striking the film once a frame, a second rattle from a worn mechanism, air from the shutter and lamp fan chopped at the blade rate, and the motor. It is not part of the soundtrack, so it is added after the speaker, the way CRTBOX added its flyback whine — because it is a machine beside you, not a sound coming out of one.',
    how: 'This is the direct analogue of CRTBOX’s flyback whine, and the single most evocative sound here. It is locked to the frame rate because it is the frame rate. Raise wear for an old machine; lower the mechanism tone for a big one. With the A/V Link, a frame that jumps in the gate is a frame that clacks louder.',
  },
  link: {
    what: 'The picture and the sound go through the same machine. A frame the claw struck badly both weaves and clatters; a splice through the gate is a splice past the sound head; the dirt on the picture is dirt on the track; the lamp and the exciter share a supply. This section makes those couplings explicit — it is what makes the application one object rather than two effects.',
    how: 'Leave it on. Turn individual couplings down if one is too much, but the point is that faults appear in both at once: it is why a splice here reads as a splice rather than a jump cut with a click laid over it. Speed → pitch only matters with camera speed drift on.',
  },
};

export const PARAM_HELP: Record<string, string> = {
  /* ---------------- engines ---------------- */
  'engine.stock': 'Switches off the whole emulsion in one go — curve, grain, halation, dyes, print and fading — leaving an ideal straight-line positive that reproduces the exposure exactly. Use it to see how much of the look is the stock.',
  'engine.lens': 'Switches off exposure and the lens. The light reaches the film exactly as the source has it: no vignetting, no softness, no flare, no colour cast. The film’s own sharpness still applies.',
  'engine.gate': 'Switches off all the machinery: camera and projector transport, dirt, scratches, splices, leaks, decay and the telecine. A perfect machine running the same film — the cleanest way to judge the stock alone.',

  /* ---------------- format ---------------- */
  'format.gauge': 'The film’s width and frame size, from Regular 8 at 4.5 × 3.3 mm to 65 mm at 52.5 × 23 mm. It sets the grain scale, the halation radius, how far a micrometre of weave moves the picture, how sharp a given lens looks, where the perforations are and how long a roll lasts.',
  'format.stock': 'The emulsion. Reversal stocks — Kodachrome, Ektachrome, Tri-X — are projected as they come out of processing and clip highlights hard; negatives — Vision3, Eastman 5247, Double-X — hold enormous latitude and are printed. Each brings its own curve, granularity, dyes and fade rates.',
  'format.fps': 'How many frames a second the camera exposed. The picture only changes this often, which is much of the character of 8 mm: 16 fps for silent Regular 8, 18 for Super 8, 24 for sound film. Picking a speed different from the projector’s makes motion faster or slower on screen.',

  /* ---------------- curve ---------------- */
  'curve.enabled': 'Switches off the characteristic curve. The film becomes an ideal straight-line positive with no toe and no shoulder, so you can see exactly what the curve was doing — usually, holding the highlights and the blacks.',
  'curve.gamma': 'The slope of the straight-line section, as a multiple of the stock’s own. Above 1 is a harder, more contrasty development; below 1 is softer. Grey stays where it is; the ends move.',
  'curve.toe': 'Moves the shadow end of the curve, in log exposure. Positive crushes more of the shadows into the film’s black; negative opens them up. On reversal this is the dense end of the film; on a negative it is the thin end.',
  'curve.toeSoftness': 'How gradually the shadows bend into the toe. Soft toes give a long, gentle fall into black; hard ones a sudden floor. Multiplies the stock’s own softness.',
  'curve.shoulder': 'Moves the highlight end, in log exposure. Negative brings the shoulder down into the picture so highlights compress sooner; positive gives them more room. On reversal stocks the shoulder is close above grey to begin with, which is why they clip.',
  'curve.shoulderSoftness': 'How gently the highlights bend over at the shoulder. A soft shoulder is the long highlight roll-off people mean by "film"; a hard one is reversal’s abrupt clip. Multiplies the stock’s own.',
  'curve.crossover': 'Gives the three layers slightly different contrast, so shadows and highlights take opposite colour casts — magenta shadows and green highlights, or the reverse. Real stocks have a little; mismatched processing has a lot.',
  'curve.push': 'Push processing: the film was rated faster and developed longer. Each stop of push raises contrast, adds fog to a negative or weakens a reversal’s blacks, and enlarges the grain, while recovering most but not all of the lost exposure. Negative values pull: softer and finer.',

  /* ---------------- grain ---------------- */
  'grain.enabled': 'Switches grain off entirely. Useful for judging the curve and the dyes by themselves, and a reminder of how much of the "texture of film" grain is responsible for.',
  'grain.amount': 'Multiple of the stock’s published RMS granularity. At 1 the grain is what the data sheet says for this stock on this gauge at this output resolution. Change the stock or gauge for a different grain; use this to exaggerate or tame it.',
  'grain.size': 'Multiple of the size of a grain clump on the film. Larger clumps are coarser and more visible at the same RMS; smaller ones become finer than a pixel and average away. Fast stocks have larger clumps than slow ones.',
  'grain.colour': 'How independent the three layers’ grain is. Real colour film has three separate emulsions, each with its own grain, so its grain has colour. At 0 every layer shares one pattern and the grain is neutral, like a silver print.',
  'grain.blue': 'Scales the blue-sensitive layer’s grain on top of the stock’s own balance. That layer is usually the grainiest, because it is the fastest; raising it gives the speckled yellow-blue grain of a pushed or cheap stock.',
  'grain.roughness': 'Weight of a coarser octave of noise on top of the clumps — how much grains gather into clusters rather than sitting evenly. Real grain has structure; at 0 it is a single scale of noise and looks finer and more digital.',
  'grain.density': 'How grain power follows density. At 0.5, the square-root law silver obeys, grain lives where there is density to fluctuate. At 0 it is uniform — the classic mistake of an additive grain filter; at 1 it is heavily concentrated in dense areas.',
  'grain.print': 'The print stock’s own grain, and that of any duplicate generations. Print stocks are very fine-grained, so this is subtle, but it is a second, independent layer of grain on top of the negative’s — part of why a print looks different from a scan.',

  /* ---------------- halation ---------------- */
  'halation.enabled': 'Switches halation off. Light reflecting back off the base is part of every film image, and a bright light without its halo is one of the quickest giveaways of a digital emulation.',
  'halation.amount': 'Multiple of how much light the stock’s anti-halation backing lets back. Stocks with good backing halate faintly; early stocks and some reversal glowed spectacularly. Raise it for night scenes full of practical lights.',
  'halation.radius': 'Multiple of the halo’s radius, which is set by the thickness of the base: roughly 1.7 base thicknesses, about a quarter of a millimetre. That is a twentieth of a Super 8 frame and a sixtieth of a 35 mm one.',
  'halation.green': 'How much of the reflected light reaches the green-sensitive layer as well as the red. At 0 the halo is pure red; around 0.3 it is the familiar orange. The blue layer is shielded by the yellow filter layer and barely halates at all.',
  'halation.noBacking': 'The remjet anti-halation layer removed before processing — the trick CineStill uses to put motion-picture film in still cameras. Halation becomes about eight times stronger, and every light source carries a red-orange glow.',

  /* ---------------- dyes ---------------- */
  'dye.enabled': 'Switches off interimage effects and the dyes’ impurity. Colours become what three independent, perfectly pure layers would give: correct, and noticeably flatter than film.',
  'dye.saturation': 'Strength of the interimage effect, as a power of the stock’s own: 0 is none — layers develop independently — 1 is the stock as made, 2 doubles it. This is film’s colour separation, done in density, which is why it looks different from a saturation slider.',
  'dye.impurity': 'How far the dyes are from ideal. Real cyan dye absorbs some green, real magenta a good deal of blue; more impurity muddies colours towards brown, less makes them unrealistically pure. Scales the stock’s own impurity.',

  /* ---------------- print ---------------- */
  'print.enabled': 'Switches the print stage off. A negative is then shown as a scanned negative — inverted with a straight line — so you can compare what the print stock adds: its highlight roll-off, its blacks and its contrast.',
  'print.process': 'How a negative becomes a picture: printed onto print stock through printer lights, scanned and inverted digitally, or not at all — the negative on a light box, orange mask and all. Reversal stocks are already positives and ignore this.',
  'print.stock': 'The positive stock. Vision 2383 is the modern release print; 5381 is the 1970s stock whose dyes faded pink; Technicolor dye transfer is purer and almost permanent; 2302 is black-and-white, and prints a colour negative as monochrome.',
  'print.red': 'Red printer light in printer points, 0.025 log exposure each, around the laboratory’s nominal 25. More red light exposes the print’s red-sensitive layer more, which forms more cyan dye: the print goes cyan.',
  'print.green': 'Green printer light. More green light forms more magenta dye in the print; less leaves it greener. The laboratory’s main tool for correcting a magenta or green cast.',
  'print.blue': 'Blue printer light. More blue light forms more yellow dye in the print; less leaves it bluer. Raising red and green together against blue is how a lab warmed a scene up.',
  'print.density': 'All three printer lights together, in points: a darker or lighter print with the same colour. Eight points is about a stop on the print — which is how a lab printed a scene darker for night.',
  'print.generations': 'Copies before the print: an interpositive, an internegative, and so on. Each generation adds its own grain, a little contrast and a little softness. Release prints were often third or fourth generation; a late-run print could be further down still.',
  'print.bleachBypass': 'Skipping the bleach that removes silver from the print, so silver stays in alongside the dye. The result is contrastier, desaturated and harsher — the look of a number of late-1990s films. At 1 it is a full bypass; values between are partial.',

  /* ---------------- fading ---------------- */
  'fade.enabled': 'Switches dye fading off. The positive looks as it did the day it was printed, whatever age and storage say.',
  'fade.years': 'How long the positive — the print, or a reversal original — has existed. The stock sets how fast each dye goes: Kodachrome barely moves in fifty years in the dark, 5381 prints are pink within twenty at room temperature.',
  'fade.storage': 'Where the film has been. Dye fading roughly doubles with every five to seven degrees, so a cold vault preserves a print for centuries and a loft that bakes every summer destroys it in a decade.',
  'fade.cyan': 'Multiple of the stock’s cyan fade rate. Cyan is usually the first dye to go in the Eastman stocks of the 1970s, which takes red absorption away and leaves everything red or pink.',
  'fade.magenta': 'Multiple of the stock’s magenta fade rate. Magenta is usually the most stable dye in those stocks, which is why faded prints end up magenta rather than grey.',
  'fade.yellow': 'Multiple of the stock’s yellow fade rate. Yellow fading lets blue through; with cyan gone as well it turns a red cast into a pink-magenta one.',
  'fade.stain': 'Multiple of the stock’s rate of yellow staining: the base and leftover couplers yellowing with age, which adds density in the blue and partly offsets the yellow dye’s loss. Old prints are often both faded and stained.',

  /* ---------------- exposure ---------------- */
  'exposure.enabled': 'Switches the Exposure section off: correct exposure, light matched to the stock, no filter and no highlight expansion of the source.',
  'exposure.stops': 'Exposure relative to what the meter asked for. On reversal, half a stop either way is visible and two stops over is ruined; on a negative, two stops either way prints almost normally. This is where the difference between the two shows most.',
  'exposure.headroom': 'How far above white the source’s brightest highlights are assumed to have been in the real scene. Video clips at white; the scene did not. Expanding the highlights back gives the shoulder and the halation something to work on. Lower it for flat, graphic sources.',
  'exposure.light': 'What the scene was lit with, compared with what the stock is balanced for. Tungsten film in daylight goes blue; daylight film under tungsten goes orange; fluorescent tubes go green on everything. "Matched" assumes the footage was lit correctly for the stock.',
  'exposure.filter85': 'The Wratten 85 conversion filter: orange, about two-thirds of a stop. It converts daylight to tungsten balance, and every Super 8 camera had one built in for Type A film, switched out by screwing in a movie light. Left in indoors it turns everything amber.',

  /* ---------------- lens ---------------- */
  'lens.enabled': 'Switches the lens off: a perfect lens with infinite resolution, no vignetting, no fringing and no flare. The film’s own sharpness still applies.',
  'lens.resolution': 'Resolving power in line pairs per millimetre on the film at 50% contrast. Because it is measured on the film, the same lens takes a bigger bite of a small frame: 40 lp/mm is soft on Super 8 and sharp on 35 mm. Typical: a Super 8 zoom 25–40, a 16 mm prime 60–80, a 35 mm prime 80–120.',
  'lens.corners': 'How much softer the corners are than the centre. Cheap zooms fall off badly towards the corners, especially wide open; good primes hardly at all.',
  'lens.defocus': 'A focus miss: the radius of the blur circle on the film, in micrometres. Twenty is a near miss on 35 mm and a disaster on Super 8. Unlike the projector’s focus, this softens the picture but not the grain, because the grain was not there yet.',
  'lens.vignette': 'Light lost in the corners, in stops. Small zooms wide open lose a stop or more; it was part of the look of home movies. Applied as exposure, so the curve decides how it looks — on reversal the corners block up into black.',
  'lens.chromatic': 'Lateral chromatic aberration: how far apart the red and blue images are at the corner of the frame, in micrometres on the film. Coloured fringes along edges towards the corners. Five to ten is typical of a cheap zoom.',
  'lens.distortion': 'Barrel (positive) or pincushion (negative) distortion. Wide zooms barrel; long ones pincushion. Small values are realistic; large ones are a fisheye.',
  'lens.flare': 'Veiling flare: light scattered inside the lens and spread evenly over the frame, as a fraction of the average exposure. It lifts the shadows and lowers contrast. A few percent is what makes Super 8 shadows look milky; uncoated lenses had much more.',
  'lens.flareTint': 'Colour of the veiling flare. Lens coatings are not neutral, and old single-coated glass tends warm. Positive warm, negative cool.',

  /* ---------------- anamorphic ---------------- */
  'anamorphic.enabled': 'Turns the anamorphic lens on: the picture is squeezed onto the film and stretched back on projection, and bright sources streak sideways.',
  'anamorphic.squeeze': 'How much narrower the picture is on the film than on the screen. 2× is CinemaScope. Everything on the film — grain, dust, the lens’s blur — is stretched by the same factor on the way out, which is a large part of the anamorphic look.',
  'anamorphic.streak': 'Strength of the horizontal streak flare an anamorphic lens throws through bright light sources. Added as exposure, so it goes through the curve and halates like any other light.',
  'anamorphic.streakLength': 'How long the streak is, as a fraction of the frame width. Long thin streaks across the whole frame are the familiar look; short ones are subtler.',
  'anamorphic.streakTint': 'Colour of the streak, from neutral to the electric blue of coated anamorphic glass.',
  'anamorphic.threshold': 'How many stops over grey a highlight must be before it streaks. Lower it and everything bright streaks; raise it and only real light sources do.',

  /* ---------------- camera ---------------- */
  'camera.enabled': 'Switches the camera transport off: perfect registration, perfectly repeatable exposure, a motor that holds speed and no flash frames.',
  'camera.weave': 'Registration error in micrometres on the film. The image moves relative to the film — the grain stays put, which is what makes it look recorded rather than projected. Super 8 with its plastic pressure plate: 20–40 µm. A pin-registered 35 mm camera: under 5.',
  'camera.weaveSpeed': 'Rate of the slow wander, in hertz. The loop and pressure plate settle slowly; the wander has a period of a second or two.',
  'camera.jitter': 'Share of the registration error that is new every frame — where the claw happened to engage — rather than slow drift. High values twitch; low ones float.',
  'camera.flicker': 'Frame-to-frame exposure variation, in stops. A shutter and motor that do not quite repeat expose every frame slightly differently: the shimmer of Super 8 is mostly this. A tenth of a stop is plenty.',
  'camera.speedDrift': 'How far the camera’s speed wanders, as a fraction. A slow frame is a longer exposure — brighter — and, projected at the normal rate, makes motion faster. With the A/V Link the recorded sound drifts in pitch with it.',
  'camera.flashRate': 'How often per minute the camera was started. Each start overexposes the first frames while the motor comes up to speed, which is why home movies flash white at the head of every shot.',
  'camera.flashFrames': 'How many frames each camera start burns. The first is the worst; the rest settle quickly.',

  /* ---------------- projector ---------------- */
  'projector.enabled': 'Switches the projector’s faults off: no gate weave, no shutter, no lamp hot spot or colour, perfect focus and framing. A perfect transfer of a real film.',
  'projector.weave': 'Gate weave in micrometres: the whole strip wandering in the projector’s gate. Picture, grain and dirt move together, which is the opposite of the camera’s registration error and the way to tell them apart.',
  'projector.rotation': 'Share of the weave that is a slight tilt rather than a slide. Worn edge guides let the strip rock as well as shift.',
  'projector.speed': 'How fast the projector runs. A 16 fps silent film on a 24 fps sound projector runs half as fast again — which is how silent comedies came to look frantic. Sound is played faster too, and higher.',
  'projector.blades': 'The shutter that hides the film while it moves. Filmed off the screen with a video camera, its two or three interruptions a frame beat against the camera’s own frame rate: the flicker and shimmer of "filmed off the wall". A telecine has no shutter.',
  'projector.captureShutter': 'Exposure time of the camera filming the screen, as a fraction of its frame. Short exposures catch the shutter’s beat hardest; a fully open shutter averages it away.',
  'projector.mains': 'Mains frequency, 50 or 60 Hz. The lamp’s ripple and the exciter lamp’s hum are at twice this, and the projector’s synchronous motor hums at it.',
  'projector.lampRipple': 'Brightness ripple from a lamp run on alternating current, at twice the mains frequency. Captured by a camera, it beats into a slow flicker; with the A/V Link it is also heard as hum, because the lamp and the exciter share a supply.',
  'projector.hotspot': 'Light falling off from the centre of the screen, in stops at the corners. Small projectors with short focal lengths had a pronounced hot spot.',
  'projector.warmth': 'Colour of the projection lamp: a tungsten bulb warm, a xenon arc cool. Small home projectors were noticeably warm.',
  'projector.focus': 'The projection lens out of focus, as a blur radius on the film. Unlike the camera lens, this softens the grain and the dirt too, because they are on the film being projected.',
  'projector.buckle': 'The frame bowing towards the lamp as it heats, so the focus breathes and the centre of the picture softens before the edges. Old projectors with hot lamps and worn gates buckled visibly.',
  'projector.framing': 'The framing knob out of adjustment, in frames: the frame line and the edge of the next frame creep into the picture at top or bottom.',

  /* ---------------- gate dirt ---------------- */
  'gatedirt.enabled': 'Switches gate dirt off: no hairs, no grit lodged in the gate.',
  'gatedirt.hair': 'How often a hair is caught at the edge of the aperture. It sits still on the screen while the film runs past, fluttering slightly, until it is dislodged — the classic "hair in the gate" a cinematographer checked for after every take.',
  'gatedirt.specks': 'How much grit is lodged in the gate. It stays still on screen for seconds while the picture moves beneath it, and gathers towards the edges, where the film drags.',
  'gatedirt.life': 'How long a hair or a speck stays before it is dislodged, in seconds. Real gate dirt can last a whole shot.',
  'gatedirt.wiggle': 'How much a hair flutters as each frame is pulled past it. Hairs at the edge of the gate are disturbed once a frame by the film moving, and sway in the air from the shutter.',
  'gatedirt.size': 'Scales hairs and specks together. Gate grit is a fixed size in the gate, so unlike film dirt it does not grow with a smaller format — this is purely how big the debris in this particular gate is.',

  /* ---------------- film dirt ---------------- */
  'filmdirt.enabled': 'Switches film dirt off: no dust, no lint, on either the negative or the positive.',
  'filmdirt.dust': 'Dust specks per frame. Each frame is a different piece of film, so each frame has different dust, and it lasts one frame only — the twinkle of a dusty print.',
  'filmdirt.fibres': 'Lint and short hairs on the film itself: curled strokes that, unlike gate hairs, last one frame and jump about.',
  'filmdirt.size': 'Physical size of the dirt. A speck of dust is the same size whatever film it lands on, so it covers a far larger share of a Super 8 frame than a 35 mm one.',
  'filmdirt.negative': 'Share of the dirt that was on the negative when it was printed. That dirt held back the printer light, so it prints white — the "sparkle" of a print from a dirty negative. Only a printed negative has a second film for dirt to be on.',

  /* ---------------- scratches ---------------- */
  'scratch.enabled': 'Switches scratches off, on the negative and the positive alike. The grit that would have drawn them is still in the gate as far as the Gate Dirt section is concerned.',
  'scratch.rate': 'How often a scratch is running. Each is a piece of grit riding in a gate: it arrives, draws a continuous line along the film for a while, and falls out.',
  'scratch.life': 'How long, in seconds, a piece of grit stays in the gate drawing its line. Scratches last seconds, not frames — which is what makes them scratches and not dirt.',
  'scratch.width': 'Width of a scratch on the film, in micrometres. The same scratch is a hairline on 35 mm and a stripe on Super 8.',
  'scratch.depth': 'How deep an emulsion scratch cuts. A shallow one removes only the top dye layer and is coloured — green on a print, blue on reversal; a deep one removes all three and is clear.',
  'scratch.base': 'Share of scratches on the base side rather than the emulsion. A base scratch removes no dye; it scatters the light crossing it, so it reads as a soft dark line on a print — and a bright one if it was on the negative.',
  'scratch.negative': 'Share of scratches made on the negative before printing. Their polarity reverses: an emulsion scratch on the negative prints dark, a base scratch prints bright. Only matters for a printed negative.',
  'scratch.wander': 'How far a scratch drifts sideways along its length, as the grit rocks and the strip weaves in the gate.',

  /* ---------------- splices ---------------- */
  'splice.enabled': 'Switches splices and cue marks off: the film is one unbroken strip, with no jumps, no flashes, no pops in the soundtrack and no reel-change marks.',
  'splice.rate': 'How often per minute the film has been joined. With A/V Link on, every splice also pops in the soundtrack — a click on a magnetic stripe, a low "bloop" on an optical track.',
  'splice.kind': 'Tape splices lay clear tape across the join: its two edges cross the frame and the frames under it go hazy. Cement splices overlap and weld the film: a thin line at the frame line and a slightly denser frame.',
  'splice.jump': 'How far the picture jumps as the splice goes through the gate — a thicker join lifts the film off the claw for a frame.',
  'splice.flash': 'Strength of the light frame at the join, where the film was scraped clean for cement or the tape lets the frame go thin.',
  'splice.cueMarks': 'Cue marks: circles punched or scribed into the top right of four frames, eight seconds before the end of a reel and again one second before, for the projectionist to start the next projector and change over.',
  'splice.reel': 'Reel length in seconds, for placing the cue marks. A 35 mm 2,000 ft reel ran about twenty minutes; set this to your clip’s length to put the marks at the end of it.',

  /* ---------------- leaks ---------------- */
  'leak.enabled': 'Switches light leaks and fog off: the camera and cartridge were light-tight and the film was loaded in the dark.',
  'leak.amount': 'A leak from the side of the camera or the cartridge, flaring and fading. It is exposure, so it goes through the curve, and it arrives through the base, so it is orange.',
  'leak.position': 'Where round the frame the light gets in, as a fraction of the way round from the right-hand edge.',
  'leak.speed': 'How quickly the leak flares and fades. Leaks track camera movement and how the light falls on the camera body, so they come and go over seconds.',
  'leak.edgeFog': 'Light piped along the perforated edge of the film from the cartridge, fogging that side of every frame. A thin orange band down one side is characteristic of some Super 8 cameras.',
  'leak.rollFog': 'Fog on the first and last frames of a load, from loading and unloading in daylight. The roll length comes from the gauge, so the fog returns at the start of every cartridge — 3,600 frames on Super 8.',
  'leak.warmth': 'Colour of leaked light. Light coming through the base reaches the red-sensitive layer first, so leaks are orange-red; 0 treats it as white light hitting the emulsion from the front.',

  /* ---------------- decay ---------------- */
  'decay.enabled': 'Switches decay off: the film is physically intact, whatever its dyes have done.',
  'decay.vinegar': 'Vinegar syndrome: acetate base breaking down, shrinking unevenly and buckling. The film itself is warped, so the image, its grain and everything on it bend together. Smells of vinegar; looks seasick.',
  'decay.channelling': 'The emulsion lifting in ridges along the film as the base shrinks beneath it. A network of fine lines running along the strip, catching the light.',
  'decay.mould': 'Fungus eating the gelatin in soft-edged colonies that lighten and discolour the picture. Colonies are on the film, so they weave with it and creep from frame to frame.',
  'decay.water': 'Tide lines where water dried on the emulsion: dark rings with a faint stain inside them.',
  'decay.flaking': 'Patches where the emulsion has come away entirely, leaving clear base with a dark ragged rim.',

  /* ---------------- telecine ---------------- */
  'telecine.enabled': 'Switches the telecine’s pulldown and tone controls off: progressive frames, grey and white at their defaults, no black lift.',
  'telecine.fields': 'Build each video frame from two fields that may show different film frames. With 24 fps film and 29.97 fps output this is the 3:2 cadence: two frames in every five are mixed, combed where things move, and motion judders in a rhythm of three fields and two.',
  'telecine.fieldOrder': 'Which field comes first in time. NTSC transfers were usually lower field first; this only changes which lines carry the later film frame.',
  'telecine.grey': 'Where the print’s aim density lands on video, as linear light. 0.18 puts it at the conventional mid grey.',
  'telecine.white': 'Where clear film lands on video. Above 1 the highlights of the print clip on video before the film clips; below 1 the transfer is dim and safe.',
  'telecine.black': 'Flare in the transfer, lifting the blacks — the milky shadows of an old flying-spot telecine. The black point is otherwise set on the film’s own unexposed density.',
  'telecine.saturation': 'The colourist’s saturation control, in linear light on the video side. Unlike the dye controls, this does nothing to how the film formed its colour.',

  /* ---------------- framing ---------------- */
  'framing.aspect': 'Shape of the projected picture, cropped from the camera aperture as a projection mask would. The output file is exactly this shape: choose 1.85 on Super 8 and the file is 1.85 with no bars baked in.',
  'framing.overscan': 'Negative crops inside the gate, as a projector’s smaller aperture does. Positive shows beyond it: the camera gate’s rounded edge, the frame line, the neighbouring frames, the perforations and the edge of the strip — where the real gauge puts them.',
  'framing.fps': 'Frame rate of the video produced. At the film rate every film frame becomes one video frame. At anything else film frames are held unevenly — 18 fps on 25 or 24 on 29.97 — which is the cadence every transfer really had.',
  'framing.dither': 'A little noise added before the picture is quantised to eight bits, so smooth gradients do not band. The grain usually does this already.',

  /* ---------------- audio source ---------------- */
  'audio.enabled': 'Switches the soundtrack processing off and passes the programme through untouched. The projector noise is controlled separately.',
  'audio.inputGain': 'Level going onto the soundtrack. Drives the magnetic stripe into saturation or the optical track past full modulation.',
  'audio.channelMode': 'How many channels survive. A film soundtrack is mono: magnetic stripe, optical track and projector speaker are all one channel. Stereo is for 70 mm magnetic prints.',
  'audio.track': 'How the sound was carried. A magnetic stripe — Super 8 and 70 mm — is hissy and narrow; a variable-area optical track clips hard; variable density distorts softly through the film’s curve; a silent film has no sound but the projector.',

  /* ---------------- transport ---------------- */
  'transport.enabled': 'Switches pitch instability off: the film passes the sound head at exactly constant speed.',
  'transport.wowRate': 'Rate of the slow pitch wander, from a capstan or flywheel out of round. Around once a second.',
  'transport.wowDepth': 'Depth of the slow wander. Small home projectors had audible wow on sustained notes; cinema machines very little.',
  'transport.flutterRate': 'Rate of the faster pitch wobble from rollers and sprockets, typically somewhere between 5 and 20 Hz.',
  'transport.flutterDepth': 'Depth of the faster wobble — a roughness on sustained tones rather than a wavering.',
  'transport.sprocket': 'The intermittent pull-down leaking through the loop to the sound head, modulating pitch at the frame rate times the perforations per frame: 18 Hz on Super 8, 96 Hz on 35 mm. A specific, faint buzz.',
  'transport.drift': 'A slow random walk in speed, as belts slip and the motor warms.',

  /* ---------------- magnetic ---------------- */
  'magnetic.enabled': 'Switches the magnetic stripe’s faults off. Only matters when the soundtrack is magnetic.',
  'magnetic.hiss': 'Oxide noise. A Super 8 stripe is under a millimetre wide and very noisy; a 70 mm stripe is wider and quieter. Bright, not rumbly.',
  'magnetic.headWear': 'Treble lost to a worn head and poor contact, on top of the ceiling the film speed already sets: about 7 kHz on Super 8 at 18 fps, rising with the speed.',
  'magnetic.saturation': 'The oxide running out of headroom on loud passages: soft, symmetric compression.',
  'magnetic.dropouts': 'Oxide flaked off the stripe, per minute: the sound dips abruptly and recovers.',
  'magnetic.dropoutDepth': 'How much signal a dropout takes: a small flake of missing oxide dulls the sound, a large one silences it for an instant.',
  'magnetic.printThrough': 'Level of the echo from the adjacent winding of the reel, magnetised by it during storage. Usually 40–60 dB down: audible in quiet gaps after loud sounds.',
  'magnetic.printDelay': 'Spacing of the echo: one turn of the reel at projection speed. Small reels near the hub give short delays; full reels long ones.',
  'magnetic.preEcho': 'Stored heads-out, the echo comes before the sound — a ghostly preview of each word. The live preview cannot look into the future, so it plays the echo after; exports render the true pre-echo.',

  /* ---------------- optical ---------------- */
  'optical.enabled': 'Switches the optical track’s faults off. Only matters when the soundtrack is optical.',
  'optical.modulation': 'Programme level against the track’s full width. Under 1 is clean. Over 1 the variable-area trace runs out of track and clips flat and hard; variable density distorts more and more through the curve.',
  'optical.imageSpread': 'Light spreading within the track’s emulsion: it lowers the treble and fills in the troughs of the trace more than the peaks, adding intermodulation.',
  'optical.noise': 'Grain in the track, heard as hiss. Variable density’s is louder and darker, which is one reason it was abandoned.',
  'optical.crackle': 'Dirt specks crossing the slit per second, each a click. With A/V Link on, the picture’s dirt adds to this — the same dirty print.',
  'optical.crackleLevel': 'Loudness of the biggest crackles. Most are small; a few are loud.',
  'optical.ticks': 'A damaged frame line or perforation ticking once a frame: a regular click at the frame rate.',
  'optical.exciterHum': 'Hum from an exciter lamp run on alternating current, at twice the mains frequency with harmonics. Cinemas used DC to avoid it; plenty of machines did not.',

  /* ---------------- playback ---------------- */
  'playback.enabled': 'Switches the playback EQ and amplifier off, so the track is heard with only its own physical limits — the stripe’s or the slit’s.',
  'playback.curve': 'The response imposed on playback. The Academy curve rolls off treble from about 2 kHz to roughly −10 dB at 8 kHz; the home projector curve is narrow and mid-forward.',
  'playback.lowCut': 'Where the bass gives out. Small projectors and speakers lost everything below 100–150 Hz.',
  'playback.highCut': 'Where the treble gives out, on top of whatever the track already lost.',
  'playback.drive': 'How hard the amplifier is pushed: from clean to the warm overload of a valve stage or the harsher clip of a small transistor one.',
  'playback.model': 'Character of the amplifier’s overload. Valves are soft and even-harmonic; a cheap transistor output stage clips one half of the wave before the other.',
  'playback.hum': 'The amplifier’s own mains hum, at the fundamental and its odd harmonics.',

  /* ---------------- speaker ---------------- */
  'speaker.enabled': 'Switches the speaker and room off: the amplifier output heard directly.',
  'speaker.resonanceFreq': 'The cabinet’s main resonance. Small boxes resonate high and boomy; large ones low.',
  'speaker.resonanceGain': 'How much the box resonance rings. A few decibels gives a small box its boom; a lot is a hollow, one-note bass.',
  'speaker.honkFreq': 'The midrange peak of a horn or a small cone. Cinema horns honk around 800–1,200 Hz; a projector’s little cone higher.',
  'speaker.honkGain': 'How nasal the speaker is. Horns were efficient and honky by nature; a few decibels here is the sound of a 1930s picture palace.',
  'speaker.cabinet': 'How much of the cabinet’s own synthesised response is mixed in — the box sound that EQ alone cannot make, because it rings in time.',
  'speaker.cabinetSize': 'From the plastic case of a home projector to a cinema horn behind the screen.',
  'speaker.breakup': 'A small cone distorting when it runs out of travel on loud passages.',
  'speaker.room': 'Reverberation of the room: a living room or a picture palace.',
  'speaker.booth': 'Heard from the projection booth: the film’s sound muffled through the booth glass, the projector loud beside you.',

  /* ---------------- projector noise ---------------- */
  'projnoise.enabled': 'Switches the projector’s own noise off. Off for a telecine transfer; on for anything that should feel watched in a room.',
  'projnoise.level': 'Overall loudness of the machine in the room. A home projector a metre away is loud enough to talk over; a booth projector through a wall is a faint rhythm.',
  'projnoise.claw': 'The intermittent pull-down striking once a frame — the clatter. Locked to the frame rate, and through the A/V Link to how hard the claw struck that frame in the picture.',
  'projnoise.tone': 'Pitch of the mechanism’s resonances. A small plastic home projector rings high; a big cast-iron cinema machine low.',
  'projnoise.wear': 'Slack in the mechanism: uneven strikes and a second, later rattle on each frame.',
  'projnoise.shutter': 'Air from the shutter blades and the lamp fan, chopped at the blade rate.',
  'projnoise.motor': 'The motor’s hum at the mains frequency and the whine of its gearing, which rises and falls slightly with the load.',
  'projnoise.distance': 'From beside you on the coffee table to behind the projection-booth wall. Distance dulls the clatter and lowers it.',

  /* ---------------- link ---------------- */
  'link.enabled': 'Switches all the picture–sound couplings off, leaving two separate effects.',
  'link.weaveToClatter': 'How much the claw’s strike, which also throws the frame in the gate, sets the loudness of that frame’s clack. A frame that jumps is a frame that clacks.',
  'link.spliceToPop': 'How loudly a splice is heard as it passes the sound head, at the moment the picture jumps.',
  'link.dirtToCrackle': 'How much the picture’s dirt adds crackle to an optical track. Dirt on the print is on the track as well.',
  'link.lampToHum': 'How much the projector lamp’s ripple is heard as exciter hum. One supply feeds both, so a flickering picture hums.',
  'link.speedToPitch': 'How much a camera’s speed drift carries into the pitch of the sound recorded with it. A camera running slow recorded its sound slow.',
  'link.audioToLamp': 'How much loud passages dim the lamp, through a shared supply sagging under the amplifier’s draw.',
};
