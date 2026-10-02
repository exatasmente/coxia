import { describe, expect, it } from 'vitest';
import { LETTERS, letter, toQuestion, type RawQuestion } from '../src/main/gate';

describe('spoken letter', () => {
  it.each([
    ['B', 1],
    ['b', 1],
    ['A', 0],
    ['D', 3],
    ['letra C', 2],
    ['Letra c.', 2],
    ['opção d', 3],
    ['Opção D!', 3],
    ['alternativa b', 1],
    ['resposta a', 0],
    ['é a letra B', 1],
    ['É a letra b.', 1],
    ['  é a letra D  ', 3],
    ['é a B', 1],
    ['b,', 1],
  ])('maps %j to %i', (text, index) => {
    expect(letter(text)).toBe(index);
  });

  it.each([
    'a resposta está no fallback do cache',
    'a mudança quebra o rollback',
    'acho que é a primeira',
    'depende do ambiente',
    'letra E',
    'opção 2',
    'não sei',
    'b porque o job não repete',
    'c e d',
    'a ou b',
    '',
    '   ',
    '...',
  ])('treats %j as a free answer', (text) => {
    expect(letter(text)).toBeNull();
  });

  it('agrees with the letters the screen shows', () => {
    LETTERS.forEach((l, i) => expect(letter(`letra ${l}`)).toBe(i));
  });
});

const raw = (correta: number, over: Partial<RawQuestion> = {}): RawQuestion => ({
  pergunta: 'O que acontece se o job falhar?',
  tipo: 'rollback',
  opcoes: ['alfa', 'beta', 'gama', 'delta'],
  correta,
  secao: '2_PLAN.md › Rollback',
  explicacao: 'A opção B está certa porque o job repete.',
  ...over,
});

// Deterministic generator so the distribution check never flakes.
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('quiz question shuffling', () => {
  it('keeps the correct option attached to the right text', () => {
    const rnd = lcg(7);
    for (let n = 0; n < 500; n++) {
      const correta = n % 4;
      const q = raw(correta);
      const out = toQuestion(q, rnd);
      expect(out.options[out.correct]).toBe(q.opcoes[correta]);
    }
  });

  it('keeps every option exactly once', () => {
    const rnd = lcg(11);
    for (let n = 0; n < 200; n++) {
      const out = toQuestion(raw(0), rnd);
      expect([...out.options].sort()).toEqual(['alfa', 'beta', 'delta', 'gama']);
    }
  });

  it('spreads the correct answer over the four positions even when the model always puts it first', () => {
    const rnd = lcg(3);
    const counts = [0, 0, 0, 0];
    const N = 4000;
    for (let n = 0; n < N; n++) counts[toQuestion(raw(0), rnd).correct]++;
    for (const c of counts) {
      expect(c / N).toBeGreaterThan(0.2);
      expect(c / N).toBeLessThan(0.3);
    }
  });

  it('really shuffles with the default Math.random (not an index passed by map)', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 300; n++) seen.add(toQuestion(raw(0)).correct);
    expect(seen.size).toBe(4);
    const viaMap = [raw(0), raw(0), raw(0), raw(0), raw(0), raw(0)].map((q) => (q.opcoes.length ? toQuestion(q) : null));
    expect(viaMap).toHaveLength(6);
  });

  it('copies the other fields', () => {
    const out = toQuestion(raw(2), lcg(1));
    expect(out).toMatchObject({ text: 'O que acontece se o job falhar?', kind: 'rollback', section: '2_PLAN.md › Rollback' });
  });

  it('drops the original letters from the explanation, since the order changed', () => {
    for (const text of ['A opção B está certa', 'a letra C é a certa', 'Alternativa D', 'opcao a']) {
      const out = toQuestion(raw(0, { explicacao: text }), lcg(5));
      expect(out.explanation).not.toMatch(/\b(?:op[cç][aã]o|letra|alternativa)\s+[A-D]\b/i);
      expect(out.explanation).toContain('a opção certa');
    }
  });

  it('keeps an explanation that cites no letter as it was', () => {
    const out = toQuestion(raw(0, { explicacao: 'O job repete porque o retry é idempotente.' }), lcg(5));
    expect(out.explanation).toBe('O job repete porque o retry é idempotente.');
  });
});
