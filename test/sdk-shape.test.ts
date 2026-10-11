// The shape the Claude SDK gets for an app tool (`looseShape`): every property loose and described, and optional unless the schema requires it. Pinned at the level of the whole
// object, which is what the SDK parses a call against and turns into the JSON Schema the model is shown: in zod 4 a bare `z.unknown()` key is required there, and a tool whose
// optional fields were required could not be called at all (the SDK wanted every field, the app refused the ones the operation does not take).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { looseShape } from '../src/main/sdkShape';
import { personaToolImpls } from '../src/main/persona/tools';
import { memoryToolSpecs } from '../src/main/memory/tools';
import { procedureToolSpecs } from '../src/main/procedures/tools';
import { runnerTools } from '../src/main/runner/tools';
import { createSession } from '../src/main/persona/session';

const objectOf = (schema: unknown) => z.object(looseShape(z, schema));
const requiredOf = (schema: unknown): string[] => ((z.toJSONSchema(objectOf(schema)) as { required?: string[] }).required ?? []).sort();

describe('looseShape', () => {
  const schema = { type: 'object', properties: { op: { type: 'string', description: 'What to do.' }, why: { type: 'string' }, config: { type: 'string', description: 'A path.' } }, required: ['op'] };

  it('requires only what the schema requires, in the parse and in the JSON Schema the model sees', () => {
    expect(objectOf(schema).safeParse({ op: 'list' }).success).toBe(true);
    expect(objectOf(schema).safeParse({ why: 'x' }).success).toBe(false);
    expect(requiredOf(schema)).toEqual(['op']);
  });

  it('keeps every field loose and its words on the field, optional or not', () => {
    const shape = looseShape(z, schema);
    expect(shape.op.safeParse(5).success).toBe(true);
    expect(shape.config.safeParse({ any: 'thing' }).success).toBe(true);
    expect(shape.op.description).toBe('What to do.');
    expect(shape.config.description).toBe('A path.');
    expect(shape.why.description).toBeUndefined();
  });

  it('makes everything optional when the schema requires nothing', () => {
    expect(requiredOf({ properties: { a: {}, b: {} } })).toEqual([]);
  });
});

describe('the app tools on the Claude engine', () => {
  it('ask the persona for op alone: a list takes op and why, not the other fields of the tool', () => {
    const session = createSession({ persona: 'me', thread: 'agent-me', seq: 1, door: 'window' });
    for (const tool of personaToolImpls({ run: async () => 'ok', finish: () => undefined }, session)) {
      expect(requiredOf(tool.parameters), tool.name).toEqual(['op']);
      expect(objectOf(tool.parameters).safeParse({ op: 'list', why: 'to see' }).success, tool.name).toBe(true);
    }
  });

  it('require of the memory, the procedures and the runner tools what their schemas require, and nothing else', () => {
    const all = { list: async () => ({ text: '' }), read: async () => ({ text: '' }), save: async () => ({ text: '' }), remove: async () => ({ text: '' }) };
    const specs = [...memoryToolSpecs(all), ...procedureToolSpecs({})].map((s) => ({ name: s.name, schema: s.schema as { required?: string[] } }));
    const runner = runnerTools({} as Parameters<typeof runnerTools>[0], 'run').map((t) => ({ name: t.name, schema: t.parameters as { required?: string[] } }));
    for (const { name, schema } of [...specs, ...runner]) expect(requiredOf(schema), name).toEqual([...(schema.required ?? [])].sort());
  });
});
