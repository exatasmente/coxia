import { execFile } from 'node:child_process';
import { commandState } from '../../shared/runs';
import { t } from '../../shared/i18n';
import { scrubbedEnv } from '../engine/guard';
import { splitArgs } from '../engine/open/tools/bash';
import { redact } from '../errorlog-core';
import { loginEnv } from '../loginPath';

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
  /** The command could not be run at all, which says nothing about the code: not found (`enoent`), not executable (`eacces`), or it ended with the shell's code for either (126, 127: `exit`). */
  notRun?: 'enoent' | 'eacces' | 'exit';
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

/** A runner that starts each command with the environment `env` gives, cleaned of credentials. */
export function createCommandRunner(env: () => Promise<NodeJS.ProcessEnv>): CommandRunner {
  return async (cwd, command, o) => {
    const started = Date.now();
    let argv: string[];
    try {
      argv = splitArgs(command);
    } catch {
      return { command, exitCode: null, timedOut: false, output: '', ms: 0 };
    }
    const [file, ...args] = argv;
    if (!file) return { command, exitCode: null, timedOut: false, output: '', ms: 0 };
    const environment = scrubbedEnv(await env());
    return new Promise((resolve) => {
      execFile(file, args, { cwd, env: environment, timeout: o.timeoutMs, maxBuffer: 16 * 1024 * 1024, signal: o.signal }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; signal?: string | null }) | null;
        const timedOut = !!e?.killed && e.signal === 'SIGTERM' && Date.now() - started >= o.timeoutMs - 50;
        const code: unknown = e?.code;
        const exitCode: number | null = !e ? 0 : typeof code === 'number' ? code : null;
        const text = [String(stdout), String(stderr)].filter((x) => x.trim()).join('\n');
        const notRun = code === 'ENOENT' ? 'enoent' : code === 'EACCES' ? 'eacces' : !timedOut && (exitCode === 126 || exitCode === 127) ? 'exit' : undefined;
        resolve({ command, exitCode, timedOut, ...(notRun ? { notRun } : {}), output: redact(tail(text)), ms: Date.now() - started });
      });
    });
  };
}

/** The real one: the commands find what the person's own shell finds (the PATH of their login shell goes in front of the app's). */
export const runCommand: CommandRunner = createCommandRunner(() => loginEnv());

/** Runs the commands one after the other and does not stop at a failure: QA reads all of it. Stops when the signal does. */
export async function runCommands(commands: string[], cwd: string, run: CommandRunner, signal?: AbortSignal): Promise<CommandResult[]> {
  const out: CommandResult[] = [];
  for (const command of commands) {
    if (signal?.aborted) break;
    out.push(await run(cwd, command, { signal, timeoutMs: COMMAND_TIMEOUT_MS }));
  }
  return out;
}

/** What a result is, in a line, for the thread and the record: the command and how it ended. A command that could not run is not a failure of the code. */
export const outcomeOf = (r: Pick<CommandResult, 'exitCode' | 'timedOut' | 'notRun'>): 'ok' | 'failed' | 'timeout' | 'not-run' => (r.notRun ? 'not-run' : commandState(r));

/** The commands of a pass that could not run, each with why in a few words: for the thread, so the person sees it was the environment and not the code. */
export function notRunReport(results: CommandResult[]): { list: string; count: number } | null {
  const missed = results.filter((r) => outcomeOf(r) === 'not-run' && !r.timedOut);
  if (!missed.length) return null;
  const why = (r: CommandResult): string => {
    const tool = r.command.trim().split(/\s+/)[0] ?? r.command;
    if (r.notRun === 'enoent') return t('main.runner.qa.reason.missing', { tool });
    if (r.notRun === 'eacces') return t('main.runner.qa.reason.denied', { tool });
    // The shell's own words ("vitest: not found") say which tool the script could not find.
    const line = r.output.split('\n').map((l) => l.trim()).filter(Boolean).reverse().find((l) => /not found|no such file|permission denied|cannot execute/i.test(l));
    return line ? t('main.runner.qa.reason.output', { line: line.slice(0, 160) }) : t('main.runner.qa.reason.unknown');
  };
  return { list: missed.map((r) => `${r.command}: ${why(r)}`).join('; '), count: missed.length };
}
