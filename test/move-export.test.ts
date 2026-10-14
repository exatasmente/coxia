// Exporting a workspace that stepped down (#309): what goes in the bundle, what stays out, and that the target key opens exactly the re-encrypted secrets and appears nowhere.
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_VERSION } from '../src/shared/contract';
import { MOVE_BUNDLE_FORMAT, type MoveManifest } from '../src/shared/move';
import { gcmDecrypt } from '../src/main/masterKey';
import { MoveError, exportBundle } from '../src/main/moveBundle';
import { SECRET_VALUES, git, keyHex, makeSource, portFor } from './helpers/move';

vi.setConfig({ testTimeout: 60_000 });

const all = (dir: string): string[] => readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort();
const deps = (s: ReturnType<typeof makeSource>) => ({ root: s.root, workspaceDir: s.dir, workspaceId: s.id, store: s.store, version: '9.9.9', contractVersion: CONTRACT_VERSION, home: '/nonexistent', now: () => new Date('2026-10-14T12:00:00Z') });
const outOf = (): string => join(mkdtempSync(join(tmpdir(), 'cerimonias-move-out-')), 'bundle');

describe('the bundle', () => {
  const s = makeSource();
  const target = keyHex();
  const out = outOf();
  const manifest = exportBundle(deps(s), { targetKey: target, out });

  it('writes the manifest of the contract', () => {
    expect(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))).toEqual(manifest);
    expect(manifest).toMatchObject({
      format: MOVE_BUNDLE_FORMAT,
      coxiaVersion: '9.9.9',
      contractVersion: CONTRACT_VERSION,
      exportedAt: '2026-10-14T12:00:00.000Z',
      workspace: { id: 'principal', name: 'Principal' },
      repos: [{ id: 'app', remoteUrl: 'git@example.com:group/project.git', gitName: 'Example Person', gitEmail: 'person@example.com', runBranches: [s.branch] }],
    });
    // The files of the bundle other than the manifest, and their size.
    const files = all(out).filter((f) => statSync(join(out, f)).isFile() && f !== 'manifest.json');
    expect(manifest.files).toBe(files.length);
    expect(manifest.bytes).toBe(files.reduce((n, f) => n + statSync(join(out, f)).size, 0));
  });

  it('carries the workspace without what a move leaves out, and the registry entry as is', () => {
    const files = all(join(out, 'workspace'));
    expect(files).toEqual(expect.arrayContaining(['config.json', 'acoes.json', 'historico', 'historico/2026-10-01.json', 'runs', 'runs/r-open01-aaaa.json']));
    expect(files.filter((f) => /owner\.|\.sock|sandbox|browser|Cookies/.test(f))).toEqual([]);
    expect(JSON.parse(readFileSync(join(out, 'registry.json'), 'utf8'))).toEqual({ id: 'principal', name: 'Principal', createdAt: '2026-01-01T00:00:00.000Z', test: false });
  });

  it('keeps folders 0700 and files 0600', () => {
    for (const f of ['', ...all(out)]) {
      const stat = statSync(join(out, f));
      expect(stat.mode & 0o777, f).toBe(stat.isDirectory() ? 0o700 : 0o600);
    }
  });

  it('moves the stored secrets the workspace refers to, under the target key, and leaves a command and an environment variable behind', () => {
    expect(manifest.secrets.moved).toEqual(['llm.main', 'plugin.demo.token', 'test.llm-key', 'vcs.forge']);
    expect(manifest.secrets.notMoved).toEqual([{ ref: 'llm.fromenv', type: 'env' }, { ref: 'llm.local', type: 'command' }]);
    const file = JSON.parse(readFileSync(join(out, 'secrets.json'), 'utf8')) as { version: number; entries: Record<string, { source: { type: string }; cipher: string }> };
    expect(file.version).toBe(1);
    expect(Object.keys(file.entries).sort()).toEqual(manifest.secrets.moved);
    for (const [ref, value] of Object.entries(SECRET_VALUES)) {
      const data = Buffer.from(file.entries[ref].cipher, 'base64');
      expect(gcmDecrypt(Buffer.from(target, 'hex'), data), ref).toBe(value);
      // The source machine's own key does not open them: they were sealed again, not copied.
      expect(gcmDecrypt(Buffer.from(s.key, 'hex'), data), ref).toBeNull();
    }
    expect(file.entries['unrelated.secret']).toBeUndefined();
  });

  it('has no secret in clear and not the target key, anywhere in the bundle', () => {
    for (const f of all(out)) {
      if (!statSync(join(out, f)).isFile()) continue;
      const body = readFileSync(join(out, f)).toString('latin1');
      for (const needle of [...Object.values(SECRET_VALUES), 'unrelated-value-EEE555', target, s.key, 'env-value']) expect(body.includes(needle), `${f} has ${needle.slice(0, 6)}`).toBe(false);
    }
  });

  it('bundles the branch of the open run, and not the one of a finished run', () => {
    expect(all(join(out, 'git'))).toEqual(['app.bundle']);
    const heads = git(s.clone, 'bundle', 'list-heads', join(out, 'git', 'app.bundle'));
    expect(heads).toContain('refs/heads/cycle/123-some-title');
    expect(heads).not.toContain('cycle/9-finished');
    git(s.clone, 'bundle', 'verify', join(out, 'git', 'app.bundle'));
  });
});

