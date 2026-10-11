// The two pure pieces under the persona's door (#248): the arguments of a tool, checked before anything is attempted, and the path grammar of the settings tool.
import { describe, expect, it } from 'vitest';
import { ArgSpec, arg, checkArgs } from '../src/main/persona/args';
import { PathError, applyPath, parsePath, readPath } from '../src/main/persona/configPath';
import { schemaAt } from '../src/main/persona/doorOps';

describe('the short form of an argument', () => {
  it('reads the name, the type, the flags and the values of an enum', () => {
    expect(arg('run:s@!')).toEqual({ name: 'run', type: 'string', target: true, required: true });
    expect(arg('decision:e[yes,no]!')).toEqual({ name: 'decision', type: 'enum', values: ['yes', 'no'], required: true });
    expect(arg('value:t*')).toEqual({ name: 'value', type: 'text', secret: true });
    expect(arg('n:i')).toEqual({ name: 'n', type: 'integer' });
    expect(() => arg('nonsense')).toThrow();
    expect(() => arg('x:e')).toThrow();
    expect(() => arg('x:q')).toThrow();
  });
});

describe('checking the arguments of a call', () => {
  const specs: ArgSpec[] = ['id:s!', 'n:i', 'ratio:n', 'on:b', 'mode:e[a,b]', 'body:t', 'data:j'].map(arg);

  it('takes what is declared, of the type declared, and returns it without the door\'s own fields', () => {
    expect(checkArgs(specs, { op: 'x', why: 'because', id: 'r1', n: 3, ratio: 0.5, on: false, mode: 'b', body: 'text', data: { a: [1, 2] } }, true)).toEqual({ ok: true, values: { id: 'r1', n: 3, ratio: 0.5, on: false, mode: 'b', body: 'text', data: { a: [1, 2] } } });
  });

  it('refuses, naming the problem, a missing or empty required argument, a wrong type, a value outside the enum and an argument nobody declared', () => {
    const problem = (input: Record<string, unknown>) => {
      const r = checkArgs(specs, { why: 'ok', ...input }, true);
      return r.ok ? null : r.problem.key;
    };
    expect(problem({})).toBe('main.persona.door.arg.required');
    expect(problem({ id: '   ' })).toBe('main.persona.door.arg.required');
    expect(problem({ id: 5 })).toBe('main.persona.door.arg.type');
    expect(problem({ id: 'a', n: '3' })).toBe('main.persona.door.arg.type');
    expect(problem({ id: 'a', n: 2.5 })).toBe('main.persona.door.arg.type');
    expect(problem({ id: 'a', ratio: Number.NaN })).toBe('main.persona.door.arg.type');
    expect(problem({ id: 'a', on: 'true' })).toBe('main.persona.door.arg.type');
    expect(problem({ id: 'a', mode: 'c' })).toBe('main.persona.door.arg.enum');
    expect(problem({ id: 'a', unknown: 1 })).toBe('main.persona.door.arg.unknown');
  });

  it('cuts the size of a string, a text and a json value, and takes null and undefined as absent', () => {
    expect(checkArgs(specs, { id: 'x'.repeat(501), why: 'ok' }, true).ok).toBe(false);
    expect(checkArgs(specs, { id: 'a', body: 'x'.repeat(20_001), why: 'ok' }, true).ok).toBe(false);
    expect(checkArgs(specs, { id: 'a', body: 'x'.repeat(20_000), why: 'ok' }, true).ok).toBe(true);
    expect(checkArgs(specs, { id: 'a', data: 'x'.repeat(20_001), why: 'ok' }, true).ok).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(checkArgs(specs, { id: 'a', data: cyclic, why: 'ok' }, true).ok).toBe(false);
    expect(checkArgs(specs, { id: 'a', n: null, mode: undefined, why: 'ok' }, true)).toEqual({ ok: true, values: { id: 'a' } });
  });

  it('asks for a reason only of a write: one sentence of at most 300 characters', () => {
    const base = { id: 'a' };
    expect(checkArgs(specs, base, false).ok).toBe(true);
    expect(checkArgs(specs, { ...base, why: 'whatever' }, false).ok).toBe(true);
    expect(checkArgs(specs, base, true).ok).toBe(false);
    expect(checkArgs(specs, { ...base, why: '' }, true).ok).toBe(false);
    expect(checkArgs(specs, { ...base, why: 3 }, true).ok).toBe(false);
    expect(checkArgs(specs, { ...base, why: 'y'.repeat(300) }, true).ok).toBe(true);
    expect(checkArgs(specs, { ...base, why: 'y'.repeat(301) }, true).ok).toBe(false);
  });
});

