import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULTS,
  GROUPS,
  ParamValue,
  Settings,
  sanitize,
  str,
  applyEngineMasters,
} from './core/params';
import { PRESETS, parsePreset, serializePreset } from './core/presets';
import {
  EMPTY_TIMELINE,
  Timeline as TimelineData,
  beginAnimating,
  evaluateTimeline,
  isAnimated,
  moveKeyframe,
  neighbourKeyTime,
  removeKeyframe,
  sanitizeTimeline,
  countKeyframes,
  setEase,
  setKeyframe,
  stopAnimating,
} from './core/timeline';
import { Timeline } from './ui/Timeline';
import { randomize, resetGroup } from './core/random';
import { RenderTelemetry } from './video/renderer';
import { BackendChoice, BackendKind, Renderer, createRenderer } from './video/backend';
import { CrtAudioEngine } from './audio/engine';
import { GroupPanel } from './ui/GroupPanel';
import { DEFAULT_EXPORT, ExportPanel, ExportSettings } from './ui/ExportPanel';
import { encodeWav } from './export/wav';
import { renderProcessedAudio } from './export/offlineAudio';
import { startRecording } from './export/recorder';
import { canvasToBlob, padIndex, seek, zipFrames } from './export/frames';
import { desktop, isBatchMode, saveBlob } from './platform/desktop';
import { outputSize, tubeAspect, upscaleFactor } from './core/output';
import { Guide, shouldShowOnStartup } from './ui/Guide';

type Tab = 'tape' | 'video' | 'audio' | 'link';

interface Media {
  url: string;
  name: string;
  kind: 'video' | 'image';
  /** Present when opened from the local file system (needed for audio export). */
  blob: Blob | null;
  path?: string;
}

const MAX_PREVIEW_PIXELS = 1920 * 1080;

