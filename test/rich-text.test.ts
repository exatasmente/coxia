import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, splitDiagrams } from '../src/renderer/src/richText';

describe('splitDiagrams', () => {
  it('returns nothing for empty input', () => {
    expect(splitDiagrams('')).toEqual([]);
  });

  it('keeps plain text as one part', () => {
    expect(splitDiagrams('só texto')).toEqual([{ kind: 'text', value: 'só texto' }]);
  });

  it('splits a mermaid fence between texts', () => {
    const parts = splitDiagrams('antes\n```mermaid\ngraph TD\nA-->B\n```\ndepois');
    expect(parts).toEqual([
      { kind: 'text', value: 'antes\n' },
      { kind: 'diagram', value: 'graph TD\nA-->B\n' },
      { kind: 'text', value: '\ndepois' },
    ]);
  });

  it('finds several diagrams in order', () => {
    const parts = splitDiagrams('```mermaid\nA-->B\n```\nmeio\n```mermaid\nC-->D\n```');
    expect(parts.map((p) => p.kind)).toEqual(['diagram', 'text', 'diagram']);
  });

  it('leaves an unterminated fence as text', () => {
    const text = 'veja\n```mermaid\ngraph TD\nA-->B';
    expect(splitDiagrams(text)).toEqual([{ kind: 'text', value: text }]);
  });

  it('does not treat other languages as diagrams', () => {
    expect(splitDiagrams('```ts\nconst a = 1;\n```').every((p) => p.kind === 'text')).toBe(true);
  });

  it('handles CRLF without carriage returns in the diagram code', () => {
    const parts = splitDiagrams('a\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\nb');
    expect(parts[1]).toEqual({ kind: 'diagram', value: 'graph TD\nA-->B\n' });
    expect(parts.some((p) => p.value.includes('\r'))).toBe(false);
  });
});

describe('parseBlocks', () => {
  it('returns nothing for empty or blank input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks('  \n\n \n')).toEqual([]);
  });

  it('joins consecutive lines into one paragraph with line breaks', () => {
    expect(parseBlocks('linha um\nlinha dois')).toEqual([{ kind: 'p', lines: ['linha um', 'linha dois'] }]);
  });

  it('splits paragraphs on blank lines', () => {
    expect(parseBlocks('um\n\ndois')).toEqual([
      { kind: 'p', lines: ['um'] },
      { kind: 'p', lines: ['dois'] },
    ]);
  });

  it('parses bullet lists with -, * and •', () => {
    for (const marker of ['-', '*', '•']) {
      expect(parseBlocks(`${marker} a\n${marker} b`)).toEqual([{ kind: 'ul', lines: ['a', 'b'] }]);
    }
  });

  it('parses numbered lists with . and )', () => {
    expect(parseBlocks('1. a\n2) b')).toEqual([{ kind: 'ol', lines: ['a', 'b'], start: 1 }]);
  });

  it('keeps a loose list in one block', () => {
    expect(parseBlocks('1. a\n\n2. b\n\n3. c')).toEqual([{ kind: 'ol', lines: ['a', 'b', 'c'], start: 1 }]);
    expect(parseBlocks('- a\n\n- b')).toEqual([{ kind: 'ul', lines: ['a', 'b'] }]);
  });

  it('starts a new numbered list at its own number after a paragraph', () => {
    const blocks = parseBlocks('1. a\ntexto\n2. b');
    expect(blocks.map((b) => b.kind)).toEqual(['ol', 'p', 'ol']);
    expect(blocks[2].start).toBe(2);
  });

  it('does not mistake bold at line start for a list item', () => {
    expect(parseBlocks('**negrito** no começo')).toEqual([{ kind: 'p', lines: ['**negrito** no começo'] }]);
  });

  it('parses headings of any level without the hashes', () => {
    expect(parseBlocks('# Título\n### Sub')).toEqual([
      { kind: 'h', lines: ['Título'] },
      { kind: 'h', lines: ['Sub'] },
    ]);
  });

  it('does not treat a hashtag as a heading', () => {
    expect(parseBlocks('#15499 chegou')).toEqual([{ kind: 'p', lines: ['#15499 chegou'] }]);
  });

  it('keeps fenced code lines verbatim, blank lines and indentation included', () => {
    expect(parseBlocks('```ts\nconst a = 1;\n\n  b();\n```')).toEqual([{ kind: 'pre', lines: ['const a = 1;', '', '  b();'] }]);
  });

  it('closes an unterminated fence at the end of the text', () => {
    expect(parseBlocks('antes\n```\nrm -rf x')).toEqual([
      { kind: 'p', lines: ['antes'] },
      { kind: 'pre', lines: ['rm -rf x'] },
    ]);
  });

  it('drops an empty fence', () => {
    expect(parseBlocks('```\n```')).toEqual([]);
  });

  it('does not parse lists or headings inside fences', () => {
    expect(parseBlocks('```\n- a\n# b\n```')).toEqual([{ kind: 'pre', lines: ['- a', '# b'] }]);
  });

  it('mixes paragraph, list and heading in order', () => {
    expect(parseBlocks('## Passos\nintro\n- a\n- b\nfim').map((b) => b.kind)).toEqual(['h', 'p', 'ul', 'p']);
  });

  it('handles CRLF', () => {
    expect(parseBlocks('um\r\ndois\r\n\r\n- a\r\n- b\r\n```\r\nx\r\n```')).toEqual([
      { kind: 'p', lines: ['um', 'dois'] },
      { kind: 'ul', lines: ['a', 'b'] },
      { kind: 'pre', lines: ['x'] },
    ]);
  });
});

describe('parseInline', () => {
  it('returns nothing for empty input', () => {
    expect(parseInline('')).toEqual([]);
  });

  it('keeps plain text as one span', () => {
    expect(parseInline('só texto')).toEqual([{ kind: 'text', value: 'só texto' }]);
  });

  it('marks inline code and bold between texts', () => {
    expect(parseInline('use `make test` e **cuidado** ok')).toEqual([
      { kind: 'text', value: 'use ' },
      { kind: 'code', value: 'make test' },
      { kind: 'text', value: ' e ' },
      { kind: 'bold', value: 'cuidado' },
      { kind: 'text', value: ' ok' },
    ]);
  });

  it('keeps ** inside inline code literal', () => {
    expect(parseInline('o glob `src/**/*.ts` pega tudo')).toEqual([
      { kind: 'text', value: 'o glob ' },
      { kind: 'code', value: 'src/**/*.ts' },
      { kind: 'text', value: ' pega tudo' },
    ]);
    expect(parseInline('`**x**`')).toEqual([{ kind: 'code', value: '**x**' }]);
  });

  it('does not bold across two code spans containing **', () => {
    const spans = parseInline('`a**` e `**b`');
    expect(spans.filter((s) => s.kind === 'bold')).toEqual([]);
    expect(spans.filter((s) => s.kind === 'code').map((s) => s.value)).toEqual(['a**', '**b']);
  });

  it('leaves unbalanced markers as text', () => {
    expect(parseInline('um ** solto e um ` solto')).toEqual([{ kind: 'text', value: 'um ** solto e um ` solto' }]);
  });

  it('does not make empty bold or code', () => {
    expect(parseInline('**** ``')).toEqual([{ kind: 'text', value: '**** ``' }]);
  });
});
