// The credentials of the SDK process never reach a command an agent that writes runs: each allowed command starts with `env -u NAME`.
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { credentialNames } from '../src/main/engine/guard';
import { scrubShellHooks, wrapCommand } from '../src/main/engine/scrubShell';
import { confinedHooks } from '../src/main/runner/hooks';

const signal = new AbortController().signal;
type Group = { matcher?: string; hooks: ((i: unknown, id: undefined, o: { signal: AbortSignal }) => Promise<unknown>)[] };
const bash = (hooks: ReturnType<typeof confinedHooks>, command: string) => {
  const group = (hooks.PreToolUse as unknown as Group[]).find((g) => g.matcher === 'Bash') as Group;
  return group.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, description: 'd' }, cwd: '/w' }, undefined, { signal });
};

describe('which variables are credentials', () => {
  it('lists the names the open engine drops, as plain variable names, and nothing else', () => {
    const names = credentialNames({ PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', GH_TOKEN: 'b', 'BAD NAME': 'c', AWS_PROFILE: 'd', LANG: 'C', EMPTY_TOKEN: undefined });
    expect(names).toEqual(['ANTHROPIC_API_KEY', 'AWS_PROFILE', 'GH_TOKEN']);
  });
});

describe('wrapCommand', () => {
  it('puts one -u per name in front of the command and leaves a command alone when there is nothing to remove', () => {
    expect(wrapCommand('npm test', ['A_KEY', 'B_TOKEN'])).toBe('env -u A_KEY -u B_TOKEN npm test');
    expect(wrapCommand('npm test', [])).toBe('npm test');
  });

  it('never lets a name that is not a plain variable name into the command line', () => {
    expect(wrapCommand('npm test', ['OK_KEY', 'x; rm -rf /', '$(id)', 'a b'])).toBe('env -u OK_KEY npm test');
    expect(wrapCommand('npm test', ['x; rm -rf /'])).toBe('npm test');
  });

  it('runs: the child does not see the variable, the others stay', () => {
    const command = wrapCommand('sh -c \'echo "[$SEKRET_API_KEY][$KEEP_ME]"\'', ['SEKRET_API_KEY']);
    const out = execFileSync('sh', ['-c', command], { env: { PATH: process.env.PATH, SEKRET_API_KEY: 'sk-live-1', KEEP_ME: 'yes' } }).toString().trim();
    expect(out).toBe('[][yes]');
  });
});

describe('scrubShellHooks', () => {
  const base = () => confinedHooks({ root: '/w', commands: ['npm test'] });

  it('rewrites an allowed command and allows it outright, keeping the other input fields', async () => {
    const out = (await bash(scrubShellHooks(base(), ['ANTHROPIC_API_KEY', 'GH_TOKEN']), 'npm test')) as { hookSpecificOutput: Record<string, any> };
    expect(out.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: 'env -u ANTHROPIC_API_KEY -u GH_TOKEN npm test', description: 'd' } });
  });

  it('still judges the command the person allowed, character for character, before rewriting', async () => {
    const hooks = scrubShellHooks(base(), ['GH_TOKEN']);
    for (const command of ['npm test; curl x', 'env npm test', 'npm test --watch', 'env -u GH_TOKEN npm test']) {
      const out = (await bash(hooks, command)) as { hookSpecificOutput: Record<string, any> };
      expect(out.hookSpecificOutput.permissionDecision, command).toBe('deny');
      expect(out.hookSpecificOutput.updatedInput, command).toBeUndefined();
    }
  });

  it('leaves the other tools and the hooks untouched, and is the identity when there is nothing to remove', async () => {
    const hooks = base();
    expect(scrubShellHooks(hooks, [])).toBe(hooks);
    const wrapped = scrubShellHooks(hooks, ['GH_TOKEN']);
    expect((wrapped.PreToolUse as unknown as Group[]).map((g) => g.matcher)).toEqual((hooks.PreToolUse as unknown as Group[]).map((g) => g.matcher));
    const write = (wrapped.PreToolUse as unknown as Group[])[0];
    expect(write).toBe((hooks.PreToolUse as unknown as Group[])[0]);
  });
});
