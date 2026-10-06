// A ceremony agent asks the person about a command the code does not allow, instead of being refused: the rule "allow always" proposes, which commands write
// to the code host (allowed once at most), the queue of requests, the shell hook that asks, the agent of the team the ceremony follows, and the migration.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = Record<string, unknown> | ((options: Record<string, unknown>) => Promise<void>);
let scripts: Step[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ options }: { options: Record<string, unknown> }) => {
    const script = scripts.shift() ?? [];
    return (async function* () {
      for (const m of script) {
        if (typeof m === 'function') await m(options);
        else yield m;
      }
    })();
  },
}));

import { isHostWrite, ruleAllows, suggestRule } from '../src/shared/ceremonyCommands';
import { CommandGone, createCommandStore } from '../src/main/ceremonyCommands-core';
import { askAgent, obj, shellAllowlist, str } from '../src/main/agents';
import { migrateConfig } from '../src/shared/config/migrations';
import { installEnvSecret, installLegacyConfig } from './helpers/config';

await installLegacyConfig();
await installEnvSecret('llm.openrouter');
const { ceremonyCommands } = await import('../src/main/ceremonyCommands');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');

const tick = () => new Promise((r) => setTimeout(r, 5));
async function waitFor<T>(get: () => T | undefined | null): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const v = get();
    if (v) return v;
    await tick();
  }
  throw new Error('nothing came');
}

describe('the rule "allow always" proposes', () => {
  it('is the program and its subcommands, never an argument', () => {
    expect(suggestRule('gh api repos/group/project/releases')).toBe('gh api:*');
    expect(suggestRule('gh pr list -R group/project --state all')).toBe('gh pr list:*');
    expect(suggestRule('gh release view v1.0.0')).toBe('gh release view:*');
    expect(suggestRule('npm test')).toBe('npm test:*');
    expect(suggestRule('npx vitest run test/a.test.ts')).toBe('npx vitest:*');
    expect(suggestRule('ls')).toBe('ls:*');
  });

  it('is the exact command when it has a shell operator', () => {
    expect(suggestRule('git log | wc -l')).toBe('git log | wc -l');
  });

  it('allows the prefix and what follows a space, or only the exact command', () => {
    expect(ruleAllows('gh api:*', 'gh api repos/a/b/releases')).toBe(true);
    expect(ruleAllows('gh api:*', 'gh api')).toBe(true);
    expect(ruleAllows('gh api:*', 'gh apix')).toBe(false);
    expect(ruleAllows('npm test', 'npm test')).toBe(true);
    expect(ruleAllows('npm test', 'npm test -- a')).toBe(false);
  });
});

describe('a write to the code host', () => {
  it.each([
    'git push origin main',
    'git -C /repo push',
    'gh pr merge 12',
    'gh pr create --fill',
    'gh issue comment 3 -b hi',
    'gh api -X POST repos/a/b/issues',
    'gh api repos/a/b/issues -f title=x',
    'gh api graphql -f query=x',
    'glab mr note 4 -m hi',
    'gh auth login',
    'ls && git push',
  ])('is %s', (c) => expect(isHostWrite(c)).toBe(true));

  it.each(['gh api repos/a/b/releases', 'gh pr list -R a/b --state all', 'gh pr view 3 --comments', 'gh release view v1', 'gh status', 'gh search issues x', 'git log --grep push', 'git push-thing', 'npm test', 'glab mr view 4'])('is not %s', (c) =>
    expect(isHostWrite(c)).toBe(false),
  );
});

