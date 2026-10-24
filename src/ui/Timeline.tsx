import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PARAM_BY_KEY, ParamValue } from '../core/params';
import {
  EASINGS,
  Easing,
  Keyframe,
  Timeline as TimelineData,
  animatedKeys,
  countKeyframes,
} from '../core/timeline';
import { formatTimecode } from '../core/time';

export interface Selection {
  key: string;
  index: number;
}

interface Props {
  timeline: TimelineData;
  duration: number;
  time: number;
  selection: Selection | null;
  open: boolean;
  onToggleOpen(): void;
  onSeek(time: number): void;
  onSelect(sel: Selection | null): void;
  onMoveKey(key: string, index: number, time: number): void;
  onRemoveKey(key: string, index: number): void;
  onSetEase(key: string, index: number, ease: Easing): void;
  onAddKeyAt(key: string, time: number): void;
  onStopAnimating(key: string): void;
  onJump(direction: -1 | 1): void;
  onClearAll(): void;
}

/** Sensible tick spacing for the ruler at the current zoom. */
function tickStep(duration: number): number {
  const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const ideal = duration / 10;
  return targets.find((t) => t >= ideal) ?? 900;
}

function formatValue(key: string, value: ParamValue): string {
  const param = PARAM_BY_KEY[key];
  if (!param) return String(value);
  if (param.type === 'bool') return value ? 'on' : 'off';
  if (param.type === 'enum') {
    return param.options.find((o) => o.value === value)?.label ?? String(value);
  }
  const n = Number(value);
  const span = param.max - param.min;
  const decimals = span >= 1000 ? 0 : span >= 100 ? 1 : span >= 10 ? 2 : 3;
  const text = n.toFixed(decimals).replace(/\.?0+$/, '') || '0';
  return param.unit ? `${text}${param.unit}` : text;
}

export function Timeline({
  timeline,
  duration,
  time,
  selection,
  open,
  onToggleOpen,
  onSeek,
  onSelect,
  onMoveKey,
  onRemoveKey,
  onSetEase,
  onAddKeyAt,
  onStopAnimating,
  onJump,
  onClearAll,
}: Props) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Selection | null>(null);

  const keys = useMemo(() => animatedKeys(timeline), [timeline]);
  const total = countKeyframes(timeline);
  const span = Math.max(duration, 0.1);

  /** Pointer x within the lane area → time in seconds. */
  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const el = lanesRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const fraction = (clientX - rect.left) / Math.max(rect.width, 1);
      return Math.max(0, Math.min(span, fraction * span));
    },
    [span],
  );

  // Dragging is tracked on the window so the pointer can leave the lane without
  // the keyframe being dropped somewhere unintended.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => onMoveKey(drag.key, drag.index, timeFromEvent(e.clientX));
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, onMoveKey, timeFromEvent]);

  // Delete removes the selected keyframe, as it does in any editor.
  useEffect(() => {
    if (!selection) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onRemoveKey(selection.key, selection.index);
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, onRemoveKey, onSelect]);

  const selected: Keyframe | null =
    selection && timeline[selection.key]?.[selection.index]
      ? timeline[selection.key][selection.index]
      : null;

  const step = tickStep(span);
  const ticks: number[] = [];
  for (let t = 0; t <= span + 1e-6; t += step) ticks.push(t);

  return (
    <section className={`timeline${open ? ' open' : ''}`}>
      <header className="timeline-head">
        <button className="timeline-toggle" onClick={onToggleOpen}>
          <span className="chevron">{open ? '▾' : '▸'}</span>
          <span className="title">Timeline</span>
          <span className="count">
            {keys.length === 0
              ? 'no animated parameters'
              : `${keys.length} parameter${keys.length === 1 ? '' : 's'} · ${total} keyframe${total === 1 ? '' : 's'}`}
          </span>
        </button>

        {open && (
          <div className="timeline-tools">
            <button onClick={() => onJump(-1)} title="Previous keyframe (,)" disabled={!total}>
              ◀
            </button>
            <button onClick={() => onJump(1)} title="Next keyframe (.)" disabled={!total}>
              ▶
            </button>
            {selected && (
              <>
                <span className="divider" />
                <span className="sel-label">
                  {PARAM_BY_KEY[selection!.key]?.label} ={' '}
                  <strong>{formatValue(selection!.key, selected.value)}</strong> @{' '}
                  {formatTimecode(selected.t)}
                </span>
                <select
                  value={selected.ease}
                  onChange={(e) => onSetEase(selection!.key, selection!.index, e.target.value as Easing)}
                  title={EASINGS.find((e) => e.value === selected.ease)?.hint}
                >
                  {EASINGS.map((e) => (
                    <option key={e.value} value={e.value} title={e.hint}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <button
                  className="danger"
                  onClick={() => {
                    onRemoveKey(selection!.key, selection!.index);
                    onSelect(null);
                  }}
                  title="Delete keyframe (Del)"
                >
                  Delete
                </button>
              </>
            )}
            {total > 0 && (
              <>
                <span className="divider" />
                <button className="ghost" onClick={onClearAll} title="Remove every keyframe">
                  Clear all
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {open && (
        <div className="timeline-body">
          {keys.length === 0 ? (
            <p className="timeline-empty">
              Click the <span className="stopwatch-demo">◷</span> next to any parameter to start
              animating it. A keyframe is written wherever the playhead is, so scrub, change the
              value, and the change is recorded. Set a keyframe's easing to <strong>Hold</strong> for
              a hard cut rather than a fade.
            </p>
          ) : (
            <div className="timeline-grid">
              <div className="timeline-names">
                <div className="ruler-spacer" />
                {keys.map((key) => (
                  <div className="track-name" key={key} title={PARAM_BY_KEY[key]?.hint}>
                    <span>{PARAM_BY_KEY[key]?.label ?? key}</span>
                    <button
                      className="ghost"
                      title="Add a keyframe at the playhead"
                      onClick={() => onAddKeyAt(key, time)}
                    >
                      ◆
                    </button>
                    <button
                      className="ghost"
                      title="Stop animating this parameter"
                      onClick={() => onStopAnimating(key)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="timeline-lanes" ref={lanesRef}>
                <div
                  className="ruler"
                  onPointerDown={(e) => onSeek(timeFromEvent(e.clientX))}
                  role="presentation"
                >
                  {ticks.map((t) => (
                    <span className="tick" key={t} style={{ left: `${(t / span) * 100}%` }}>
                      {formatTimecode(t)}
                    </span>
                  ))}
                </div>

                {keys.map((key) => (
                  <div
                    className="track"
                    key={key}
                    onPointerDown={(e) => {
                      if ((e.target as HTMLElement).classList.contains('key')) return;
                      onSeek(timeFromEvent(e.clientX));
                      onSelect(null);
                    }}
                    onDoubleClick={(e) => onAddKeyAt(key, timeFromEvent(e.clientX))}
                    title="Click to scrub · double-click to add a keyframe"
                  >
                    {timeline[key].map((k, index) => {
                      const isSel = selection?.key === key && selection.index === index;
                      return (
                        <button
                          key={`${index}-${k.t}`}
                          className={`key${isSel ? ' selected' : ''}${k.ease === 'hold' ? ' hold' : ''}`}
                          style={{ left: `${(k.t / span) * 100}%` }}
                          title={`${formatValue(key, k.value)} @ ${formatTimecode(k.t)} · ${
                            EASINGS.find((e) => e.value === k.ease)?.label
                          }`}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onSelect({ key, index });
                            setDrag({ key, index });
                          }}
                        />
                      );
                    })}
                  </div>
                ))}

                <div className="playhead" style={{ left: `${(time / span) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
