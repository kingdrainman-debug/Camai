import {
  PingPong,
  Target,
  Uniforms,
  createFullscreenTriangle,
  createProgram,
  createTarget,
  deleteTarget,
} from './gl';
import { Settings, bool, code, num } from '../core/params';
import { beamNormalisation, maskNormalisation } from './normalization';
import { RenderTelemetry, TubeState } from './state';
import type { FrameSource } from './backend';

import quadVert from './shaders/quad.vert.glsl?raw';
import common from './shaders/common.glsl?raw';
import ntscFrag from './shaders/ntsc.frag.glsl?raw';
import signalFrag from './shaders/signal.frag.glsl?raw';
import persistFrag from './shaders/persist.frag.glsl?raw';
import burninFrag from './shaders/burnin.frag.glsl?raw';
import brightFrag from './shaders/bright.frag.glsl?raw';
import blurFrag from './shaders/blur.frag.glsl?raw';
import tubeFrag from './shaders/tube.frag.glsl?raw';

const frag = (body: string) => `#version 300 es\n${common}\n${body}`;

export interface RenderFrame {
  settings: Settings;
  /** Media time in seconds — drives every animated effect. */
  time: number;
  /** Field counter. Interlace parity and dot-crawl phase come from this. */
  frame: number;
  /** Seconds since the previous rendered field. */
  dt: number;
  /** 0..1 smoothed programme level from the audio engine. */
  audioLevel: number;
  /** Fraction of the width showing the untouched source; >1 disables. */
  splitX: number;
  seed: number;
}

export type { RenderTelemetry } from './state';

type Programs = {
  ntsc: WebGLProgram;
  signal: WebGLProgram;
  persist: WebGLProgram;
  burnin: WebGLProgram;
  bright: WebGLProgram;
  blur: WebGLProgram;
  tube: WebGLProgram;
};

export class CrtRenderer {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private programs: Programs;
  private uniforms: Map<WebGLProgram, Uniforms> = new Map();

  private sourceTexture: WebGLTexture;
  private srcWidth = 2;
  private srcHeight = 2;

  private ntscT: Target | null = null;
  private signalT: Target | null = null;
  private screen: PingPong | null = null;
  private burn: PingPong | null = null;
  private brightT: Target | null = null;
  private blurT: Target | null = null;
  private bloomT: Target | null = null;
  private halT1: Target | null = null;
  private halT2: Target | null = null;
  private internalW = 0;
  private internalH = 0;

