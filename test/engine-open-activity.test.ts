import { describe, expect, it } from 'vitest';
import { skillTool } from '../src/main/engine/open/context';
import * as bash from '../src/main/engine/open/tools/bash';
import * as read from '../src/main/engine/open/tools/read';
import * as search from '../src/main/engine/open/tools/search';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import * as write from '../src/main/engine/open/tools/write';
import { CONFIRM_TOOL, HANDOFF_TOOL, screenToolImpls, type ScreenToolset } from '../src/main/browser/engineTool';
import { shellToolImpl, viewImageToolImpl } from '../src/main/sandbox/engineTool';
import type { SandboxSession } from '../src/main/sandbox/session';
import { vcsReadToolImpl } from '../src/main/vcs/engineTool';
import { ACTIVITIES } from '../src/shared/config/types';

// A tool without an activity leaves its turn to the role's own list. That is right for an MCP tool, the evidence, release and attachment tools, and wrong by
// accident for a tool someone forgot: this lists the tools the app ships with a kind of work and holds each to its tag.
const isTool = (v: unknown): v is ToolImpl => typeof v === 'object' && v !== null && 'parameters' in v && typeof (v as ToolImpl).run === 'function';
const exported = (m: Record<string, unknown>): ToolImpl[] => Object.values(m).filter(isTool);

describe('the activity of the tools', () => {
  it('every file, search and command tool of the engine carries one', () => {
    const tools = [...exported(read), ...exported(search), ...exported(write), ...exported(bash)];
    expect(tools.map((t) => t.name).sort()).toEqual(['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write']);
    for (const t of tools) expect(ACTIVITIES, t.name).toContain(t.activity);
  });

  it('reads and searches explore, writes and edits edit, commands shell', () => {
    const by = Object.fromEntries([...exported(read), ...exported(search), ...exported(write), ...exported(bash)].map((t) => [t.name, t.activity]));
    expect(by).toEqual({ Read: 'explore', Grep: 'explore', Glob: 'explore', Write: 'edit', Edit: 'edit', Bash: 'shell' });
    expect(bash.bashToolFor(['git status']).activity).toBe('shell');
    expect(skillTool([]).activity).toBe('explore');
  });

  it('the app\'s tools carry theirs: the shell is shell, the code host read explores, the picture and the whole screen are screen', () => {
    const session = {} as SandboxSession;
    expect(shellToolImpl(session).activity).toBe('shell');
    expect(viewImageToolImpl(session).activity).toBe('screen');
    expect(vcsReadToolImpl(() => ({}) as never).activity).toBe('explore');
    const set: ScreenToolset = {
      browser: { tools: () => [{ name: 'browser_click', kind: 'act', description: 'x', properties: {}, required: [] }], run: async () => ({ text: '', images: [], isError: false }) } as never,
      confirm: (async () => ({ answer: 'yes' })) as never,
      handoff: { request: async () => 'done', active: () => false } as never,
    };
    const impls = screenToolImpls(set);
    expect(impls.map((t) => t.name)).toEqual(['browser_click', CONFIRM_TOOL.name, HANDOFF_TOOL.name]);
    for (const t of impls) expect(t.activity, t.name).toBe('screen');
  });
});
