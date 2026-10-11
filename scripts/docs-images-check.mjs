// Usage: node scripts/docs-images-check.mjs
//
// Compares what the documentation uses with what exists: every image the READMEs and the pages of `docs/` reference must
// have an entry in `scripts/captures/index.json` and a capture script behind it; every entry of the list must have its
// image in `docs/images/` and one of its images referenced by the documentation (a script nothing references is kept for
// a page that never shows it), and an image in `docs/images/` nobody lists is refused too. It is the check the CI job
// `check` runs next to the public audit; it reads files only, so it needs neither the app nor a browser.
//
// Exit codes: 0 nothing to say; 1 a divergence (printed); 2 the list or a file could not be read.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const IMAGES = 'docs/images';
const INDEX = 'scripts/captures/index.json';

/** The files that may reference an image: the two READMEs and every page under `docs/`. */
function referenceFiles(root = ROOT) {
  const files = ['README.md', 'README.pt-BR.md'];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name.endsWith('.md')) files.push(relative(root, full).split('\\').join('/'));
      else if (readdirSync(dir, { withFileTypes: true }).find((e) => e.name === name)?.isDirectory()) walk(full);
    }
  };
  try {
    walk(join(root, 'docs'));
  } catch {
    // A tree with no docs folder has nothing to reference.
  }
  return files.filter((f) => existsSync(join(root, f)));
}

/** The images a file references, by base name, from any relative path that points inside `docs/images/`. */
function referencesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/docs\/images\/([A-Za-z0-9._-]+\.png)/g)) out.add(m[1]);
  return out;
}

/**
 * What the check compares, as data: the entries of the list, the images that exist and the images that are referenced.
 * Exported so a test can hand it a folder of its own and read the divergences without running the script.
 */
export function collect(root = ROOT) {
  const indexPath = join(root, INDEX);
  if (!existsSync(indexPath)) throw new Error(`${INDEX} is missing`);
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const list = Array.isArray(index) ? index : index?.features;
  if (!Array.isArray(list)) throw new Error(`${INDEX} must be a list of features`);
  const entries = list.map((e) => ({ id: String(e.id), script: String(e.script) }));
  const images = existsSync(join(root, IMAGES)) ? readdirSync(join(root, IMAGES)).filter((n) => n.endsWith('.png')) : [];
  const referenced = new Set();
  for (const file of referenceFiles(root)) for (const name of referencesIn(readFileSync(join(root, file), 'utf8'))) referenced.add(name);
  return { entries, images, referenced };
}

/** Whether the documentation references any of the images a list entry writes (its default-language one or a variant). */
function entryReferenced(entry, referenced) {
  return [...referenced].some((name) => name === `${entry.id}.png` || name.startsWith(`${entry.id}-`));
}

/** The divergences between what is used and what exists, each one a line a person reads. */
export function divergences(root = ROOT) {
  const { entries, images, referenced } = collect(root);
  const out = [];
  const entryIds = new Set(entries.map((e) => e.id));
  // Every image the documentation shows is listed and has a script behind it.
  for (const name of referenced) {
    const id = name.replace(/-(pt-BR|en)?\.png$/, '').replace(/\.png$/, '');
    const listed = entries.some((e) => e.id === id) || entries.some((e) => name.startsWith(`${e.id}-`)) || entryIds.has(id);
    if (!listed) out.push(`${name}: referenced by the documentation and not in ${INDEX}`);
  }
  // Every entry of the list has a script, and its images exist (at least the default language).
  for (const entry of entries) {
    const script = join(root, 'scripts/captures', entry.script);
    if (!existsSync(script)) out.push(`${entry.id}: the list names a script that does not exist (scripts/captures/${entry.script})`);
    if (!images.some((n) => n === `${entry.id}.png` || n.startsWith(`${entry.id}-`))) out.push(`${entry.id}: the list names it and ${IMAGES} has no image`);
  }
  // Every entry of the list is one the documentation uses: a capture no page shows is a script kept for an image nobody reads.
  for (const entry of entries) {
    if (!entryReferenced(entry, referenced)) out.push(`${entry.id}: ${INDEX} names it and the documentation never references ${IMAGES}/${entry.id}.png`);
  }
  // Every image of the folder is one the list knows.
  for (const name of images) {
    if (!entries.some((e) => name === `${e.id}.png` || name.startsWith(`${e.id}-`))) out.push(`${name}: in ${IMAGES} and in no entry of ${INDEX}`);
  }
  return out;
}

function main() {
  let problems;
  try {
    problems = divergences(ROOT);
  } catch (e) {
    console.error(`docs-images: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (problems.length) {
    console.error(`docs-images: ${problems.length} divergence(s):\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log(`docs-images: the list, the scripts and the images of ${IMAGES} correspond.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
