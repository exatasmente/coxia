import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { type ToolContext, type ToolImpl, ToolError, clip } from './types';
import { t } from '../../../../shared/i18n';

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// The path as the tool will use it: ~ expanded, absolute against the cwd, symlinks resolved, and inside an allowed root.
export function confine(p: unknown, ctx: ToolContext): string {
  if (typeof p !== 'string' || !p) throw new ToolError(t('main.engine.text.read.missing'));
  const home = p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
  const abs = resolve(ctx.cwd, home);
  // A path that does not exist yet is judged by its closest existing parent, so a link above it still counts.
  let probe = abs;
  while (probe !== dirname(probe)) {
    try {
      statSync(probe);
      break;
    } catch {
      probe = dirname(probe);
    }
  }
  const resolved = resolve(real(probe), abs.slice(probe.length).replace(/^[\\/]/, ''));
  const roots = ctx.roots.map(real);
  if (!roots.some((r) => resolved === r || resolved.startsWith(r.endsWith(sep) ? r : r + sep))) {
    throw new ToolError(t('main.engine.text.read.outside'));
  }
  return resolved;
}

export function isBinary(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, 4096, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

const MAX_FILE = 8 * 1024 * 1024;
const LINE_MAX = 2000;

export const readTool: ToolImpl = {
  name: 'Read',
  description:
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    'Reads a text file from the local filesystem. file_path is absolute or relative to the working directory. Returns the lines numbered ("N<TAB>text"). ' +
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    'Use offset (first line, 1-based) and limit (number of lines, default 2000) to read part of a large file.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
      file_path: { type: 'string', description: 'Path of the file to read' },
      offset: { type: 'integer', description: 'First line to read (1-based)' },
      limit: { type: 'integer', description: 'Number of lines to read' },
      // i18n-ignore-end
    },
    required: ['file_path'],
  },
  async run(input, ctx) {
    const path = confine(input.file_path, ctx);
    if (ctx.isSecret(path)) throw new ToolError(t('main.engine.text.read.secret'));
    let st;
    try {
      st = statSync(path);
    } catch {
      throw new ToolError(t('main.engine.text.read.noFile', { path: String(input.file_path), cwd: ctx.cwd }));
    }
    if (st.isDirectory()) throw new ToolError(t('main.engine.text.read.directory'));
    if (st.size > MAX_FILE) throw new ToolError(t('main.engine.text.read.tooBig', { size: st.size }));
    if (isBinary(path)) throw new ToolError(t('main.engine.text.read.binary'));
    const lines = (await readFile(path, 'utf8')).split('\n');
    const offset = Math.max(1, Number(input.offset) || 1);
    const limit = Math.max(1, Math.min(Number(input.limit) || 2000, 2000));
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const text = slice.map((l, i) => `${offset + i}\t${l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l}`).join('\n');
    const more = offset - 1 + limit < lines.length ? `\n${t('main.engine.text.read.more', { count: lines.length - (offset - 1 + limit), offset: offset + limit })}` : '';
    return { response: { type: 'text', file: { filePath: path, content: text, numLines: slice.length, startLine: offset, totalLines: lines.length } }, render: (r) => renderRead(r, ctx.outputMax, more) };
  },
};

function renderRead(response: unknown, max: number, more: string): string {
  const content = (response as { file?: { content?: unknown } })?.file?.content;
  return clip(typeof content === 'string' ? content : '', max) + more;
}
