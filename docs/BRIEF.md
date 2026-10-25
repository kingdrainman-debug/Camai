# FILMBOX — brief for a film-stock and format emulator

*A prompt for a fresh Claude Code session. Paste the whole thing.*

*Written by the session that built CRTBOX (this repository), so the hard-won
parts are included rather than left to be rediscovered.*

---

## What to build

**FILMBOX** — a real-time film emulator for video and stills, covering stocks
and formats rather than televisions: Super 8, Regular 8, 16mm, Super 16, 35mm,
65mm. Picture *and* sound. It ships as a single-click Windows application, a
headless CLI, and a web app.

It is a sibling to **CRTBOX**, which is this repository and which you should
read before writing anything:

```
https://github.com/kingdrainman-debug/Analoguehorrorbox
```

MIT licensed, so you may fork it outright. Doing so is recommended: roughly 70%
of what FILMBOX needs already exists there and is tested. What changes is the
physics, the parameter schema and the presets. What stays is the whole
apparatus around them.

**Do not make a "film grain filter."** Grain overlays and orange LUTs are a
solved, boring problem and there are a thousand of them. The thing worth
building models the *chain*: light hits an emulsion, the emulsion has a
characteristic curve, the film goes through a camera with a bad gate, gets
developed, printed, projected or telecined, and ages badly in a cupboard. Every
artefact should fall out of modelling a step in that chain, not out of a texture
you multiplied on top.

---

## The domain

Treat the following as a starting map, not as gospel — verify the numbers as you
implement them. Film is extremely well documented and the real figures are
findable.

### The emulsion

**The characteristic curve (H&D curve) is the single most important thing.**
Density against log exposure: a *toe* where shadows compress, a long straightish
middle, and a *shoulder* where highlights roll off. This curve, not grain, is
why film looks like film. A highlight that would clip hard on a sensor instead
bends gently into the shoulder and holds detail for another two or three stops.
Model it as a real curve with controllable toe, slope (gamma), shoulder position
and shoulder softness — and give each stock its own.

**Negative vs reversal is a fork, not a slider.**
- *Colour negative* has enormous highlight latitude, crushes nothing, carries an
  orange mask, and must then be printed — so you need a second curve for the
  print stock. The combination is what produces the look.
- *Reversal* (Kodachrome, Ektachrome) is a positive directly, has perhaps a third
  of the latitude, and clips highlights hard and ugly. Most Super 8 was reversal,
  which is a large part of why Super 8 looks the way it does.

**Grain is not noise.** Common mistakes, all worth avoiding:
- It is not additive. Grain is silver crystals; its visibility depends on
  *density*. In a negative the shadows are thin and the grain shows most in the
  midtones and shadows of the resulting positive. Model it as density-dependent.
- It is not per-channel white noise. Each of the three emulsion layers has its
  own grain size and the layers are not correlated. Blue-sensitive layers are
  typically grainiest.
- It clumps. Real grain has structure and a power spectrum, not a flat one.
  Value noise at a couple of octaves beats white noise.
- **It is fixed to the film plane.** Grain does not move with the subject. If the
  gate weaves, the grain weaves *with the gate*, not with the picture. Getting
  this wrong is the fastest way to make it look like a video filter.
- Grain size scales with the *format*, because a smaller negative is enlarged
  more. The same stock in Super 8 and in 35mm gives wildly different apparent
  grain. Derive it rather than exposing it twice.

**Halation** is different from CRTBOX's. Light passes through the emulsion,
reflects off the base, and re-exposes from behind — giving the red-orange bloom
around highlights. It is red-dominant because the anti-halation backing absorbs
unevenly, and stocks without that backing (early stocks, some reversal) glow
spectacularly. CRTBOX's halation pass is a reasonable starting point but the
tint and falloff are not the same.

### The formats

Format drives grain scale, resolution, aspect, frame rate and how bad the
transport is. Get the real dimensions.

| Format | Image area (approx) | Native fps | Character |
|---|---|---|---|
| Regular 8 | 4.5 × 3.3 mm | 16 | Tiniest frame, enormous grain, usually silent |
| **Super 8** | 5.79 × 4.01 mm | 18 (also 24) | Bigger gate than Reg8, plastic pressure plate, *terrible* registration |
| 16mm | 10.26 × 7.49 mm | 24 | Documentary and news; grain present but sharp |
| Super 16 | 12.52 × 7.41 mm | 24 | Wider, intended for blow-up |
| 35mm Academy | 22 × 16 mm | 24 | The reference |
| 65/70mm | 52.5 × 23 mm | 24 | Nearly grainless, enormous |

