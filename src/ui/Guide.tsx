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

const STORE_KEY = 'crtbox.guide.hideOnStart';

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
  /** Load a preset by id, so a tube can be tried straight from the guide. */
  onPickPreset(id: string): void;
  /** Opens the file dialog, so the first step is actionable from here. */
  onOpenMedia(): void;
}

type Section = 'start' | 'engines' | 'tubes' | 'workflow';

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
      aria-label="CRTBOX guide"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="guide">
        <header className="guide-head">
          <span className="logo">▚</span>
          <div className="guide-title">
            <h1>CRTBOX</h1>
            <p>Put your footage on a television that should not still be broadcasting.</p>
          </div>
          <button ref={closeRef} className="guide-close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>

        <nav className="guide-tabs">
          {(
            [
              ['start', 'Getting footage in'],
              ['engines', 'The two engines'],
              ['tubes', 'Reference tubes'],
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
          {section === 'tubes' && (
            <Tubes
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
            <span>Don&rsquo;t show this when CRTBOX opens</span>
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
          <strong>Drop a file on the CRTBOX icon</strong>, or use “Open with”, in the desktop
          build.
        </li>
      </ol>

      <h2>Still images become clips</h2>
      <p>
        Load a photograph and you still get a transport and a clip length. The still is held while
        the effects run over it — the hum bar drifts, snow moves, the timebase wobbles, the picture
        breathes — so the export is a moving image rather than a frozen frame. Set the length under{' '}
        <em>Export ▸ Clip length</em>.
      </p>

      <h2>What comes out</h2>
      <p>
        The frame is always the shape of the tube. Pick 4:3 under <em>Tube Geometry ▸ Aspect</em>{' '}
        and a widescreen source is exported as a genuinely 4:3 file, not a widescreen one with
        black bars painted into it. The preview shows the same frame, so if you cannot see bars
        there are none in the file.
      </p>
      <p>
        <em>Export ▸ Resolution</em> sets the size. Rendering larger than your source is worth
        doing here: the scanlines, the shadow mask, the bloom and the curvature are all generated
        at the output resolution rather than stretched, so they come out genuinely sharp. It cannot
        invent detail the footage never had, but the tube itself will be crisp at 4K.
      </p>

      <h2>Sound is half of it</h2>
      <p>
        The audio chain runs on your source&rsquo;s own soundtrack: mono collapse, a small speaker
        in a plastic box, mains hum, the flyback whine a tube makes at 15.7 kHz, tape wow and
        crackle. Leave <em>A/V Link</em> on — it ties the two together, so the bright band drifting
        up the screen and the hum in the speaker are the same fault, and losing the picture loses
        the sound with it. That connection is what makes it feel like one object rather than two
        effects.
      </p>
    </>
  );
}

function Engines() {
  return (
    <>
      <h2>One signal path, two emulators</h2>
      <p>
        CRTBOX models two different things, and they are different things. The{' '}
        <em>Tape</em> tab is the signal: a picture encoded onto a composite carrier,
        recorded to videotape, read back and decoded again. The <em>Tube</em> tab is the
        display: the glass, the electron beam, the phosphor and the room the set is
        sitting in.
      </p>
      <p>
        Both run, in that order, on every frame — which is the order it happened in
        reality. A signal was damaged on its way to the television, and then the
        television displayed it badly.
      </p>
      <p>
        Each of the two tabs carries a <strong>master switch</strong>, so either engine
        can be bypassed in one click without going to the tab first. A bypassed engine is
        struck through on its tab. The two half-looks are both useful on their own: a
        clean signal on a bad tube, and a bad tape shown flat. Switching one off is also
        the fastest way to find out which half an artefact you do not want is coming from.
      </p>

      <h2>Why the tape engine matters</h2>
      <p>
        Almost nothing in the Tape tab is drawn on. Chroma really is modulated onto a
        subcarrier at 227.5 cycles per line, band-limited, and separated out again at the
        other end. Dot crawl, rainbow cross-colour and comb fringing are not effects in
        this app — they are what you get when that round trip is performed honestly.
      </p>
      <p>
        That is why <em>Chroma demodulation</em> changes so much. Box is a cheap set and
        leaves the maximum dot crawl and rainbow. A 2-line comb is a good late-model set
        and cancels nearly all of it, at the cost of colour fringing wherever the picture
        moves vertically. Both failures are real, and neither is faked.
      </p>

      <h2>Where to start in each</h2>
      <ol className="guide-steps">
        <li>
          <strong>Tape ▸ VHS Tape ▸ Tape speed.</strong> Not a style control — it sets the
          luma and chroma bandwidth the way the real recording mode did. SP is careful, EP
          is six hours on one cassette with barely any colour left.
        </li>
        <li>
          <strong>Tape ▸ Composite ▸ Chroma demodulation.</strong> The biggest single
          decision in the signal half.
        </li>
        <li>
          <strong>Tube ▸ Phosphor &amp; Mask ▸ Mask type.</strong> Aperture grille for a
          Trinitron or an arcade monitor, slot for a normal television, shadow for
          something older and softer.
        </li>
        <li>
          <strong>Tube ▸ Beam ▸ Beam blooming.</strong> What separates a real tube from a
          scanline overlay.
        </li>
      </ol>
      <p className="guide-note">
        Every control in both tabs has an <strong>ⓘ</strong> beside it, and so does every
        section. If something is not doing what you expect, that is the first place to look.
      </p>
    </>
  );
}

function Tubes({ onPick }: { onPick(id: string): void }) {
  return (
    <>
      <h2>Start from a tube, not from zero</h2>
      <p>
        Each preset is a specific machine in a specific state rather than an intensity setting —
        &ldquo;a portable in a kitchen&rdquo; and &ldquo;a failing console in a damp room&rdquo;
        are not the same effect turned up. Pick the one nearest what you want and adjust from
        there; almost nobody should build a look from the defaults.
      </p>
      <div className="guide-tubes">
        {PRESETS.map((p) => (
          <button key={p.id} className="guide-tube" onClick={() => onPick(p.id)}>
            <strong>{p.name}</strong>
            <span>{p.description}</span>
          </button>
        ))}
      </div>
      <p className="guide-note">
        Each one sets both engines together, so &ldquo;Third-Generation Tape&rdquo; gives you an
        EP recording <em>and</em> the tired set it is being played back on, while
        &ldquo;Arcade Monitor&rdquo; switches the tape half off entirely because an arcade
        cabinet was fed RGB directly. Clicking one loads it and closes this window. They are also
        in the dropdown at the top of the app, and <em>Randomise</em> rolls whichever tab you are
        looking at.
      </p>
    </>
  );
}

function Workflow() {
  return (
    <>
      <h2>The short version</h2>
      <ol className="guide-steps">
        <li>
          Load footage, pick a reference tube. That sets both the Tape and the Tube halves at
          once.
        </li>
        <li>
          Adjust in the sidebar. Every control has an <strong>ⓘ</strong> next to it that explains
          what it physically is, what each end of its range looks like and when to reach for it.
          Every section has one too.
        </li>
        <li>
          Every parameter is shown, including the fine-detail ones. If the list is more
          than you want, untick <strong>Advanced</strong> in the header to hide them.
        </li>
        <li>Export. Choose a format, an aspect and a resolution, then render.</li>
      </ol>

      <h2>Animating — where the unsettling cuts come from</h2>
      <p>
        Every parameter can be keyframed. Click the <strong>◷</strong> beside any control to start
        animating it; arming seeds a keyframe holding the current value, so switching it on never
        changes the picture. After that, move the playhead and change the value and a keyframe is
        written where you are.
      </p>
      <p>
        The timeline below the picture draws a lane per animated parameter. Drag the diamonds,
        press <kbd>Delete</kbd> to remove one, and set easing per keyframe — including{' '}
        <strong>hold</strong>, which steps instead of interpolating and is how you get a hard cut
        rather than a fade. Switches and dropdowns always hold, because there is no value half way
        between a slot mask and an aperture grille.
      </p>
      <p>
        The single most effective thing to animate is <em>Glitching ▸ Event rate</em>: leave it at
        zero, ramp it up for a few frames and the picture tears itself apart, then drop it back and
        the set recovers. <em>Signal ▸ Signal loss</em> does the same for a whole transmission,
        taking the audio with it.
      </p>

      <h2>Keeping and sharing a look</h2>
      <p>
        <strong>Save…</strong> writes a <code>.crtbox.json</code> carrying every parameter and all
        its keyframes; <strong>Load…</strong> brings it back. <strong>Copy</strong> and{' '}
        <strong>Paste</strong> do the same through the clipboard, which is the easy way to send a
        look to someone else. Presets only store what differs from the defaults, so they stay
        readable and hand-editable.
      </p>
    </>
  );
}
