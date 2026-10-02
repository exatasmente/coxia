// Grep and Glob over node fs, with ripgrep when it is installed. Both skip secret files while walking, and answer in the same
// response shape as the Claude tools so the shared PostToolUse redaction hook applies to them unchanged.
import { execFile } from 'node:child_process';
import { type Dirent, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { isBinary, confine } from './read';
import { type ToolContext, type ToolImpl, ToolError, clip } from './types';
import { t } from '../../../../shared/i18n';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'dist', 'out', '__pycache__', 'vendor']);
const MAX_WALK_FILES = 30_000;

export function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) re += '\\{';
      else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(',')
          .map((p) => globToRegex(p).source.slice(1, -1))
          .join('|')})`;
        i = end;
      }
    } else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end < 0) re += '\\[';
      else {
        re += `[${glob.slice(i + 1, end).replace(/^!/, '^')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|\\/]/g, (m) => (m === '/' ? '/' : `\\${m}`));
  }
  return new RegExp(`^${re}$`);
}

// A glob with no slash matches the file name anywhere below, like ripgrep's --glob.
function globMatcher(glob: string): (relPath: string) => boolean {
  const re = globToRegex(glob.startsWith('/') ? glob.slice(1) : glob);
  const named = !glob.includes('/');
  return (rel) => (named ? re.test(rel.split('/').pop() ?? rel) : re.test(rel));
}

interface Walked {
  path: string;
  rel: string;
}

function walk(base: string, ctx: ToolContext, limit = MAX_WALK_FILES): Walked[] {
  const out: Walked[] = [];
  const stack = [base];
  while (stack.length && out.length < limit) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !ctx.isSecret(full)) stack.push(full);
      } else if (e.isFile() && !ctx.isSecret(full)) out.push({ path: full, rel: relative(base, full).split(sep).join('/') });
    }
  }
  return out;
}

export const globTool: ToolImpl = {
  name: 'Glob',
  // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
  description: 'Finds files by glob pattern (for example "**/*.ts" or "src/**/*.{js,ts}"), newest first. Searches the working directory unless path is given.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
      pattern: { type: 'string', description: 'Glob pattern' },
      // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
      path: { type: 'string', description: 'Directory to search (default: the working directory)' },
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    if (typeof input.pattern !== 'string' || !input.pattern) throw new ToolError(t('main.engine.text.search.noPattern'));
    const base = input.path ? confine(input.path, ctx) : confine(ctx.cwd, ctx);
    if (!statSafe(base)?.isDirectory()) throw new ToolError(t('main.engine.text.search.noDir', { path: String(input.path ?? ctx.cwd) }));
    const match = globMatcher(input.pattern.startsWith('/') ? relative(base, input.pattern) : input.pattern);
    const hits = walk(base, ctx)
      .filter((w) => match(w.rel))
      .map((w) => ({ path: w.path, mtime: statSafe(w.path)?.mtimeMs ?? 0 }))
      .sort((a, b) => b.mtime - a.mtime);
    const filenames = hits.slice(0, 100).map((h) => h.path);
    return {
      response: { filenames, numFiles: filenames.length, truncated: hits.length > 100 },
      render: (r) => renderFiles(r, ctx.outputMax),
    };
  },
};

function statSafe(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

function renderFiles(response: unknown, max: number): string {
  const r = response as { filenames?: unknown[]; truncated?: boolean };
  const names = (r.filenames ?? []).map(String);
  if (!names.length) return t('main.engine.text.search.noFiles');
  return clip(names.join('\n') + (r.truncated ? `\n${t('main.engine.text.search.cut')}` : ''), max);
}

// ---------------------------------------------------------------------------------------------------------------------

type Mode = 'content' | 'files_with_matches' | 'count';

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode: Mode;
  ignoreCase: boolean;
  lineNumbers: boolean;
  before: number;
  after: number;
  headLimit: number;
}

function parseInput(input: Record<string, unknown>): GrepInput {
  if (typeof input.pattern !== 'string' || !input.pattern) throw new ToolError(t('main.engine.text.search.noPattern'));
  const mode = (['content', 'files_with_matches', 'count'] as const).find((m) => m === input.output_mode) ?? 'files_with_matches';
  const ctxN = Number(input['-C'] ?? input.context) || 0;
  return {
    pattern: input.pattern,
    path: typeof input.path === 'string' ? input.path : undefined,
    glob: typeof input.glob === 'string' ? input.glob : undefined,
    output_mode: mode,
    ignoreCase: input['-i'] === true,
    lineNumbers: input['-n'] !== false,
    before: Math.min(Number(input['-B']) || ctxN, 20),
    after: Math.min(Number(input['-A']) || ctxN, 20),
    headLimit: Number(input.head_limit) > 0 ? Number(input.head_limit) : 250,
  };
}

let rgAvailable: Promise<boolean> | null = null;
export function resetRipgrepProbe(): void {
  rgAvailable = null;
}

function hasRipgrep(): Promise<boolean> {
  rgAvailable ??= new Promise((resolve) => execFile('rg', ['--version'], { timeout: 5000 }, (err) => resolve(!err)));
  return rgAvailable;
}

function runRg(args: string[], cwd: string, signal?: AbortSignal): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile('rg', args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 30_000, signal }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 2) : 0;
      if (err && code !== 1) return reject(new ToolError(t('main.engine.text.search.rgFailed', { detail: String(stderr || err.message).slice(0, 300) })));
      resolve({ stdout, code });
    });
  });
}

