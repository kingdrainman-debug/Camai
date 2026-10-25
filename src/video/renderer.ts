import {
  Target,
  Uniforms,
  createFullscreenTriangle,
  createProgram,
  createTarget,
  deleteTarget,
} from './gl';
import { Settings } from '../core/params';
import { BufferSizes, FieldState, FrameState, bufferSizes, frameState } from '../film/clock';
import { PassParams, passParams } from '../film/passes';
import type { FrameSource } from './backend';
import { SourceSlots, placeFilmFrames, settingsKey } from './sources';

import quadVert from './shaders/quad.vert.glsl?raw';
import common from './shaders/common.glsl?raw';
import cameraFrag from './shaders/camera.frag.glsl?raw';
import downFrag from './shaders/down.frag.glsl?raw';
import blurFrag from './shaders/blur.frag.glsl?raw';
import filmFrag from './shaders/film.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';

const frag = (body: string) => `#version 300 es\n${common}\n${body}`;

export interface RenderFrame {
  settings: Settings;
  /** Media (source) time in seconds. */
  time: number;
  /** Exact output frame, for exports. Derived from `time` when absent. */
  outFrame?: number;
  /** Display frame counter — only the dither pattern uses it. */
  frame: number;
  /** Seconds since the previous rendered frame. */
  dt: number;
  /** 0..1 smoothed programme level from the audio engine. */
  audioLevel: number;
  /** Fraction of the width showing the untouched source; <0 disables. */
  splitX: number;
  seed: number;
}

/** What the renderer worked out about this frame that the rest of the app wants. */
export interface RenderTelemetry {
  /** Film frame shown (first field). */
  filmFrame: number;
  /** Second field's film frame; equal to filmFrame unless this is a mixed frame. */
  filmFrame2: number;
  /** Source time each of those film frames was exposed at. */
  capture: number;
  capture2: number;
  /** Lamp brightness factor this frame. */
  lamp: number;
}

export const EMPTY_TELEMETRY: RenderTelemetry = { filmFrame: 0, filmFrame2: 0, capture: 0, capture2: 0, lamp: 1 };

type Programs = {
  camera: WebGLProgram;
  down: WebGLProgram;
  blur: WebGLProgram;
  film: WebGLProgram;
  present: WebGLProgram;
};

interface FilmSlot {
  target: Target | null;
  key: string;
}

export class FilmRenderer {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private programs: Programs;
  private uniforms: Map<WebGLProgram, Uniforms> = new Map();
  private halfFloat = false;

  private slots: SourceSlots<WebGLTexture>;