describe('the queue of requests', () => {
  const store = (over: Partial<Parameters<typeof createCommandStore>[0]> = {}) => {
    const seen = { lists: [] as number[], remembered: [] as [string, string][], audited: [] as string[] };
    const s = createCommandStore({ changed: (l) => seen.lists.push(l.length), remember: (a, r) => seen.remembered.push([a, r]), audit: (c, d) => seen.audited.push(`${c.command}:${d}`), ...over });
    return { s, seen };
  };

  it('waits for the answer: once allows it, always also remembers the rule', async () => {
    const { s, seen } = store();
    const once = s.ask('deep', 'gh api repos/a/b/releases');
    const first = s.list()[0];
    expect(first).toMatchObject({ agent: 'deep', write: false, rule: 'gh api:*' });
    s.answer(first.id, 'once');
    await expect(once).resolves.toEqual({ ok: true });
    const always = s.ask('deep', 'gh pr list -R a/b');
    s.answer(s.list()[0].id, 'always');
    await expect(always).resolves.toEqual({ ok: true });
    expect(seen.remembered).toEqual([['deep', 'gh pr list:*']]);
    expect(seen.audited).toEqual(['gh api repos/a/b/releases:once', 'gh pr list -R a/b:always']);
    expect(s.list()).toEqual([]);
  });

  it('allows a write once at most, never always, and offers no rule for it', async () => {
    const { s, seen } = store();
    const asked = s.ask('deep', 'gh pr merge 12');
    const item = s.list()[0];
    expect(item).toMatchObject({ write: true, rule: null });
    s.answer(item.id, 'always');
    await expect(asked).resolves.toEqual({ ok: true });
    expect(seen.remembered).toEqual([]);
    expect(seen.audited).toEqual(['gh pr merge 12:once']);
  });

  it('refuses with the person\'s note, when nobody answers in time, when the call is stopped, and a write in a test workspace without asking', async () => {
    const { s } = store({ timeoutMs: 30 });
    const denied = s.ask('deep', 'rm -rf build');
    s.answer(s.list()[0].id, 'deny', '  not that  ');
    await expect(denied).resolves.toEqual({ ok: false, note: 'not that' });
    await expect(s.ask('deep', 'ls')).resolves.toMatchObject({ ok: false });
    const stop = new AbortController();
    const stopped = s.ask('deep', 'ls', stop.signal);
    stop.abort();
    await expect(stopped).resolves.toEqual({ ok: false });
    const test = store({ writeRefusal: () => 'test workspace' }).s;
    await expect(test.ask('deep', 'git push')).resolves.toEqual({ ok: false, note: 'test workspace' });
    expect(test.list()).toEqual([]);
    expect(() => s.answer('gone', 'once')).toThrow(CommandGone);
  });
});

