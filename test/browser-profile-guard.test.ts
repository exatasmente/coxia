import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, SECRET_READ_DENY, noSecrets, redactSecretResults, secretPath, withoutSecretFiles } from '../src/main/agents';
import { ATAS } from '../src/main/env';
import { browserRoot, ensureProfile } from '../src/main/browser/profile';
import { readTool } from '../src/main/engine/open/tools/read';
import { globTool, grepTool } from '../src/main/engine/open/tools/search';
import type { ToolContext, ToolImpl } from '../src/main/engine/open/tools/types';

// The logged-in browsers of the agents are in the workspace's data folder, and an agent with no shell works from that very folder: its Read, Grep and Glob must never
// reach them, through either engine, with a path or with none. The profile files' names (`Cookies`, `Login Data`, `Local State`) match none of the secret-file names, so
// the folder itself is what is refused.

const NEEDLE = 'session-token-value-1234';
let profile: string;
let ctx: ToolContext;

beforeAll(() => {
  profile = ensureProfile(ATAS, 'scout');
  mkdirSync(join(profile, 'Default', 'Local Storage'), { recursive: true });
  writeFileSync(join(profile, 'Default', 'Cookies'), NEEDLE);
  writeFileSync(join(profile, 'Default', 'Login Data'), NEEDLE);
  writeFileSync(join(profile, 'Local State'), `{"needle":"${NEEDLE}"}`);
  writeFileSync(join(profile, 'Default', 'Local Storage', 'leveldb.txt'), NEEDLE);
  // What an agent with no shell may read in its working folder: its own notes, and a note that is a link into the profile.
  mkdirSync(join(ATAS, 'memory'), { recursive: true });
  writeFileSync(join(ATAS, 'memory', 'notes.md'), `a note with ${NEEDLE} in it\n`);
  mkdirSync(join(ATAS, 'browser-notes'), { recursive: true });
  writeFileSync(join(ATAS, 'browser-notes', 'plan.md'), `a plan with ${NEEDLE} in it\n`);
  symlinkSync(join(profile, 'Default', 'Cookies'), join(ATAS, 'memory', 'innocent.txt'));
  ctx = { cwd: ATAS, roots: [ATAS], isSecret: (p) => secretPath(p, ATAS), secretGlobs: SECRET_GLOBS, outputMax: 30_000, env: { PATH: process.env.PATH ?? '' }, bashPrefixes: [], ripgrep: 'auto' };
});

afterAll(() => {
  rmSync(browserRoot(ATAS), { recursive: true, force: true });
  rmSync(join(ATAS, 'memory'), { recursive: true, force: true });
  rmSync(join(ATAS, 'browser-notes'), { recursive: true, force: true });
});

async function run(tool: ToolImpl, input: Record<string, unknown>, c: ToolContext = ctx): Promise<string> {
  const r = await tool.run(input, c);
  return r.render(r.response);
}

describe('the rule shared by both engines', () => {
  it('refuses the folder, what is under it and what leads there, however the path is written', () => {
    expect(secretPath(browserRoot(ATAS))).toBe(true);
    expect(secretPath(profile)).toBe(true);
    expect(secretPath(join(profile, 'Default', 'Cookies'))).toBe(true);
    expect(secretPath(join(profile, 'Default', 'does-not-exist-yet'))).toBe(true);
    expect(secretPath(join('browser', 'scout', 'Local State'), ATAS)).toBe(true);
    expect(secretPath(join('memory', 'innocent.txt'), ATAS)).toBe(true);
    expect(secretPath(join(ATAS, 'memory', 'notes.md'))).toBe(false);
    expect(secretPath(join(ATAS, 'browser-notes', 'plan.md'))).toBe(false);
  });

  it('puts the folder among the SDK deny rules and the globs of the open engine, as an absolute path', () => {
    const glob = SECRET_GLOBS.find((g) => g.startsWith('//') && g.endsWith('/browser/**'));
    expect(glob).toBeDefined();
    expect(SECRET_READ_DENY).toContain(`Read(${glob})`);
  });
});

