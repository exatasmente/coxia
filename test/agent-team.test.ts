import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, migrateConfig, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { addAgent, ensureSystemAgents, isSystemId, newAgent, pruneAgentStages, removeAgent, stageAgent, systemAgents, updateAgent } from '../src/shared/config/team';
import { LLM_ROLES, type WorkspaceConfig } from '../src/shared/config/types';
import { CATALOGS } from '../src/shared/i18n';

type Doc = Record<string, any>;

const withStages = (c: WorkspaceConfig): WorkspaceConfig => {
  c.devCycle.stages = [
    { id: 'plan', label: 'Plan', match: [], kind: 'development', rank: 1, agentId: 'planner' },
    { id: 'gate', label: 'Gate', match: [], kind: 'development', rank: 2, human: true },
    { id: 'code', label: 'Code', match: [], kind: 'development', rank: 3 },
  ];
  return c;
};

describe('the five system agents', () => {
  it('are in a fresh config, one per LLM role, read only, with no stage', () => {
    const team = neutralConfig().agents.team;
    expect(team.map((a) => a.id)).toEqual([...LLM_ROLES]);
    for (const a of team) expect(a).toMatchObject({ system: true, permission: 'read', stages: [], model: { role: a.id, provider: '', model: '' } });
  });

  it('have a name and a job in both catalogs', () => {
    for (const a of systemAgents()) for (const text of [a.name, a.job]) for (const l of ['pt-BR', 'en'] as const) expect(CATALOGS[l][text], `${l} ${text}`).toBeTruthy();
  });

  it('take the model role and the extra instructions of agents.roles', () => {
    const [turn] = systemAgents({ turn: { modelRole: 'deep', extraInstructions: 'be brief' } });
    expect(turn).toMatchObject({ id: 'turn', model: { role: 'deep' }, instructions: 'be brief' });
  });

  it('are added back when a file leaves them out, and a file keeps its own agents', () => {
    const r = validateConfig({ schemaVersion: 4, agents: { team: [{ id: 'writer', name: 'Writer' }] } });
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.map((a) => a.id)).toEqual(['writer', ...LLM_ROLES]);
    expect(r.config?.agents.team[0]).toMatchObject({ job: '', permission: 'read', stages: [], system: false, model: { role: 'deep', provider: '', model: '' } });
  });

  it('are seeded from agents.roles when they have to be added back', () => {
    const roles = neutralConfig().agents.roles;
    const r = validateConfig({ schemaVersion: 4, agents: { roles: { ...roles, deep: { ...roles.deep, modelRole: 'turn', extraInstructions: 'dig' } }, team: [] } });
    expect(r.config?.agents.team.find((a) => a.id === 'deep')).toMatchObject({ model: { role: 'turn' }, instructions: 'dig' });
  });

  it('are what isSystemId recognises', () => {
    expect(LLM_ROLES.every(isSystemId)).toBe(true);
    expect(isSystemId('developer')).toBe(false);
  });
});

