/**
 * The GPU backend.
 *
 * The camcorder's chain, as a sequence of full-screen draws in the native DV
 * raster (720 × 480 or 720 × 576), scaled to the output only at the very end:
 * an 8×8 block is 8×8 in the DV raster and about 18×18 on a 1080p output,
 * the way FILMBOX learned to size artefacts in the medium rather than on the
 * screen.
 *
 *   per field   scene → blur → blur → smear → sensor → demod
 *   per frame   dsp → chroma → fdct → blockinfo → cost → qno → dequant
 *               → idct (Y) → idct (C) → assemble
 *   per output  post (overlays after decode, capture) → [upload ×3] → present
 *
 * Everything numeric comes from cam/plan.ts, which the CPU backend reads too.
 */

import {
  Target,
  Uniforms,
  createDataTexture,
  createFullscreenTriangle,
  createProgram,
  createRgbaTexture,
  createTarget,
  deleteTarget,
  updateDataTexture,
} from './gl';
import { Settings } from '../core/params';
import { FrameState, frameState, neededTaps } from '../cam/clock';
import { Automatics } from '../cam/automatics';
import { DV_CLASS_BOUNDS, DV_QSCALE, FieldPlan, FramePlan, planFrame } from '../cam/plan';
import { DvLayout } from '../cam/dvlayout';
import type { OsdImage } from '../cam/osd';
import type { FrameSource } from './backend';
import { SOURCE_SLOTS, SourceSlots } from './sources';

import quadVert from './shaders/quad.vert.glsl?raw';
import common from './shaders/common.glsl?raw';
import codecLib from './shaders/codec.glsl?raw';
import sceneFrag from './shaders/scene.frag.glsl?raw';
import blurFrag from './shaders/blur.frag.glsl?raw';
import smearFrag from './shaders/smear.frag.glsl?raw';
import sensorFrag from './shaders/sensor.frag.glsl?raw';
import demodFrag from './shaders/demod.frag.glsl?raw';
import dspFrag from './shaders/dsp.frag.glsl?raw';
import chromaFrag from './shaders/chroma.frag.glsl?raw';
import fdctFrag from './shaders/fdct.frag.glsl?raw';
import blockinfoFrag from './shaders/blockinfo.frag.glsl?raw';
import costFrag from './shaders/cost.frag.glsl?raw';
import qnoFrag from './shaders/qno.frag.glsl?raw';
import dequantFrag from './shaders/dequant.frag.glsl?raw';
import idctFrag from './shaders/idct.frag.glsl?raw';
import assembleFrag from './shaders/assemble.frag.glsl?raw';
import postFrag from './shaders/post.frag.glsl?raw';
import updownFrag from './shaders/updown.frag.glsl?raw';
import upfdctFrag from './shaders/upfdct.frag.glsl?raw';
import upidctFrag from './shaders/upidct.frag.glsl?raw';
import presentFrag from './shaders/present.frag.glsl?raw';

const frag = (body: string, codec = false) => `#version 300 es\n${common}\n${codec ? codecLib : ''}\n${body}`;

export interface RenderFrame {
  settings: Settings;
  /** Media (source) time in seconds. */
  time: number;
  /** Exact output frame, for exports. Derived from `time` when absent. */
  outFrame?: number;
  /** Display frame counter. */
  frame: number;
  /** Seconds since the previous rendered frame. */
  dt: number;
  /** 0..1 smoothed programme level from the audio engine. */
  audioLevel: number;
  /** Fraction of the width showing the untouched source; <0 disables. */
  splitX: number;
  seed: number;
  /** The zoom is moving: the camera shows its zoom bar. */
  zoomMoving?: boolean;
}

/** What the renderer worked out about this frame that the rest of the app wants. */
export interface RenderTelemetry {
  outFrame: number;
  /** DV frame number. */
  dvFrame: number;
  /** Source time of each field. */
  capture: number;
  capture2: number;
  shutter: number;
  fNumber: number;
  gainDb: number;
  lostShare: number;
}

export const EMPTY_TELEMETRY: RenderTelemetry = {
  outFrame: 0,
  dvFrame: 0,
  capture: 0,
  capture2: 0,
  shutter: 1 / 60,
  fNumber: 2.8,
  gainDb: 0,
  lostShare: 0,
};

