import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { t } from '../shared/i18n';
import { MOVE_BUNDLE_FORMAT, MOVE_FILES, type MoveManifest } from '../shared/move';
import { gcmDecrypt, readMasterKey } from './masterKey';
import { REPO_FILE, SKIP_TOP } from './moveBundle';
import { WARNING } from './secrets-core';
import { REGISTRY_FILE, WORKSPACE_ID, WORKSPACES_DIR, readRegistry } from './workspaces-core';
import type { Registry, WorkspaceInfo } from '../shared/workspaces';

// The core's one-shot import of a move (#309): takes the bundle `move:export` wrote and makes its workspace part of a data folder, without starting anything. Everything is checked
// first and built in a staging folder under the data folder; only then is it put in place, and a failure while putting it in place takes back what was already there.

export class ImportError extends Error {
  constructor(
    /** What `<code>: <message>` says on stderr. */
    readonly code: 'invalid-input' | 'bad-bundle' | 'newer-format' | 'no-remote' | 'conflict' | 'bad-key',
    message: string,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface ImportOptions {
  bundle: string;
  dataDir: string;
  keyFile: string;
  reposRoot: string;
}

export interface ImportResult {
  imported: string;
  repos: { id: string; path: string }[];
  alreadyImported?: true;
}

export interface ImportDeps {
  /** For a test that makes the putting in place fail half way. */
  rename?: (from: string, to: string) => void;
  now?: () => Date;
}

interface StoredEntry {
  source: { type: 'stored' };
  cipher: string;
  updatedAt: string;
}
interface SecretsDoc {
  version: 1;
  warning: string;
  insecure: { accepted: boolean; acceptedAt: string | null };
  entries: Record<string, unknown>;
}

const MARKERS = 'imports';
const bad = (detail: string, path: string): ImportError => new ImportError('bad-bundle', t('main.move.import.badBundle', { path, detail }));

function json<T>(file: string, bundle: string): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    throw bad(`${file.slice(bundle.length + 1) || file}: ${e instanceof Error ? e.message : String(e)}`, bundle);
  }
}

// What a core that merely ran leaves in its workspace folder and that holds no user data: the ownership lease (and its temp file) and the admin socket. A supervisor that created
// and started a fresh install, or a core that was killed, leaves them behind. The sandbox and browser folders are not here: only use creates them, so they mean the workspace was used.
const RUNTIME_ONLY = new Set(['owner.json', 'owner.json.tmp', 'owner.lock']);
const runtimeOnly = (name: string): boolean => RUNTIME_ONLY.has(name) || name.endsWith('.sock');

// A workspace that nothing was ever done in: only the configuration a first start writes (and what merely running a core leaves), and a setup nobody finished. An installer's `--init` leaves one under the id the move wants.
function pristine(dir: string): boolean {
  try {
    if (readdirSync(dir).some((n) => n !== 'config.json' && !runtimeOnly(n))) return false;
    return (JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { setupComplete?: unknown }).setupComplete !== true;
  } catch {
    return false;
  }
}

/** The workspace's files, as the bundle holds them minus what a move never carries, written with private modes. Anything but a plain file or folder in the bundle is refused. */
function copyIn(from: string, to: string, bundle: string, top = true): void {
  mkdirSync(to, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(from)) {
    if ((top && SKIP_TOP.has(name)) || name.endsWith('.sock')) continue;
    const src = join(from, name);
    const stat = lstatSync(src);
    if (stat.isDirectory()) copyIn(src, join(to, name), bundle, false);
    else if (stat.isFile()) {
      const dest = join(to, name);
      copyFileSync(src, dest);
      chmodSync(dest, 0o600);
    } else throw bad(`${src.slice(bundle.length + 1)} is not a plain file or folder`, bundle);
  }
}

const hashOf = (bundle: string): string => {
  const h = createHash('sha256');
  for (const f of [MOVE_FILES.manifest, MOVE_FILES.registry, MOVE_FILES.secrets, join(MOVE_FILES.workspace, 'config.json')]) {
    h.update(f);
    try {
      h.update(readFileSync(join(bundle, f)));
    } catch {
      h.update('-');
    }
  }
  return h.digest('hex');
};

function atomicWrite(file: string, text: string, mode = 0o600): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}

