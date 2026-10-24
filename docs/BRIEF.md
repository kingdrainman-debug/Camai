# CRTBOX — design brief

*A cathode-ray television emulator for picture **and** sound, modelled on the shape of
[ntsc-rs](https://ntsc.rs/) but aimed at a different machine.*

---

## 1. What this is, and why it is not ntsc-rs

ntsc-rs emulates a **signal**. It models what NTSC transmission and VHS encoding do to a
picture on its way to a display: chroma subsampling, composite crosstalk, tape head
misalignment, tracking error. It is, quite deliberately, a *tape and broadcast* effect. The
display itself is out of scope — ntsc-rs hands you a clean, flat, square-pixel image that has
been damaged in the ways a tape damages images.

CRTBOX emulates the **display**. The signal chain is still here, because you cannot
sensibly model a television without modelling what arrives at its aerial socket, but it is
the front half of a longer pipeline. The back half — the part ntsc-rs stops before — is the
tube: a curved glass bottle with three electron guns in the neck, a perforated steel mask a
few millimetres behind the phosphor, a deflection yoke that never scanned a perfect
rectangle, and a power supply that sags when you turn the volume up.

That last clause is the whole thesis of this project.

**A television is one machine.** The picture and the sound share a chassis, a mains
transformer, an aerial and a high-tension rail. When the signal degrades, both degrade. When
the mains ripples, a bright bar crosses the screen *and* a hum appears in the speaker —
because they are the same ripple. When the audio stage draws current on a loud passage, the
picture dims. Every tool in this space treats picture and sound as two unrelated effects
that happen to be applied to the same file. CRTBOX treats them as two outputs of one
simulated device, and gives you an explicit **A/V Link** section to decide how tightly they
are coupled.

Nothing else in this application matters as much as that section.

---

## 2. Functional map: ntsc-rs → CRTBOX

Everything ntsc-rs's standalone app does has a counterpart here, redesigned around the tube.

| ntsc-rs standalone | CRTBOX | What changed |
|---|---|---|
| Split-screen preview | Split preview with a draggable wipe | Same idea; the wipe is continuous rather than a fixed half |
| Scrollable effect settings, left pane | Three tabbed panes: **Picture**, **Sound**, **A/V Link** | The audio half is new, and the link section has no counterpart |
| Collapsible parameter groups | Same, with a bypass switch and a per-group reset on each | Bypass lets you A/B one stage without losing its settings |
| Copy / Paste settings as JSON | Same, plus Save/Load to a `.crtbox.json` file | Only non-default values are written, so presets stay readable |
| Scale control above the settings | Render scale in the export dock | Preview always fits the window; scale only affects output |
| Render settings saved with effect settings | Same | |
| Export H.264/HEVC `.mp4`, ProRes `.mov`, GIF | Same, plus WebM and PNG-sequence + WAV | ffmpeg drives the first three in the desktop build |
| Audio passed through on ProRes export | Audio **processed** and muxed on every format that carries it | The point of the app |
| Command-line arguments for every parameter | `crtbox --input … --output … --<group>.<param> V` | Same design: every parameter is addressable from a script |
| Real-time, multithreaded, SIMD | Real-time on the GPU (WebGL2) + AudioWorklet DSP | Different substrate, same requirement |
| Random seed | Seed + a randomiser with an *amount* control, scoped to the visible tab | Rolling everything at full strength always produces the same mess |

Two things ntsc-rs has that CRTBOX does not, and should be honest about: it is not an After
Effects / Premiere / OpenFX plugin, and its signal model is a genuine port of
`composite-video-simulator` lineage work rather than a from-scratch approximation. CRTBOX's
signal stage is an approximation tuned by eye; its tube stage is where the original work is.

---

## 3. What a CRT actually looks like

The failure mode of every CRT filter is that it multiplies the picture by a sine wave, adds a
vignette, and calls the result scanlines. What follows is the list of things that are
actually happening, in the order the light encounters them.

### 3.1 The raster is not a grid of pixels

A CRT draws a **spot** that sweeps horizontally while its brightness is modulated. There are
no columns. Horizontal resolution is limited by the *bandwidth* of the video amplifier, not
by any pixel structure — which is why the horizontal and vertical characters of a CRT image
are completely different, and why a naïve "scanline overlay" never looks right.

Vertically there genuinely is discrete structure: 240 lines with 240 gaps on a 240p source,
or 480 interlaced lines drawn in two alternating fields. CRTBOX reconstructs the picture as a
**sum of beam profiles** — for each output pixel it samples the four nearest line centres and
weights them by `exp(-(d/halfWidth)^shape)`.

This matters more than it sounds. If the profile is too wide, adjacent lines sum to a
constant and the scanlines cancel out completely — a bug that was in this codebase until the
smoke test caught it. The beam has to fall close to zero between line centres for any line
structure to survive at all.

### 3.2 Bright lines are physically fatter

This is the single most important detail, and the one most emulations omit. Beam current
does not just make a line brighter; it makes the spot larger. On a real tube, a white line is
visibly taller than a grey one, so highlights **swell into the gaps** while shadows keep
crisp scanlines. That non-uniformity is what your eye reads as "CRT" rather than "scanline
filter". It is the `Beam blooming` parameter, and turning it to zero makes everything else
look wrong.

### 3.3 The mask

Three kinds, and they are not interchangeable:

- **Aperture grille** (Trinitron): continuous vertical RGB stripes, no vertical structure at
  all. Bright, sharp, and the reason Trinitrons looked the way they did.
- **Slot mask**: vertical stripes chopped into staggered slots. What most consumer
  televisions used.
- **Shadow mask / delta triad**: round holes on a hexagonal lattice, alternate rows offset by
  half a triad. The softest of the three.

The mask blocks roughly two thirds of the light that reaches it. A real set compensated by
running far more beam current. CRTBOX normalises both the beam profile and the mask to unit
mean, so changing mask type, mask pitch or beam width changes the *texture* of the picture
without changing its *exposure* — the boost controls are then genuine artistic gain rather
than a correction you have to keep re-doing.

Below about three screen pixels per triad the mask stops being texture and becomes moiré.
That is not a bug; it is what happens when you photograph a CRT, and it is exposed as a
parameter.

### 3.4 Phosphor persistence is per-channel

Phosphors keep emitting after the beam has gone. P22 green (the zinc silicate family)
outlasts the blue by a wide margin, so **motion trails on a consumer television skew green**.
CRTBOX gives persistence a *tilt* control for exactly this.

The persistence blend is `max(current, previous × decay)`, not a sum — a decaying trail must
never be brighter than the highlight that caused it. Decay is expressed as a half-life and
converted per-field, so the trail length is the same at 24, 30 or 60 fps.

### 3.5 Halation is not bloom

Two different phenomena, usually conflated:

- **Bloom**: a tight glow immediately around bright areas.
- **Halation**: light that has entered the faceplate, bounced off its front surface, and
  re-emerged some distance away. It is much wider, much softer, and **warm**, because red
  scatters furthest through glass.

Both are here, on separate blur chains at different resolutions, with a warmth control on the
halation. Adding a third, flat veil — `Glass diffusion` — accounts for the fact that
thirty-year-old faceplate glass is not clear glass, and it is the parameter that lifts the
blacks in a way that reads as *old* rather than as *washed out*.

### 3.6 Convergence error grows towards the corners

Three guns fire at the same phosphor dot from three different angles. Convergence was
adjusted at the centre of the screen, so the residual error is smallest there and grows
outward. Uniform RGB offsets look like a chromatic-aberration filter; radial ones look like a
television. Both are exposed, and the radial term is on by default.

The same geometry argument applies to focus: the beam travels further to reach a corner and
lands as a bigger, softer blob, so `Edge defocus` is a separate control from `Defocus`.

### 3.7 Geometry is the service menu

Curvature is the obvious one, but the parameters that make a set feel *individual* are the
trim adjustments nobody ever got quite right: H/V size and position, pincushion, trapezoid,
and — the one that sells it — **rotation**, because the deflection yoke was glued on slightly
crooked at the factory on almost every set ever made. The default is 0.25°, and it is
deliberately not zero.

Overscan belongs here too. Sets deliberately scanned past the bezel, so 4–8% of every edge
was never seen by anyone. Turning overscan off is the fastest way to make CRT footage look
like a filter rather than a recording.

### 3.8 The failure modes

- **Hum bar**: mains ripple riding on the video rail — a soft bright band drifting slowly up
  the screen. It drifts because mains frequency and frame rate are never exactly locked.
- **Flagging**: the top few lines bend sideways because the timebase has not settled after
  the vertical interval.
- **Head-switch band**: the torn, noisy strip along the very bottom of every tape playback.
- **AGC pumping**: automatic gain control chasing the average picture level, always a beat
  behind.
- **PSU sag**: a bright picture pulls the high-tension rail down, so large white areas dim
  and swell. Also driven by *audio* level — see §5.
- **Degauss**: a decaying radial ripple that magnetises the mask and warps colour. Fired from
  a button, because it is an event, not a state.
- **Burn-in**: a slow running average of the picture, subtracted. Whatever sat still —
  a station logo, a paused frame — is permanently dimmer.
- **Power on/off**: the raster opens vertically from a line as the tube warms, and collapses
  back to a line and then a fading dot when it is switched off.

---

## 4. The audio problem

This is the half nobody builds, so it is worth setting out the reasoning rather than just the
parameter list.

### 4.1 What "sounds like a TV" actually is

The instinct is to reach for a low-pass filter and some hiss. That gets you maybe a third of
the way, and the result sounds like *muffled modern audio* rather than like a television.
The three things that actually carry the illusion are:

1. **The enclosure.** A 6 cm paper cone stapled into a hollow plastic box, firing sideways or
   at the floor. The box has strongly excited standing-wave modes that ring for a few
   milliseconds. A resonance in *time* is not something an EQ curve can produce, which is why
   CRTBOX synthesises a small-box impulse response from the cabinet dimensions and convolves
   with it. The `Cabinet size` control resizes the box and rebuilds the IR — 0 is a portable
   on a kitchen counter, 1 is a wooden console the size of a sideboard.

2. **Mono.** Not "reduced stereo" — one speaker. Every pre-1984 set, and most sets long
   after. Collapsing the image is more important to the illusion than any filter, because
   modern stereo is instantly recognisable as modern. CRTBOX offers a partial collapse (0.7
   keeps a hint of width) and, as a fourth option, the **difference channel** (L−R): the MTS
   stereo subcarrier on its own, in which anything panned centre — which is almost always the
   dialogue — cancels out completely. It is the single most unsettling thing in the audio
   section and it is a real signal that really existed.

3. **Never silent.** Digital silence is the tell. The noise bed is several quiet layers
   rather than one loud one, because that is how real noise floors are constituted.

### 4.2 The noise bed, layer by layer

**Mains hum** is two different sounds and they are usually confused:

- A **ground loop** buzzes on the *odd* harmonics of the mains fundamental — 50/60, 150/180,
  250/300 Hz. It is a buzz, not a hum.
- A **transformer** sings at *twice* line frequency — 100/120 Hz — because magnetostriction
  does not care which way the magnetic field points. It is a hum, not a buzz.

CRTBOX models them separately, lets you blend them, and drifts the fundamental slowly so the
hum breathes instead of sitting still.

**Flyback whine** is the signature CRT sound and almost nobody adds it. The line-output
transformer's windings physically vibrate at the horizontal scan rate: **15.734 kHz on NTSC,
15.625 kHz on PAL**. It sits close enough to the limit of hearing that children hear it
clearly as a piercing whistle while many adults cannot perceive it at all — which is precisely
why it is such an effective unease device. CRTBOX adds the fundamental plus second and third
partials (the difference between a pure tone and a *sick* set), drifts it, and offers an
optional octave-down shift to ~7.9 kHz so it survives lossy codecs, laptop speakers and older
ears.

Crucially, the whine is **not** routed through the speaker chain. It is not in the signal
path — it is a transformer vibrating inside a cabinet, radiating into the room. Low-passing it
through a simulated paper cone would destroy it. The noise bed is therefore split into two
buses: *signal* noise (hum, hiss, static, contact crackle) which is added before the speaker
and shaped by it, and *acoustic* noise (flyback whine, mechanical rumble, degauss thump)
which is added after.

**Tape hiss** is high-passed white noise, with a `breathing` control: companding noise
reduction mis-tracks, so the hiss swells back up whenever the programme goes quiet — which is
exactly when you notice it.

**RF static** is broadband and rides the video `Signal loss` parameter, so when the picture
goes to snow, the sound goes with it.

### 4.3 Crackle

Crackle is impulsive, sparse and random, and it is what actually sells decay. Getting it
right means getting the *statistics* right:

- Events are **Poisson-distributed**, so the spacing never sounds metronomic.
- Amplitudes follow a **power law**, so most clicks are tiny and occasionally one is a bang.
  A uniform distribution sounds like rain on a tent; a power law sounds like a bad joint.
- Each click is a resonator rung by an impulse — a decaying sinusoid at a randomised
  frequency — so the tone varies from tick to thud.
- A separate **burst** process occasionally raises the rate forty-fold for a few hundred
  milliseconds: a corroded connector or a dry joint arcing.

All of it runs in an AudioWorklet, because sample-accurate event scheduling is not something
the built-in Web Audio nodes can do.

### 4.4 Wow, flutter and dropouts

Pitch instability comes from a modulated fractional delay line with Catmull-Rom
interpolation — genuine pitch modulation, not a chorus:

- **Wow** (~0.6 Hz): once-per-revolution error from an eccentric capstan or a warped reel.
- **Flutter** (~9 Hz): faster wobble from the idler and guides.
- **Random drift**: a slow random walk on top, which is what stops the wobble sounding like
  an LFO and starts it sounding like a mechanism wearing out.
- **Scrape flutter**: very fast stick-slip against the heads. Adds roughness, not pitch.

The delay amplitude is derived from the target pitch deviation as `ε / (2πf)`, so the audible
depth of the wobble is independent of its rate — moving the rate slider does not silently
change how much it wobbles.

**Dropouts** are a Poisson process with a fast-in, slower-out envelope and a click at each
edge, because the edge of a dropout is a click, not a fade.

### 4.5 Ordering

The chain runs in the order the signal physically travels:

```
programme → input trim → channel matrix → transport → + signal noise
          → speaker & enclosure → broadcast processing → + acoustic noise
          → distance (off-axis, through-the-wall, room tail) → limiter
```

The compressor sits **after** the band limiting, not before it, because a television's audio
stage only ever saw the band-limited signal — it pumps in response to what survived the
filters, not to the full-range mix. This is a small reordering with a clearly audible result.

---

## 5. The A/V Link

The section that justifies the whole project. Each of these is a real coupling in a real
television:

| Link | Physical basis |
|---|---|
| **Hum bar → hum** | The bar crossing the screen and the hum in the speaker are the *same* mains ripple. Locking them is instantly convincing and nobody does it. |
| **Signal loss → static** | One aerial. When the picture goes, the sound goes. |
| **Audio → brightness** | Loud audio drags the high-tension rail down; the picture dims and swells. Real, and almost never emulated. |
| **Audio → bloom** | Same sag, seen as beam widening rather than dimming. |
| **Picture glitch → dropout** | A head-switch tear and a tape dropout happen on the same damaged patch of oxide. |
| **Degauss → thump** | The degauss coil is a large inductive load switched straight onto the mains. You hear it as much as you see it. |
| **Power state → audio** | Switch-on thump, and the slow fade-up as the audio stage comes alive. |

Implementation note: rather than messaging state between the GPU and the audio thread — which
would be both laggy and unavailable during offline rendering — the renderer and the worklets
each evaluate *the same deterministic function of media time*. They agree because they are
computing the same thing, not because they are talking to each other. That is also what makes
an offline export produce identical wow, crackle and hum-bar-linked hum to the live preview.

---

## 6. Deliberate non-goals

- **Not a plugin.** No After Effects / Premiere / OpenFX host integration. The pipeline is
  GPU shaders plus Web Audio, and the standalone app is the product.
- **Not a signal-accurate NTSC decoder.** If you want a faithful port of the
  composite-video-simulator lineage, use ntsc-rs — and then feed its output into this. The two
  compose well precisely because they model different halves of the path.
- **Not a monitor calibration tool.** The colour handling is perceptual, not colorimetric.
- **No cloud anything.** Decoding, processing and export all happen on the machine.

---

## 7. Where the risk is

Honest assessment of what is weakest:

- **The signal stage is tuned by eye.** Dot crawl, cross-colour and ringing are plausible
  approximations of the artefacts, not derived from a modelled subcarrier. They look right;
  they are not a simulation.
- **Browser export is real-time capture.** In a tab, video export goes through MediaRecorder,
  which drops frames if the machine cannot keep up. The deterministic path (PNG sequence, or
  ffmpeg in the desktop build) is the one to use for anything going into an edit.
- **`decodeAudioData` is the audio export bottleneck.** Some containers play fine in a
  `<video>` but cannot be decoded for offline rendering. When that happens the video still
  exports; the audio silently does not, and the app says so rather than failing the render.
- **The mask normalisation is a CPU mirror of the shader's mask function.** Two copies of the
  same maths that must be kept in step. It is commented on both sides, but it is a real
  maintenance hazard.
