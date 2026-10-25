import { useCallback, useEffect, useRef, useState } from 'react';
import { Param, ParamValue } from '../core/params';
import { PARAM_HELP } from '../core/help';

interface Props {
  param: Param;
  value: ParamValue;
  isDefault: boolean;
  onChange(key: string, value: ParamValue): void;
  /** Animation state, when a timeline is available. */
  animated?: boolean;
  /** A keyframe sits exactly on the playhead. */
  atKeyframe?: boolean;
  onToggleAnimate?(key: string): void;
  onAddKeyframe?(key: string): void;
}

/**
 * The stopwatch, and the keyframe marker beside it.
 *
 * Arming animation seeds a keyframe holding the current value, so switching it
 * on never changes the picture — after that, editing the value writes a
 * keyframe wherever the playhead is.
 */
function AnimateControls({
  paramKey,
  animated,
  atKeyframe,
  onToggleAnimate,
  onAddKeyframe,
}: {
  paramKey: string;
  animated?: boolean;
  atKeyframe?: boolean;
  onToggleAnimate?(key: string): void;
  onAddKeyframe?(key: string): void;
}) {
  if (!onToggleAnimate) return null;
  return (
    <>
      <button
        className={`stopwatch${animated ? ' on' : ''}`}
        onClick={() => onToggleAnimate(paramKey)}
        title={animated ? 'Stop animating this parameter' : 'Animate this parameter over time'}
      >
        ◷
      </button>
      {animated && onAddKeyframe && (
        <button
          className={`keymark${atKeyframe ? ' on' : ''}`}
          onClick={() => onAddKeyframe(paramKey)}
          title={atKeyframe ? 'Keyframe at the playhead' : 'Add a keyframe at the playhead'}
        >
          ◆
        </button>
      )}
    </>
  );
}

/** Logarithmic sliders for frequencies and times, linear for everything else. */
function toSlider(param: Param, value: number): number {
  if (param.type !== 'float' || !param.log) return value;
  const lo = Math.log(Math.max(param.min, 1e-4));
  const hi = Math.log(Math.max(param.max, param.min + 1e-3));
  return (Math.log(Math.max(value, 1e-4)) - lo) / (hi - lo);
}

function fromSlider(param: Param, t: number): number {
  if (param.type !== 'float' || !param.log) return t;
  const lo = Math.log(Math.max(param.min, 1e-4));
  const hi = Math.log(Math.max(param.max, param.min + 1e-3));
  return Math.exp(lo + t * (hi - lo));
}