Super 8 deserves to be the flagship preset: 18 fps, reversal stock, heavy grain,
a soft slow zoom lens, dreadful gate weave, and light leaks from the cartridge.

### The transport, the projector, the telecine

This is where most of the *motion* character lives, and it is the part people
usually skip.

- **Gate weave.** The frame wanders because the registration is imprecise.
  Super 8's plastic pressure plate is notorious. Model it as low-frequency 2D
  translation plus a little rotation, with the grain and dirt moving with the
  gate where appropriate.
- **Frame-to-frame exposure flicker.** Spring-wound cameras do not hold speed,
  and shutters vary. This is the iconic Super 8 shimmer.
- **Projector shutter flicker** is separate: a 2- or 3-blade shutter interrupts
  the light at 2× or 3× the frame rate.
- **Dust and hair, in two distinct kinds.** Dirt *in the gate* is stationary in
  the frame and persists for many frames, and hairs at the gate edge wiggle.
  Dirt *on the film* appears for one frame and is gone. Both exist; they look
  completely different; most emulations only do the second.
- **Scratches / tramlines.** Vertical lines that persist across a shot because a
  piece of grit is in the gate. Base-side scratches read bright, emulsion-side
  scratches read dark or coloured. They should last seconds, not frames.
- **Splices**: a jump plus a flash frame. **Cue marks**: the circle in the top
  right corner at reel changes.
- **Focus breathing** as the film buckles in the gate from lamp heat.
- **3:2 pulldown** if telecined to 29.97, which produces the characteristic
  judder — a real and very recognisable artefact.

### Age and damage

- **Dye fading.** The cyan dye in Eastman colour stocks fades fastest, which is
  why so many 1970s and 80s prints are now pink-magenta. This is a specific,
  recognisable, per-dye decay, not a generic desaturation.
- **Vinegar syndrome**: acetate decay, buckling, channelling.
- **Light leaks and edge fog**, especially at the start and end of a cartridge.
  Super 8 cartridges leaked constantly.
- **Mould, water marks, emulsion lifting.**

### The lens

Super 8 cameras had small, slow zooms: soft corners, low contrast, veiling
flare, visible chromatic aberration. 35mm anamorphic is a different world —
oval bokeh, horizontal blue flares, focus breathing. Worth a section of its own.

### Sound — do not treat this as an afterthought

CRTBOX's single best decision was taking audio as seriously as picture, and the
film equivalents are at least as rich:

- **Super 8 magnetic stripe**: a very narrow stripe of oxide, so limited
  bandwidth, audible hiss, and wow/flutter from a tiny capstan. Print-through
  (a pre-echo from adjacent windings) is a lovely, rarely emulated detail.
- **16mm/35mm optical track**: variable-area or variable-density. Dirt on the
  track becomes crackle, scratches become ticks, and the distortion character is
  specific and unlike magnetic tape.
- **The Academy curve**: the deliberate high-frequency rolloff that cinema
  playback applied for decades.
- **Projector noise.** The mechanical clatter of the mechanism in the room, at
  the frame rate and its harmonics. This is the direct analogue of CRTBOX's
  flyback whine, which turned out to be the single most evocative sound in the
  whole application. Do this one well.

### Link picture and sound

CRTBOX's "A/V Link" section ties the two halves together and is the thing that
makes it feel like one object rather than two effects. Carry the idea over with
film's own couplings:

- Projector clatter locked to the frame rate *and* to gate weave, so the picture
  judder and the mechanical noise are the same event.
- A splice gives a picture jump **and** an audio pop.
- Optical-track dirt and picture dirt come from the same dirty print.
- Lamp flicker and the amplifier's supply, as in CRTBOX.

---

## Architecture to reuse from CRTBOX

Read these before designing anything. They are the parts that took longest to
get right.

**`src/core/params.ts` — a schema-driven everything.** One file describes ~260
parameters (key, label, type, range, default, unit, hint, advanced flag,
group, group kind). From it are generated: the entire settings UI, the shader
uniforms, the preset format, the CLI flags, the randomiser and the keyframe
system. Adding a parameter is one entry and it is immediately animatable,
savable, CLI-addressable and randomisable. **Keep this.** It is the reason the
app grew to 260 parameters without the UI code growing at all.

