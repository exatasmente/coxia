import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { compareTags, createFacts, manifestOf, newestTags, parseTag, roadmapSection, tomlVersion, versionDetail, versionLine } from '../src/main/memory/facts';
import { drive, startInput } from './helpers/runs';

// The version and the roadmap the memory gives an agent. Git runs in a temporary repository the test makes; nothing reaches the network or the real workspace.

let base: string;
const HOME = '/home/person';

const gitIn = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

function repo(name: string, tags: string[], manifest?: string): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-q', '-b', 'main');
  if (manifest !== undefined) writeFileSync(join(dir, 'package.json'), manifest);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'first');
  for (const t of tags) gitIn(dir, 'tag', t);
  return dir;
}

function config(repos: { id: string; path: string }[], roadmapFile?: string | null): WorkspaceConfig {
  const c = neutralConfig();
  c.projects.repos = repos.map((r) => ({ ...r, remoteUrl: null, vcsId: null, projectPath: null }));
  if (roadmapFile !== undefined) c.docs.roadmapFile = roadmapFile;
  return c;
}

const noSecret = (): boolean => false;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'coxia-facts-'));
});

describe('tags', () => {
  it('compares semver with a pre-release below its release and identifiers by number', () => {
    expect(compareTags('v0.9.0-beta.2', 'v0.9.0-beta.10')).toBeLessThan(0);
    expect(compareTags('v0.9.0-beta.14', 'v0.9.0')).toBeLessThan(0);
    expect(compareTags('v1.0.0', 'v0.9.9')).toBeGreaterThan(0);
    expect(compareTags('v0.9.0-alpha', 'v0.9.0-beta')).toBeLessThan(0);
    expect(compareTags('v0.9.0', 'v0.9.0')).toBe(0);
  });

  it('finds the newest tag and the newest stable one, and ignores what is not a version', () => {
    expect(newestTags(['v0.8.0', 'v0.9.0-beta.12', 'v0.9.0-beta.9', 'nightly', 'v1', 'vX.Y.Z'])).toEqual({ latest: 'v0.9.0-beta.12', stable: 'v0.8.0' });
    expect(newestTags([])).toEqual({ latest: null, stable: null });
    expect(parseTag('v1.2.3-rc.1')?.pre).toEqual(['rc', '1']);
    expect(parseTag('1.2.3')).toBeNull();
  });
});

describe('manifests', () => {
  it('reads package.json, pyproject.toml and Cargo.toml, the right section of each', () => {
    const dir = mkdtempSync(join(base, 'm-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3' }));
    expect(manifestOf(dir)).toEqual({ version: '1.2.3', file: 'package.json' });
    const py = mkdtempSync(join(base, 'p-'));
    writeFileSync(join(py, 'pyproject.toml'), '[build-system]\nversion = "9.9.9"\n\n[project]\nname = "x"\nversion = "0.4.1"\n');
    expect(manifestOf(py)).toEqual({ version: '0.4.1', file: 'pyproject.toml' });
    const rs = mkdtempSync(join(base, 'r-'));
    writeFileSync(join(rs, 'Cargo.toml'), '[package]\nname = "x"\nversion = "2.0.0-rc.1"\n\n[dependencies]\nversion = "5"\n');
    expect(manifestOf(rs)).toEqual({ version: '2.0.0-rc.1', file: 'Cargo.toml' });
    expect(tomlVersion('[package]\nname = "x"\n', 'package')).toBeNull();
  });

  it('says nothing for a missing, unreadable or odd version', () => {
    const dir = mkdtempSync(join(base, 'n-'));
    expect(manifestOf(dir)).toBeNull();
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(manifestOf(dir)).toBeNull();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: 'two words' }));
    expect(manifestOf(dir)).toBeNull();
  });
});

