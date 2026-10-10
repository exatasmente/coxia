// The site's history page and its first posts, read from the repository's own `CHANGELOG.md` when the site is built.
// Nothing of the changelog is copied into the site's versioned sources, so a page cannot disagree with the file. The
// parser is the repository's own (`scripts/release-changelog.mjs`), the one the release note already uses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A version without a suffix: the releases the project calls stable. */
const STABLE = /^\d+\.\d+\.\d+$/;
const SECTION = /^## \[([^\]]+)\](?: - (.*))?$/;
const LINK = /^\[([^\]]+)\]: (.*)$/;
const trimBlank = (lines) => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b).join('\n');
};

/**
 * The same split of the changelog `scripts/release-changelog.mjs` makes, so the site reads the file exactly as the
 * release note does: the head, the sections newest first, and the link lines. Written here rather than imported
 * because an import would have to pull a script that is also a command line into the site's own build.
 */
export function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const head = [];
  const sections = [];
  const links = [];
  let current = null;
  for (const line of lines) {
    const section = SECTION.exec(line);
    if (section) {
      current = { version: section[1], date: section[2] ?? null, body: [] };
      sections.push(current);
    } else if (current && LINK.test(line)) {
      links.push(line);
    } else if (current) {
      current.body.push(line);
    } else {
      head.push(line);
    }
  }
  return { head: trimBlank(head), sections: sections.map((s) => ({ ...s, body: trimBlank(s.body) })), links };
}

/** The section of one version, without its heading, or null when the file has none. */
export function status(text, version) {
  const { sections } = parse(text);
  const section = sections.find((s) => s.version === version);
  return section ? section.body.trim() || null : null;
}

/** The most recent stable version the file carries a section for, with its date; null when it carries none. */
export function recentStable(text) {
  const { sections } = parse(text);
  return sections.find((s) => STABLE.test(s.version)) ?? null;
}

/** The history page: one section per version, exactly as the file writes it. */
export function historyPage(root, lang) {
  const { sections } = changelogOf(root);
  const head =
    lang === 'pt-BR'
      ? ['# Histórico', '', 'Toda mudança notável do Coxia, como o repositório a escreve.', '']
      : ['# Changelog', '', 'Every notable change to Coxia, as the repository writes it.', ''];
  const parts = [...head];
  for (const s of sections) {
    if (!s.body.trim()) continue;
    parts.push(`## ${s.date ? `${s.version} — ${s.date}` : s.version}`, '', s.body.trim(), '');
  }
  return parts.join('\n').trimEnd() + '\n';
}

/** One blog post, from the section of its version. */
export function postOf(version, body, date) {
  const slug = version.replace(/\./g, '-');
  const title = `Coxia ${version}`;
  return { version, date, title, slug, path: `/blog/${slug}`, body: body.trim() };
}

/**
 * The posts the blog opens with: one per stable version in the file, newest first. A version the file still has as a
 * beta gets no post — the blog opens with what the project published as stable, as the issue asks.
 */
export function blogPosts(sections) {
  return sections
    .filter((s) => STABLE.test(s.version) && s.body.trim())
    .map((s) => postOf(s.version, s.body, s.date))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** A post as a page of the site, in the language it is read in. */
export function postPage(post, lang) {
  const pt = lang === 'pt-BR';
  const lead = pt ? `Publicado em ${post.date ?? 'sem data'}.` : `Published ${post.date ?? 'with no date'}.`;
  const back = pt ? '[Todos os textos](/blog/pt-br/index)' : '[All posts](/blog/)';
  return `# ${post.title}\n\n${lead} ${back}\n\n${post.body}\n`;
}

const compareVersions = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** The changelog of the repository, parsed: the one place the site reads it from. */
export function changelogOf(root) {
  return parse(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
}

/** The version the repository is at, read from the manifest the app itself reads. */
export function versionOf(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}
