/** Minimal WebGL2 helpers: programs, full-screen quad, ping-pong framebuffers. */

export class GLError extends Error {}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
  name = 'program',
): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc, `${name}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${name}.frag`);
  const program = gl.createProgram();
  if (!program) throw new GLError(`could not create ${name}`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new GLError(`${name} link failed: ${log}`);
  }
  return program;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  name: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new GLError(`could not create shader ${name}`);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new GLError(`${name} failed to compile:\n${log}\n${numberLines(src, log)}`);
  }
  return shader;
}

/** Pull the offending lines out of a driver error message for readable logs. */
function numberLines(src: string, log: string): string {
  const match = /:(\d+):/.exec(log);
  if (!match) return '';
  const line = parseInt(match[1], 10);
  const lines = src.split('\n');
  const from = Math.max(0, line - 4);
  const to = Math.min(lines.length, line + 3);
  return lines
    .slice(from, to)
    .map((text, i) => `${String(from + i + 1).padStart(4)} | ${text}`)
    .join('\n');
}

/** A single triangle covering the viewport — cheaper than a quad, no seam. */
export function createFullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new GLError('could not create VAO');
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export interface Target {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export type TargetFormat = 'f32' | 'f16' | 'u8';

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TargetFormat | boolean = 'f32',
): Target {
  const fmt: TargetFormat = format === true ? 'f16' : format === false ? 'u8' : format;
  const texture = gl.createTexture();
  if (!texture) throw new GLError('could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const internal = fmt === 'f32' ? gl.RGBA32F : fmt === 'f16' ? gl.RGBA16F : gl.RGBA8;
  const type = fmt === 'f32' ? gl.FLOAT : fmt === 'f16' ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new GLError('could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GLError(`framebuffer incomplete (0x${status.toString(16)})`);
  }
  return { fbo, texture, width, height };
}

/** A float data texture (no filtering), for tables the shaders look up. */
export function createDataTexture(gl: WebGL2RenderingContext, width: number, height: number, data: Float32Array): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new GLError('could not create data texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Replace a data texture's contents. */
export function updateDataTexture(gl: WebGL2RenderingContext, tex: WebGLTexture, width: number, height: number, data: Float32Array): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
}

/** An 8-bit RGBA texture from raw pixels, top row first. */
export function createRgbaTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new GLError('could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.texture);
}

/** Caches uniform locations so the per-frame path does no string lookups in GL. */
export class Uniforms {
  private cache = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private gl: WebGL2RenderingContext,
    private program: WebGLProgram,
  ) {}

  private loc(name: string): WebGLUniformLocation | null {
    let l = this.cache.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.cache.set(name, l);
    }
    return l;
  }

  f(name: string, value: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, value);
  }

  i(name: string, value: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, value);
  }

  i2(name: string, x: number, y: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform2i(l, x, y);
  }

  v2(name: string, x: number, y: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform2f(l, x, y);
  }

  v3(name: string, x: number, y: number, z: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform3f(l, x, y, z);
  }

  v4(name: string, x: number, y: number, z: number, w: number): void {
    const l = this.loc(name);
    if (l) this.gl.uniform4f(l, x, y, z, w);
  }

  i1v(name: string, values: Int32Array | number[]): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1iv(l, values);
  }

  f1v(name: string, values: Float32Array | number[]): void {
    const l = this.loc(name);
    if (l) this.gl.uniform1fv(l, values);
  }

  v2v(name: string, values: Float32Array | number[]): void {
    const l = this.loc(name);
    if (l) this.gl.uniform2fv(l, values);
  }

  v4v(name: string, values: Float32Array | number[]): void {
    const l = this.loc(name);
    if (l) this.gl.uniform4fv(l, values);
  }

  /** A 3×3 matrix given row-major, as it is everywhere on the CPU side. */
  m3(name: string, rowMajor: number[]): void {
    const l = this.loc(name);
    if (!l) return;
    const m = rowMajor;
    // GLSL matrices are column-major; transpose rather than rely on the
    // transpose flag, which WebGL 1 forbade and some drivers still mishandle.
    this.gl.uniformMatrix3fv(l, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
  }

  tex(name: string, unit: number, texture: WebGLTexture | null): void {
    const l = this.loc(name);
    if (!l) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(l, unit);
  }
}
