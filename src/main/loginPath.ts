import { execFile } from 'node:child_process';
import { delimiter } from 'node:path';

// An app started from the desktop does not get the PATH of the person's terminal: a Node installed by nvm (or Homebrew's, or a version manager's shims) is set up in
// the shell's startup files, which only a login shell reads. The commands the app runs for a run (QA's, the agents' own scripts, the code host's CLIs) would not
// find `npm`. So the PATH of the person's login shell is read once, kept, and put in front of the PATH the app already has. Nothing else of that shell's
// environment is taken: the commands keep the app's own (cleaned) environment.

const START = '__coxia_path_start__';
const END = '__coxia_path_end__';
const TIMEOUT_MS = 6_000;

/** Runs the shell with the arguments and returns what it printed on stdout; rejects when it fails or takes too long. */
export type ShellRun = (shell: string, args: string[], o: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<string>;

const realRun: ShellRun = (shell, args, o) =>
  new Promise((resolve, reject) => {
    execFile(shell, args, { env: o.env, timeout: o.timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

/** The PATH between the markers in what the shell printed (an interactive shell may say other things around it), or null. */
export function pathFromOutput(output: string): string | null {
  const from = output.lastIndexOf(START);
  const to = output.indexOf(END, from + START.length);
  if (from < 0 || to < 0) return null;
  const value = output.slice(from + START.length, to).trim();
  return value.includes('\n') ? null : value || null;
}

/**
 * The folders of the login PATH first, then the ones of the PATH the app has, without repeats. The folders of the app's own mount (an AppImage's) are left out of
 * what the app has: they are not where the person's tools are, and they must not come in front of them.
 */
export function mergedPath(login: string | null, env: NodeJS.ProcessEnv): string | undefined {
  const own = (env.PATH ?? '').split(delimiter).filter((p) => p && !(env.APPDIR && p.startsWith(env.APPDIR)));
  if (!login) return env.PATH;
  return [...new Set([...login.split(delimiter).filter(Boolean), ...own])].join(delimiter);
}

export interface LoginPathDeps {
  run?: ShellRun;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export interface LoginPath {
  /** The login PATH, read once: the same promise afterwards. Null when it cannot be read (no shell, a failure, a timeout, Windows). */
  resolve(): Promise<string | null>;
  /** What `resolve` found, when it already has; null before that and when nothing was found. */
  peek(): string | null;
}

export function createLoginPath(deps: LoginPathDeps = {}): LoginPath {
  let promise: Promise<string | null> | null = null;
  let found: string | null = null;
  return {
    resolve() {
      promise ??= (async () => {
        const env = deps.env ?? process.env;
        // The tests and a person who does not want a shell started say so with this variable.
        if ((deps.platform ?? process.platform) === 'win32' || env.COXIA_NO_LOGIN_SHELL === '1') return null;
        const shell = env.SHELL || '/bin/sh';
        try {
          const out = await (deps.run ?? realRun)(shell, ['-ilc', `printf '%s' "${START}$PATH${END}"`], { timeoutMs: deps.timeoutMs ?? TIMEOUT_MS, env: { ...env, TERM: env.TERM || 'dumb' } });
          found = pathFromOutput(out);
        } catch {
          found = null;
        }
        return found;
      })();
      return promise;
    },
    peek: () => found,
  };
}

/** The login PATH of this process's user. */
export const loginPath = createLoginPath();

/** The environment with the login PATH in front of its PATH: for a command about to start. */
export async function loginEnv(env: NodeJS.ProcessEnv = process.env, source: LoginPath = loginPath): Promise<NodeJS.ProcessEnv> {
  const path = mergedPath(await source.resolve(), env);
  return path === undefined ? { ...env } : { ...env, PATH: path };
}

/** The same with what is known now, for a place that cannot wait; the app reads the login PATH when it starts (`warmLoginPath`), so it is there by the first command. */
export function loginEnvNow(env: NodeJS.ProcessEnv = process.env, source: LoginPath = loginPath): NodeJS.ProcessEnv {
  const path = mergedPath(source.peek(), env);
  return path === undefined ? { ...env } : { ...env, PATH: path };
}

/** Starts reading the login PATH without waiting for it. */
export function warmLoginPath(source: LoginPath = loginPath): void {
  void source.resolve();
}
