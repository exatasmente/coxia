import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { migrateConfig } from '../src/shared/config/migrations';
import { RECOMMENDED, applyRecommendations, newAgent, recommendations, withoutSandbox } from '../src/shared/config/team';
import { validateConfig } from '../src/shared/config/validate';
import { collectCommands, collectPaths } from '../src/shared/config/transfer';
import { agentFlow, agentFlowEngineering, agentFlowTeam, applyTemplate, engineeringTeam, releaseManager } from '../src/shared/cycles';
import { mergeTemplateTeam } from '../src/shared/cycles/apply';
import { cycleOf } from '../src/shared/cycles';
import type { WorkspaceConfig } from '../src/shared/config/types';

type Doc = Record<string, any>;

// What "tracker" and "shell" are and how they come to exist: the pure side of the feature (the migration, the checks, the defaults per role). Nothing here makes a sandbox.

const v9 = (change: (c: Doc) => void = () => undefined): Doc => {
  const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
  c.schemaVersion = 9;
  delete c.runner.sandbox;
  for (const a of c.agents.team) {
    delete a.tracker;
    delete a.shell;
  }
  c.agents.team.push({ id: 'dev', name: 'Dev', job: '', model: { role: 'deep', provider: '', model: '' }, stages: [], permission: 'worktree', autonomous: false, turnsTo: null, instructions: '', system: false });
  c.agents.team.push({ id: 'po', name: 'PO', job: '', model: { role: 'deep', provider: '', model: '' }, stages: [], permission: 'read', autonomous: false, turnsTo: null, instructions: '', system: false });
  change(c);
  return c;
};
const migrate = (doc: Doc) => migrateConfig(doc, { legacyInstall: false });
const agent = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;

describe('the migration to schema 10', () => {
  it('raises nothing: an agent that writes keeps the commands of the runner, one that only reads runs none', () => {
    const r = migrate(v9());
    expect(r.fromVersion).toBe(9);
    expect(r.config.schemaVersion).toBe(11);
    expect(agent(r.config, 'dev')).toMatchObject({ shell: 'allowlist', tracker: 'none' });
    expect(agent(r.config, 'po')).toMatchObject({ shell: 'none' });
    for (const a of r.config.agents.team) expect(a.shell).not.toBe('sandbox');
  });

  it('gives an agent that writes no commands when the workspace lists none', () => {
    const r = migrate(v9((c) => { c.runner.commands = []; }));
    expect(agent(r.config, 'dev').shell).toBe('none');
  });

  it('keeps for a reader the code host read it has: the workspace switches decide', () => {
    const tools = (vcsCli: boolean, trackerMcp: boolean) => migrate(v9((c) => { c.agents.tools.vcsCli = vcsCli; c.agents.tools.trackerMcp = trackerMcp; })).config;
    expect(agent(tools(true, false), 'po').tracker).toBe('read');
    expect(agent(tools(false, true), 'po').tracker).toBe('read');
    expect(agent(tools(false, false), 'po').tracker).toBe('none');
    // An agent that writes never had it.
    expect(agent(tools(true, true), 'dev').tracker).toBe('none');
  });

  it('adds a sandbox that reaches nothing and says what it did', () => {
    const r = migrate(v9());
    expect(r.config.runner.sandbox).toMatchObject({ network: 'off', readOnlyPaths: [] });
    expect(r.notes.join(' ')).toMatch(/nothing was raised/);
  });

  it('does not overwrite a value a file already has', () => {
    const r = migrate(v9((c) => { c.agents.team.find((a: Doc) => a.id === 'dev').shell = 'none'; }));
    expect(agent(r.config, 'dev').shell).toBe('none');
  });
});

describe('the defaults of an agent', () => {
  it('read as it behaved before the fields: an agent that writes runs the runner commands, one that reads runs none and reads nothing', () => {
    expect(newAgent({ id: 'a', permission: 'worktree' })).toMatchObject({ tracker: 'none', shell: 'allowlist' });
    expect(newAgent({ id: 'a' })).toMatchObject({ tracker: 'none', shell: 'none' });
  });

  it('are none and none for the five built-in agents', () => {
    for (const a of neutralConfig().agents.team) expect(a).toMatchObject({ tracker: 'none', shell: 'none' });
  });

  it('are the table of the roles for the two shipped teams', () => {
    const by = (list: { id: string; tracker: string; shell: string }[]) => Object.fromEntries(list.map((a) => [a.id, `${a.tracker}/${a.shell}`]));
    expect(by(agentFlowTeam())).toEqual({ support: 'none/none', 'product-owner': 'read/none', 'tech-lead': 'read/sandbox', developer: 'none/sandbox', qa: 'none/sandbox', 'customer-success': 'none/none' });
    expect(by(engineeringTeam())).toEqual({ refiner: 'read/none', planner: 'read/sandbox', developer: 'none/sandbox', reviewer: 'read/sandbox', qa: 'none/sandbox' });
    expect(Object.keys(RECOMMENDED).sort()).toEqual([...agentFlowTeam(), ...engineeringTeam(), releaseManager()].map((a) => a.id).filter((x, i, l) => l.indexOf(x) === i).sort());
    // the Release manager of the release flow reads the host and runs nothing
    expect(by([releaseManager()])).toEqual({ 'release-manager': 'read/none' });
  });

  it('only keep the sandbox where one works: an agent a template brings is lowered otherwise', () => {
    expect(withoutSandbox('sandbox', 'worktree')).toBe('allowlist');
    expect(withoutSandbox('sandbox', 'read')).toBe('none');
    expect(withoutSandbox('none', 'read')).toBe('none');
    const here = mergeTemplateTeam(neutralConfig().agents.team, agentFlowTeam(), cycleOf(agentFlow), { sandbox: true });
    expect(agent({ agents: { team: here } } as WorkspaceConfig, 'qa').shell).toBe('sandbox');
    const lowered = mergeTemplateTeam(neutralConfig().agents.team, agentFlowTeam(), cycleOf(agentFlow));
    const w = { agents: { team: lowered } } as WorkspaceConfig;
    expect(agent(w, 'developer')).toMatchObject({ shell: 'allowlist', tracker: 'none' });
    expect(agent(w, 'qa').shell).toBe('none');
    expect(agent(w, 'tech-lead')).toMatchObject({ shell: 'none', tracker: 'read' });
  });

  it('are given to a team a template makes only for the agents it adds', () => {
    const own = neutralConfig();
    own.agents.team.push(newAgent({ id: 'qa', name: 'My QA', permission: 'read', shell: 'none' }));
    const next = applyTemplate(own, agentFlow, { sandbox: true });
    expect(agent(next, 'qa')).toMatchObject({ name: 'My QA', shell: 'none' });
    expect(agent(next, 'developer').shell).toBe('sandbox');
  });
});

