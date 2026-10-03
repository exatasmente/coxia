import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// scripts/release.sh against real temporary repositories: the rules are about git state (branches, tags, ancestry), so the script itself runs.
// No network: git and `npm version --no-git-tag-version` are local, the public audit is a stub, and --skip-checks leaves out the toolchain.

const SCRIPTS = join(__dirname, '..', 'scripts');
const AUTHOR = 'Release Person <release@example.test>';
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.4.0] - 2026-01-01

### Added

- the start

[Unreleased]: https://example.test/r/compare/v0.4.0...HEAD
[0.4.0]: https://example.test/r/releases/tag/v0.4.0
`;

interface Run {
  code: number;
  out: string;
  err: string;
}

class World {
  readonly dir: string;
  private readonly env: NodeJS.ProcessEnv;

  /** A repository with `v0.4.0` tagged on its first commit; `moved` adds an unreleased entry on `main` after the tag. */
  constructor(moved = true, audit = 0) {
    const root = mkdtempSync(join(tmpdir(), 'coxia-release-'));
    roots.push(root);
    this.dir = join(root, 'repo');
    mkdirSync(join(this.dir, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'home'));
    this.env = { PATH: process.env.PATH, HOME: join(root, 'home'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LANG: 'C' };
    for (const f of ['release.sh', 'release-notes.sh', 'release-changelog.mjs']) copyFileSync(join(SCRIPTS, f), join(this.dir, 'scripts', f));
    writeFileSync(join(this.dir, 'scripts', 'public-audit.mjs'), `process.exit(${audit});\n`);
    this.git('init', '-q', '-b', 'main');
    writeFileSync(join(this.dir, 'package.json'), '{ "name": "demo", "version": "0.4.0" }\n');
    writeFileSync(join(this.dir, 'package-lock.json'), '{ "name": "demo", "version": "0.4.0", "lockfileVersion": 3, "requires": true, "packages": { "": { "name": "demo", "version": "0.4.0" } } }\n');
    writeFileSync(join(this.dir, 'CHANGELOG.md'), CHANGELOG);
    this.commit('init', 'init');
    this.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', 'v0.4.0', '-m', 'Demo 0.4.0');
    if (moved) {
      this.entry('Added', 'the first thing');
      this.commit('first thing', 'first');
    }
  }

  git(...args: string[]): string {
    const r = spawnSync('git', args, { cwd: this.dir, env: this.env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  }

  gitOk(...args: string[]): boolean {
    return spawnSync('git', args, { cwd: this.dir, env: this.env }).status === 0;
  }

  commit(file: string, message: string): void {
    writeFileSync(join(this.dir, 'work.txt'), `${readFileSync(join(this.dir, 'work.txt'), { encoding: 'utf8', flag: 'a+' })}${file}\n`);
    this.git('add', '-A');
    this.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', message);
  }

  /** A changelog entry under [Unreleased] (not committed). */
  entry(heading: string, bullet: string): void {
    const file = join(this.dir, 'CHANGELOG.md');
    const text = readFileSync(file, 'utf8');
    const at = text.indexOf('## [Unreleased]\n') + '## [Unreleased]\n'.length;
    writeFileSync(file, `${text.slice(0, at)}\n### ${heading}\n\n- ${bullet}\n${text.slice(at)}`);
  }

  /** An entry plus a commit, as one merged change on the current branch. */
  change(heading: string, bullet: string): void {
    this.entry(heading, bullet);
    this.commit(bullet, `feat: ${bullet}`);
  }

  run(...args: string[]): Run {
    const r = spawnSync('bash', [join(this.dir, 'scripts', 'release.sh'), ...args], { cwd: this.dir, env: this.env, encoding: 'utf8', timeout: 60_000 });
    return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
  }

  /** The script with the identity and no checks, the way the tests cut a version. */
  cut(...args: string[]): Run {
    return this.run(...args, '--author', AUTHOR, '--skip-checks', '--date', '2026-02-01');
  }

  snapshot(): string {
    return [this.git('status', '--porcelain'), this.git('rev-parse', 'HEAD'), this.git('branch', '--list'), this.git('tag', '--list'), readFileSync(join(this.dir, 'package.json'), 'utf8'), readFileSync(join(this.dir, 'CHANGELOG.md'), 'utf8')].join('\n--\n');
  }

  file(name: string): string {
    return readFileSync(join(this.dir, name), 'utf8');
  }

  get version(): string {
    return (JSON.parse(this.file('package.json')) as { version: string }).version;
  }

  get branch(): string {
    return this.git('rev-parse', '--abbrev-ref', 'HEAD');
  }

  /** A world with release/0.5.0 open, one change on it and the first beta cut. */
  static withBeta(): World {
    const w = new World();
    expect(w.run('open', '0.5.0').code).toBe(0);
    w.change('Fixed', 'a fix on the branch');
    expect(w.cut('beta').code).toBe(0);
    return w;
  }
}