function format(param: Param, value: number): string {
  if (param.type === 'int') return String(Math.round(value));
  const span = param.type === 'float' ? param.max - param.min : 1;
  const decimals = span >= 1000 ? 0 : span >= 100 ? 1 : span >= 10 ? 2 : 3;
  return value.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

/**
 * The one-line summary of what a control's numbers actually are.
 *
 * Knowing the range and the default turns a slider from a thing you drag until
 * it looks right into a thing you can reason about, and it is information the
 * UI otherwise hides — the handle position tells you nothing about the scale.
 */
function facts(param: Param): string {
  const unit = 'unit' in param && param.unit ? ` ${param.unit}` : '';
  switch (param.type) {
    case 'bool':
      return `Default: ${param.def ? 'on' : 'off'}`;
    case 'enum': {
      const current = param.options.find((o) => o.value === param.def);
      return `${param.options.length} options · default ${current?.label ?? param.def}`;
    }
    default:
      return `Range ${format(param, param.min)} to ${format(param, param.max)}${unit} · default ${format(param, param.def)}${unit}${param.type === 'float' && param.log ? ' · logarithmic' : ''}`;
  }
}

/**
 * The ⓘ affordance and the panel it opens.
 *
 * Deliberately a disclosure rather than a tooltip: these explanations run to
 * several sentences, and a native tooltip truncates, cannot be read at leisure
 * and vanishes the moment the pointer moves. The short `hint` is still on the
 * row as a tooltip for a quick hover.
 */
function InfoToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      className={`param-info-btn${open ? ' on' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      title={open ? 'Hide the explanation' : 'What does this do?'}
    >
      ⓘ
    </button>
  );
}

function InfoPanel({ param }: { param: Param }) {
  const detail = PARAM_HELP[param.key];
  return (
    <div className="param-info">
      {detail && <p>{detail}</p>}
      <p className="param-facts">
        {facts(param)}
        <code>{param.key}</code>
      </p>
    </div>
  );
}

export function ParamControl({
  param,
  value,
  isDefault,
  onChange,
  animated,
  atKeyframe,
  onToggleAnimate,
  onAddKeyframe,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitText = useCallback(
    (text: string) => {
      const n = Number(text);
      if (Number.isFinite(n)) onChange(param.key, n);
      setEditing(null);
    },
    [onChange, param.key],
  );

  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing]);

  const reset = () => {
    onChange(param.key, param.def);
  };

  const animControls = (
    <AnimateControls
      paramKey={param.key}
      animated={animated}
      atKeyframe={atKeyframe}
      onToggleAnimate={onToggleAnimate}
      onAddKeyframe={onAddKeyframe}
    />
  );

  const infoToggle = <InfoToggle open={info} onToggle={() => setInfo((v) => !v)} />;
  const infoPanel = info ? <InfoPanel param={param} /> : null;

  if (param.type === 'bool') {
    return (
      <div className={`param param-bool${animated ? ' animated' : ''}${info ? ' showing-info' : ''}`} title={param.hint}>
        <label>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(param.key, e.target.checked)}
          />
          <span className="param-label">{param.label}</span>
        </label>
        {infoToggle}
        {animControls}
        {infoPanel}
      </div>
    );
  }

  if (param.type === 'enum') {
    return (
      <div
        className={`param param-enum${animated ? ' animated' : ''}${info ? ' showing-info' : ''}`}
        title={param.hint}
      >
        <div className="param-head">
          <span className="param-label">{param.label}</span>
          {infoToggle}
          {animControls}
          <button className="reset" onClick={reset} disabled={isDefault} title="Reset to default">
            ⟲
          </button>
        </div>
        <select value={String(value)} onChange={(e) => onChange(param.key, e.target.value)}>
          {param.options.map((o) => (
            <option key={o.value} value={o.value} title={o.hint}>
              {o.label}
            </option>
          ))}
        </select>
        {param.options.find((o) => o.value === value)?.hint && (
          <p className="param-hint">{param.options.find((o) => o.value === value)?.hint}</p>
        )}
        {infoPanel}
      </div>
    );
  }

  const numeric = typeof value === 'number' ? value : param.def;
  const isLog = param.type === 'float' && !!param.log;
  const sliderValue = isLog ? toSlider(param, numeric) : numeric;
  const sliderMin = isLog ? 0 : param.min;
  const sliderMax = isLog ? 1 : param.max;
  const sliderStep = isLog ? 0.0005 : param.type === 'int' ? 1 : param.step;

  return (
    <div
      className={`param param-number${isDefault ? '' : ' modified'}${animated ? ' animated' : ''}${info ? ' showing-info' : ''}`}
      title={param.hint}
    >
      <div className="param-head">
        <span className="param-label">{param.label}</span>
        {infoToggle}
        {animControls}
        <span className="param-value">
          {editing !== null ? (
            <input
              ref={inputRef}
              className="param-entry"
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
              onBlur={(e) => commitText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button className="param-readout" onClick={() => setEditing(format(param, numeric))}>
              {format(param, numeric)}
              {param.unit ? <em>{param.unit}</em> : null}
            </button>
          )}
        </span>
        <button className="reset" onClick={reset} disabled={isDefault} title="Reset to default">
          ⟲
        </button>
      </div>
      <input
        type="range"
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        value={sliderValue}
        onChange={(e) => {
          const raw = Number(e.target.value);
          const v = isLog ? fromSlider(param, raw) : raw;
          onChange(param.key, param.type === 'int' ? Math.round(v) : v);
        }}
        onDoubleClick={reset}
      />
      {infoPanel}
    </div>
  );
}
