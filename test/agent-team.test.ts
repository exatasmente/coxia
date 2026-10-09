import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, migrateConfig, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { addAgent, ensureSystemAgents, isDraft, isSystemId, newAgent, pruneAgentStages, removeAgent, stageAgent, systemAgents, toolsForAgent, updateAgent, workingTeam } from '../src/shared/config/team';
import { CONFIG_SCHEMA_VERSION, LLM_ROLES, type WorkspaceConfig } from '../src/shared/config/types';
import { CATALOGS } from '../src/shared/i18n';

type Doc = Record<string, any>;

const withStages = (c: WorkspaceConfig): WorkspaceConfig => {
  c.devCycle.stages = [
    { id: 'plan', label: 'Plan', match: [], kind: 'development', rank: 1, type: 'work', agentId: 'planner' },
    { id: 'gate', label: 'Gate', match: [], kind: 'development', rank: 2, type: 'gate' },
    { id: 'code', label: 'Code', match: [], kind: 'development', rank: 3, type: 'work' },
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
    const r = validateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION, agents: { team: [{ id: 'writer', name: 'Writer' }] } });
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.map((a) => a.id)).toEqual(['writer', ...LLM_ROLES]);
    expect(r.config?.agents.team[0]).toMatchObject({ job: '', permission: 'read', stages: [], system: false, model: { role: 'deep', provider: '', model: '' } });
  });

  it('are seeded from agents.roles when they have to be added back', () => {
    const roles = neutralConfig().agents.roles;
    const r = validateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION, agents: { roles: { ...roles, deep: { ...roles.deep, modelRole: 'turn', extraInstructions: 'dig' } }, team: [] } });
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
        c.devCycle.stages[0].produces = [bad];
      });
      expect(r.ok, bad).toBe(false);
    }
    expect(errorsOf((c) => (c.devCycle.stages[0].produces = ['1_SPEC.md'])).ok).toBe(true);
    expect(errorsOf((c) => (c.devCycle.stages[0].produces = ['a.md', 'a.md'])).ok).toBe(false);
  });

  it('refuses an unknown permission and a field the schema does not know', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.team.push({ id: 'x', name: 'X', permission: 'root', extra: 1 });
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(expect.arrayContaining(['agents.team[5].permission', 'agents.team[5].extra']));
  });

  it('describes every agent field in the schema', () => {
    const team = CONFIG_SCHEMA.properties?.agents.properties?.team;
    expect(Object.keys(team?.items?.properties ?? {})).toEqual(['id', 'name', 'job', 'model', 'stages', 'permission', 'tracker', 'shell', 'allowedCommands', 'tools', 'autonomous', 'turnsTo', 'squad', 'draft', 'screen', 'allowedHosts', 'browserProfile', 'instructions', 'system']);
    expect(team?.items?.required).toEqual(['id', 'name']);
  });
});

describe('the migration to schema 5', () => {
  const v4 = (change: (c: Doc) => void = () => undefined): Doc => {
    const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    c.schemaVersion = 4;
    delete c.agents.team;
    change(c);
    return c;
  };

  it('seeds the five system agents from agents.roles, keeping the person\'s model role and instructions', () => {
    const r = migrateConfig(
      v4((c) => {
        c.agents.roles.deep.modelRole = 'turn';
        c.agents.roles.deep.extraInstructions = 'dig deep';
      }),
      { legacyInstall: false },
    );
    expect(r.fromVersion).toBe(4);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.agents.team.map((a) => a.id)).toEqual([...LLM_ROLES]);
    expect(r.config.agents.team.find((a) => a.id === 'deep')).toMatchObject({ system: true, model: { role: 'turn' }, instructions: 'dig deep' });
    expect(r.notes.join(' ')).toContain('agent team');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('leaves a team that is already there alone, and a file with no agents section to the defaults', () => {
    const own = v4((c) => (c.agents.team = [{ id: 'writer', name: 'Writer' }]));
    expect(migrateConfig(own, { legacyInstall: false }).config.agents.team.map((a) => a.id)).toEqual(['writer', ...LLM_ROLES]);
    const bare = migrateConfig({ schemaVersion: 4, language: 'en' }, { legacyInstall: false });
    expect(bare.config.agents.team).toEqual(systemAgents());
    expect(bare.config.language).toBe('en');
  });

  it('carries a v2 file through every step', () => {
    const v2 = v4((c) => {
      c.schemaVersion = 2;
      delete c.devCycle.priority;
    });
    const r = migrateConfig(v2, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
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
    // the stage it worked is left with no agent, which the flow check refuses to save
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(['devCycle.stages[0].agentId']);
    expect(validateConfig(c, { tolerateFlow: true }).errors).toEqual([]);
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
    const r = validateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION, agents: { team: [{ id: 'writer', name: 'Writer' }, { id: 'scribe', name: 'Scribe', autonomous: true }] } });
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
    const v4 = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    v4.schemaVersion = 4;
    delete v4.agents.team;
    expect(migrateConfig(v4, { legacyInstall: false }).config.agents.team.map((a) => a.autonomous)).toEqual([false, false, false, false, false]);
    // A file written before the flag existed gets it off.
    const old = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    old.agents.team.push({ id: 'writer', name: 'Writer', permission: 'read' });
    for (const a of old.agents.team) delete a.autonomous;
    const r = migrateConfig(old, { legacyInstall: false });
    expect(r.changed).toBe(false);
    expect(r.config.agents.team.every((a) => a.autonomous === false)).toBe(true);
  });
});

