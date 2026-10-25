# CAMAI — brief for a camcorder emulator

*A prompt for a fresh Claude Code session. Paste the whole thing.*

*Written by the session that built FILMBOX, the second in the family after
CRTBOX, so what both builds learned the hard way is written down here instead
of being rediscovered.*

---

## What to build

**CAMAI** is a real-time camcorder emulator for video and stills. It covers the
cameras ordinary people used from the mid-1990s to the late 2000s, picture
*and* sound:

- MiniDV and Digital8, with their compression blocking, interlacing and
  early-2000s sharpness, as the core;
- the consumer camcorder around them: the auto-everything camera, the zoom
  rocker, and the timestamp, battery and REC overlays;
- later, the analogue camcorders before it (Video8, Hi8, VHS-C) and the MPEG-2
  ones after it (HDV, DVD and hard-disk camcorders).

It ships as a single-click Windows application, a headless CLI and a web app.

It is the third in a family. Read both of the others before writing anything:

```
CRTBOX   https://github.com/kingdrainman-debug/Analoguehorrorbox   televisions and VHS
FILMBOX  https://github.com/kingdrainman-debug/Filmbox             film stocks and formats
CAMAI    https://github.com/kingdrainman-debug/Camai               this one
```

Both are MIT licensed. **Fork FILMBOX.** It is the newest and has everything
CRTBOX had, plus the pieces a camcorder needs most:

- a clock that turns output time into per-field capture times;
- source frames tagged by capture time;
- an event clock shared by picture and sound;
- a probe that measures physics from pixels;
- a Windows build that has been through Wine.

From CRTBOX, take the composite and tape passes FILMBOX removed. CAMAI needs
them for the analogue capture path and, later, for the analogue camcorders.

The Camai repository holds only this file. Bring FILMBOX's history in rather
than copying files, so the reasoning in its commit messages comes too:

```
git remote add filmbox https://github.com/kingdrainman-debug/Filmbox
git fetch filmbox
git merge --allow-unrelated-histories filmbox/main
```

Then move this brief to `docs/BRIEF.md`, replacing FILMBOX's.

**Do not make a "camcorder filter".** A VHS overlay PNG, a blur, a REC dot and
a date in a pixel font is a solved, boring problem with a thousand
implementations. The thing worth building models the *chain*:

1. A small cheap lens throws light onto a CCD the size of a fingernail.
2. The CCD reads out in interlaced fields and smears where it is overloaded.
3. An automatic camera chases exposure, focus and white balance.
4. Its DSP sharpens every edge.
5. A codec with a fixed bit budget crushes the result into 8×8 blocks.
6. A tape drops out.
7. Someone captures it over FireWire, or through a cheap analogue card, and
   uploads it to a 2006 video site.

Every artefact should come from modelling one step of that chain. None should
be a texture laid on top.

---

## The domain

Treat this as a starting map, not as gospel. Verify the numbers as you
implement them. Where I was unsure I have said "verify". The places to look are
the DV standard (IEC 61834, SMPTE 314M), FFmpeg's `dvvideo` encoder and
decoder (open source, and a reference you can run), camcorder service manuals,
and CCD data sheets.

### The camera head: lens, sensor, readout

**The sensor is tiny, and that is half the look.** Consumer camcorders used
1/6", 1/4" and 1/3.6" CCDs; a 1/6" sensor is about 2.4 × 1.8 mm. Three things
follow:

- *Enormous depth of field.* Everything is in focus, so subject separation
  does not exist. This is part of "the video look", and anything that adds
  shallow focus is wrong.
- *Poor low light, and gain.* The camera adds gain in steps up to about
  +18 dB. Gain noise is coarse and coloured, and it is in the signal *before*
  the codec, which matters a great deal (see below).
- *Diffraction at small apertures* softens the image in bright sun. The camera
  then raises the shutter speed instead: 1/250 s, 1/1000 s. Motion becomes
  staccato and blur-free, a large part of why daylight camcorder footage looks
  so crisp and so jittery.

**Single-chip vs three-chip is a fork, not a slider.**

- *Single-CCD consumer cameras* mostly used a **complementary colour filter
  mosaic** (cyan, magenta, yellow, green), read in field-summed pairs. The
  results: low colour resolution, false colour and moiré on fine detail, and
  muddy saturated reds.
- *Three-CCD prosumer cameras* split the light with a prism and are far
  cleaner in colour. This was the skate-video and indie-film camera class.

Model the mosaic and its demosaic. Do not desaturate and call it single-chip.

