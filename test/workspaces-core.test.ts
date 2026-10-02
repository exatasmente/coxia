import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  deleteWorkspace,
  ensureWorkspaces,
  externalWriteRefusal,
  readRegistry,
  registryPath,
  renameWorkspace,
  setTestFlag,
  slugify,
  switchWorkspace,
  workspaceDir,
} from '../src/main/workspaces-core';

const quiet = { log: () => undefined };
const at = (iso: string) => ({ ...quiet, now: () => new Date(iso) });

const WEB = { enabled: true, host: '172.18.0.1', port: 4330, basePath: '/cerimonias/', publicUrl: 'https://koala.fortics.dev/cerimonias/', trustedProxy: '172.18.0.0/16', allowExternalEffects: false };
const CONFIG = { notifications: false, models: { turn: 'deepseek/deepseek-v4.1-flash' }, web: WEB };

let root: string;

function put(rel: string, content: string): void {
  const file = join(root, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

// The flat layout of the app before workspaces, with the real file names.
function legacyLayout(): Record<string, string> {
  const files: Record<string, string> = {
    'config.json': JSON.stringify(CONFIG),
    'acoes.json': '{"releaseSeen":null,"actions":[]}',
    'custo.json': '{"version":1}',
    'falas.json': '{"version":1,"turns":{},"reuses":[]}',
    'status.json': '{"seen":1}',
    'radar.json': '{"r":1}',
    'watchers.json': '{"w":1}',
    'efeitos.json': '{"e":1}',
    'feedback.json': '{"f":1}',
    'auditoria.jsonl': '{"kind":"gitlab"}\n',
    'retencao.log': 'log\n',
    '2026-10-02-pre-daily.md': '# ata',
    'historico/2026-10-02T093000.json': '{"version":1}',
    'historico/2026-10-01T093000.json': '{"version":1}',
    'atividade/2026-10-02.json': '{"day":1}',
    'gates/g1.json': '{"g":1}',
    'qa/q1.json': '{"q":1}',
    'retros/r1.json': '{"r":1}',
    'feedback/mr1.json': '{"m":1}',
    'conflicts/c1/state.json': '{"c":1}',
    'web-sessions.json': '{"sessions":[{"id":"phone"}]}',
    'web-push-vapid.json': '{"k":1}',
    'web-push.json': '{"subs":[]}',
    'glossario.json': '[]',
    'conflict-verify.json': '{}',
    'saude.json': '{"tasks":{}}',
    'userData/Preferences': '{}',
  };
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  return files;
}

const PER_WORKSPACE = [
  'config.json', 'acoes.json', 'custo.json', 'falas.json', 'status.json', 'radar.json', 'watchers.json', 'efeitos.json', 'feedback.json', 'auditoria.jsonl', 'retencao.log',
  '2026-10-02-pre-daily.md', 'historico/2026-10-02T093000.json', 'historico/2026-10-01T093000.json', 'atividade/2026-10-02.json', 'gates/g1.json', 'qa/q1.json', 'retros/r1.json', 'feedback/mr1.json', 'conflicts/c1/state.json',
];
const GLOBAL = ['web-sessions.json', 'web-push-vapid.json', 'web-push.json', 'glossario.json', 'conflict-verify.json', 'saude.json', 'userData/Preferences'];

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cer-ws-'));
});

describe('fresh install', () => {
  it('creates an empty, non-test "Principal"', () => {
    const { registry, dir } = ensureWorkspaces(root, quiet);
    expect(registry.current).toBe('principal');
    expect(registry.list).toHaveLength(1);
    expect(registry.list[0]).toMatchObject({ id: 'principal', name: 'Principal', test: false });
    expect(dir).toBe(join(root, 'workspaces', 'principal'));
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a root holding only shared files is still a fresh install', () => {
    put('web-sessions.json', '{"sessions":[]}');
    put('glossario.json', '[]');
    expect(ensureWorkspaces(root, quiet).registry.current).toBe('principal');
    expect(existsSync(join(root, 'web-sessions.json'))).toBe(true);
  });
});

