import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, migrateConfig, neutralConfig, validateConfig } from '../src/shared/config';
import { addAgent, isPersona, newAgent, outOfCycle, personaDraftOf, personaOf, withoutPersona } from '../src/shared/config/team';
import { AGENT_KINDS, CONFIG_SCHEMA_VERSION, type AgentDef, type WorkspaceConfig } from '../src/shared/config/types';
import { TEST_STAGES } from './helpers/config';

const persona = (over: Partial<AgentDef> = {}): AgentDef => newAgent({ id: 'me', name: 'Me', kind: 'persona', ...over });

function withTeam(extra: AgentDef[]): WorkspaceConfig {
  const c = neutralConfig();
  c.devCycle.stages = TEST_STAGES;
  return { ...c, agents: { ...c.agents, team: [...c.agents.team, ...extra] } };
}

const pathsOf = (c: unknown) => validateConfig(c).errors.map((e) => e.path);
const at = (c: WorkspaceConfig, id: string) => c.agents.team.findIndex((a) => a.id === id);

describe('the persona kind in the configuration', () => {
  it('is accepted by the schema, absent means an ordinary agent, and a draft copy is a persona too', () => {
    const c = withTeam([persona(), persona({ id: 'me-test', draft: true })]);
    const r = validateConfig(c);
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.find((a) => a.id === 'me')?.kind).toBe('persona');
    expect(neutralConfig().agents.team.every((a) => a.kind === undefined)).toBe(true);
    expect(newAgent({ id: 'writer', name: 'Writer' })).not.toHaveProperty('kind');
    expect(isPersona(newAgent({ id: 'writer', name: 'Writer' }))).toBe(false);
  });

  it('refuses a kind that is not the persona, by path', () => {
    const c = withTeam([{ ...persona(), kind: 'boss' as never }]);
    expect(pathsOf(c)).toEqual([`agents.team[${at(c, 'me')}].kind`]);
  });

  it('carries the field in the JSON Schema, with the kinds it knows', () => {
    const agent = CONFIG_SCHEMA.properties!.agents.properties!.team.items!;
    expect(agent.properties!.kind.enum).toEqual([...AGENT_KINDS]);
    expect(agent.required).not.toContain('kind');
  });

  it('newAgent carries only the persona kind', () => {
    expect(newAgent({ id: 'a', name: 'A', kind: 'persona' }).kind).toBe('persona');
    expect(newAgent({ id: 'a', name: 'A', kind: 'other' as never })).not.toHaveProperty('kind');
    expect(addAgent(neutralConfig(), { id: 'p', kind: 'persona' }).agents.team.find((a) => a.id === 'p')?.kind).toBe('persona');
  });

  it('finds the persona by its kind and never by its id, and its draft copy apart', () => {
    const real = persona({ id: 'anything' });
    const copy = persona({ id: 'me-test', draft: true });
    const team = withTeam([newAgent({ id: 'persona', name: 'Not it' }), real, copy]).agents.team;
    expect(personaOf(team)?.id).toBe('anything');
    expect(personaDraftOf(team)?.id).toBe('me-test');
    expect(personaOf(team.filter((a) => a.id !== 'anything'))).toBeNull();
    expect(personaDraftOf(team.filter((a) => a.id !== 'me-test'))).toBeNull();
    expect([real, copy, newAgent({ id: 'x', name: 'X', draft: true }), newAgent({ id: 'y', name: 'Y' })].map(outOfCycle)).toEqual([true, true, true, false]);
  });

  it('withoutPersona drops every entry of that kind and leaves a config without one as the same object', () => {
    const c = withTeam([persona(), persona({ id: 'me-test', draft: true }), newAgent({ id: 'writer', name: 'Writer' })]);
    expect(withoutPersona(c).agents.team.map((a) => a.id)).toEqual([...neutralConfig().agents.team.map((a) => a.id), 'writer']);
    expect(c.agents.team.some(isPersona)).toBe(true);
    const plain = neutralConfig();
    expect(withoutPersona(plain)).toBe(plain);
  });
});

describe('validation of the persona (rule 3)', () => {
  it('refuses a second persona, and a second test copy, at the kind of the second', () => {
    const two = withTeam([persona(), persona({ id: 'other' })]);
    expect(pathsOf(two)).toEqual([`agents.team[${at(two, 'other')}].kind`]);
    const copies = withTeam([persona({ id: 'a', draft: true }), persona({ id: 'b', draft: true })]);
    expect(pathsOf(copies)).toEqual([`agents.team[${at(copies, 'b')}].kind`]);
    expect(validateConfig(withTeam([persona(), persona({ id: 'c', draft: true })])).errors).toEqual([]);
  });

  it.each([
    ['stages', { stages: [TEST_STAGES[0].id] }, /stages/],
    ['squad', { squad: 'core' }, /squad/],
    ['turnsTo', { turnsTo: 'deep' }, /turn to/],
    ['autonomous', { autonomous: true }, /autonomous/],
    ['system', { system: true }, /built-in/],
  ] as const)('refuses a persona with %s, with every error at the kind and only there', (_name, over, message) => {
    const c = withTeam([persona(over as Partial<AgentDef>)]);
    const errors = validateConfig(c).errors.filter((e) => e.path.startsWith(`agents.team[${at(c, 'me')}]`));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => e.path === `agents.team[${at(c, 'me')}].kind`)).toBe(true);
    expect(errors.map((e) => e.message).join(' ')).toMatch(message);
  });

  it('does not constrain the permission fields: a file that sets them is honoured as for any agent', () => {
    const c = withTeam([persona({ tracker: 'read', shell: 'sandbox', permission: 'worktree' })]);
    const r = validateConfig(c);
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.find((a) => a.id === 'me')).toMatchObject({ tracker: 'read', shell: 'sandbox', permission: 'worktree' });
  });
});

