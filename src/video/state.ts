/**
 * Per-frame state that is not pixels.
 *
 * The hum bar's position, how badly the picture is glitching, the degauss
 * envelope and the power-on animation are all computed on the CPU and read
 * back by the audio engine, so that a tear in the picture is heard as well as
 * seen. None of it depends on how the frame is actually rasterised.
 *
 * It lives here rather than inside the WebGL renderer because there are now two
 * renderers. Duplicating sixty lines of envelope logic between them would mean
 * the sound reacted differently depending on which backend was in use, which is
 * exactly the kind of difference nobody would think to test for.
 */

import { Settings, bool, num } from '../core/params';

/** State the renderer computes that the audio engine wants to follow. */
export interface RenderTelemetry {
  /** Vertical position of the hum bar, 0..1. */
  humPhase: number;
  /** 0..1 — how badly the picture is glitching right now. */
  glitch: number;
  /** Decaying degauss envelope. */
  degauss: number;
  /** 0 = collapsed, 1 = fully scanned. */
  powerOpen: number;
}

/** Cheap deterministic noise, matching the shader's hash closely enough. */
export function pseudoNoise(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

export class TubeState {
  private humPhase = 0;
  private glitch = 0;
  private degaussStart = -1e9;
  private powerChangedAt = -1e9;
  private lastPowerState = 'on';
  private powerOpen = 1;
  private _powerDot = 0;

  /** Lingering centre dot after switch-off. */
  get powerDot(): number {
    return this._powerDot;
  }

  triggerDegauss(now: number): void {
    this.degaussStart = now;
  }

  advance(s: Settings, time: number, dtRaw: number, seed: number): RenderTelemetry {
    const dt = Math.max(0, Math.min(dtRaw, 0.25));

    this.humPhase = (this.humPhase + num(s, 'tube.humBarSpeed') * dt * 0.35) % 1;
    if (this.humPhase < 0) this.humPhase += 1;

    // Mirror of the shader's glitch sources, so the audio can react to the same
    // events without reading pixels back off the GPU.
    const faultsOn = bool(s, 'sync.enabled');
    let target = 0;
    if (faultsOn) {
      const tearing = num(s, 'sync.tearing');
      const vHold = num(s, 'sync.vHold');
      const head = num(s, 'sync.headSwitch');
      const r = pseudoNoise(time * 3.1 + seed * 17.0);
      const burst = pseudoNoise(time * 0.7 + seed * 3.0);
      target =
        Math.max(0, r - (1 - tearing * 0.5)) * 2 +
        Math.max(0, burst - (1 - vHold * 0.9)) * 1.5 +
        head * 0.12;
    }
    target = Math.min(1, target + num(s, 'signal.signalLoss'));
    // Fast attack, slow release — a tear is instantaneous, the recovery is not.
    const k = target > this.glitch ? 0.75 : Math.min(1, dt * 6);
    this.glitch += (target - this.glitch) * k;

    const state = String(s['faults.powerState'] ?? 'on');
    if (state !== this.lastPowerState) {
      this.lastPowerState = state;
      this.powerChangedAt = time;
    }
    const warm = Math.max(0.05, num(s, 'faults.warmup'));
    const since = Math.max(0, time - this.powerChangedAt);
    if (state === 'warming') {
      const t = Math.min(1, since / warm);
      this.powerOpen = Math.pow(t, 0.35);
      this._powerDot = 0;
    } else if (state === 'collapsing') {
      const t = Math.min(1, since / (warm * 0.45));
      this.powerOpen = Math.pow(1 - t, 2.2);
      this._powerDot = Math.exp(-Math.max(0, since - warm * 0.45) * 1.6);
    } else {
      this.powerOpen = 1;
      this._powerDot = 0;
    }

    const degaussAge = time - this.degaussStart;
    const degauss =
      degaussAge >= 0 && degaussAge < 4
        ? num(s, 'faults.degauss') * Math.exp(-degaussAge * 1.9)
        : 0;

    return { humPhase: this.humPhase, glitch: this.glitch, degauss, powerOpen: this.powerOpen };
  }
}
