/*
 * Write docs/PRESETS.md from the presets themselves.
 *
 *   node scripts/docs.mjs
 *
 * The CLI's --preset takes an id, and the help points here for the list, so
 * the list is generated rather than typed: a renamed or added preset updates
 * the document by running this. `npm run help:check` fails if a preset is
 * missing from it.
 */

import { build } from 'vite';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const entry = join(root, '.docs-entry.ts');
const out = await mkdtemp(join(tmpdir(), 'filmbox-docs-'));

try {
  await writeFile(
    entry,
    "export { PRESETS } from './src/core/presets';\n" +
      "export { PARAM_BY_KEY, DEFAULTS } from './src/core/params';\n",
    'utf8',
  );
  await build({
    root,
    logLevel: 'silent',
    build: { lib: { entry, formats: ['es'], fileName: 'docs' }, outDir: out, emptyOutDir: true, minify: false },
  });
  const m = await import(pathToFileURL(join(out, 'docs.js')).href);

  const label = (key, value) => {
    const p = m.PARAM_BY_KEY[key];
    if (!p) return `${key} ${value}`;
    if (p.type === 'enum') return `${p.label}: ${p.options.find((o) => o.value === value)?.label ?? value}`;
    if (p.type === 'bool') return `${p.label}: ${value ? 'on' : 'off'}`;
    return `${p.label}: ${value}${p.unit ? ` ${p.unit}` : ''}`;
  };

  let md = `# Presets\n\n`;
  md += `Generated from \`src/core/presets.ts\` by \`node scripts/docs.mjs\`. Each preset is a particular piece of film in a particular state rather than an intensity level. Use the id with the command line: \`filmbox --input in.mp4 --output out.mp4 --preset super8-1974\`.\n\n`;
  md += `| id | name |\n|---|---|\n`;
  for (const p of m.PRESETS) md += `| \`${p.id}\` | ${p.name} |\n`;
  md += `\n`;
  for (const p of m.PRESETS) {
    md += `## ${p.name}\n\n\`${p.id}\`\n\n${p.description}\n\n`;
    const pick = ['format.gauge', 'format.stock', 'format.fps', 'print.stock', 'print.process', 'audio.track', 'framing.aspect', 'framing.fps', 'fade.years', 'fade.storage'];
    const lines = pick
      .filter((k) => p.settings[k] !== undefined && (p.settings[k] !== m.DEFAULTS[k] || k.startsWith('format.')))
      .map((k) => `- ${label(k, p.settings[k])}`);
    md += `${lines.join('\n')}\n\n`;
  }
  await writeFile(join(root, 'docs', 'PRESETS.md'), md, 'utf8');
  console.log(`docs/PRESETS.md — ${m.PRESETS.length} presets`);
} finally {
  await rm(out, { recursive: true, force: true });
  await unlink(entry).catch(() => undefined);
}
