/*
 * Assert the interface is fully documented.
 *
 *   node scripts/check-help.mjs
 *
 * Every parameter and every section must have an explanation, and there must be
 * no explanations left behind for controls that no longer exist. This is a data
 * check rather than a browser test because the failure it guards against is
 * silent: adding a parameter to the schema is easy, remembering to write its
 * help is not, and an undocumented control looks completely normal until
 * someone clicks the ⓘ and gets an empty box.
 *
 * It also enforces a minimum length, because a one-word entry satisfies a
 * presence check while helping nobody.
 */

import { build } from 'vite';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Shortest useful explanation. Below this it is a label, not help. */
const MIN_PARAM = 60;
const MIN_SECTION = 120;

const entry = join(root, '.check-help-entry.ts');
const out = await mkdtemp(join(tmpdir(), 'crtbox-help-'));

try {
  await writeFile(
    entry,
    "export { PARAMS, GROUPS, PARAM_BY_KEY, GROUP_BY_ID } from './src/core/params';\n" +
      "export { PARAM_HELP, SECTION_HELP } from './src/core/help';\n",
    'utf8',
  );

  await build({
    root,
    logLevel: 'silent',
    build: {
      lib: { entry, formats: ['es'], fileName: 'help' },
      outDir: out,
      emptyOutDir: true,
      minify: false,
    },
  });

  const m = await import(pathToFileURL(join(out, 'help.js')).href);
  const problems = [];

  for (const p of m.PARAMS) {
    const text = m.PARAM_HELP[p.key];
    if (!text) problems.push(`${p.key} (${p.label}) has no help`);
    else if (text.length < MIN_PARAM) {
      problems.push(`${p.key} help is only ${text.length} characters — say more than the label does`);
    }
  }
  for (const key of Object.keys(m.PARAM_HELP)) {
    if (!m.PARAM_BY_KEY[key]) problems.push(`help written for ${key}, which is not in the schema`);
  }

  for (const g of m.GROUPS) {
    const help = m.SECTION_HELP[g.id];
    if (!help) problems.push(`section ${g.id} (${g.label}) has no help`);
    else {
      if (!help.what || help.what.length < MIN_SECTION) {
        problems.push(`section ${g.id} "what" is too short`);
      }
      if (!help.how || help.how.length < MIN_SECTION) {
        problems.push(`section ${g.id} "how" is too short`);
      }
    }
  }
  for (const id of Object.keys(m.SECTION_HELP)) {
    if (!m.GROUP_BY_ID[id]) problems.push(`section help written for ${id}, which is not a group`);
  }

  if (problems.length) {
    console.error('Help check failed:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }

  const words = Object.values(m.PARAM_HELP)
    .concat(Object.values(m.SECTION_HELP).flatMap((h) => [h.what, h.how]))
    .join(' ')
    .split(/\s+/).length;

  console.log(
    `help complete — ${m.PARAMS.length} parameters, ${m.GROUPS.length} sections, ${words.toLocaleString('en-GB')} words`,
  );
} finally {
  await rm(out, { recursive: true, force: true });
  await unlink(entry).catch(() => undefined);
}
