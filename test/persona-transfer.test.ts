// The persona's instructions describe the person, so they leave a workspace only by being read in it: an export has none, an import strips one and keeps the target's own,
// and the preview does not list the persona as removed (Q11 of the spec).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig, newProvider } from '../src/shared/config/defaults';
import { isPersona, newAgent } from '../src/shared/config/team';
import { buildExport, parseImport } from '../src/shared/config/transfer';
import { CONFIG_SCHEMA_VERSION, type WorkspaceConfig } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';
import { bootstrapConfigs, readConfigFile, writeConfigFile } from '../src/main/config-bootstrap';
import { applyImport, exportText, previewImport, type TransferDeps } from '../src/main/config-transfer';
import { type CryptoPort, createSecretsStore } from '../src/main/secrets-core';
import { ensureWorkspaces, workspaceDir } from '../src/main/workspaces-core';

const crypto: CryptoPort = { available: () => true, encrypt: (t) => Buffer.from(`enc:${t}`), decrypt: (d) => d.toString().slice(4), backend: () => 'kwallet' };
const quiet = { log: () => undefined, now: () => new Date('2026-10-02T12:00:00Z') };
const SECRET = 'about the person: they never want X';

const persona = (over = {}) => newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: SECRET, ...over });
const withTeam = (...extra: ReturnType<typeof newAgent>[]): WorkspaceConfig => {
  const c = neutralConfig();
  return { ...c, agents: { ...c.agents, team: [...c.agents.team, ...extra] } };
};
const meta = { workspaceName: 'x', appVersion: '1', now: new Date(0) };

let root: string;
let deps: TransferDeps;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-persona-transfer-'));
  deps = {
    root,
    home: '/home/ana',
    secrets: createSecretsStore({ root, crypto, env: {}, home: '/home/ana', now: quiet.now, run: () => 'x', exists: () => true }),
    exists: () => true,
    now: quiet.now,
  };
  ensureWorkspaces(root, quiet);
  bootstrapConfigs({ root, existingInstall: false, ...quiet });
});

describe('export', () => {
  it('has no persona and no persona draft, and says nothing of their text', () => {
    const c = withTeam(newAgent({ id: 'writer', name: 'Writer' }), persona(), persona({ id: 'me-test', draft: true }));
    const text = exportText(c, meta);
    expect(text).not.toContain(SECRET);
    const team = buildExport(c, meta).config.agents.team;
    expect(team.some(isPersona)).toBe(false);
    expect(team.map((a) => a.id)).toContain('writer');
  });
});

describe('parseImport', () => {
  it('strips a persona from a file, with a warning at the team, and the import does not fail for it', () => {
    const file = JSON.stringify({ ...JSON.parse(exportText(withTeam(), meta)), config: withTeam(persona(), persona({ id: 'again' })) });
    const r = parseImport(file);
    expect(r.ok).toBe(true);
    expect(r.config?.agents.team.some(isPersona)).toBe(false);
    expect(r.warnings.map((w) => w.path)).toContain('agents.team');
  });

  it('says nothing when the file has no persona, and still strips one in a bare config document', () => {
    expect(parseImport(exportText(withTeam(), meta)).warnings.map((w) => w.path)).not.toContain('agents.team');
    const bare = parseImport(JSON.stringify(withTeam(persona())));
    expect(bare.ok).toBe(true);
    expect(bare.config?.agents.team.some(isPersona)).toBe(false);
  });
});

describe('applying an import', () => {
  const existing = (c: WorkspaceConfig) => writeConfigFile(workspaceDir(root, 'principal'), c);
  const file = () => JSON.stringify({ ...JSON.parse(exportText(withTeam(newAgent({ id: 'writer', name: 'Writer' })), meta)) });
  const stored = (id: string) => validateConfig(readConfigFile(workspaceDir(root, id))).config as WorkspaceConfig;

  it('over an existing workspace keeps its persona and its test copy', () => {
    existing(withTeam(persona(), persona({ id: 'me-test', draft: true })));
    applyImport(deps, { source: { text: file() }, target: { mode: 'existing', id: 'principal' }, secrets: [] }, 'principal');
    const team = stored('principal').agents.team;
    expect(team.find((a) => a.id === 'me')).toMatchObject({ kind: 'persona', instructions: SECRET });
    expect(team.find((a) => a.id === 'me-test')).toMatchObject({ kind: 'persona', draft: true });
    expect(team.map((a) => a.id)).toContain('writer');
  });

  it('keeps the persona even when the file brings an agent with its id, and the file stays valid', () => {
    existing(withTeam(persona()));
    const text = JSON.stringify({ ...JSON.parse(file()), config: withTeam(newAgent({ id: 'me', name: 'Not me' })) });
    applyImport(deps, { source: { text }, target: { mode: 'existing', id: 'principal' }, secrets: [] }, 'principal');
    const team = stored('principal').agents.team;
    expect(team.filter((a) => a.id === 'me')).toHaveLength(1);
    expect(team.find((a) => a.id === 'me')).toMatchObject({ kind: 'persona', name: 'Me' });
  });

  it('puts a persona that named a provider the file does not have back on the deep role, so the file stays valid', () => {
    const c = withTeam(persona({ model: { role: null, provider: 'local', model: 'm' } }));
    c.llm.providers.push(newProvider({ id: 'local', kind: 'openai-compatible', baseUrl: 'http://localhost:1/v1', models: ['m'] }));
    existing(c);
    applyImport(deps, { source: { text: file() }, target: { mode: 'existing', id: 'principal' }, secrets: [] }, 'principal');
    const kept = stored('principal').agents.team.find((a) => a.id === 'me');
    expect(kept?.model).toEqual({ role: 'deep', provider: '', model: '' });
    expect(kept?.instructions).toBe(SECRET);
  });

  it('into a new workspace starts with none', () => {
    existing(withTeam(persona()));
    const r = applyImport(deps, { source: { text: file() }, target: { mode: 'new', name: 'Fresh' }, secrets: [] }, 'principal');
    expect(stored(r.workspaceId).agents.team.some(isPersona)).toBe(false);
    expect(stored(r.workspaceId).schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it('the preview does not list the persona as removed', () => {
    existing(withTeam(persona(), newAgent({ id: 'writer', name: 'Writer' })));
    const p = previewImport(deps, { text: file() }, { mode: 'existing', id: 'principal' });
    expect(p.ok).toBe(true);
    expect(p.changes.filter((c) => c.path.includes('[me]'))).toEqual([]);
    expect(JSON.stringify(p.changes)).not.toContain(SECRET);
  });
});

