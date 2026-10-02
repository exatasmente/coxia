import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentHooks, noBroadSearch } from '../src/main/agents';

type Hook = (input: unknown, id: undefined, opts: { signal: AbortController['signal'] }) => Promise<Record<string, unknown>>;

async function decide(input: Record<string, unknown>): Promise<'allow' | 'deny'> {
  const out = await (noBroadSearch as unknown as Hook)({ hook_event_name: 'PreToolUse', ...input }, undefined, { signal: new AbortController().signal });
  return (out.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny' ? 'deny' : 'allow';
}

const projects = mkdtempSync(join(tmpdir(), 'coxia-projects-'));
const single = mkdtempSync(join(tmpdir(), 'coxia-single-'));
afterAll(() => {
  rmSync(projects, { recursive: true, force: true });
  rmSync(single, { recursive: true, force: true });
});
for (const repo of ['web', 'api', 'docs']) mkdirSync(join(projects, repo, '.git'), { recursive: true });
mkdirSync(join(single, '.git'), { recursive: true });

describe('noBroadSearch', () => {
  it('sends a search over a folder of repositories back to one repository', async () => {
    expect(await decide({ tool_name: 'Glob', cwd: projects, tool_input: { pattern: '**/.gitlab-ci.yml' } })).toBe('deny');
    expect(await decide({ tool_name: 'Grep', cwd: projects, tool_input: { pattern: 'TODO' } })).toBe('deny');
    expect(await decide({ tool_name: 'Grep', cwd: projects, tool_input: { pattern: 'TODO', path: '.' } })).toBe('deny');
  });

  it('lets searches inside one repository through', async () => {
    expect(await decide({ tool_name: 'Glob', cwd: projects, tool_input: { pattern: '**/*.ts', path: join(projects, 'web') } })).toBe('allow');
    expect(await decide({ tool_name: 'Glob', cwd: projects, tool_input: { pattern: 'web/**/*.ts' } })).toBe('allow');
    expect(await decide({ tool_name: 'Grep', cwd: projects, tool_input: { pattern: 'TODO', path: 'api' } })).toBe('allow');
    expect(await decide({ tool_name: 'Grep', cwd: single, tool_input: { pattern: 'TODO' } })).toBe('allow');
  });

  it('ignores other tools and is wired for Grep and Glob', async () => {
    expect(await decide({ tool_name: 'Read', cwd: projects, tool_input: { file_path: join(projects, 'web', 'a.ts') } })).toBe('allow');
    const pre = agentHooks().PreToolUse ?? [];
    expect(pre.some((m) => m.matcher === 'Grep|Glob' && m.hooks.includes(noBroadSearch))).toBe(true);
  });
});