describe('the version', () => {
  it('reads the tags and the manifest of a repository: stable and pre-release apart', async () => {
    const dir = repo('api', ['v0.8.0', 'v0.9.0-beta.12', 'v0.9.0-beta.2'], JSON.stringify({ version: '0.9.0-beta.12' }));
    const facts = createFacts({ config: () => config([{ id: 'api', path: dir }]), secret: noSecret, home: HOME });
    const v = await facts.version([]);
    expect(v.state).toBe('ok');
    expect(v.line).toBe('Version: api latest v0.9.0-beta.12, stable v0.8.0, manifest 0.9.0-beta.12');
  });

  it('lists two repositories, and a repository with neither tag nor manifest is left out of the line', async () => {
    const api = repo('api', ['v1.0.0'], JSON.stringify({ version: '1.0.0' }));
    const web = repo('web', ['v0.3.0']);
    const bare = repo('bare', []);
    const facts = createFacts({ config: () => config([{ id: 'api', path: api }, { id: 'web', path: web }, { id: 'bare', path: bare }]), secret: noSecret, home: HOME });
    const v = await facts.version([]);
    expect(v.line).toBe('Version: api latest v1.0.0, stable v1.0.0, manifest 1.0.0; web latest v0.3.0, stable v0.3.0');
    expect(versionDetail(v)).toContain('bare: no release tag, no stable tag, no manifest version');
  });

  it('says it is unknown when no source answers, and never guesses', async () => {
    const bare = repo('bare', []);
    const none = createFacts({ config: () => config([{ id: 'bare', path: bare }, { id: 'gone', path: join(base, 'missing') }]), secret: noSecret, home: HOME });
    expect((await none.version([])).line).toBe('Version: unknown (no tag or manifest was found)');
    expect((await none.version([])).state).toBe('unknown');
    const empty = createFacts({ config: () => config([]), secret: noSecret, home: HOME });
    expect((await empty.version([])).state).toBe('unknown');
  });

  it('adds the version of an open release run, and not a finished one', async () => {
    const facts = createFacts({ config: () => config([]), secret: noSecret, home: HOME });
    const open = drive(undefined, startInput({ id: 'r-rel111-aa11', issue: { ref: 'release:0.9.0', iid: 0, title: 'Release 0.9.0', url: null }, subject: { kind: 'release', version: '0.9.0', from: null, tracking: null, activities: [] } })).run;
    const done: Run = { ...open, id: 'r-rel222-bb22', status: 'done', subject: { ...(open.subject as NonNullable<Run['subject']>), version: '0.8.1' } };
    const v = await facts.version([open, done]);
    expect(v.releases).toEqual(['0.9.0']);
    expect(v.line).toBe('Version: release in progress 0.9.0');
  });

  it('caches a repository for ten minutes and reads it again after', async () => {
    const dir = repo('api', ['v1.0.0']);
    let clock = 1_000;
    let asked = 0;
    const facts = createFacts({ config: () => config([{ id: 'api', path: dir }]), secret: noSecret, home: HOME, now: () => clock, tags: async () => (asked++, ['v1.0.0']) });
    await facts.version([]);
    await facts.version([]);
    expect(asked).toBe(1);
    clock += 9 * 60_000;
    await facts.version([]);
    expect(asked).toBe(1);
    clock += 2 * 60_000;
    await facts.version([]);
    expect(asked).toBe(2);
  });

  it('on a voice path never waits for git: a cold cache reads "not read yet", the refresh runs behind, the next call has the answer', async () => {
    const dir = repo('api', []);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const facts = createFacts({
      config: () => config([{ id: 'api', path: dir }]),
      secret: noSecret,
      home: HOME,
      tags: async () => {
        await gate;
        return ['v2.0.0'];
      },
    });
    // The git read is blocked on the gate: if the call awaited it, this would never settle.
    const cold = await facts.version([], { cacheOnly: true });
    expect(cold.state).toBe('cold');
    expect(cold.line).toBe('Version: not read yet');
    release();
    await facts.warm();
    const warm = await facts.version([], { cacheOnly: true });
    expect(warm.line).toBe('Version: api latest v2.0.0, stable v2.0.0');
  });

  it('reads the repositories at once and keeps the order of the configuration', async () => {
    const dirs = ['api', 'web', 'cli'].map((name) => ({ id: name, path: repo(name, []) }));
    const started: string[] = [];
    const gates = new Map<string, () => void>();
    const facts = createFacts({
      config: () => config(dirs),
      secret: noSecret,
      home: HOME,
      tags: (cwd) => {
        started.push(cwd);
        return new Promise<string[]>((resolve) => gates.set(cwd, () => resolve([`v${started.indexOf(cwd) + 1}.0.0`])));
      },
    });
    const pending = facts.version([]);
    await new Promise((r) => setTimeout(r, 20));
    // every git read has started before any of them answered: one after the other would have started only the first
    expect(started).toEqual(dirs.map((d) => d.path));
    // they answer in the reverse order; the line still follows the configuration
    for (const d of [...dirs].reverse()) gates.get(d.path)?.();
    const v = await pending;
    expect(v.repos.map((r) => r.repo)).toEqual(['api', 'web', 'cli']);
    expect(v.line).toBe('Version: api latest v1.0.0, stable v1.0.0; web latest v2.0.0, stable v2.0.0; cli latest v3.0.0, stable v3.0.0');
  });

  it('survives a git that fails', async () => {
    const dir = repo('api', []);
    const facts = createFacts({
      config: () => config([{ id: 'api', path: dir }]),
      secret: noSecret,
      home: HOME,
      tags: async () => {
        throw new Error('git is gone');
      },
    });
    expect((await facts.version([])).state).toBe('unknown');
  });

  it('words the line for the three states', () => {
    expect(versionLine([], [], false)).toContain('unknown');
    expect(versionLine([], [], true)).toBe('Version: not read yet');
  });
});

