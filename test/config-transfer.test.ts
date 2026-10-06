import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { newProvider, neutralConfig } from '../src/shared/config/defaults';
import { EXPORT_FORMAT, buildExport, diffConfig, parseImport } from '../src/shared/config/transfer';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { collectSecretRequirements, validateConfig } from '../src/shared/config/validate';
import { CONFIG_FILE, bootstrapConfigs, readConfigFile, writeConfigFile } from '../src/main/config-bootstrap';
import { applyImport, exportText, previewImport, type TransferDeps } from '../src/main/config-transfer';
import { type CryptoPort, createSecretsStore } from '../src/main/secrets-core';
import { createWorkspace, ensureWorkspaces, workspaceDir } from '../src/main/workspaces-core';
import { legacyConfigFixture } from './helpers/config';

const crypto: CryptoPort = { available: () => true, encrypt: (t) => Buffer.from(`enc:${t}`), decrypt: (d) => d.toString().slice(4), backend: () => 'kwallet' };
const quiet = { log: () => undefined, now: () => new Date('2026-10-02T12:00:00Z') };
const SECRET_VALUE = 'sk-never-in-an-export';

let root: string;
let deps: TransferDeps;
let present: Set<string>;

function sample(): WorkspaceConfig {
  const c = neutralConfig();
  c.setupComplete = true;
  c.language = 'en';
  c.projects.roots = ['~/work'];
  c.projects.repos = [{ id: 'api', path: '~/work/api', remoteUrl: 'git@github.com:acme/api.git', vcsId: 'gh', projectPath: 'acme/api' }];
  c.projects.issues = { vcsId: 'gh', project: 'acme/api', projectId: null, refPrefix: 'API-', cardScope: 'labels', cardLabels: ['ready', 'sprint 12'] };
  c.vcs = [{ id: 'gh', kind: 'github', host: 'github.com', apiUrl: '', user: 'ana', secretRef: 'vcs.github', cliPreference: 'auto', cliCommand: null }];
  c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', models: ['qwen3:8b'], structured: 'tool' }));
  c.llm.roles.deep = { provider: 'local', model: 'qwen3:8b' };
  c.externalTools.cardSource = { enabled: true, command: '~/bin/cards', reportArgs: ['--json'], noteArgs: [], stateFile: null, historyFile: null, timeoutMs: 60_000 };
  return c;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-transfer-'));
  present = new Set(['/home/ana/work', '/home/ana/work/api']);
  deps = {
    root,
    home: '/home/ana',
    secrets: createSecretsStore({ root, crypto, env: { GH_TOKEN: 'from-env' }, home: '/home/ana', now: quiet.now, run: () => 'x', exists: () => true }),
    exists: (p) => present.has(p),
    now: quiet.now,
  };
  ensureWorkspaces(root, quiet);
  bootstrapConfigs({ root, existingInstall: false, ...quiet });
});

describe('export', () => {
  it('is the config plus the list of secrets to provide, and holds no secret value', () => {
    deps.secrets.set({ ref: 'llm.anthropic', source: 'stored', value: SECRET_VALUE });
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1.2.3', now: new Date('2026-10-02T12:00:00Z') });
    expect(text).not.toContain(SECRET_VALUE);
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: EXPORT_FORMAT, formatVersion: 1, app: { name: 'coxia', version: '1.2.3' }, workspace: { name: 'Acme' }, exportedAt: '2026-10-02T12:00:00.000Z' });
    expect(file.requiredSecrets.map((s: { ref: string }) => s.ref).sort()).toEqual(['llm.anthropic', 'vcs.github']);
    expect(file.config.schemaVersion).toBe(15);
    expect(file.config.vcs[0].secretRef).toBe('vcs.github');
    expect(text).not.toMatch(/"(apiKey|token|password|secret)"/i);
  });

  it('carries no history: the envelope has only the config', () => {
    expect(Object.keys(buildExport(sample(), { workspaceName: 'x', appVersion: '1', now: new Date(0) })).sort()).toEqual(['app', 'config', 'exportedAt', 'format', 'formatVersion', 'requiredSecrets', 'workspace']);
  });
});