describe('the tools an agent uses', () => {
  it('follow the workspace when the agent names none, and override it field by field when it does', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.tools = { files: true, skills: true, trackerMcp: true, trackerMcpServer: '', vcsCli: true, subagents: true };
    c.agents.team.push({ id: 'reader', name: 'Reader', tools: { files: true } });
    const made = validateConfig(c).config!;
    const up = made.agents.team.find((a) => a.id === 'reader')!;
    const plain = made.agents.team.find((a) => !a.tools)!;
    // Absent: the workspace's tools.
    expect(toolsForAgent(made, plain)).toEqual(made.agents.tools);
    // Present: what the agent said overrides, and what it left out falls back to the workspace's.
    expect(toolsForAgent(made, up)).toMatchObject({ files: true, skills: true, vcsCli: true });
    const off = { ...made.agents.tools, files: false };
    const only = { ...made, agents: { ...made.agents, tools: off } };
    // An agent may turn on a tool the workspace turned off, for itself alone.
    expect(toolsForAgent(only, up).files).toBe(true);
    expect(toolsForAgent(only, plain).files).toBe(false);
  });

  it('is accepted by the schema and the field is described', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.team.push({ id: 'reader', name: 'Reader', tools: { files: 'yes' } });
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(['agents.team[5].tools.files']);
    expect(CONFIG_SCHEMA.properties?.agents.properties?.team.items?.properties?.tools.description).toMatch(/overrid/);
  });

  it('comes from the migration as absent for every agent, so nothing changes', () => {
    const v12 = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    v12.schemaVersion = 12;
    for (const a of v12.agents.team) delete a.tools;
    const r = migrateConfig(v12, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.agents.team.some((a: { tools?: unknown }) => a.tools !== undefined)).toBe(false);
    expect(r.notes.join(' ')).toContain('an agent may name the tools it uses');
  });
});

describe('a draft agent', () => {
  it('carries the mark only when it is true, so every other agent keeps the shape it had', () => {
    expect(newAgent({ id: 'writer', draft: true }).draft).toBe(true);
    expect('draft' in newAgent({ id: 'writer' })).toBe(false);
    expect('draft' in newAgent({ id: 'writer', draft: false })).toBe(false);
    expect(neutralConfig().agents.team.some((a) => 'draft' in a)).toBe(false);
  });

  it('survives validation and the defaults, and the schema describes the field', () => {
    const c = neutralConfig();
    c.agents.team.push(newAgent({ id: 'trial', draft: true }), newAgent({ id: 'writer' }));
    const r = validateConfig(c);
    expect(r.errors).toEqual([]);
    expect(r.config?.agents.team.find((a) => a.id === 'trial')?.draft).toBe(true);
    expect(r.config?.agents.team.find((a) => a.id === 'writer') && 'draft' in r.config.agents.team.find((a) => a.id === 'writer')!).toBe(false);
    expect(withConfigDefaults(JSON.parse(JSON.stringify(c))).agents.team.find((a) => a.id === 'trial')?.draft).toBe(true);
    expect(CONFIG_SCHEMA.properties?.agents.properties?.team.items?.properties?.draft.description).toMatch(/AI assistant/);
  });

  it('is refused when the mark is not a boolean', () => {
    const c = neutralConfig() as unknown as Doc;
    c.agents.team.push({ id: 'trial', name: 'Trial', draft: 'sim' });
    expect(validateConfig(c).errors.map((e) => e.path)).toEqual(['agents.team[5].draft']);
  });

  it('is told apart by isDraft, and workingTeam leaves it out', () => {
    const team = [...systemAgents(), newAgent({ id: 'trial', draft: true }), newAgent({ id: 'writer' })];
    expect(team.filter(isDraft).map((a) => a.id)).toEqual(['trial']);
    expect(workingTeam(team).map((a) => a.id)).toEqual([...LLM_ROLES, 'writer']);
    // Without a draft the very same list comes back: nothing is copied for the common case.
    const plain = [...systemAgents(), newAgent({ id: 'writer' })];
    expect(workingTeam(plain)).toBe(plain);
  });

  it('loses the mark when the editor saves it as undefined, and keeps the rest', () => {
    const c = neutralConfig();
    c.agents.team.push(newAgent({ id: 'trial', draft: true, job: 'tests things' }));
    const saved = updateAgent(c, 'trial', { draft: undefined, name: 'Trial' });
    const a = saved.agents.team.find((x) => x.id === 'trial')!;
    expect('draft' in a).toBe(false);
    expect(a).toMatchObject({ name: 'Trial', job: 'tests things' });
    expect(validateConfig(saved).errors).toEqual([]);
  });

  it('comes from the migration as absent for every agent, so nothing changes', () => {
    const v18 = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    v18.schemaVersion = 18;
    v18.agents.team.push({ id: 'writer', name: 'Writer', job: '', model: { role: 'deep', provider: '', model: '' }, stages: [], permission: 'read', tracker: 'none', shell: 'none', autonomous: false, turnsTo: null, instructions: '', system: false });
    const r = migrateConfig(v18, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.agents.team.some((a) => a.draft !== undefined)).toBe(false);
    expect(r.notes.join(' ')).toContain('marked as a draft');
  });
});