async function grepWithRg(g: GrepInput, base: string, ctx: ToolContext): Promise<Record<string, unknown>> {
  const args = ['--hidden', '--no-messages', '--max-columns', '500', '--max-filesize', '2M', '--glob', '!.git/'];
  for (const sg of ctx.secretGlobs) if (!sg.startsWith('~/')) args.push('--iglob', `!${sg}`);
  if (g.glob) args.push('--glob', g.glob);
  if (g.ignoreCase) args.push('-i');
  if (g.output_mode === 'files_with_matches') args.push('-l');
  else if (g.output_mode === 'count') args.push('-c', '--with-filename');
  else {
    args.push('--with-filename', '--no-heading', '--color', 'never');
    if (g.lineNumbers) args.push('-n');
    if (g.before) args.push('-B', String(g.before));
    if (g.after) args.push('-A', String(g.after));
  }
  args.push('-e', g.pattern, '--', base);
  const { stdout } = await runRg(args, ctx.cwd, ctx.signal);
  return shape(g, stdout.split('\n').filter(Boolean), ctx);
}

function shape(g: GrepInput, lines: string[], ctx: ToolContext): Record<string, unknown> {
  // The shared redaction hook is the second layer; this is the first one.
  const kept = lines.filter((l) => {
    for (const m of l.matchAll(/[:-]\d+[:-]/g)) {
      const file = l.slice(0, m.index);
      if (!/\s/.test(file) && ctx.isSecret(file)) return false;
    }
    return g.output_mode !== 'files_with_matches' || !ctx.isSecret(l);
  });
  const limited = kept.slice(0, g.headLimit);
  if (g.output_mode === 'files_with_matches') {
    return { mode: g.output_mode, filenames: limited, numFiles: limited.length, appliedLimit: kept.length > limited.length ? g.headLimit : undefined };
  }
  return { mode: g.output_mode, content: limited.join('\n'), numLines: limited.length, numFiles: 0, appliedLimit: kept.length > limited.length ? g.headLimit : undefined };
}

async function grepWithJs(g: GrepInput, base: string, ctx: ToolContext): Promise<Record<string, unknown>> {
  let re: RegExp;
  try {
    re = new RegExp(g.pattern, g.ignoreCase ? 'i' : '');
  } catch (e) {
    throw new ToolError(t('main.engine.text.search.badRegex', { detail: (e as Error).message }));
  }
  const globOk = g.glob ? globMatcher(g.glob) : () => true;
  const files = statSafe(base)?.isFile() ? [{ path: base, rel: base }] : walk(base, ctx);
  const out: string[] = [];
  for (const f of files) {
    if (out.length >= g.headLimit * 4) break;
    if (!globOk(f.rel)) continue;
    const st = statSafe(f.path);
    if (!st || st.size > 2 * 1024 * 1024) continue;
    try {
      if (isBinary(f.path)) continue;
      const lines = (await readFile(f.path, 'utf8')).split('\n');
      const hits = lines.flatMap((l, i) => (re.test(l) ? [i] : []));
      if (!hits.length) continue;
      if (g.output_mode === 'files_with_matches') out.push(f.path);
      else if (g.output_mode === 'count') out.push(`${f.path}:${hits.length}`);
      else {
        const shown = new Set<number>();
        for (const h of hits) for (let i = Math.max(0, h - g.before); i <= Math.min(lines.length - 1, h + g.after); i++) shown.add(i);
        for (const i of [...shown].sort((a, b) => a - b)) {
          const sep = hits.includes(i) ? ':' : '-';
          out.push(g.lineNumbers ? `${f.path}${sep}${i + 1}${sep}${lines[i]}` : `${f.path}${sep}${lines[i]}`);
        }
      }
    } catch {
      continue;
    }
  }
  return shape(g, out, ctx);
}

export const grepTool: ToolImpl = {
  name: 'Grep',
  description:
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    'Searches file contents with a regular expression (ripgrep syntax). output_mode: "files_with_matches" (default, file names), "content" (matching lines with path:line:text) ' +
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    'or "count". Narrow with path and glob (for example "*.ts"). -i ignores case, -A/-B/-C add context lines, head_limit caps the lines returned.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
      pattern: { type: 'string', description: 'Regular expression' },
      path: { type: 'string', description: 'File or directory to search (default: the working directory)' },
      glob: { type: 'string', description: 'Only files matching this glob' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
      '-i': { type: 'boolean', description: 'Ignore case' },
      '-n': { type: 'boolean', description: 'Show line numbers (content mode, default true)' },
      '-A': { type: 'integer', description: 'Lines after each match' },
      '-B': { type: 'integer', description: 'Lines before each match' },
      '-C': { type: 'integer', description: 'Lines around each match' },
      head_limit: { type: 'integer', description: 'Maximum lines (default 250)' },
      // i18n-ignore-end
    },
    required: ['pattern'],
  },
  async run(input, ctx) {
    const g = parseInput(input);
    const base = confine(g.path ?? ctx.cwd, ctx);
    if (!statSafe(base)) throw new ToolError(t('main.engine.text.search.noPath', { path: String(g.path) }));
    const useRg = ctx.ripgrep === 'auto' && (await hasRipgrep());
    const response = useRg ? await grepWithRg(g, base, ctx) : await grepWithJs(g, base, ctx);
    return { response, render: (r) => renderGrep(r, g.output_mode, ctx.outputMax) };
  },
};

function renderGrep(response: unknown, mode: Mode, max: number): string {
  const r = response as { filenames?: unknown[]; content?: unknown; appliedLimit?: number };
  const body = mode === 'files_with_matches' ? (r.filenames ?? []).map(String).join('\n') : typeof r.content === 'string' ? r.content : '';
  if (!body) return t('main.engine.text.search.noMatch');
  return clip(body + (r.appliedLimit ? `\n… (limitado a ${r.appliedLimit} linhas; refine a busca)` : ''), max);
}