describe('release.sh open', () => {
  it('creates release/X.Y.Z from main, switches to it and pushes nothing', () => {
    const w = new World();
    const main = w.git('rev-parse', 'main');
    const r = w.run('open', '0.5.0');
    expect(r.code).toBe(0);
    expect(w.branch).toBe('release/0.5.0');
    expect(w.git('rev-parse', 'HEAD')).toBe(main);
    expect(r.out).toContain('git push -u origin release/0.5.0');
    expect(w.git('remote')).toBe('');
  });

  it('needs no identity and changes nothing on a dry run', () => {
    const w = new World();
    const before = w.snapshot();
    const r = w.run('open', '0.5.0', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('open release/0.5.0 from main');
    expect(w.snapshot()).toBe(before);
    expect(w.branch).toBe('main');
  });

  it.each([
    ['a suffix', ['open', '0.5.0-beta.1'], 'stable version'],
    ['a leading v', ['open', 'v0.5.0'], 'stable version'],
    ['no version', ['open'], 'stable version'],
    ['a released version', ['open', '0.4.0'], 'already exists'],
    ['a version below the latest stable', ['open', '0.3.0'], 'not above the latest stable'],
  ])('refuses %s', (_name, args, message) => {
    const w = new World();
    const r = w.run(...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
    expect(w.branch).toBe('main');
  });

  it('refuses a branch that already exists, a version that already has a beta and a dirty tree', () => {
    const w = new World();
    w.git('branch', 'release/0.5.0');
    expect(w.run('open', '0.5.0').err).toContain('release/0.5.0 already exists');
    w.git('branch', '-D', 'release/0.5.0');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'tag', '-a', 'v0.5.0-beta.1', '-m', 'x');
    expect(w.run('open', '0.5.0').err).toContain('already has a beta tag');
    writeFileSync(join(w.dir, 'dirty.txt'), 'x');
    expect(w.run('open', '0.6.0').err).toContain('not clean');
  });

  it('refuses a main that is behind origin/main', () => {
    const w = new World();
    w.git('checkout', '-q', '-b', 'side');
    w.commit('ahead', 'ahead');
    w.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    w.git('checkout', '-q', 'main');
    const r = w.run('open', '0.5.0');
    expect(r.code).toBe(1);
    expect(r.err).toContain('behind origin/main');
  });

  it('cuts a patch from the stable tag, not from a main that moved', () => {
    const w = new World();
    const refused = w.run('open', '0.4.1');
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('open 0.4.1 --from v0.4.0');
    const r = w.run('open', '0.4.1', '--from', 'v0.4.0');
    expect(r.code).toBe(0);
    expect(w.branch).toBe('release/0.4.1');
    expect(w.git('rev-parse', 'HEAD')).toBe(w.git('rev-parse', 'v0.4.0^{commit}'));
  });

  it('cuts a patch from main when main is exactly at the stable tag', () => {
    const w = new World(false);
    expect(w.run('open', '0.4.1').code).toBe(0);
    expect(w.branch).toBe('release/0.4.1');
  });

  it.each([
    ['another minor', ['open', '0.5.1', '--from', 'v0.4.0'], 'is for a patch'],
    ['a version that is not above the tag', ['open', '0.4.0', '--from', 'v0.4.0'], 'already exists'],
    ['a tag that does not exist', ['open', '0.4.2', '--from', 'v0.4.1'], 'does not exist'],
    ['something that is not a stable tag', ['open', '0.4.2', '--from', 'main'], 'stable tag'],
  ])('refuses --from with %s', (_name, args, message) => {
    const w = new World();
    const r = w.run(...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(message);
  });
});

describe('release.sh beta', () => {
  it('cuts X.Y.Z-beta.1 on release/X.Y.Z, and says so on a dry run without changing anything', () => {
    const w = new World();
    w.run('open', '0.6.0');
    const before = w.snapshot();
    const r = w.run('--dry-run', 'beta', '--author', AUTHOR, '--skip-checks');
    expect(r.code).toBe(0);
    expect(r.out).toContain('v0.6.0-beta.1 from release/0.6.0');
    expect(r.out).toContain('beta update channel');
    expect(w.snapshot()).toBe(before);
  });

  it('commits and tags with the given identity, bumps the version, moves the changelog and never touches git config', () => {
    const w = World.withBeta();
    expect(w.version).toBe('0.5.0-beta.1');
    expect(w.git('cat-file', '-t', 'v0.5.0-beta.1')).toBe('tag');
    expect(w.git('log', '-1', '--format=%an <%ae>|%s')).toBe('Release Person <release@example.test>|feat: release 0.5.0-beta.1');
    expect(w.git('for-each-ref', '--format=%(taggername) %(taggeremail)', 'refs/tags/v0.5.0-beta.1')).toBe('Release Person <release@example.test>');
    expect(w.gitOk('config', '--local', '--get', 'user.name')).toBe(false);
    expect(w.gitOk('config', '--local', '--get', 'user.email')).toBe(false);
    const log = w.file('CHANGELOG.md');
    expect(log).toContain('## [0.5.0-beta.1] - 2026-02-01');
    expect(log).toContain('[Unreleased]: https://example.test/r/compare/v0.5.0-beta.1...HEAD');
    expect(log).toContain('[0.5.0-beta.1]: https://example.test/r/compare/v0.4.0...v0.5.0-beta.1');
  });

  it('numbers the next beta by itself, from the tags', () => {
    const w = World.withBeta();
    w.change('Fixed', 'a fix for the beta');
    const dry = w.run('beta', '--dry-run', '--author', AUTHOR);
    expect(dry.out).toContain('v0.5.0-beta.2 from release/0.5.0');
    expect(w.cut('beta').code).toBe(0);
    expect(w.version).toBe('0.5.0-beta.2');
    const log = w.file('CHANGELOG.md');
    expect(log).toContain('[0.5.0-beta.2]: https://example.test/r/compare/v0.5.0-beta.1...v0.5.0-beta.2');
    const notes = spawnSync('bash', [join(w.dir, 'scripts', 'release-notes.sh'), '0.5.0-beta.2'], { encoding: 'utf8' }).stdout;
    expect(notes).toContain('a fix for the beta');
    expect(notes).not.toContain('a fix on the branch');
  });

  it('accepts an explicit number that follows the latest, refuses a taken or lower one and warns about a gap', () => {
    const w = World.withBeta();
    w.change('Fixed', 'one more');
    expect(w.cut('0.5.0-beta.1').err).toContain('already exists');
    const gap = w.run('--dry-run', '0.5.0-beta.4', '--author', AUTHOR);
    expect(gap.code).toBe(0);
    expect(gap.err).toContain('skips a number');
    expect(w.cut('0.5.0-beta.2').code).toBe(0);
    w.change('Fixed', 'and another');
    const lower = w.cut('0.5.0-beta.1');
    expect(lower.code).toBe(1);
  });

  it('refuses a version whose number does not match the branch', () => {
    const w = new World();
    w.run('open', '0.5.0');
    const r = w.cut('0.6.0-beta.1');
    expect(r.code).toBe(1);
    expect(r.err).toContain('release/0.5.0 cuts 0.5.0-beta.N, not 0.6.0-beta.1');
    expect(w.git('tag', '--list', 'v0.6.0*')).toBe('');
  });

  it('refuses a beta on main and on a branch that is not a release branch, and says what to do', () => {
    const w = new World();
    const onMain = w.cut('beta');
    expect(onMain.code).toBe(1);
    expect(onMain.err).toContain('scripts/release.sh open X.Y.Z');
    expect(w.cut('0.5.0-beta.1').err).toContain('a beta is cut on release/0.5.0');
    w.git('checkout', '-q', '-b', 'feat-thing');
    expect(w.cut('0.5.0-beta.1').code).toBe(1);
    expect(w.cut('beta').code).toBe(1);
  });

  it('lets --allow-branch through, loudly', () => {
    const w = new World();
    const r = w.run('0.5.0-beta.1', '--dry-run', '--allow-branch', '--author', AUTHOR);
    expect(r.code).toBe(0);
    expect(r.err).toContain('--allow-branch: 0.5.0-beta.1 is cut on');
    expect(r.err).toContain('!!');
  });

  it('refuses a pre-release that is not a beta with a number, and --emergency on a beta', () => {
    const w = new World();
    w.run('open', '0.5.0');
    expect(w.cut('0.5.0-rc.1').err).toContain('only the beta channel is wired');
    expect(w.cut('0.5.0-beta').code).toBe(1);
    expect(w.cut('0.5.0-beta.0').code).toBe(1);
    expect(w.cut('beta', '--emergency').err).toContain('applies to a stable');
  });

  it('refuses an empty changelog, a dirty tree, a missing identity and a failed public audit', () => {
    const w = World.withBeta();
    expect(w.cut('beta').err).toContain('[Unreleased] is empty');
    w.change('Fixed', 'another fix');
    writeFileSync(join(w.dir, 'dirty.txt'), 'x');
    expect(w.cut('beta').err).toContain('not clean');
    rmSync(join(w.dir, 'dirty.txt'));
    expect(w.run('beta', '--skip-checks').err).toContain('--author');
    const bad = new World(true, 1);
    bad.run('open', '0.5.0');
    const r = bad.run('beta', '--dry-run', '--author', AUTHOR);
    expect(r.code).toBe(1);
    expect(r.err).toContain('public audit failed');
  });
});

describe('release.sh stable', () => {
  const merged = (): World => {
    const w = World.withBeta();
    w.change('Fixed', 'a fix for the beta');
    expect(w.cut('beta').code).toBe(0);
    w.git('checkout', '-q', 'main');
    w.git('merge', '-q', '--ff-only', 'release/0.5.0');
    return w;
  };

  it('is refused on main before any beta', () => {
    const w = new World();
    const r = w.cut('0.5.0');
    expect(r.code).toBe(1);
    expect(r.err).toContain('has not been through the beta');
    expect(r.err).toContain('--emergency');
    expect(w.git('tag', '--list', 'v0.5.0')).toBe('');
    expect(w.cut('stable').err).toContain('already a stable version');
  });

  it('is refused while the beta is not in main', () => {
    const w = World.withBeta();
    w.git('checkout', '-q', 'main');
    const r = w.cut('0.5.0');
    expect(r.code).toBe(1);
    expect(r.err).toContain('v0.5.0-beta.1 is not in main');
    expect(r.err).toContain('release/0.5.0 is not merged into main');
  });

  it('cuts the stable once a beta exists and the branch is merged, reading the version from package.json', () => {
    const w = merged();
    expect(w.version).toBe('0.5.0-beta.2');
    const dry = w.run('stable', '--dry-run', '--author', AUTHOR);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('v0.5.0 from main');
    expect(dry.out).toContain('would fold the [0.5.0-beta.*] sections');
    const r = w.cut('stable');
    expect(r.code).toBe(0);
    expect(w.version).toBe('0.5.0');
    expect(w.git('cat-file', '-t', 'v0.5.0')).toBe('tag');
    expect(w.git('rev-parse', 'v0.5.0^{commit}')).toBe(w.git('rev-parse', 'HEAD'));
    expect(r.out).toContain('git push origin v0.5.0');
    expect(r.out).toContain('git push origin --delete release/0.5.0');
    expect(r.err).toBe('');
  });

  it('folds the beta sections of the version into the stable section', () => {
    const w = merged();
    expect(w.cut('0.5.0').code).toBe(0);
    const log = w.file('CHANGELOG.md');
    expect(log).not.toContain('[0.5.0-beta');
    expect(log).toContain('## [0.5.0] - 2026-02-01');
    const notes = spawnSync('bash', [join(w.dir, 'scripts', 'release-notes.sh'), '0.5.0'], { encoding: 'utf8' }).stdout;
    expect(notes).toContain('the first thing');
    expect(notes).toContain('a fix on the branch');
    expect(notes).toContain('a fix for the beta');
    expect(log).toContain('[0.5.0]: https://example.test/r/compare/v0.4.0...v0.5.0');
    expect(log).toContain('[Unreleased]: https://example.test/r/compare/v0.5.0...HEAD');
  });

  it('accepts a main that moved on, merged without a fast-forward, and a release branch that is already gone', () => {
    const w = World.withBeta();
    w.git('checkout', '-q', 'main');
    writeFileSync(join(w.dir, 'other.txt'), 'main moved on\n');
    w.git('add', 'other.txt');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'something else on main');
    w.git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'merge', '-q', '--no-ff', '-m', 'merge release/0.5.0', 'release/0.5.0');
    w.git('branch', '-q', '-D', 'release/0.5.0');
    const dry = w.run('0.5.0', '--dry-run', '--author', AUTHOR);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('no longer exists here');
  });

  it('refuses commits on the release branch that no beta carried, even when they are merged', () => {
    const w = World.withBeta();
    w.change('Fixed', 'after the beta');
    w.git('checkout', '-q', 'main');
    w.git('merge', '-q', '--ff-only', 'release/0.5.0');
    const r = w.cut('0.5.0');
    expect(r.code).toBe(1);
    expect(r.err).toContain('release/0.5.0 is 1 commit(s) ahead of v0.5.0-beta.1');
    expect(r.err).toContain('cut another beta first');
  });

  it('refuses a version that is not above the latest stable, and a stable on a release branch', () => {
    const w = merged();
    expect(w.cut('0.4.0').err).toContain('already exists');
    expect(w.cut('0.3.9').err).toContain('not above the latest stable 0.4.0');
    w.git('checkout', '-q', 'release/0.5.0');
    expect(w.cut('0.5.0').err).toContain('a stable is cut on main');
    expect(w.cut('stable').err).toContain('a stable is cut on main');
  });

  it('cuts an emergency stable without a beta, loudly, and writes it in the tag', () => {
    const w = new World();
    const dry = w.run('0.4.1', '--emergency', '--dry-run', '--author', AUTHOR);
    expect(dry.code).toBe(0);
    expect(dry.err).toContain('EMERGENCY');
    const r = w.cut('0.4.1', '--emergency');
    expect(r.code).toBe(0);
    expect(r.err.match(/EMERGENCY/g)?.length).toBe(2);
    expect(r.err).toContain('skipped: no tag v0.4.1-beta.* exists');
    const message = w.git('for-each-ref', '--format=%(contents)', 'refs/tags/v0.4.1');
    expect(message).toContain('emergency');
    expect(message).toContain('skipped: no tag v0.4.1-beta.* exists');
    expect(w.version).toBe('0.4.1');
  });

  it('keeps the checks of an emergency stable: the changelog, the version order and the branch', () => {
    const w = new World(false);
    expect(w.cut('0.4.1', '--emergency').err).toContain('[Unreleased] is empty');
    expect(w.cut('0.4.0', '--emergency').code).toBe(1);
    w.git('checkout', '-q', '-b', 'feat-thing');
    expect(w.cut('0.4.1', '--emergency').err).toContain('a stable is cut on main');
  });

  it('says so when --emergency was not needed', () => {
    const w = merged();
    const r = w.run('0.5.0', '--emergency', '--dry-run', '--author', AUTHOR);
    expect(r.code).toBe(0);
    expect(r.out).toContain('nothing was skipped');
    expect(r.err).not.toContain('EMERGENCY');
  });
});

describe('release.sh arguments', () => {
  it('prints its usage with no argument and with --help', () => {
    const w = new World();
    expect(w.run().code).toBe(2);
    const help = w.run('--help');
    expect(help.code).toBe(0);
    expect(help.out).toContain('scripts/release.sh open');
    expect(help.out).toContain('--emergency');
  });

  it('refuses unknown options, two versions and --from outside open', () => {
    const w = new World();
    expect(w.run('0.5.0', '--nope').err).toContain('unknown option');
    expect(w.run('0.5.0', '0.5.1').err).toContain('more than one');
    expect(w.run('0.5.0', '--from', 'v0.4.0', '--author', AUTHOR).err).toContain('belongs to open');
  });
});
