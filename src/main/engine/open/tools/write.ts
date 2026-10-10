// Write and Edit for an agent that may change files, in the shape of the Claude SDK's tools of the same names. Both stay inside `ctx.writeRoot`
// (the run's worktree) and ask the same guard the SDK's hook asks, so the engines refuse the same paths. The hook runs first; this check is the
// second layer, for the day a hook is wired wrongly.
import { constants } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { anchored, checkPath } from '../../guard';
import { type ToolContext, type ToolImpl, ToolError } from './types';
import { t } from '../../../../shared/i18n';

const MAX_WRITE = 2 * 1024 * 1024;

function confined(input: unknown, ctx: ToolContext): string {
  if (!ctx.writeRoot) throw new ToolError(t('main.engine.text.write.readOnly'));
  // A write folder below the working directory: the path is the working directory's, as the SDK's tool reads it too.
  const narrow = ctx.writeRoot !== ctx.cwd;
  const check = checkPath(ctx.writeRoot, narrow ? anchored(ctx.cwd, input) : input, {
    isSecret: ctx.isSecret,
    ...(narrow ? { fence: ctx.cwd } : {}),
    reserved: ctx.writeReserved,
    writeAllow: ctx.writeAllow,
    anywhere: ctx.writeAnywhere && !narrow,
  });
  if (!check.ok) throw new ToolError(t(`main.engine.text.write.denied.${check.code}`));
  return check.path;
}

// O_NOFOLLOW: a link made between the check and the write is refused by the system instead of followed.
async function writeFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

export const writeTool: ToolImpl = {
  name: 'Write', // i18n-ignore: the tool's name
  activity: 'edit',
  // i18n-ignore-next-line: prompt and tool texts the open engine sends the model: English by design
  description: 'Writes a file inside the working directory, creating it (and its folders) or replacing it. file_path is relative to the working directory or absolute inside it.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
      file_path: { type: 'string', description: 'Path of the file to write' },
      content: { type: 'string', description: 'The whole content of the file' },
      // i18n-ignore-end
    },
    required: ['file_path', 'content'],
  },
  async run(input, ctx) {
    const path = confined(input.file_path, ctx);
    const content = typeof input.content === 'string' ? input.content : '';
    if (content.length > MAX_WRITE) throw new ToolError(t('main.engine.text.write.tooBig', { max: MAX_WRITE }));
    await writeFile(path, content);
    return { response: { type: 'create', filePath: path, bytes: Buffer.byteLength(content) }, render: (r) => t('main.engine.text.write.done', { path: String((r as { filePath?: string }).filePath ?? path), bytes: Buffer.byteLength(content) }) };
  },
};

export const editTool: ToolImpl = {
  name: 'Edit', // i18n-ignore: the tool's name
  activity: 'edit',
  // i18n-ignore-next-line: prompt and tool texts the open engine sends the model: English by design
  description: 'Replaces text in a file inside the working directory. old_string must appear exactly once unless replace_all is true.',
  parameters: {
    type: 'object',
    properties: {
      // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
      file_path: { type: 'string', description: 'Path of the file to change' },
      old_string: { type: 'string', description: 'The text to replace' },
      new_string: { type: 'string', description: 'The text to put in its place' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence' },
      // i18n-ignore-end
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  async run(input, ctx) {
    const path = confined(input.file_path, ctx);
    const from = String(input.old_string ?? '');
    const to = String(input.new_string ?? '');
    if (!from) throw new ToolError(t('main.engine.text.write.emptyOld'));
    if (from === to) throw new ToolError(t('main.engine.text.write.same'));
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      throw new ToolError(t('main.engine.text.read.noFile', { path: String(input.file_path), cwd: ctx.cwd }));
    }
    const count = text.split(from).length - 1;
    if (!count) throw new ToolError(t('main.engine.text.write.notFound'));
    if (count > 1 && input.replace_all !== true) throw new ToolError(t('main.engine.text.write.ambiguous', { count }));
    const next = input.replace_all === true ? text.split(from).join(to) : text.replace(from, () => to);
    if (next.length > MAX_WRITE) throw new ToolError(t('main.engine.text.write.tooBig', { max: MAX_WRITE }));
    await writeFile(path, next);
    return { response: { type: 'update', filePath: path, replaced: input.replace_all === true ? count : 1 }, render: () => t('main.engine.text.write.edited', { path, count: input.replace_all === true ? count : 1 }) };
  },
};