**CCD vertical smear is the signature artefact.** On an interline-transfer
CCD, a bright point (a streetlight, the sun, a car headlamp) leaks charge
during readout and draws a vertical stripe the full height of the frame. It is
an artefact *of the readout*, so:

- it is in the signal before every later stage, which sharpens and compresses
  it;
- its strength relative to the picture rises as the shutter gets faster
  (verify).

Blooming spreads an overloaded well into its neighbours as well. **CMOS
camcorders (from about 2006) do not smear; they have rolling shutter instead.**
Verticals lean on a pan and propellers bend. Getting the era wrong in either
direction is the camcorder equivalent of FILMBOX's grain moving with the
subject.

**Interlaced readout.** The CCD delivers *fields*: 59.94 a second in NTSC
countries and 50 in PAL ones, each a separate moment in time. In field
integration mode, adjacent sensor rows are summed in pairs, and the pairing
alternates between fields. Each field therefore has less vertical resolution
than half a frame, and the two fields sample different row pairs (verify the
pairing per sensor). Sixty distinct moments a second is *the* video motion,
smooth and unmistakable, and it only exists if the field clock is real (see
the frame clock below).

**The tone curve is the opposite of film's.** Video has perhaps five or six
stops of usable range on these sensors. A *knee* compresses the top of the
range, and then the signal clips hard.

- On a single-chip camera the channels clip at different points, so a
  blown-out sky goes cyan or yellow at its edge before it goes white.
- FILMBOX's shoulder is a gentle roll-off; this is a short knee and a wall.
- DV's coding range has headroom above reference white, and consumer cameras
  used it: superwhites up to about 109 IRE (verify). Whether the capture or
  display path clips them is a separate, later decision, not the camera's.

**The lens** is a small, slow 10× to 25× zoom: soft in the corners, flaring
easily, with visible chromatic aberration at the long end. The
**wide-angle and fisheye adapters** screwed onto the front deserve their own
treatment: heavy barrel distortion, a soft rim and a hard vignette. The fisheye
on a three-chip DV camera *is* the skate-video look.

### The camera's automatics: where "consumer" lives

Professional video is defined by its controls and consumer video by their
absence. The automatics are the character.

- **Auto exposure** steers iris, gain and shutter together, with lag. Walk
  from a room into daylight and the picture blows out, then pumps down over
  a second or so. It hunts on flickering light, and backlight compensation
  over-corrects.
- **Auto white balance** drifts slowly and is wrong in recognisable ways:
  orange under tungsten, green under fluorescent tubes. It shifts visibly when
  a coloured object fills the frame.
- **Autofocus** was contrast-detection. It hunts, breathing in and out, when
  the subject changes or the light falls, and it locks on the background
  behind a near subject.
- **Electronic image stabilisation** reads out a crop of the sensor and moves
  the crop to cancel shake. That gives a smaller field of view and a little
  less resolution. Most tellingly, the frame stays steady while the motion
  blur in it does not, because blur cannot be stabilised after the fact.
- **Digital zoom** goes past the optical range ("500×!") by enlarging a
  shrinking crop of the sensor. The upscale is coarse, so the picture turns
  to blocks with a magnification readout on the display.
- **Slow shutter and night modes.** 1/30 s or 1/15 s repeats fields and
  smears motion into stuttering trails. **Infrared night modes** removed the
  IR-cut filter and lit the scene with an IR LED. The result is near
  monochrome with a green cast, a hot spot in the middle of the frame, glowing
  eyes, and fabrics that turn translucent in IR. Found-footage horror lives in
  this mode; do it well. Describe it generically: the names were trademarks.
- **Detail enhancement ("aperture correction")** is the early-2000s sharpness,
  and it deserves the care FILMBOX gave the characteristic curve. The camera
  boosts edges horizontally and vertically with a peaking filter:
  - every edge gets an overshoot halo, a bright fringe on the light side and
    a dark one on the dark side;
  - a *coring* threshold leaves low-level noise unboosted;
  - vertical enhancement works across lines, so it interacts with
    interlacing.

  It happens *before* the codec, and halos are expensive to code, so the
  codec then rings around them. Model it as a filter with gain, frequency,
  coring and limiting, not as an unsharp mask turned to 11.
- **In-camera digital effects**: the fader (fade from black or white at REC
  start), sepia, black and white, "old movie", mosaic, strobe, trail. Small,
  well known and cheap. Ship them inert.

### The operator

A camcorder is handheld by someone who is not a camera operator. Model the
person as a section of their own:

- hand tremor with a real tremor spectrum;
- the walking bob;
- shake magnified by the zoom;
- the slow zoom in on the birthday cake;
- the whip pan;
- the handling bump when a hand shifts its grip.

The zoom position should be an ordinary animatable parameter. The timeline
then drives it, and the audio reads its velocity (see the A/V link).

### The codec: DV

DV is intra-frame DCT compression at a constant 25 Mbit/s for video, about
5:1. Constant matters most: **the bit budget is fixed, so quality is whatever
is left after the picture has paid for its detail.**

| | NTSC (525/60) | PAL (625/50) |
|---|---|---|
| Raster | 720 × 480 | 720 × 576 |
| Rate | 29.97 frames, 59.94 fields | 25 frames, 50 fields |
| Chroma | **4:1:1**, a quarter of horizontal colour resolution | **4:2:0**, half horizontal and half vertical |
| Pixel aspect, 4:3 | 10:11 | 12:11 (verify both against 704-wide active) |
| Field order | bottom field first | bottom field first |

How it works (verify each step against the standard and FFmpeg's `dvenc.c`):

- The frame is split into 8×8 DCT blocks. A *macroblock* is four luma blocks
  plus one Cb and one Cr: 32×8 luma pixels in 4:1:1, 16×16 in 4:2:0.
- **Five macroblocks make a video segment.** They are *shuffled* from five
  separate places across the frame, and each segment must fit a fixed number
  of bytes. A detailed area therefore takes bits from four unrelated places
  elsewhere in the picture. This is why DV quality is fairly even across the
  frame, and why it gets worse everywhere at once when the frame is busy.
- Each block chooses between an 8-8 DCT and a **2-4-8 DCT**. The 2-4-8 form
  handles a block whose two fields differ (interlaced motion) by coding their
  sum and difference separately.
- Each block is put in one of four classes by its activity. Each macroblock
  gets a quantisation number chosen so its segment fits. Higher frequencies
  are quantised more coarsely, by area.

What that produces, and what to model:

- **Blocking**: 8×8 boundaries in flat gradients, most visible in skies and
  skin at the edge of the budget.
- **Mosquito noise**: ringing around high-contrast edges, especially the
  sharpened ones.
- **Chroma bleed**, worst in NTSC 4:1:1: red text and red edges smear four
  pixels sideways. PAL 4:2:0 instead smears colour vertically, across fields
  (verify the chroma siting).
- **The low-light collapse**: gain noise is detail as far as the codec is
  concerned, so a dark gained-up room blocks far worse than a bright one.
  This is a causal link, not a coincidence. It must come out of the model:
  noise in, coarser quantisation out.

**Model the codec rather than imitating it.** A real 8×8 DCT, quantisation
and inverse DCT run comfortably in fragment shaders. The hard part on a GPU is
rate control, because choosing a quantiser per macroblock needs to know the
segment's total cost. A workable plan:

1. One pass computes the DCT coefficients.
2. A second estimates, for each macroblock, the bit cost at each quantisation
   number from its coefficients.
3. A third picks the finest quantiser at which each segment of five fits.
4. A fourth quantises and inverts.

An approximate cost model is acceptable if it is calibrated against the real
encoder and the README says it is approximate.

**You have a luxury FILMBOX never had: the real thing to compare against.**
FFmpeg's `dvvideo` encoder is bundled with the app already, through
`ffmpeg-static`. Encode the same pre-codec frame with it, decode it, and
compare. Use that in the smoke test (below). Also offer **a real DV file as an
export format**: 720×480 or 720×576, `dvvideo`, interlaced, bottom field
first, PCM audio. Editors can then cut the output as DV, and the codec in the
file is the codec in the file.

### The tape

- **MiniDV tape** runs at 18.81 mm/s in SP and 12.56 mm/s in LP. LP has
  narrower tracks and more errors, and plays back badly on other decks. The
  head drum turns at 9000 rpm, laying 10 tracks per frame in NTSC and 12 in
  PAL (verify all four figures).
- **Dropouts are digital, not analogue.** A damaged track loses DIF blocks,
  and the decoder *conceals* the loss by substituting macroblocks, usually
  from the previous frame. So a DV dropout is:
  - rectangles of the frame frozen or misplaced on the block grid;
  - sometimes grey or green blocks;
  - at worst, a whole frozen frame with the audio muted.

  It is never a horizontal streak; that is VHS, which is CRTBOX's.
- **Head clog** freezes or mosaics the whole picture until the heads clean
  themselves.
- **Recording breaks.** Each press of REC starts a new shot. A DV camera backs
  the tape up slightly before recording so cuts are seamless: a hard cut with
  continuous timecode. Recording over an unrecorded gap breaks the timecode.
- **Digital8** is the same DV stream on Hi8 tape, and behaves the same once
  decoded.

### The display: overlays have a path, and the path is the point

This is the section the user asked about by name, and it has the structural
idea that FILMBOX's gate dirt and film dirt had. **Overlays are not one thing.
Where an overlay enters the chain decides what the chain does to it.**

1. **The viewfinder and LCD display.**
   - What it shows:
     - REC or STBY, often with a red dot;
     - the tape counter or the minutes remaining;
     - the battery icon with its bars or minutes;
     - the zoom bar running W to T, and the digital zoom readout;
     - SP or LP, 12-bit or 16-bit, 16:9;
     - focus and exposure icons;
     - warnings, blinking.
   - **None of it is ever recorded to DV tape.** It appears only on the
     camera's screen, and on its AV output when the display-output setting is
     on.
   - Footage "with the REC overlay" is therefore one of three things:
     - the AV output recorded or captured with the display on;
     - a screen filmed by another camera;
     - a later imitation, the found-footage convention.

   Default to the AV-output path and label it honestly.
2. **Date imprint, burned in.** Many analogue camcorders (8mm, Hi8, VHS-C) had
   a character generator that mixed the date and time into the picture
   *before* recording. It went to tape with everything else, so it carries
   the tape's softness and chroma smear. On DV cameras, burned-in text was
   mostly the title-superimpose feature (verify which models imprinted the
   date).
3. **Data code at playback.** DV records the date, time and camera settings
   (shutter, aperture, gain, white balance) as metadata in the subcode. The
   camera or deck draws them over the *decoded* picture when the data-code
   display is on. That drawing is crisp, on top of the blocks rather than
   under them. If that playback is then dubbed or captured through analogue,
   the overlay is softened along with the picture.

So the overlay layer needs an *insertion point*:

- **before the codec**: it gets DCT ringing around every glyph edge, and
  coloured text bleeds sideways in 4:1:1;
- **after decode**: clean edges over blocky picture;
- **on the display**: sharp, on the display's own pixel grid.

Each then passes through whatever follows. A test can tell them apart (below),
and so can a viewer, even one who could not tell you why.

**The overlay clocks are a model, not a string.**

- **The date and time** is wall-clock time. It advances in real time while
  recording and *jumps* at every recording break, because time passed between
  shots. A camera whose clock was never set shows its factory default or a
  blank (verify per maker); that is a good preset.
- **The tape counter or timecode** is tape position. It runs continuously
  across breaks, because the tape is continuous.
- **The battery** drains over the session, blinks when low, and at the end
  the camera stops recording. That is a cut, not a fade.
- Date formats were regional: `JAN 15 2003`, `15.1.2003`, `2003 1 15`, with
  `12:34:56 PM` or 24-hour time. Provide all three.

**The OSD font.** These were character-generator bitmap fonts:

- small cells at a lower pixel clock than the video, so glyph pixels are wide;
- white or yellow, with a black edge or drop shadow so they read on any
  picture;
- placed in fixed safe-area positions.

**Draw an original font in that style.** Do not lift glyphs, layouts or logos
from any manufacturer's firmware, manual or screen. The same goes for format
logos. Presets describe the object, not the brand: "a single-chip MiniDV
palmcorder, 2002", not a model number.

### Delivery: how it reached the screen

How the footage was watched is a stage of its own, and most "camcorder
looks" are really this stage. It ships inert like everything else.

- **FireWire capture** is bit-exact: identity.
- **Analogue capture** goes through S-Video or composite into a capture card or
  a DVD recorder. This is where CRTBOX's composite chain comes in: dot crawl,
  chroma delay, a softer picture, and everything on top of it, overlays
  included, degraded together.
- **Deinterlacing**, chosen by whatever played or converted it:
  - *weave* keeps both fields and shows combing ("mice teeth") on motion;
  - *bob* doubles each field and makes thin lines twitter;
  - *blend* ghosts;
  - *discard one field* halves vertical resolution, which is the early
    web-video look.

  A CRT shows fields in sequence and is smooth. Hand that case to CRTBOX
  rather than re-implementing it.
- **Scaling** from the SD raster to a modern screen, honouring the pixel
  aspect. Nearest, bilinear and good resampling look very different at 1080p.
- **The 2006 upload**: 320×240, one field discarded, a second lossy codec on
  top of DV's, 15 fps or so. This is FILMBOX's print generations translated:
  a found tape, captured badly, re-encoded, is a chain of generations.

### Sound: do not treat this as an afterthought

CRTBOX's flyback whine and FILMBOX's projector clatter were the two most
evocative sounds in their apps. The camcorder's equivalents are the zoom motor
and the automatic gain control.

- **DV audio**: 48 kHz 16-bit stereo, or **32 kHz 12-bit with four
  channels**, using a non-linear 12-bit encoding (verify the companding curve
  in IEC 61834). Many consumer cameras shipped set to 12-bit, so a great deal
  of real footage is band-limited to about 15 kHz with a specific
  quantisation texture.
- **The built-in microphone sits on the camera body.** It hears:
  - the tape transport's whine, the head drum and capstan, at a frequency
    locked to the frame rate;
  - the **zoom motor** whirring whenever the rocker is pressed;
  - autofocus motor ticks;
  - fingers on the body;
  - the REC button's clunk at the start of a shot;
  - wind, and the wind-cut filter's thinning when it is on.
- **Automatic gain control** pumps: loud sounds duck everything, and in quiet
  passages the noise floor and room tone *rise* (breathing). Model it with
  attack, release and a maximum gain, not as compression.
- **Dropouts mute or repeat a short block of audio** at the same moment the
  picture conceals. Recording breaks cut the audio dead, with a click.
- **The camera always has audio.** Even when the source is silent, the camera
  hears its own transport. FILMBOX had to add a silent fallback for clips
  without an audio track. In CAMAI that fallback is not silent: it is the
  camera.

### Link picture and sound

The A/V Link section is what makes each app one object rather than two
effects. Carry it over with the camcorder's own couplings, and only physical
ones; do not invent a link that the real machine did not have.

- **The zoom**: one parameter drives the picture's field of view, the shake
  magnification and the EIS margin. Its *velocity* drives the zoom motor's
  whine. The timeline animates the first, and the second follows.
- **Autofocus hunting** in the picture is the focus motor ticking in the
  audio: the same events.
- **A recording break** is three things at once: the cut, the REC-button
  clunk and audio cut, and the overlay clock's jump.
- **A tape dropout** conceals picture blocks and mutes audio at the same
  moment, from the same damaged track.
- **A handling bump** is a shake impulse and a thump.
- **The transport whine** is locked to the frame rate, as the projector was
  in FILMBOX.

---

## Architecture to reuse

Most of this exists already in FILMBOX and is tested. Read it before
designing anything.

**`src/core/params.ts`, schema-driven everything.** Each parameter is one
entry: key, label, type, range, default, unit, hint, advanced flag, group and
group kind. The settings UI, uniforms, presets, CLI flags, randomiser and
keyframes are all generated from it. FILMBOX has 197 parameters and CRTBOX
about 260, and neither app's UI code grew with them. **Keep this.**

**Engine masters folded into section switches.** FILMBOX has Stock, Lens and
Gate masters. `applyEngineMasters` folds them into the individual section
switches before either renderer sees them, so the two backends cannot
disagree. CAMAI's natural split:

- **Camera**: operator, lens, sensor, automatics, DSP;
- **Tape**: chroma subsampling, interlace, codec, tape errors;
- **Display**: overlays, delivery, deinterlacing, scaling.

Decide which section owns anything shared before naming the masters (see
lesson 24).

**The frame clock, `src/film/clock.ts`.** It turns output time into film
frames, a capture time for each *field*, and events. It already handles two
fields per output frame drawn from different source moments, because 3:2
pulldown needed exactly that. Interlace is the same machinery at a different
cadence: two fields per frame, each its own capture time, bottom first. Read
it closely; it is most of what the interlace engine needs.

**Source slots tagged by capture time, `src/video/sources.ts`.** The renderer
holds decoded source frames tagged by the moment they show and evicts the one
furthest from the newest. Exports seek the decoder to each field's exact
capture time (`prepareFrames` in `App.tsx`).

**The shared event clock, `public/worklets/film-events.js`.** This is a plain
JavaScript module imported both by the TypeScript renderer and by the
AudioWorklet. Splices, flicker and weave are computed once from integer
hashes, so picture and sound agree exactly. Recording breaks, dropouts,
bumps, AF hunts and battery events belong in the CAMAI equivalent.

**Two render backends behind one interface, `src/video/backend.ts`.** WebGL2,
plus a pure-JavaScript CPU renderer that mirrors every pass and is checked
against it. The DCT and the rate control must exist in both. They are
deterministic integer-friendly maths, which makes agreement achievable.

**Native-raster rendering.** Render the camera into the DV raster (720×480
or 720×576), run the codec and the tape at that raster, and only then scale to
the output frame with the right pixel aspect. FILMBOX learned the same rule as
"physical units": artefacts are sized in the medium, not on the screen. An
8×8 block is 8×8 in the DV raster and about 18×18 on a 1080p output.

**One output-shape function, `src/core/output.ts`.** `frameAspect` and
`outputSize` are used by both the preview and the export. The rendered frame
is always the shape of the picture, with no bars baked in. Camcorder footage
adds 4:3, cropped-and-stretched 16:9 (most consumer cameras made 16:9 by
cropping a 4:3 sensor), and pixel aspect ratio.

**`src/core/help.ts` and `scripts/check-help.mjs`.**
- Every parameter, section and preset has written help.
- The build fails if any is missing or too short to be saying anything.
- In FILMBOX the same check also validates the presets against the schema and
  confirms the generated `docs/PRESETS.md` is current (`scripts/docs.mjs`).

**The probe, `src/testing/probe.ts`.** `window.__filmbox.renderProbe` renders
synthetic sources through the real renderer, of either kind, at chosen output
frames, and returns pixels. It was the most useful tool in the FILMBOX build.
Every physics claim was proven with it. CAMAI's synthetic sources:

- a point light (smear);
- a zone plate (moiré, sharpening, aliasing);
- an edge (overshoot halos);
- red text (chroma bleed);
- a moving bar (field order and combing);
- a noise patch (bit starvation);
- a field counter (which source moment each field shows);
- the drawn outdoor scene (`drawScene`), plus an interior under tungsten light.

**The rest:**
- **The keyframe timeline** (`src/core/timeline.ts`, `src/ui/Timeline.tsx`).
  Numbers interpolate and enums hold. The zoom lives here.
- **The startup guide**, reopened with F1.
- **`scripts/shots.mjs`**: every preset rendered over the test scene.
- **`scripts/bench.mjs`**: both backends, with the honest note that a
  container has no GPU.
- **Packaging**: Electron and electron-builder, NSIS one-click plus a portable
  exe, `.github/workflows/ci.yml`, and `.github/workflows/windows.yml`, which
  builds on a Windows runner on a `v*` tag.
- **The README's "Honest notes"** section.

---

## Lessons already paid for

From CRTBOX:

1. **`texSubImage2D` from a `<video>` silently writes nothing.** The texture
   keeps its old contents and `glGetError` is clean. Use `texImage2D`.
2. **Hand-rolled path-to-URL conversion breaks on Windows** (`C:` becomes
   `C%3A`). Use `pathToFileURL`, or better, read the bytes into a blob URL.
3. **Seeking resets things you did not mean to reset.** Exporting is seeking,
   frame by frame. CAMAI's accumulators need the same care: AE, AWB and AF
   state, AGC envelope, EIS position, slow-shutter field memory and dropout
   concealment's previous frame.
4. **The export frame must be the shape you asked for.** One shared function,
   or 4:3 comes out 16:9 with bars baked in.
5. **`gl_FragCoord` is the pixel centre, origin bottom-left.** A CPU mirror
   using integer top-left indices is half a pixel out in x and flipped in y.
   For a block codec this is fatal: the 8×8 grid must start on the same pixel
   in both backends.
6. **A parameter can exist in the schema and never reach the shader.** Test
   that each section changes the picture.
7. **Fixed `sleep()` in a browser test is a flaky test.** Poll for the
   condition.
8. **`pkill -f "scripts/smoke.mjs"` matches its own shell.**

From FILMBOX:

9. **Evict cached source frames by distance, not by age.** With least recently
   used eviction, a pulldown frame that needed two film frames lost the older
   one and showed a stale field. Interlace needs two capture moments per frame
   all the time. Tag source frames by capture time and evict the one furthest
   from the frame being built.
10. **Size artefacts in the medium, not as a fraction of the screen.** Gate
    dirt specified as screen fractions came out sub-pixel at some outputs and
    huge at others. DCT blocks, chroma cells, OSD glyphs, smear width, noise
    grain: all in sensor or DV-raster units, converted once.
11. **Apply effects in the order the real chain does.** Dirt added before dye
    fading came out the wrong colour. The camcorder's order is not negotiable:
    1. gain noise before sharpening;
    2. sharpening before the codec;
    3. imprinted text before the codec, playback text after decode;
    4. concealment after decode;
    5. analogue capture after all of it.
12. **A single event can fool a statistic.** Grain σ was inflated by one dust
    speck until the measure became a median of neighbour differences. Measure
    blocking as a ratio of gradients at block boundaries to gradients inside
    blocks, robustly, or a scene edge on the grid will read as blocking.
13. **Do not run screenshots or benchmarks alongside the smoke test.**
    Contention made timing-sensitive stages fail for reasons unrelated to the
    thing under test.
14. **The live app must not re-render when nothing changed.** An open page
    re-rendering constantly starved the test page. Skip unchanged frames.
15. **Every export has a soundtrack.** A clip without an audio track exported
    without one until an offline fallback was added. For CAMAI the fallback is
    the camera's own transport and room, as above.
16. **Hash with integers when two runtimes must agree.** The event clock uses
    `Math.imul`, so the AudioWorklet and the renderer compute identical events.
    Floating-point hashes drift between GLSL and JavaScript.
17. **"Off" must be exactly off.** FILMBOX's telecine black point applied even
    with the telecine disabled until it was gated. A purity stage asserts that
    with every section off, output equals input. Keep it, and expect it to
    catch something.
18. **The schema clamps silently, so a test can measure something it did not
    ask for.** An overscan of −0.3 was clamped to −0.2 and the test measured
    the clamped value. Presets report out-of-range values (`PRESET_PROBLEMS`);
    make the probe do the same.
19. **Know where your tools write before you read their output.** A screenshot
    run wrote to the repository root and stale images were misread as current.
20. **The decoder's `<video>` element can show beside the canvas.** FILMBOX
    covers it (`.stage-cover`).
21. **Windows' Task Manager shows an executable's FileDescription as its
    name**, and electron-builder fills it from the package description. Keep
    the packaged description short (`extraMetadata.description`).
22. **Building the Windows installer from Linux works under Wine**, with care:
    - Wine needs 32-bit support, because the NSIS step runs the installer it
      has just built.
    - `ffmpeg-static` must hold the Windows binary
      (`npm_config_platform=win32`), not the Linux one, because the whole
      package is bundled.
    - Chromium's renderer does not start under Wine, so a Windows build cannot
      render there. Install, uninstall, shortcuts, version resource and the
      main process can be checked; rendering cannot.

    Say so. The Windows workflow on a real runner is the proper build.
23. **A probe that measures a sensible-looking wrong thing is worse than no
    probe.** FILMBOX's latitude test first measured display clipping rather
    than film clipping, because the transfer's white point clipped first. When
    a result agrees with the hypothesis suspiciously well, check what else
    could produce it.
24. **A master switch must cover exactly what its name says.** FILMBOX's Lens
    master also switched off Exposure: its help text said so, its name did
    not. A test that turned the lens off then got a different exposure and
    measured the wrong thing. Put shared controls where their name belongs.

---

## How to test this

Keep FILMBOX's smoke test structure: a Playwright script driving the real UI
and the real renderers, asserting *emergent behaviour* rather than pixel
equality, and loading over `file://` as the packaged build does. FILMBOX's
fourteen stages carry over: mount, picture, video, audio, keyframes,
framing, purity, packaged, sections, guide, physics, cpu, masters and export.
Its physics stage is the template.

Camcorder artefacts are at least as measurable as film's, and this time there
is a real codec to compare against:

- **The field clock.** Render a moving bar from a 60p source. Assert that the
  even and odd lines of one output frame show the bar at two positions one
  field apart, and that the bottom field is the earlier one for DV.
- **Deinterlacing.** Weave shows combing on motion and none on a still
  frame. Bob shows none. Discard halves vertical resolution.
- **DCT blocking.** Boundary-to-interior gradient ratio above 1 at multiples
  of 8 in the DV raster, a period in the output of 8 × the scale, and a ratio
  of 1 with the codec off.
- **The constant bit budget.** The same scene with gain noise added shows
  coarser quantisation everywhere, including in areas the noise barely
  touched. That is the shared budget, proven from the output.
- **Against the real codec.** Encode the same pre-codec frame with FFmpeg's
  `dvvideo`, decode it, and assert that the emulation's blocking ratio and
  high-frequency loss fall within a stated tolerance of the real thing.
  Report the numbers either way.
- **Chroma subsampling.** A thin red vertical line spreads about four luma
  pixels sideways in NTSC 4:1:1 and about two in PAL 4:2:0, and in PAL also
  vertically.
- **Detail enhancement.** An edge overshoots: the output exceeds both
  plateaus beside it. With coring on, low-level noise is not amplified.
- **Smear vs rolling shutter.** A point light gives a vertical column of
  roughly constant brightness down the frame on a CCD preset, and none on a
  CMOS one. A fast pan skews verticals on CMOS and not on CCD.
- **Knee and clip.** A ramp shows a straight segment, a knee and a hard
  clip. On a single-chip preset the channels clip at different exposures.
- **Overlay insertion point.** Red text imprinted before the codec shows
  sideways chroma spread and ringing around its glyphs. The same text added
  after decode has neither. Both soften under analogue capture.
- **The overlay clocks.** The timestamp advances in real time. At a
  recording break the wall clock jumps and the tape counter does not.
- **Dropouts.** A dropout region equals the previous frame exactly, on the
  macroblock grid, and the audio is muted for the same span.
- **The A/V link.** Zoom keyframes produce motor whine energy only while the
  zoom moves. A recording break produces a cut, a click and a clock jump at
  the same output frame.
- **Audio.** 12-bit mode measurably band-limits near 16 kHz (the 32 kHz
  Nyquist limit). AGC raises the noise floor in a quiet passage.
- **Purity, both backends, masters and export**, as in FILMBOX. The export
  stage should also check that a DV export is genuinely DV: `ffprobe` reports
  `dvvideo`, the raster, and bottom-field-first.

---

## Working practices that mattered

- **Measure, do not assume.** Both earlier builds had confident diagnoses that
  were wrong. When a measurement looks surprising, suspect the measurement
  first.
- **Say what you did not verify.** FILMBOX's README says plainly which stock
  figures are approximations and that its Windows installer was built under
  Wine and never ran a render there. CAMAI's codec model will be approximate
  somewhere: say where, with the numbers from the comparison against the real
  encoder.
- **New sections ship inert.** Defaults are neutral and off; character goes in
  the presets.
- **Presets are specific objects in specific states.** Each is one machine,
  one year, one situation. Some to start from:
  - *Christmas morning, 2002*: a single-chip MiniDV palmcorder under tungsten,
    AWB gone orange, gain up, 12-bit audio, the LCD display on the AV output.
  - *Skate video, 2001*: a three-chip DV camera with a fisheye adapter, a fast
    shutter in sun, heavy detail enhancement.
  - *Wedding reception, LP mode, 2004*: low light, dancing that combs,
    dropouts and AGC breathing.
  - *Holiday, 1997*: Hi8 with the date imprinted (needs the analogue tape
    passes; a later milestone).
  - *Night mode in the woods*: infrared, the hot spot, the green, the breathing
    room tone.
  - *Found tape, captured in 2006*: DV, then composite capture, one field
    dropped, 320×240 and re-encoded.
  - *The camera whose clock was never set*.

  "Camcorder 60%" is not a preset.
- **Commit messages carry the reasoning**, especially why something was not
  done the obvious way.
- **Know your tools.** FFmpeg can make DV, so use it as ground truth. The
  probe can see pixels, so prove physics with it rather than describing it.

---

## Suggested order

1. Bring FILMBOX in (above). Get it building, run `npm test`, and read
   `src/core/params.ts`, `src/film/clock.ts`, `src/video/renderer.ts`,
   `src/testing/probe.ts` and `scripts/smoke.mjs`.
2. Strip the film-specific passes and parameters; keep the apparatus.
3. Build the field clock: 59.94 and 50 fields, bottom first, each with its own
   source moment. Prove it with the moving-bar stage before anything else is
   built on it.
4. Build the **Tape** engine's codec in the native raster: chroma
   subsampling, then DCT and quantisation, then rate control. Validate it
   against FFmpeg's `dvvideo` as soon as it exists, not at the end.
5. Build the **Camera** engine: sensor (mosaic, smear, gain noise, knee and
   clip), then DSP (detail enhancement, white balance), then the automatics,
   then the operator and the zoom.
6. Build the **Display** engine: the overlay layer with its three insertion
   points and its clocks, then deinterlacing, scaling and delivery.
7. Rebuild the audio chain: microphone on the body, transport, motors, AGC,
   12-bit and 16-bit DV audio, dropouts. Wire the A/V link through the event
   clock.
8. Presets as specific objects; help for every parameter, with the check
   enforcing it; `docs/PRESETS.md` generated.
9. Smoke stages for everything above.
10. Package and release: the Windows workflow on a tag, and a DV file as an
    export format.

One NTSC single-chip MiniDV palmcorder from 2002 end to end is the first
milestone:

- fields, codec, sharpening and smear;
- the LCD display with its battery and REC;
- the date that jumps at each break;
- the zoom you can hear.

That is better than every format half done. The analogue camcorders and the
MPEG-2 ones come after it.