describe('the shell hook of a ceremony', () => {
  const run = (hook: ReturnType<typeof shellAllowlist>, command: string) =>
    hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: '/tmp' } as never, undefined, { signal: new AbortController().signal }) as Promise<{ hookSpecificOutput?: { permissionDecision: string; permissionDecisionReason: string } }>;
  const read = [/^gh api repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+$/];

  it('runs what the code allows, lets a rule through without asking, and asks about anything else', async () => {
    const asked: string[] = [];
    const hook = shellAllowlist(read, 'gh', { rules: ['gh api:*'], request: async (c) => (asked.push(c), { ok: true }) });
    expect(await run(hook, 'gh api repos/a/b/pulls/3')).toEqual({});
    expect((await run(hook, 'gh api repos/a/b/releases')).hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(asked).toEqual([]);
    expect((await run(hook, 'npm test')).hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(asked).toEqual(['npm test']);
  });

  it('asks about a write even when a rule matches it, and says the person\'s note when refused', async () => {
    const asked: string[] = [];
    const hook = shellAllowlist(read, 'gh', { rules: ['gh api:*'], request: async (c) => (asked.push(c), { ok: false, note: 'use Actions' }) });
    const out = await run(hook, 'gh api -X POST repos/a/b/issues');
    expect(asked).toEqual(['gh api -X POST repos/a/b/issues']);
    expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(out.hookSpecificOutput?.permissionDecisionReason).toContain('use Actions');
  });

  it('never asks about a git command that names a secret path, and refuses as before without a way to ask', async () => {
    const asked: string[] = [];
    const hook = shellAllowlist([/^git /], 'gh', { rules: [], request: async (c) => (asked.push(c), { ok: true }) });
    expect((await run(hook, 'git show HEAD:.env')).hookSpecificOutput?.permissionDecision).toBe('deny');
    expect(asked).toEqual([]);
    expect((await run(shellAllowlist(read, 'gh'), 'npm test')).hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});

describe('a ceremony call', () => {
  const schema = obj({ fala: str });
  beforeEach(() => {
    scripts = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('has the whole shell for its hook to decide, follows the rules and the code host read of its system agent, and an answer on the queue reaches it', async () => {
    updateConfig((c) => {
      const deep = c.agents.team.find((a) => a.id === 'deep')!;
      deep.allowedCommands = ['npm test:*'];
      deep.tracker = 'read';
      return c;
    });
    let options: Record<string, unknown> = {};
    let decision: unknown;
    scripts = [
      [
        { type: 'system', subtype: 'init', session_id: 's1' },
        async (o) => {
          options = o;
          const hooks = o.hooks as { PreToolUse: { matcher: string; hooks: ((i: unknown, id: undefined, x: { signal: AbortSignal }) => Promise<unknown>)[] }[] };
          const bash = hooks.PreToolUse.find((g) => g.matcher === 'Bash')!;
          const ran = (command: string) => bash.hooks[0]({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: '/tmp' }, undefined, { signal: new AbortController().signal });
          expect(((await ran('npm test -- a')) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('allow');
          const pending = ran('docker compose up -d');
          const item = await waitFor(() => ceremonyCommands.list()[0]);
          expect(item).toMatchObject({ agent: 'deep', command: 'docker compose up -d', rule: 'docker compose:*' });
          ceremonyCommands.answer(item.id, 'always');
          decision = await pending;
        },
        { type: 'result', subtype: 'success', session_id: 's1', structured_output: { fala: 'ok' } },
      ],
    ];
    await askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3 });
    expect((decision as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision).toBe('allow');
    expect(options.allowedTools).toContain('Bash');
    expect((options.allowedTools as string[]).some((t) => t.startsWith('Bash('))).toBe(false);
    expect(options.disallowedTools).not.toContain('Bash');
    expect(getConfig().agents.team.find((a) => a.id === 'deep')?.allowedCommands).toEqual(['npm test:*', 'docker compose:*']);
  });

  it('reads nothing of the code host when its system agent does not', async () => {
    updateConfig((c) => {
      c.agents.team.find((a) => a.id === 'deep')!.tracker = 'none';
      return c;
    });
    let options: Record<string, unknown> = {};
    scripts = [[{ type: 'system', subtype: 'init', session_id: 's2' }, async (o) => void (options = o), { type: 'result', subtype: 'success', session_id: 's2', structured_output: { fala: 'ok' } }]];
    await askAgent<{ fala: string }>('deep', 'Pergunta', schema, { maxTurns: 3 });
    expect((options.allowedTools as string[]).filter((t) => t.startsWith('mcp__') || t.startsWith('Bash('))).toEqual([]);
  });
});

describe('what a file can hand over', () => {
  it('a template never brings commands allowed always', async () => {
    const { mergeTemplateTeam } = await import('../src/shared/cycles/apply');
    const { newAgent } = await import('../src/shared/config/team');
    const merged = mergeTemplateTeam([], [newAgent({ id: 'helper', allowedCommands: ['rm:*'] })], { stages: [], flows: {} }, { sandbox: true });
    expect(merged[0].allowedCommands).toBeUndefined();
  });
});

describe('the migration to schema 12', () => {
  const v11 = (tools: Record<string, unknown>) => ({
    schemaVersion: 11,
    agents: {
      tools,
      team: [
        { id: 'deep', name: 'Deep', system: true, tracker: 'none', shell: 'none' },
        { id: 'writer', name: 'Writer', tracker: 'none', shell: 'none' },
      ],
    },
  });

  it('gives the system agents the code host read the ceremonies had, and nothing else', () => {
    const r = migrateConfig(v11({ vcsCli: true }), { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(14);
    const team = r.config.agents.team;
    expect(team.find((a) => a.id === 'deep')).toMatchObject({ tracker: 'read', shell: 'none' });
    expect(team.find((a) => a.id === 'writer')).toMatchObject({ tracker: 'none', shell: 'none' });
  });

  it('raises nothing where the workspace did not read the code host', () => {
    const r = migrateConfig(v11({ vcsCli: false, trackerMcp: false }), { legacyInstall: false });
    expect(r.config.agents.team.find((a) => a.id === 'deep')).toMatchObject({ tracker: 'none' });
  });
});