describe('schema 29 to 30 and the repair of a persona', () => {
  const v29 = (c: WorkspaceConfig): Record<string, any> => ({ ...JSON.parse(JSON.stringify(c)), schemaVersion: 29 });

  it('bumps a v29 file with a persona in it and keeps the persona, and a second start changes nothing', () => {
    const r = migrateConfig(v29(withTeam([persona({ instructions: 'about me' })])), { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.agents.team.find((a) => a.id === 'me')).toMatchObject({ kind: 'persona', instructions: 'about me' });
    const again = migrateConfig(structuredClone(r.config) as unknown as Record<string, any>, { legacyInstall: false });
    expect(again.changed).toBe(false);
    expect(again.config).toEqual(r.config);
  });

  it('refuses a file written by the next version', () => {
    expect(() => migrateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION + 1 }, { legacyInstall: false })).toThrow(/newer app/);
  });

  it('loads a stored persona that breaks a rule as an ordinary agent, keeps the team and names the path in the note', () => {
    const c = withTeam([persona({ stages: [TEST_STAGES[0].id], instructions: 'about me' }), newAgent({ id: 'writer', name: 'Writer', job: 'writes' })]);
    const i = at(c, 'me');
    const r = migrateConfig({ ...JSON.parse(JSON.stringify(c)), schemaVersion: CONFIG_SCHEMA_VERSION }, { legacyInstall: false });
    expect(r.changed).toBe(true);
    expect(r.notes.join(' ')).toContain(`dropped agents.team[${i}].kind`);
    const kept = r.config.agents.team.find((a) => a.id === 'me');
    expect(kept).toMatchObject({ instructions: 'about me', stages: [], autonomous: false, turnsTo: null });
    expect(kept).not.toHaveProperty('kind');
    expect(r.config.agents.team.find((a) => a.id === 'writer')?.job).toBe('writes');
    expect(r.config.agents.team.length).toBe(c.agents.team.length);
    expect(r.config.devCycle.stages).toEqual(TEST_STAGES);
  });

  it('loads a persona with system: true as an inert ordinary agent, with the team and the other agents untouched', () => {
    const c = withTeam([persona({ system: true, instructions: 'about me' }), newAgent({ id: 'writer', name: 'Writer', job: 'writes' })]);
    const r = migrateConfig({ ...JSON.parse(JSON.stringify(c)), schemaVersion: CONFIG_SCHEMA_VERSION }, { legacyInstall: false });
    const kept = r.config.agents.team.find((a) => a.id === 'me');
    expect(kept).toMatchObject({ instructions: 'about me', stages: [], autonomous: false, turnsTo: null });
    expect(kept).not.toHaveProperty('kind');
    expect(kept?.system ?? false).toBe(false);
    expect(r.config.agents.team.find((a) => a.id === 'writer')?.job).toBe('writes');
    expect(r.config.agents.team.length).toBe(c.agents.team.length);
    expect(r.config.devCycle.stages).toEqual(TEST_STAGES);
  });

  it('keeps the team when a persona lists a stage the cycle does not have, and leaves the agent with no stage, squad or autonomy', () => {
    const c = withTeam([persona({ stages: ['no-such-stage'], squad: 'core', turnsTo: 'writer', autonomous: true, instructions: 'about me' }), newAgent({ id: 'writer', name: 'Writer', job: 'writes' })]);
    const r = migrateConfig({ ...JSON.parse(JSON.stringify(c)), schemaVersion: CONFIG_SCHEMA_VERSION }, { legacyInstall: false });
    const kept = r.config.agents.team.find((a) => a.id === 'me');
    expect(kept).toMatchObject({ instructions: 'about me', stages: [], autonomous: false, turnsTo: null });
    expect(kept?.squad ?? null).toBeNull();
    expect(kept).not.toHaveProperty('kind');
    expect(r.config.agents.team.find((a) => a.id === 'writer')?.job).toBe('writes');
    expect(r.config.agents.team.length).toBe(c.agents.team.length);
  });

  it('does not touch the stages of an agent whose kind is unknown (it was never the persona)', () => {
    const c = withTeam([{ ...newAgent({ id: 'odd', name: 'Odd', stages: [TEST_STAGES[0].id] }), kind: 'boss' as never }]);
    const r = migrateConfig({ ...JSON.parse(JSON.stringify(c)), schemaVersion: CONFIG_SCHEMA_VERSION }, { legacyInstall: false });
    expect(r.config.agents.team.find((a) => a.id === 'odd')?.stages).toEqual([TEST_STAGES[0].id]);
  });

  it('drops a persona kind that is not a known one and leaves the rest of the entry', () => {
    const c = withTeam([{ ...persona({ instructions: 'x' }), kind: 'boss' as never }]);
    const r = migrateConfig({ ...JSON.parse(JSON.stringify(c)), schemaVersion: CONFIG_SCHEMA_VERSION }, { legacyInstall: false });
    expect(r.config.agents.team.find((a) => a.id === 'me')).toMatchObject({ instructions: 'x' });
    expect(r.config.agents.team.find((a) => a.id === 'me')).not.toHaveProperty('kind');
  });
});
