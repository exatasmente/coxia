// The history page and the first posts of the blog: both are read from the repository's own `CHANGELOG.md` when the
// site is built, so neither can disagree with the file. The extractor is the same one the release note uses.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM module, no declaration file
import { blogPosts, historyPage, parse, postOf, recentStable, status, versionOf } from '../site/scripts/changelog.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.9.0-beta.2] - 2026-01-02',
  '',
  '### Added',
  '',
  '- A beta thing.',
  '',
  '## [0.8.0] - 2026-01-01',
  '',
  '### Added',
  '',
  '- A stable thing.',
  '',
  '## [0.7.0] - 2025-12-01',
  '',
  '### Fixed',
  '',
  '- An old thing.',
  '',
  '[Unreleased]: https://example.com/group/project/compare/v0.8.0...HEAD',
].join('\n');

describe('the section of a version', () => {
  it('finds it by its heading, without the heading, and does not confuse [Unreleased] with a version', () => {
    expect(status(CHANGELOG, '0.8.0')).toContain('A stable thing.');
    // the heading of the section itself is not part of the body; the subsections of the file are
    expect(status(CHANGELOG, '0.8.0')?.split('\n')[0]).toBe('### Added');
    expect(status(CHANGELOG, 'Unreleased')).toBeNull();
    expect(status(CHANGELOG, '9.9.9')).toBeNull();
  });

  it('answers nothing for a version the file carries and whose section is empty', () => {
    expect(status(CHANGELOG, '0.9.0-beta.2')).toContain('A beta thing.');
    expect(status('# Changelog\n\n## [1.0.0]\n\n## [0.9.0]\n\n- x\n', '1.0.0')).toBeNull();
  });

  it('reads the same sections as the parser the release note uses, in the order the file writes them', () => {
    expect(parse(CHANGELOG).sections.map((s: { version: string }) => s.version)).toEqual(['Unreleased', '0.9.0-beta.2', '0.8.0', '0.7.0']);
    expect(parse(CHANGELOG).sections[1].date).toBe('2026-01-02');
  });
});

describe('the blog', () => {
  it('takes the text of each version from its section of the file', () => {
    const post = postOf('0.8.0', '- A stable thing.\n', '2026-01-01');
    expect(post).toMatchObject({ version: '0.8.0', title: 'Coxia 0.8.0', slug: '0-8-0', path: '/blog/0-8-0' });
    expect(post.body).toBe('- A stable thing.');
  });

  it('opens with the stable versions, newest first, and leaves the beta sections out', () => {
    const posts = blogPosts(parse(CHANGELOG).sections);
    expect(posts.map((p: { version: string }) => p.version)).toEqual(['0.8.0', '0.7.0']);
    expect(posts.map((p: { slug: string }) => p.slug)).toEqual(['0-8-0', '0-7-0']);
  });

  it('finds the most recent stable section, which is what the first post is about', () => {
    expect(recentStable(CHANGELOG)?.version).toBe('0.8.0');
    expect(recentStable('# Changelog\n\n## [1.0.0-beta.1]\n\n- x\n')).toBeNull();
  });
});

describe('the history page', () => {
  it('follows the file: changing a section changes what the page carries, and no second copy is kept', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-changelog-'));
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.9.0-beta.2' }));
    const first = historyPage(dir, 'en');
    expect(first).toContain('A stable thing.');
    expect(first).toContain('0.8.0 — 2026-01-01');
    expect(first).toContain('0.9.0-beta.2 — 2026-01-02');
    // an empty section is not a heading with nothing under it
    expect(first).not.toContain('## Unreleased');
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG.replace('A stable thing.', 'A stable thing, corrected.'));
    expect(historyPage(dir, 'en')).toContain('A stable thing, corrected.');
    // and the version the pages show comes from the manifest the app itself reads
    expect(versionOf(dir)).toBe('0.9.0-beta.2');
  });

  it('writes the page in the language it is read in', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-changelog-'));
    writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    expect(historyPage(dir, 'pt-BR').startsWith('# Histórico')).toBe(true);
    expect(historyPage(dir, 'en').startsWith('# Changelog')).toBe(true);
  });
});
