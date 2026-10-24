# CRTBOX

**Cathode-ray television emulation for picture *and* sound.**

A real-time CRT emulator that runs in a browser and ships as a standalone desktop
application. Load a video, get a television: curved glass, phosphor mask, blooming
scanlines, convergence error, a hum bar drifting up the screen — and a soundtrack that has
been through a 6 cm paper cone in a plastic box, with mains hum, flyback whine and the
crackle of a corroded connector.

Modelled on the shape of [ntsc-rs](https://ntsc.rs/), which emulates the *signal*.
CRTBOX emulates the *display*, and the machine the display was part of.

📄 **[Read the design brief](docs/BRIEF.md)** — what a CRT actually looks like, how to make
audio sound like a television, and why picture and sound have to be coupled.

---

## The idea

Every other tool in this space treats picture and sound as two unrelated effects that happen
to be applied to the same file. A television is one machine: the picture and the sound share
a chassis, a mains transformer, an aerial and a high-tension rail. When the mains ripples, a
bright bar crosses the screen *and* a hum appears in the speaker — because they are the same
ripple. When the audio stage draws current on a loud passage, the picture dims.

CRTBOX has an **A/V Link** section that makes those couplings explicit and adjustable. It is
the reason the app exists.

---

## Features

### Picture — ten stages, in the order the light meets them

| | |
|---|---|
| **Picture Controls** | Brightness, contrast, colour, tint, sharpness — the knobs on the front of the set — plus the source reconstruction filter used when rendering above the source resolution |
| **Colour** | White-balance temperature and green/magenta, per-gun RGB gain and cutoff, hue rotation, saturation, vibrance, chroma crush, **colour killer** (a weak signal goes monochrome, as a real decoder did) and chroma overload that bleeds into luma |
| **Signal & Reception** | RF / composite / S-Video / component paths, luma and chroma bandwidth, chroma delay, dot crawl, cross-colour rainbows, ringing, multipath ghosting, snow, adjacent-channel herringbone |
| **Sync & Timebase** | Horizontal jitter with a coherence control, line tearing, flagging, head-switch band, vertical roll and hold instability, timebase wobble |
| **Tube Geometry** | Curvature, corner radius, overscan, H/V size and position, pincushion, trapezoid, yoke rotation |
| **Beam & Scanlines** | 240p / 480i / off, beam width and profile, **beam blooming** (bright lines are physically fatter), interlace flicker |
| **Phosphor & Mask** | Aperture grille, slot mask, shadow-mask triads; pitch, strength, stagger; per-channel persistence with a green-biased tilt; P22 gamut bend |
| **Halation & Bloom** | Separate tight bloom and wide *warm* halation, glass diffusion, vignette, room glare |
| **Convergence & Focus** | Per-gun RGB offsets, radial error that grows toward the corners, centre and edge defocus |
| **Tube Response** | CRT gamma, black crush, white clip, drifting hum bar, AGC pumping, PSU sag, flicker |
| **Faults & Wear** | Burn-in accumulation, dust and smears, moiré, degauss button, warm-up and power-off animation |
| **Glitching** | Discrete failures on an event clock: tape dropout streaks, line repeat, sync slip, chroma bursts, macroblock corruption with colour error, bit crush and polarity flips. One **Event rate** control silences the whole section |

### Sound — the other half

| | |
|---|---|
| **Audio Source** | Mono collapse (partial or total), left / right / **difference channel** (the MTS subcarrier alone — centre-panned dialogue vanishes), NTSC/PAL region |
| **Tape Transport** | True pitch modulation via a modulated fractional delay: wow, flutter, random drift, scrape flutter, Poisson dropouts with edge clicks |
| **Speaker & Enclosure** | Band limits with selectable slopes, box resonance, cone honk, cancellation notch, a **synthesised small-box impulse response** with a size control, level-dependent cone breakup, off-axis loss, through-the-wall macro, room tail |
| **Broadcast Processing** | Compression with audible pumping, three saturation models (tape / transformer / output stage), limiter |
| **Noise Bed** | Mains hum modelled as ground loop *and* transformer (odd vs. even harmonics), **flyback whine at 15.734 / 15.625 kHz** with partials and an optional octave-down shift, tape hiss with companding breathing, RF static, mechanical rumble |
| **Crackle & Contact Faults** | Poisson events with power-law amplitudes, randomised tone per click, and a burst process for arcing joints |
| **A/V Link** | Hum bar ↔ hum, signal loss ↔ static, audio → brightness and bloom, picture glitch → dropout, degauss → thump, power state → audio |

### Two engines, one signal path

CRTBOX models two different things, and runs both on every frame in the order
they happened in reality.

| Tab | Models | Highlights |
|---|---|---|
| **Tape** | The signal, and the videotape it was recorded on | Composite encode/decode at a 227.5 cycle subcarrier, box / notch / 1-line / 2-line comb demodulation, scanline phase shift, SP/LP/EP tape bandwidths, chroma loss, output sharpen, edge wave, head switching and tracking noise |
| **Tube** | The display, and the room it is in | Beam reconstruction with blooming, aperture grille / slot / shadow masks, P22 persistence and gamut, halation, convergence, CRT gamma, hum bar, burn-in, glitching |

A signal was damaged on its way to the television, and then the television
displayed it badly, so both run in that order on every frame. Each tab carries
a **master switch** that bypasses its whole engine in one click — a bypassed
engine is struck through on its tab — and each section inside has its own
enable switch as well.

**Almost nothing in the Tape tab is drawn on.** Chroma really is modulated onto
a subcarrier, band-limited, and separated out again. Dot crawl, rainbow
cross-colour and comb fringing are what fall out of doing that honestly, which
is why changing the demodulation filter changes so much: on a greyscale stripe
pattern, box demodulation leaves about 2.6× the false colour a 2-line comb
does, and at a 180° scanline phase shift the dot pattern inverts every frame
instead of standing still. Both are asserted by the smoke test.

### Two renderers

The chain can be rasterised two ways, chosen with the **Auto / GPU / CPU**
toggle in the header. Under Auto, a dot marks which backend actually won.

| | |
|---|---|
| **GPU** | WebGL2. The chain is a handful of full-screen draws, which is what graphics hardware is for. Use it whenever it exists. |
| **CPU** | Plain JavaScript on a 2D canvas. Needs no GPU at all. |

**Auto** tries the GPU and falls back rather than failing, which matters more
than it sounds: the app previously refused to start at all where WebGL2 was
missing, blacklisted by a driver or disabled by policy. The CPU path also gives
bit-identical output on every machine, where GPU floating point varies between
vendors — so a render that has to be reproducible has a way to be.

It is much slower, and always will be. `npm run bench` prints both; in a
container with no GPU at all the CPU backend is about 5× slower than
SwiftShader, which is itself a software rasteriser, so the gap against real
hardware is far wider. It is a fallback, not a default.

Both produce the same picture, and the smoke test asserts it: mean brightness
within a point or two, with the remaining per-pixel difference accounted for by
the composite subcarrier phase, which depends on the frame counter at the
moment of capture.

### Finding your way around

The app opens on a **guide** covering how to get footage in, what each reference
tube is for, and how to build and animate a look. Close it with Esc or the ✕;
tick *Don't show this when CRTBOX opens* if you don't want it again. The
**Guide** button in the header, or <kbd>F1</kbd>, brings it back at any time.

Every parameter is shown by default, fine detail included; untick **Advanced**
in the header if you want the shorter list, and that preference is remembered.

Every parameter and every section carries an **ⓘ**. It opens an inline panel
explaining what the control physically is, what each end of its range looks
like, and when to reach for it, along with the range, the default and the
parameter's key for scripting. Section explainers also give the practical
advice — which two or three controls in that section actually matter.

That help is a single source of truth in `src/core/help.ts`, and
`npm run help:check` fails the build if a parameter exists without an
explanation, so no control can ship undocumented.

### Timeline & keyframes

Every one of the ~160 parameters can be animated over time, which is what turns
a look into a cut.

- Click the **◷** beside any parameter to start animating it. Arming seeds a
  keyframe holding the current value, so switching it on never changes the
  picture.
- Scrub, change the value, and a keyframe is written at the playhead — the same
  rule After Effects and Premiere use.
- Drag the diamonds to retime, click to select, <kbd>Del</kbd> to remove,
  <kbd>,</kbd> / <kbd>.</kbd> to jump between them.
- Per-keyframe easing: **Linear**, **Ease in/out/in-out**, and **Hold** — hold is
  the one that cuts rather than fades, and it is drawn as a square so you can see
  at a glance where the hard transitions are.
- Numbers interpolate; enums and switches hold, because there is no value half
  way between a slot mask and an aperture grille.
- Animation is carried in the preset JSON, applies to the live preview and to
  every export path, and drives the **audio** chain as well — a keyframed
  dropout, hum swell or signal loss lands in the exported soundtrack, not just
  the picture.

Still images get a real transport too, so a photograph can be scrubbed,
keyframed and rendered out as a clip.

### Workflow

- Drag and drop, or a real file dialog in the desktop build
- Draggable split preview against the untouched source
- Ten built-in presets, from a calibrated studio monitor to a set that is actively failing
- Copy/paste settings as JSON; save and load `.crtbox.json` presets
- Seeded randomiser with an *amount* control, scoped to the tab you are looking at
- Per-group bypass and per-group reset
- Keyboard: <kbd>Space</kbd> play/pause, <kbd>D</kbd> degauss, <kbd>R</kbd> randomise, <kbd>,</kbd>/<kbd>.</kbd> previous/next keyframe, <kbd>Del</kbd> remove the selected keyframe

### Export

| Target | Browser | Desktop |
|---|:---:|:---:|
| H.264 / HEVC `.mp4` with processed audio | — | ✅ |
| ProRes 422 HQ `.mov` with PCM audio | — | ✅ |
| Animated GIF (palette-optimised) | — | ✅ |
| WebM (VP9 + Opus), real-time capture | ✅ | ✅ |
| PNG sequence + WAV + settings, zipped | ✅ | ✅ |
| WAV only (offline audio render) | ✅ | ✅ |
| Single frame PNG | ✅ | ✅ |

The `.mp4` / `.mov` / GIF paths render **deterministically** — the video is seeked frame by
frame and the renderer stepped with a fixed `dt`, so nothing is ever dropped, and the audio
is rendered offline through the identical DSP chain and muxed by a bundled ffmpeg.

---

## Get it (Windows)

Go to **[Releases](../../releases/latest)** and pick one:

| | |
|---|---|
| **`CRTBOX-…-Setup.exe`** | Double-click. It installs itself with no wizard, puts a shortcut on your desktop and in the Start Menu, and opens. Nothing to configure. |
| **`CRTBOX-…-Portable.exe`** | One file. Double-click and the app opens. Nothing is installed and nothing is left behind. |

Either way it is a single click to run. The app is not code-signed, so the first
time you open it Windows shows **"Windows protected your PC"** — click
**More info → Run anyway**. That warning is SmartScreen not recognising an
unsigned publisher, and it stops appearing afterwards.

Once installed you can also right-click any video and choose **Open with →
CRTBOX**, or drag a file onto the app icon.

### macOS and Linux

`.dmg`, `.AppImage` and `.deb` builds come from the same configuration:

```bash
npm install
npm run dist:mac      # or dist:linux
```

### Building the Windows app yourself

```bash
npm install
npm run dist:win      # -> release/CRTBOX-<version>-Setup.exe
                      #    release/CRTBOX-<version>-Portable.exe
```

**Run this on Windows.** Two things break otherwise: editing the exe's icon and
version resources needs native tooling (or wine), and `ffmpeg-static` installs
the binary for whatever platform npm ran on — building on Linux quietly ships a
Linux `ffmpeg` inside a Windows app, which removes the .mp4/.mov/GIF export
targets at runtime. `.github/workflows/windows.yml` builds on a Windows runner
and checks for exactly that.

To sanity-check the packaging from any OS (no wine, no installer):

```bash
npm run pack:win      # -> release/win-unpacked/CRTBOX.exe
```

### Web

The same app runs in a browser with no install at all:

```bash
npm install
npm run dev           # http://localhost:5173
npm run build         # static bundle in dist/
```

Needs WebGL2 and AudioWorklet. Any current Chromium, Firefox or Safari will do.
The browser version can export WebM, PNG sequences and WAV; the desktop build
adds .mp4/.mov/GIF through a bundled ffmpeg.

## Command line

The desktop build renders headlessly, so it drops into a batch script:

```bash
crtbox --input clip.mp4 --output clip-crt.mp4 --preset failing

crtbox --input clip.mp4 --output out.mov \
       --format prores --fps 24 --resolution 1080p \
       --tube.humBar 0.45 --noise.flybackLevel -34 --audio.channelMode side
```

Every one of the ~160 effect parameters is addressable as `--<group>.<param>`, using exactly
the keys that appear in exported preset JSON. `crtbox --help` lists the rest.

---

## Output framing and upscaling

**The frame is the shape of the tube.** Whatever you pick under Tube Geometry ▸
Aspect is the aspect ratio of the exported file — a 16:9 source rendered as a
4:3 set comes out 4:3, not 16:9 with the picture floating in the middle. The
preview canvas is sized the same way, so if you see no black bars there are
none in the file.

**Resolution** sets the output height; the width follows from the aspect. Height
is what is preserved rather than width, because line count, mask pitch and
scanline structure are all vertical.

| Source | Aspect | Resolution | File |
|---|---|---|---|
| 1920×1080 | 4:3 | Match source | 1440×1080 |
| 1920×1080 | 16:9 | Match source | 1920×1080 |
| 640×480 | 4:3 | 1080p | 1440×1080 (2.25× upscale) |
| 640×480 | 4:3 | 2160p | 2880×2160 (4.5× upscale) |

Upscaling is worth doing here in a way it usually is not. The signal chain runs
at the source resolution, but the tube — scanlines, phosphor mask, bloom,
convergence, curvature — is drawn at the output resolution, so all of that
structure is *generated* crisply rather than stretched. What it cannot do is
invent photographic detail the source never had; a 480p capture at 2160p is a
480p capture rendered on a very good tube.

Picture Controls ▸ **Source sampling** chooses how the source itself is read:
Catmull-Rom bicubic by default, bilinear for the softer classic look, and
nearest for pixel art, where a smooth upscale is simply wrong.

---

## Presets

| id | |
|---|---|
| `reference` | A properly set-up studio monitor on component. Geometry and phosphor only. |
| `livingroom87` | A 21-inch consumer set fed from a VCR. Slot mask, generous overscan, oversaturated. |
| `vhs3rd` | A copy of a copy of a copy. The timebase has given up and the transport is audibly worn. |
| `rebroadcast` | Off-air through an aerial pointing the wrong way. Ghosts, herringbone, creeping static. |
| `failing` | Dry joints and a tired line-output stage. Turn the flyback whine up and leave the room. |
| `portable` | A 5-inch set on top of a fridge. Tiny tube, tiny speaker, mains hum through everything. |
| `cctv` | A monitor that has watched the same corridor for eleven years. Long persistence, heavy burn-in. |
| `arcade` | A well-driven 15 kHz tube: aperture grille, hard 240p lines, clean signal. |
| `transmission` | Something is being broadcast that should not be. |
| `lostsignal` | No lock. Full snow, full roar, and the hum still there underneath. |

---

## Development

```
build/                    generated app icons (npm run icon)
.github/workflows/        CI, and the Windows installer build
src/core/params.ts        the parameter schema — single source of truth for the
                          UI, the shader uniforms, the DSP, presets and CLI flags
src/core/timeline.ts      keyframes: easing, evaluation, editing, serialisation
src/video/                WebGL2 pipeline: signal → persistence → burn-in →
                          bright → bloom/halation → tube
src/video/shaders/        GLSL, one file per pass
src/audio/engine.ts       the Web Audio graph
public/worklets/          AudioWorklet DSP (transport + noise/crackle)
electron/                 desktop shell, ffmpeg encoding, headless batch mode
scripts/smoke.mjs         headless Chromium test: shaders link, picture is lit and
                          has line structure, worklets register and make sound
scripts/shots.mjs         render preset stills for eyeballing
```

```bash
npm run typecheck
npm run build
npm run smoke          # after a build
npm test               # all three
npm run icon           # regenerate build/icon.ico and build/icon.png
```

`tsc` cannot catch a shader that fails to compile or a worklet that fails to register, which
are the two ways this app actually breaks — so the smoke test loads the built bundle in
Chromium, pushes a test pattern through the whole pipeline, and asserts the result is lit,
has contrast, and has measurable horizontal line structure. It has already caught one real
bug that every other check passed.

Adding a parameter means adding one entry to `src/core/params.ts` and reading it wherever it
is consumed. The panel, the preset format and the CLI flag come for free.

## Known limitations

- **Deterministic export preflights itself.** Before committing to a render, one frame is
  decoded and put through the pipeline and both are checked for content. If the decoder
  presents nothing, or the pipeline returns a blank frame, the export fails with an
  explanation instead of quietly writing a black file. On a container with only a software
  rasteriser (`swiftshader`), the tube pass has been observed to return blank at full output
  resolution while rendering correctly at preview resolution — the preflight catches this and
  points you at a smaller render scale or the real-time recorder.
- **Browser video export is real-time capture** via MediaRecorder, so it drops frames if the
  machine cannot keep up. Use the PNG sequence, or the desktop build, for anything going into
  an edit.
- **Offline audio depends on `decodeAudioData`.** Some containers play fine in a `<video>` but
  cannot be decoded for offline rendering. The stage is bounded by a timeout; when it fails
  the picture still exports and the app says the audio was skipped.
- **No plugin builds.** After Effects / Premiere / OpenFX are out of scope — see
  [the brief](docs/BRIEF.md#6-deliberate-non-goals).

## Licence

MIT.
