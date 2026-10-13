import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { t } from '../shared/i18n';
import { NEUTRAL_WEB } from '../shared/settings';
import { validateWeb } from '../main/config';
import { type Coxia, createCoxia } from '../main/core';
import { bootEnv, workspaceId } from '../main/env';
import { getConfig } from '../main/workspaceConfig';
import type { HostPort } from '../main/host';
import { masterKeyPort } from '../main/masterKey';
import { type SignalHandlers, installSignalHandlers } from '../main/signals';
import { webListening } from '../main/webAccess';

// The core in a plain Node process: no window, no keychain, no desktop. One process runs one workspace and one web address, so several workspaces on a
// machine are several processes of this entry. Nothing here reaches the desktop runtime (test/core-no-electron.test.ts walks this folder too).

export interface Running {
  core: Coxia;
  signals: SignalHandlers;
  workspace: string;
  address: string;
}

export interface MainDeps {
  /** Ends the process. The process's own exit by default; a test gives its own. */
  exit?: (code: number) => void;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

class UsageError extends Error {}

const FLAGS = {
  'data-dir': { type: 'string' },
  workspace: { type: 'string' },
  'master-key-file': { type: 'string' },
  host: { type: 'string' },
  port: { type: 'string' },
  'renderer-dir': { type: 'string' },
  'no-admin-door': { type: 'boolean' },
  init: { type: 'boolean' },
  help: { type: 'boolean' },
} as const;

interface Options {
  /** Only prepare the data folder (the workspace registry) and exit: for an installer, before anything supervises the cores. */
  init?: true;
  dataDir: string;
  workspace?: string;
  keyFile: string;
  host: string;
  port: number;
  rendererDir?: string;
  adminDoor: boolean;
}

// The bundle sits in out/headless and the sources in src/headless: both are two folders under the app's own, where package.json and the built renderer are.
const appDir = (): string => join(import.meta.dirname, '..', '..');

function options(argv: string[], env: NodeJS.ProcessEnv): Options | null {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: FLAGS, allowPositionals: false });
  } catch (e) {
    throw new UsageError(t('main.headless.badOption', { detail: e instanceof Error ? e.message : String(e) }));
  }
  const v = parsed.values;
  if (v.help) return null;
  const need = (value: string | undefined, flag: string, variable: string): string => {
    if (!value) throw new UsageError(t('main.headless.required', { flag, variable }));
    return value;
  };
  // The data folder has no default here: a service must never fall back to the desktop's folder by forgetting a flag.
  const dataDir = resolve(need(v['data-dir'] ?? env.COXIA_DATA_DIR ?? env.CERIMONIAS_DATA_DIR, '--data-dir', 'COXIA_DATA_DIR'));
  if (v.init) return { init: true, dataDir, keyFile: '', host: '', port: 0, adminDoor: false };
  const keyFile = resolve(need(v['master-key-file'] ?? env.COXIA_MASTER_KEY_FILE, '--master-key-file', 'COXIA_MASTER_KEY_FILE'));
  const rawPort = need(v.port ?? env.COXIA_PORT, '--port', 'COXIA_PORT');
  const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN;
  const host = v.host ?? env.COXIA_HOST ?? '127.0.0.1';
  try {
    // The same rules the saved settings follow, so a host or port the door would refuse is refused here.
    validateWeb({ ...NEUTRAL_WEB, host, port });
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
  const workspace = v.workspace ?? env.COXIA_WORKSPACE;
  const rendererDir = v['renderer-dir'] ?? env.COXIA_RENDERER_DIR;
  // On unless it is turned off: a server's shell and CLI reach the core through it. COXIA_ADMIN_DOOR=0 is the same as the flag.
  const adminDoor = !v['no-admin-door'] && env.COXIA_ADMIN_DOOR !== '0';
  return { dataDir, keyFile, host, port, adminDoor, ...(workspace ? { workspace } : {}), ...(rendererDir ? { rendererDir: resolve(rendererDir) } : {}) };
}

