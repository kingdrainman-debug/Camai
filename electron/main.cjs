/*
 * CRTBOX desktop shell.
 *
 * The renderer is the same web app that runs at a URL; everything this process
 * adds is the stuff a browser tab is not allowed to do — real file dialogs,
 * writing to a path the user chose, and driving a bundled ffmpeg so exports can
 * be H.264/HEVC/ProRes with muxed audio instead of just WebM.
 *
 * It also implements the headless batch mode: `crtbox --input a.mp4 --output
 * b.mp4 --preset failing` renders without ever showing a window, which is what
 * makes the app usable from a script.
 */

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');

const DEV_SERVER = process.env.CRTBOX_DEV_SERVER || '';
const INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');

/* ------------------------------------------------------------------ *
 * ffmpeg discovery
 * ------------------------------------------------------------------ */

function ffmpegPath() {
  // Explicit override wins, then the bundled static build, then whatever is on
  // PATH. A missing ffmpeg is not fatal — it only removes the mp4/mov/gif
  // export targets, and WebM still works.
  if (process.env.CRTBOX_FFMPEG) return process.env.CRTBOX_FFMPEG;
  try {
    let p = require('ffmpeg-static');
    if (typeof p === 'string' && p) {
      // electron-builder unpacks native payloads next to the asar archive.
      p = p.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* not installed — fall through */
  }
  return 'ffmpeg';
}

function probeFfmpeg() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegPath(), ['-version']);
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (codeValue) => resolve(codeValue === 0));
  });
}

/* ------------------------------------------------------------------ *
 * Encoding sessions
 * ------------------------------------------------------------------ */

/** id -> { child, outputPath, audioPath, stderr } */
const sessions = new Map();

