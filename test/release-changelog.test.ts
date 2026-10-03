import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, no declaration file
import { cut, fold, parse, render, status } from '../scripts/release-changelog.mjs';

const BASE = 'https://example.test/r';
const log = (unreleased: string, betas: string[] = [], links = true): string =>
  [
    '# Changelog',
    '',
    'Intro text.',
    '',
    '## [Unreleased]',
    '',
    ...(unreleased ? [unreleased, ''] : []),
    ...betas.flatMap((b) => [b, '']),
    '## [0.4.0] - 2026-01-01',
    '',
    '### Added',
    '',
    '- the start',
    '',
    ...(links ? [`[Unreleased]: ${BASE}/compare/v${betas.length ? '0.5.0-beta.' + betas.length : '0.4.0'}...HEAD`, ...betas.map((_, i) => `[0.5.0-beta.${i + 1}]: ${BASE}/compare/v${i ? '0.5.0-beta.' + i : '0.4.0'}...v0.5.0-beta.${i + 1}`).reverse(), `[0.4.0]: ${BASE}/releases/tag/v0.4.0`, ''] : []),
  ].join('\n');

const beta = (n: number, body: string): string => `## [0.5.0-beta.${n}] - 2026-02-0${n}\n\n${body}`;
const sectionOf = (text: string, version: string): string => (parse(text).sections as { version: string; body: string }[]).find((s) => s.version === version)?.body ?? '';

