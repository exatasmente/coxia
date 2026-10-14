// The one-shot import of a move (#309): a bundle from `move:export` becomes a workspace of another data folder with another master key, staged and atomic, and the same bundle again is a no-op.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION } from '../src/shared/contract';
import { reattachWorktree } from '../src/main/runner/git';
import { exportBundle } from '../src/main/moveBundle';
import { ImportError, importBundle } from '../src/main/moveImport';
import { SECRET_VALUES, git, keyHex, makeSource, storeFor, type Source } from './helpers/move';

vi.setConfig({ testTimeout: 60_000 });

const tree = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
const sandbox = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-move-dst-'));

/** The machine the workspace moves to: an empty data folder, a master key file beside it (never inside), and the folder the clones are in. */
function target(base = sandbox(), key = keyHex()) {
  const dataDir = join(base, 'data');
  mkdirSync(dataDir);
  const keyFile = join(base, 'master.key');
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  return { base, dataDir, keyFile, key, reposRoot: join(base, 'repos', 'principal') };
}

function bundleOf(s: Source, key: string): string {
  const out = join(sandbox(), 'bundle');
  exportBundle({ root: s.root, workspaceDir: s.dir, workspaceId: s.id, store: s.store, version: '9.9.9', contractVersion: CONTRACT_VERSION, home: '/nonexistent' }, { targetKey: key, out });
  return out;
}

const run = (fn: () => unknown): ImportError => {
  try {
    fn();
  } catch (e) {
    return e as ImportError;
  }
  throw new Error('it did not refuse');
};

describe('export, then import, on two machines with different keys', () => {
  const src = makeSource();
  const dst = target();
  const bundle = bundleOf(src, dst.key);
  const result = importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot });

  it('says what it imported and where the repositories are', () => {
    expect(result).toEqual({ imported: 'principal', repos: [{ id: 'app', path: join(dst.reposRoot, 'app') }] });
  });

  it('places the workspace without a lease or a socket, and registers it', () => {
    const files = tree(join(dst.dataDir, 'workspaces', 'principal'));
    expect(files).toEqual(expect.arrayContaining(['config.json', 'historico/2026-10-01.json', 'runs/r-open01-aaaa.json']));
    expect(files.filter((f) => /owner\.|\.sock|sandbox|browser/.test(f))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dst.dataDir, 'workspaces.json'), 'utf8'))).toEqual({ current: 'principal', list: [{ id: 'principal', name: 'Principal', createdAt: '2026-01-01T00:00:00.000Z', test: false }] });
  });

  it('points every repository and the roots at the folder of the clones', () => {
    const config = JSON.parse(readFileSync(join(dst.dataDir, 'workspaces', 'principal', 'config.json'), 'utf8'));
    expect(config.projects.repos.map((r: { id: string; path: string }) => [r.id, r.path])).toEqual([['app', join(dst.reposRoot, 'app')]]);
    expect(config.projects.roots).toEqual([dst.reposRoot]);
    // What was not about a path is as it was.
    expect(config.projects.repos[0].remoteUrl).toBe('git@example.com:group/project.git');
  });

  it('resolves every stored secret with the new key and none of what stayed behind', () => {
    const store = storeFor(dst.dataDir, dst.key);
    for (const [ref, value] of Object.entries(SECRET_VALUES)) expect(store.resolve(ref), ref).toBe(value);
    expect(store.has('llm.local')).toBe(false);
    expect(store.has('unrelated.secret')).toBe(false);
    expect(statSync(join(dst.dataDir, 'secrets.json')).mode & 0o777).toBe(0o600);
    // The old machine's key does not open them.
    expect(() => storeFor(dst.dataDir, src.key).resolve('vcs.forge')).toThrow();
  });

  it('leaves no staging folder behind', () => {
    expect(tree(dst.dataDir).filter((f) => f.startsWith('.import-'))).toEqual([]);
  });

  it('is a no-op the second time, even after the workspace changed, and writes nothing', () => {
    writeFileSync(join(dst.dataDir, 'workspaces', 'principal', 'config.json'), '{"changed":true}');
    const before = tree(dst.dataDir);
    const secrets = readFileSync(join(dst.dataDir, 'secrets.json'), 'utf8');
    expect(importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot })).toEqual({ ...result, alreadyImported: true });
    expect(tree(dst.dataDir)).toEqual(before);
    expect(readFileSync(join(dst.dataDir, 'secrets.json'), 'utf8')).toBe(secrets);
    expect(readFileSync(join(dst.dataDir, 'workspaces', 'principal', 'config.json'), 'utf8')).toBe('{"changed":true}');
  });

  it('refuses another bundle of the same workspace, which would overwrite what runs there', () => {
    const again = bundleOf(src, dst.key);
    expect(run(() => importBundle({ bundle: again, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot })).code).toBe('conflict');
  });

  it('carries the run branch: the bundle of the repository fetches into a clone of the remote', async () => {
    const clone = join(sandbox(), 'clone');
    execFileSync('git', ['clone', '-q', src.origin, clone], { stdio: 'ignore' });
    git(clone, 'fetch', '-q', join(bundle, 'git', 'app.bundle'), 'refs/heads/*:refs/heads/*');
    expect(git(clone, 'log', '--format=%s', '-1', src.branch)).toBe('work in progress');
    // And the run resumes there: its branch is checked out again in a worktree of the new clone, and a branch the clone lacks is not.
    const dest = join(sandbox(), 'worktrees', 'app', 'wt');
    expect(await reattachWorktree(clone, dest, src.branch)).toBe(true);
    expect(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(src.branch);
    expect(await reattachWorktree(clone, join(sandbox(), 'other'), 'cycle/not-there')).toBe(false);
  });
});

