import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { expandHome } from '../shared/config/paths';
import { t } from '../shared/i18n';
import { MOVE_BUNDLE_FORMAT, MOVE_FILES, type MoveManifest, type MoveRepo } from '../shared/move';
import { gcmEncrypt } from './masterKey';
import { WARNING, type SecretsStore } from './secrets-core';
import { createRunStore } from './runs-core';
import { isTerminal } from '../shared/runs';
import { readRegistry } from './workspaces-core';

// What a workspace takes with it to another machine (#309): its folder, its registry entry, the stored secrets it refers to re-encrypted under the target machine's key, and the
// run branches of its repositories. The target key arrives in the call, is used to encrypt and is never written, logged, audited or put in a message.

const KEY = /^[0-9a-fA-F]{64}$/;
// A repository id becomes a file name in the bundle.
export const REPO_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// What the new machine makes for itself, or must never receive: the lease, the admin socket, the sandbox's copies and the browser profiles of the agents.
export const SKIP_TOP = new Set(['owner.json', 'owner.json.tmp', 'owner.lock', 'admin.sock', 'sandbox', 'browser']);

export class MoveError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'forbidden' | 'conflict' | 'not-found' | 'internal',
    message: string,
  ) {
    super(message);
    this.name = 'MoveError';
  }
}

export interface ExportDeps {
  /** The data root and the workspace's folder in it. */
  root: string;
  workspaceDir: string;
  workspaceId: string;
  /** The current secrets store: the values it resolves are encrypted for the target and go nowhere else. */
  store: Pick<SecretsStore, 'list' | 'resolve'>;
  version: string;
  contractVersion: number;
  home: string;
  now?: () => Date;
  /** Runs git; for a test. */
  git?: (cwd: string, args: string[]) => string;
}

const defaultGit = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

interface RawConfig {
  projects?: { repos?: { id?: unknown; path?: unknown; remoteUrl?: unknown }[] };
  llm?: { providers?: { secretRef?: unknown }[] };
  vcs?: { secretRef?: unknown }[];
  accounts?: { secretRefs?: unknown }[];
  testEnvironment?: { secrets?: { ref?: unknown }[] };
  plugins?: { list?: { id?: unknown }[] };
}

/** The references into the secrets store the workspace's configuration points at: model providers, code hosts, accounts, the test environment, and a plugin's own (`plugin.<id>.*`). */
export function secretRefsOf(config: RawConfig, known: string[]): string[] {
  const refs = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v) refs.add(v);
  };
  for (const p of config.llm?.providers ?? []) add(p.secretRef);
  for (const v of config.vcs ?? []) add(v.secretRef);
  for (const a of config.accounts ?? []) if (Array.isArray(a.secretRefs)) a.secretRefs.forEach(add);
  for (const s of config.testEnvironment?.secrets ?? []) add(s.ref);
  for (const p of config.plugins?.list ?? []) {
    if (typeof p.id !== 'string' || !p.id) continue;
    for (const ref of known) if (ref.startsWith(`plugin.${p.id}.`)) refs.add(ref);
  }
  return [...refs].sort();
}

/** Every file under `from` except what a move leaves out; directories 0700 and files 0600. Returns the count and the bytes. */
function copyTree(from: string, to: string, top = true): { files: number; bytes: number } {
  mkdirSync(to, { recursive: true, mode: 0o700 });
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(from)) {
    if ((top && SKIP_TOP.has(name)) || name.endsWith('.sock')) continue;
    const src = join(from, name);
    const stat = lstatSync(src);
    // A link, a socket or a device is not carried: what the folder holds is plain files and folders.
    if (stat.isDirectory()) {
      const inner = copyTree(src, join(to, name), false);
      files += inner.files;
      bytes += inner.bytes;
    } else if (stat.isFile()) {
      const dest = join(to, name);
      copyFileSync(src, dest);
      chmodSync(dest, 0o600);
      files += 1;
      bytes += stat.size;
    }
  }
  return { files, bytes };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function repoOf(raw: { id?: unknown; path?: unknown; remoteUrl?: unknown }, branches: string[], deps: ExportDeps, git: (cwd: string, args: string[]) => string, stage: string): { repo: MoveRepo; bundled: boolean } | null {
  const id = text(raw.id);
  if (!id) return null;
  if (!REPO_FILE.test(id)) throw new MoveError('invalid-input', t('main.move.badRepoId', { id: id.slice(0, 80) }));
  const path = text(raw.path) ? resolve(expandHome(raw.path as string, deps.home)) : null;
  const clone = path !== null && existsSync(join(path, '.git'));
  const ask = (args: string[]): string | null => {
    if (!clone || path === null) return null;
    try {
      return git(path, args).trim() || null;
    } catch {
      return null;
    }
  };
  const remoteUrl = text(raw.remoteUrl) ?? ask(['remote', 'get-url', 'origin']);
  // Only a branch the clone really has is bundled: a run whose branch was never pushed or was deleted has nothing to carry.
  const present = branches.filter((b) => ask(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]) !== null);
  let bundled = false;
  if (clone && path !== null && present.length) {
    try {
      mkdirSync(join(stage, MOVE_FILES.git), { recursive: true, mode: 0o700 });
      const file = join(stage, MOVE_FILES.git, `${id}.bundle`);
      git(path, ['bundle', 'create', file, ...present.map((b) => `refs/heads/${b}`)]);
      chmodSync(file, 0o600);
      bundled = true;
    } catch (e) {
      throw new MoveError('internal', t('main.move.gitFailed', { id, detail: e instanceof Error ? e.message.split('\n')[0] : String(e) }));
    }
  }
  return { repo: { id, remoteUrl, gitName: ask(['config', 'user.name']), gitEmail: ask(['config', 'user.email']), runBranches: bundled ? present : [] }, bundled };
}