describe('round trip', () => {
  it('export, import into a new workspace, same config back, secrets still to provide', () => {
    const source = sample();
    const text = exportText(source, { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    const result = applyImport(deps, { source: { text }, target: { mode: 'new', name: 'Acme copy' }, secrets: [] }, 'principal');
    expect(result).toMatchObject({ created: true, appliedToRunning: false, workspaceId: 'acme-copy' });
    expect(result.missingSecrets.sort()).toEqual(['llm.anthropic', 'vcs.github']);
    const stored = validateConfig(readConfigFile(workspaceDir(root, 'acme-copy')));
    expect(stored.config).toEqual(source);
    expect(JSON.stringify(readConfigFile(workspaceDir(root, 'acme-copy')))).not.toContain(SECRET_VALUE);
  });

  it('a config that already was migrated from the previous app round-trips too', () => {
    const legacy = legacyConfigFixture();
    const parsed = parseImport(exportText(legacy, { workspaceName: 'Testes', appVersion: '1', now: new Date(0) }));
    expect(parsed.ok).toBe(true);
    expect(parsed.config).toEqual(legacy);
    expect(parsed.requiredSecrets.map((r) => r.ref)).toEqual(['llm.openrouter']);
  });

  it('secrets the importer provides go to the store, the others stay missing', () => {
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    const result = applyImport(
      deps,
      { source: { text }, target: { mode: 'new', name: 'Acme' }, secrets: [{ ref: 'vcs.github', source: 'env', name: 'GH_TOKEN' }, { ref: 'llm.anthropic', source: 'stored', value: SECRET_VALUE }] },
      'principal',
    );
    expect(result.missingSecrets).toEqual([]);
    expect(deps.secrets.resolve('vcs.github')).toBe('from-env');
    expect(deps.secrets.resolve('llm.anthropic')).toBe(SECRET_VALUE);
    expect(readFileSync(join(root, 'secrets.json'), 'utf8')).not.toContain(SECRET_VALUE);
  });

  it('refuses a secret input for a ref the file does not use', () => {
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    expect(() => applyImport(deps, { source: { text }, target: { mode: 'new', name: 'x' }, secrets: [{ ref: 'other.thing', source: 'stored', value: 'v' }] }, null)).toThrow(/não usa o segredo/);
    expect(existsSync(workspaceDir(root, 'x'))).toBe(false);
  });
});

describe('import into an existing workspace', () => {
  it('replaces the config, keeps the previous one next to it and says whether the running workspace changed', () => {
    const before = readFileSync(join(workspaceDir(root, 'principal'), CONFIG_FILE), 'utf8');
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    const r = applyImport(deps, { source: { text }, target: { mode: 'existing', id: 'principal' }, secrets: [] }, 'principal');
    expect(r).toMatchObject({ created: false, appliedToRunning: true, workspaceId: 'principal' });
    expect(readFileSync(join(workspaceDir(root, 'principal'), 'config.pre-import.json'), 'utf8')).toBe(before);
    expect((readConfigFile(workspaceDir(root, 'principal')) as WorkspaceConfig).language).toBe('en');
  });

  it('keeps what the plugins of the workspace were allowed, and brings in none from the file', () => {
    const dir = workspaceDir(root, 'principal');
    const mine = { ...neutralConfig(), plugins: { dir: '/p', confirmSeconds: 60, list: [{ id: 'web-search', folder: '/p/web-search', enabled: true, allow: { network: true, write: false }, settings: { url: 'http://127.0.0.1:8888' } }] } };
    writeConfigFile(dir, mine);
    const theirs = sample();
    theirs.plugins = { dir: '/elsewhere', confirmSeconds: 5, list: [{ id: 'other', folder: '/x', enabled: true, allow: { network: true, write: true }, settings: {} }] };
    const text = JSON.stringify({ ...JSON.parse(exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) })), config: theirs });
    applyImport(deps, { source: { text }, target: { mode: 'existing', id: 'principal' }, secrets: [] }, 'principal');
    // Neither the permissions, nor the folder the code is read from, nor a shorter warning come from the file.
    expect((readConfigFile(dir) as WorkspaceConfig).plugins).toEqual(mine.plugins);
    const created = applyImport(deps, { source: { text }, target: { mode: 'new', name: 'Fresh' }, secrets: [] }, 'principal');
    expect((readConfigFile(workspaceDir(root, created.workspaceId)) as WorkspaceConfig).plugins).toEqual({ dir: null, list: [], confirmSeconds: 30 });
  });

  it('applying to another workspace than the running one does not touch the running config', () => {
    createWorkspace(root, { name: 'Other', copySettings: false }, quiet);
    mkdirSync(workspaceDir(root, 'other'), { recursive: true });
    writeConfigFile(workspaceDir(root, 'other'), neutralConfig());
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    const r = applyImport(deps, { source: { text }, target: { mode: 'existing', id: 'other' }, secrets: [] }, 'principal');
    expect(r.appliedToRunning).toBe(false);
    expect((readConfigFile(workspaceDir(root, 'principal')) as WorkspaceConfig).language).toBe('pt-BR');
  });

  it('rejects an unknown workspace', () => {
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    expect(() => previewImport(deps, { text }, { mode: 'existing', id: 'ghost' })).toThrow(/não existe/);
  });
});

