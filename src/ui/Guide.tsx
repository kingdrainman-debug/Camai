import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../core/presets';

/**
 * The welcome guide.
 *
 * Shown on first run and reopenable from the header at any time. It answers the
 * three questions someone has in the first minute — how do I get footage in,
 * which preset should I start from, and what do I do then — and nothing else.
 * An exhaustive manual nobody reads would be worse than this.
 *
 * Whether to show it at startup lives in localStorage, which can throw or come
 * back empty in a private window or with site data blocked, so every access is
 * guarded and the fallback is simply to show it.
 */

const STORE_KEY = 'camai.guide.hideOnStart';

export function shouldShowOnStartup(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== '1';
  } catch {
    return true;
  }
}

function remember(hide: boolean): void {
  try {
    if (hide) localStorage.setItem(STORE_KEY, '1');
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* private window, or site data blocked — the guide simply shows again */
  }
}

interface Props {
  onClose(): void;
  /** Load a preset by id, so a camera can be tried straight from the guide. */
  onPickPreset(id: string): void;
  /** Opens the file dialog, so the first step is actionable from here. */
  onOpenMedia(): void;
}

type Section = 'start' | 'engines' | 'cameras' | 'workflow';

export function Guide({ onClose, onPickPreset, onOpenMedia }: Props) {
  const [section, setSection] = useState<Section>('start');
  const [hide, setHide] = useState(() => !shouldShowOnStartup());
  const closeRef = useRef<HTMLButtonElement>(null);

  // Escape closes, and focus starts on the close button so the whole thing can
  // be dismissed from the keyboard without hunting for it.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const setHidden = (v: boolean) => {
    setHide(v);
    remember(v);
  };

  return (
    <div
      className="guide-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="CAMAI guide"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="guide">
        <header className="guide-head">
          <span className="logo">●</span>
          <div className="guide-title">
            <h1>CAMAI</h1>
            <p>Point a camcorder at your footage, record it to DV tape, and watch the tape the way it was watched.</p>
          </div>
          <button ref={closeRef} className="guide-close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>

        <nav className="guide-tabs">
          {(
            [
              ['start', 'Getting footage in'],
              ['engines', 'The three engines'],
              ['cameras', 'Reference cameras'],
              ['workflow', 'Building a look'],
            ] as [Section, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={section === id ? 'active' : ''}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="guide-body">
          {section === 'start' && <GettingStarted onOpenMedia={onOpenMedia} onClose={onClose} />}
          {section === 'engines' && <Engines />}
          {section === 'cameras' && (
            <Cameras
              onPick={(id) => {
                onPickPreset(id);
                onClose();
              }}
            />
          )}
          {section === 'workflow' && <Workflow />}
        </div>

        <footer className="guide-foot">
          <label className="check">
            <input
              type="checkbox"
              checked={hide}
              onChange={(e) => setHidden(e.target.checked)}
            />
            <span>Don&rsquo;t show this when CAMAI opens</span>
          </label>
          <span className="guide-reopen">Reopen any time with the <strong>Guide</strong> button, or <kbd>F1</kbd>.</span>
          <button className="primary" onClick={onClose}>
            Start
          </button>
        </footer>
      </div>
    </div>
  );
}

function GettingStarted({
  onOpenMedia,
  onClose,
}: {
  onOpenMedia(): void;
  onClose(): void;
}) {
  return (
    <>
      <h2>Three ways to load something</h2>
      <ol className="guide-steps">
        <li>
          <strong>Drag a file onto the window.</strong> Video or a still image, anywhere on the
          window. This is the quickest route and works in every build.
        </li>
        <li>
          <strong>Open media…</strong> in the top left opens a normal file dialog.{' '}
          <button
            className="guide-inline"
            onClick={() => {
              onOpenMedia();
              onClose();
            }}
          >
            Try it now
          </button>
        </li>
        <li>
          <strong>Drop a file on the CAMAI icon</strong>, or use “Open with”, in the desktop build.
        </li>
      </ol>

      <h2>Your footage is the world</h2>
      <p>
        CAMAI treats what you load as the world in front of the camera, not as a picture to put a
        filter on. The camera points at it — with a shaking hand, a zoom, an automatic exposure —
        and records it the way a consumer camcorder did, in 720-sample DV fields, sixty moments a
        second (fifty in 625/50). The more frames your source has, the more of that motion it can
        show.
      </p>

      <h2>What comes out</h2>
      <p>
        The frame is the shape of the picture at the DV raster&rsquo;s pixel aspect: 4:3, or 16:9 in
        the camera&rsquo;s 16:9 mode. Everything is rendered in the DV raster first and scaled at the
        very end, so an 8×8 block is 8×8 DV pixels whatever size you export. On the desktop you can
        also export a real <strong>DV file</strong> — encoded by FFmpeg&rsquo;s own DV encoder — that
        any editor will cut as DV.
      </p>
      <p>
        Still images become clips: the camera is pointed at the still and keeps running, so the
        operator, the automatics, the noise and the tape keep moving.
      </p>

      <h2>The camera always has sound</h2>
      <p>
        The microphone is on the camera body, so it hears the camera: the transport&rsquo;s whine,
        the zoom motor whenever the zoom moves, the focus motor while it hunts, the REC button at the
        start of every shot. With a silent source, that is the soundtrack. Leave the{' '}
        <em>A/V Link</em> on: they are the same events the picture shows.
      </p>
    </>
  );
}

function Engines() {
  return (
    <>
      <h2>The chain, in the order the picture meets it</h2>
      <p>
        CAMAI models what happens to a picture on its way through a camcorder, step by step, and
        every artefact comes from one of those steps rather than from a texture laid on top.
      </p>
      <ul className="guide-list">
        <li>
          <strong>Camera</strong> — the person holding it, a small cheap zoom, a CCD the size of a
          fingernail read out in fields and smearing where it is overloaded, an automatic camera
          chasing exposure, focus and white balance, and a DSP that sharpens every edge.
        </li>
        <li>
          <strong>Tape</strong> — interlace, 4:1:1 or 4:2:0 colour, the DV codec with its fixed bit
          budget crushing the result into 8×8 blocks, a tape that drops out, and the recording
          breaks between shots.
        </li>
        <li>
          <strong>Display</strong> — the camera&rsquo;s own display and date, where they entered the
          chain, the capture card, the deinterlacer, the 2006 web upload and the screen.
        </li>
      </ul>
      <p>
        Each tab has a master switch that bypasses its whole engine; each section has its own. Use
        them to find out where something is coming from.
      </p>

      <h2>Two things worth knowing</h2>
      <p>
        <strong>The bit budget is fixed.</strong> DV gives every five macroblocks the same number of
        bits, so quality is whatever is left after the picture has paid for its detail. Gain noise is
        detail as far as the codec is concerned: a dark room with the gain up blocks far worse than a
        bright one, everywhere at once.
      </p>
      <p>
        <strong>Overlays have a path.</strong> The REC indicator was never recorded to tape. Where an
        overlay enters the chain decides what the chain does to it: burned in before the codec it
        rings and bleeds; drawn after decode it sits crisply on the blocks; drawn on the display it
        is sharp on the screen&rsquo;s own pixels.
      </p>
    </>
  );
}

function Cameras({ onPick }: { onPick(id: string): void }) {
  return (
    <>
      <h2>Start from a camera, not from zero</h2>
      <p>
        Each of these is one machine in one situation — a year, a light, an operator, a tape —
        rather than an intensity level. Pick one, then change what is different about yours.
      </p>
      <div className="guide-films">
        {PRESETS.map((p) => (
          <button key={p.id} className="guide-film" onClick={() => onPick(p.id)}>
            <strong>{p.name}</strong>
            <span>{p.description}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function Workflow() {
  return (
    <>
      <h2>Building a look</h2>
      <ol className="guide-steps">
        <li>
          <strong>Choose the machine.</strong> Under <em>Camera ▸ Format</em>: 525/60 or 625/50, one
          CCD, three, or CMOS, and the sensor&rsquo;s size. These decide the colour, the noise, the
          smear and how the colour bleeds.
        </li>
        <li>
          <strong>Set the light, and let the camera chase it.</strong> <em>Exposure ▸ Scene light</em>{' '}
          and <em>White Balance ▸ Light</em>. The automatic camera does the rest, wrongly in the right
          ways: tungsten stays orange, a dark room gets gain and noise.
        </li>
        <li>
          <strong>Give it an operator.</strong> Tremor and sway for anything handheld, walking for
          anything on the move, a bump now and then. Keyframe the zoom for the slow push in.
        </li>
        <li>
          <strong>Then the tape and the screen.</strong> Breaks between shots, a dropout or two, the
          camera&rsquo;s display on its AV output, a composite capture, a 2006 upload. Little and
          often beats a lot at once.
        </li>
      </ol>

      <h2>Animate it</h2>
      <p>
        Click the <strong>◷</strong> beside any parameter to animate it, scrub, and change the value
        to write a keyframe. Numbers interpolate; switches and choices hold. Animate the zoom and the
        motor is heard while it moves; animate the scene light from a room into daylight and watch
        the exposure blow out and pump down.
      </p>

      <h2>Save it</h2>
      <p>
        <strong>Save…</strong> writes a <code>.camai.json</code> carrying every parameter and all the
        keyframes. <strong>Copy</strong> puts the same thing on the clipboard. The desktop build can
        render from the command line with a preset file and no window at all.
      </p>
    </>
  );
}