**Two render backends behind one interface.** `src/video/backend.ts` picks
between a WebGL2 renderer and a pure-JavaScript CPU renderer, with Auto falling
back rather than failing. The CPU path exists for machines where WebGL2 is
missing or blocked, for headless batch rendering, and for bit-identical
deterministic output. The smoke test asserts the two agree. Worth carrying over;
it is about 2,300 lines and already written.

**`src/core/help.ts` + `scripts/check-help.mjs`.** Every parameter and every
section has a written explanation surfaced by an ⓘ disclosure, and the build
*fails* if a parameter exists without one or if the text is too short to be
saying anything. This is why the app is navigable at 260 parameters. Keep the
enforcement, not just the convention — it caught four stubs that would otherwise
have shipped.

**The guide.** A startup overlay with three or four tabs answering what someone
needs in the first minute, closeable, reopenable with F1, with a remembered
"don't show again". Not a manual.

**The keyframe timeline.** `src/core/timeline.ts` plus `src/ui/Timeline.tsx`:
every parameter animatable, numbers interpolate, enums and switches hold
(because there is no value half way between two film stocks). Easing per
keyframe including a hard hold. For film this matters most for damage events —
ramp a splice or a light leak in over three frames and out again.

**Engine master switches.** CRTBOX has two engines (Tape, Tube) each with a
master bypass that folds down into its sections' individual bypasses. FILMBOX
has the same natural split — **Stock** (emulsion, curve, grain, dyes) and
**Gate** (transport, projector, damage, telecine) — plus a lens section. Fold
masters into section bypasses rather than teaching the renderers about them, so
both backends cannot disagree.

**`scripts/smoke.mjs`.** Fourteen stages driving the real UI in a real browser.
Discussed below; it is the most valuable file in the project.

**Packaging.** Electron + electron-builder, NSIS one-click plus portable, a
GitHub Actions workflow that builds on a Windows runner and can cut a release
and create the tag itself. Lift it wholesale.

---

## Lessons already paid for

These cost real time in the CRTBOX build. Do not re-learn them.

1. **`texSubImage2D` from a `<video>` silently writes nothing.** The call
   succeeds, `glGetError` is clean, and the texture keeps its previous contents
   — so video renders black forever while `<img>` works fine. Use `texImage2D`
   unconditionally.

2. **Hand-rolled path→URL conversion breaks on Windows.** Splitting a path and
   running `encodeURIComponent` over each segment turns `C:` into `C%3A`, which
   Chromium will not resolve, so the file dialog silently loads nothing — on the
   only platform the app ships to, while working perfectly on Linux and in CI.
   Use `node:url`'s `pathToFileURL`. Better still, read the bytes and use a blob
   URL so playback never depends on a file URL at all.

3. **Seeking resets things you did not mean to reset.** CRTBOX cleared its
   phosphor-persistence buffers on the `seeking` event, which is correct when a
   user scrubs and catastrophic during an export — frame-stepping *is* seeking,
   so trails were wiped before every single frame and no rendered video ever had
   them. Any frame-to-frame accumulator (and film has several: gate dirt,
   scratches, print-through) needs the same care.

4. **The export frame must be the shape you asked for.** CRTBOX derived export
   dimensions from the source and let the shader letterbox inside it, so
   choosing 4:3 produced a 16:9 file with bars baked in. Compute the output
   frame from the *format's* aspect, in one shared function used by both the
   preview canvas and the export. Film has strong opinions about aspect —
   1.33, 1.37 Academy, 1.66, 1.85, 2.39 — so this matters more here.

5. **`gl_FragCoord` is the pixel centre, origin bottom-left.** When writing a
   CPU renderer to match a GPU one, passing integer top-left indices puts every
   screen-space pattern half a pixel out in x and half a pixel plus a flip out
   in y. On a 3-pixel pattern that is a sixth of a cycle and plainly visible.
   This caused an 18-unit brightness difference that took a bisect to find.

6. **A parameter can exist in the schema and never reach the shader.** The
   control moves, the uniform is never set, nothing happens, and nothing fails.
   Assert in a test that each new section actually changes the picture.