describe('preview', () => {
  it('shows the diff, the secrets (with what is already satisfied), the programs it would run and the paths missing on this machine', () => {
    deps.secrets.set({ ref: 'llm.anthropic', source: 'env', name: 'ANTHROPIC_API_KEY' });
    const text = exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) });
    const p = previewImport(deps, { text }, { mode: 'existing', id: 'principal' });
    expect(p.ok).toBe(true);
    expect(p.workspaceName).toBe('Acme');
    expect(p.secrets).toEqual([
      expect.objectContaining({ ref: 'llm.anthropic', satisfied: true }),
      expect.objectContaining({ ref: 'vcs.github', satisfied: false, usedBy: ['vcs.gh'] }),
    ]);
    expect(p.commands).toEqual([{ field: 'externalTools.cardSource.command', command: '~/bin/cards' }, { field: 'externalTools.claudeCli.command', command: 'claude' }]);
    expect(p.missingPaths).toEqual([]);
    const paths = p.changes.map((c) => c.path);
    expect(paths).toEqual(expect.arrayContaining(['language', 'vcs[gh].host', 'projects.repos[api].path', 'llm.providers[local].baseUrl', 'llm.roles.deep.provider', 'externalTools.cardSource.enabled']));
    expect(p.changes.find((c) => c.path === 'language')).toMatchObject({ kind: 'changed', before: 'pt-BR', after: 'en' });
    present.clear();
    expect(previewImport(deps, { text }, { mode: 'new', name: 'x' }).missingPaths.map((m) => m.field)).toEqual(expect.arrayContaining(['projects.roots[0]', 'projects.repos[api].path']));
  });

  it('reports every validation problem with its path and writes nothing', () => {
    const bad = JSON.parse(exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) }));
    bad.config.language = 'fr';
    bad.config.llm.roles.turn.provider = 'ghost';
    const p = previewImport(deps, { text: JSON.stringify(bad) }, { mode: 'new', name: 'x' });
    expect(p.ok).toBe(false);
    expect(p.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['language']));
    expect(existsSync(workspaceDir(root, 'x'))).toBe(false);
  });

  it('reads the file from a path, with a size limit', () => {
    const file = join(root, 'export.json');
    writeFileSync(file, exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) }));
    expect(previewImport(deps, { path: file }, { mode: 'new', name: 'x' }).ok).toBe(true);
    writeFileSync(join(root, 'big.json'), 'x'.repeat(1024 * 1024 + 1));
    expect(() => previewImport(deps, { path: join(root, 'big.json') }, { mode: 'new', name: 'x' })).toThrow(/1 MB/);
  });
});

describe('what an import refuses', () => {
  const good = () => JSON.parse(exportText(sample(), { workspaceName: 'Acme', appVersion: '1', now: new Date(0) }));

  it('not JSON, not an object, a newer format, a newer schema', () => {
    expect(parseImport('nope').errors[0].message).toMatch(/not a JSON/);
    expect(parseImport('[]').ok).toBe(false);
    expect(parseImport(JSON.stringify({ ...good(), formatVersion: 7 })).errors[0].message).toMatch(/newer/);
    const newer = good();
    newer.config.schemaVersion = 16;
    expect(parseImport(JSON.stringify(newer)).errors[0].message).toMatch(/newer app/);
  });

  it('a file that carries a secret value instead of a reference', () => {
    const leaky = good();
    leaky.config.llm.providers[0].apiKey = 'sk-pasted-by-mistake';
    const r = parseImport(JSON.stringify(leaky));
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/secret values are not accepted/);
    expect(JSON.stringify(r)).not.toContain('sk-pasted-by-mistake');
  });

  it('a bare config document (no envelope) is accepted, and so is an older schema', () => {
    expect(parseImport(JSON.stringify(sample())).ok).toBe(true);
    const old = parseImport(JSON.stringify({ models: { turn: 'a/b', reply: 'a/b', deep: 'a/b', teams: 'a/b' }, notifications: false }));
    expect(old.ok).toBe(true);
    expect(old.migrated.length).toBeGreaterThan(0);
    expect(old.config?.notifications).toBe(false);
  });
});

describe('diff', () => {
  it('keys lists of {id} objects by id, so a reordered list is no change', () => {
    const a = sample();
    const b = sample();
    b.llm.providers.reverse();
    expect(diffConfig(a, b)).toEqual([]);
    b.llm.providers[0].baseUrl = 'http://elsewhere/v1';
    expect(diffConfig(a, b)).toEqual([expect.objectContaining({ kind: 'changed', before: expect.any(String) })]);
  });

  it('collectSecretRequirements is what the export lists', () => {
    expect(collectSecretRequirements(sample()).map((r) => r.ref)).toEqual(['llm.anthropic', 'vcs.github']);
  });
});