  private sizes: BufferSizes | null = null;
  private E: Target | null = null;
  private Q: Target | null = null;
  private T1: Target | null = null;
  private H: Target | null = null;
  private Qs: Target | null = null;
  private T2: Target | null = null;
  private V: Target | null = null;
  private T3: Target | null = null;
  private T4: Target | null = null;
  private S: Target | null = null;
  private film: [FilmSlot, FilmSlot] = [
    { target: null, key: '' },
    { target: null, key: '' },
  ];

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
        'WebGL2 is not available. In the desktop app this should never happen; in a browser, check that hardware acceleration is enabled.',
      );
    }
    this.gl = gl;
    // Densities and exposures need more than 8 bits: a print's blacks are at
    // density 3–4 and a highlight's exposure is many times grey.
    this.halfFloat = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    this.vao = createFullscreenTriangle(gl);
    this.programs = {
      camera: createProgram(gl, quadVert, frag(cameraFrag), 'camera'),
      down: createProgram(gl, quadVert, frag(downFrag), 'down'),
      blur: createProgram(gl, quadVert, frag(blurFrag), 'blur'),
      film: createProgram(gl, quadVert, frag(filmFrag), 'film'),
      present: createProgram(gl, quadVert, frag(presentFrag), 'present'),
    };

    const makeTex = () => {
      const tex = gl.createTexture();
      if (!tex) throw new Error('could not create source texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return tex;
    };
    this.slots = new SourceSlots([makeTex(), makeTex()]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  private u(program: WebGLProgram): Uniforms {
    let u = this.uniforms.get(program);
    if (!u) {
      u = new Uniforms(this.gl, program);
      this.uniforms.set(program, u);
    }
    return u;
  }

  /**
   * Upload one frame of source material, tagged with the film frame it is
   * for. Two are kept, because a pulldown frame needs two film frames at once.
   *
   * This always reallocates with texImage2D rather than updating in place with
   * texSubImage2D: uploading a <video> through texSubImage2D silently writes
   * nothing at all. The call succeeds, glGetError stays clean, and the texture
   * keeps whatever it held before — so the picture is black forever while the
   * element happily reports readyState 4. texImage2D(video) is the path
   * browsers optimise for, so the reallocation costs far less than it sounds.
   */
  setSource(source: FrameSource | null, width: number, height: number, filmFrame = 0): void {
    const gl = this.gl;
    if (!source || width < 1 || height < 1) return;
    const slot = this.slots.claim(filmFrame, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slot.handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  hasFrame(filmFrame: number): boolean {
    return this.slots.has(filmFrame);
  }

  get sourceSize(): { width: number; height: number } {
    return this.slots.size;
  }

  private ensureTargets(sizes: BufferSizes, pp: PassParams): void {
    const s = this.sizes;
    if (s && s.eW === sizes.eW && s.eH === sizes.eH && s.fW === sizes.fW && s.fH === sizes.fH) return;
    const gl = this.gl;
    this.releaseTargets();
    const half = this.halfFloat;
    this.E = createTarget(gl, sizes.eW, sizes.eH, half);
    this.Q = createTarget(gl, pp.qW, pp.qH, half);
    this.T1 = createTarget(gl, pp.qW, pp.qH, half);
    this.H = createTarget(gl, pp.qW, pp.qH, half);
    this.Qs = createTarget(gl, pp.vW, pp.vH, half);
    this.T2 = createTarget(gl, pp.vW, pp.vH, half);
    this.V = createTarget(gl, pp.vW, pp.vH, half);
    this.T3 = createTarget(gl, pp.qW, pp.qH, half);
    this.T4 = createTarget(gl, pp.qW, pp.qH, half);
    this.S = createTarget(gl, pp.qW, pp.qH, half);
    this.film[0] = { target: createTarget(gl, sizes.fW, sizes.fH, half), key: '' };
    this.film[1] = { target: createTarget(gl, sizes.fW, sizes.fH, half), key: '' };
    this.sizes = { ...sizes };
  }

  private releaseTargets(): void {
    const gl = this.gl;
    for (const t of [this.E, this.Q, this.T1, this.H, this.Qs, this.T2, this.V, this.T3, this.T4, this.S]) {
      deleteTarget(gl, t);
    }
    for (const f of this.film) deleteTarget(gl, f.target);
    this.E = this.Q = this.T1 = this.H = this.Qs = this.T2 = this.V = this.T3 = this.T4 = this.S = null;
    this.film = [
      { target: null, key: '' },
      { target: null, key: '' },
    ];
    this.sizes = null;
  }

  /**
   * Forget held source frames and cached film frames, after a scrub. Nothing
   * in the film chain accumulates from one frame to the next — every effect
   * is a function of the frame number — so this is only ever about which
   * picture is held, never about trails or feedback, and an export that
   * steps by seeking gets exactly what playback would have shown.
   */
  resetHistory(): void {
    for (const f of this.film) f.key = '';
    this.slots.clear();
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

  private blur(src: Target, dst: Target, sigma: number, dx: number, dy: number): void {
    const p = this.programs.blur;
    const u = this.u(p);
    this.gl.useProgram(p);
    u.tex('u_src', 0, src.texture);
    u.v2('u_texel', 1 / src.width, 1 / src.height);
    u.v2('u_dir', dx, dy);
    u.f('u_radius', sigma);
    this.draw(p, dst);
  }

  private down(src: Target, dst: Target, threshold: number): void {
    const p = this.programs.down;
    const u = this.u(p);
    this.gl.useProgram(p);
    u.tex('u_src', 0, src.texture);
    u.v2('u_srcTexel', 1 / src.width, 1 / src.height);
    u.f('u_threshold', threshold);
    this.draw(p, dst);
  }

  /** Expose, develop and print one film frame into a film slot. */
  private renderFilmFrame(fs: FrameState, field: FieldState, pp: PassParams, dst: Target, source: WebGLTexture): void {
    const gl = this.gl;
    const g = fs.geometry;
    const tone = fs.tone;
    const E = this.E!;

    /* ---- the camera ---- */
    {
      const p = this.programs.camera;
      const u = this.u(p);
      gl.useProgram(p);
      u.tex('u_src', 0, source);
      u.v2('u_eSizeMm', pp.eSizeMm[0], pp.eSizeMm[1]);
      u.v2('u_apMm', g.apW, g.apH);
      u.f('u_squeeze', g.squeeze);
      u.f('u_srcAspect', g.srcAspect);
      u.f('u_halfDiag', pp.halfDiag);
      u.f('u_sigmaMm', fs.lensSigmaMm);
      u.f('u_srcPxMm', pp.srcPxMm);
      u.f('u_corner', fs.cornerSoft);
      u.f('u_vignette', fs.vignette);
      u.f('u_ca', fs.caRel);
      u.f('u_distortion', fs.distortion);
      u.f('u_headroom', tone.headroom);
      this.draw(p, E);
    }

    /* ---- halation, veiling flare and streaks, from the exposure ---- */
    this.down(E, this.Q!, 0);
    this.blur(this.Q!, this.T1!, pp.halSigmaQ, 1, 0);
    this.blur(this.T1!, this.H!, pp.halSigmaQ, 0, 1);
    this.down(this.Q!, this.Qs!, 0);
    this.blur(this.Qs!, this.T2!, pp.veilSigmaV, 1, 0);
    this.blur(this.T2!, this.V!, pp.veilSigmaV, 0, 1);
    this.down(E, this.T3!, Math.max(pp.streakThreshold, 1e-6));
    this.blur(this.T3!, this.T4!, pp.streakSigmaQ, 1, 0);
    this.blur(this.T4!, this.S!, pp.streakSigmaQ, 1, 0);

    /* ---- the film ---- */
    const p = this.programs.film;
    const u = this.u(p);
    gl.useProgram(p);
    u.tex('u_E', 0, E.texture);
    u.tex('u_H', 1, this.H!.texture);
    u.tex('u_V', 2, this.V!.texture);
    u.tex('u_S', 3, this.S!.texture);
    u.v2('u_apMm', g.apW, g.apH);
    u.v2('u_fSizeMm', pp.fSizeMm[0], pp.fSizeMm[1]);
    u.v2('u_eSizeMm', pp.eSizeMm[0], pp.eSizeMm[1]);
    u.f('u_pixUm', pp.fPixUm);
    u.f('u_gateRadius', g.gauge.gateRadius);

    u.v2('u_camWeave', field.camWeave[0], field.camWeave[1]);
    u.f('u_expStops', field.expStops);
    u.f('u_frameSeed', field.seed);
    u.f('u_frameN', field.n);
    u.f('u_splice', field.splice);
    u.f('u_spliceFlash', fs.spliceFlash);
    u.f('u_spliceKind', fs.spliceKind);
    u.f('u_cue', field.cue);
    u.f('u_leak', field.leak);
    u.f('u_leakAngle', field.leakAngle);
    u.f('u_rollFog', field.rollFog);
    u.f('u_edgeFog', fs.edgeFog);
    u.f('u_leakWarmth', fs.leakWarmth);
    u.v4v('u_scratch', field.scratches);

    u.i('u_mode', tone.mode);
    u.f('u_mono', tone.mono ? 1 : 0);
    u.v3('u_monoW', ...tone.monoWeights);
    u.v3('u_expGain', ...tone.expGain);
    u.v3('u_gamma', ...tone.gamma);
    u.v3('u_xt', ...tone.xt);
    u.v3('u_xs', ...tone.xs);
    u.f('u_toeSoft', tone.toeSoft);
    u.f('u_shoulderSoft', tone.shoulderSoft);
    u.v3('u_dmin', ...tone.dmin);
    u.v3('u_dmax', ...tone.dmax);
    u.f('u_interimage', tone.interimage);
    u.v3('u_grainSigma', ...tone.grainSigma);
    u.v3('u_grainCell', ...tone.grainCell);
    u.f('u_grainRough', tone.grainRough);
    u.f('u_grainExp', tone.grainExp);
    u.f('u_grainIndep', tone.grainIndep);
    u.f('u_printSigma', tone.printSigma);
    u.f('u_printCell', tone.printCell);
    u.f('u_dupeSigma', tone.dupeSigma);
    u.v3('u_halW', ...tone.halWeights);
    u.f('u_flare', fs.flare);
    u.v3('u_flareTint', ...pp.flareTint);
    u.f('u_streak', fs.streak);
    u.v3('u_streakTint', ...pp.streakTint);

    u.i('u_process', tone.process);
    u.f('u_pMono', tone.pMono ? 1 : 0);
    u.v3('u_pGamma', ...tone.pGamma);
    u.v3('u_pXt', ...tone.pXt);
    u.v3('u_pXs', ...tone.pXs);
    u.f('u_pToeSoft', tone.pToeSoft);
    u.f('u_pShoulderSoft', tone.pShoulderSoft);
    u.v3('u_pDmin', ...tone.pDmin);
    u.v3('u_pDmax', ...tone.pDmax);
    u.v3('u_pK', ...tone.pK);
    u.v3('u_scanGrey', ...tone.scanGrey);
    u.f('u_scanRatio', tone.scanRatio);
    u.i('u_generations', tone.generations);
    u.f('u_bleach', tone.bleach);

    u.f('u_aim', tone.aim);
    u.v3('u_finalDmin', ...tone.finalDmin);
    u.m3('u_dye', tone.dyeMatrix);
    u.v3('u_stain', ...tone.stain);
    u.f('u_fadeNeg', tone.fadeNegative ? 1 : 0);
    u.v3('u_layers', tone.layers[0], tone.layers[1], tone.layers[2]);
    u.v3('u_origLayers', tone.originalLayers[0], tone.originalLayers[1], tone.originalLayers[2]);
    u.v2('u_layersMono', tone.originalMono ? 1 : 0, tone.finalMono ? 1 : 0);

    u.f('u_dust', fs.dust);
    u.f('u_fibres', fs.fibres);
    u.f('u_dirtSize', fs.dirtSizeMm);
    u.f('u_dirtNeg', fs.dirtNegative);
    u.f('u_vinegar', fs.vinegar);
    u.f('u_channelling', fs.channelling);
    u.f('u_mould', fs.mould);
    u.f('u_water', fs.water);
    u.f('u_flaking', fs.flaking);
    u.f('u_seed', fs.seed);
    this.draw(p, dst);
  }

  render(f: RenderFrame): RenderTelemetry {
    const gl = this.gl;
    const src = this.slots.size;
    const fs = frameState({
      settings: f.settings,
      time: f.time,
      outFrame: f.outFrame,
      seed: f.seed,
      srcW: src.width,
      srcH: src.height,
    });
    const sizes = bufferSizes(fs.geometry, src.height, this.canvas.height);
    const pp = passParams(fs, sizes, src.height);
    this.ensureTargets(sizes, pp);

    // Render each distinct film frame the output frame needs, unless it is
    // already sitting in a slot from the previous display frame.
    const base = settingsKey(f.settings, f.seed);
    const need = fs.mixed ? [fs.fields[0], fs.fields[1]] : [fs.fields[0]];
    const keys = need.map((fd) => {
      const slot = this.slots.lookup(fd.n);
      return `${fd.n}|${slot.version}|${base}`;
    });
    const placed = placeFilmFrames(this.film.map((s) => s.key), keys, (k, i) => {
      const slot = this.slots.lookup(need[i].n);
      this.renderFilmFrame(fs, need[i], pp, this.film[k].target!, slot.handle);
      this.film[k].key = keys[i];
    });
    const tex0 = this.film[placed[0]].target!.texture;
    const tex1 = this.film[placed[placed.length - 1]].target!.texture;

    /* ---- present ---- */
    const g = fs.geometry;
    const tone = fs.tone;
    const p = this.programs.present;
    const u = this.u(p);
    gl.useProgram(p);
    u.tex('u_F0', 0, tex0);
    u.tex('u_F1', 1, tex1);
    u.tex('u_src', 2, this.slots.lookup(fs.fields[0].n).handle);
    u.v2('u_outSize', this.canvas.width, this.canvas.height);
    u.v2('u_visMm', g.visW, g.visH);
    u.v2('u_fSizeMm', pp.fSizeMm[0], pp.fSizeMm[1]);
    u.v2('u_apMm', g.apW, g.apH);
    u.f('u_squeeze', g.squeeze);
    u.f('u_srcAspect', g.srcAspect);
    u.f('u_fields', fs.interlaced ? 1 : 0);
    u.f('u_lowerFirst', fs.lowerFirst ? 1 : 0);
    const w0 = fs.fields[0];
    const w1 = fs.fields[1];
    u.v4('u_weave0', w0.projWeave[0], w0.projWeave[1], w0.projRot, w0.spliceJump);
    u.v4('u_weave1', w1.projWeave[0], w1.projWeave[1], w1.projRot, w1.spliceJump);
    u.v2('u_lamp', w0.lamp, w1.lamp);
    u.f('u_framing', fs.framingMm);
    u.f('u_pitch', g.gauge.pitch);
    u.f('u_stripL', pp.stripL);
    u.f('u_stripR', pp.stripR);
    u.v4('u_perf', ...pp.perf);
    u.v2('u_perfX', ...pp.perfX);
    u.f('u_perfPhase', pp.perfPhase);
    u.v3('u_unexposed', ...tone.unexposed);
    u.f('u_focusMm', fs.focusMm);
    u.f('u_buckleMm', fs.buckleMm);
    u.f('u_fPixMm', pp.fPixMm);
    u.f('u_hotspot', fs.hotspot);
    u.f('u_warmth', fs.warmth);
    u.f('u_audioDim', audioDim(f));
    u.v2v('u_hair', fs.hairs);
    u.f1v('u_hairW', fs.hairWidth);
    u.v4v('u_speck', fs.specks);
    u.f('u_aspect', g.outAspect);
    u.f('u_raw', tone.mode === 0 && tone.process === 2 ? 1 : 0);
    u.f('u_aim', tone.aim);
    u.f('u_tkGamma', tone.tkGamma);
    u.f('u_tkGrey', tone.tkGrey);
    u.f('u_tkFloor', tone.tkFloor);
    u.f('u_tkBlack', tone.tkBlack);
    u.f('u_tkSat', tone.tkSat);
    u.f('u_splitX', f.splitX);
    u.f('u_dither', Number(f.settings['framing.dither']) || 0);
    u.f('u_frame', f.frame);
    this.draw(p, null);

    return {
      filmFrame: w0.n,
      filmFrame2: w1.n,
      capture: w0.capture,
      capture2: w1.capture,
      lamp: w0.lamp,
    };
  }

  dispose(): void {
    const gl = this.gl;
    this.releaseTargets();
    for (const h of this.slots.handles) gl.deleteTexture(h);
    gl.deleteVertexArray(this.vao);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    this.uniforms.clear();
  }
}

/** How far a loud passage dims the lamp, through the shared supply. */
export function audioDim(f: RenderFrame): number {
  const s = f.settings;
  if (s['link.enabled'] !== true) return 0;
  return Math.min(0.5, f.audioLevel * (Number(s['link.audioToLamp']) || 0) * 0.3);
}
