import type { VcsProbeResult } from '../shared/vcs';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { expandHome, shrinkHome } from '../shared/config/paths';
import type { CeremonyId, VcsIntegration } from '../shared/config/types';
import { CEREMONY_IDS } from '../shared/config/types';
import { type CycleTemplateInfo, type DocsFound, type ScannedRepo, type SdkEvent, type VcsTestResult, type WizardProgress, emptyProgress, parseProgress, parseRemote, uniqueId } from '../shared/wizard';

// The wizard's logic without Electron: progress file, project scan, docs scan, the SDK installation, the minimal VCS call and the
// normalisers for the modules other agents are still building (they are looked up at run time, see wizard.ts). Everything that touches the
// machine comes in through the dependencies, so the tests run against a temporary folder and a fake npm.

export const PROGRESS_FILE = 'wizard.json';

export function readProgress(dir: string, now = new Date()): WizardProgress {
  try {
    return parseProgress(JSON.parse(readFileSync(join(dir, PROGRESS_FILE), 'utf8')), now);
  } catch {
    return emptyProgress(now);
  }
}

export function writeProgress(dir: string, raw: unknown, now = new Date()): WizardProgress {
  const progress = { ...parseProgress(raw, now), updatedAt: now.toISOString() };
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${join(dir, PROGRESS_FILE)}.tmp`, JSON.stringify(progress, null, 2));
  renameSync(`${join(dir, PROGRESS_FILE)}.tmp`, join(dir, PROGRESS_FILE));
  return progress;
}

export function clearProgress(dir: string): void {
  rmSync(join(dir, PROGRESS_FILE), { force: true });
}

// ---- git repositories -------------------------------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '.venv', 'venv', 'dist', 'build', 'out', 'target', '.next', '.gradle', 'vendor']);
export const MAX_REPOS = 200;
export const SCAN_DEPTH = 2;

export interface ScanDeps {
  home: string;
  exists: (p: string) => boolean;
  isDir: (p: string) => boolean;
  read: (p: string) => string;
  list: (p: string) => string[];
}

export const fsScanDeps = (home: string): ScanDeps => ({
  home,
  exists: existsSync,
  isDir: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  read: (p) => readFileSync(p, 'utf8'),
  list: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
});

/** The git directory of a checkout: ".git" itself, or the one a worktree or submodule points to. Null when the folder is not a checkout. */
export function gitDirOf(dir: string, d: ScanDeps): string | null {
  const dot = join(dir, '.git');
  if (!d.exists(dot)) return null;
  if (d.isDir(dot)) return dot;
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(d.read(dot));
    if (!m) return null;
    const gitdir = resolve(dir, m[1].trim());
    // A linked worktree keeps its config in the common directory.
    const common = join(gitdir, 'commondir');
    return d.exists(common) ? resolve(gitdir, d.read(common).trim()) : gitdir;
  } catch {
    return null;
  }
}

/** The URL of the "origin" remote (else the first remote) from a git config file. */
export function remoteUrlOf(gitDir: string, d: ScanDeps): string | null {
  let text: string;
  try {
    text = d.read(join(gitDir, 'config'));
  } catch {
    return null;
  }
  const remotes: { name: string; url: string }[] = [];
  let current: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      const remote = /^remote\s+"(.+)"$/.exec(section[1]);
      current = remote ? remote[1] : null;
      continue;
    }
    const url = current ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (current && url) remotes.push({ name: current, url: url[1] });
  }
  return (remotes.find((r) => r.name === 'origin') ?? remotes[0])?.url ?? null;
}

const repoId = (name: string): string => {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return /^[a-z0-9]/.test(slug) ? slug : `repo${slug ? `-${slug}` : ''}`.slice(0, 40);
};

function describe(dir: string, d: ScanDeps): ScannedRepo | null {
  const git = gitDirOf(dir, d);
  if (!git) return null;
  const remoteUrl = remoteUrlOf(git, d);
  const parsed = parseRemote(remoteUrl);
  return { id: repoId(basename(dir)), path: shrinkHome(dir, d.home), remoteUrl, host: parsed?.host ?? null, projectPath: parsed?.projectPath ?? null, kind: parsed?.kind ?? null };
}

/** Git repositories at or under the given folders (two levels deep), with their remotes. A folder that is itself a checkout is one repo. */
export function scanRepos(roots: string[], d: ScanDeps): ScannedRepo[] {
  const found = new Map<string, ScannedRepo>();
  const visit = (dir: string, depth: number): void => {
    if (found.size >= MAX_REPOS) return;
    const repo = describe(dir, d);
    if (repo) {
      found.set(dir, repo);
      return;
    }
    if (depth >= SCAN_DEPTH) return;
    for (const name of d.list(dir).sort()) {
      if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
      const child = join(dir, name);
      if (d.isDir(child)) visit(child, depth + 1);
    }
  };
  for (const root of roots) {
    const abs = expandHome(root, d.home);
    if (d.isDir(abs)) visit(abs, 0);
  }
  const taken: string[] = [];
  return [...found.values()].map((r) => {
    const id = uniqueId(r.id, taken);
    taken.push(id);
    return { ...r, id };
  });
}

// ---- documentation sources --------------------------------------------------------------------------------------------------------------

/**
 * A minimal scan for what Claude Code itself would load: CLAUDE.md and .claude/{skills,agents,rules,knowledge-base} and .mcp.json in the
 * projects and in ~/.claude. It stands in for the "prepare agents" scanner of the cycles work, which the wizard prefers when it exists.
 */
export function scanDocsFallback(bases: string[], d: Pick<ScanDeps, 'home' | 'exists'>): DocsFound {
  const out: DocsFound = { claudeMdRoots: [], skillsDirs: [], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [] };
  const add = (list: string[], abs: string) => {
    const p = shrinkHome(abs, d.home);
    if (!list.includes(p)) list.push(p);
  };
  const home = d.home.replace(/\/+$/, '');
  const dirs = [...new Set([...bases.map((b) => expandHome(b, d.home)), join(home, '.claude')])];
  for (const base of dirs) {
    const claude = basename(base) === '.claude' ? base : join(base, '.claude');
    if (d.exists(join(base, 'CLAUDE.md'))) add(out.claudeMdRoots, base);
    else if (d.exists(join(claude, 'CLAUDE.md'))) add(out.claudeMdRoots, claude);
    if (d.exists(join(claude, 'skills'))) add(out.skillsDirs, join(claude, 'skills'));
    if (d.exists(join(claude, 'agents'))) add(out.agentsDirs, join(claude, 'agents'));
    if (d.exists(join(claude, 'rules'))) add(out.rulesDirs, join(claude, 'rules'));
    for (const kb of [join(claude, 'knowledge-base'), join(base, 'knowledge-base')]) if (d.exists(kb)) add(out.knowledgeDirs, kb);
    if (d.exists(join(base, '.mcp.json'))) add(out.mcpConfigFiles, join(base, '.mcp.json'));
  }
  if (d.exists(join(home, '.claude.json'))) add(out.mcpConfigFiles, join(home, '.claude.json'));
  return out;
}

// ---- Claude Agent SDK installation ------------------------------------------------------------------------------------------------------

export const SDK_PKG = '@anthropic-ai/claude-agent-sdk';
/** The range the app was built against (package.json); a test keeps the two in step. */
export const SDK_RANGE = '^0.3.287';

export interface NpmRun {
  child: ChildProcess;
}

export interface InstallDeps {
  /** Starts npm with these arguments in this folder. */
  spawnNpm: (args: string[], cwd: string) => ChildProcess;
  emit: (e: SdkEvent) => void;
  readVersion: (dir: string) => string | null;
}

/** Version recorded in the installed package, or null when it is not there. */
export function installedVersion(dir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'node_modules', SDK_PKG, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function npmCommand(platform = process.platform): string {
  return process.env.COXIA_NPM || (platform === 'win32' ? 'npm.cmd' : 'npm');
}

export const realSpawnNpm = (args: string[], cwd: string): ChildProcess =>
  spawn(npmCommand(), args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' } });

export interface Installation {
  cancel(): void;
  done: Promise<void>;
}

/** Installs the SDK with npm into `dir` (a package of its own: nothing is added to the app). Streams the log lines; cancel kills npm. */
export function installSdk(dir: string, deps: InstallDeps): Installation {
  let cancelled = false;
  let child: ChildProcess | null = null;
  const done = (async () => {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, 'package.json'))) writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'coxia-claude-sdk', private: true, description: 'Claude Agent SDK installed by the Coxia setup wizard' }, null, 2)}\n`);
    deps.emit({ phase: 'start', dir });
    await new Promise<void>((resolveRun, reject) => {
      try {
        child = deps.spawnNpm(['install', `${SDK_PKG}@${SDK_RANGE}`, '--no-audit', '--no-fund', '--loglevel=http'], dir);
      } catch (e) {
        reject(e);
        return;
      }
      const tail: string[] = [];
      const lines = (chunk: Buffer | string) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const text = line.replace(/^npm\s+(http|info|warn|notice)?\s*/i, '').trim();
          if (!text) continue;
          tail.push(text);
          if (tail.length > 20) tail.shift();
          deps.emit({ phase: 'log', line: text.slice(0, 300) });
        }
      };
      child.stdout?.on('data', lines);
      child.stderr?.on('data', lines);
      child.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error('npm-missing') : e));
      child.on('close', (code) => {
        if (cancelled) reject(new Error('cancelled'));
        else if (code === 0) resolveRun();
        else reject(new Error(tail.slice(-6).join('\n') || `npm exited with ${code}`));
      });
    });
    const version = deps.readVersion(dir);
    if (!version) throw new Error('installed-but-missing');
    deps.emit({ phase: 'done', version, path: dir });
  })().catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    if (cancelled || message === 'cancelled') deps.emit({ phase: 'cancelled' });
    else deps.emit({ phase: 'error', message });
  });
  return {
    cancel() {
      cancelled = true;
      child?.kill();
    },
    done,
  };
}

