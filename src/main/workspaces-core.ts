import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Registry, WorkspaceInfo } from '../shared/workspaces';
import { t } from '../shared/i18n';

export type { Registry, WorkspaceInfo };

// What a workspace owns: everything that records what happened. Anything not listed here or in GLOBAL_ENTRIES stays where it is.
export const WORKSPACE_FILES = [
  'config.json',
  'acoes.json',
  'custo.json',
  'falas.json',
  'status.json',
  'radar.json',
  'watchers.json',
  'efeitos.json',
  'feedback.json',
  'auditoria.jsonl',
  'sessions.jsonl',
  'retencao.log',
];
export const WORKSPACE_DIRS = ['historico', 'atividade', 'gates', 'qa', 'retros', 'feedback', 'conflicts'];
export const ATA_FILE = /^\d{4}-\d{2}-\d{2}-pre-daily\.md$/;

// Shared by every workspace, so switching never unpairs a phone or loses a personal setting.
export const WEB_FILE = 'web.json';
export const GLOBAL_ENTRIES = [WEB_FILE, 'web-sessions.json', 'web-push-vapid.json', 'web-push.json', 'glossario.json', 'conflict-verify.json', 'saude.json', 'userData'];

export const REGISTRY_FILE = 'workspaces.json';
export const WORKSPACES_DIR = 'workspaces';
export const TRASH_DIR = '.trash';
export const MIGRATED_ID = 'testes';
export const FRESH_ID = 'principal';

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const NAME_MAX = 60;

export interface Deps {
  now: () => Date;
  log: (message: string) => void;
  rename: (from: string, to: string) => void;
}

const defaults: Deps = { now: () => new Date(), log: (m) => console.log(`[workspaces] ${m}`), rename: renameSync };
const withDeps = (deps?: Partial<Deps>): Deps => ({ ...defaults, ...deps });

export const registryPath = (root: string): string => join(root, REGISTRY_FILE);
export const workspacesDir = (root: string): string => join(root, WORKSPACES_DIR);
export const workspaceDir = (root: string, id: string): string => {
  if (!ID.test(id)) throw new Error(t('main.workspaces.invalid', { id }));
  return join(workspacesDir(root), id);
};

function atomicWrite(file: string, text: string, mode?: number): void {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, mode ? { mode } : undefined);
  renameSync(tmp, file);
}

function validInfo(w: unknown): w is WorkspaceInfo {
  const o = w as Partial<WorkspaceInfo> | null;
  return !!o && typeof o.id === 'string' && ID.test(o.id) && typeof o.name === 'string' && !!o.name.trim() && typeof o.createdAt === 'string' && typeof o.test === 'boolean';
}

export function readRegistry(root: string): Registry | null {
  try {
    const raw = JSON.parse(readFileSync(registryPath(root), 'utf8')) as Partial<Registry>;
    if (!Array.isArray(raw.list) || !raw.list.every(validInfo) || typeof raw.current !== 'string') return null;
    if (!raw.list.some((w) => w.id === raw.current)) return null;
    return { current: raw.current, list: raw.list };
  } catch {
    return null;
  }
}

export function writeRegistry(root: string, reg: Registry): void {
  atomicWrite(registryPath(root), JSON.stringify(reg, null, 2));
}

function note(root: string, deps: Deps, message: string): void {
  deps.log(message);
  try {
    mkdirSync(workspacesDir(root), { recursive: true });
    appendFileSync(join(workspacesDir(root), 'migration.log'), `${deps.now().toISOString()} ${message}\n`);
  } catch {}
}

function workspaceEntries(root: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {}
  return names.filter((n) => WORKSPACE_FILES.includes(n) || WORKSPACE_DIRS.includes(n) || ATA_FILE.test(n));
}