describe('validating the team', () => {
  const errorsOf = (change: (c: WorkspaceConfig) => void) => {
    const c = withStages(neutralConfig());
    c.agents.team.push(newAgent({ id: 'planner', stages: ['plan'] }));
    change(c);
    return validateConfig(c);
  };

  it('accepts a team with agents, stages and a named agent', () => {
    expect(errorsOf(() => undefined).errors).toEqual([]);
  });

  it('refuses a repeated id', () => {
    expect(errorsOf((c) => c.agents.team.push(newAgent({ id: 'planner' }))).errors.map((e) => e.message)).toContain('duplicate agent id "planner"');
  });

  it('refuses a system id on an ordinary agent, and the system flag on another id', () => {
    const paths = errorsOf((c) => {
      c.agents.team[0].system = false;
      c.agents.team.find((a) => a.id === 'planner')!.system = true;
    }).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['agents.team[0].system', 'agents.team[5].system']));
  });

  it('refuses a stage the cycle does not have', () => {
    expect(errorsOf((c) => c.agents.team[5].stages.push('ghost')).errors).toContainEqual({ path: 'agents.team[5].stages[1]', message: 'unknown stage "ghost"' });
  });

  it('checks the model: a role to borrow, or a known provider and a model', () => {
    const r = errorsOf((c) => {
      c.agents.team[5].model = { role: null, provider: 'nobody', model: '' };
    });
    expect(r.errors.map((e) => e.path)).toEqual(['agents.team[5].model.provider', 'agents.team[5].model.model']);
    const ok = errorsOf((c) => {
      c.agents.team[5].model = { role: null, provider: 'anthropic', model: 'sonnet' };
    });
    expect(ok.errors).toEqual([]);
    const both = errorsOf((c) => {
      c.agents.team[5].model = { role: 'deep', provider: 'anthropic', model: 'sonnet' };
    });
    expect(both.warnings.map((w) => w.path)).toContain('agents.team[5].model');
  });

  it('refuses a stage that names an agent that does not exist, or a gate that names one', () => {
    const r = errorsOf((c) => {
      c.devCycle.stages[2].agentId = 'ghost';
      c.devCycle.stages[1].agentId = 'planner';
    });
    expect(r.errors.map((e) => e.path)).toEqual(['devCycle.stages[1].agentId', 'devCycle.stages[2].agentId']);
  });

  it('warns when the agent a stage names does not list that stage', () => {
    const r = errorsOf((c) => {
      c.devCycle.stages[2].agentId = 'planner';
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.path)).toEqual(['devCycle.stages[2].agentId']);
  });

  it('keeps artifact names plain: no folder, nothing hidden, no repeat', () => {
    for (const bad of ['../x.md', 'a/b.md', '.hidden', '']) {
      const r = errorsOf((c) => {
        c.devCycle.stages[0].artifacts = [bad];
      });
      expect(r.ok, bad).toBe(false);
    }
    expect(errorsOf((c) => (c.devCycle.stages[0].artifacts = ['1_SPEC.md'])).ok).toBe(true);
    expect(errorsOf((c) => (c.devCycle.stages[0].artifacts = ['a.md', 'a.md'])).ok).toBe(false);
  });

  it('refuses an unknown permission and a field the schema does not know', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.team.push({ id: 'x', name: 'X', permission: 'root', extra: 1 });
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(expect.arrayContaining(['agents.team[5].permission', 'agents.team[5].extra']));
  });

  it('describes every agent field in the schema', () => {
    const team = CONFIG_SCHEMA.properties?.agents.properties?.team;
    expect(Object.keys(team?.items?.properties ?? {})).toEqual(['id', 'name', 'job', 'model', 'stages', 'permission', 'autonomous', 'instructions', 'system']);
    expect(team?.items?.required).toEqual(['id', 'name']);
  });
});