// ---- VCS: the minimal call --------------------------------------------------------------------------------------------------------------

export interface FetchLike {
  (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}

/** The URL and headers that fetch the current user, per provider. TODO: replaced by probeVcs of src/main/vcs once that lands. */
export function vcsUserRequest(v: Pick<VcsIntegration, 'kind' | 'host' | 'apiUrl' | 'user'>, token: string): { url: string; headers: Record<string, string> } {
  const host = v.host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const api = v.apiUrl.replace(/\/+$/, '');
  if (v.kind === 'github') {
    const root = api || (host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`);
    return { url: `${root}/user`, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'coxia' } };
  }
  if (v.kind === 'bitbucket') {
    const root = api || 'https://api.bitbucket.org/2.0';
    const auth = v.user ? `Basic ${Buffer.from(`${v.user}:${token}`).toString('base64')}` : `Bearer ${token}`;
    return { url: `${root}/user`, headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'coxia' } };
  }
  const root = api || `https://${host}/api/v4`;
  return { url: `${root}/user`, headers: { 'PRIVATE-TOKEN': token, Accept: 'application/json', 'User-Agent': 'coxia' } };
}

const loginOf = (body: unknown): string | null => {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const key of ['username', 'login', 'nickname', 'display_name', 'name']) if (typeof b[key] === 'string' && b[key]) return b[key] as string;
  return null;
};

export async function fallbackVcsProbe(v: Pick<VcsIntegration, 'kind' | 'host' | 'apiUrl' | 'user'>, token: string | null, fetchImpl: FetchLike, timeoutMs = 15_000): Promise<VcsTestResult> {
  if (!token) return { ok: false, user: null, source: 'fallback', status: null, message: 'no-token' };
  const req = vcsUserRequest(v, token);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, { headers: req.headers, signal: ctl.signal });
    if (!res.ok) return { ok: false, user: null, source: 'fallback', status: res.status, message: `http-${res.status}` };
    return { ok: true, user: loginOf(await res.json().catch(() => null)), source: 'fallback', status: res.status, message: 'ok' };
  } catch (e) {
    return { ok: false, user: null, source: 'fallback', status: null, message: ctl.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads whatever `probeVcs` answered (its shape is the VCS agent's) into the wizard's result. */
export function normalizeVcsProbe(raw: unknown): VcsTestResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ok = r.ok === true || r.success === true || (r.ok === undefined && r.error === undefined && !!(r.user ?? r.login));
  const userRaw = r.user ?? r.login ?? r.username;
  const user = typeof userRaw === 'string' ? userRaw : typeof (userRaw as { login?: unknown; username?: unknown } | undefined)?.username === 'string' ? ((userRaw as { username: string }).username) : typeof (userRaw as { login?: unknown } | undefined)?.login === 'string' ? ((userRaw as { login: string }).login) : null;
  const message = [r.message, r.error, r.detail].find((x) => typeof x === 'string') as string | undefined;
  // probeVcs of src/main/vcs answers with the whole probe (checks, scopes, samples): keep it for the screen.
  const probe = Array.isArray(r.checks) && typeof r.kind === 'string' && typeof r.host === 'string' ? (raw as VcsProbeResult) : undefined;
  return { ok, user, source: 'vcs', status: typeof r.status === 'number' ? r.status : null, message: message ?? (ok ? 'ok' : 'failed'), ...(probe ? { probe } : {}) };
}

// ---- cycle templates ----------------------------------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads the cycle work's templates (their field names are not fixed yet) into what the screen lists. Anything unreadable is dropped. */
export function normalizeTemplates(raw: unknown): CycleTemplateInfo[] {
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : [];
  const out: CycleTemplateInfo[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const patchRaw = item.patch ?? item.config ?? (isRecord(item.devCycle) ? { devCycle: item.devCycle } : null);
    const patch = isRecord(patchRaw) ? patchRaw : null;
    const dev = isRecord(patch?.devCycle) ? (patch.devCycle as Record<string, unknown>) : null;
    const cer = isRecord(dev?.ceremonies) ? (dev.ceremonies as Record<string, unknown>) : isRecord(item.ceremonies) ? item.ceremonies : null;
    const ceremonies = cer ? (Object.fromEntries(CEREMONY_IDS.filter((c) => typeof cer[c] === 'boolean').map((c) => [c, cer[c] as boolean])) as Partial<Record<CeremonyId, boolean>>) : null;
    const stagesRaw = Array.isArray(dev?.stages) ? (dev.stages as unknown[]) : Array.isArray(item.stages) ? item.stages : [];
    const name = [item.name, item.label, item.title].find((x) => typeof x === 'string' && x) as string | undefined;
    out.push({
      id: item.id,
      name: name ?? item.id,
      description: typeof item.description === 'string' ? item.description : '',
      available: true,
      patch,
      ceremonies,
      stages: stagesRaw.filter(isRecord).map((s) => ({ id: String(s.id ?? ''), label: String(s.label ?? s.id ?? '') })).filter((s) => s.id),
    });
  }
  return out;
}

/** What the cycle step lists while the real templates are not in the build: "no cycle" works, the others say they are coming. */
export function placeholderTemplates(): CycleTemplateInfo[] {
  return [
    { id: 'none', name: 'none', description: '', available: true, patch: null, ceremonies: null, stages: [] },
    { id: 'scrum', name: 'scrum', description: '', available: false, patch: null, ceremonies: null, stages: [] },
    { id: 'kanban', name: 'kanban', description: '', available: false, patch: null, ceremonies: null, stages: [] },
    { id: 'sdd', name: 'sdd', description: '', available: false, patch: null, ceremonies: null, stages: [] },
  ];
}
