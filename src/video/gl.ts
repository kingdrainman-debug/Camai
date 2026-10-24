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

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  half = true,
): Target {
  const texture = gl.createTexture();
  if (!texture) throw new GLError('could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const internal = half ? gl.RGBA16F : gl.RGBA8;
  const type = half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.texture);
}

/** A pair of targets that swap each frame, for feedback effects. */
export class PingPong {
  private a: Target;
  private b: Target;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, half = true) {
    this.a = createTarget(gl, width, height, half);
    this.b = createTarget(gl, width, height, half);
  }

  get read(): Target {
    return this.a;
  }

  get write(): Target {
    return this.b;
  }

  swap(): void {
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  get width(): number {
    return this.a.width;
  }

  get height(): number {
    return this.a.height;
  }

  clear(gl: WebGL2RenderingContext): void {
    for (const t of [this.a, this.b]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(gl: WebGL2RenderingContext): void {
    deleteTarget(gl, this.a);
    deleteTarget(gl, this.b);
  }
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

  tex(name: string, unit: number, texture: WebGLTexture | null): void {
    const l = this.loc(name);
    if (!l) return;
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.uniform1i(l, unit);
  }
}