describe('what it refuses, and leaves untouched', () => {
  it('a secret that exists with a different value', () => {
    const src = makeSource();
    const dst = target();
    storeFor(dst.dataDir, dst.key).set({ ref: 'vcs.forge', source: 'stored', value: 'another-token' });
    const before = tree(dst.dataDir);
    const secrets = readFileSync(join(dst.dataDir, 'secrets.json'), 'utf8');
    const e = run(() => importBundle({ bundle: bundleOf(src, dst.key), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot }));
    expect(e.code).toBe('conflict');
    expect(e.message).toContain('vcs.forge');
    expect(tree(dst.dataDir)).toEqual(before);
    expect(readFileSync(join(dst.dataDir, 'secrets.json'), 'utf8')).toBe(secrets);
  });

  it('accepts the same value sealed again, and keeps the entry that was there', () => {
    const src = makeSource();
    const dst = target();
    const store = storeFor(dst.dataDir, dst.key);
    store.set({ ref: 'vcs.forge', source: 'stored', value: SECRET_VALUES['vcs.forge'] });
    store.set({ ref: 'mine.already', source: 'stored', value: 'kept' });
    importBundle({ bundle: bundleOf(src, dst.key), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot });
    expect(store.resolve('vcs.forge')).toBe(SECRET_VALUES['vcs.forge']);
    expect(store.resolve('mine.already')).toBe('kept');
    expect(store.resolve('llm.main')).toBe(SECRET_VALUES['llm.main']);
  });

  it('a bundle sealed for another key', () => {
    const src = makeSource();
    const dst = target();
    const e = run(() => importBundle({ bundle: bundleOf(src, keyHex()), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot }));
    expect(e.code).toBe('bad-key');
    expect(tree(dst.dataDir)).toEqual([]);
  });

  it('a master key file that is not safe', () => {
    const src = makeSource();
    const dst = target();
    chmodSync(dst.keyFile, 0o644);
    expect(run(() => importBundle({ bundle: bundleOf(src, dst.key), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot })).code).toBe('invalid-input');
    expect(tree(dst.dataDir)).toEqual([]);
  });

  it('a repository that cannot be cloned, a newer format and something that is not a bundle', () => {
    const src = makeSource();
    const dst = target();
    const bundle = bundleOf(src, dst.key);
    const manifestFile = join(bundle, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, repos: [{ ...manifest.repos[0], remoteUrl: null }] }));
    const noRemote = run(() => importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot }));
    expect(noRemote.code).toBe('no-remote');
    expect(noRemote.message).toContain('app');
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, format: 99 }));
    expect(run(() => importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot })).code).toBe('newer-format');
    expect(run(() => importBundle({ bundle: sandbox(), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot })).code).toBe('bad-bundle');
    expect(tree(dst.dataDir)).toEqual([]);
  });

  it('a workspace that is already there with work in it, but replaces the empty one an installer made', () => {
    const src = makeSource();
    const worked = target();
    const info = { id: 'principal', name: 'Principal', createdAt: '2026-02-02T00:00:00.000Z', test: false };
    writeFileSync(join(worked.dataDir, 'workspaces.json'), JSON.stringify({ current: 'principal', list: [info] }));
    mkdirSync(join(worked.dataDir, 'workspaces', 'principal'), { recursive: true });
    writeFileSync(join(worked.dataDir, 'workspaces', 'principal', 'config.json'), '{"setupComplete":true}');
    expect(run(() => importBundle({ bundle: bundleOf(src, worked.key), dataDir: worked.dataDir, keyFile: worked.keyFile, reposRoot: worked.reposRoot })).code).toBe('conflict');

    const fresh = target();
    writeFileSync(join(fresh.dataDir, 'workspaces.json'), JSON.stringify({ current: 'principal', list: [info] }));
    mkdirSync(join(fresh.dataDir, 'workspaces', 'principal'), { recursive: true });
    writeFileSync(join(fresh.dataDir, 'workspaces', 'principal', 'config.json'), '{"setupComplete":false}');
    importBundle({ bundle: bundleOf(src, fresh.key), dataDir: fresh.dataDir, keyFile: fresh.keyFile, reposRoot: fresh.reposRoot });
    expect(JSON.parse(readFileSync(join(fresh.dataDir, 'workspaces.json'), 'utf8')).list).toEqual([{ id: 'principal', name: 'Principal', createdAt: '2026-01-01T00:00:00.000Z', test: false }]);
    expect(existsSync(join(fresh.dataDir, 'workspaces', 'principal', 'runs', 'r-open01-aaaa.json'))).toBe(true);
  });

  it('keeps the workspaces and the current one that were already registered', () => {
    const src = makeSource();
    const dst = target();
    const other = { id: 'other', name: 'Other', createdAt: '2026-02-02T00:00:00.000Z', test: false };
    writeFileSync(join(dst.dataDir, 'workspaces.json'), JSON.stringify({ current: 'other', list: [other] }));
    mkdirSync(join(dst.dataDir, 'workspaces', 'other'), { recursive: true });
    importBundle({ bundle: bundleOf(src, dst.key), dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot });
    const registry = JSON.parse(readFileSync(join(dst.dataDir, 'workspaces.json'), 'utf8'));
    expect(registry.current).toBe('other');
    expect(registry.list.map((w: { id: string }) => w.id)).toEqual(['other', 'principal']);
  });

  it('leaves nothing half written when putting it in place fails', () => {
    const src = makeSource();
    const dst = target();
    const bundle = bundleOf(src, dst.key);
    const before = tree(dst.dataDir);
    // The workspace and the secrets are already in place when the registry's rename fails: both are taken back.
    const rename = (from: string, to: string): void => {
      if (to.endsWith('workspaces.json')) throw new Error('disk full');
      renameSync(from, to);
    };
    expect(() => importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot }, { rename })).toThrow('disk full');
    expect(tree(dst.dataDir)).toEqual(before);
    // And the same bundle imports once the fault is gone.
    expect(importBundle({ bundle, dataDir: dst.dataDir, keyFile: dst.keyFile, reposRoot: dst.reposRoot }).imported).toBe('principal');
  });
});