describe('what it refuses', () => {
  it('a key that is not 64 hex digits, an output that is not absolute or exists, and says nothing of the key', () => {
    const s = makeSource();
    const run = (input: { targetKey: unknown; out: unknown }): MoveError => {
      try {
        exportBundle(deps(s), input);
      } catch (e) {
        return e as MoveError;
      }
      throw new Error('it did not refuse');
    };
    const bad = 'zz'.repeat(32);
    const wrongKey = run({ targetKey: bad, out: outOf() });
    expect(wrongKey.code).toBe('invalid-input');
    expect(wrongKey.message).not.toContain(bad);
    expect(run({ targetKey: 'abc', out: outOf() }).code).toBe('invalid-input');
    expect(run({ targetKey: keyHex(), out: 'relative/bundle' }).code).toBe('invalid-input');
    const taken = mkdtempSync(join(tmpdir(), 'cerimonias-move-taken-'));
    expect(run({ targetKey: keyHex(), out: taken }).code).toBe('conflict');
  });

  it('leaves no half bundle when it fails, and scrubs the key from the message', () => {
    const s = makeSource();
    const key = keyHex();
    const out = outOf();
    const exploding = { ...deps(s), git: (cwd: string, args: string[]) => { if (args[0] === 'bundle') throw new Error(`boom ${key}`); return git(cwd, ...args); } };
    // Only the bundle fails: the branch is found and git is asked to make it.
    expect(() => exportBundle(exploding, { targetKey: key, out })).toThrow(/git failed|boom/);
    try {
      exportBundle(exploding, { targetKey: key, out });
    } catch (e) {
      expect((e as Error).message).not.toContain(key);
    }
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(join(out, '..'))).toEqual([]);
  });

  it('reports a stored secret it cannot read, rather than moving nothing silently', () => {
    const s = makeSource();
    const store = { list: () => s.store.list(), resolve: (ref: string) => { if (ref === 'llm.main') throw new Error('cannot'); return s.store.resolve(ref); } };
    const m = exportBundle({ ...deps(s), store }, { targetKey: keyHex(), out: outOf() });
    expect(m.secrets.notMoved).toContainEqual({ ref: 'llm.main', type: 'unreadable' });
    expect(m.secrets.moved).not.toContain('llm.main');
  });
});

describe('a repository that is not there', () => {
  it('is listed with what is known and no branch', () => {
    const s = makeSource();
    const cfg = JSON.parse(readFileSync(join(s.dir, 'config.json'), 'utf8'));
    cfg.projects.repos.push({ id: 'gone', path: join(s.root, 'nowhere'), remoteUrl: null, vcsId: null, projectPath: null });
    writeFileSync(join(s.dir, 'config.json'), JSON.stringify(cfg));
    const m = exportBundle(deps(s), { targetKey: keyHex(), out: outOf() });
    expect(m.repos.find((r) => r.id === 'gone')).toEqual({ id: 'gone', remoteUrl: null, gitName: null, gitEmail: null, runBranches: [] });
  });
});


describe('the channel', () => {
  beforeEach(() => vi.resetModules());

  it('is refused until the workspace is moved out, then answers the manifest and audits it without the key', async () => {
    const dataDir = join(mkdtempSync(join(tmpdir(), 'cerimonias-move-chan-')), 'data');
    const own = keyHex();
    const target = keyHex();
    const m = { ...(await import('../src/main/core')), rpc: await import('../src/main/rpc'), env: await import('../src/main/env'), secrets: await import('../src/main/secrets'), policy: await import('../src/main/webPolicy') };
    const core = m.createCoxia({ dataDir, secrets: portFor(own) });
    await core.start();
    try {
      m.secrets.secrets().set({ ref: 'vcs.forge', source: 'stored', value: SECRET_VALUES['vcs.forge'] });
      writeFileSync(join(m.env.atasDir(), 'config.json'), JSON.stringify({ vcs: [{ id: 'forge', secretRef: 'vcs.forge' }], projects: { repos: [] } }));
      const out = join(mkdtempSync(join(tmpdir(), 'cerimonias-move-chan-out-')), 'bundle');
      await expect(m.rpc.invokeAdmin('move:export', [{ targetKey: target, out }])).rejects.toMatchObject({ code: 'forbidden' });
      expect(existsSync(out)).toBe(false);

      await m.rpc.invokeAdmin('ownership:move-out', [{ to: 'vps:example:1' }]);
      const manifest = (await m.rpc.invokeAdmin('move:export', [{ targetKey: target, out }])) as MoveManifest;
      expect(manifest.secrets.moved).toEqual(['vcs.forge']);
      const file = JSON.parse(readFileSync(join(out, 'secrets.json'), 'utf8')) as { entries: Record<string, { cipher: string }> };
      expect(gcmDecrypt(Buffer.from(target, 'hex'), Buffer.from(file.entries['vcs.forge'].cipher, 'base64'))).toBe(SECRET_VALUES['vcs.forge']);

      // A wrong key answers invalid-input and the message does not repeat it.
      const bad = 'q'.repeat(64);
      await expect(m.rpc.invokeAdmin('move:export', [{ targetKey: bad, out: join(out, '..', 'again') }])).rejects.toMatchObject({ code: 'invalid-input' });

      const audit = readFileSync(join(m.env.atasDir(), 'auditoria.jsonl'), 'utf8');
      expect(audit).toContain('ownership move-export');
      for (const text of [target, own, bad, SECRET_VALUES['vcs.forge']]) expect(audit.includes(text)).toBe(false);
      expect(m.policy.webAccess('move:export', true)).toBe('deny');
      expect(m.policy.webAccess('move:export', false)).toBe('deny');
    } finally {
      await core.stop({ deadlineMs: 500 });
    }
  });
});