describe('migration from the flat layout', () => {
  it('moves what happened into "Testes" (test flag on) and keeps the shared files in the root', () => {
    const files = legacyLayout();
    put('mystery.txt', 'unknown');
    const { registry, dir } = ensureWorkspaces(root, at('2026-10-02T12:00:00Z'));

    expect(registry).toEqual({ current: 'testes', list: [{ id: 'testes', name: 'Testes', createdAt: '2026-10-02T12:00:00.000Z', test: true }] });
    expect(dir).toBe(workspaceDir(root, 'testes'));
    for (const rel of PER_WORKSPACE) {
      expect(existsSync(join(root, rel)), `${rel} left in the root`).toBe(false);
      expect(readFileSync(join(dir, rel), 'utf8')).toBe(files[rel]);
    }
    for (const rel of GLOBAL) {
      expect(read(rel)).toBe(files[rel]);
      expect(existsSync(join(dir, rel))).toBe(false);
    }
    expect(read('mystery.txt')).toBe('unknown');
  });

  it('copies the web block to web.json, so the web access survives the move', () => {
    legacyLayout();
    ensureWorkspaces(root, quiet);
    expect(JSON.parse(read('web.json'))).toEqual(WEB);
  });

  it('never overwrites an existing web.json', () => {
    legacyLayout();
    put('web.json', '{"enabled":false}');
    ensureWorkspaces(root, quiet);
    expect(read('web.json')).toBe('{"enabled":false}');
  });

  it('logs what moved', () => {
    legacyLayout();
    const lines: string[] = [];
    ensureWorkspaces(root, { log: (m) => lines.push(m) });
    expect(lines.some((l) => l.includes('moved historico'))).toBe(true);
    expect(read('workspaces/migration.log')).toContain('moved acoes.json');
  });

  it('is idempotent', () => {
    legacyLayout();
    const first = ensureWorkspaces(root, quiet);
    const log = read('workspaces/migration.log');
    const second = ensureWorkspaces(root, quiet);
    expect(second).toEqual(first);
    expect(read('workspaces/migration.log')).toBe(log);
    expect(readRegistry(root)).toEqual(first.registry);
  });
});

describe('crash in the middle of the migration', () => {
  it('finishes on the next start without losing or duplicating anything', () => {
    const files = legacyLayout();
    let moves = 0;
    const crashing = {
      ...quiet,
      rename: (from: string, to: string) => {
        if (++moves > 4) throw new Error('power cut');
        renameSync(from, to);
      },
    };
    expect(() => ensureWorkspaces(root, crashing)).toThrow('power cut');
    expect(readRegistry(root)).toBeNull();
    expect(existsSync(registryPath(root))).toBe(false);

    const { registry, dir } = ensureWorkspaces(root, quiet);
    expect(registry.current).toBe('testes');
    expect(registry.list[0].test).toBe(true);
    for (const rel of PER_WORKSPACE) {
      expect(existsSync(join(root, rel)), `${rel} left in the root`).toBe(false);
      expect(readFileSync(join(dir, rel), 'utf8')).toBe(files[rel]);
    }
    for (const rel of GLOBAL) expect(read(rel)).toBe(files[rel]);
    expect(JSON.parse(read('web.json'))).toEqual(WEB);
  });

  it('all moved but no registry yet: only the registry is written', () => {
    const files = legacyLayout();
    ensureWorkspaces(root, quiet);
    rmRegistry();
    const { registry, dir } = ensureWorkspaces(root, quiet);
    expect(registry.current).toBe('testes');
    expect(registry.list[0].test).toBe(true);
    for (const rel of PER_WORKSPACE) expect(readFileSync(join(dir, rel), 'utf8')).toBe(files[rel]);
  });

  it('a file recreated in the root after a partial move is kept, not overwritten', () => {
    legacyLayout();
    ensureWorkspaces(root, quiet);
    rmRegistry();
    put('acoes.json', '{"newer":true}');
    const { dir } = ensureWorkspaces(root, quiet);
    expect(read('acoes.json')).toBe('{"newer":true}');
    expect(readFileSync(join(dir, 'acoes.json'), 'utf8')).toBe('{"releaseSeen":null,"actions":[]}');
  });

  it('an unreadable registry is rebuilt from the folders, every workspace marked as test, the old file kept aside', () => {
    legacyLayout();
    ensureWorkspaces(root, quiet);
    createWorkspace(root, { name: 'Real', copySettings: false });
    writeFileSync(registryPath(root), '{ not json');
    const { registry } = ensureWorkspaces(root, quiet);
    expect(registry.list.map((w) => w.id).sort()).toEqual(['real', 'testes']);
    expect(registry.list.every((w) => w.test)).toBe(true);
    expect(registry.current).toBe('testes');
    expect(readdirSync(root).some((n) => n.startsWith('workspaces.json.corrupt-'))).toBe(true);
  });
});

function rmRegistry(): void {
  rmSync(registryPath(root));
}

