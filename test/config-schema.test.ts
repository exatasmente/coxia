import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, LEGACY_STAGES, collectSecretRequirements, legacyProfile, mergeDeep, neutralConfig, newProvider, stageRank, validateConfig, withConfigDefaults } from '../src/shared/config';
import type { JsonSchema } from '../src/shared/config';
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

  it('accepts the legacy profile merged over the defaults', () => {
    const merged = mergeDeep(neutralConfig(), legacyProfile());
    expect(validateConfig(merged).errors).toEqual([]);
  });

  it('describes exactly the keys the defaults and the legacy profile can hold (types, schema and defaults cannot drift apart)', () => {
    const declared = new Set(schemaKeys(CONFIG_SCHEMA));
    const holds = new Set([...valueKeys(neutralConfig()), ...valueKeys(mergeDeep(neutralConfig(), legacyProfile()))]);
    expect([...holds].filter((k) => !declared.has(k))).toEqual([]);
    // Fields that only appear when a list has items, or whose default is an empty list: the schema may know more than the defaults hold.
    const optionalOnlyInItems = [...declared].filter((k) => !holds.has(k) && !k.includes('[]'));
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
    expect(validateConfig({ ...neutralConfig(), schemaVersion: 3 }).errors[0].message).toMatch(/newer app/);
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
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

  it('fills what a partial document leaves out and keeps what it sets', () => {
    const r = validateConfig({ schemaVersion: 2, language: 'en', projects: { roots: ['~/work'] }, vcs: [{ id: 'gh', kind: 'github', host: 'github.com' }] });
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
    const rank = (s: string | null) => stageRank(LEGACY_STAGES, s);
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