describe('changelog model', () => {
  it('renders what it parsed, byte for byte, on the real file', () => {
    const real = readFileSync(join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
    expect(render(parse(real))).toBe(real);
    const small = log('### Added\n\n- a');
    expect(render(parse(small))).toBe(small);
  });

  it('tells a section, something to release and nothing', () => {
    expect(status(log('### Added\n\n- a'), '0.5.0')).toBe('content');
    expect(status(log(''), '0.5.0')).toBe('empty');
    expect(status(log(''), '0.4.0')).toBe('section');
    expect(status(log('', [beta(1, '### Added\n\n- b')]), '0.5.0')).toBe('content');
    expect(status(log('', [beta(1, '### Added\n\n- b')]), '0.5.0-beta.2')).toBe('empty');
    expect(status(log('', [beta(1, '### Added\n\n- b')]), '0.6.0')).toBe('empty');
  });
});

describe('changelog cut of a beta', () => {
  it('moves [Unreleased] under the version and links from the previous tag', () => {
    const out = cut(log('### Added\n\n- a'), '0.5.0-beta.1', '2026-02-01');
    expect(sectionOf(out, 'Unreleased')).toBe('');
    expect(sectionOf(out, '0.5.0-beta.1')).toBe('### Added\n\n- a');
    expect(out).toContain('## [0.5.0-beta.1] - 2026-02-01');
    expect(out).toContain(`[Unreleased]: ${BASE}/compare/v0.5.0-beta.1...HEAD\n[0.5.0-beta.1]: ${BASE}/compare/v0.4.0...v0.5.0-beta.1\n`);
  });

  it('links the second beta from the first and keeps the first beta untouched', () => {
    const first = cut(log('### Added\n\n- a'), '0.5.0-beta.1', '2026-02-01');
    const out = cut(first.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n\n- b\n'), '0.5.0-beta.2', '2026-02-02');
    expect(sectionOf(out, '0.5.0-beta.2')).toBe('### Fixed\n\n- b');
    expect(sectionOf(out, '0.5.0-beta.1')).toBe('### Added\n\n- a');
    expect(out).toContain(`[0.5.0-beta.2]: ${BASE}/compare/v0.5.0-beta.1...v0.5.0-beta.2`);
  });

  it('works without links and refuses nothing to release or a section that exists', () => {
    expect(cut(log('### Added\n\n- a', [], false), '0.5.0-beta.1', '2026-02-01')).not.toContain('[0.5.0-beta.1]:');
    expect(() => cut(log(''), '0.5.0-beta.1', '2026-02-01')).toThrow('nothing to release');
    expect(() => cut(log('### Added\n\n- a'), '0.4.0', '2026-02-01')).toThrow('already has');
  });
});

describe('changelog cut of a stable (the fold)', () => {
  const betas = [beta(2, '### Fixed\n\n- fix two'), beta(1, '### Added\n\n- add one\n\n### Changed\n\n- change one\n\n### Fixed\n\n- fix one')];

  it('gathers the beta sections and [Unreleased] per subsection, in the order of the betas', () => {
    const out = cut(log('### Added\n\n- add three\n\n### Security\n\n- sec three', betas), '0.5.0', '2026-03-01');
    expect(sectionOf(out, '0.5.0')).toBe('### Added\n\n- add one\n- add three\n\n### Changed\n\n- change one\n\n### Fixed\n\n- fix one\n- fix two\n\n### Security\n\n- sec three');
    expect(sectionOf(out, 'Unreleased')).toBe('');
  });

  it('removes the beta sections and their links, and links from the previous stable', () => {
    const out = cut(log('', betas), '0.5.0', '2026-03-01');
    expect(out).not.toContain('0.5.0-beta');
    expect(out).toContain(`[Unreleased]: ${BASE}/compare/v0.5.0...HEAD\n[0.5.0]: ${BASE}/compare/v0.4.0...v0.5.0\n`);
    expect(out).toContain(`[0.4.0]: ${BASE}/releases/tag/v0.4.0`);
    expect(parse(out).sections.map((s: { version: string }) => s.version)).toEqual(['Unreleased', '0.5.0', '0.4.0']);
  });

  it('leaves the betas of another version alone', () => {
    const other = `## [0.6.0-beta.1] - 2026-02-09\n\n### Added\n\n- six`;
    const out = cut(log('### Added\n\n- a', [other]), '0.5.0', '2026-03-01');
    expect(out).toContain('## [0.6.0-beta.1]');
    expect(sectionOf(out, '0.5.0')).toBe('### Added\n\n- a');
  });

  it('cuts a stable with no beta from [Unreleased] alone, and refuses when there is nothing', () => {
    const out = cut(log('### Fixed\n\n- urgent'), '0.4.1', '2026-03-01');
    expect(sectionOf(out, '0.4.1')).toBe('### Fixed\n\n- urgent');
    expect(out).toContain(`[0.4.1]: ${BASE}/compare/v0.4.0...v0.4.1`);
    expect(() => cut(log(''), '0.4.1', '2026-03-01')).toThrow('nothing to release');
  });

  it('keeps text it does not understand, in order, and merges the same heading twice in one section', () => {
    expect(fold(['Preface line.\n\n### Added\n\n- a\n\n### Added\n\n- b', '### Notes\n\n- n\n\n### Added\n\n- c'])).toBe('Preface line.\n\n### Added\n\n- a\n- b\n- c\n\n### Notes\n\n- n');
    expect(fold([])).toBe('');
  });

  it('keeps multi-line bullets and blank lines inside a bullet list', () => {
    const body = '### Fixed\n\n- one that\n  continues here\n\n- two after a blank line';
    expect(fold([body])).toBe(body);
  });
});

describe('changelog command line', () => {
  it('prints the status and rewrites the file, and exits non-zero with a message when it cannot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coxia-changelog-'));
    try {
      const file = join(dir, 'CHANGELOG.md');
      writeFileSync(file, log('### Added\n\n- a'));
      const script = join(__dirname, '..', 'scripts', 'release-changelog.mjs');
      const run = (...args: string[]) => spawnSync('node', [script, ...args], { encoding: 'utf8' });
      expect(run('status', file, '0.5.0').stdout.trim()).toBe('content');
      const cutRun = run('cut', file, '0.5.0-beta.1', '2026-02-01');
      expect(cutRun.status).toBe(0);
      expect(cutRun.stdout).toContain('moved [Unreleased] under [0.5.0-beta.1]');
      const stable = run('cut', file, '0.5.0', '2026-03-01');
      expect(stable.stdout).toContain('folded 1 beta section(s)');
      const failed = run('cut', file, '0.5.0', '2026-03-01');
      expect(failed.status).toBe(1);
      expect(failed.stderr).toContain('release-changelog:');
      expect(run().status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
