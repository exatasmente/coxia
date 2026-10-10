import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, collectSecretRequirements, mergeDeep, neutralConfig, newProvider, stageRank, validateConfig, withConfigDefaults } from '../src/shared/config';
import type { JsonSchema } from '../src/shared/config';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';
import { newAgent } from '../src/shared/config/team';
import { TEST_STAGES, exampleProfile } from './helpers/config';
import { validateSchema } from '../src/shared/config/jsonSchema';

// Keys of every object the schema describes, as dotted paths ("llm.providers[].id"): what a config can hold.
function schemaKeys(s: JsonSchema, path = ''): string[] {
  const out: string[] = [];
  for (const [k, child] of Object.entries(s.properties ?? {})) {
    const here = path ? `${path}.${k}` : k;
    out.push(here, ...schemaKeys(child, here));
  }
  if (s.items) out.push(...schemaKeys(s.items, `${path}[]`));
  return out;
}

function valueKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => valueKeys(x, `${path}[]`));
  if (typeof v !== 'object' || v === null) return [];
  return Object.entries(v).flatMap(([k, x]) => {
    const here = path ? `${path}.${k}` : k;
    return [here, ...valueKeys(x, here)];
  });
}

describe('config schema', () => {
  it('accepts the neutral defaults', () => {
    const r = validateConfig(neutralConfig());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('reads a config stored without the release settings of the runner as one whose merges need an approval on the host, with no migration step', () => {
    const { release: _gone, ...runner } = neutralConfig().runner;
    const r = validateConfig({ ...neutralConfig(), runner });
    expect(r.errors).toEqual([]);
    expect(r.config?.runner.release).toEqual({ soleMaintainer: false });
    expect(validateConfig({ ...neutralConfig(), runner: { ...runner, release: { soleMaintainer: 'yes' } } }).ok).toBe(false);
  });

  it('has the learned procedures switch in the type, the schema and the defaults: on for a new workspace, a boolean, and nothing else allowed beside it', () => {
    expect(neutralConfig().runner.procedures).toBe(true);
    expect(CONFIG_SCHEMA.properties?.runner?.properties?.procedures?.type).toBe('boolean');
    expect(CONFIG_SCHEMA.properties?.runner?.additionalProperties).toBe(false);
    expect(validateConfig({ ...neutralConfig(), runner: { ...neutralConfig().runner, procedures: false } }).ok).toBe(true);
    expect(validateConfig({ ...neutralConfig(), runner: { ...neutralConfig().runner, procedures: 'yes' } }).errors.map((e) => e.path)).toEqual(['runner.procedures']);
  });

  it('has the shared memory switch in the type, the schema and the defaults: on for a new workspace, a boolean, and the roadmap pointer is an optional path', () => {
    expect(neutralConfig().runner.sharedMemory).toBe(true);
    expect(CONFIG_SCHEMA.properties?.runner?.properties?.sharedMemory?.type).toBe('boolean');
    expect(validateConfig({ ...neutralConfig(), runner: { ...neutralConfig().runner, sharedMemory: false } }).config?.runner.sharedMemory).toBe(false);
    expect(validateConfig({ ...neutralConfig(), runner: { ...neutralConfig().runner, sharedMemory: 'yes' } }).errors.map((e) => e.path)).toEqual(['runner.sharedMemory']);
    expect(neutralConfig().docs.roadmapFile).toBeUndefined();
    expect(validateConfig({ ...neutralConfig(), docs: { ...neutralConfig().docs, roadmapFile: '~/project/ROADMAP.md' } }).config?.docs.roadmapFile).toBe('~/project/ROADMAP.md');
    expect(validateConfig({ ...neutralConfig(), docs: { ...neutralConfig().docs, roadmapFile: null } }).ok).toBe(true);
    expect(validateConfig({ ...neutralConfig(), docs: { ...neutralConfig().docs, roadmapFile: 3 } }).errors.map((e) => e.path)).toEqual(['docs.roadmapFile']);
  });

  it('reads a config stored without the conversation limits as the defaults, and refuses a limit outside its range', () => {
    const { conversations: _gone, ...runner } = neutralConfig().runner;
    const r = validateConfig({ ...neutralConfig(), runner });
    expect(r.errors).toEqual([]);
    expect(r.config?.runner.conversations).toEqual({ roundsPerConversation: 6, perStage: 3 });
    const out = (c: { roundsPerConversation: number; perStage: number }) => validateConfig({ ...neutralConfig(), runner: { ...runner, conversations: c } }).errors.map((e) => e.path);
    expect(out({ roundsPerConversation: 0, perStage: 1 })).toEqual(['runner.conversations.roundsPerConversation']);
    expect(out({ roundsPerConversation: 51, perStage: 1 })).toEqual(['runner.conversations.roundsPerConversation']);
    expect(out({ roundsPerConversation: 6, perStage: 0 })).toEqual(['runner.conversations.perStage']);
    expect(out({ roundsPerConversation: 6, perStage: 21 })).toEqual(['runner.conversations.perStage']);
    expect(validateConfig({ ...neutralConfig(), runner: { ...runner, conversations: { roundsPerConversation: 6, perStage: 3, extra: 1 } } }).ok).toBe(false);
  });

  it('keeps the documentation sources as they were: the same fields and types, and autoDetect on by default', () => {
    // What autoDetect does with them is the app's behaviour; the format of the file did not change, so there is no migration step for them.
    const docs = CONFIG_SCHEMA.properties?.docs;
    expect(Object.keys(docs?.properties ?? {})).toEqual(['autoDetect', 'claudeMdRoots', 'skillsDirs', 'rulesDirs', 'agentsDirs', 'knowledgeDirs', 'mcpConfigFiles', 'specsDir', 'roadmapFile']);
    expect(docs?.properties?.autoDetect.type).toBe('boolean');
    expect(neutralConfig().docs).toEqual({ autoDetect: true, claudeMdRoots: [], skillsDirs: [], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [], specsDir: null });
    const filled = { ...neutralConfig(), docs: { autoDetect: true, claudeMdRoots: ['~/a'], skillsDirs: ['~/b'], rulesDirs: [], agentsDirs: [], knowledgeDirs: [], mcpConfigFiles: [], specsDir: null } };
    expect(validateConfig(filled).config?.docs).toEqual(filled.docs);
  });

  it('accepts the example legacy profile merged over the defaults', () => {
    const merged = mergeDeep(neutralConfig(), exampleProfile().config);
    expect(validateConfig(merged).errors).toEqual([]);
  });

  it('describes exactly the keys the defaults and the legacy profile can hold (types, schema and defaults cannot drift apart)', () => {
    const declared = new Set(schemaKeys(CONFIG_SCHEMA));
    const holds = new Set([...valueKeys(neutralConfig()), ...valueKeys(mergeDeep(neutralConfig(), exampleProfile().config))]);
    // promptOverrides is a map keyed by prompt id: its keys are data, not fields.
    expect([...holds].filter((k) => !declared.has(k) && !k.startsWith('devCycle.promptOverrides.'))).toEqual([]);
    // Fields that only appear when a list has items, or whose default is an empty list: the schema may know more than the defaults hold.
    // The pool of a role and the score overrides are absent from every default (absent = no fallbacks); a test below holds them to the schema.
    const optionalPool = (k: string) => k.startsWith('llm.scoreOverrides') || /^llm\.roles\.[a-z]+\.(fallbacks|activities|images|contextWindow|echoReasoning|offer)(\.|$)/.test(k) || k.startsWith('llm.effort');
    // The roadmap pointer is absent from every default (absent = the agents are told there is no roadmap).
    const optionalOnlyInItems = [...declared].filter((k) => !holds.has(k) && !k.includes('[]') && !optionalPool(k) && k !== 'docs.roadmapFile');
    expect(optionalOnlyInItems).toEqual([]);
  });

  it('documents every field', () => {
    const missing: string[] = [];
    const walk = (s: JsonSchema, path: string) => {
      if (!s.description && path && !path.endsWith('[]')) missing.push(path);
      for (const [k, c] of Object.entries(s.properties ?? {})) walk(c, path ? `${path}.${k}` : k);
      if (s.items) walk(s.items, `${path}[]`);
    };
    walk(CONFIG_SCHEMA, '');
    expect(missing).toEqual([]);
  });

  it('is plain JSON, so it can be emitted as a file', () => {
    expect(JSON.parse(JSON.stringify(CONFIG_SCHEMA))).toEqual(CONFIG_SCHEMA);
  });

  it('reports the path and the reason of each problem', () => {
    const bad = { ...neutralConfig(), language: 'fr', schedule: { ...neutralConfig().schedule, preDaily: '25:00' }, llm: { providers: [{ id: 'Bad Id', kind: 'ollama', baseUrl: 5 }] } };
    const paths = validateConfig(bad).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['language', 'schedule.preDaily', 'llm.providers[0].id', 'llm.providers[0].kind', 'llm.providers[0].baseUrl']));
  });

  it('refuses unknown fields and a newer schema', () => {
    expect(validateConfig({ ...neutralConfig(), extra: 1 }).errors).toContainEqual({ path: 'extra', message: 'is not a known field' });
    expect(validateConfig({ ...neutralConfig(), schemaVersion: CONFIG_SCHEMA_VERSION + 1 }).errors[0].message).toMatch(/newer app/);
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
  });

  describe('model pools', () => {
    const withProviders = () => {
      const c = neutralConfig();
      c.llm.providers.push(newProvider({ id: 'spare', kind: 'openai-compatible', baseUrl: 'http://example.com/v1' }));
      return c;
    };
    const role = (c: ReturnType<typeof neutralConfig>, pool: Record<string, unknown>) => ({ ...c, llm: { ...c.llm, roles: { ...c.llm.roles, deep: { ...c.llm.roles.deep, ...pool } } } });

    it('carry no pool by default: no fallbacks, no activities, no overrides, no facts', () => {
      const c = neutralConfig();
      for (const r of Object.values(c.llm.roles)) expect(Object.keys(r).sort()).toEqual(['model', 'provider']);
      expect(c.llm.scoreOverrides).toBeUndefined();
      expect(CONFIG_SCHEMA.properties?.llm.properties?.roles.properties?.deep.properties?.fallbacks.maxItems).toBe(8);
    });

    it('accepts fallbacks and a list per activity, and the facts of an entry', () => {
      const c = withProviders();
      const ok = role(c, { fallbacks: [{ provider: 'spare', model: 'model-a', images: true, contextWindow: 128_000, echoReasoning: true }], activities: { screen: [{ provider: 'spare', model: 'model-b', images: true }], shell: [{ provider: 'anthropic', model: 'haiku' }] } });
      const r = validateConfig(ok);
      expect(r.errors).toEqual([]);
      expect(r.config?.llm.roles.deep.fallbacks?.[0]).toMatchObject({ model: 'model-a', contextWindow: 128_000 });
      expect(validateConfig({ ...c, llm: { ...c.llm, scoreOverrides: { floors: { shell: 80 }, models: { 'model-a': { edit: 70.5 } } } } }).errors).toEqual([]);
    });

    it('refuses a wrong type, an unknown field, a list that is too long and a score out of range', () => {
      const c = withProviders();
      const entry = (n: number) => ({ provider: 'spare', model: `model-${n}` });
      const paths = (x: unknown) => validateConfig(x).errors.map((e) => e.path);
      expect(paths(role(c, { fallbacks: 'model-a' }))).toEqual(['llm.roles.deep.fallbacks']);
      expect(paths(role(c, { fallbacks: [{ provider: 'spare', model: 'a b' }] }))).toEqual(['llm.roles.deep.fallbacks[0].model']);
      expect(paths(role(c, { fallbacks: [{ provider: 'spare', model: 'model-a', extra: 1 }] }))).toEqual(['llm.roles.deep.fallbacks[0].extra']);
      expect(paths(role(c, { fallbacks: [{ provider: 'spare', model: 'model-a', contextWindow: 10 }] }))).toEqual(['llm.roles.deep.fallbacks[0].contextWindow']);
      expect(paths(role(c, { fallbacks: Array.from({ length: 9 }, (_, i) => entry(i)) }))).toEqual(['llm.roles.deep.fallbacks']);
      expect(paths(role(c, { activities: { sleep: [entry(1)] } }))).toEqual(['llm.roles.deep.activities.sleep']);
      expect(paths({ ...c, llm: { ...c.llm, scoreOverrides: { floors: { shell: 101 } } } })).toEqual(['llm.scoreOverrides.floors.shell']);
    });

    it('refuses an entry of a provider that does not exist and a model listed twice, and warns about a screen entry that takes no image', () => {
      const c = withProviders();
      expect(validateConfig(role(c, { fallbacks: [{ provider: 'gone', model: 'model-a' }] })).errors.map((e) => e.path)).toEqual(['llm.roles.deep.fallbacks[0].provider']);
      const first = c.llm.roles.deep;
      expect(validateConfig(role(c, { fallbacks: [{ provider: first.provider, model: first.model }] })).errors.map((e) => e.path)).toEqual(['llm.roles.deep.fallbacks[0]']);
      expect(validateConfig(role(c, { activities: { edit: [{ provider: 'spare', model: 'm' }, { provider: 'spare', model: 'm' }] } })).errors.map((e) => e.path)).toEqual(['llm.roles.deep.activities.edit[1]']);
      const warned = validateConfig(role(c, { activities: { screen: [{ provider: 'spare', model: 'm', images: false }] } }));
      expect(warned.ok).toBe(true);
      expect(warned.warnings.map((w) => w.path)).toEqual(['llm.roles.deep.activities.screen[0]']);
    });

    it('an agent with a model of its own carries a pool too; one on a role ignores it, with a warning', () => {
      const c = withProviders();
      const own = newAgent({ id: 'writer', name: 'Writer', model: { role: null, provider: 'spare', model: 'model-a', fallbacks: [{ provider: 'anthropic', model: 'haiku' }] } });
      const ok = validateConfig({ ...c, agents: { ...c.agents, team: [...c.agents.team, own] } });
      expect(ok.errors).toEqual([]);
      expect(ok.config?.agents.team.at(-1)?.model.fallbacks).toEqual([{ provider: 'anthropic', model: 'haiku' }]);
      const bad = newAgent({ id: 'writer', name: 'Writer', model: { role: null, provider: 'spare', model: 'model-a', fallbacks: [{ provider: 'gone', model: 'x' }] } });
      expect(validateConfig({ ...c, agents: { ...c.agents, team: [...c.agents.team, bad] } }).errors.map((e) => e.path)).toEqual([`agents.team[${c.agents.team.length}].model.fallbacks[0].provider`]);
      const borrowed = newAgent({ id: 'writer', name: 'Writer', model: { role: 'deep', provider: '', model: '', fallbacks: [{ provider: 'spare', model: 'x' }] } });
      const warn = validateConfig({ ...c, agents: { ...c.agents, team: [...c.agents.team, borrowed] } });
      expect(warn.ok).toBe(true);
      expect(warn.warnings.map((w) => w.path)).toContain(`agents.team[${c.agents.team.length}].model`);
    });

    it('newAgent leaves an empty pool out, so an agent without one keeps the shape it had', () => {
      const a = newAgent({ id: 'writer', name: 'Writer', model: { role: null, provider: 'spare', model: 'm', fallbacks: [], activities: { edit: [] } } });
      expect(a.model).toEqual({ role: null, provider: 'spare', model: 'm' });
    });
  });

  describe('the pool mode', () => {
    const withStage = () => {
      const c = neutralConfig();
      c.devCycle.stages = [structuredClone(TEST_STAGES[0])];
      return c;
    };
    const stageOf = (c: ReturnType<typeof neutralConfig>) => c.devCycle.stages[0];

    it('is in the neutral config as delegate, and absent from an agent and a stage until one chooses', () => {
      const c = neutralConfig();
      expect(c.llm.poolMode).toBe('delegate');
      expect(c.agents.team.every((a) => !('poolMode' in a))).toBe(true);
      expect(c.devCycle.stages.every((s) => !('poolMode' in s))).toBe(true);
      expect(newAgent({ id: 'x' })).not.toHaveProperty('poolMode');
      expect(newAgent({ id: 'x', poolMode: 'switch' }).poolMode).toBe('switch');
    });

    it('accepts the three modes in the workspace, an agent, a stage and a flow', () => {
      for (const mode of ['fallback', 'switch', 'delegate'] as const) {
        const c = withStage();
        c.llm.poolMode = mode;
        c.agents.team[0].poolMode = mode;
        stageOf(c).poolMode = mode;
        c.devCycle.flows = { release: [{ ...stageOf(c), poolMode: mode }] };
        expect(validateConfig(c).errors).toEqual([]);
      }
    });

    it('refuses another value, by path', () => {
      const c = withStage();
      const paths = (x: unknown) => validateConfig(x).errors.map((e) => e.path);
      expect(paths({ ...c, llm: { ...c.llm, poolMode: 'both' } })).toEqual(['llm.poolMode']);
      expect(paths({ ...c, agents: { ...c.agents, team: [{ ...c.agents.team[0], poolMode: 'both' }, ...c.agents.team.slice(1)] } })).toEqual(['agents.team[0].poolMode']);
      expect(paths({ ...c, devCycle: { ...c.devCycle, stages: [{ ...stageOf(c), poolMode: 1 }, ...c.devCycle.stages.slice(1)] } })).toEqual(['devCycle.stages[0].poolMode']);
    });

    it('describes the three fields', () => {
      const props = CONFIG_SCHEMA.properties!;
      expect(props.llm.properties?.poolMode.enum).toEqual(['fallback', 'switch', 'delegate']);
      expect(props.agents.properties?.team.items?.properties?.poolMode.enum).toEqual(['fallback', 'switch', 'delegate']);
      expect(props.devCycle.properties?.stages.items?.properties?.poolMode.enum).toEqual(['fallback', 'switch', 'delegate']);
    });
  });

  describe('what the provider offers', () => {
    const withProvider = (features?: Record<string, unknown>) => {
      const c = neutralConfig();
      c.llm.providers.push({ ...newProvider({ id: 'srv', kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1' }), ...(features ? { features } : {}) } as never);
      return c;
    };
    const errors = (x: unknown) => validateConfig(x).errors.map((e) => `${e.path}: ${e.message}`);

    it('is off by default: no features on a provider, no offer on a model, no effort, flex on', () => {
      const c = neutralConfig();
      expect(c.llm.effort).toBeUndefined();
      expect(c.runner.flex).toBe(true);
      expect(Object.keys(c.llm.roles.deep).sort()).toEqual(['model', 'provider']);
      expect(newProvider({ id: 'x', kind: 'openai-compatible', baseUrl: 'http://example.com/v1' })).not.toHaveProperty('features');
      expect(withConfigDefaults({ llm: { providers: [] } } as never).llm.providers).toEqual([]);
    });

    it('accepts the features of a provider, the offer of a model, an effort per activity and the flex switch', () => {
      const c = withProvider({ serviceTier: true, failFast: true, reasoningEffort: false, catalogUrl: 'https://api.example.com/models/list' });
      c.llm.effort = { explore: 'low', shell: 'default', write: 'none', edit: 'high' };
      c.runner.flex = false;
      const offer = { flex: true, effort: true, deprecated: 1790000000, replacedBy: 'model-b' };
      c.llm.roles.deep = { ...c.llm.roles.deep, offer, fallbacks: [{ provider: 'srv', model: 'model-a', offer }] };
      expect(validateConfig(c).errors).toEqual([]);
      expect(validateConfig(c).config?.llm.roles.deep.offer).toEqual(offer);
    });

    it('refuses what is not a boolean, an unknown level, an unknown key and an offer that is not a number', () => {
      expect(errors(withProvider({ serviceTier: 'yes' }))).toEqual(['llm.providers[1].features.serviceTier: expected boolean, got string']);
      const c = neutralConfig();
      expect(validateConfig({ ...c, llm: { ...c.llm, effort: { shell: 'max' } } }).errors.map((e) => e.path)).toEqual(['llm.effort.shell']);
      expect(validateConfig({ ...c, llm: { ...c.llm, effort: { plan: 'low' } } }).errors.map((e) => e.path)).toEqual(['llm.effort.plan']);
      expect(validateConfig({ ...c, runner: { ...c.runner, flex: 'on' } }).errors.map((e) => e.path)).toEqual(['runner.flex']);
      const bad = { ...c, llm: { ...c.llm, roles: { ...c.llm.roles, deep: { ...c.llm.roles.deep, offer: { deprecated: 'soon' } } } } };
      expect(validateConfig(bad).errors.map((e) => e.path)).toEqual(['llm.roles.deep.offer.deprecated']);
    });

    it('holds the catalog address to the origin of the provider: the key is never sent elsewhere', () => {
      expect(errors(withProvider({ catalogUrl: 'https://api.example.com/models/list' }))).toEqual([]);
      expect(errors(withProvider({ catalogUrl: 'https://other.example.com/models/list' }))).toEqual([expect.stringContaining('llm.providers.srv.features.catalogUrl: must have the same origin')]);
      expect(errors(withProvider({ catalogUrl: 'http://api.example.com/models/list' }))).toEqual([expect.stringContaining('same origin')]);
      expect(errors(withProvider({ catalogUrl: 'https://api.example.com:8443/models/list' }))).toEqual([expect.stringContaining('same origin')]);
      expect(errors(withProvider({ catalogUrl: 'file:///etc/passwd' }))).toEqual([expect.stringContaining('http:// or https://')]);
      expect(errors(withProvider({ catalogUrl: 'not a url' }))).toEqual([expect.stringContaining('http:// or https://')]);
    });

    it('warns when features sit on a provider the Claude Agent SDK serves', () => {
      const c = neutralConfig();
      c.llm.providers.push({ ...newProvider({ id: 'cl', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }), features: { serviceTier: true } } as never);
      expect(validateConfig(c).warnings.map((w) => w.path)).toContain('llm.providers.cl.features');
    });

    it('describes the new fields', () => {
      const llm = CONFIG_SCHEMA.properties!.llm.properties!;
      expect(Object.keys(llm.providers.items!.properties!.features.properties!)).toEqual(['serviceTier', 'failFast', 'reasoningEffort', 'catalogUrl']);
      expect(llm.effort.properties?.shell.enum).toEqual(['none', 'low', 'medium', 'high', 'default']);
      expect(Object.keys(llm.roles.properties!.deep.properties!.offer.properties!)).toEqual(['flex', 'effort', 'deprecated', 'replacedBy']);
      expect(CONFIG_SCHEMA.properties!.runner.properties?.flex.type).toBe('boolean');
    });
  });

  it('accepts the draft mark of an agent and refuses one that is not a boolean', () => {
    const c = neutralConfig();
    const agent = { id: 'trial', name: 'Trial', draft: true };
    expect(validateConfig({ ...c, agents: { ...c.agents, team: [...c.agents.team, agent] } }).ok).toBe(true);
    const bad = validateConfig({ ...c, agents: { ...c.agents, team: [...c.agents.team, { ...agent, draft: 'sim' }] } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.path)).toEqual([`agents.team[${c.agents.team.length}].draft`]);
  });

  describe('the screen, hosts and browser profile of an agent', () => {
    const withAgent = (extra: Record<string, unknown>) => {
      const c = neutralConfig();
      return { ...c, agents: { ...c.agents, team: [...c.agents.team, { id: 'web', name: 'Web', ...extra }] } };
    };
    const at = (field: string) => `agents.team[${neutralConfig().agents.team.length}].${field}`;

    it('accepts them, and the defaults hold none', () => {
      const r = validateConfig(withAgent({ screen: true, allowedHosts: ['example.com', 'docs.example.com'], browserProfile: true }));
      expect(r.errors).toEqual([]);
      expect(r.config?.agents.team.find((a) => a.id === 'web')).toMatchObject({ screen: true, allowedHosts: ['example.com', 'docs.example.com'], browserProfile: true });
      expect(neutralConfig().agents.team.some((a) => 'screen' in a || 'allowedHosts' in a || 'browserProfile' in a)).toBe(false);
    });

    it('refuses a switch that is not a boolean', () => {
      expect(validateConfig(withAgent({ screen: 'sim' })).errors.map((e) => e.path)).toEqual([at('screen')]);
      expect(validateConfig(withAgent({ browserProfile: 1 })).errors.map((e) => e.path)).toEqual([at('browserProfile')]);
    });

    it('holds the hosts to the rules of the registry hosts: exact lowercase names, no scheme, port, path or wildcard, at most 20', () => {
      for (const bad of ['Example.com', 'https://example.com', 'example.com:443', 'example.com/path', '*.example.com', 'localhost', 'a b.example.com']) {
        const r = validateConfig(withAgent({ allowedHosts: [bad] }));
        expect(r.ok, bad).toBe(false);
        expect(r.errors[0].path, bad).toMatch(/allowedHosts/);
      }
      expect(validateConfig(withAgent({ allowedHosts: Array.from({ length: 21 }, (_, i) => `h${i}.example.com`) })).errors.map((e) => e.path)).toContain(at('allowedHosts'));
      expect(validateConfig(withAgent({ allowedHosts: Array.from({ length: 20 }, (_, i) => `h${i}.example.com`) })).errors).toEqual([]);
    });

    it('warns about a host listed twice', () => {
      const r = validateConfig(withAgent({ allowedHosts: ['example.com', 'example.com'] }));
      expect(r.errors).toEqual([]);
      expect(r.warnings.map((w) => w.path)).toContain(at('allowedHosts'));
    });

    it('describes the three fields', () => {
      const props = CONFIG_SCHEMA.properties?.agents.properties?.team.items?.properties ?? {};
      expect(props.screen.type).toBe('boolean');
      expect(props.browserProfile.type).toBe('boolean');
      expect(props.allowedHosts.maxItems).toBe(20);
    });
  });

  it('checks references between sections', () => {
    const c = neutralConfig();
    c.llm.roles.turn.provider = 'nope';
    c.projects.repos = [{ id: 'api', path: '~/api', remoteUrl: null, vcsId: 'ghost', projectPath: null }];
    c.devCycle.stages = [{ id: 'a', label: 'A', match: ['('], kind: 'review', rank: 1 }];
    c.externalTools.cardSource.enabled = true;
    const paths = validateConfig(c).errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['llm.roles.turn.provider', 'projects.repos[0].vcsId', 'devCycle.stages[0].match[0]', 'externalTools.cardSource.command']));
  });

  it('checks the priority labels: a pattern that does not compile is an error, a repeated one a warning, and none is the default', () => {
    expect(neutralConfig().devCycle.priority).toEqual({ labels: [] });
    const c = neutralConfig();
    c.devCycle.priority.labels = ['^P0$', '[', '^P0$'];
    const r = validateConfig(c);
    expect(r.errors.map((e) => e.path)).toEqual(['devCycle.priority.labels[1]']);
    c.devCycle.priority.labels = ['^P0$', '^P1$', '^P0$'];
    expect(validateConfig(c).warnings.map((w) => w.path)).toContain('devCycle.priority.labels');
    c.devCycle.priority.labels = Array.from({ length: 21 }, (_, i) => `P${i}`);
    expect(validateConfig(c).errors[0].path).toBe('devCycle.priority.labels');
    expect(validateConfig({ ...neutralConfig(), devCycle: { ...neutralConfig().devCycle, priority: { labels: ['P0'], extra: 1 } } }).ok).toBe(false);
  });

  it('fills what a partial document leaves out and keeps what it sets', () => {
    const r = validateConfig({ schemaVersion: CONFIG_SCHEMA_VERSION, language: 'en', projects: { roots: ['~/work'] }, vcs: [{ id: 'gh', kind: 'github', host: 'github.com' }] });
    expect(r.ok).toBe(true);
    expect(r.config?.language).toBe('en');
    expect(r.config?.projects.roots).toEqual(['~/work']);
    expect(r.config?.projects.autoDiscover).toBe(true);
    expect(r.config?.vcs[0]).toMatchObject({ cliPreference: 'auto', secretRef: null, apiUrl: '' });
    expect(withConfigDefaults({ schedule: { preDaily: '10:00' } }).schedule.statusEveryMin).toBe(30);
  });

  it('lists the secrets a config needs, one entry per ref', () => {
    const c = neutralConfig();
    c.vcs = [{ id: 'gh', kind: 'github', host: 'github.com', apiUrl: '', user: 'ana', secretRef: 'vcs.gh', cliPreference: 'auto', cliCommand: null }];
    c.llm.providers.push(newProvider({ id: 'second', kind: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', secretRef: 'llm.anthropic' }));
    const reqs = collectSecretRequirements(c);
    expect(reqs.map((r) => r.ref).sort()).toEqual(['llm.anthropic', 'vcs.gh']);
    expect(reqs.find((r) => r.ref === 'llm.anthropic')?.usedBy).toEqual(['llm.providers.anthropic', 'llm.providers.second']);
  });

  it('ranks stages by the first matching pattern, as the radar did', () => {
    const rank = (s: string | null) => stageRank(TEST_STAGES, s);
    expect(rank('Test OK')).toBe(7);
    expect(rank('Ready To Test')).toBe(6);
    expect(rank('Test Fail')).toBe(6);
    expect(rank('Code Review OK')).toBe(5);
    expect(rank('STAGE:: Code Review')).toBe(4);
    expect(rank('Rejected')).toBe(3);
    expect(rank('Rejected in code review')).toBe(4);
    expect(rank('Blocked in development')).toBe(2);
    expect(rank(null)).toBe(0);
  });
});

describe('json schema subset', () => {
  it('handles types, enums, bounds, patterns and uniqueness', () => {
    const s: JsonSchema = { type: 'object', properties: { a: { type: 'integer', minimum: 1, maximum: 3 }, b: { type: 'string', pattern: '^x' }, c: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, required: ['a'], additionalProperties: false };
    expect(validateSchema({ a: 2, b: 'xy', c: ['p'] }, s)).toEqual([]);
    expect(validateSchema({ a: 4, b: 'y', c: ['p', 'p'], d: 1 }, s).map((i) => i.path)).toEqual(['a', 'b', 'c', 'd']);
    expect(validateSchema({}, s)).toEqual([{ path: 'a', message: 'is required' }]);
    expect(validateSchema({ a: 1.5 }, s)[0].message).toMatch(/expected integer/);
  });
});
