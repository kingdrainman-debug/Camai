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

const STORE_KEY = 'filmbox.guide.hideOnStart';

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
  /** Load a preset by id, so a film can be tried straight from the guide. */
  onPickPreset(id: string): void;
  /** Opens the file dialog, so the first step is actionable from here. */
  onOpenMedia(): void;
}

type Section = 'start' | 'engines' | 'films' | 'workflow';

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
      aria-label="FILMBOX guide"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="guide">
        <header className="guide-head">
          <span className="logo">▤</span>
          <div className="guide-title">
            <h1>FILMBOX</h1>
            <p>Put your footage on a piece of film, and then put the film through everything film went through.</p>
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
              ['films', 'Reference films'],
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
          {section === 'films' && (
            <Films
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
            <span>Don&rsquo;t show this when FILMBOX opens</span>
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
          <strong>Drop a file on the FILMBOX icon</strong>, or use “Open with”, in the desktop
          build.
        </li>
      </ol>

      <h2>The picture changes eighteen times a second</h2>
      <p>
        Super 8 runs at 18 frames a second, so the preview does too: each film frame is exposed
        once and held, however often your screen refreshes. That hold is half of what makes film
        move like film. Change it under <em>Stock ▸ Format &amp; Stock ▸ Camera speed</em>, and
        choose the video frame rate under <em>Gate ▸ Framing &amp; Output</em> — anything but the
        film rate gives the uneven cadence every transfer really had.
      </p>

      <h2>What comes out</h2>
      <p>
        The frame is the shape of the projected picture. Pick 1.85 under{' '}
        <em>Gate ▸ Framing &amp; Output ▸ Aspect</em> and the file is 1.85, cropped from the film
        the way a projection mask crops it, with no bars baked in. Raise <em>Overscan</em> to see
        past the gate: the frame line, the next frame, and the perforations where the real gauge
        puts them.
      </p>
      <p>
        Still images become clips: the still is held while the film runs over it — new grain every
        frame, weave, flicker, dirt — so an export is a moving picture, not a frozen one.
      </p>

      <h2>Sound is half of it</h2>
      <p>
        Your source&rsquo;s soundtrack is put onto film too: a narrow magnetic stripe, or an
        optical track with its crackle and its Academy roll-off. And the projector is in the room
        with you, clattering once a frame. Leave <em>A/V Link</em> on: a frame the claw strikes
        badly both jumps and clacks, and a splice through the gate pops in the speaker, because
        they are the same event.
      </p>
    </>
  );
}

function Engines() {
  return (
    <>
      <h2>The chain, in the order the light meets it</h2>
      <p>
        FILMBOX models what happens to a picture on its way through film, step by step, and every
        artefact comes from one of those steps rather than from a texture laid on top.
      </p>
      <ul className="guide-list">
        <li>
          <strong>Lens</strong> — exposure, the colour of the light, and the lens itself: its
          sharpness in line pairs per millimetre of film, its vignetting, fringing and flare.
        </li>
        <li>
          <strong>Stock</strong> — the emulsion. Its characteristic curve (the toe, the straight
          line, the shoulder), its grain in three layers, halation, its dyes, the print it was made
          into and how those dyes have faded since.
        </li>
        <li>
          <strong>Gate</strong> — the machinery. The camera&rsquo;s registration and shutter, the
          projector&rsquo;s weave and shutter, dirt in the gate and dirt on the film, scratches,
          splices, light leaks, decay, and the telecine that turned it into video.
        </li>
      </ul>
      <p>
        Each tab has a master switch that bypasses its whole engine; each section has its own. Use
        them to find out where something is coming from.
      </p>

      <h2>Two things worth knowing</h2>
      <p>
        <strong>The format is physical.</strong> Grain, halation, weave and lens sharpness are all
        specified on the film, in micrometres and line pairs per millimetre, and the gauge converts
        them. The same stock on Super 8 is several times grainier than on 35 mm because the frame is
        enlarged more — you change the gauge, not a grain slider.
      </p>
      <p>
        <strong>Grain is on the film.</strong> When the camera&rsquo;s claw misregisters, the image
        moves and the grain does not. When the projector&rsquo;s gate weaves, the whole strip moves
        — picture, grain and dust together. That difference is most of what separates real film
        from a grain overlay.
      </p>
    </>
  );
}

function Films({ onPick }: { onPick(id: string): void }) {
  return (
    <>
      <h2>Start from a piece of film, not from zero</h2>
      <p>
        Each of these is a particular film in a particular state — a stock, a camera, a lab, a
        projector, a cupboard — rather than an intensity level. Pick one, then change what is
        different about yours.
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
          <strong>Choose the gauge and the stock.</strong> They decide the grain, the curve, the
          colour and the frame rate. Reversal (Kodachrome, Ektachrome) clips highlights hard and is
          most of why Super 8 looks the way it does; negative holds everything and is printed.
        </li>
        <li>
          <strong>Set the exposure.</strong> Reversal is unforgiving: half a stop shows. A negative
          will take two stops either way. Exposure is where the stock&rsquo;s character shows most.
        </li>
        <li>
          <strong>Give the camera its faults.</strong> Registration error, exposure flicker and a
          flash frame at the head of each shot. Super 8&rsquo;s plastic pressure plate is worth
          20–40 µm of weave.
        </li>
        <li>
          <strong>Then age it.</strong> Dye fading by years and storage, dust, a scratch that lasts
          a few seconds, a splice or two, fog at the start of the roll. Little and often beats a lot
          at once.
        </li>
      </ol>

      <h2>Animate it</h2>
      <p>
        Click the <strong>◷</strong> beside any parameter to animate it, scrub, and change the
        value to write a keyframe. Numbers interpolate; stocks and switches hold, because there is
        no stock half way between Kodachrome and Vision3. Hold keyframes cut — ramp a light leak in
        over three frames and out again, or bring a scratch in for one shot.
      </p>

      <h2>Save it</h2>
      <p>
        <strong>Save…</strong> writes a <code>.filmbox.json</code> carrying every parameter and all
        the keyframes. <strong>Copy</strong> puts the same thing on the clipboard. The desktop
        build can render from the command line with a preset file and no window at all.
      </p>
    </>
  );
}