function buildArgs(opts) {
  const { format, fps, quality, outputPath, audioPath, width, height } = opts;
  const args = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0'];
  if (audioPath) args.push('-i', audioPath);

  switch (format) {
    case 'prores':
      args.push('-c:v', 'prores_ks', '-profile:v', String(quality ?? 3), '-pix_fmt', 'yuv422p10le');
      if (audioPath) args.push('-c:a', 'pcm_s16le');
      break;
    case 'hevc':
      args.push('-c:v', 'libx265', '-preset', 'medium', '-crf', String(quality ?? 20),
        '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1');
      if (audioPath) args.push('-c:a', 'aac', '-b:a', '256k');
      break;
    case 'gif':
      args.push(
        '-vf',
        `fps=${fps},scale=${width || -1}:${height || -1}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
        '-loop', '0',
      );
      break;
    default:
      args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(quality ?? 18),
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
      if (audioPath) args.push('-c:a', 'aac', '-b:a', '256k');
      break;
  }
  if (audioPath && format !== 'gif') args.push('-shortest');
  args.push(outputPath);
  return args;
}

async function encodeStart(_event, opts) {
  const id = randomUUID();
  let audioPath = null;
  if (opts.audio && opts.audio.byteLength) {
    audioPath = path.join(os.tmpdir(), `crtbox-${id}.wav`);
    fs.writeFileSync(audioPath, Buffer.from(opts.audio));
  }
  const args = buildArgs({ ...opts, audioPath });
  const child = spawn(ffmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 60_000) stderr = stderr.slice(-30_000);
  });
  const session = { child, outputPath: opts.outputPath, audioPath, stderr: () => stderr, failed: null };
  child.on('error', (err) => {
    session.failed = err.message;
  });
  sessions.set(id, session);
  return { id, outputPath: opts.outputPath };
}

function encodeFrame(_event, id, data) {
  const session = sessions.get(id);
  if (!session || session.failed) return false;
  const buf = Buffer.from(data);
  // Respect backpressure: a fast renderer will happily outrun libx264 and
  // balloon the pipe buffer into gigabytes if we ignore the return value.
  return new Promise((resolve) => {
    const ok = session.child.stdin.write(buf, () => resolve(true));
    if (ok) resolve(true);
  });
}

function encodeFinish(_event, id) {
  const session = sessions.get(id);
  if (!session) return Promise.resolve({ ok: false, error: 'unknown encode session' });
  return new Promise((resolve) => {
    session.child.on('close', (codeValue) => {
      if (session.audioPath) fs.promises.unlink(session.audioPath).catch(() => undefined);
      sessions.delete(id);
      resolve(
        codeValue === 0
          ? { ok: true, outputPath: session.outputPath }
          : { ok: false, error: session.failed || tail(session.stderr()) },
      );
    });
    session.child.stdin.end();
  });
}

function encodeCancel(_event, id) {
  const session = sessions.get(id);
  if (!session) return false;
  session.child.kill('SIGKILL');
  if (session.audioPath) fs.promises.unlink(session.audioPath).catch(() => undefined);
  sessions.delete(id);
  return true;
}

function tail(text, lines = 12) {
  return String(text || '').trim().split('\n').slice(-lines).join('\n');
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function parseCli(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const job = { params: {} };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const key = (eq >= 0 ? a.slice(2, eq) : a.slice(2)).trim();
    const value = eq >= 0 ? a.slice(eq + 1) : args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
    switch (key) {
      case 'input': job.input = value; break;
      case 'output': job.output = value; break;
      case 'preset': job.preset = value; break;
      case 'settings': job.settingsFile = value; break;
      case 'format': job.format = value; break;
      case 'fps': job.fps = Number(value); break;
      case 'quality': job.quality = Number(value); break;
      case 'seed': job.seed = Number(value); break;
      case 'start': job.start = Number(value); break;
      case 'end': job.end = Number(value); break;
      case 'scale': job.scale = Number(value); break;
      case 'resolution': job.resolution = value; break;
      case 'height': job.height = Number(value); break;
      case 'help': job.help = true; break;
      default:
        // Anything with a dot is treated as a parameter override, which means
        // every one of the ~150 effect parameters is addressable from a script
        // without this file having to know their names.
        if (key.includes('.')) job.params[key] = coerceCli(value);
        break;
    }
  }
  return job.input && job.output ? job : job.help ? job : null;
}

/**
 * A media path given as a bare argument, e.g. from "Open with CRTBOX" or from
 * dropping a file onto the exe. Distinct from the render CLI, which needs both
 * --input and --output.
 */
function initialFileFromArgv(argv) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  for (const a of args) {
    if (a.startsWith('-')) continue;
    // Electron itself passes flags and, unpackaged, the app directory.
    if (a === '.' || a === __dirname) continue;
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) return path.resolve(a);
    } catch {
      /* not a path we can use */
    }
  }
  return null;
}

function coerceCli(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== '' ? n : v;
}

const HELP = `
CRTBOX — CRT television emulation for video and audio

  crtbox                                     open the application
  crtbox --input IN --output OUT [options]    render without a window

Options
  --input PATH          source video or image
  --output PATH         destination file
  --preset NAME         built-in preset id (see docs/PRESETS.md)
  --settings PATH       preset JSON exported from the app
  --format FMT          h264 | hevc | prores | gif | webm      (default h264)
  --fps N               output frame rate                      (default: source)
  --quality N           CRF for h264/hevc, profile for ProRes  (default 18)
  --scale N             render scale, 0.25 .. 2.0              (default 1)
  --resolution R        output height: source | 480p | 576p | 720p | 1080p
                        | 1440p | 2160p | custom               (default source)
  --height N            output height, with --resolution custom
  --start S --end S     clip range in seconds
  --seed N              randomiser / noise seed
  --<group>.<param> V   override any effect parameter, e.g. --tube.humBar 0.4

Parameter names are exactly the keys used in exported preset JSON.

The rendered frame is always the shape of the tube, so --geometry.aspect
decides the output aspect ratio and --resolution decides its size. There are
never black bars baked into the file.
`;

/* ------------------------------------------------------------------ *
 * Windows
 * ------------------------------------------------------------------ */

let mainWindow = null;

function loadApp(win, query) {
  const search = query ? `?${new URLSearchParams(query).toString()}` : '';
  if (DEV_SERVER) return win.loadURL(`${DEV_SERVER}/${search}`);
  return win.loadFile(INDEX_HTML, search ? { search } : undefined);
}

function createWindow(initialFile) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1020,
    minHeight: 660,
    backgroundColor: '#0a0b0c',
    title: 'CRTBOX',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Nothing is painted until the renderer has something to show, so the
    // window appears complete rather than as a white rectangle that then
    // turns dark.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (initialFile) sendOpenFile(initialFile);
  });

  loadApp(mainWindow);
  return mainWindow;
}

function sendOpenFile(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:openFile', {
    path: filePath,
    name: path.basename(filePath),
    url: pathToUrl(filePath),
  });
}

function focusMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function log(message) {
  process.stderr.write(`crtbox: ${message}\n`);
}

async function runHeadless(job) {
  // Positioned off-screen rather than hidden. A window with `show: false` is
  // never composited, and an uncomposited <video> does not present frames — the
  // export runs to completion and every frame comes out black. Off-screen keeps
  // the decoder alive without putting anything in front of the user.
  const win = new BrowserWindow({
    show: true,
    skipTaskbar: true,
    x: -32000,
    y: -32000,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: false,
      backgroundThrottling: false,
      additionalArguments: ['--crtbox-batch'],
    },
  });

  // Anything the renderer logs goes to stderr, so a stalled batch render can be
  // diagnosed without attaching a debugger to an invisible window.
  // Every level, not just warnings: in a batch render the renderer's log is the
  // only visibility there is.
  win.webContents.on('console-message', (_e, _level, message) => {
    process.stderr.write(`crtbox: ${message}\n`);
  });

  const ready = new Promise((resolve) => ipcMain.once('job:ready', resolve));
  const done = new Promise((resolve) => {
    ipcMain.once('job:done', (_e, result) => resolve(result));
  });

  win.setIgnoreMouseEvents(true);
  log('loading renderer');
  await loadApp(win, { job: '1' });
  log('renderer loaded, waiting for it to arm');
  await Promise.race([
    ready,
    new Promise((_r, reject) =>
      setTimeout(() => reject(new Error('renderer never became ready')), 60_000)),
  ]);
  log('dispatching job');
  win.webContents.send('job:run', job);

  const result = await done;
  log('job finished');
  win.destroy();
  return result;
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('dialog:openMedia', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Open video or image',
      properties: ['openFile'],
      filters: [
        { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = res.filePaths[0];
    return { path: filePath, name: path.basename(filePath), url: pathToUrl(filePath) };
  });

  ipcMain.handle('dialog:save', async (_e, { defaultName, filters }) => {
    const res = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: filters || [{ name: 'All files', extensions: ['*'] }],
    });
    return res.canceled ? null : res.filePath;
  });

  ipcMain.handle('fs:write', async (_e, { filePath, data }) => {
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return filePath;
  });

  ipcMain.handle('fs:read', async (_e, filePath) => {
    const buf = await fs.promises.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle('shell:reveal', (_e, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('ffmpeg:available', () => probeFfmpeg());
  ipcMain.handle('encode:start', encodeStart);
  ipcMain.handle('encode:frame', encodeFrame);
  ipcMain.handle('encode:finish', encodeFinish);
  ipcMain.handle('encode:cancel', encodeCancel);
}

/**
 * Absolute path to a URL the renderer can load.
 *
 * This used to be hand-rolled: split on the separator, encodeURIComponent each
 * segment, join with '/'. On Linux the first segment of an absolute path is
 * empty, so it looked correct in development and in CI. On Windows the first
 * segment is the drive letter, and encodeURIComponent turns `C:` into `C%3A` —
 * so every file the user opened became file:///C%3A/… , which is not a path
 * Chromium will resolve. Opening media through the dialog or "Open with" loaded
 * nothing at all, on the one platform the app actually ships to. UNC paths came
 * out mangled too.
 *
 * pathToFileURL is the standard library's answer to all of that.
 */
function pathToUrl(p) {
  return pathToFileURL(p).href;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

const cliJob = parseCli(process.argv);

/** A file to open once the window exists — from argv, or from macOS. */
let pendingFile = cliJob ? null : initialFileFromArgv(process.argv);

// Double-clicking a second file should reuse the open window rather than
// starting a second copy of the application.
if (!cliJob && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (!cliJob) {
  app.on('second-instance', (_event, argv) => {
    const file = initialFileFromArgv(argv);
    focusMainWindow();
    if (file) sendOpenFile(file);
  });
  // macOS delivers files through an event rather than through argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) {
      focusMainWindow();
      sendOpenFile(filePath);
    } else {
      pendingFile = filePath;
    }
  });
}

if (cliJob && !cliJob.help) {
  // Batch rendering is aimed at build machines and render farms, which usually
  // have no GPU at all. Opt into the software rasteriser up front rather than
  // letting Chromium fall back to a deprecated path that silently fails to
  // create a WebGL2 context. Switches must be set before the app is ready.
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

if (cliJob && cliJob.help) {
  process.stdout.write(HELP);
  app.quit();
} else {
  app.whenReady().then(async () => {
    registerIpc();

    if (cliJob) {
      Menu.setApplicationMenu(null);
      try {
        if (cliJob.settingsFile) {
          cliJob.settings = JSON.parse(fs.readFileSync(cliJob.settingsFile, 'utf8'));
        }
        const result = await runHeadless(cliJob);
        if (result && result.ok) {
          process.stdout.write(`${result.outputPath}\n`);
          app.exit(0);
        } else {
          process.stderr.write(`crtbox: ${(result && result.error) || 'render failed'}\n`);
          app.exit(1);
        }
      } catch (err) {
        process.stderr.write(`crtbox: ${err.message}\n`);
        app.exit(1);
      }
      return;
    }

    createWindow(pendingFile);
    pendingFile = null;

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(null);
      else focusMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
