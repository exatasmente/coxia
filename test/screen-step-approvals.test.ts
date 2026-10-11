import { describe, expect, it } from 'vitest';
import { STEP_KINDS } from '../src/shared/browser';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { HELD_POLICY, heldOnly, screenPolicyChanges, policyRaised, releasedKinds, resolveScreenPolicy, runsAlone, sanitizePolicy, type ScreenPolicy } from '../src/shared/config/screenPolicy';
import { newAgent } from '../src/shared/config/team';
import { newSquad } from '../src/shared/config/squads';
import type { WorkspaceConfig } from '../src/shared/config/types';

const configWith = (levels: { workspace?: ScreenPolicy; squad?: ScreenPolicy; agent?: ScreenPolicy }): { config: WorkspaceConfig; agent: ReturnType<typeof newAgent> } => {
  const c = neutralConfig();
  const agent = newAgent({ id: 'dev', squad: 'platform', ...(levels.agent ? { screenPolicy: levels.agent } : {}) });
  const config: WorkspaceConfig = {
    ...c,
    runner: { ...c.runner, screenPolicy: levels.workspace ?? {} },
    squads: [...(c.squads ?? []), newSquad({ id: 'platform', ...(levels.squad ? { screenPolicy: levels.squad } : {}) })],
    agents: { ...c.agents, team: [...c.agents.team, agent] },
  };
  return { config, agent };
};

describe('resolving the screen step approvals', () => {
  it('holds every kind when nobody says anything, and with no agent', () => {
    const { config, agent } = configWith({});
    expect(resolveScreenPolicy(config, agent)).toEqual(HELD_POLICY);
    expect(resolveScreenPolicy(config, null)).toEqual(HELD_POLICY);
    expect(releasedKinds(HELD_POLICY)).toEqual([]);
    for (const k of STEP_KINDS) expect(runsAlone(undefined, k)).toBe(false);
  });

  it('lets the squad win over the workspace when the agent says nothing', () => {
    const { config, agent } = configWith({ workspace: { name: 'autonomous' }, squad: { name: 'held' } });
    expect(resolveScreenPolicy(config, agent).name).toEqual({ mode: 'held', source: 'squad' });
  });

  it('lets the agent win over the squad', () => {
    const { config, agent } = configWith({ squad: { name: 'held' }, agent: { name: 'autonomous' } });
    const p = resolveScreenPolicy(config, agent);
    expect(p.name).toEqual({ mode: 'autonomous', source: 'agent' });
    expect(runsAlone(p, 'name')).toBe(true);
  });

  it('decides kind by kind: a level that names some kinds leaves the others to the next', () => {
    const { config, agent } = configWith({ workspace: { submit: 'autonomous', dialog: 'autonomous' }, squad: { dialog: 'held' }, agent: { agent: 'autonomous' } });
    const p = resolveScreenPolicy(config, agent);
    expect(p.submit).toEqual({ mode: 'autonomous', source: 'workspace' });
    expect(p.dialog).toEqual({ mode: 'held', source: 'squad' });
    expect(p.agent).toEqual({ mode: 'autonomous', source: 'agent' });
    expect(p.shortcut).toEqual({ mode: 'held', source: 'default' });
    expect(releasedKinds(p)).toEqual(['submit', 'agent']);
  });
});

describe('a policy from a file', () => {
  it('keeps the kinds with a known mode and drops the rest, the four categories included', () => {
    expect(sanitizePolicy({ name: 'autonomous', submit: 'held', payment: 'autonomous', card: 'autonomous', bogus: 'held', dialog: 'maybe' })).toEqual({
      policy: { name: 'autonomous', submit: 'held' },
      dropped: ['payment', 'card', 'bogus', 'dialog'],
    });
    expect(sanitizePolicy(undefined)).toEqual({ policy: {}, dropped: [] });
    expect(sanitizePolicy('autonomous').dropped).toEqual(['*']);
  });

  it('validates with a warning, never an error, and lets none of the four categories through', () => {
    const c = neutralConfig();
    const raw = JSON.parse(JSON.stringify({ ...c, runner: { ...c.runner, screenPolicy: { name: 'autonomous', payment: 'autonomous', people: 'autonomous', secret: 'autonomous' } } }));
    const r = validateConfig(raw);
    expect(r.ok).toBe(true);
    expect(r.config?.runner.screenPolicy).toEqual({ name: 'autonomous' });
    expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['runner.screenPolicy.payment', 'runner.screenPolicy.people', 'runner.screenPolicy.secret']));
  });

  it('keeps only the holds of a policy someone hands over', () => {
    expect(heldOnly({ name: 'autonomous', submit: 'held' })).toEqual({ submit: 'held' });
    expect(heldOnly({ name: 'autonomous' })).toBeUndefined();
    expect(heldOnly(undefined)).toBeUndefined();
  });
});

describe('a change of the policy', () => {
  it('lists every word that changed, with the level, the owner, before and after', () => {
    const before = configWith({ workspace: { submit: 'held' } });
    const after = configWith({ workspace: { submit: 'autonomous' }, squad: { name: 'held' }, agent: { dialog: 'autonomous' } });
    expect(screenPolicyChanges(before.config, after.config)).toEqual([
      { level: 'workspace', owner: '', kind: 'submit', before: 'held', after: 'autonomous' },
      { level: 'squad', owner: 'platform', kind: 'name', before: 'inherit', after: 'held' },
      { level: 'agent', owner: 'dev', kind: 'dialog', before: 'inherit', after: 'autonomous' },
    ]);
    expect(screenPolicyChanges(after.config, after.config)).toEqual([]);
  });

  it('tells a change that lets a kind run from one that only holds more', () => {
    const held = configWith({ workspace: { name: 'held' } }).config;
    const released = configWith({ workspace: { name: 'autonomous' } }).config;
    expect(policyRaised(held, released)).toBe(true);
    expect(policyRaised(released, held)).toBe(false);
    expect(policyRaised(released, configWith({}).config)).toBe(false);
  });
});

describe('the drafts of the settings screen', async () => {
  const { draftOf, applyAgent } = await import('../src/renderer/src/screens/team/agentEdit');
  const { draftOfSquad, applySquad } = await import('../src/renderer/src/screens/team/squadEdit');

  it('carry an agent\'s and a squad\'s approvals both ways, and write no field when every kind inherits', () => {
    const { config } = configWith({ squad: { submit: 'held' }, agent: { name: 'autonomous' } });
    const agent = config.agents.team.find((a) => a.id === 'dev')!;
    expect(draftOf(agent).screenPolicy).toEqual({ name: 'autonomous' });
    const cleared = applyAgent(config, { ...draftOf(agent), screenPolicy: {} }, false);
    expect('screenPolicy' in cleared.agents.team.find((a) => a.id === 'dev')!).toBe(false);
    const squad = config.squads!.find((s) => s.id === 'platform')!;
    const d = draftOfSquad(config, squad);
    expect(d.screenPolicy).toEqual({ submit: 'held' });
    expect(applySquad(config, { ...d, screenPolicy: { dialog: 'autonomous' } }, false).squads!.find((s) => s.id === 'platform')!.screenPolicy).toEqual({ dialog: 'autonomous' });
    expect('screenPolicy' in applySquad(config, { ...d, screenPolicy: {} }, false).squads!.find((s) => s.id === 'platform')!).toBe(false);
    expect(validateConfig(JSON.parse(JSON.stringify(applySquad(config, { ...d, screenPolicy: {} }, false)))).errors.filter((e) => e.path.includes('screenPolicy'))).toEqual([]);
  });
});