7. **Fixed `sleep()` in a browser test is a flaky test.** Several stages
   intermittently sampled a frame before it was drawn, which reads as
   "perfectly flat" and fails for reasons unrelated to the thing under test.
   Poll for the condition, or wait until two consecutive samples agree.

8. **`pkill -f "scripts/smoke.mjs"` matches its own shell** and kills the
   command running it. Mildly funny, cost ten minutes.

---

## How to test this

CRTBOX's smoke test is a Playwright script driving the real UI and asserting
*emergent behaviour*, not pixel equality. That distinction is what makes it
useful. Examples worth copying in spirit:

- Shaders compile and link (type-checking cannot catch a broken shader).
- A test pattern comes out lit, with contrast, and with the expected structure.
- A video fixture actually reaches the renderer.
- The app loads over `file://` — the packaged build uses `loadFile`, and
  testing only over HTTP is exactly how a `file://`-only defect shipped.
- Keyframes measurably animate the output and the midpoint eases rather than
  steps.
- Both render backends produce the same picture within tolerance.

For FILMBOX the equivalents are better still, because film artefacts are
measurable:

- **The characteristic curve**: feed a synthetic exposure ramp and assert the
  measured output has a toe and a shoulder — that the slope near black and near
  white is lower than the slope in the middle. That is the curve existing,
  proven from the output.
- **Grain is fixed to the gate, not the subject**: pan the source and assert the
  grain pattern does *not* track it; weave the gate and assert it does.
- **Grain scales with format**: the same stock at Super 8 and 35mm must differ
  measurably in grain power.
- **Negative vs reversal latitude**: push a highlight ramp and assert reversal
  clips sooner and harder than negative.
- **Gate dirt persists, film dirt does not**: assert a gate speck survives N
  frames and a film speck does not.
- **Cyan-dye fading is per-dye**: assert faded output shifts toward magenta
  specifically, rather than just desaturating.
- **3:2 pulldown**: assert the judder pattern is 3:2 and not uniform.

Also keep `scripts/check-help.mjs` (build fails on undocumented parameters) and
`scripts/bench.mjs` (both backends, with an honest note that a container has no
GPU so the numbers are a floor).

---

## Working practices that mattered

- **Measure, do not assume.** Several confident diagnoses in the CRTBOX build
  were wrong, and the bisect or the probe found the real cause in minutes. When
  a measurement looks surprising, suspect the measurement first: a dot-crawl
  test showed "no movement" purely because the probe downsampled a 227-cycle
  pattern into nothing.
- **Say what you did not verify.** One fix in CRTBOX — the Windows path bug —
  could only be reasoned about, never executed, because the container is Linux.
  That was stated plainly in the commit and in every summary afterwards. Do the
  same rather than implying everything was proven.
- **New sections ship inert.** When CRTBOX gained Colour and Glitching sections,
  their defaults were neutral and off so that no existing look changed; the
  character went into the presets instead. Users notice when their saved work
  renders differently.
- **Presets are specific machines, not intensity levels.** "A Super 8 cartridge
  shot on a spring-wound camera in 1974 and projected twice since" is a preset.
  "Film 60%" is not. CRTBOX's ten presets are each a particular object in a
  particular state and that is why they are useful.
- **Commit messages carry the reasoning**, especially why something was *not*
  done the obvious way.

---

## Suggested order

1. Fork CRTBOX. Get it building, run `npm test`, read `src/core/params.ts`,
   `src/video/renderer.ts` and `scripts/smoke.mjs`.
2. Strip the CRT/VHS-specific passes and parameters; keep the apparatus.
3. Build the **Stock** engine: characteristic curve first (it is the foundation),
   then density-dependent grain, then dyes and halation.
4. Build the **Gate** engine: weave, flicker, dirt in both kinds, scratches,
   splices, pulldown.
5. Add the **Lens** section.
6. Rebuild the audio chain for magnetic stripe, optical track and projector
   noise, and wire the A/V link.
7. Write presets as specific objects: Super 8 Reversal 1974, 16mm Documentary,
   35mm Print Fourth Generation, Faded Eastman, Home Movie Found In A Loft.
8. Write the help text for every parameter, with the check enforcing it.
9. Smoke stages for everything above.
10. Package and release.

Super 8 end to end is a better first milestone than all six formats half done.
