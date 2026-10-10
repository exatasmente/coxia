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

/**
 * The language a heading opens a half with. A heading names the language it opens either in the words themselves
 * (`## Português`, `## English`) or at its end, in the parenthesis a document written in one title per half carries
 * (`# Conflict verification commands (English)`, `# … (Português)`).
 */
function langOfMark(heading) {
  const direct = langOfHeading(heading);
  if (direct) return direct;
  const tag = /\((english|portugu[eê]s|pt-br)\)\s*$/i.exec(heading.trim());
  if (!tag) return null;
  return /^english$/i.test(tag[1]) ? 'en' : 'pt-BR';
}

/** The words a title carries when it names its language at the end: the title without that name. */
const bareTitle = (title) => title.replace(/\s*\((english|portugu[eê]s|pt-br)\)\s*$/i, '').trim();

/** The language a document is written in: the half it opens with, else English, the language the repository writes first. */
export function langOf(path, text) {
  return blocksOf(text)[0]?.lang ?? 'en';
}

/**
 * The blocks of one document, in the order it writes them. A document that carries `## Português` and `## English`
 * becomes one block per language, each holding the text that follows its heading; a document written in one half per
 * title (`# … (Português)` then `# … (English)`) becomes one block per half, the text before the first title staying
 * with the half of the language the titles are written in; a document written in a single language stays one block,
 * in English.
 */
export function blocksOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let prelude = [];
  let current = null;
  let titled = false;
  for (const line of lines) {
    const heading = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
    const lang = heading ? langOfMark(heading[2]) : null;
    if (lang) {
      if (heading[1] === '#') titled = true;
      current = { lang, lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      prelude.push(line);
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
  // A document written in one title per half leaves the text before its first title with the half of the language the
  // titles are written in, which is the other one of the pair — the shape of a document the repository writes in one
  // language only gets a page of that language instead of being served as the English half of a pair it does not have.
  if (titled && prelude.some((l) => l.trim())) {
    blocks.unshift({ lang: blocks[0].lang === 'pt-BR' ? 'en' : 'pt-BR', lines: prelude });
  }
  prelude = [];
  return blocks.map((b) => ({ lang: b.lang, body: trim(b.lines) }));
}

/** The title of a document: the `#` heading of the half the page shows, else the file's own name. */
export function titleOf(path, text, lang) {
  const headings = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) headings.push(heading[1]);
  }
  if (!headings.length) return path.replace(/\.md$/, '').split('/').pop();
  // A document written in one title per half titles each half with its own; anything else carries one title for both,
  // and a bilingual one writes it `Configuração / Configuration`, one title for its two halves: the page shows the
  // half that is its own, and keeps the whole title when the halves are not of one language each.
  const mine = headings.length > 1 ? headings.find((t) => langOfMark(t) === lang) : null;
  const title = mine ? bareTitle(mine) : headings[0];
  const parts = title.split(/\s+\/\s+/).map((p) => p.trim());
  return parts.length > 1 ? (lang === 'pt-BR' ? parts[0] : parts[parts.length - 1]) : title;
}

/** The page of a document: what the site shows of it — one title and one body per language it carries. */
export function pageFor(root, path) {
  const text = readFileSync(join(root, path), 'utf8');
  const lang = langOf(path, text);
  const blocks = blocksOf(text);
  const pt = blocks.find((b) => b.lang === 'pt-BR');
  const en = blocks.find((b) => b.lang === 'en');
  const body = { 'pt-BR': pt?.body ?? null, en: en?.body ?? text };
  return { path, lang, single: !pt, title: titleOf(path, text, lang), body };
}

/**
 * The address of a document's page, derived from its path: a new document needs no list to be reachable. This is the
 * one place the rule lives — the configuration of the site and the generator of its sources both ask for it, so a
 * document whose name changes case cannot get a sidebar address that differs from the page the build serves.
 */
export function pagePath(path, lang) {
  return `${referenceRoute(path)}${lang === 'pt-BR' ? '.pt-br' : ''}`;
}

/** The address of a document's page without its address language: what every other address of the site builds on. */
export function referenceRoute(path) {
  const slug = path
    .replace(/\.md$/, '')
    .replace(/(^|\/)README$/i, '$1index')
    .toLowerCase();
  return `/reference/${slug}`;
}

/**
 * The label of a link that leads to the other language of the page that carries it: the word of that language, which
 * is what the bilingual documents of the repository open their halves with and what the generated reference pages
 * write on their link to their pair. Null when the text carries no such link.
 */
export function otherLanguageLink(text) {
  for (const m of text.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*\btitle="([^"]*)"/g)) {
    if (langOfWord(m[2])) return { href: m[1], lang: langOfWord(m[2]), label: m[2] };
  }
  return null;
}

/** The language a word names: `Português`, `English` and their short forms, or null. */
export function langOfWord(text) {
  const lower = text.trim().toLowerCase();
  if (/^(portugu[eê]s|pt-br)\b/.test(lower)) return 'pt-BR';
  if (/^(english|en)\b/.test(lower)) return 'en';
  return null;
}