function packageVersion(): string {
  try {
    return String((JSON.parse(readFileSync(join(appDir(), 'package.json'), 'utf8')) as { version?: unknown }).version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/** The built renderer next to the bundle, when there is one; a path the person named that has no page is a mistake, not a default to fall back from. */
function rendererFolder(named: string | undefined): string | undefined {
  if (named) {
    if (!existsSync(join(named, 'index.html'))) throw new UsageError(t('main.headless.noRenderer', { path: named }));
    return named;
  }
  const beside = join(appDir(), 'out', 'renderer');
  return existsSync(join(beside, 'index.html')) ? beside : undefined;
}

/**
 * Starts the core from the command line and the environment. Resolves to what runs, or null when nothing started: usage printed, or a failure
 * already said on stderr (the exit code is 1 for a failure, 0 for --help). A clean stop is the signal handlers', which end the process with 0.
 */
export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, deps: MainDeps = {}): Promise<Running | null> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const out = deps.out ?? ((line: string) => console.log(line));
  const err = deps.err ?? ((line: string) => console.error(line));
  const failed = (message: string): null => {
    err(message);
    exit(1);
    return null;
  };

  let opts: Options | null;
  try {
    opts = options(argv, env);
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
  if (!opts) {
    out(t('main.headless.usage'));
    exit(0);
    return null;
  }

  if (opts.init) {
    try {
      bootEnv({ dataDir: opts.dataDir });
      // The config bootstrap must run in this same process: it reads whether the folder held an install before the registry existed, and a
      // later process would see the registry this one just made and take a fresh folder for an old install.
      getConfig();
    } catch (e) {
      return failed(e instanceof Error ? e.message : String(e));
    }
    // The workspace the registry runs first, one line, for the installer's log; nothing else of the data.
    out(workspaceId());
    exit(0);
    return null;
  }

  const host: HostPort = { version: packageVersion, exit };
  let core: Coxia | null = null;
  try {
    const secrets = masterKeyPort(opts.keyFile);
    const rendererDir = rendererFolder(opts.rendererDir);
    core = createCoxia({
      dataDir: opts.dataDir,
      ...(opts.workspace ? { workspace: opts.workspace } : {}),
      web: { host: opts.host, port: opts.port },
      adminDoor: opts.adminDoor,
      secrets,
      host,
      ...(rendererDir ? { rendererDir } : {}),
    });
    // Fail closed before anything runs: without a usable key no secret can be stored, and a server that comes up without it would fail later and in pieces.
    if (!secrets.available()) throw new UsageError(t('main.headless.keyFile', { path: opts.keyFile }));
    await core.start();
    const door = webListening();
    if (!door.listening) throw new Error(door.message);
    const signals = installSignalHandlers(core, { exit });
    out(t('main.headless.ready', { address: `${door.address}${door.basePath}`, workspace: workspaceId() }));
    // A client says who owns the workspace: the line a service's log shows when the second instance of a workspace refuses to run it.
    const own = core.ownership();
    if (own && own.role === 'client' && own.owner) {
      const owner = `${own.owner.host} (${own.owner.instanceId.slice(0, 8)}, pid ${own.owner.pid})`;
      out(t(own.expired ? 'main.ownership.readyExpired' : 'main.ownership.readyClient', { workspace: workspaceId(), owner }));
    }
    const admin = core.adminDoor();
    if (admin) out(admin.listening ? t('main.headless.adminOpen', { path: admin.path }) : t('main.headless.adminClosed', { reason: admin.reason }));
    return { core, signals, workspace: workspaceId(), address: door.address ?? '' };
  } catch (e) {
    await core?.stop({ deadlineMs: 1_000 }).catch(() => undefined);
    return failed(e instanceof UsageError ? e.message : t('main.headless.startFailed', { detail: e instanceof Error ? e.message : String(e) }));
  }
}