interface ExportResult {
  ok: boolean;
  outputPath?: string;
  error?: string;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULTS });
  const [tab, setTab] = useState<Tab>('tape');
  // Advanced parameters are shown by default. Hiding two thirds of a control
  // panel behind a tickbox makes the application look smaller than it is, and
  // people reasonably conclude a control does not exist rather than going
  // looking for the switch that reveals it. Anyone who wants the shorter list
  // can still have it, and that preference is remembered.
  const [advanced, setAdvanced] = useState(() => {
    try {
      return localStorage.getItem('crtbox.hideAdvanced') !== '1';
    } catch {
      return true;
    }
  });

  const chooseAdvanced = useCallback((show: boolean) => {
    setAdvanced(show);
    try {
      if (show) localStorage.removeItem('crtbox.hideAdvanced');
      else localStorage.setItem('crtbox.hideAdvanced', '1');
    } catch {
      /* private window — the preference simply does not persist */
    }
  }, []);
  const [backendChoice, setBackendChoice] = useState<BackendChoice>(() => {
    try {
      const v = localStorage.getItem('crtbox.backend');
      return v === 'cpu' || v === 'gpu' ? v : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [backendKind, setBackendKind] = useState<BackendKind>('gpu');
  const [backendNote, setBackendNote] = useState('');
  // Batch renders have no user and must never block on a dialog.
  const [guideOpen, setGuideOpen] = useState(() => !isBatchMode && shouldShowOnStartup());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    for (const g of GROUPS) out[g.id] = ['picture', 'signal', 'beam', 'audio', 'speaker', 'link'].includes(g.id);
    return out;
  });

  const [media, setMedia] = useState<Media | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** Native source dimensions, so the output frame can be computed for the UI. */
  const [srcDims, setSrcDims] = useState({ width: 0, height: 0 });
  const [loop, setLoop] = useState(true);
  const [split, setSplit] = useState(0);
  const [timeline, setTimeline] = useState<TimelineData>(EMPTY_TIMELINE);
  const [keySelection, setKeySelection] = useState<{ key: string; index: number } | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  // A still has no clock of its own, but keyframes need somewhere to live, so
  // it gets a virtual playhead that behaves like a transport.
  const [stillTime, setStillTime] = useState(0);
  const [stillPlaying, setStillPlaying] = useState(false);
  const [seed, setSeed] = useState(1337);
  const [randomAmount, setRandomAmount] = useState(0.6);
  const [presetName, setPresetName] = useState('reference');
  const [pasteText, setPasteText] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [glError, setGlError] = useState('');
  const [audioArmed, setAudioArmed] = useState(false);

  const [exportSettings, setExportSettings] = useState<ExportSettings>(DEFAULT_EXPORT);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const engineRef = useRef<CrtAudioEngine>(new CrtAudioEngine(seed));
  const settingsRef = useRef(settings);
  const timelineRef = useRef(timeline);
  /** Settings after keyframes are applied — what the last frame actually used. */
  const activeSettingsRef = useRef(settings);
  const stillTimeRef = useRef(0);
  const stillPlayingRef = useRef(false);
  const stillDurationRef = useRef(10);
  const loopRef = useRef(true);
  const frameRef = useRef(0);
  const levelRef = useRef(0);
  const splitRef = useRef(split);
  const seedRef = useRef(seed);
  const telemetryRef = useRef<RenderTelemetry>({ humPhase: 0, glitch: 0, degauss: 0, powerOpen: 1 });
  const abortRef = useRef<AbortController | null>(null);
  // Set in headless batch mode: the destination is known up front, so the
  // export path must not stop to ask for one — there is nobody to answer.
  const batchOutputRef = useRef<string | null>(null);
  // While an export owns the canvas its size is the output resolution, and the
  // layout observer must keep its hands off.
  const exportingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // Scratch canvas for the export path's video-to-texture copy.
  const blitRef = useRef<HTMLCanvasElement | null>(null);

  settingsRef.current = settings;
  timelineRef.current = timeline;
  splitRef.current = split;
  seedRef.current = seed;
  loopRef.current = loop;
  stillDurationRef.current = exportSettings.stillDuration;

  // The batch handler is registered once, so it must not close over state. It
  // reaches the current media, duration and export callback through these refs.
  const mediaRef = useRef<Media | null>(null);
  const durationRef = useRef(0);
  mediaRef.current = media;
  durationRef.current = duration;

  /* ---------------- renderer lifecycle ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const { renderer, kind, fellBack } = createRenderer(canvas, backendChoice);
      rendererRef.current = renderer;
      setBackendKind(kind);
      setGlError('');
      setBackendNote(
        fellBack
          ? `No usable GPU (${fellBack}) — rendering on the CPU instead. It works, and it is slower.`
          : '',
      );
    } catch (err) {
      setGlError(err instanceof Error ? err.message : String(err));
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
    // A canvas keeps whichever context it was first given, so switching backend
    // remounts the element via the key below rather than reusing it.
  }, [backendChoice]);

  const chooseBackend = useCallback((next: BackendChoice) => {
    setBackendChoice(next);
    try {
      if (next === 'auto') localStorage.removeItem('crtbox.backend');
      else localStorage.setItem('crtbox.backend', next);
    } catch {
      /* private window — the choice simply does not persist */
    }
  }, []);

  /* ---------------- canvas sizing ---------------- */

  /**
   * Size the preview canvas to the frame that will actually be exported.
   *
   * The canvas used to stretch to fill the stage, which meant the preview was
   * whatever shape the window happened to be while the file came out a third
   * shape again. Containing the output aspect inside the stage makes the preview
   * the export frame: if you see no black bars, there are none in the file.
   */
  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || exportingRef.current) return;
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const src = rendererRef.current?.sourceSize ?? { width: 4, height: 3 };
    const aspect = tubeAspect(
      str(settingsRef.current, 'geometry.aspect'),
      src.width,
      src.height,
    );

    let cssW = rect.width;
    let cssH = cssW / aspect;
    if (cssH > rect.height) {
      cssH = rect.height;
      cssW = cssH * aspect;
    }
    canvas.style.width = `${Math.round(cssW)}px`;
    canvas.style.height = `${Math.round(cssH)}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.max(2, Math.floor(cssW * dpr));
    let h = Math.max(2, Math.floor(cssH * dpr));
    const pixels = w * h;
    if (pixels > MAX_PREVIEW_PIXELS) {
      const k = Math.sqrt(MAX_PREVIEW_PIXELS / pixels);
      w = Math.max(2, Math.floor(w * k));
      h = Math.max(2, Math.floor(h * k));
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  useEffect(() => {
    fitCanvas();
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(fitCanvas);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fitCanvas]);

  // The frame's shape depends on the aspect setting and on the source, so it has
  // to be recomputed when either changes and not only when the window moves.
  useEffect(() => {
    fitCanvas();
  }, [fitCanvas, settings['geometry.aspect'], media]);

  /* ---------------- one render step ---------------- */

  const renderOnce = useCallback((time: number, frame: number, dt: number, viaCanvas = false) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const video = videoRef.current;
    const image = imageRef.current;
    if (video && video.videoWidth > 0 && (viaCanvas || video.readyState >= 2)) {
      // Uploading a <video> straight to a texture is the fast path, but it is
      // not universally reliable — some compositor configurations hand
      // texImage2D nothing while drawImage still works. Bouncing through a 2D
      // canvas costs a copy and always works, so the deterministic export path
      // takes it.
      renderer.setSource(
        viaCanvas ? blitToCanvas(video, video.videoWidth, video.videoHeight, blitRef) : video,
        video.videoWidth,
        video.videoHeight,
      );
    } else if (image && image.naturalWidth > 0) {
      renderer.setSource(
        viaCanvas ? blitToCanvas(image, image.naturalWidth, image.naturalHeight, blitRef) : image,
        image.naturalWidth,
        image.naturalHeight,
      );
    }

    // Animated parameters are resolved here, once per frame, so the preview and
    // every export path see exactly the same values at the same time.
    const active = applyEngineMasters(
      evaluateTimeline(settingsRef.current, timelineRef.current, time),
    );
    activeSettingsRef.current = active;

    telemetryRef.current = renderer.render({
      settings: active,
      time,
      frame,
      dt,
      audioLevel: levelRef.current,
      splitX: splitRef.current > 0.001 ? splitRef.current : -1,
      seed: seedRef.current,
    });
  }, []);

  /* ---------------- preview loop ---------------- */

  useEffect(() => {
    let raf = 0;
    let last = performance.now() / 1000;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      // While a deterministic export is running it owns the canvas: it renders a
      // frame and then reads it back asynchronously, and a preview frame drawn
      // in between would be the one that actually got encoded.
      if (exportingRef.current) return;
      const now = performance.now() / 1000;
      const dt = Math.min(now - last, 0.1);
      last = now;

      const video = videoRef.current;
      const isVideo = !!video && !!media && media.kind === 'video';

      let time: number;
      if (isVideo) {
        time = video.currentTime;
      } else {
        // A still runs on a virtual transport so that what you scrub through
        // here is exactly what gets rendered, and keyframes have a playhead to
        // be placed against.
        if (stillPlayingRef.current) {
          const span = Math.max(0.1, stillDurationRef.current);
          let next = stillTimeRef.current + dt;
          if (next >= span) next = loopRef.current ? next % span : span;
          stillTimeRef.current = next;
        }
        time = stillTimeRef.current;
      }

      renderOnce(time, frameRef.current++, dt);

      const engine = engineRef.current;
      if (engine.ready) {
        engine.update(
          activeSettingsRef.current,
          telemetryRef.current,
          time,
          isVideo ? !video.paused : stillPlayingRef.current,
        );
        levelRef.current = engine.level();
      } else {
        levelRef.current = 0;
      }

      if (isVideo && Math.abs(video.currentTime - currentTimeRef.current) > 0.02) {
        currentTimeRef.current = video.currentTime;
        setCurrentTime(video.currentTime);
      } else if (!isVideo && Math.abs(time - currentTimeRef.current) > 0.02) {
        currentTimeRef.current = time;
        setStillTime(time);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, renderOnce]);

  const currentTimeRef = useRef(0);

  /* ---------------- media loading ---------------- */

  const loadMedia = useCallback(async (next: Media) => {
    setMedia((prev) => {
      if (prev && prev.url.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      return next;
    });
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setNotice('');
    rendererRef.current?.resetHistory();
    await engineRef.current.detach();
    setAudioArmed(false);
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      const kind = file.type.startsWith('image') ? 'image' : 'video';
      await loadMedia({ url: URL.createObjectURL(file), name: file.name, kind, blob: file });
    },
    [loadMedia],
  );

  /**
   * Read a file the shell gave us and prefer a blob URL for playback.
   *
   * The bytes are read anyway — the audio export needs them — and a blob URL
   * sidesteps file:// entirely, so the dialog, "Open with" and drag-and-drop all
   * travel the same path the browser build already uses. The shell's own URL
   * stays as the fallback for a file too large or too locked to read.
   */
  const resolveSource = useCallback(
    async (file: { path: string; name: string; url: string }) => {
      let blob: Blob | null = null;
      try {
        blob = new Blob([await desktop!.readFile(file.path)]);
      } catch {
        // Without the bytes the picture still works from the shell URL; only
        // audio export needs them.
        blob = null;
      }
      return { blob, url: blob ? URL.createObjectURL(blob) : file.url };
    },
    [],
  );

  const openViaDialog = useCallback(async () => {
    if (desktop) {
      const picked = await desktop.openMedia();
      if (!picked) return;
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(picked.name) ? 'image' : 'video';
      const { blob, url } = await resolveSource(picked);
      await loadMedia({ url, name: picked.name, kind, blob, path: picked.path });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void openFile(file);
    };
    input.click();
  }, [loadMedia, openFile, resolveSource]);

  /** Open a file the desktop shell handed us — launch argument, or "Open with". */
  const openFromPath = useCallback(
    async (file: { path: string; name: string; url: string }) => {
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name) ? 'image' : 'video';
      const { blob, url } = await resolveSource(file);
      await loadMedia({ url, name: file.name, kind, blob, path: file.path });
    },
    [loadMedia, resolveSource],
  );

  useEffect(() => {
    if (!desktop?.onOpenFile || isBatchMode) return;
    desktop.onOpenFile((file) => void openFromPath(file));
  }, [openFromPath]);

  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) void openFile(file);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, [openFile]);

  /* ---------------- audio arming ---------------- */

  const armAudio = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !media || media.kind !== 'video') return;
    try {
      await engineRef.current.attach(video, settingsRef.current);
      await engineRef.current.resume();
      setAudioArmed(true);
    } catch (err) {
      setNotice(`Audio unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [media]);

  const togglePlay = useCallback(async () => {
    if (media?.kind === 'image') {
      setStillPlaying((v) => {
        stillPlayingRef.current = !v;
        return !v;
      });
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (!engineRef.current.ready) await armAudio();
    if (video.paused) {
      await video.play().catch(() => undefined);
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [armAudio, media]);

  /* ---------------- settings plumbing ---------------- */

  /** Length of the thing being worked on — a still's length is chosen, not read. */
  const clipDuration = media?.kind === 'image' ? exportSettings.stillDuration : duration;
  /** Where the playhead is, whatever kind of media is loaded. */
  const playhead = media?.kind === 'image' ? stillTime : currentTime;
  const playheadRef = useRef(0);
  playheadRef.current = playhead;

  /**
   * Editing a parameter writes a keyframe when that parameter is animated, and
   * changes the base value when it is not — the same rule every editor uses.
   */
  const change = useCallback((key: string, value: ParamValue) => {
    if (isAnimated(timelineRef.current, key)) {
      setTimeline((prev) => setKeyframe(prev, key, playheadRef.current, value));
      return;
    }
    setSettings((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const toggleAnimate = useCallback((key: string) => {
    setTimeline((prev) => {
      if (isAnimated(prev, key)) {
        setKeySelection(null);
        return stopAnimating(prev, key);
      }
      setTimelineOpen(true);
      return beginAnimating(prev, key, playheadRef.current, settingsRef.current[key]);
    });
  }, []);

  const addKeyframeAt = useCallback((key: string, time: number) => {
    setTimeline((prev) => {
      // Capture the value the parameter actually has at that moment, so adding
      // a keyframe never moves anything.
      const current = evaluateTimeline(settingsRef.current, prev, time)[key];
      return setKeyframe(prev, key, time, current);
    });
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const clamped = Math.max(0, t);
      if (media?.kind === 'image') {
        stillTimeRef.current = clamped;
        currentTimeRef.current = clamped;
        setStillTime(clamped);
      } else if (videoRef.current) {
        videoRef.current.currentTime = clamped;
        setCurrentTime(clamped);
        rendererRef.current?.resetHistory();
      }
    },
    [media],
  );

  const jumpKey = useCallback(
    (direction: -1 | 1) => {
      const t = neighbourKeyTime(timelineRef.current, playheadRef.current, direction);
      if (t !== null) seekTo(t);
    },
    [seekTo],
  );

  const applyPreset = useCallback((id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setSettings({ ...preset.settings });
    setTimeline(EMPTY_TIMELINE);
    setKeySelection(null);
    setPresetName(id);
    rendererRef.current?.resetHistory();
  }, []);

  const doRandomize = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 0x7fffffff);
    setSeed(nextSeed);
    setSettings((prev) =>
      randomize(prev, {
        seed: nextSeed,
        amount: randomAmount,
        // Randomising rolls the tab you are looking at, so a wander through
        // the tape engine never quietly rearranges the tube.
        groups:
          tab === 'link'
            ? undefined
            : GROUPS.filter((g) => g.kind === tab).map((g) => g.id),
      }),
    );
    setPresetName('');
  }, [randomAmount, tab]);

  const copySettings = useCallback(async () => {
    const text = serializePreset(settings, presetName || undefined, timeline);
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Settings copied as JSON.');
    } catch {
      setPasteText(text);
      setNotice('Clipboard blocked — here is the JSON.');
    }
  }, [settings, presetName, timeline]);

  const applyPasted = useCallback(
    (text: string) => {
      const result = parsePreset(text, DEFAULTS);
      if (!result.ok || !result.settings) {
        setNotice(`Error: ${result.error}`);
        return;
      }
      setSettings(result.settings);
      setTimeline(result.timeline ?? EMPTY_TIMELINE);
      setKeySelection(null);
      setPresetName(result.name ?? '');
      setPasteText(null);
      setNotice('Settings applied.');
      rendererRef.current?.resetHistory();
    },
    [],
  );

  const savePreset = useCallback(async () => {
    const blob = new Blob([serializePreset(settings, presetName || 'preset', timeline)], {
      type: 'application/json',
    });
    const saved = await saveBlob(blob, `${presetName || 'crtbox'}.crtbox.json`, [
      { name: 'CRTBOX preset', extensions: ['json'] },
    ]);
    if (saved) setNotice(`Preset saved to ${saved}`);
  }, [settings, presetName, timeline]);

  const loadPreset = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      applyPasted(await file.text());
    };
    input.click();
  }, [applyPasted]);

  const triggerDegauss = useCallback(() => {
    const t = videoRef.current?.currentTime ?? performance.now() / 1000;
    rendererRef.current?.triggerDegauss(t);
    engineRef.current.fire('degauss', settingsRef.current['link.degaussToThump'] as number);
  }, []);

  /* ---------------- export ---------------- */

  const isStill = media?.kind === 'image';

  const exportRange = useMemo(() => {
    // A still has no timeline of its own, so its length is whatever the user
    // asked for rather than something read off the file.
    if (isStill) return { start: 0, end: Math.max(0.1, exportSettings.stillDuration) };
    const end = exportSettings.useSourceRange ? duration : exportSettings.end || duration;
    const start = exportSettings.useSourceRange ? 0 : exportSettings.start;
    return { start: Math.max(0, start), end: Math.max(start + 0.01, end) };
  }, [exportSettings, duration, isStill]);

  /**
   * The frame the current settings will produce. Shown in the export panel and
   * used to shape the preview, so there is one answer rather than three.
   */
  const previewOutput = useMemo(
    () =>
      outputSize(
        srcDims.width || 640,
        srcDims.height || 480,
        str(settings, 'geometry.aspect'),
        exportSettings.resolution,
        exportSettings.customHeight,
        exportSettings.scale,
      ),
    [
      srcDims,
      settings,
      exportSettings.resolution,
      exportSettings.customHeight,
      exportSettings.scale,
    ],
  );

  const previewUpscale = useMemo(
    () => upscaleFactor(srcDims.height || 480, previewOutput),
    [srcDims, previewOutput],
  );

  const snapshot = useCallback(async (): Promise<string | null> => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const blob = await canvasToBlob(canvas);
    // In batch mode the destination is already known, and there is nobody to
    // answer a save dialog.
    if (batchOutputRef.current && desktop) {
      await desktop.writeFile(batchOutputRef.current, await blob.arrayBuffer());
      return batchOutputRef.current;
    }
    const saved = await saveBlob(blob, `${baseName(media?.name)}-crt.png`, [
      { name: 'PNG image', extensions: ['png'] },
    ]);
    if (saved) setNotice(`Frame saved to ${saved}`);
    return saved;
  }, [media]);

  const recordRealtime = useCallback(async () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (!engineRef.current.ready) await armAudio();

    setBusy(true);
    setStatus('Recording in real time…');
    setProgress(0);

    await seek(video, exportRange.start);
    const recording = startRecording(canvas, engineRef.current.stream, { fps: exportSettings.fps });
    await video.play().catch(() => undefined);
    setPlaying(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await new Promise<void>((resolve) => {
      const check = () => {
        if (controller.signal.aborted || video.currentTime >= exportRange.end || video.ended) {
          resolve();
          return;
        }
        setProgress(
          (video.currentTime - exportRange.start) / Math.max(exportRange.end - exportRange.start, 0.01),
        );
        requestAnimationFrame(check);
      };
      check();
    });

    video.pause();
    setPlaying(false);
    const blob = await recording.stop();
    abortRef.current = null;

    const ext = recording.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const saved = await saveBlob(blob, `${baseName(media?.name)}-crt.${ext}`, [
      { name: 'Video', extensions: [ext] },
    ]);
    setBusy(false);
    setProgress(0);
    setStatus(saved ? `Saved to ${saved}` : 'Cancelled.');
  }, [armAudio, exportRange, exportSettings.fps, media]);

  const renderDeterministic = useCallback(async (): Promise<ExportResult> => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return { ok: false, error: 'renderer not ready' };
    let outcome: ExportResult = { ok: true };

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setProgress(0);
    setStatus('Preparing…');

    // The preview canvas is resized to the output resolution for the duration
    // of the render, then put back. Rendering at preview size and upscaling
    // would move the mask pitch and the scanline count relative to the picture,
    // which is exactly the thing that must not change.
    const savedW = canvas.width;
    const savedH = canvas.height;
    const savedTime = videoRef.current?.currentTime ?? 0;
    const wasPlaying = playing;
    videoRef.current?.pause();
    setPlaying(false);

    try {
      // Take the dimensions from the decoder, not from whatever the renderer
      // last happened to see: a hidden window (headless batch mode) never runs
      // requestAnimationFrame, so the preview loop may not have uploaded a
      // single frame yet and the renderer would still report its 2x2 placeholder.
      const video0 = videoRef.current;
      const image0 = imageRef.current;
      const src =
        video0 && video0.videoWidth > 0
          ? { width: video0.videoWidth, height: video0.videoHeight }
          : image0 && image0.naturalWidth > 0
            ? { width: image0.naturalWidth, height: image0.naturalHeight }
            : renderer.sourceSize;
      if (src.width < 4 || src.height < 4) {
        throw new Error('could not determine the source resolution');
      }
      const out = outputSize(
        src.width,
        src.height,
        str(settingsRef.current, 'geometry.aspect'),
        exportSettings.resolution,
        exportSettings.customHeight,
        exportSettings.scale,
      );
      const outW = out.width;
      const outH = out.height;
      exportingRef.current = true;
      canvas.width = outW;
      canvas.height = outH;

      // ---- audio ----
      let wav: Blob | null = null;
      if ((media?.blob || isStill) && exportSettings.format !== 'gif') {
        setStatus('Rendering audio…');
        const batch = !!batchOutputRef.current;
        // Offline audio can stall indefinitely on a container with no audio
        // device, or on a file `decodeAudioData` cannot handle. A silent video
        // is a far better outcome than an export that never finishes, so the
        // whole stage is bounded and failure is reported rather than thrown.
        const buffer = await withTimeout(
          renderProcessedAudio(isStill ? null : media?.blob ?? null, settingsRef.current, {
            seed: seedRef.current,
            start: exportRange.start,
            end: exportRange.end,
            duration: exportRange.end - exportRange.start,
            timeline: timelineRef.current,
            onStage: batch ? (stage) => console.info(`audio: ${stage}`) : undefined,
          }),
          AUDIO_RENDER_TIMEOUT_MS,
        ).catch((err) => {
          const why = err instanceof Error ? err.message : String(err);
          setNotice(`Audio was not rendered (${why}); exporting the picture only.`);
          if (batch) console.info(`audio: skipped (${why})`);
          return null;
        });
        if (buffer) wav = encodeWav(buffer, exportSettings.format === 'wav' ? 24 : 16);
        else if (batch) console.info('audio: none');
      }

      if (exportSettings.format === 'wav') {
        if (!wav) throw new Error('no decodable audio track in the source');
        const saved = await saveBlob(wav, `${baseName(media?.name)}-crt.wav`, [
          { name: 'WAV audio', extensions: ['wav'] },
        ]);
        setStatus(saved ? `Saved to ${saved}` : 'Cancelled.');
        return (outcome = saved ? { ok: true, outputPath: saved } : { ok: false, error: 'cancelled' });
      }

      const video = videoRef.current;
      const image = imageRef.current;
      if (!video && !image) throw new Error('nothing is loaded');

      // Preflight. An entirely black export is the worst failure mode there is —
      // it wastes the whole render and still looks like a success — so both the
      // decode and the render are checked on one frame before committing.
      if (video) {
        await seek(video, exportRange.start);
        if (
          video.videoWidth < 2 ||
          !hasContent(blitToCanvas(video, video.videoWidth, video.videoHeight, blitRef))
        ) {
          throw new Error(
            'the video decoder is not presenting frames — try a different container, or use "Record in real time"',
          );
        }
      }
      renderOnce(exportRange.start, 0, 1 / exportSettings.fps, true);
      if (!hasContent(canvas)) {
        throw new Error(
          'the source decodes but the CRT pipeline rendered a blank frame. This is usually a GPU driver that cannot run the pipeline at the requested output size — try a smaller render scale, or use "Record in real time".',
        );
      }

      renderer.resetHistory();
      const dt = 1 / exportSettings.fps;
      const total = Math.max(1, Math.round((exportRange.end - exportRange.start) * exportSettings.fps));

      // A still has nothing to seek — the clock still advances, so every
      // time-varying effect (drift, hum bar, snow, jitter) animates over it and
      // the output is a moving picture rather than a repeated frame.
      const stepTo = async (i: number) => {
        const t = exportRange.start + i * dt;
        if (video) await seek(video, t);
        renderOnce(t, i, dt, true);
      };

      // ---- desktop: stream PNGs into ffmpeg ----
      if (desktop && exportSettings.format !== 'pngseq') {
        const ext = exportSettings.format === 'prores' ? 'mov' : exportSettings.format === 'gif' ? 'gif' : 'mp4';
        const target =
          batchOutputRef.current ??
          (await desktop.chooseSavePath(`${baseName(media?.name)}-crt.${ext}`, [
            { name: 'Video', extensions: [ext] },
          ]));
        if (!target) {
          setStatus('Cancelled.');
          return (outcome = { ok: false, error: 'cancelled' });
        }
        setStatus('Encoding…');
        if (batchOutputRef.current) console.info(`encoding ${total} frames at ${outW}x${outH} -> ${target}`);
        const session = await desktop.encodeStart({
          format: exportSettings.format as 'h264' | 'hevc' | 'prores' | 'gif',
          fps: exportSettings.fps,
          quality: exportSettings.quality,
          outputPath: target,
          width: outW,
          height: outH,
          audio: wav ? await wav.arrayBuffer() : null,
        });

        for (let i = 0; i < total; i++) {
          if (controller.signal.aborted) {
            await desktop.encodeCancel(session.id);
            setStatus('Cancelled.');
            return (outcome = { ok: false, error: 'cancelled' });
          }
          await stepTo(i);
          const blob = await canvasToBlob(canvas);
          await desktop.encodeFrame(session.id, await blob.arrayBuffer());
          setProgress((i + 1) / total);
          setStatus(`Encoding frame ${i + 1} of ${total}…`);
          // Batch renders have no UI, so progress goes to the console, which
          // the main process forwards to stderr.
          if (batchOutputRef.current) console.info(`frame ${i + 1}/${total}`);
        }

        const result = await desktop.encodeFinish(session.id);
        setStatus(result.ok ? `Saved to ${result.outputPath}` : `Error: ${result.error}`);
        if (result.outputPath && result.ok && !batchOutputRef.current) void desktop.reveal(result.outputPath);
        return (outcome = result.ok
          ? { ok: true, outputPath: result.outputPath }
          : { ok: false, error: result.error ?? 'encoding failed' });
      }

      // ---- browser (or explicit PNG sequence): zip the frames ----
      const files: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) {
          setStatus('Cancelled.');
          return (outcome = { ok: false, error: 'cancelled' });
        }
        await stepTo(i);
        const blob = await canvasToBlob(canvas);
        files.push({ name: `frames/${padIndex(i)}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        setProgress((i + 1) / total);
        setStatus(`Rendering frame ${i + 1} of ${total}…`);
      }

      setStatus('Packing…');
      const extra: { name: string; data: Uint8Array }[] = [
        {
          name: 'settings.crtbox.json',
          data: new TextEncoder().encode(
            serializePreset(settingsRef.current, presetName || undefined, timelineRef.current),
          ),
        },
      ];
      if (wav) extra.push({ name: 'audio.wav', data: new Uint8Array(await wav.arrayBuffer()) });
      const zipBlob = await zipFrames(files, extra);
      const saved = await saveBlob(zipBlob, `${baseName(media?.name)}-crt-frames.zip`, [
        { name: 'Zip archive', extensions: ['zip'] },
      ]);
      setStatus(saved ? `Saved to ${saved}` : 'Cancelled.');
      outcome = saved ? { ok: true, outputPath: saved } : { ok: false, error: 'cancelled' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${error}`);
      outcome = { ok: false, error };
    } finally {
      exportingRef.current = false;
      canvas.width = savedW;
      canvas.height = savedH;
      fitCanvas();
      renderer.resetHistory();
      if (videoRef.current) {
        await seek(videoRef.current, savedTime);
        if (wasPlaying) void videoRef.current.play().catch(() => undefined);
      }
      abortRef.current = null;
      setBusy(false);
      setProgress(0);
    }
    return outcome;
  }, [
    exportRange,
    exportSettings,
    fitCanvas,
    media,
    playing,
    presetName,
    renderOnce,
    snapshot,
  ]);

  // Assigned on every render, so the batch handler always invokes the newest
  // closure rather than the one that existed when it was registered.
  const renderRef = useRef(renderDeterministic);
  renderRef.current = renderDeterministic;

  /* ---------------- headless batch mode ---------------- */

  useEffect(() => {
    const bridge = desktop;
    if (!isBatchMode || !bridge) return;
    bridge.onJob(async (job) => {
      try {
        console.info(`job: starting ${job.input} -> ${job.output}`);
        if (!rendererRef.current) {
          throw new Error('the WebGL2 renderer failed to start — no usable GPU or software rasteriser');
        }
        batchOutputRef.current = job.output;
        if (job.preset) applyPreset(job.preset);
        let next = job.preset
          ? { ...(PRESETS.find((p) => p.id === job.preset)?.settings ?? DEFAULTS) }
          : { ...DEFAULTS };
        if (job.settings) next = sanitize((job.settings as { settings?: unknown }).settings ?? job.settings, next);
        if (job.params) next = sanitize(job.params, next);
        setSettings(next);
        settingsRef.current = next;

        // A preset file carries its keyframes with it, and a batch render is
        // exactly where animation matters most. Without this the CLI rendered
        // the opening frame's values for the whole clip and dropped every
        // keyframe silently.
        const jobTimeline = sanitizeTimeline(
          (job.settings as { timeline?: unknown } | undefined)?.timeline ?? job.timeline,
        );
        setTimeline(jobTimeline);
        timelineRef.current = jobTimeline;
        const animated = countKeyframes(jobTimeline);
        if (animated > 0) {
          console.info(
            `job: ${animated} keyframes across ${Object.keys(jobTimeline).length} parameters`,
          );
        }

        if (typeof job.seed === 'number') {
          setSeed(job.seed);
          seedRef.current = job.seed;
        }
        setExportSettings((prev) => ({
          ...prev,
          format: (job.format as ExportSettings['format']) ?? 'h264',
          fps: job.fps ?? prev.fps,
          quality: job.quality ?? prev.quality,
          scale: job.scale ?? prev.scale,
          resolution: (job.resolution as ExportSettings['resolution']) ?? prev.resolution,
          customHeight: job.height ?? prev.customHeight,
          useSourceRange: job.start === undefined && job.end === undefined,
          start: job.start ?? 0,
          end: job.end ?? 0,
        }));
        await loadMedia({
          url: `file://${job.input}`,
          name: job.input.split(/[\\/]/).pop() ?? 'input',
          kind: /\.(png|jpe?g|webp|gif|bmp)$/i.test(job.input) ? 'image' : 'video',
          blob: new Blob([await bridge.readFile(job.input)]),
          path: job.input,
        });
        console.info(`job: loaded ${job.input}`);
        // The media has to be decodable, and React has to have committed the
        // render that knows about it, before the export callback is meaningful.
        await waitFor(() => (videoRef.current?.readyState ?? 0) >= 2 || !!imageRef.current, 30_000);
        await waitFor(
          () =>
            mediaRef.current?.path === job.input &&
            (mediaRef.current.kind === 'image' || durationRef.current > 0),
          30_000,
        );
        console.info(`job: media ready, ${durationRef.current.toFixed(2)}s`);
        const result = await renderRef.current();
        console.info(`job: ${result.ok ? 'done' : `failed — ${result.error}`}`);
        bridge.jobDone(result.ok ? { ok: true, outputPath: job.output } : result);
      } catch (err) {
        bridge.jobDone({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
    bridge.jobReady();
  }, [applyPreset, loadMedia]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F1 works even from a field, because it is the one key you reach for
      // precisely when you do not know where you are.
      if (e.key === 'F1') {
        e.preventDefault();
        setGuideOpen((v) => !v);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        void togglePlay();
      } else if (e.key === 'd' || e.key === 'D') {
        triggerDegauss();
      } else if (e.key === ',') {
        e.preventDefault();
        jumpKey(-1);
      } else if (e.key === '.') {
        e.preventDefault();
        jumpKey(1);
      } else if (e.key === 'r' || e.key === 'R') {
        doRandomize();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doRandomize, togglePlay, triggerDegauss, jumpKey]);

  /* ---------------- render ---------------- */

  const groups = GROUPS.filter((g) => g.kind === tab);

  const modifiedCount = useMemo(
    () => Object.keys(DEFAULTS).filter((k) => settings[k] !== DEFAULTS[k]).length,
    [settings],
  );

  if (glError) {
    return (
      <div className="fatal">
        <h1>CRTBOX</h1>
        <p>{glError}</p>
      </div>
    );
  }

  return (
    <div className={`app${isBatchMode ? ' batch' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">▚</span>
          <span className="name">CRTBOX</span>
          <span className="tagline">cathode-ray emulation for picture and sound</span>
        </div>

        <div className="topbar-actions">
          <button className="primary" onClick={openViaDialog}>
            Open media…
          </button>

          <select
            value={presetName}
            onChange={(e) => applyPreset(e.target.value)}
            title="Built-in presets"
          >
            <option value="">— custom —</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </select>

          <button onClick={copySettings} title="Copy the current settings to the clipboard as JSON">
            Copy
          </button>
          <button onClick={() => setPasteText('')} title="Paste settings JSON">
            Paste
          </button>
          <button onClick={savePreset}>Save…</button>
          <button onClick={loadPreset}>Load…</button>

          <span className="divider" />

          <button onClick={doRandomize} title="Randomise the current tab (R)">
            Randomise
          </button>
          <label className="inline" title="How far each roll moves from the current settings">
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={randomAmount}
              onChange={(e) => setRandomAmount(Number(e.target.value))}
            />
          </label>
          <label className="inline seed" title="Seed for noise and randomisation">
            seed
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
          </label>

          <label
            className="inline"
            title="Every fine-detail parameter is shown by default. Untick to hide them."
          >
            <input
              type="checkbox"
              checked={advanced}
              onChange={(e) => chooseAdvanced(e.target.checked)}
            />
            Advanced
          </label>

          {/*
            A segmented toggle rather than a dropdown: there are only three
            choices, switching backend is something you do to compare rather
            than to configure once, and a dropdown costs two clicks to do it.
            The active backend is marked, because "Auto" alone does not tell
            you which one you actually got.
          */}
          <div
            className="backend-toggle"
            role="group"
            aria-label="Rendering backend"
            title="Which rasteriser draws the picture. Auto uses the GPU and falls back to the CPU when there is not a usable one."
          >
            {(
              [
                ['auto', 'Auto', 'Use the GPU, fall back to the CPU if there is not a usable one'],
                ['gpu', 'GPU', 'Force WebGL2. Fast, and fails if the machine cannot do it'],
                ['cpu', 'CPU', 'Force JavaScript. Works anywhere, identical everywhere, much slower'],
              ] as [BackendChoice, string, string][]
            ).map(([value, label, title]) => (
              <button
                key={value}
                className={`${backendChoice === value ? 'active' : ''}${
                  backendChoice === 'auto' && value === backendKind ? ' resolved' : ''
                }`}
                aria-pressed={backendChoice === value}
                data-backend={value}
                onClick={() => chooseBackend(value)}
                title={title}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            className="guide-btn"
            onClick={() => setGuideOpen(true)}
            title="How to load footage, what the reference tubes are, and how to build a look (F1)"
          >
            Guide
          </button>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          <nav className="tabs">
            {(
              [
                ['tape', 'Tape', 'The signal: composite encode and decode, and the videotape it was recorded on', 'engine.tape'],
                ['video', 'Tube', 'The display: the glass, the beam, the phosphor and the set around it', 'engine.tube'],
                ['audio', 'Sound', 'The speaker, the noise bed and the tape transport', null],
                ['link', 'A/V Link', 'What ties the picture and the sound together', null],
              ] as [Tab, string, string, string | null][]
            ).map(([t, label, title, masterKey]) => {
              const on = !masterKey || settings[masterKey] !== false;
              return (
                <div
                  key={t}
                  className={`tab${tab === t ? ' active' : ''}${on ? '' : ' bypassed'}`}
                >
                  <button onClick={() => setTab(t)} title={title}>
                    {label}
                  </button>
                  {/*
                    The master bypass sits on the tab rather than inside it, so
                    an engine can be switched off without first navigating to
                    the half of the app you are trying to silence.
                  */}
                  {masterKey && (
                    <label
                      className="switch tab-switch"
                      title={on ? `Bypass the whole ${label} engine` : `Enable the ${label} engine`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => change(masterKey, e.target.checked)}
                      />
                      <span />
                    </label>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="groups">
            {groups.map((g) => (
              <GroupPanel
                key={g.id}
                group={g}
                settings={settings}
                advanced={advanced}
                open={!!openGroups[g.id]}
                onToggleOpen={(id) => setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))}
                onChange={change}
                onReset={(id) => setSettings((prev) => resetGroup(prev, id))}
                timeline={timeline}
                time={playhead}
                onToggleAnimate={toggleAnimate}
                onAddKeyframe={(key) => addKeyframeAt(key, playhead)}
              />
            ))}
          </div>

          <footer className="sidebar-foot">
            <span>{modifiedCount} parameters changed</span>
            <button
              className="ghost"
              onClick={() => {
                setSettings({ ...DEFAULTS });
                setPresetName('');
              }}
            >
              Reset all
            </button>
          </footer>
        </aside>

        <main className="main">
          <div className="stage" ref={stageRef}>
            {/*
              The decoders live inside the stage, at full size, *behind* the
              canvas — not hidden.

              Chromium does not present frames for a <video> that is
              effectively invisible: `display: none`, zero size and
              `opacity: 0` all produce an element that reports readyState 4
              and advances currentTime while handing drawImage and
              texImage2D nothing but black. An <img> decodes regardless of
              layout, which is why stills kept working when video did not.

              So the video is genuinely rendered and genuinely occluded: the
              canvas above it is opaque (the context is created with
              alpha: false) and covers the stage completely.
            */}
            {media?.kind === 'video' && (
              <video
                ref={videoRef}
                className="decoder"
                src={media.url}
                loop={loop}
                playsInline
                preload="auto"
                crossOrigin="anonymous"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  setDuration(v.duration || 0);
                  setSrcDims({ width: v.videoWidth, height: v.videoHeight });
                  setExportSettings((prev) => ({ ...prev, end: prev.end || v.duration || 0 }));
                }}
                onLoadedData={(e) => {
                  // A video that has loaded but never played may not have
                  // *presented* a frame, so the tube would sit black until the
                  // user pressed play. A nudge off zero forces one out.
                  const v = e.currentTarget;
                  if (v.paused && v.currentTime === 0) {
                    v.currentTime = Math.min(0.04, (v.duration || 1) * 0.01);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onSeeking={() => {
                  // Scrubbing jumps to an unrelated part of the clip, so the
                  // phosphor has to be cleared or the old scene bleeds in. An
                  // export is the opposite case: it advances one frame at a time
                  // by seeking, which is continuous playback as far as the tube
                  // is concerned. Resetting there wiped the persistence buffer
                  // before every single frame, so trails — and burn-in — never
                  // appeared in a rendered video at all.
                  if (exportingRef.current) return;
                  rendererRef.current?.resetHistory();
                }}
              />
            )}
            {media?.kind === 'image' && (
              <img
                ref={imageRef}
                className="decoder"
                src={media.url}
                alt=""
                onLoad={(e) => {
                  setSrcDims({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  });
                  rendererRef.current?.resetHistory();
                }}
              />
            )}
            <canvas key={backendChoice} ref={canvasRef} />
            {!media && (
              <div className="dropzone">
                <p>Drop a video or an image here</p>
                <button className="primary" onClick={openViaDialog}>
                  Open media…
                </button>
                <p className="muted">
                  Nothing is uploaded anywhere — decoding, processing and export all happen on this
                  machine.
                </p>
                {/* The empty stage is where someone who has no idea what this
                    is will look first, so the way out of not knowing belongs
                    here rather than only in the header. */}
                <button className="dropzone-guide" onClick={() => setGuideOpen(true)}>
                  New here? Open the guide
                </button>
              </div>
            )}
            {media?.kind === 'video' && !audioArmed && (
              <button className="arm-audio" onClick={armAudio} title="Connect the audio chain">
                Enable audio
              </button>
            )}
          </div>

          <div className="transport">
            <button className="play" onClick={togglePlay} disabled={!media}>
              {(media?.kind === 'image' ? stillPlaying : playing) ? '❚❚' : '▶'}
            </button>
            <span className="time">{formatTime(playhead)}</span>
            <input
              className="scrub"
              type="range"
              min={0}
              max={Math.max(clipDuration, 0.01)}
              step={0.01}
              value={playhead}
              disabled={!media}
              onChange={(e) => seekTo(Number(e.target.value))}
            />
            <span className="time">{formatTime(clipDuration)}</span>

            <label className="inline" title="Loop playback">
              <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              loop
            </label>

            <span className="divider" />

            <label className="inline split" title="Drag to reveal the untouched source on the left">
              split
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </label>

            <button onClick={triggerDegauss} title="Fire the degauss coil (D)">
              Degauss
            </button>
          </div>

          <Timeline
            timeline={timeline}
            duration={clipDuration}
            time={playhead}
            selection={keySelection}
            open={timelineOpen}
            onToggleOpen={() => setTimelineOpen((v) => !v)}
            onSeek={seekTo}
            onSelect={setKeySelection}
            onMoveKey={(key, index, t) => {
              setTimeline((prev) => moveKeyframe(prev, key, index, t));
              // Moving re-sorts the track, so the selected index may have moved.
              setKeySelection(null);
            }}
            onRemoveKey={(key, index) => setTimeline((prev) => removeKeyframe(prev, key, index))}
            onSetEase={(key, index, ease) => setTimeline((prev) => setEase(prev, key, index, ease))}
            onAddKeyAt={addKeyframeAt}
            onStopAnimating={(key) => {
              setTimeline((prev) => stopAnimating(prev, key));
              setKeySelection(null);
            }}
            onJump={jumpKey}
            onClearAll={() => {
              setTimeline(EMPTY_TIMELINE);
              setKeySelection(null);
            }}
          />

          <section className="dock">
            <h2>Export</h2>
            <ExportPanel
              value={exportSettings}
              duration={duration}
              isStill={isStill}
              busy={busy}
              progress={progress}
              status={status}
              outputSize={previewOutput}
              upscale={previewUpscale}
              onChange={setExportSettings}
              onRenderDeterministic={renderDeterministic}
              onRecordRealtime={recordRealtime}
              onSnapshot={snapshot}
              onCancel={() => abortRef.current?.abort()}
            />
          </section>
        </main>
      </div>

      {backendNote && (
        <div className="toast" onClick={() => setBackendNote('')}>
          {backendNote}
        </div>
      )}

      {notice && (
        <div className="toast" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}

      {pasteText !== null && (
        <div className="modal" onClick={() => setPasteText(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Settings JSON</h3>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              spellCheck={false}
              placeholder='{"tube.humBar": 0.4, "noise.flybackLevel": -38}'
            />
            <div className="row">
              <button className="primary" onClick={() => applyPasted(pasteText)}>
                Apply
              </button>
              <button onClick={() => setPasteText(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {guideOpen && (
        <Guide
          onClose={() => setGuideOpen(false)}
          onPickPreset={applyPreset}
          onOpenMedia={openViaDialog}
        />
      )}
    </div>
  );
}

function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function baseName(name?: string): string {
  return (name ?? 'crtbox').replace(/\.[^.]+$/, '');
}

/** Offline audio rendering is bounded so a stalled decoder cannot hang an export. */
const AUDIO_RENDER_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

/**
 * True when drawing the element yields something other than a uniform frame.
 *
 * `readyState >= HAVE_CURRENT_DATA` only promises the *demuxer* has data; it
 * says nothing about whether the compositor is presenting decoded frames, which
 * is the thing texture upload actually depends on.
 */
/** Copy a media element into a reusable 2D canvas for texture upload. */
function blitToCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  ref: { current: HTMLCanvasElement | null },
): HTMLCanvasElement {
  let canvas = ref.current;
  if (!canvas) {
    canvas = document.createElement('canvas');
    ref.current = canvas;
  }
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx?.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * True when a canvas holds something other than a flat, near-black field.
 *
 * A genuinely black frame is possible — a title card, a fade — but it cannot be
 * told apart from "nothing was drawn at all", so only a frame with essentially
 * no variation *and* no brightness counts as a failure.
 */
function hasContent(source: HTMLCanvasElement): boolean {
  try {
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 48;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return true;   // cannot tell; assume the best rather than block
    ctx.drawImage(source, 0, 0, probe.width, probe.height);
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    return max - min > 6 || max > 24;
  } catch {
    return true;
  }
}

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (predicate()) resolve();
      else if (performance.now() - started > timeoutMs) reject(new Error('timed out waiting for media'));
      else setTimeout(check, 50);
    };
    check();
  });
}
