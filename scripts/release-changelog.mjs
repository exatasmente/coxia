#!/usr/bin/env node
// The CHANGELOG.md edits of a release, as pure functions and a small CLI. scripts/release.sh calls the CLI.
//
//   node scripts/release-changelog.mjs status <file> <version>          prints: section | content | empty
//   node scripts/release-changelog.mjs cut <file> <version> <date>      rewrites the file
//
// A version with a suffix (0.6.0-beta.2) is a beta cut: [Unreleased] moves under the new version. A version without one is a stable cut: the
// [X.Y.Z-beta.*] sections and [Unreleased] are folded into one [X.Y.Z] section (per subsection, in the order of the betas) and the beta sections leave.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KEEP_A_CHANGELOG = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const LINK = /^\[([^\]]+)\]: (.*)$/;
const SECTION = /^## \[([^\]]+)\](?: - (.*))?$/;
const STABLE = /^\d+\.\d+\.\d+$/;

const trimBlank = (lines) => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

/** Splits a changelog into its head, its sections (newest first, as written) and its link lines. */
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
  return { head: trimBlank(head).join('\n'), sections: sections.map((s) => ({ ...s, body: trimBlank(s.body).join('\n') })), links };
}

const headingOf = (s) => (s.date ? `## [${s.version}] - ${s.date}` : `## [${s.version}]`);

/** The inverse of `parse`: one blank line around every part. */
export function render({ head, sections, links }) {
  let out = `${head}\n\n`;
  for (const s of sections) out += `${headingOf(s)}\n\n${s.body ? `${s.body}\n\n` : ''}`;
  if (links.length) out += `${links.join('\n')}\n`;
  return out;
}

/** What the release of `version` finds in the file: its own section, something to release, or nothing. */
export function status(text, version) {
  const { sections } = parse(text);
  if (sections.some((s) => s.version === version)) return 'section';
  const unreleased = sections.find((s) => s.version === 'Unreleased');
  if (unreleased?.body.trim()) return 'content';
  if (STABLE.test(version) && sections.some((s) => s.version.startsWith(`${version}-beta.`) && s.body.trim())) return 'content';
  return 'empty';
}

/** Merges several bodies by their `### ` headings: the standard order first, the others as first seen; text above the first heading stays on top. */
export function fold(bodies) {
  const preamble = [];
  const byHeading = new Map();
  for (const body of bodies) {
    let block = null;
    const own = [];
    for (const line of body.split('\n')) {
      const h = /^### (.+?)\s*$/.exec(line);
      if (h) {
        block = { name: h[1], lines: [] };
        own.push(block);
      } else if (block) {
        block.lines.push(line);
      } else {
        preamble.push(line);
      }
    }
    for (const { name, lines } of own) {
      const kept = trimBlank(lines);
      if (!byHeading.has(name)) byHeading.set(name, []);
      if (kept.length) byHeading.get(name).push(kept.join('\n'));
    }
  }
  const names = [...byHeading.keys()];
  const order = [...KEEP_A_CHANGELOG.filter((n) => byHeading.has(n)), ...names.filter((n) => !KEEP_A_CHANGELOG.includes(n))];
  const parts = [];
  const top = trimBlank(preamble).join('\n');
  if (top) parts.push(top);
  for (const name of order) {
    const items = byHeading.get(name);
    if (items.length) parts.push(`### ${name}\n\n${items.join('\n')}`);
  }
  return parts.join('\n\n');
}

const betaNumber = (version) => Number(/-beta\.(\d+)$/.exec(version)?.[1] ?? 0);

/** The changelog after the release of `version` on `date`. Throws when there is nothing to release or the version already has a section. */
export function cut(text, version, date) {
  const model = parse(text);
  const { sections, links } = model;
  const unreleasedAt = sections.findIndex((s) => s.version === 'Unreleased');
  if (unreleasedAt < 0) throw new Error('CHANGELOG.md has no [Unreleased] section');
  if (sections.some((s) => s.version === version)) throw new Error(`CHANGELOG.md already has a [${version}] section`);
  const unreleased = sections[unreleasedAt];
  const stable = STABLE.test(version);
  const betas = stable ? sections.filter((s) => s.version.startsWith(`${version}-beta.`)).sort((a, b) => betaNumber(a.version) - betaNumber(b.version)) : [];
  const gathered = [...betas.map((s) => s.body), unreleased.body].filter((b) => b.trim());
  if (!gathered.length) throw new Error(`nothing to release: [Unreleased] is empty${stable ? ' and no beta section exists' : ''}`);

  const section = { version, date, body: stable ? fold(gathered) : unreleased.body };
  const dropped = new Set(betas.map((s) => s.version));
  const kept = sections.filter((s) => s !== unreleased && !dropped.has(s.version));
  const next = [{ ...unreleased, body: '' }, section, ...kept];

  const unreleasedLink = links.find((l) => l.startsWith('[Unreleased]: '));
  const base = /^\[Unreleased\]: (.*)\/compare\/.*$/.exec(unreleasedLink ?? '')?.[1] ?? '';
  let nextLinks = links;
  if (base) {
    // A beta compares with the previous tag, which is where the old [Unreleased] link started; a stable with the previous stable.
    const tagBefore = /\/compare\/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)\.\.\.HEAD$/.exec(unreleasedLink)?.[1] ?? '';
    const prev = stable ? (kept.find((s) => STABLE.test(s.version))?.version ?? '') : tagBefore;
    const own = prev ? `[${version}]: ${base}/compare/v${prev}...v${version}` : `[${version}]: ${base}/releases/tag/v${version}`;
    nextLinks = [];
    for (const l of links) {
      const label = LINK.exec(l)?.[1];
      if (label && dropped.has(label)) continue;
      if (l === unreleasedLink) nextLinks.push(`[Unreleased]: ${base}/compare/v${version}...HEAD`, own);
      else nextLinks.push(l);
    }
  }
  return render({ head: model.head, sections: next, links: nextLinks });
}

function main(argv) {
  const [command, file, version, date] = argv;
  try {
    if (command === 'status' && file && version) {
      process.stdout.write(`${status(readFileSync(file, 'utf8'), version)}\n`);
      return 0;
    }
    if (command === 'cut' && file && version && date) {
      const before = readFileSync(file, 'utf8');
      writeFileSync(file, cut(before, version, date));
      const folded = STABLE.test(version) ? parse(before).sections.filter((s) => s.version.startsWith(`${version}-beta.`)).length : 0;
      process.stdout.write(folded ? `folded ${folded} beta section(s) and [Unreleased] into [${version}] - ${date}\n` : `moved [Unreleased] under [${version}] - ${date}\n`);
      return 0;
    }
    process.stderr.write('usage: release-changelog.mjs status <file> <version> | cut <file> <version> <date>\n');
    return 2;
  } catch (e) {
    process.stderr.write(`release-changelog: ${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