describe('the headless entry with --import', () => {
  beforeEach(() => vi.resetModules());
  const entry = async () => {
    (await import('../src/shared/i18n')).setLanguage('en');
    return (await import('../src/headless/main')).main;
  };

  it('imports, prints one JSON line, exits 0 and starts nothing', async () => {
    const main = await entry();
    const src = makeSource();
    const dst = target();
    const bundle = bundleOf(src, dst.key);
    const exit = vi.fn();
    const out: string[] = [];
    const err: string[] = [];
    expect(await main(['--import', bundle, '--data-dir', dst.dataDir, '--master-key-file', dst.keyFile, '--repos-root', dst.reposRoot], {}, { exit, out: (l) => out.push(l), err: (l) => err.push(l) })).toBeNull();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(err).toEqual([]);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0])).toEqual({ imported: 'principal', repos: [{ id: 'app', path: join(dst.reposRoot, 'app') }] });
    expect(tree(dst.dataDir).some((f) => f.endsWith('admin.sock') || f.endsWith('owner.json'))).toBe(false);
  });

  it('says `<code>: <message>` on stderr and exits 1, and asks for what it needs', async () => {
    const main = await entry();
    const src = makeSource();
    const dst = target();
    storeFor(dst.dataDir, dst.key).set({ ref: 'llm.main', source: 'stored', value: 'different' });
    const exit = vi.fn();
    const err: string[] = [];
    await main(['--import', bundleOf(src, dst.key), '--data-dir', dst.dataDir, '--master-key-file', dst.keyFile, '--repos-root', dst.reposRoot], {}, { exit, out: () => undefined, err: (l) => err.push(l) });
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(err[0]).toMatch(/^conflict: .*llm\.main/);

    const exit2 = vi.fn();
    const err2: string[] = [];
    await main(['--import', 'x', '--data-dir', dst.dataDir, '--master-key-file', dst.keyFile], {}, { exit: exit2, out: () => undefined, err: (l) => err2.push(l) });
    expect(exit2).toHaveBeenCalledExactlyOnceWith(1);
    expect(err2[0]).toContain('--repos-root');
  });
});