describe('the migration to schema 4', () => {
  const v3 = (change: (c: Doc) => void = () => undefined): Doc => {
    const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    c.schemaVersion = 3;
    delete c.agents.team;
    change(c);
    return c;
  };

  it('seeds the five system agents from agents.roles, keeping the person\'s model role and instructions', () => {
    const r = migrateConfig(
      v3((c) => {
        c.agents.roles.deep.modelRole = 'turn';
        c.agents.roles.deep.extraInstructions = 'dig deep';
      }),
      { legacyInstall: false },
    );
    expect(r.fromVersion).toBe(3);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(4);
    expect(r.config.agents.team.map((a) => a.id)).toEqual([...LLM_ROLES]);
    expect(r.config.agents.team.find((a) => a.id === 'deep')).toMatchObject({ system: true, model: { role: 'turn' }, instructions: 'dig deep' });
    expect(r.notes.join(' ')).toContain('agent team');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('leaves a team that is already there alone, and a file with no agents section to the defaults', () => {
    const own = v3((c) => (c.agents.team = [{ id: 'writer', name: 'Writer' }]));
    expect(migrateConfig(own, { legacyInstall: false }).config.agents.team.map((a) => a.id)).toEqual(['writer', ...LLM_ROLES]);
    const bare = migrateConfig({ schemaVersion: 3, language: 'en' }, { legacyInstall: false });
    expect(bare.config.agents.team).toEqual(systemAgents());
    expect(bare.config.language).toBe('en');
  });

  it('carries a v2 file through both steps', () => {
    const v2 = v3((c) => {
      c.schemaVersion = 2;
      delete c.devCycle.priority;
    });
    const r = migrateConfig(v2, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(4);
    expect(r.config.agents.team).toHaveLength(5);
  });
});

describe('editing the team', () => {
  const base = (): WorkspaceConfig => {
    const c = withStages(neutralConfig());
    c.agents.team.push(newAgent({ id: 'planner', stages: ['plan'] }));
    return c;
  };

  it('adds an agent that is never a system one, with its defaults, and refuses a bad, reserved or repeated id', () => {
    const c = addAgent(base(), { id: 'writer', name: 'Writer', system: true } as never);
    expect(c.agents.team.at(-1)).toMatchObject({ id: 'writer', system: false, permission: 'read' });
    expect(validateConfig(c).errors).toEqual([]);
    expect(() => addAgent(c, { id: 'writer' })).toThrow(/already an agent|Já existe/);
    expect(() => addAgent(c, { id: 'deep' })).toThrow(/built-in|nativo/);
    expect(() => addAgent(c, { id: 'Bad Id' })).toThrow(/not valid|vale/);
  });

  it('does not change the config it was given', () => {
    const c = base();
    const before = structuredClone(c);
    addAgent(c, { id: 'writer' });
    updateAgent(c, 'deep', { instructions: 'x' });
    expect(c).toEqual(before);
  });

  it('edits an agent, keeping its id and its system flag', () => {
    const c = updateAgent(addAgent(base(), { id: 'writer' }), 'writer', { name: 'Scribe', permission: 'worktree', stages: ['code'], id: 'other', system: true } as never);
    expect(c.agents.team.find((a) => a.id === 'writer')).toMatchObject({ name: 'Scribe', permission: 'worktree', stages: ['code'], system: false });
    expect(() => updateAgent(c, 'ghost', {})).toThrow();
  });

  it('writes the model role and instructions of a system agent through to agents.roles, which the ceremonies read', () => {
    const c = updateAgent(base(), 'turn', { model: { role: 'deep', provider: '', model: '' }, instructions: 'short turns' });
    expect(c.agents.roles.turn).toMatchObject({ modelRole: 'deep', extraInstructions: 'short turns' });
    expect(c.agents.team.find((a) => a.id === 'turn')).toMatchObject({ model: { role: 'deep' }, instructions: 'short turns', system: true });
    const explicit = updateAgent(c, 'turn', { model: { role: null, provider: 'anthropic', model: 'sonnet' } });
    expect(explicit.agents.roles.turn.modelRole).toBe('deep');
    expect(validateConfig(explicit).errors).toEqual([]);
  });

  it('removes an agent the person made and clears the stages that named it, but never a system agent', () => {
    const c = removeAgent(base(), 'planner');
    expect(c.agents.team.some((a) => a.id === 'planner')).toBe(false);
    expect(c.devCycle.stages[0].agentId).toBeUndefined();
    expect(validateConfig(c).errors).toEqual([]);
    for (const role of LLM_ROLES) expect(() => removeAgent(c, role)).toThrow(/built in|nativo/);
    expect(() => removeAgent(c, 'ghost')).toThrow();
  });

  it('survives a trip through validation with the system agents still there', () => {
    const c = base();
    c.agents.team = c.agents.team.filter((a) => a.id !== 'fix');
    expect(withConfigDefaults(c).agents.team.some((a) => a.id === 'fix' && a.system)).toBe(true);
    expect(ensureSystemAgents([]).map((a) => a.id)).toEqual([...LLM_ROLES]);
  });
});

describe('who works a stage', () => {
  const c = withStages(neutralConfig());
  c.agents.team.push(newAgent({ id: 'planner' }), newAgent({ id: 'coder', stages: ['code'] }), newAgent({ id: 'second', stages: ['code'] }));

  it('is the agent the stage names, else the first agent that lists it, else nobody', () => {
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'plan')?.id).toBe('planner');
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'code')?.id).toBe('coder');
    c.agents.team = c.agents.team.filter((a) => a.id !== 'coder' && a.id !== 'second');
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'code')).toBeNull();
  });

  it('is nobody for a gate and for a stage the cycle does not have', () => {
    c.agents.team.push(newAgent({ id: 'gatekeeper', stages: ['gate'] }));
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'gate')).toBeNull();
    expect(stageAgent(c.agents.team, c.devCycle.stages, 'ghost')).toBeNull();
  });

  it('drops stage ids the cycle lacks from every agent', () => {
    const team = pruneAgentStages([newAgent({ id: 'a', stages: ['plan', 'gone'] }), newAgent({ id: 'b', stages: ['plan'] })], c.devCycle);
    expect(team.map((a) => a.stages)).toEqual([['plan'], ['plan']]);
  });
});