// The web block of config.json moves to the root web.json. Never overwrites a web.json that already exists.
function extractWeb(root: string, deps: Deps): void {
  const config = join(root, 'config.json');
  if (!existsSync(config) || existsSync(join(root, WEB_FILE))) return;
  try {
    const web = (JSON.parse(readFileSync(config, 'utf8')) as { web?: unknown }).web;
    if (web && typeof web === 'object') {
      atomicWrite(join(root, WEB_FILE), JSON.stringify(web, null, 2), 0o600);
      // i18n-ignore: registry log written for developers
      note(root, deps, `web settings copied from config.json to ${WEB_FILE}`);
    }
  } catch (e) {
    // i18n-ignore: registry log written for developers
    note(root, deps, `config.json unreadable, web settings not extracted (${String(e)})`);
  }
}

// The registry is written last: a crash leaves a state that the next start finishes, moving only what is still in the root.
function migrate(root: string, id: string, name: string, test: boolean, deps: Deps): Registry {
  const dir = workspaceDir(root, id);
  mkdirSync(dir, { recursive: true });
  extractWeb(root, deps);
  for (const entry of workspaceEntries(root)) {
    const to = join(dir, entry);
    if (existsSync(to)) {
      // i18n-ignore: registry log written for developers
      note(root, deps, `kept ${entry} in the root: ${id}/${entry} already exists`);
      continue;
    }
    try {
      deps.rename(join(root, entry), to);
      note(root, deps, `moved ${entry} to ${WORKSPACES_DIR}/${id}/`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const reg: Registry = { current: id, list: [{ id, name, createdAt: deps.now().toISOString(), test }] };
  writeRegistry(root, reg);
  // i18n-ignore: registry log written for developers
  note(root, deps, `registry created, current workspace: ${id}`);
  return reg;
}

// Rebuilds the registry from the folders when it is unreadable: the old file is kept aside and every workspace is marked as test.
function rebuild(root: string, deps: Deps): Registry {
  const found = readdirSync(workspacesDir(root), { withFileTypes: true })
    .filter((e) => e.isDirectory() && ID.test(e.name))
    .map((e) => e.name)
    .sort();
  if (!found.length) return migrate(root, FRESH_ID, 'Principal', false, deps);
  const at = deps.now().toISOString();
  const reg: Registry = {
    current: found.includes(MIGRATED_ID) ? MIGRATED_ID : found[0],
    list: found.map((id) => ({ id, name: id === MIGRATED_ID ? 'Testes' : id, createdAt: at, test: true })),
  };
  writeRegistry(root, reg);
  // i18n-ignore: registry log written for developers
  note(root, deps, `registry unreadable: rebuilt from folders ${found.join(', ')} (all marked as test)`);
  return reg;
}

/**
 * Resolves the registry and the current workspace folder, migrating the old flat layout on first run:
 * the existing data becomes the "Testes" workspace (test flag on). A data dir with nothing to migrate gets an empty "Principal".
 */
export function ensureWorkspaces(root: string, partial?: Partial<Deps>): { registry: Registry; dir: string } {
  const deps = withDeps(partial);
  mkdirSync(root, { recursive: true });
  let reg = readRegistry(root);
  if (!reg) {
    const hasRegistryFile = existsSync(registryPath(root));
    if (hasRegistryFile) {
      const stamp = deps.now().toISOString().replace(/[:.]/g, '-');
      deps.rename(registryPath(root), join(root, `${REGISTRY_FILE}.corrupt-${stamp}`));
    }
    const hasWorkspaces = existsSync(workspacesDir(root)) && readdirSync(workspacesDir(root), { withFileTypes: true }).some((e) => e.isDirectory() && ID.test(e.name));
    if (hasWorkspaces && hasRegistryFile) reg = rebuild(root, deps);
    else if (workspaceEntries(root).length || existsSync(workspaceDir(root, MIGRATED_ID))) reg = migrate(root, MIGRATED_ID, 'Testes', true, deps);
    else reg = migrate(root, FRESH_ID, 'Principal', false, deps);
  }
  const dir = workspaceDir(root, reg.current);
  mkdirSync(dir, { recursive: true });
  return { registry: reg, dir };
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'workspace';
}

export function validName(name: unknown, list: WorkspaceInfo[], exceptId?: string): string {
  if (typeof name !== 'string' || !name.trim()) throw new Error(t('main.workspaces.needName'));
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length > NAME_MAX) throw new Error(t('main.workspaces.nameMax', { max: NAME_MAX }));
  if (list.some((w) => w.id !== exceptId && w.name.toLowerCase() === clean.toLowerCase())) throw new Error(t('main.workspaces.nameTaken', { name: clean }));
  return clean;
}

function must(reg: Registry, id: string): WorkspaceInfo {
  const w = reg.list.find((x) => x.id === id);
  if (!w) throw new Error(t('main.workspaces.missing', { id }));
  return w;
}

function load(root: string): Registry {
  const reg = readRegistry(root);
  if (!reg) throw new Error(t('main.workspaces.registryUnreadable'));
  return reg;
}

/** Copies config.json (never the web block, never history) from one workspace to another. */
function copySettings(root: string, fromId: string, toId: string): void {
  const from = join(workspaceDir(root, fromId), 'config.json');
  if (!existsSync(from)) return;
  const config = JSON.parse(readFileSync(from, 'utf8')) as Record<string, unknown>;
  delete config.web;
  atomicWrite(join(workspaceDir(root, toId), 'config.json'), JSON.stringify(config, null, 2));
}

export function createWorkspace(root: string, input: { name: string; copySettings: boolean }, partial?: Partial<Deps>): Registry {
  const deps = withDeps(partial);
  const reg = load(root);
  const name = validName(input.name, reg.list);
  const base = slugify(name);
  let id = base;
  for (let n = 2; reg.list.some((w) => w.id === id) || existsSync(workspaceDir(root, id)); n++) id = `${base.slice(0, 44)}-${n}`;
  mkdirSync(workspaceDir(root, id), { recursive: true });
  if (input.copySettings) copySettings(root, reg.current, id);
  const next: Registry = { ...reg, list: [...reg.list, { id, name, createdAt: deps.now().toISOString(), test: false }] };
  writeRegistry(root, next);
  return next;
}

export function renameWorkspace(root: string, id: string, name: string): Registry {
  const reg = load(root);
  must(reg, id);
  const clean = validName(name, reg.list, id);
  const next = { ...reg, list: reg.list.map((w) => (w.id === id ? { ...w, name: clean } : w)) };
  writeRegistry(root, next);
  return next;
}

export function setTestFlag(root: string, id: string, test: boolean): Registry {
  const reg = load(root);
  must(reg, id);
  const next = { ...reg, list: reg.list.map((w) => (w.id === id ? { ...w, test: test === true } : w)) };
  writeRegistry(root, next);
  return next;
}

export function switchWorkspace(root: string, id: string): Registry {
  const reg = load(root);
  must(reg, id);
  mkdirSync(workspaceDir(root, id), { recursive: true });
  const next = { ...reg, current: id };
  writeRegistry(root, next);
  return next;
}

/** Moves the folder to workspaces/.trash instead of deleting it; the current workspace cannot be removed. */
export function deleteWorkspace(root: string, id: string, typedName: string, partial?: Partial<Deps>): { registry: Registry; trashed: string } {
  const deps = withDeps(partial);
  const reg = load(root);
  const w = must(reg, id);
  if (reg.current === id) throw new Error(t('main.workspaces.deleteCurrent'));
  if (typeof typedName !== 'string' || typedName.trim() !== w.name) throw new Error(t('main.workspaces.nameMismatch'));
  const next = { ...reg, list: reg.list.filter((x) => x.id !== id) };
  // Registry first: a crash in between leaves an unlisted folder, never a listed one that is gone.
  writeRegistry(root, next);
  const trash = join(workspacesDir(root), TRASH_DIR);
  mkdirSync(trash, { recursive: true });
  const trashed = join(trash, `${id}-${deps.now().toISOString().replace(/[:.]/g, '-')}`);
  const dir = workspaceDir(root, id);
  if (existsSync(dir)) deps.rename(dir, trashed);
  // i18n-ignore: registry log written for developers
  note(root, deps, `workspace ${id} moved to ${trashed}`);
  return { registry: next, trashed };
}

export function externalWriteRefusal(reg: Registry | null, what: string): string | null {
  const current = reg?.list.find((w) => w.id === reg.current);
  if (current && !current.test) return null;
  return t('main.workspaces.testRefusal', { what });
}
