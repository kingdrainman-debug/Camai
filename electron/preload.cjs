/*
 * The only bridge between the renderer and Node.
 *
 * Deliberately narrow: no generic file-system access, no arbitrary process
 * spawning. The renderer can open a file the user picked in a dialog, write to
 * a path the user picked in a dialog, and push frames into an encode session it
 * started. That is the entire surface.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('crtbox', {
  isDesktop: true,
  platform: process.platform,
  // Set by the main process via webPreferences.additionalArguments. More
  // reliable than sniffing the URL, which does not survive loadFile cleanly.
  isBatch: process.argv.includes('--crtbox-batch'),

  openMedia: () => ipcRenderer.invoke('dialog:openMedia'),
  chooseSavePath: (defaultName, filters) =>
    ipcRenderer.invoke('dialog:save', { defaultName, filters }),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:write', { filePath, data }),
  readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),
  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),

  // Fired when the app is launched with a media file, or when a second launch
  // hands one to the window that is already open.
  onOpenFile: (handler) => {
    ipcRenderer.on('app:openFile', (_e, file) => handler(file));
  },

  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg:available'),
  encodeStart: (opts) => ipcRenderer.invoke('encode:start', opts),
  encodeFrame: (id, data) => ipcRenderer.invoke('encode:frame', id, data),
  encodeFinish: (id) => ipcRenderer.invoke('encode:finish', id),
  encodeCancel: (id) => ipcRenderer.invoke('encode:cancel', id),

  // Headless batch mode. The renderer registers its handler and then calls
  // jobReady(); the main process waits for that before dispatching, because a
  // job sent before React has mounted is a job nobody ever receives.
  onJob: (handler) => {
    ipcRenderer.on('job:run', (_e, job) => handler(job));
  },
  jobReady: () => ipcRenderer.send('job:ready'),
  jobDone: (result) => ipcRenderer.send('job:done', result),
});
