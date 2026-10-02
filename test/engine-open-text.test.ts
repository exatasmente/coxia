import { describe, expect, it } from 'vitest';
import { SseParser, ThinkSplitter, parseToolArguments, repairJson, splitThink, toApiName } from '../src/main/engine/open/text';
import { describeErrors, prune, validate } from '../src/main/engine/open/schema';

describe('toApiName', () => {
  it('keeps valid names and fits the rest into 64 safe characters, deterministically', () => {
    expect(toApiName('Read')).toBe('Read');
    const long = 'mcp__tracker-issues-reader__get_merge_request_details_and_changes';
    expect(long.length).toBe(65);
    const mapped = toApiName(long);
    expect(mapped).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(toApiName(long)).toBe(mapped);
    expect(toApiName('a.b:c')).toMatch(/^a_b_c_[0-9a-f]{8}$/);
  });
});

describe('ThinkSplitter', () => {
  it('splits a leading <think> block from the answer', () => {
    expect(splitThink('<think>hmm</think>\n\nanswer')).toEqual([
      { kind: 'thinking', text: 'hmm' },
      { kind: 'text', text: 'answer' },
    ]);
  });

  it('handles tags broken across chunks', () => {
    const s = new ThinkSplitter();
    const out = ['<th', 'ink>pens', 'ando</th', 'ink>resp', 'osta'].flatMap((c) => s.feed(c)).concat(s.flush());
    const think = out.filter((p) => p.kind === 'thinking').map((p) => p.text).join('');
    const text = out.filter((p) => p.kind === 'text').map((p) => p.text).join('');
    expect(think).toBe('pensando');
    expect(text).toBe('resposta');
  });

  it('leaves plain text and mid-text tags alone', () => {
    expect(splitThink('hello <think>x</think>')).toEqual([{ kind: 'text', text: 'hello <think>x</think>' }]);
    expect(splitThink('<thi')).toEqual([{ kind: 'text', text: '<thi' }]);
  });

  it('treats an unterminated think block as reasoning', () => {
    expect(splitThink('<think>never closed')).toEqual([{ kind: 'thinking', text: 'never closed' }]);
  });
});

describe('repairJson and parseToolArguments', () => {
  it('parses what is already valid', () => {
    expect(repairJson('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips code fences and text around the object', () => {
    expect(repairJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(repairJson('Aqui está: {"a": "x"} fim')).toEqual({ a: 'x' });
  });
  it('removes trailing commas and closes truncated JSON', () => {
    expect(repairJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(repairJson('{"a":"tex')).toEqual({ a: 'tex' });
    expect(repairJson('{"a":{"b":[1,2')).toEqual({ a: { b: [1, 2] } });
  });
  it('gives up on prose', () => {
    expect(repairJson('nada de json aqui')).toBeUndefined();
  });
  it('turns tool arguments into an object, even double encoded or empty', () => {
    expect(parseToolArguments('{"file_path":"/x"}')).toEqual({ file_path: '/x' });
    expect(parseToolArguments(JSON.stringify(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
    expect(parseToolArguments('')).toEqual({});
    expect(parseToolArguments('[1,2]')).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });
});

describe('SseParser', () => {
  it('returns the data payloads of complete events only', () => {
    const p = new SseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b"')).toEqual(['{"a":1}']);
    expect(p.push(':2}\n\n')).toEqual(['{"b":2}']);
    expect(p.push(': keep-alive\n\nevent: x\ndata: [DONE]\r\n\r\n')).toEqual(['[DONE]']);
    expect(p.flush()).toEqual([]);
  });
  it('flushes a last event with no blank line', () => {
    const p = new SseParser();
    p.push('data: tail');
    expect(p.flush()).toEqual(['tail']);
  });
});

describe('schema validation', () => {
  const schema = {
    type: 'object',
    properties: {
      fala: { type: 'string' },
      pergunta: { type: ['string', 'null'] },
      opcoes: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      decisao: { anyOf: [{ type: 'null' }, { type: 'object', properties: { alvo: { enum: ['spec', 'ata'] } }, required: ['alvo'], additionalProperties: false }] },
    },
    required: ['fala', 'pergunta', 'opcoes', 'decisao'],
    additionalProperties: false,
  };

  it('accepts a conforming value', () => {
    expect(validate({ fala: 'x', pergunta: null, opcoes: ['a'], decisao: { alvo: 'ata' } }, schema)).toEqual([]);
    expect(validate({ fala: 'x', pergunta: 'p', opcoes: [], decisao: null }, schema)).toEqual([]);
  });

  it('reports what is wrong, with paths', () => {
    const errors = validate({ fala: 1, opcoes: ['a', 'b', 'c', 'd'], decisao: { alvo: 'zzz' }, extra: true }, schema);
    const text = describeErrors(errors);
    expect(text).toContain('$.fala: esperado string');
    expect(text).toContain('$.pergunta: campo obrigatório ausente');
    expect(text).toContain('$.opcoes: no máximo 3 itens');
    expect(text).toContain('$.extra: campo não previsto');
    expect(text).toContain('$.decisao');
  });

  it('distinguishes integers from numbers', () => {
    expect(validate(1.5, { type: 'integer' })).not.toEqual([]);
    expect(validate(2, { type: 'number' })).toEqual([]);
  });

  it('prunes fields the schema forbids, including inside anyOf branches', () => {
    const pruned = prune({ fala: 'x', pergunta: null, opcoes: [], decisao: { alvo: 'ata', sobra: 1 }, lixo: 2 }, schema);
    expect(pruned).toEqual({ fala: 'x', pergunta: null, opcoes: [], decisao: { alvo: 'ata' } });
    expect(validate(pruned, schema)).toEqual([]);
  });
});