describe('the roadmap', () => {
  const write = (name: string, text: string): string => {
    const path = join(base, name);
    writeFileSync(path, text);
    return path;
  };

  it('says there is none without a pointer, and that it could not be read when the file is gone', () => {
    expect(createFacts({ config: () => config([]), secret: noSecret, home: HOME }).roadmap().line).toBe('Roadmap: none (no file is configured)');
    expect(createFacts({ config: () => config([], '   '), secret: noSecret, home: HOME }).roadmap().state).toBe('none');
    const gone = createFacts({ config: () => config([], join(base, 'missing.md')), secret: noSecret, home: HOME }).roadmap();
    expect(gone.state).toBe('unreadable');
    expect(gone.line).toBe('Roadmap: none (the file could not be read)');
  });

  it('reads the headings as sections: the title, how many, and the level-2 ones', () => {
    const path = write('roadmap.md', '# Roadmap\n\n## 1.0 on a server\ntext\n### Accounts\nmore\n## Calls between agents\n\n```\n## not a heading\n```\n## Process\n');
    const fact = createFacts({ config: () => config([], path), secret: noSecret, home: HOME }).roadmap();
    expect(fact.state).toBe('ok');
    expect(fact.line).toBe('Roadmap: Roadmap (5 sections): 1.0 on a server; Calls between agents; Process');
    expect(fact.headings.map((h) => h.title)).toEqual(['Roadmap', '1.0 on a server', 'Accounts', 'Calls between agents', 'Process']);
  });

  it('opens one section by name (a level-2 section carries its sub-sections) and answers the outline for an unknown one', () => {
    const path = write('roadmap.md', '# Roadmap\n\n## First\nalpha\n### Inner\nbeta\n## Second\ngamma\n');
    const fact = createFacts({ config: () => config([], path), secret: noSecret, home: HOME }).roadmap();
    expect(roadmapSection(fact, 'first')?.text).toBe('## First\nalpha\n### Inner\nbeta');
    expect(roadmapSection(fact, 'sec')?.text).toBe('## Second\ngamma');
    expect(roadmapSection(fact, 'nothing like it')).toBeNull();
    expect(roadmapSection(fact, undefined)?.outline).toEqual(['Roadmap', '  First', '    Inner', '  Second']);
  });

  it('masks what looks like a credential before it is kept', () => {
    const path = write('roadmap.md', '# Roadmap\n\n## Keys\napi_key = sk-abcdefghijklmnopqrstuvwxyz0123456789\n');
    const fact = createFacts({ config: () => config([], path), secret: noSecret, home: HOME }).roadmap();
    expect(fact.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('refuses a file that is too large, a link, and a path the secret filter holds back', () => {
    const big = write('big.md', `# Big\n${'x'.repeat(201 * 1024)}`);
    expect(createFacts({ config: () => config([], big), secret: noSecret, home: HOME }).roadmap().state).toBe('unreadable');
    const real = write('real.md', '# Real\n');
    const link = join(base, 'link.md');
    symlinkSync(real, link);
    expect(createFacts({ config: () => config([], link), secret: noSecret, home: HOME }).roadmap().state).toBe('unreadable');
    expect(createFacts({ config: () => config([], real), secret: (p) => p === real, home: HOME }).roadmap().state).toBe('unreadable');
    expect(createFacts({ config: () => config([], real), secret: noSecret, home: HOME }).roadmap().state).toBe('ok');
  });

  it('expands ~/ against the home it is given', () => {
    const home = mkdtempSync(join(base, 'home-'));
    writeFileSync(join(home, 'plan.md'), '# Plan\n## Now\n');
    expect(createFacts({ config: () => config([], '~/plan.md'), secret: noSecret, home }).roadmap().line).toBe('Roadmap: Plan (2 sections): Now');
  });

  it('reads the file again when it changes, and not otherwise', () => {
    const path = write('r.md', '# One\n');
    const facts = createFacts({ config: () => config([], path), secret: noSecret, home: HOME });
    const first = facts.roadmap();
    expect(facts.roadmap()).toBe(first);
    writeFileSync(path, '# Two\n## Later\n');
    expect(facts.roadmap().line).toBe('Roadmap: Two (2 sections): Later');
  });
});
