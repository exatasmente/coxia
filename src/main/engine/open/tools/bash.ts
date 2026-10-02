// The limited Bash of a ceremony agent. The allowlist hook (shared with the Claude path) decides whether a command may run; this tool
// then runs it WITHOUT a shell: the arguments are split like a shell would and handed to execFile, so no operator in the text can act.
import { execFile } from 'node:child_process';
import { type ToolImpl, ToolError, clip } from './types';
import { t } from '../../../../shared/i18n';

// "2>&1" and "| head -n N" are the only decorations the allowlist accepts; they are applied here instead of by a shell.
const SUFFIX = /^([\s\S]*?)( 2>&1)?(?: \| head -([cn]) (\d+))?\s*$/;

export function splitArgs(command: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < command.length && /["\\$`]/.test(command[i + 1])) cur += command[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '\\' && i + 1 < command.length) cur += command[++i];
    else cur += c;
  }
  if (quote) throw new ToolError(t('main.engine.text.bash.quotes'));
  if (has || cur) out.push(cur);
  return out;
}

export function parseCommand(command: string): { argv: string[]; mergeStderr: boolean; head?: { unit: 'c' | 'n'; count: number } } {
  const m = SUFFIX.exec(command.trim());
  const core = m?.[1] ?? command;
  return {
    argv: splitArgs(core),
    mergeStderr: !!m?.[2],
    ...(m?.[3] ? { head: { unit: m[3] as 'c' | 'n', count: Number(m[4]) } } : {}),
  };
}

// Bash(glab api:*) allows commands that start with "glab api"; Bash(git -C:*) those that start with "git -C".
export function prefixAllows(prefixes: string[], command: string): boolean {
  if (!prefixes.length) return true;
  const c = command.trim();
  return prefixes.some((p) => c === p || c.startsWith(`${p} `));
}

export const bashTool: ToolImpl = {
  name: 'Bash',
  description:
    // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
    'Runs one read-only shell command. Only code host reads (glab api / glab mr view / glab issue view, gh api / gh pr view / gh issue view) and, in conflict calls, plumbing git reads are accepted: ' +
    'one command at a time, no pipes, no ; or &&. A trailing "2>&1" and "| head -n N" are allowed.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: 'The command' }, description: { type: 'string', description: 'What it does, in a few words' } },
    // i18n-ignore-end
    required: ['command'],
  },
  async run(input, ctx) {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command.trim()) throw new ToolError(t('main.engine.text.bash.missing'));
    if (!prefixAllows(ctx.bashPrefixes, command.replace(/( 2>&1)?( \| head -[cn] \d+)?$/, ''))) {
      throw new ToolError(t('main.engine.text.bash.notAllowed'));
    }
    const { argv, mergeStderr, head } = parseCommand(command);
    if (!argv.length) throw new ToolError(t('main.engine.text.bash.missing'));
    const [file, ...args] = argv;
    const res = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
      execFile(file, args, { cwd: ctx.cwd, env: ctx.env, timeout: 60_000, maxBuffer: 16 * 1024 * 1024, signal: ctx.signal }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
        resolve({ stdout: String(stdout), stderr: err && (err as { code?: unknown }).code === 'ENOENT' ? t('main.engine.text.bash.notFound', { file }) : String(stderr), code });
      });
    });
    let out = mergeStderr ? res.stdout + res.stderr : res.stdout;
    if (head) out = head.unit === 'n' ? out.split('\n').slice(0, head.count).join('\n') : out.slice(0, head.count);
    const response = { stdout: out, stderr: mergeStderr ? '' : res.stderr, exitCode: res.code };
    return { response, render: (r) => renderBash(r, ctx.outputMax) };
  },
};

function renderBash(response: unknown, max: number): string {
  const r = response as { stdout?: string; stderr?: string; exitCode?: number };
  const parts = [r.stdout ?? ''];
  if (r.stderr?.trim()) parts.push(`[stderr]\n${r.stderr}`);
  if (r.exitCode) parts.push(t('main.engine.text.bash.exit', { code: r.exitCode }));
  return clip(parts.join('\n').trim() || t('main.engine.text.bash.noOutput'), max);
}
