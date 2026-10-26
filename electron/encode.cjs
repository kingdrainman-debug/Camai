/*
 * FFmpeg arguments for each export format.
 *
 * Kept apart from the Electron shell so that the smoke test can run the very
 * arguments the app uses — in particular to confirm that a DV export is
 * genuinely DV: dvvideo, the right raster, bottom field first.
 */

/** A rate such as "30000/1001" as a number. */
function rateOf(rate) {
  if (!rate) return 0;
  const [n, d] = String(rate).split('/').map(Number);
  return d ? n / d : n;
}

function buildArgs(opts) {
  const { format, fps, rate, quality, outputPath, audioPath, width, height } = opts;
  const args = ['-y', '-f', 'image2pipe', '-framerate', rate || String(fps), '-i', 'pipe:0'];
  if (audioPath) args.push('-i', audioPath);

  switch (format) {
    case 'dv':
      // A real DV stream: FFmpeg's own dvvideo encoder, interlaced, bottom
      // field first, in the system's chroma subsampling, with PCM audio.
      args.push(
        '-vf', `setfield=bff,format=${opts.dvSystem === 'pal' ? 'yuv420p' : 'yuv411p'}`,
        '-c:v', 'dvvideo', '-flags', '+ilme+ildct', '-top', '0',
        '-aspect', opts.dvAspect || '4:3',
      );
      // Every DV frame carries its own audio, so the muxer needs a frame's
      // worth for each: pad or trim the sound to exactly the picture's
      // length (an unbounded pad floods the muxer before slow piped frames
      // arrive; sound that runs on leaves the last frames without theirs).
      if (audioPath) {
        if (opts.frames > 0) {
          const dur = (opts.frames / (rateOf(rate) || fps)).toFixed(6);
          args.push('-af', `apad=whole_dur=${dur},atrim=end=${dur}`);
        }
        args.push('-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2');
      }
      if (opts.frames > 0) args.push('-frames:v', String(opts.frames));
      args.push('-f', 'dv');
      break;
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
  if (audioPath && format !== 'gif' && !(format === 'dv' && opts.frames > 0)) args.push('-shortest');
  args.push(outputPath);
  return args;
}

module.exports = { buildArgs };
