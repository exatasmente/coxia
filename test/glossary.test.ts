import { describe, expect, it } from 'vitest';
import { DEFAULT_GLOSSARY, type Term, corrected, sanitizeGlossary, spoken, whisperHint } from '../src/shared/glossary';

const terms: Term[] = [
  { term: 'sz4', say: 'ésse zê quatro', heard: ['SZ 4'] },
  { term: 'QA', say: 'quiu ei', heard: ['Q&A', 'kiu ei'] },
  { term: 'pré-daily', say: 'pré deili', heard: ['pre daily'] },
  { term: 'daily', say: 'deili', heard: ['deile'] },
  { term: 'merge', say: '', heard: ['merdi'] },
];

describe('spoken', () => {
  it('swaps whole terms for their pronunciation, ignoring case', () => {
    expect(spoken('O qa do SZ4 passou.', terms)).toBe('O quiu ei do ésse zê quatro passou.');
  });

  it('does not touch a term inside another word', () => {
    expect(spoken('sz4x e QAs e merge', terms)).toBe('sz4x e QAs e merge');
  });

  it('prefers the longer term and does not replace a replacement', () => {
    expect(spoken('Na pré-daily e na daily', terms)).toBe('Na pré deili e na deili');
  });

  it('reads issue and MR references', () => {
    expect(spoken('O sz4!9302 resolve a #15499 e o !797.', [])).toBe('O sz4, MR 9302 resolve a 15499 e o MR 797.');
  });
});

describe('corrected', () => {
  it('turns misheard variants back into the term', () => {
    expect(corrected('o Q&A liberou o merdi, kiu ei confirmou', terms)).toBe('o QA liberou o merge, QA confirmou');
  });

  it('matches multiword variants and keeps the rest', () => {
    expect(corrected('na pre daily do SZ 4', terms)).toBe('na pré-daily do sz4');
  });
});

describe('whisperHint', () => {
  it('lists the terms and stays short', () => {
    expect(whisperHint(terms)).toBe('Pré-daily. sz4, QA, pré-daily, daily, merge.');
    const many = Array.from({ length: 200 }, (_, i) => ({ term: `termo${i}`, say: '', heard: [] }));
    expect(whisperHint(many).length).toBeLessThanOrEqual(600);
  });
});

describe('sanitizeGlossary', () => {
  it('drops empty and duplicate terms, control characters and self variants', () => {
    expect(
      sanitizeGlossary([
        { term: ' QA ', say: 'quiu\u0000ei', heard: ['qa', 'Q&A', ''] },
        { term: 'qa', say: 'x', heard: [] },
        { term: '', say: 'y' },
        null,
      ]),
    ).toEqual([{ term: 'QA', say: 'quiu ei', heard: ['Q&A'] }]);
  });

  it('falls back to the defaults on anything but a list', () => {
    expect(sanitizeGlossary({})).toBe(DEFAULT_GLOSSARY);
  });

  it('keeps the defaults valid', () => {
    expect(sanitizeGlossary(DEFAULT_GLOSSARY)).toEqual(DEFAULT_GLOSSARY);
  });
});