describe('the path of the settings tool', () => {
  const doc = { language: 'en', agents: { team: [{ id: 'me', shell: 'none', model: { fallbacks: [{ provider: 'p', model: 'm' }] } }, { id: 'dev', shell: 'sandbox' }], tools: { web: true } }, tags: ['a', 'b'] };

  it('parses keys and the element of a list by its id, and refuses what is not a path or can reach the prototype', () => {
    expect(parsePath('agents.team[me].shell')).toEqual([{ key: 'agents' }, { key: 'team', id: 'me' }, { key: 'shell' }]);
    for (const bad of ['', 'a..b', '.a', 'a.', 'a[', 'a[]', 'a[b', '1a', 'a b', 'x'.repeat(301)]) expect(() => parsePath(bad), bad).toThrow(PathError);
    for (const bad of ['__proto__.x', 'a.constructor', 'a.prototype.b']) expect(() => parsePath(bad), bad).toThrow(expect.objectContaining({ code: 'forbidden' }));
    // an element id that is not a plain name does not parse at all
    expect(() => parsePath('a.team[__proto__].x')).toThrow(PathError);
  });

  it('reads the value at a path, an element of a list, or nothing', () => {
    expect(readPath(doc, 'language')).toBe('en');
    expect(readPath(doc, 'agents.team[me].shell')).toBe('none');
    expect(readPath(doc, 'agents.team[dev]')).toEqual({ id: 'dev', shell: 'sandbox' });
    expect(readPath(doc, 'agents.team[ghost].shell')).toBeUndefined();
    expect(readPath(doc, 'agents.nothing.deeper')).toBeUndefined();
    expect(readPath(doc, 'language.deeper')).toBeUndefined();
    expect(readPath(doc, 'tags')).toEqual(['a', 'b']);
  });

  it('sets a value, replaces an element, adds a missing one, and leaves the document it was given alone', () => {
    const copy = structuredClone(doc);
    const a = applyPath(doc, 'agents.team[me].shell', 'host') as typeof doc;
    expect(a.agents.team[0].shell).toBe('host');
    expect(doc).toEqual(copy);
    const b = applyPath(doc, 'agents.team[dev]', { id: 'dev', shell: 'none' }) as typeof doc;
    expect(b.agents.team[1]).toEqual({ id: 'dev', shell: 'none' });
    const c = applyPath(doc, 'agents.team[new]', { id: 'new', shell: 'none' }) as typeof doc;
    expect(c.agents.team.map((x) => x.id)).toEqual(['me', 'dev', 'new']);
    // a key of an object that exists may be created
    expect((applyPath(doc, 'agents.tools.shell', true) as typeof doc & { agents: { tools: Record<string, boolean> } }).agents.tools.shell).toBe(true);
  });

  it('never creates the object in between', () => {
    expect(() => applyPath(doc, 'nothing.here', 1)).toThrow(expect.objectContaining({ code: 'missing' }));
    expect(() => applyPath(doc, 'agents.ghost.deeper', 1)).toThrow(expect.objectContaining({ code: 'missing' }));
    expect(() => applyPath(doc, 'language.deeper', 1)).toThrow(expect.objectContaining({ code: 'missing' }));
    expect(() => applyPath(doc, 'agents.team[ghost].shell', 'host')).toThrow(PathError);
  });

  it('appends to a list and removes a key or an element, and refuses either on the wrong kind of thing', () => {
    expect((applyPath(doc, 'tags', 'c', 'append') as typeof doc).tags).toEqual(['a', 'b', 'c']);
    expect((applyPath(doc, 'agents.team[me].model.fallbacks', { provider: 'q', model: 'n' }, 'append') as typeof doc).agents.team[0].model?.fallbacks).toHaveLength(2);
    expect(() => applyPath(doc, 'language', 'x', 'append')).toThrow(expect.objectContaining({ code: 'type' }));
    expect(() => applyPath(doc, 'agents.team[me]', 1, 'append')).toThrow(PathError);
    expect((applyPath(doc, 'agents.team[dev]', null, 'remove') as typeof doc).agents.team.map((x) => x.id)).toEqual(['me']);
    expect('tags' in (applyPath(doc, 'tags', null, 'remove') as object)).toBe(false);
    expect(() => applyPath(doc, 'agents.team[ghost]', null, 'remove')).toThrow(PathError);
    expect(() => applyPath(doc, 'nothing', null, 'remove')).toThrow(PathError);
  });

  it('reaches the fragment of the schema a path names', () => {
    const schema = { properties: { agents: { properties: { team: { items: { properties: { shell: { enum: ['none', 'host'] } } } } } } } };
    expect(schemaAt(schema, 'agents.team[me].shell')).toEqual({ enum: ['none', 'host'] });
    expect(schemaAt(schema, 'agents.nothing')).toBeUndefined();
  });
});