export function telemetryOf(plan: FramePlan): RenderTelemetry {
  const e = plan.fields[0].exposure;
  return {
    outFrame: plan.fs.outFrame,
    dvFrame: plan.fs.n,
    capture: plan.fs.fields[0].srcT,
    capture2: plan.fs.fields[1].srcT,
    shutter: e.shutter,
    fNumber: e.fNumber,
    gainDb: e.gainDb,
    lostShare: plan.fs.lostShare,
  };
}

/** Everything a decoded frame depends on besides its number and its sources. */
export function decodeKey(plan: FramePlan, settingsJson: string, versions: string): string {
  return `${plan.fs.n}|${plan.fs.seed}|${versions}|${plan.osd[0]?.key ?? ''}|${plan.osd[1]?.key ?? ''}|${settingsJson}`;
}

type ProgramName =
  | 'scene' | 'blur' | 'smear' | 'sensor' | 'demod' | 'dsp' | 'chroma' | 'fdct' | 'blockinfo' | 'cost'
  | 'qno' | 'dequant' | 'idct' | 'assemble' | 'post' | 'updown' | 'upfdct' | 'upidct' | 'present';

interface Targets {
  key: string;
  E: Target;
  B1: Target;
  B2: Target;
  smear: Target;
  F: Target;
  G: [Target, Target];
  pre: [Target, Target];
  chroma: Target;
  coef: Target;
  info: Target;
  cost: Target;
  qno: Target;
  deq: Target;
  Y: Target;
  C: Target;
  dec: [Target, Target];
  cap: Target;
  up: Target | null;
  upCoef: Target | null;
  upDec: Target | null;
}

export class CamRenderer {
  readonly gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private programs: Record<ProgramName, WebGLProgram>;
  private uniforms: Map<WebGLProgram, Uniforms> = new Map();
  private fmt: 'f32' | 'f16';

  private slots: SourceSlots<WebGLTexture>;
  private auto = new Automatics();
  private T: Targets | null = null;
  private layoutTex: { sys: number; shuffle: boolean; segMB: WebGLTexture; mbSeg: WebGLTexture } | null = null;
  private lostTex: WebGLTexture;
  private osdTex: [WebGLTexture, WebGLTexture];
  private osdKeys: [string, string] = ['', ''];
  private dummy: WebGLTexture;
  /** What each decoded-frame buffer holds, and which one is current. */
  private decKeys: [string, string] = ['', ''];
  private decN: [number, number] = [-9, -9];
  private cur = 0;
  private lastPlan: FramePlan | null = null;

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
    // The codec needs real floats: DCT coefficients run to ±1000 and are
    // quantised to steps of 1.
    if (gl.getExtension('EXT_color_buffer_float')) this.fmt = 'f32';
    else if (gl.getExtension('EXT_color_buffer_half_float')) this.fmt = 'f16';
    else throw new Error('This GPU cannot render to floating-point targets.');

    this.vao = createFullscreenTriangle(gl);
    const P = (body: string, name: string, codec = false) => createProgram(gl, quadVert, frag(body, codec), name);
    this.programs = {
      scene: P(sceneFrag, 'scene'),
      blur: P(blurFrag, 'blur'),
      smear: P(smearFrag, 'smear'),
      sensor: P(sensorFrag, 'sensor'),
      demod: P(demodFrag, 'demod'),
      dsp: P(dspFrag, 'dsp'),
      chroma: P(chromaFrag, 'chroma'),
      fdct: P(fdctFrag, 'fdct', true),
      blockinfo: P(blockinfoFrag, 'blockinfo'),
      cost: P(costFrag, 'cost', true),
      qno: P(qnoFrag, 'qno', true),
      dequant: P(dequantFrag, 'dequant', true),
      idct: P(idctFrag, 'idct', true),
      assemble: P(assembleFrag, 'assemble', true),
      post: P(postFrag, 'post'),
      updown: P(updownFrag, 'updown'),
      upfdct: P(upfdctFrag, 'upfdct'),
      upidct: P(upidctFrag, 'upidct'),
      present: P(presentFrag, 'present'),
    };