function writeFile(path: string, body: string | Buffer): number {
  writeFileSync(path, body, { mode: 0o600 });
  return Buffer.byteLength(body);
}

/** Writes the bundle at `out` (a folder that does not exist) and returns its manifest. The caller has checked that the workspace was moved out. */
export function exportBundle(deps: ExportDeps, input: { targetKey: unknown; out: unknown }): MoveManifest {
  const { targetKey, out } = input;
  if (typeof targetKey !== 'string' || !KEY.test(targetKey)) throw new MoveError('invalid-input', t('main.move.badKey'));
  if (typeof out !== 'string' || !out || resolve(out) !== out) throw new MoveError('invalid-input', t('main.move.badOut'));
  const key = Buffer.from(targetKey, 'hex');
  try {
    return build(deps, key, out);
  } catch (e) {
    // Whatever failed, the message does not carry the key.
    const message = (e instanceof Error ? e.message : String(e)).split(targetKey).join('[key]').split(targetKey.toLowerCase()).join('[key]').split(targetKey.toUpperCase()).join('[key]');
    throw new MoveError(e instanceof MoveError ? e.code : 'internal', message);
  } finally {
    key.fill(0);
  }
}

function build(deps: ExportDeps, key: Buffer, out: string): MoveManifest {
  const git = deps.git ?? defaultGit;
  let present = true;
  try {
    lstatSync(out);
  } catch {
    present = false;
  }
  if (present) throw new MoveError('conflict', t('main.move.outExists', { path: out }));

  const entry = readRegistry(deps.root)?.list.find((w) => w.id === deps.workspaceId);
  if (!entry) throw new MoveError('not-found', t('main.move.noWorkspace', { id: deps.workspaceId }));

  // Built beside the target and renamed at the end, so a failure leaves no half bundle where a tool would look.
  const stage = `${out}.partial-${process.pid}`;
  mkdirSync(dirname(out), { recursive: true });
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { mode: 0o700 });
  try {
    const copied = copyTree(deps.workspaceDir, join(stage, MOVE_FILES.workspace));
    let files = copied.files;
    let bytes = copied.bytes;
    bytes += writeFile(join(stage, MOVE_FILES.registry), `${JSON.stringify(entry, null, 2)}\n`);
    files += 1;

    let config: RawConfig = {};
    try {
      config = JSON.parse(readFileSync(join(deps.workspaceDir, 'config.json'), 'utf8')) as RawConfig;
    } catch {
      // A workspace without a readable configuration refers to no repository and no secret.
    }

    // The runs still open and the branch each one works on, by repository.
    const open = createRunStore(join(deps.workspaceDir, 'runs')).list().filter((r) => !isTerminal(r));
    const repos: MoveRepo[] = [];
    for (const raw of config.projects?.repos ?? []) {
      const id = text(raw.id);
      const branches = [...new Set(open.filter((r) => r.repo === id && r.branch).map((r) => r.branch))];
      const made = repoOf(raw, branches, deps, git, stage);
      if (!made) continue;
      repos.push(made.repo);
      if (made.bundled) {
        files += 1;
        bytes += statSync(join(stage, MOVE_FILES.git, `${made.repo.id}.bundle`)).size;
      }
    }

    const listed = deps.store.list();
    const byRef = new Map(listed.map((s) => [s.ref, s]));
    const moved: string[] = [];
    const notMoved: { ref: string; type: string }[] = [];
    const entries: Record<string, { source: { type: 'stored' }; cipher: string; updatedAt: string }> = {};
    for (const ref of secretRefsOf(config, listed.map((s) => s.ref))) {
      const info = byRef.get(ref);
      if (!info) notMoved.push({ ref, type: 'missing' });
      // A command or a variable names something of the old machine: only the reference is left to set up again there.
      else if (info.source !== 'stored') notMoved.push({ ref, type: info.source });
      else {
        let value: string;
        try {
          value = deps.store.resolve(ref);
        } catch {
          notMoved.push({ ref, type: 'unreadable' });
          continue;
        }
        entries[ref] = { source: { type: 'stored' }, cipher: gcmEncrypt(key, value).toString('base64'), updatedAt: info.updatedAt };
        moved.push(ref);
      }
    }
    bytes += writeFile(join(stage, MOVE_FILES.secrets), JSON.stringify({ version: 1, warning: WARNING, insecure: { accepted: false, acceptedAt: null }, entries }, null, 2));
    files += 1;

    const manifest: MoveManifest = {
      format: MOVE_BUNDLE_FORMAT,
      coxiaVersion: deps.version,
      contractVersion: deps.contractVersion,
      exportedAt: (deps.now?.() ?? new Date()).toISOString(),
      workspace: { id: entry.id, name: entry.name },
      repos,
      secrets: { moved, notMoved },
      files,
      bytes,
    };
    writeFile(join(stage, MOVE_FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(stage, out);
    return manifest;
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}