  // Animated state that has to persist between frames.
  // Envelopes the audio engine follows. Shared with the CPU backend so the
  // sound behaves identically whichever one is rasterising.
  private state = new TubeState();

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error(
        'WebGL2 is not available. CRTBOX needs WebGL2 — in the desktop app this should never happen; in a browser, check that hardware acceleration is enabled.',
      );
    }
    this.gl = gl;
    // Needed for RGBA16F render targets; without it we fall back to 8-bit,
    // which bands badly once halation and gamma are stacked.
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    this.vao = createFullscreenTriangle(gl);
    this.programs = {
      signal: createProgram(gl, quadVert, frag(signalFrag), 'signal'),
      ntsc: createProgram(gl, quadVert, frag(ntscFrag), 'ntsc'),
      persist: createProgram(gl, quadVert, frag(persistFrag), 'persist'),
      burnin: createProgram(gl, quadVert, frag(burninFrag), 'burnin'),
      bright: createProgram(gl, quadVert, frag(brightFrag), 'bright'),
      blur: createProgram(gl, quadVert, frag(blurFrag), 'blur'),
      tube: createProgram(gl, quadVert, frag(tubeFrag), 'tube'),
    };

    const tex = gl.createTexture();
    if (!tex) throw new Error('could not create source texture');
    this.sourceTexture = tex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  private halfFloat = false;

  private u(program: WebGLProgram): Uniforms {
    let u = this.uniforms.get(program);
    if (!u) {
      u = new Uniforms(this.gl, program);
      this.uniforms.set(program, u);
    }
    return u;
  }

  /**
   * Upload one frame of source material.
   *
   * This always reallocates with texImage2D rather than updating in place with
   * texSubImage2D, which looks wasteful and is not: uploading a <video> through
   * texSubImage2D silently writes nothing at all. The call succeeds, glGetError
   * stays clean, and the texture keeps whatever it held before — so the picture
   * is black forever while the element happily reports readyState 4 and hands
   * correct frames to drawImage. An <img> updates fine either way, which is why
   * still images worked and video did not.
   *
   * texImage2D(video) is the path browsers optimise for, so the reallocation
   * costs far less than the name suggests.
   */
  setSource(source: FrameSource | null, width: number, height: number): void {
    const gl = this.gl;
    if (!source || width < 1 || height < 1) return;
    // Bind to a known unit; without this the upload lands on whichever unit the
    // previous pass happened to leave active.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    this.srcWidth = width;
    this.srcHeight = height;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  get sourceSize(): { width: number; height: number } {
    return { width: this.srcWidth, height: this.srcHeight };
  }

  /** (Re)allocate the intermediate buffers for a given signal resolution. */
  private ensureTargets(width: number, height: number): void {
    if (width === this.internalW && height === this.internalH) return;
    const gl = this.gl;
    this.releaseTargets();
    const half = this.halfFloat;
    const hw = Math.max(2, width >> 1);
    const hh = Math.max(2, height >> 1);
    const ew = Math.max(2, width >> 3);
    const eh = Math.max(2, height >> 3);

    this.ntscT = createTarget(gl, width, height, half);
    this.signalT = createTarget(gl, width, height, half);
    this.screen = new PingPong(gl, width, height, half);
    this.burn = new PingPong(gl, Math.max(2, width >> 2), Math.max(2, height >> 2), half);
    this.brightT = createTarget(gl, hw, hh, half);
    this.blurT = createTarget(gl, hw, hh, half);
    this.bloomT = createTarget(gl, hw, hh, half);
    this.halT1 = createTarget(gl, ew, eh, half);
    this.halT2 = createTarget(gl, ew, eh, half);
    this.screen.clear(gl);
    this.burn.clear(gl);
    this.internalW = width;
    this.internalH = height;
  }

  private releaseTargets(): void {
    const gl = this.gl;
    deleteTarget(gl, this.ntscT);
    deleteTarget(gl, this.signalT);
    deleteTarget(gl, this.brightT);
    deleteTarget(gl, this.blurT);
    deleteTarget(gl, this.bloomT);
    deleteTarget(gl, this.halT1);
    deleteTarget(gl, this.halT2);
    this.screen?.dispose(gl);
    this.burn?.dispose(gl);
    this.ntscT = this.signalT = this.brightT = this.blurT = this.bloomT = this.halT1 = this.halT2 = null;
    this.screen = this.burn = null;
    this.internalW = this.internalH = 0;
  }

  /** Reset feedback buffers — call on seek, or trails from the old scene bleed in. */
  resetHistory(): void {
    if (this.screen) this.screen.clear(this.gl);
    if (this.burn) this.burn.clear(this.gl);
  }

  triggerDegauss(now: number): void {
    this.state.triggerDegauss(now);
  }

  private draw(program: WebGLProgram, target: Target | null): void {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Update the CPU-side envelopes: hum bar position, glitch level and the
   * power-on/off animation. The audio engine reads these back so both halves
   * of the app agree about what the set is doing.
   */
  private advanceState(f: RenderFrame): RenderTelemetry {
    return this.state.advance(f.settings, f.time, f.dt, f.seed);
  }

  render(f: RenderFrame): RenderTelemetry {
    const gl = this.gl;
    const s = f.settings;
    const telemetry = this.advanceState(f);

    this.ensureTargets(this.srcWidth, this.srcHeight);
    if (!this.ntscT || !this.signalT || !this.screen || !this.burn || !this.brightT || !this.blurT ||
        !this.bloomT || !this.halT1 || !this.halT2) {
      return telemetry;
    }

    const dt = Math.max(1e-4, Math.min(f.dt, 0.25));

    /* -------- pass 0: the tape engine -------- *
     * Composite encode/decode and videotape, upstream of everything the tube
     * does. Runs first because that is the order it happened in: the signal was
     * damaged on the way to the set, and only then displayed badly. */
    {
      const p = this.programs.ntsc;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_src', 0, this.sourceTexture);
      u.v2('u_srcSize', this.srcWidth, this.srcHeight);
      u.f('u_time', f.time);
      u.f('u_frame', f.frame);
      u.f('u_seed', f.seed);

      const compositeOn = bool(s, 'composite.enabled');
      u.f('u_compositeOn', compositeOn ? 1 : 0);
      u.f('u_bandwidthScale', num(s, 'composite.bandwidthScale'));
      u.f('u_demod', code(s, 'composite.demodulation'));
      u.f('u_phaseShift', code(s, 'composite.phaseShift'));
      u.f('u_phaseShiftOffset', num(s, 'composite.phaseShiftOffset'));
      u.f('u_preemphasis', num(s, 'composite.preemphasis'));
      u.f('u_ringing', num(s, 'composite.ringing'));
      u.f('u_ringingFreq', num(s, 'composite.ringingFrequency'));
      u.f('u_ringingPower', num(s, 'composite.ringingPower'));
      u.f('u_chromaLowpassIn', num(s, 'composite.chromaLowpassIn'));
      u.f('u_chromaLowpassOut', num(s, 'composite.chromaLowpassOut'));
      u.f('u_chromaDelayH', num(s, 'composite.chromaDelayH'));
      u.f('u_chromaDelayV', num(s, 'composite.chromaDelayV'));
      u.f('u_chromaPhaseError', num(s, 'composite.chromaPhaseError'));
      u.f('u_lumaSmear', num(s, 'composite.lumaSmear'));

      const tapeOn = bool(s, 'tape.enabled');
      u.f('u_tapeOn', tapeOn ? 1 : 0);
      u.f('u_tapeSpeed', code(s, 'tape.speed'));
      u.f('u_chromaLoss', num(s, 'tape.chromaLoss'));
      u.f('u_chromaVertBlend', bool(s, 'tape.chromaVertBlend') ? 1 : 0);
      u.f('u_sharpen', num(s, 'tape.sharpen'));
      u.f('u_sharpenFreq', num(s, 'tape.sharpenFrequency'));
      u.f('u_edgeWave', num(s, 'tape.edgeWave'));
      u.f('u_edgeWaveSpeed', num(s, 'tape.edgeWaveSpeed'));
      u.f('u_edgeWaveFreq', num(s, 'tape.edgeWaveFrequency'));
      u.f('u_edgeWaveDetail', num(s, 'tape.edgeWaveDetail'));

      const vnoiseOn = bool(s, 'vnoise.enabled');
      u.f('u_noiseOn', vnoiseOn ? 1 : 0);
      u.f('u_compositeNoise', num(s, 'vnoise.compositeNoise'));
      u.f('u_compositeNoiseFreq', num(s, 'vnoise.compositeNoiseFrequency'));
      u.f('u_compositeNoiseDetail', num(s, 'vnoise.compositeNoiseDetail'));
      u.f('u_lumaNoise', num(s, 'vnoise.lumaNoise'));
      u.f('u_lumaNoiseFreq', num(s, 'vnoise.lumaNoiseFrequency'));
      u.f('u_lumaNoiseDetail', num(s, 'vnoise.lumaNoiseDetail'));
      u.f('u_chromaNoise', num(s, 'vnoise.chromaNoise'));
      u.f('u_chromaNoiseFreq', num(s, 'vnoise.chromaNoiseFrequency'));
      u.f('u_chromaNoiseDetail', num(s, 'vnoise.chromaNoiseDetail'));
      u.f('u_chromaPhaseNoise', num(s, 'vnoise.chromaPhaseNoise'));
      u.f('u_snow', num(s, 'vnoise.snow'));
      u.f('u_snowAnisotropy', num(s, 'vnoise.snowAnisotropy'));

      const headOn = bool(s, 'headswitch.enabled');
      u.f('u_headOn', headOn ? 1 : 0);
      u.f('u_headHeight', num(s, 'headswitch.height'));
      u.f('u_headOffset', num(s, 'headswitch.offset'));
      u.f('u_headShift', num(s, 'headswitch.shift'));
      u.f('u_headMidLine', bool(s, 'headswitch.midLine') ? 1 : 0);
      u.f('u_headMidLinePos', num(s, 'headswitch.midLinePosition'));
      u.f('u_headMidLineJitter', num(s, 'headswitch.midLineJitter'));
      u.f('u_tracking', num(s, 'headswitch.tracking'));
      u.f('u_trackingHeight', num(s, 'headswitch.trackingHeight'));
      u.f('u_trackingWave', num(s, 'headswitch.trackingWave'));
      u.f('u_trackingSnow', num(s, 'headswitch.trackingSnow'));

      this.draw(p, this.ntscT);
    }

    /* -------- pass 1: signal -------- */
    {
      const p = this.programs.signal;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_src', 0, this.ntscT.texture);
      u.v2('u_srcSize', this.srcWidth, this.srcHeight);
      u.f('u_time', f.time);
      u.f('u_frame', f.frame);
      u.f('u_seed', f.seed);

      u.f('u_brightness', num(s, 'picture.brightness'));
      u.f('u_contrast', num(s, 'picture.contrast'));
      u.f('u_color', num(s, 'picture.color'));
      u.f('u_tint', num(s, 'picture.tint'));
      u.f('u_sharpness', num(s, 'picture.sharpness'));

      const signalOn = bool(s, 'signal.enabled');
      u.f('u_signalOn', signalOn ? 1 : 0);
      u.f('u_path', code(s, 'signal.path'));
      u.f('u_lumaBw', num(s, 'signal.lumaBandwidth'));
      u.f('u_chromaBw', num(s, 'signal.chromaBandwidth'));
      u.f('u_chromaDelay', num(s, 'signal.chromaDelay'));
      u.f('u_dotCrawl', num(s, 'signal.dotCrawl'));
      u.f('u_crossColor', num(s, 'signal.crossColor'));
      u.f('u_ringing', num(s, 'signal.ringing'));
      u.f('u_ringingFreq', num(s, 'signal.ringingFreq'));
      u.f('u_ghosting', num(s, 'signal.ghosting'));
      u.f('u_ghostDelay', num(s, 'signal.ghostDelay'));
      u.f('u_snow', num(s, 'signal.snow'));
      u.f('u_snowSize', num(s, 'signal.snowSize'));
      u.f('u_signalLoss', num(s, 'signal.signalLoss'));
      u.f('u_interference', num(s, 'signal.interference'));
      u.f('u_interferenceFreq', num(s, 'signal.interferenceFreq'));
      u.f('u_interferenceDrift', num(s, 'signal.interferenceDrift'));

      const syncOn = bool(s, 'sync.enabled');
      u.f('u_syncOn', syncOn ? 1 : 0);
      u.f('u_hJitter', num(s, 'sync.hJitter'));
      u.f('u_jitterCorrelation', num(s, 'sync.jitterCorrelation'));
      u.f('u_tearing', num(s, 'sync.tearing'));
      u.f('u_flagging', num(s, 'sync.flagging'));
      u.f('u_headSwitch', num(s, 'sync.headSwitch'));
      u.f('u_headSwitchHeight', num(s, 'sync.headSwitchHeight'));
      u.f('u_vRoll', num(s, 'sync.vRoll'));
      u.f('u_vHold', num(s, 'sync.vHold'));
      u.f('u_timebaseWobble', num(s, 'sync.timebaseWobble'));

      const glitchOn = bool(s, 'glitch.enabled');
      u.f('u_glitchOn', glitchOn ? 1 : 0);
      u.f('u_glitchRate', num(s, 'glitch.rate'));
      u.f('u_dropout', num(s, 'glitch.dropout'));
      u.f('u_dropoutLength', num(s, 'glitch.dropoutLength'));
      u.f('u_lineRepeat', num(s, 'glitch.lineRepeat'));
      u.f('u_syncSlip', num(s, 'glitch.syncSlip'));
      u.f('u_chromaBurst', num(s, 'glitch.chromaBurst'));
      u.f('u_blockCorrupt', num(s, 'glitch.blockCorrupt'));
      u.f('u_blockSize', num(s, 'glitch.blockSize'));
      u.f('u_blockColour', num(s, 'glitch.blockColour'));
      u.f('u_posterize', num(s, 'glitch.posterize'));
      u.f('u_invert', num(s, 'glitch.invert'));

      this.draw(p, this.signalT);
    }

    /* -------- pass 2: phosphor persistence -------- */
    {
      const p = this.programs.persist;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_cur', 0, this.signalT.texture);
      u.tex('u_prev', 1, this.screen.read.texture);
      const on = bool(s, 'phosphor.enabled');
      u.f('u_persistence', on ? num(s, 'phosphor.persistence') : 0);
      u.f('u_tilt', num(s, 'phosphor.persistenceTilt'));
      u.f('u_dt', dt);
      this.draw(p, this.screen.write);
      this.screen.swap();
    }

    /* -------- pass 3: burn-in accumulator -------- */
    if (bool(s, 'faults.enabled') && num(s, 'faults.burnIn') > 0.001) {
      const p = this.programs.burnin;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_cur', 0, this.screen.read.texture);
      u.tex('u_prev', 1, this.burn.read.texture);
      u.f('u_rate', num(s, 'faults.burnInRate'));
      u.f('u_dt', dt);
      this.draw(p, this.burn.write);
      this.burn.swap();
    }

    /* -------- pass 4: bright pass -------- */
    const glowOn = bool(s, 'glow.enabled');
    {
      const p = this.programs.bright;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_src', 0, this.screen.read.texture);
      u.f('u_threshold', glowOn ? num(s, 'glow.threshold') : 1.0);
      this.draw(p, this.brightT);
    }

    /* -------- pass 5: bloom (tight) and halation (wide) -------- */
    {
      const p = this.programs.blur;
      const u = this.u(p);
      gl.useProgram(p);
      const bloomR = num(s, 'glow.bloomRadius');

      u.tex('u_src', 0, this.brightT.texture);
      u.v2('u_texel', 1 / this.brightT.width, 1 / this.brightT.height);
      u.v2('u_dir', 1, 0);
      u.f('u_radius', bloomR);
      this.draw(p, this.blurT);

      u.tex('u_src', 0, this.blurT.texture);
      u.v2('u_dir', 0, 1);
      this.draw(p, this.bloomT);

      // Halation is the same energy scattered much further, so it starts from
      // the bloom result and is blurred again at an eighth resolution.
      const halR = num(s, 'glow.halationRadius');
      u.tex('u_src', 0, this.bloomT.texture);
      u.v2('u_texel', 1 / this.halT1.width, 1 / this.halT1.height);
      u.v2('u_dir', 1, 0);
      u.f('u_radius', halR);
      this.draw(p, this.halT1);

      u.tex('u_src', 0, this.halT1.texture);
      u.v2('u_dir', 0, 1);
      this.draw(p, this.halT2);
    }

    /* -------- pass 6: the tube -------- */
    {
      const p = this.programs.tube;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_screen', 0, this.screen.read.texture);
      u.tex('u_raw', 1, this.sourceTexture);
      u.tex('u_bloom', 2, this.bloomT.texture);
      u.tex('u_halation', 3, this.halT2.texture);
      u.tex('u_burn', 4, this.burn.read.texture);

      u.v2('u_outputSize', this.canvas.width, this.canvas.height);
      u.v2('u_screenSize', this.internalW, this.internalH);
      u.f('u_srcAspect', this.srcWidth / Math.max(this.srcHeight, 1));
      u.f('u_time', f.time);
      u.f('u_frame', f.frame);
      u.f('u_seed', f.seed);
      u.f('u_splitX', f.splitX);
      u.f('u_damage', telemetry.glitch);

      const geomOn = bool(s, 'geometry.enabled');
      u.f('u_geomOn', geomOn ? 1 : 0);
      u.f('u_curvatureX', num(s, 'geometry.curvatureX'));
      u.f('u_curvatureY', num(s, 'geometry.curvatureY'));
      u.f('u_cornerRadius', num(s, 'geometry.cornerRadius'));
      u.f('u_overscan', num(s, 'geometry.overscan'));
      u.f('u_hSize', num(s, 'geometry.hSize'));
      u.f('u_vSize', num(s, 'geometry.vSize'));
      u.f('u_hPos', num(s, 'geometry.hPos'));
      u.f('u_vPos', num(s, 'geometry.vPos'));
      u.f('u_pincushion', num(s, 'geometry.pincushion'));
      u.f('u_trapezoid', num(s, 'geometry.trapezoid'));
      u.f('u_rotation', num(s, 'geometry.rotation'));
      u.f('u_aspectMode', code(s, 'geometry.aspect'));

      const beamOn = bool(s, 'beam.enabled');
      u.f('u_beamOn', beamOn ? 1 : 0);
      u.f('u_scanMode', code(s, 'beam.scanMode'));
      u.f('u_lineCount', num(s, 'beam.lineCount'));
      u.f('u_scanlineDepth', num(s, 'beam.scanlineDepth'));
      u.f('u_beamWidth', num(s, 'beam.beamWidth'));
      u.f('u_beamBloom', num(s, 'beam.beamBloom'));
      u.f('u_beamShape', num(s, 'beam.beamShape'));
      u.f('u_brightBoost', num(s, 'beam.brightBoost'));
      u.f('u_beamNorm', beamNormalisation(num(s, 'beam.beamWidth'), num(s, 'beam.beamShape')));
      u.f('u_interlaceFlicker', num(s, 'beam.interlaceFlicker'));
      u.f('u_fieldBlend', num(s, 'beam.fieldBlend'));

      const phosOn = bool(s, 'phosphor.enabled');
      u.f('u_phosphorOn', phosOn ? 1 : 0);
      u.f('u_maskType', code(s, 'phosphor.maskType'));
      u.f('u_maskPitch', num(s, 'phosphor.maskPitch'));
      u.f('u_maskStrength', num(s, 'phosphor.maskStrength'));
      u.f('u_maskBoost', num(s, 'phosphor.maskBoost'));
      u.f('u_maskNorm', maskNormalisation(code(s, 'phosphor.maskType'), num(s, 'phosphor.maskPitch'), num(s, 'phosphor.slotStagger')));
      u.f('u_slotStagger', num(s, 'phosphor.slotStagger'));
      u.f('u_gamut', num(s, 'phosphor.gamut'));

      const colourOn = bool(s, 'colour.enabled');
      u.f('u_colourOn', colourOn ? 1 : 0);
      u.f('u_temperature', num(s, 'colour.temperature'));
      u.f('u_tintGM', num(s, 'colour.tintGM'));
      u.v3(
        'u_gunGain',
        num(s, 'colour.redGain'),
        num(s, 'colour.greenGain'),
        num(s, 'colour.blueGain'),
      );
      u.v3(
        'u_gunLift',
        num(s, 'colour.redLift'),
        num(s, 'colour.greenLift'),
        num(s, 'colour.blueLift'),
      );
      u.f('u_hue', num(s, 'colour.hue'));
      u.f('u_saturation', num(s, 'colour.saturation'));
      u.f('u_vibrance', num(s, 'colour.vibrance'));
      u.f('u_chromaCrush', num(s, 'colour.chromaCrush'));
      u.f('u_colourKiller', num(s, 'colour.colourKiller'));
      u.f('u_chromaClip', num(s, 'colour.chromaClip'));

      u.f('u_reconstruct', code(s, 'picture.reconstruct'));

      u.f('u_glowOn', glowOn ? 1 : 0);
      u.f('u_bloomAmount', num(s, 'glow.bloom'));
      u.f('u_halationAmount', num(s, 'glow.halation'));
      u.f('u_halationTint', num(s, 'glow.halationTint'));
      u.f('u_diffusion', num(s, 'glow.diffusion'));
      u.f('u_vignette', num(s, 'glow.vignette'));
      u.f('u_glare', num(s, 'glow.glare'));

      const convOn = bool(s, 'convergence.enabled');
      u.f('u_convOn', convOn ? 1 : 0);
      u.v2('u_convRed', num(s, 'convergence.redX'), num(s, 'convergence.redY'));
      u.v2('u_convBlue', num(s, 'convergence.blueX'), num(s, 'convergence.blueY'));
      u.f('u_convRadial', num(s, 'convergence.radial'));
      u.f('u_focus', num(s, 'convergence.focus'));
      u.f('u_edgeFocus', num(s, 'convergence.edgeFocus'));

      const tubeOn = bool(s, 'tube.enabled');
      u.f('u_tubeOn', tubeOn ? 1 : 0);
      u.f('u_gamma', num(s, 'tube.gamma'));
      u.f('u_blackCrush', num(s, 'tube.blackCrush'));
      u.f('u_whiteClip', num(s, 'tube.whiteClip'));
      u.f('u_humBar', num(s, 'tube.humBar'));
      u.f('u_humPhase', telemetry.humPhase);
      u.f('u_humBarWidth', num(s, 'tube.humBarWidth'));
      u.f('u_agcPump', num(s, 'tube.agcPump'));
      u.f('u_psuSag', num(s, 'tube.psuSag'));
      u.f('u_flicker', num(s, 'tube.flicker'));

      const faultsOn = bool(s, 'faults.enabled');
      u.f('u_faultsOn', faultsOn ? 1 : 0);
      u.f('u_burnIn', num(s, 'faults.burnIn'));
      u.f('u_dirt', num(s, 'faults.dirt'));
      u.f('u_moire', num(s, 'faults.moire'));
      u.f('u_degauss', telemetry.degauss);
      u.f('u_powerOpen', telemetry.powerOpen);
      u.f('u_powerDot', this.state.powerDot);

      u.f('u_bezel', num(s, 'output.bezel'));
      u.f('u_bezelShadow', num(s, 'output.bezelShadow'));
      u.f('u_roomLight', num(s, 'output.roomLight'));
      u.f('u_dither', num(s, 'output.dither'));
      u.f('u_exposure', num(s, 'output.exposure'));

      const linkOn = bool(s, 'link.enabled');
      u.f('u_audioLevel', linkOn ? f.audioLevel : 0);
      u.f('u_linkBrightness', linkOn ? num(s, 'link.audioToBrightness') : 0);
      u.f('u_linkBloom', linkOn ? num(s, 'link.audioToBloom') : 0);

      this.draw(p, null);
    }

    return telemetry;
  }

  dispose(): void {
    const gl = this.gl;
    this.releaseTargets();
    gl.deleteTexture(this.sourceTexture);
    gl.deleteVertexArray(this.vao);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    this.uniforms.clear();
  }
}