export function importBundle(options: ImportOptions, deps: ImportDeps = {}): ImportResult {
  const bundle = resolve(options.bundle);
  const root = resolve(options.dataDir);
  const reposRoot = resolve(options.reposRoot);
  const rename = deps.rename ?? renameSync;

  const manifest = json<Partial<MoveManifest>>(join(bundle, MOVE_FILES.manifest), bundle);
  if (typeof manifest.format !== 'number') throw bad('manifest.json has no format', bundle);
  if (manifest.format > MOVE_BUNDLE_FORMAT) throw new ImportError('newer-format', t('main.move.import.newer', { format: manifest.format, max: MOVE_BUNDLE_FORMAT }));
  const id = manifest.workspace?.id;
  if (typeof id !== 'string' || !WORKSPACE_ID.test(id)) throw bad('the workspace id is missing or not valid', bundle);
  const repos = manifest.repos ?? [];
  if (!Array.isArray(repos)) throw bad('manifest.json: repos is not a list', bundle);
  for (const r of repos) {
    if (typeof r?.id !== 'string' || !REPO_FILE.test(r.id)) throw bad('a repository id is missing or not valid', bundle);
    if (typeof r.remoteUrl !== 'string' || !r.remoteUrl.trim()) throw new ImportError('no-remote', t('main.move.import.noRemote', { id: r.id }));
  }
  const placed = repos.map((r) => ({ id: r.id, path: join(reposRoot, r.id) }));

  const entry = json<Partial<WorkspaceInfo>>(join(bundle, MOVE_FILES.registry), bundle);
  if (entry.id !== id || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.createdAt !== 'string' || typeof entry.test !== 'boolean') throw bad('registry.json is not the entry of the workspace', bundle);
  const info: WorkspaceInfo = { ...(entry as WorkspaceInfo) };

  const source = join(bundle, MOVE_FILES.workspace);
  if (!existsSync(source) || !lstatSync(source).isDirectory()) throw bad('the workspace folder is missing', bundle);

  // The same bundle again is a no-op, whatever the service did to the workspace since: the bundle's own fingerprint is what was recorded.
  const fingerprint = hashOf(bundle);
  const markerFile = join(root, MARKERS, `${id}.json`);
  try {
    if ((JSON.parse(readFileSync(markerFile, 'utf8')) as { bundle?: unknown }).bundle === fingerprint) return { imported: id, repos: placed, alreadyImported: true };
  } catch {
    // No import of this workspace yet, or an unreadable record: the rest decides.
  }

  const key = readMasterKey(options.keyFile, root);
  if (!key) throw new ImportError('invalid-input', t('main.headless.keyFile', { path: options.keyFile }));

  // The secrets: every stored entry must open with this machine's key (a bundle sealed for another key is refused whole), and one that already exists must hold the same value.
  const incoming = json<Partial<SecretsDoc>>(join(bundle, MOVE_FILES.secrets), bundle);
  if (incoming.version !== 1 || !incoming.entries || typeof incoming.entries !== 'object') throw bad('secrets.json is not a secrets file of version 1', bundle);
  const secretsFile = join(root, 'secrets.json');
  let existing: SecretsDoc | null = null;
  if (existsSync(secretsFile)) {
    try {
      const raw = JSON.parse(readFileSync(secretsFile, 'utf8')) as Partial<SecretsDoc>;
      existing = { version: 1, warning: WARNING, insecure: { accepted: false, acceptedAt: null }, ...raw, entries: { ...raw.entries } } as SecretsDoc;
    } catch {
      throw new ImportError('invalid-input', t('main.move.import.secretsUnreadable', { path: secretsFile }));
    }
  }
  const merged: SecretsDoc = existing ?? { version: 1, warning: WARNING, insecure: { accepted: false, acceptedAt: null }, entries: {} };
  const valueOf = (e: unknown): string | null => {
    const c = (e as { cipher?: unknown } | null)?.cipher;
    return typeof c === 'string' ? gcmDecrypt(key, Buffer.from(c, 'base64')) : null;
  };
  for (const [ref, raw] of Object.entries(incoming.entries)) {
    const e = raw as Partial<StoredEntry>;
    if (e?.source?.type !== 'stored' || typeof e.cipher !== 'string') throw bad(`secret ${ref} is not a stored entry`, bundle);
    const value = valueOf(e);
    if (value === null) throw new ImportError('bad-key', t('main.move.import.badKey', { ref }));
    const have = merged.entries[ref];
    if (have === undefined) merged.entries[ref] = e;
    // The same cipher, or the same value sealed again (another export of the same secret has another IV): nothing to add. A different value is never overwritten.
    else if ((have as { cipher?: unknown }).cipher !== e.cipher && valueOf(have) !== value) throw new ImportError('conflict', t('main.move.import.secretConflict', { ref }));
  }

  // The registry and the workspace's place.
  let registry: Registry | null = null;
  if (existsSync(join(root, REGISTRY_FILE))) {
    registry = readRegistry(root);
    if (!registry) throw new ImportError('invalid-input', t('main.move.import.registryUnreadable', { path: join(root, REGISTRY_FILE) }));
  }
  const target = join(root, WORKSPACES_DIR, id);
  const listed = registry?.list.some((w) => w.id === id) ?? false;
  const replace = existsSync(target) || listed;
  if (replace && !(pristine(target) || (!existsSync(target) && listed))) throw new ImportError('conflict', t('main.move.import.workspaceExists', { id }));
  const next: Registry = registry ? { current: registry.current, list: [...registry.list.filter((w) => w.id !== id), info] } : { current: id, list: [info] };

  // Staged under the data folder so the final renames stay on one filesystem.
  mkdirSync(root, { recursive: true });
  const stage = mkdtempSync(join(root, '.import-'));
  const undo: (() => void)[] = [];
  try {
    const staged = join(stage, 'workspace');
    copyIn(source, staged, bundle);
    // The clones live elsewhere here: the repositories point at the folder the server cloned them into.
    const configFile = join(staged, 'config.json');
    if (existsSync(configFile)) {
      const config = JSON.parse(readFileSync(configFile, 'utf8')) as { projects?: { roots?: unknown; repos?: { id?: unknown; path?: unknown }[] } };
      const projects = (config.projects ??= {});
      projects.roots = [reposRoot];
      for (const r of projects.repos ?? []) if (typeof r.id === 'string') r.path = join(reposRoot, r.id);
      atomicWrite(configFile, JSON.stringify(config, null, 2));
    }
    atomicWrite(join(stage, 'secrets.json'), JSON.stringify(merged, null, 2));
    atomicWrite(join(stage, 'workspaces.json'), JSON.stringify(next, null, 2), 0o644);

    // Putting in place. Each step says how to take it back; a folder made for it goes away again when it is empty.
    const made = (dir: string): void => {
      if (existsSync(dir)) return;
      mkdirSync(dir, { recursive: true });
      undo.push(() => rmdirSync(dir));
    };
    made(join(root, WORKSPACES_DIR));
    const old = join(stage, 'replaced');
    if (existsSync(target)) {
      rename(target, old);
      undo.push(() => renameSync(old, target));
    }
    rename(staged, target);
    undo.push(() => rmSync(target, { recursive: true, force: true }));

    const keep = <T extends string | null>(file: string, read: () => T, write: (text: T) => void): void => {
      const before = read();
      undo.push(() => (before === null ? rmSync(file, { force: true }) : write(before)));
    };
    keep(secretsFile, () => (existsSync(secretsFile) ? readFileSync(secretsFile, 'utf8') : null), (text) => atomicWrite(secretsFile, String(text)));
    rename(join(stage, 'secrets.json'), secretsFile);
    chmodSync(secretsFile, 0o600);

    const registryFile = join(root, REGISTRY_FILE);
    keep(registryFile, () => (existsSync(registryFile) ? readFileSync(registryFile, 'utf8') : null), (text) => atomicWrite(registryFile, String(text), 0o644));
    rename(join(stage, 'workspaces.json'), registryFile);

    made(join(root, MARKERS));
    undo.push(() => rmSync(markerFile, { force: true }));
    atomicWrite(markerFile, JSON.stringify({ bundle: fingerprint, importedAt: (deps.now?.() ?? new Date()).toISOString() }));
  } catch (e) {
    for (const step of undo.reverse()) {
      try {
        step();
      } catch {
        // Taking back is best effort: what could not be taken back is what the error already says.
      }
    }
    throw e;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  return { imported: id, repos: placed };
}