describe('the Claude SDK path', () => {
  const pre = (tool_name: string, tool_input: Record<string, unknown>) => (noSecrets as (i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<Record<string, unknown>>)({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: ATAS }, undefined, { signal: new AbortController().signal });
  const denied = async (tool: string, input: Record<string, unknown>) => ((await pre(tool, input)).hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny';

  it('denies a Read, a Grep and a Glob that name the folder or a file in it', async () => {
    expect(await denied('Read', { file_path: join(profile, 'Default', 'Cookies') })).toBe(true);
    expect(await denied('Read', { file_path: 'browser/scout/Local State' })).toBe(true);
    expect(await denied('Grep', { pattern: 'token', path: 'browser' })).toBe(true);
    expect(await denied('Grep', { pattern: 'token', path: browserRoot(ATAS) })).toBe(true);
    expect(await denied('Glob', { pattern: 'browser/**/*' })).toBe(true);
    expect(await denied('Read', { file_path: join(ATAS, 'memory', 'notes.md') })).toBe(false);
    expect(await denied('Grep', { pattern: 'token', path: 'browser-notes' })).toBe(false);
  });

  it('cuts the profile out of a Grep or Glob with no path, whatever the search walked', async () => {
    const post = (response: unknown) => withoutSecretFiles(response, ATAS) as { filenames?: string[]; content?: string } | null;
    const cookies = join(profile, 'Default', 'Cookies');
    const notes = join(ATAS, 'memory', 'notes.md');
    expect(post({ filenames: [cookies, notes, join(ATAS, 'memory', 'innocent.txt')], numFiles: 3 })?.filenames).toEqual([notes]);
    expect(post({ content: `${cookies}:1:${NEEDLE}\n${notes}:1:a note\n${join('browser', 'scout', 'Local State')}:1:${NEEDLE}` })?.content).toBe(`${notes}:1:a note`);
    const hook = (await (redactSecretResults as (i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<Record<string, unknown>>)({ hook_event_name: 'PostToolUse', tool_name: 'Grep', tool_response: { filenames: [cookies] }, cwd: ATAS }, undefined, { signal: new AbortController().signal })) as { hookSpecificOutput?: { updatedToolOutput?: { filenames: string[] } } };
    expect(hook.hookSpecificOutput?.updatedToolOutput?.filenames).toEqual([]);
  });
});

describe('the open engine path', () => {
  const offCtx = (): ToolContext => ({ ...ctx, ripgrep: 'off' });

  it('finds nothing of the profile with a Grep that names no path, from the workspace folder, with ripgrep and without', async () => {
    for (const c of [ctx, offCtx()]) {
      const files = await run(grepTool, { pattern: NEEDLE }, c);
      expect(files).toContain(join(ATAS, 'memory', 'notes.md'));
      expect(files).toContain(join(ATAS, 'browser-notes', 'plan.md'));
      expect(files).not.toMatch(/Cookies|Login Data|Local State|leveldb|innocent|\/browser\/scout/);
      const content = await run(grepTool, { pattern: NEEDLE, output_mode: 'content' }, c);
      expect(content).toContain('a note with');
      expect(content).not.toMatch(/Cookies|Login Data|Local State|leveldb|innocent|\/browser\/scout/);
      const counts = await run(grepTool, { pattern: NEEDLE, output_mode: 'count' }, c);
      expect(counts).toContain(join(ATAS, 'memory', 'notes.md'));
      expect(counts).not.toMatch(/Cookies|Login Data|Local State|leveldb|innocent|\/browser\/scout/);
    }
  });

  it('finds no file of the profile with a Glob that names no folder, and refuses to search or read inside it', async () => {
    for (const c of [ctx, offCtx()]) {
      const listed = await run(globTool, { pattern: '**/*' }, c);
      expect(listed).toContain(join(ATAS, 'memory', 'notes.md'));
      expect(listed).not.toMatch(/Cookies|Login Data|Local State|leveldb|innocent|\/browser\/scout/);
    }
    await expect(run(readTool, { file_path: join(profile, 'Default', 'Cookies') })).rejects.toThrow();
    await expect(run(readTool, { file_path: 'browser/scout/Local State' })).rejects.toThrow();
    await expect(run(readTool, { file_path: 'memory/innocent.txt' })).rejects.toThrow();
    // Searching inside the folder finds nothing: the walk does not enter it.
    expect(await run(grepTool, { pattern: NEEDLE, path: 'browser' })).not.toContain(NEEDLE);
    expect(await run(grepTool, { pattern: NEEDLE, path: 'browser', output_mode: 'content' }, offCtx())).not.toContain(NEEDLE);
    expect(await run(readTool, { file_path: 'memory/notes.md' })).toContain(NEEDLE);
  });
});