describe('autonomy of each agent', () => {
  it('is off for the system agents and for an agent nobody said anything about', () => {
    expect(systemAgents().map((a) => a.autonomous)).toEqual([false, false, false, false, false]);
    expect(newAgent({ id: 'writer' }).autonomous).toBe(false);
    const r = validateConfig({ schemaVersion: 4, agents: { team: [{ id: 'writer', name: 'Writer' }, { id: 'scribe', name: 'Scribe', autonomous: true }] } });
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.filter((a) => !a.system).map((a) => [a.id, a.autonomous])).toEqual([['writer', false], ['scribe', true]]);
  });

  it('is a boolean the schema checks and describes', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.team.push({ id: 'x', name: 'X', autonomous: 'yes' });
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(['agents.team[5].autonomous']);
    expect(CONFIG_SCHEMA.properties?.agents.properties?.team.items?.properties?.autonomous.description).toMatch(/Runs by itself/);
  });

  it('is edited like any other field, and a system agent keeps ceremonies untouched by it', () => {
    const c = addAgent(neutralConfig(), { id: 'writer' });
    expect(updateAgent(c, 'writer', { autonomous: true }).agents.team.find((a) => a.id === 'writer')?.autonomous).toBe(true);
    const sys = updateAgent(c, 'turn', { autonomous: true });
    expect(sys.agents.team.find((a) => a.id === 'turn')?.autonomous).toBe(true);
    expect(sys.agents.roles).toEqual(c.agents.roles);
  });

  it('warns when an agent that works no stage is autonomous: there is nothing for it to run', () => {
    const idle = withStages(neutralConfig());
    idle.agents.team.push(newAgent({ id: 'planner', stages: ['plan'], autonomous: true }), newAgent({ id: 'idle', autonomous: true }), newAgent({ id: 'quiet' }));
    const r = validateConfig(idle);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.path)).toEqual(['agents.team[6].autonomous']);
    // An agent a stage names counts as working it.
    idle.devCycle.stages[2].agentId = 'idle';
    expect(validateConfig(idle).warnings.map((w) => w.path)).toEqual(['devCycle.stages[2].agentId']);
  });

  it('comes from the migration as off for the five system agents', () => {
    const v3 = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    v3.schemaVersion = 3;
    delete v3.agents.team;
    expect(migrateConfig(v3, { legacyInstall: false }).config.agents.team.map((a) => a.autonomous)).toEqual([false, false, false, false, false]);
    // A v4 file written before the flag existed gets it off.
    const old = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    old.agents.team.push({ id: 'writer', name: 'Writer', permission: 'read' });
    for (const a of old.agents.team) delete a.autonomous;
    const r = migrateConfig(old, { legacyInstall: false });
    expect(r.changed).toBe(false);
    expect(r.config.agents.team.every((a) => a.autonomous === false)).toBe(true);
  });
});