describe('the recommended permissions', () => {
  const team = (sandbox: boolean): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlowEngineering, { sandbox });

  it('are nothing for a team that already has them', () => {
    expect(recommendations(team(true), true)).toEqual([]);
  });

  it('list each agent that differs, with what it has now', () => {
    const c = team(true);
    agent(c, 'qa').shell = 'none';
    agent(c, 'refiner').tracker = 'none';
    expect(recommendations(c, true).map((r) => [r.id, r.tracker, r.shell, r.from.shell])).toEqual([['refiner', 'read', 'none', 'none'], ['qa', 'none', 'sandbox', 'none']]);
  });

  it('offer, where there is no sandbox, only what the agent could do before sandboxes', () => {
    const c = team(false);
    expect(recommendations(c, false)).toEqual([]);
    agent(c, 'planner').tracker = 'none';
    const r = recommendations(c, false);
    expect(r).toEqual([expect.objectContaining({ id: 'planner', tracker: 'read', shell: 'none' })]);
    // The same team, asked as if a sandbox worked, would be offered the sandbox for the roles that run commands.
    expect(recommendations(c, true).map((x) => `${x.id}:${x.shell}`)).toEqual(['planner:sandbox', 'developer:sandbox', 'reviewer:sandbox', 'qa:sandbox']);
  });

  it('are applied only by the call that applies them, and leave every other agent alone', () => {
    const c = team(false);
    const next = applyRecommendations(c, recommendations(c, true));
    expect(agent(next, 'qa').shell).toBe('sandbox');
    expect(agent(next, 'planner')).toMatchObject({ tracker: 'read', shell: 'sandbox' });
    expect(next.agents.team.filter((a) => a.system)).toEqual(c.agents.team.filter((a) => a.system));
    expect(agent(c, 'qa').shell).not.toBe('sandbox');
  });
});

describe('the checks', () => {
  const errors = (change: (c: WorkspaceConfig) => void): string[] => {
    const c = structuredClone(neutralConfig());
    change(c);
    return validateConfig(c).errors.map((e) => e.path);
  };

  it('refuse "allowlist" for an agent that only reads', () => {
    expect(errors((c) => { c.agents.team.push(newAgent({ id: 'r', name: 'R', permission: 'read', shell: 'allowlist' })); })).toContain(`agents.team[${neutralConfig().agents.team.length}].shell`);
    expect(errors((c) => { c.agents.team.push(newAgent({ id: 'r', name: 'R', permission: 'worktree', shell: 'allowlist' })); })).toEqual([]);
    expect(errors((c) => { c.agents.team.push(newAgent({ id: 'r', name: 'R', permission: 'read', shell: 'sandbox' })); })).toEqual([]);
  });

  it('refuse a host that is not a plain name, a folder that looks like a place for secrets and a limit out of range', () => {
    expect(errors((c) => { c.runner.sandbox.registryHosts = ['https://registry.example.com']; })).toEqual(['runner.sandbox.registryHosts[0]']);
    expect(errors((c) => { c.runner.sandbox.readOnlyPaths = ['~/.ssh', '/opt/tools', 'relative/path']; })).toEqual(['runner.sandbox.readOnlyPaths[0]', 'runner.sandbox.readOnlyPaths[2]']);
    expect(errors((c) => { c.runner.sandbox.limits.memoryMb = 64; })).toContain('runner.sandbox.limits.memoryMb');
    expect(errors((c) => { c.runner.sandbox.limits.processes = 1.5; })).toContain('runner.sandbox.limits.processes');
  });

  it('accept the defaults and a configured sandbox', () => {
    expect(validateConfig(neutralConfig()).ok).toBe(true);
    expect(errors((c) => { c.runner.sandbox = { ...c.runner.sandbox, network: 'registry', readOnlyPaths: ['~/.nvm/versions/node/v20.11.0'] }; })).toEqual([]);
  });
});

describe('what an import shows', () => {
  it('lists an agent that can run commands among the programs, and the extra folders among the paths', () => {
    const c = applyTemplate(neutralConfig(), agentFlowEngineering, { sandbox: true });
    c.runner.sandbox.readOnlyPaths = ['~/tools/node'];
    const fields = collectCommands(c).map((x) => x.field);
    expect(fields).toContain('agents.team[developer].shell');
    expect(fields).not.toContain('agents.team[refiner].shell');
    expect(collectPaths(c).map((x) => x.field)).toContain('runner.sandbox.readOnlyPaths[0]');
  });
});
