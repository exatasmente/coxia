import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A repository the release actions can run in: the real scripts/release.sh (behind a wrapper that records its arguments), a bare "origin" on disk, and a stub
// `npx` so the checks of a cut (tsc, vitest, the build) pass without a toolchain or a network. Nothing here reaches a host.

const SCRIPTS = join(__dirname, '..', '..', 'scripts');
export const AUTHOR = { name: 'Release Person', email: 'release@example.test' };
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.4.0] - 2026-01-01

### Added

- the start

[Unreleased]: https://example.test/r/compare/v0.4.0...HEAD
[0.4.0]: https://example.test/r/releases/tag/v0.4.0
`;

const roots: string[] = [];
export const cleanWorlds = (): void => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));

export class ReleaseWorld {
  readonly root: string;
  readonly dir: string;
  readonly origin: string;
  readonly env: NodeJS.ProcessEnv;

  /** `main` with `v0.4.0` tagged on its first commit, one unreleased change after it, and everything pushed to `origin`. */
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'coxia-release-git-'));
    roots.push(this.root);
    this.dir = join(this.root, 'repo');
    this.origin = join(this.root, 'origin.git');
    const bin = join(this.root, 'bin');
    mkdirSync(join(this.dir, 'scripts'), { recursive: true });
    mkdirSync(join(this.root, 'home'));
    mkdirSync(bin);
    writeFileSync(join(bin, 'npx'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(bin, 'npx'), 0o755);
    this.env = { PATH: `${bin}:${process.env.PATH}`, HOME: join(this.root, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' };
    for (const f of ['release-notes.sh', 'release-changelog.mjs']) copyFileSync(join(SCRIPTS, f), join(this.dir, 'scripts', f));
    copyFileSync(join(SCRIPTS, 'release.sh'), join(this.dir, 'scripts', 'release.real.sh'));
    // The wrapper is what the runner calls as scripts/release.sh: it records the arguments (outside the repository) and runs the real script.
    writeFileSync(join(this.dir, 'scripts', 'release.sh'), '#!/usr/bin/env bash\nROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"\n{ for a in "$@"; do printf \'%s\\037\' "$a"; done; printf \'\\n\'; } >> "$ROOT/../argv.log"\nexec bash "$ROOT/scripts/release.real.sh" "$@"\n');
    chmodSync(join(this.dir, 'scripts', 'release.sh'), 0o755);
    writeFileSync(join(this.dir, 'scripts', 'public-audit.mjs'), 'process.exit(0);\n');
    writeFileSync(join(this.dir, 'scripts', 'theme-audit.mjs'), 'process.exit(0);\n');
    this.git('init', '-q', '-b', 'main');
    writeFileSync(join(this.dir, 'package.json'), '{ "name": "demo", "version": "0.4.0", "scripts": { "i18n:lint": "true" } }\n');
    writeFileSync(join(this.dir, 'package-lock.json'), '{ "name": "demo", "version": "0.4.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "demo", "version": "0.4.0" } } }\n');
    writeFileSync(join(this.dir, 'CHANGELOG.md'), CHANGELOG);
    this.commit('init', 'init');
    this.git(...ID, 'tag', '-a', 'v0.4.0', '-m', 'Demo 0.4.0');
    this.entry('Added', 'the first thing');
    this.commit('first thing', 'first');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', this.origin], { env: this.env });
    this.git('remote', 'add', 'origin', this.origin);
    this.git('push', '-q', 'origin', '--all');
    this.git('push', '-q', 'origin', '--tags');
    this.git('fetch', '-q', 'origin');
  }

  git(...args: string[]): string {
    const r = spawnSync('git', args, { cwd: this.dir, env: this.env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  }

  gitOk(...args: string[]): boolean {
    return spawnSync('git', args, { cwd: this.dir, env: this.env }).status === 0;
  }

  /** What `git` says about the bare origin. */
  remote(...args: string[]): string {
    const r = spawnSync('git', ['--git-dir', this.origin, ...args], { env: this.env, encoding: 'utf8' });
    return r.stdout.trim();
  }

  commit(file: string, message: string): void {
    writeFileSync(join(this.dir, 'work.txt'), `${readFileSync(join(this.dir, 'work.txt'), { encoding: 'utf8', flag: 'a+' })}${file}\n`);
    this.git('add', '-A');
    this.git(...ID, 'commit', '-q', '-m', message);
  }

  /** A changelog entry under [Unreleased] (not committed). */
  entry(heading: string, bullet: string): void {
    const file = join(this.dir, 'CHANGELOG.md');
    const text = readFileSync(file, 'utf8');
    const at = text.indexOf('## [Unreleased]\n') + '## [Unreleased]\n'.length;
    writeFileSync(file, `${text.slice(0, at)}\n### ${heading}\n\n- ${bullet}\n${text.slice(at)}`);
  }

  /** An entry plus a commit: one merged change on the current branch. */
  change(heading: string, bullet: string): void {
    this.entry(heading, bullet);
    this.commit(bullet, `feat: ${bullet}`);
  }

  /** Another person pushes `branch`, cut from `base` on origin, with one commit that changes `file`; this clone has not fetched it. Returns the commit. */
  pushedBranch(branch: string, base: string, file = 'feature.txt', text = 'a feature\n'): string {
    const other = join(this.root, `other-${branch.replace(/\//g, '-')}`);
    const sh = (...args: string[]): string => {
      const r = spawnSync('git', args, { cwd: other, env: this.env, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    spawnSync('git', ['clone', '-q', this.origin, other], { env: this.env });
    sh('checkout', '-q', '-b', branch, `origin/${base}`);
    writeFileSync(join(other, file), text);
    sh('add', '-A');
    sh(...ID, 'commit', '-q', '-m', `feat: ${branch}`);
    sh('push', '-q', 'origin', branch);
    return sh('rev-parse', 'HEAD');
  }

  /** The arguments each call of scripts/release.sh got, in order. */
  argv(): string[][] {
    const text = (() => {
      try {
        return readFileSync(join(this.root, 'argv.log'), 'utf8');
      } catch {
        return '';
      }
    })();
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\u001f').filter((_, i, all) => i < all.length - 1 || all[i] !== ''));
  }

  get branch(): string {
    return this.git('rev-parse', '--abbrev-ref', 'HEAD');
  }

  get version(): string {
    return (JSON.parse(readFileSync(join(this.dir, 'package.json'), 'utf8')) as { version: string }).version;
  }

  /** The environment the release script and git run in (no machine configuration, the stub `npx` first on the PATH). */
  scriptEnv(): NodeJS.ProcessEnv {
    return this.env;
  }
}
