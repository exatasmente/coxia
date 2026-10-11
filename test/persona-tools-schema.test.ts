// The persona's eleven tools as the models are given them (#248): a flat schema with `op` and `why`, a description that names every operation and marks the ones that write,
// the words of every operation and no word without an operation, and their size.
import { describe, expect, it } from 'vitest';
import { OPS, TOOL_NAMES, keyOf, opsOf } from '../src/main/persona/doorTable';
import { describeTool, personaToolImpls, schemaOf } from '../src/main/persona/tools';
import { ARG_DOCS, OP_DOCS, TOOL_DOCS } from '../src/main/persona/toolDocs';
import type { Door } from '../src/main/persona/door';
import { createSession } from '../src/main/persona/session';

type Schema = { type: string; properties: Record<string, { type?: string; enum?: string[]; description?: string; maxLength?: number }>; required: string[]; additionalProperties: boolean };

describe('the schema of a tool', () => {
  it.each(TOOL_NAMES)('%s is flat: op as an enum of its operations, why, and one property per argument name', (tool) => {
    const schema = schemaOf(tool) as unknown as Schema;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['op']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.op.enum).toEqual(opsOf(tool).map((o) => o.op));
    expect(schema.properties.why).toMatchObject({ type: 'string', maxLength: 300 });
    const names = new Set(opsOf(tool).flatMap((o) => o.args.map((a) => a.name)));
    expect(Object.keys(schema.properties).sort()).toEqual(['op', 'why', ...names].sort());
    // flat: no property holds another schema's properties or items
    for (const p of Object.values(schema.properties)) expect(p).not.toHaveProperty('properties');
  });

  it('describes the properties that need words, and only those: a name that says what it is has no description, and none says where it is used', () => {
    for (const tool of TOOL_NAMES) {
      const schema = schemaOf(tool) as unknown as Schema;
      for (const [name, p] of Object.entries(schema.properties)) {
        expect(p.description, `${tool}.${name}`).toBe(ARG_DOCS[name]);
        expect(p.description ?? '', `${tool}.${name}`).not.toContain('Used by');
      }
      expect(schema.properties.op.description).toBeTruthy();
      expect(schema.properties.why.description).toBeTruthy();
    }
    for (const name of ['text', 'note', 'reason', 'body', 'title']) expect(ARG_DOCS, name).not.toHaveProperty(name);
  });

  it('takes the union of the values of an enum argument that two operations of a tool spell differently', () => {
    const schema = schemaOf('Asks') as unknown as Schema;
    expect(schema.properties.decision.enum).toEqual(['yes', 'no', 'site']);
    expect((schemaOf('Plugins') as unknown as Schema).properties.answer.enum).toEqual(['once', 'session', 'always', 'refuse']);
  });
});

describe('the description of a tool', () => {
  it.each(TOOL_NAMES)('%s names every operation with its arguments, and marks exactly the ones that write', (tool) => {
    const text = describeTool(tool);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(opsOf(tool).length);
    for (const o of opsOf(tool)) {
      const line = lines.find((l) => l.startsWith(`- ${o.op}(`));
      expect(line, keyOf(o)).toBeDefined();
      expect(line?.includes('[writes]'), keyOf(o)).toBe(o.write);
      if (o.write) expect(line, keyOf(o)).toContain('why');
      for (const a of o.args.filter((x) => x.required)) expect(line, `${keyOf(o)} ${a.name}`).toMatch(new RegExp(`[(,] ?${a.name}[=,)]`));
    }
    // the paragraph that teaches the shape of a call is in the persona's prompt once, not in the eleven descriptions
    expect(text).not.toContain('Call it with op');
  });

  it('has words for every operation and for every tool, and none for an operation that is not in the table', () => {
    expect(Object.keys(OP_DOCS).sort()).toEqual(OPS.map(keyOf).sort());
    expect(Object.keys(TOOL_DOCS).sort()).toEqual([...TOOL_NAMES].sort());
    for (const [key, text] of Object.entries(OP_DOCS)) expect(text.length, key).toBeGreaterThan(8);
    expect(Object.keys(ARG_DOCS)).toEqual(expect.arrayContaining(['op', 'why']));
  });

  it('stays a bounded size: the eleven descriptions are in the prompt of every answer of the persona', () => {
    const chars = TOOL_NAMES.map((t) => describeTool(t).length + JSON.stringify(schemaOf(t)).length).reduce((a, b) => a + b, 0);
    // about four characters to a token; the figure is in the implementation notes
    expect(chars).toBeLessThan(40_000);
    expect(chars).toBeGreaterThan(20_000);
  });
});

describe('the tools of an answer', () => {
  const door: Door = { run: async (_s, tool, input) => `ran ${tool} ${String(input.op)}`, finish: () => undefined };
  const tools = personaToolImpls(door, createSession({ persona: 'me', thread: 'agent-me', seq: 1, door: 'window' }));

  it('are eleven, named as the table names them, and for the principal agent only', () => {
    expect(tools.map((x) => x.name)).toEqual([...TOOL_NAMES]);
    for (const tool of tools) expect(tool.principalOnly, tool.name).toBe(true);
  });

  it('hand the call to the door with the session of the answer and give back its text', async () => {
    const seen: string[] = [];
    const spy: Door = { run: async (s, tool, input) => (seen.push(`${s.thread}:${tool}`), `ok ${String(input.op)}`), finish: () => undefined };
    const [overview] = personaToolImpls(spy, createSession({ persona: 'me', thread: 'agent-me', seq: 1, door: 'window' }));
    const r = await overview.run({ op: 'cycle' }, {} as never);
    expect(r.render(r.response)).toBe('ok cycle');
    expect(seen).toEqual(['agent-me:Overview']);
  });
});
