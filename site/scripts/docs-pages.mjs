// What the reference section of the site is made of: one page per document of `docs/`, read where the document
// already is. The text of a page is the repository's own file, never a copy of it, so the reference cannot drift
// from what the agents of the app read at run time. Pure Node, no VitePress: the suite tests these functions.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// `docs/` is also where a cycle keeps its artifacts and where the planned screenshots live. A cycle folder is the
// record of one run, not reference documentation, so the walk leaves it out; everything else it reaches is a page.
const SKIP_DIRS = new Set(['cycles']);

/** Every reference document under `root`, as paths relative to it, sorted: a document that lands there gets a page by itself. */
export function referencePages(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.md')) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  // A folder of documents is reached through its own index, the way the repository reads it: `plugins/README.md` is the page of `plugins/`.
  return out.sort((a, b) => pagePath(a, 'en').localeCompare(pagePath(b, 'en')));
}

/** The language of a heading: the words the repository's own bilingual documents open their halves with, or null. */
function langOfHeading(heading) {
  const text = heading.trim().toLowerCase();
  if (/^(portugu[eê]s|pt-br)\b/.test(text)) return 'pt-BR';
  if (/^(english|en)\b/.test(text)) return 'en';
  return null;
}

/** The language a document is written in: the `## Português` it carries, else English, the language the repository writes first. */
export function langOf(path, text) {
  const heading = /^##\s+(.+?)\s*$/m.exec(text.replace(/\r\n/g, '\n'));
  return heading && langOfHeading(heading[1]) === 'pt-BR' ? 'pt-BR' : 'en';
}

/**
 * The blocks of one document, in the order it writes them. A document that carries `## Português` and `## English`
 * becomes one block per language, each holding the text that follows its heading; a document written in a single
 * language stays one block, in English.
 */
export function blocksOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    const lang = heading ? langOfHeading(heading[1]) : null;
    if (lang) {
      current = { lang, lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  const trim = (list) => {
    let a = 0;
    let b = list.length;
    while (a < b && !list[a].trim()) a++;
    while (b > a && !list[b - 1].trim()) b--;
    return list.slice(a, b).join('\n');
  };
  if (!blocks.length) return [{ lang: 'en', body: trim(lines) }];
  return blocks.map((b) => ({ lang: b.lang, body: trim(b.lines) }));
}

/** The title of a document: its first `#` heading, else its first line, else the file's own name. */
export function titleOf(path, text, lang) {
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    // A bilingual document titles the file `Configuração / Configuration`, one title for its two halves: the page
    // shows the half that is its own, and keeps the whole title when the halves are not of one language each.
    if (heading) {
      const parts = heading[1].split(/\s+\/\s+/).map((p) => p.trim());
      return parts.length > 1 ? (lang === 'pt-BR' ? parts[0] : parts[parts.length - 1]) : heading[1];
    }
    if (line.trim() && !line.startsWith('---')) break;
  }
  return path.replace(/\.md$/, '').split('/').pop();
}

/** The page of a document: what the site shows of it — one title and one body per language it carries. */
export function pageFor(root, path) {
  const text = readFileSync(join(root, path), 'utf8');
  const lang = langOf(path, text);
  const blocks = blocksOf(text);
  const pt = blocks.find((b) => b.lang === 'pt-BR');
  const en = blocks.find((b) => b.lang === 'en');
  const body = { 'pt-BR': pt?.body ?? null, en: en?.body ?? text };
  return { path, lang, single: !pt, title: titleOf(path, blocks.length ? text : text, lang), body };
}

/** The address of a document's page, derived from its path: a new document needs no list to be reachable. */
export function pagePath(path, lang) {
  const slug = path
    .replace(/\.md$/, '')
    .replace(/(^|\/)README$/i, '$1index')
    .toLowerCase();
  return `/reference/${slug}${lang === 'pt-BR' ? '.pt-br' : ''}`;
}