    const makeTex = () => {
      const tex = gl.createTexture();
      if (!tex) throw new Error('could not create source texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      return tex;
    };
    this.slots = new SourceSlots(Array.from({ length: SOURCE_SLOTS }, makeTex));
    this.lostTex = createDataTexture(gl, 1, 1, new Float32Array(1));
    this.osdTex = [createRgbaTexture(gl), createRgbaTexture(gl)];
    this.dummy = createRgbaTexture(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
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
   * Upload one source frame, tagged with the moment it shows.
   *
   * Always texImage2D rather than texSubImage2D: uploading a <video>
   * through texSubImage2D silently writes nothing at all — the call
   * succeeds, glGetError stays clean, and the texture keeps whatever it
   * held before (CRTBOX, lesson 1).
   */
  setSource(source: FrameSource | null, width: number, height: number, tag = 0): void {
    const gl = this.gl;
    if (!source || width < 1 || height < 1) return;
    const slot = this.slots.claim(tag, width, height, source as CanvasImageSource);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, slot.handle);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  hasFrame(tag: number): boolean {
    return this.slots.has(tag);
  }

  get sourceSize(): { width: number; height: number } {
    return this.slots.size;
  }

  /**
   * Forget held source frames, decoded frames and the automatics' state,
   * after a scrub. Exporting is seeking, frame by frame, so everything with
   * memory has to be reset here or an export would inherit the preview's
   * exposure, white balance and concealment history (CRTBOX, lesson 3).
   */
  resetHistory(): void {
    this.slots.clear();
    this.auto.reset();
    this.decKeys = ['', ''];
    this.decN = [-9, -9];
  }

  private ensureTargets(plan: FramePlan): Targets {
    const L = plan.fs.layout;
    const up = plan.upload;
    const key = `${L.system}|${up.on ? `${up.W}x${up.H}` : 'x'}`;
    if (this.T && this.T.key === key) return this.T;
    this.releaseTargets();
    const gl = this.gl;
    const f = this.fmt;
    const W = L.W;
    const H = L.H;
    const t = (w: number, h: number) => createTarget(gl, w, h, f);
    this.T = {
      key,
      E: t(W, H),
      B1: t(W, H),
      B2: t(W, H),
      smear: t(W, 1),
      F: t(W, H / 2),
      G: [t(W, H / 2), t(W, H / 2)],
      pre: [t(W, H), t(W, H)],
      chroma: t(L.CW, L.CH),
      coef: t(L.coefW, L.coefH),
      info: t(L.coefW / 8, L.coefH / 8),
      cost: t(L.nMB, 24),
      qno: t(L.nSeg, 1),
      deq: t(L.coefW, L.coefH),
      Y: t(W, H),
      C: t(L.CW, L.CH),
      dec: [t(W, H), t(W, H)],
      cap: t(W, H),
      up: up.on ? t(up.W, up.H) : null,
      upCoef: up.on ? t(up.W, up.H) : null,
      upDec: up.on ? t(up.W, up.H) : null,
    };
    this.decKeys = ['', ''];
    this.decN = [-9, -9];
    return this.T;
  }

  private releaseTargets(): void {
    const T = this.T;
    if (!T) return;
    const gl = this.gl;
    for (const v of Object.values(T)) {
      if (Array.isArray(v)) v.forEach((x) => deleteTarget(gl, x as Target));
      else if (v && typeof v === 'object') deleteTarget(gl, v as Target);
    }
    this.T = null;
  }

  private ensureLayout(L: DvLayout, shuffle: boolean): void {
    const lt = this.layoutTex;
    if (lt && lt.sys === L.system && lt.shuffle === shuffle) return;
    const gl = this.gl;
    if (lt) {
      gl.deleteTexture(lt.segMB);
      gl.deleteTexture(lt.mbSeg);
    }
    const segMBs = shuffle ? L.segMBs : L.segMBsPlain;
    const segOf = shuffle ? L.segOfMB : L.segOfMBPlain;
    const seg = new Float32Array(L.nSeg * 5);
    for (let s = 0; s < L.nSeg; s++) for (let j = 0; j < 5; j++) seg[j * L.nSeg + s] = segMBs[s * 5 + j];
    this.layoutTex = {
      sys: L.system,
      shuffle,
      segMB: createDataTexture(gl, L.nSeg, 5, seg),
      mbSeg: createDataTexture(gl, L.nMB, 1, Float32Array.from(segOf)),
    };
  }

  private uploadOsd(i: 0 | 1, img: OsdImage | null): void {
    if (!img || this.osdKeys[i] === img.key) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.osdTex[i]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
    this.osdKeys[i] = img.key;
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

  private use(name: ProgramName): Uniforms {
    const p = this.programs[name];
    this.gl.useProgram(p);
    return this.u(p);
  }

  /** One field, from the source to linear RGB signal. */
  private renderField(plan: FramePlan, fp: FieldPlan, dst: Target): void {
    const T = this.T!;
    const W = plan.W;
    const H = plan.H;

    /* ---- scene ---- */
    {
      const u = this.use('scene');
      for (let i = 0; i < 4; i++) {
        const tag = fp.tapTags[Math.min(i, fp.tapTags.length - 1)];
        u.tex(`u_src${i}`, i, this.slots.lookup(tag).handle);
      }
      u.i('u_taps', fp.taps);
      u.i1v('u_tapSrc', fp.tapSrc);
      u.i('u_rows', fp.rows);
      u.v4v('u_view', fp.view);
      u.v2('u_raster', W, H);
      u.f('u_aspect', plan.aspect);
      u.v2('u_fit', plan.fit[0], plan.fit[1]);
      u.v2('u_dist', plan.dist[0], plan.dist[1]);
      u.f('u_ca', plan.ca);
      u.f('u_vignette', plan.vignette);
      u.f('u_circle', plan.circle);
      u.f('u_headroom', plan.headroom);
      u.v3('u_light', ...fp.light);
      u.v3('u_veil', ...fp.veil);
      u.f('u_ir', fp.ir);
      u.f('u_irSpot', plan.irSpot);
      u.f('u_eyes', plan.eyes);
      this.draw(this.programs.scene, T.E);
    }

    /* ---- the lens's softness ---- */
    let lit = T.E;
    if (fp.sigma0 > 0.05 || plan.sigmaCorner > 0.05 || plan.rim[2] > 0) {
      const u = this.use('blur');
      u.f('u_sigma0', fp.sigma0);
      u.f('u_sigmaCorner', plan.sigmaCorner);
      u.v3('u_rim', ...plan.rim);
      u.v2('u_raster', W, H);
      u.f('u_aspect', plan.aspect);
      u.tex('u_src', 0, T.E.texture);
      u.i2('u_dir', 1, 0);
      this.draw(this.programs.blur, T.B1);
      u.tex('u_src', 0, T.B1.texture);
      u.i2('u_dir', 0, 1);
      this.draw(this.programs.blur, T.B2);
      lit = T.B2;
    }

    /* ---- smear ---- */
    if (fp.sensor.smearK > 0) {
      const u = this.use('smear');
      u.tex('u_E', 0, lit.texture);
      u.i('u_H', H);
      this.draw(this.programs.smear, T.smear);
    }

    /* ---- sensor ---- */
    {
      const u = this.use('sensor');
      u.tex('u_E', 0, lit.texture);
      u.tex('u_smear', 1, T.smear.texture);
      u.i('u_parity', fp.parity);
      u.i('u_integrate', fp.sensor.integrate);
      u.i('u_sensor', fp.sensor.type);
      u.f('u_crosstalk', fp.sensor.crosstalk);
      u.f('u_well', fp.sensor.well);
      u.f('u_bloom', fp.sensor.bloom);
      u.f('u_smearK', fp.sensor.smearK);
      u.f('u_read', fp.sensor.read);
      u.f('u_shot', fp.sensor.shot);
      u.i('u_field', fp.m);
      u.i('u_seed', plan.fs.seed);
      u.i('u_H', H);
      this.draw(this.programs.sensor, T.F);
    }

    /* ---- colour ---- */
    {
      const u = this.use('demod');
      u.tex('u_F', 0, T.F.texture);
      u.i('u_sensor', fp.sensor.type);
      u.i('u_parity', fp.parity);
      u.m3('u_minv', fp.minv);
      u.f('u_gain', fp.gain);
      u.v3('u_wb', ...fp.wb);
      u.i('u_chromaTaps', 2);
      u.f('u_well', fp.sensor.well);
      this.draw(this.programs.demod, dst);
    }
  }

  /** The DSP, the codec and the tape: one decoded DV frame. */
  private renderDv(plan: FramePlan, dst: Target, prev: Target | null, prevPre: Target | null, pre: Target): void {
    const gl = this.gl;
    const T = this.T!;
    const L = plan.fs.layout;
    const d = plan.dsp;

    this.renderField(plan, plan.fields[0], T.G[0]);
    this.renderField(plan, plan.fields[1], T.G[1]);

    /* ---- dsp ---- */
    {
      const u = this.use('dsp');
      u.tex('u_G0', 0, T.G[0].texture);
      u.tex('u_G1', 1, T.G[1].texture);
      u.i('u_par0', plan.fields[0].parity);
      u.v2('u_raster', plan.W, plan.H);
      u.f('u_dz', d.dz);
      u.i('u_dzNearest', d.dzNearest);
      u.i('u_toneOn', d.toneOn);
      u.f('u_gamma', d.gamma);
      u.f('u_knee', d.knee);
      u.f('u_slope', d.slope);
      u.f('u_clip', d.clip);
      u.f('u_pedestal', d.pedestal);
      u.f('u_sat', d.sat);
      u.i('u_detailOn', d.detailOn);
      u.f('u_dGain', d.dGain);
      u.f('u_dFreq', d.dFreq);
      u.f('u_dVert', d.dVert);
      u.f('u_dCoring', d.dCoring);
      u.f('u_dLimit', d.dLimit);
      u.f('u_dDark', d.dDark);
      u.f('u_green', d.green);
      u.i('u_effect', d.effect);
      u.f('u_effectSize', d.effectSize);
      u.v2('u_fade', plan.fields[0].fade, plan.fields[1].fade);
      u.f('u_fadeWhite', d.fadeWhite);
      u.f('u_flicker', d.flicker);
      u.tex('u_prev', 2, prevPre ? prevPre.texture : this.dummy);
      u.i('u_hasPrev', prevPre && d.trail ? 1 : 0);
      u.tex('u_osd0', 3, this.osdTex[0]);
      u.tex('u_osd1', 4, this.osdTex[1]);
      u.i('u_osdPre0', plan.osdPath[0] === 0 && plan.osd[0] ? 1 : 0);
      u.i('u_osdPre1', plan.osdPath[1] === 0 && plan.osd[1] ? 1 : 0);
      this.draw(this.programs.dsp, pre);
    }

    const c = plan.codec;
    if (c.subsample) {
      const u = this.use('chroma');
      u.tex('u_pre', 0, pre.texture);
      u.i('u_cx', L.cx);
      u.i('u_cy', L.cy);
      this.draw(this.programs.chroma, T.chroma);
    }

    if (c.on) {
      this.ensureLayout(L, c.shuffle);
      const lt = this.layoutTex!;
      const codecCommon = (u: Uniforms) => {
        u.i('u_system', L.system);
        u.i('u_nMB', L.nMB);
        u.f('u_qscale', DV_QSCALE);
      };
      {
        const u = this.use('fdct');
        codecCommon(u);
        u.tex('u_pre', 0, pre.texture);
        u.tex('u_chroma', 1, T.chroma.texture);
        u.i('u_dct248', c.dct248);
        this.draw(this.programs.fdct, T.coef);
      }
      {
        const u = this.use('blockinfo');
        u.tex('u_coef', 0, T.coef.texture);
        u.i('u_classes', c.classes);
        u.v3('u_classBounds', ...DV_CLASS_BOUNDS);
        this.draw(this.programs.blockinfo, T.info);
      }
      {
        const u = this.use('cost');
        codecCommon(u);
        u.tex('u_coef', 0, T.coef.texture);
        u.tex('u_info', 1, T.info.texture);
        this.draw(this.programs.cost, T.cost);
      }
      {
        const u = this.use('qno');
        u.i('u_system', L.system);
        u.tex('u_cost', 0, T.cost.texture);
        u.tex('u_segMB', 1, lt.segMB);
        u.f('u_budget', c.budget);
        this.draw(this.programs.qno, T.qno);
      }
      {
        const u = this.use('dequant');
        codecCommon(u);
        u.tex('u_coef', 0, T.coef.texture);
        u.tex('u_info', 1, T.info.texture);
        u.tex('u_qno', 2, T.qno.texture);
        u.tex('u_mbSeg', 3, lt.mbSeg);
        this.draw(this.programs.dequant, T.deq);
      }
      {
        const u = this.use('idct');
        codecCommon(u);
        u.tex('u_deq', 0, T.deq.texture);
        u.i('u_plane', 0);
        this.draw(this.programs.idct, T.Y);
        u.i('u_plane', 1);
        this.draw(this.programs.idct, T.C);
      }
    }

    /* ---- assemble and conceal ---- */
    {
      const tp = plan.tape;
      if (tp.lost) {
        const data = new Float32Array(L.nMB);
        for (let i = 0; i < L.nMB; i++) data[i] = tp.lost[i];
        updateDataTexture(gl, this.lostTex, L.nMB, 1, data);
      }
      const u = this.use('assemble');
      u.i('u_system', L.system);
      u.i('u_nMB', L.nMB);
      u.tex('u_Y', 0, c.on ? T.Y.texture : pre.texture);
      u.tex('u_C', 1, c.on ? T.C.texture : T.chroma.texture);
      u.i('u_planes', c.on ? 1 : 0);
      u.i('u_subsample', c.subsample ? 1 : 0);
      u.i('u_cx', L.cx);
      u.i('u_cy', L.cy);
      u.i('u_linear', c.linear);
      u.tex('u_lost', 2, this.lostTex);
      u.i('u_anyLost', tp.lost ? 1 : 0);
      u.tex('u_prev', 3, prev ? prev.texture : this.dummy);
      u.i('u_hasPrev', prev ? 1 : 0);
      u.i('u_conceal', tp.conceal);
      u.f('u_clog', tp.clog);
      u.i('u_garbage', tp.garbage);
      u.i('u_dead', tp.dead);
      u.i('u_frame', plan.fs.n);
      u.i('u_seed', plan.fs.seed);
      this.draw(this.programs.assemble, dst);
    }
  }

  render(f: RenderFrame): RenderTelemetry {
    const src = this.slots.size;
    const fs = frameState({ settings: f.settings, time: f.time, outFrame: f.outFrame, seed: f.seed });
    const plan = planFrame({
      settings: f.settings,
      fs,
      srcW: src.width,
      srcH: src.height,
      thumbOf: (tag) => this.slots.lookup(tag).thumb,
      auto: this.auto,
      zoomMoving: f.zoomMoving,
      outW: this.canvas.width,
      outH: this.canvas.height,
    });
    this.lastPlan = plan;
    const T = this.ensureTargets(plan);
    this.uploadOsd(0, plan.osd[0]);
    this.uploadOsd(1, plan.osd[1]);

    // The decoded frame is reused while nothing that feeds it changes — at
    // field rate each DV frame is shown twice.
    const json = JSON.stringify(f.settings);
    const versions = neededTaps(fs)
      .map((t) => this.slots.lookup(t.tag).version)
      .join(',');
    const key = decodeKey(plan, json, versions);
    let slot = this.decKeys.indexOf(key);
    if (slot < 0) {
      // Write into the buffer that is not holding the previous frame, which
      // is what concealment and the trail effect read.
      // Animated settings change every frame, so the previous frame is found
      // by number alone.
      const prevSlot = this.decN.findIndex((n) => n === fs.n - 1);
      slot = prevSlot === 0 ? 1 : prevSlot === 1 ? 0 : 1 - this.cur;
      const prev = prevSlot >= 0 ? T.dec[prevSlot] : null;
      const prevPre = prevSlot >= 0 ? T.pre[prevSlot] : null;
      this.renderDv(plan, T.dec[slot], prev, prevPre, T.pre[slot]);
      this.decKeys[slot] = key;
      this.decN[slot] = fs.n;
    }
    this.cur = slot;
    const dec = T.dec[slot];

    /* ---- post: overlays after decode, then the capture ---- */
    {
      const p = plan.post;
      const u = this.use('post');
      u.tex('u_dec', 0, dec.texture);
      u.tex('u_osd0', 1, this.osdTex[0]);
      u.tex('u_osd1', 2, this.osdTex[1]);
      u.i('u_osdDec0', plan.osdPath[0] === 1 && plan.osd[0] ? 1 : 0);
      u.i('u_osdDec1', plan.osdPath[1] === 1 && plan.osd[1] ? 1 : 0);
      u.i('u_path', p.path);
      u.i('u_comb', p.comb);
      u.f('u_sigY', p.sigY);
      u.f('u_sigC', p.sigC);
      u.f('u_delay', p.delay);
      u.f('u_noise', p.noise);
      u.i('u_levels', p.levels);
      u.i('u_frame', fs.n);
      u.i('u_seed', fs.seed);
      u.i('u_pal', p.pal);
      this.draw(this.programs.post, T.cap);
    }

    let img = T.cap;
    let map = plan.present.map;
    if (plan.upload.on && T.up && T.upCoef && T.upDec) {
      const up = plan.upload;
      {
        const u = this.use('updown');
        u.tex('u_cap', 0, T.cap.texture);
        u.v4('u_map', ...plan.present.map);
        u.v2('u_size', up.W, up.H);
        u.i('u_par', up.par);
        this.draw(this.programs.updown, T.up);
      }
      {
        const u = this.use('upfdct');
        u.tex('u_up', 0, T.up.texture);
        this.draw(this.programs.upfdct, T.upCoef);
      }
      {
        const u = this.use('upidct');
        u.tex('u_coef', 0, T.upCoef.texture);
        u.f('u_q', up.q);
        this.draw(this.programs.upidct, T.upDec);
      }
      img = T.upDec;
      map = [0, 0, up.W, up.H];
    }

    /* ---- present ---- */
    {
      const pr = plan.present;
      const u = this.use('present');
      u.tex('u_img', 0, img.texture);
      u.v4('u_map', ...map);
      u.v2('u_out', this.canvas.width, this.canvas.height);
      u.i('u_deint', plan.upload.on ? 0 : pr.deint);
      u.i('u_field', pr.field);
      u.i('u_scaler', pr.scaler);
      u.tex('u_osd0', 1, this.osdTex[0]);
      u.tex('u_osd1', 2, this.osdTex[1]);
      u.i('u_osdDisp0', plan.osdPath[0] === 2 && plan.osd[0] ? 1 : 0);
      u.i('u_osdDisp1', plan.osdPath[1] === 2 && plan.osd[1] ? 1 : 0);
      u.v4('u_osdMap', ...pr.map);
      u.f('u_dither', pr.dither);
      u.i('u_frame', f.frame);
      u.f('u_split', f.splitX);
      u.tex('u_src', 3, this.slots.lookup(fs.fields[0].taps[0].tag).handle);
      u.v4('u_srcMap', ...plan.srcMap);
      this.draw(this.programs.present, null);
    }
    return telemetryOf(plan);
  }

  /** The quantisation number each segment was given, for the probe. */
  readQno(): Float32Array | null {
    const T = this.T;
    const plan = this.lastPlan;
    if (!T || !plan || !plan.codec.on) return null;
    const gl = this.gl;
    const n = T.qno.width;
    const out = new Float32Array(n * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.qno.fbo);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = out[i * 4];
    return q;
  }

  /** The last frame's plan, for the probe. */
  get plan(): FramePlan | null {
    return this.lastPlan;
  }

  dispose(): void {
    const gl = this.gl;
    this.releaseTargets();
    for (const h of this.slots.handles) gl.deleteTexture(h);
    gl.deleteTexture(this.lostTex);
    gl.deleteTexture(this.dummy);
    for (const t of this.osdTex) gl.deleteTexture(t);
    if (this.layoutTex) {
      gl.deleteTexture(this.layoutTex.segMB);
      gl.deleteTexture(this.layoutTex.mbSeg);
    }
    gl.deleteVertexArray(this.vao);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    this.uniforms.clear();
  }
}

export type { FrameState };