describe('create, rename, flag, switch', () => {
  beforeEach(() => {
    legacyLayout();
    ensureWorkspaces(root, quiet);
  });

  it('creates an empty workspace with the settings copied, never the history nor the web block', () => {
    const reg = createWorkspace(root, { name: 'Principal', copySettings: true }, at('2026-10-03T08:00:00Z'));
    expect(reg.list.map((w) => w.id)).toEqual(['testes', 'principal']);
    expect(reg.list[1]).toEqual({ id: 'principal', name: 'Principal', createdAt: '2026-10-03T08:00:00.000Z', test: false });
    const dir = workspaceDir(root, 'principal');
    expect(readdirSync(dir)).toEqual(['config.json']);
    const copied = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(copied.notifications).toBe(false);
    expect(copied.web).toBeUndefined();
    expect(readRegistry(root)).toEqual(reg);
  });

  it('can start with no settings at all', () => {
    createWorkspace(root, { name: 'Vazio', copySettings: false });
    expect(readdirSync(workspaceDir(root, 'vazio'))).toEqual([]);
  });

  it('refuses empty, long and duplicated names, and makes unique ids', () => {
    expect(() => createWorkspace(root, { name: '  ', copySettings: false })).toThrow(/nome/);
    expect(() => createWorkspace(root, { name: 'x'.repeat(61), copySettings: false })).toThrow(/60/);
    expect(() => createWorkspace(root, { name: 'testes', copySettings: false })).toThrow(/já existe/);
    createWorkspace(root, { name: 'Ação', copySettings: false });
    createWorkspace(root, { name: 'Acao!', copySettings: false });
    expect(readRegistry(root)?.list.map((w) => w.id)).toEqual(['testes', 'acao', 'acao-2']);
  });

  it('slugs are path safe', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('Área de Trabalho  1')).toBe('area-de-trabalho-1');
    expect(slugify('???')).toBe('workspace');
    expect(() => workspaceDir(root, '../x')).toThrow(/inválido/);
    expect(() => workspaceDir(root, '.trash')).toThrow(/inválido/);
  });

  it('renames and toggles the test flag', () => {
    renameWorkspace(root, 'testes', 'Sandbox');
    expect(readRegistry(root)?.list[0].name).toBe('Sandbox');
    expect(() => renameWorkspace(root, 'nope', 'X')).toThrow(/não existe/);
    createWorkspace(root, { name: 'Real', copySettings: false });
    expect(() => renameWorkspace(root, 'real', 'sandbox')).toThrow(/já existe/);
    setTestFlag(root, 'testes', false);
    expect(readRegistry(root)?.list[0].test).toBe(false);
    setTestFlag(root, 'real', true);
    expect(readRegistry(root)?.list[1].test).toBe(true);
  });

  it('switch only changes the registry; the next resolution opens the other folder', () => {
    createWorkspace(root, { name: 'Real', copySettings: false });
    expect(() => switchWorkspace(root, 'nope')).toThrow(/não existe/);
    switchWorkspace(root, 'real');
    expect(readRegistry(root)?.current).toBe('real');
    expect(ensureWorkspaces(root, quiet).dir).toBe(workspaceDir(root, 'real'));
    expect(existsSync(join(workspaceDir(root, 'testes'), 'historico'))).toBe(true);
    switchWorkspace(root, 'testes');
    expect(ensureWorkspaces(root, quiet).dir).toBe(workspaceDir(root, 'testes'));
  });
});

describe('delete', () => {
  beforeEach(() => {
    legacyLayout();
    ensureWorkspaces(root, quiet);
    createWorkspace(root, { name: 'Descartável', copySettings: true });
  });

  it('moves the folder to .trash and drops it from the registry', () => {
    const dir = workspaceDir(root, 'descartavel');
    writeFileSync(join(dir, 'acoes.json'), 'precious');
    const { registry, trashed } = deleteWorkspace(root, 'descartavel', 'Descartável', at('2026-10-03T10:20:30.123Z'));
    expect(registry.list.map((w) => w.id)).toEqual(['testes']);
    expect(readRegistry(root)).toEqual(registry);
    expect(existsSync(dir)).toBe(false);
    expect(trashed).toBe(join(root, 'workspaces', '.trash', 'descartavel-2026-10-03T10-20-30-123Z'));
    expect(readFileSync(join(trashed, 'acoes.json'), 'utf8')).toBe('precious');
  });

  it('refuses the current workspace, a wrong typed name and an unknown id, touching nothing', () => {
    expect(() => deleteWorkspace(root, 'testes', 'Testes')).toThrow(/em uso/);
    expect(() => deleteWorkspace(root, 'descartavel', 'descartavel')).toThrow(/não confere/);
    expect(() => deleteWorkspace(root, 'nope', 'x')).toThrow(/não existe/);
    expect(readRegistry(root)?.list).toHaveLength(2);
    expect(existsSync(workspaceDir(root, 'descartavel'))).toBe(true);
    expect(existsSync(join(root, 'workspaces', '.trash'))).toBe(false);
  });

  it('a trashed folder never comes back as a workspace, and the registry survives a rebuild', () => {
    deleteWorkspace(root, 'descartavel', 'Descartável');
    writeFileSync(registryPath(root), 'broken');
    const { registry } = ensureWorkspaces(root, quiet);
    expect(registry.list.map((w) => w.id)).toEqual(['testes']);
  });
});

describe('test flag guard', () => {
  const reg = (test: boolean) => ({ current: 'a', list: [{ id: 'a', name: 'A', createdAt: 'x', test }] });

  it('refuses external writes in a test workspace with a clear message', () => {
    const message = externalWriteRefusal(reg(true), 'escrever no GitLab');
    expect(message).toMatch(/^Workspace de testes: escrever no GitLab não é feito aqui/);
    expect(message).toMatch(/Configurações › Workspaces/);
  });

  it('allows them in a real workspace', () => {
    expect(externalWriteRefusal(reg(false), 'x')).toBeNull();
  });

  it('fails closed when the registry cannot be read or points nowhere', () => {
    expect(externalWriteRefusal(null, 'x')).not.toBeNull();
    expect(externalWriteRefusal({ current: 'zzz', list: reg(false).list }, 'x')).not.toBeNull();
  });
});
