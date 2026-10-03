import { execFile } from 'node:child_process';
import { scrubbedEnv } from '../engine/guard';
import { splitArgs } from '../engine/open/tools/bash';
import { redact } from '../errorlog-core';

// The commands the workspace allows for a run (`runner.commands`, else the repository's test and typecheck scripts), run by the app itself in the run's
// worktree before QA: QA is a reader and cannot run anything, so what it verifies about behavior has to come from here. A command is one plain command run
// without a shell, with the environment cleaned of anything that looks like a credential; its output is cut to its end (where a test run says what failed)
// and masked like every text that leaves a command.

/** What one command did. `output` is the end of stdout and stderr together, already masked. */
export interface CommandResult {
  command: string;
  /** null when the command did not run to an exit (not found, stopped). */
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  ms: number;
  /** In a sandbox: its number in the stage's list (the app's commands first, then the agent's), and who ran it. */
  n?: number;
  by?: 'app' | 'agent';
}

export interface CommandOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

/** Runs one command in `cwd`. The real one is `runCommand`; tests give a fake. */
export type CommandRunner = (cwd: string, command: string, options: CommandOptions) => Promise<CommandResult>;

/** How much of a command's output QA is given: the end of it. */
export const OUTPUT_LIMIT = 6_000;
/** The longest one command may run. */
export const COMMAND_TIMEOUT_MS = 5 * 60_000;

/** The end of an output, cut at a line where it can be, with the cut said. */
export function tail(text: string, max = OUTPUT_LIMIT): string {
  const clean = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(clean.length - max);
  const at = cut.indexOf('\n');
  // i18n-ignore-next-line: a marker inside the output of a command, for a model to read
  return `[…]\n${at >= 0 && at < 400 ? cut.slice(at + 1) : cut}`;
}

export const runCommand: CommandRunner = (cwd, command, o) =>
  new Promise((resolve) => {
    const started = Date.now();
    let argv: string[];
    try {
      argv = splitArgs(command);
    } catch {
      return resolve({ command, exitCode: null, timedOut: false, output: '', ms: 0 });
    }
    const [file, ...args] = argv;
    if (!file) return resolve({ command, exitCode: null, timedOut: false, output: '', ms: 0 });
    execFile(file, args, { cwd, env: scrubbedEnv(process.env), timeout: o.timeoutMs, maxBuffer: 16 * 1024 * 1024, signal: o.signal }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }) | null;
      const timedOut = !!e?.killed && e.signal === 'SIGTERM' && Date.now() - started >= o.timeoutMs - 50;
      const exitCode = !e ? 0 : typeof e.code === 'number' ? e.code : null;
      const text = [String(stdout), String(stderr)].filter((x) => x.trim()).join('\n');
      resolve({ command, exitCode, timedOut, output: redact(tail(text)), ms: Date.now() - started });
    });
  });

/** Runs the commands one after the other and does not stop at a failure: QA reads all of it. Stops when the signal does. */
export async function runCommands(commands: string[], cwd: string, run: CommandRunner, signal?: AbortSignal): Promise<CommandResult[]> {
  const out: CommandResult[] = [];
  for (const command of commands) {
    if (signal?.aborted) break;
    out.push(await run(cwd, command, { signal, timeoutMs: COMMAND_TIMEOUT_MS }));
  }
  return out;
}

/** What a result is, in a line, for the thread and the record: the command and how it ended. */
export const outcomeOf = (r: Pick<CommandResult, 'exitCode' | 'timedOut'>): 'ok' | 'failed' | 'timeout' | 'not-run' => (r.timedOut ? 'timeout' : r.exitCode === null ? 'not-run' : r.exitCode === 0 ? 'ok' : 'failed');
