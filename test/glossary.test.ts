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
    expect(spoken('O qa do SZ4 passou.', terms, 'edge')).toBe('O quiu ei do ésse zê quatro passou.');
  });

  it('does not touch a term inside another word', () => {
    expect(spoken('sz4x e QAs e merge', terms, 'edge')).toBe('sz4x e QAs e merge');
  });

  it('prefers the longer term and does not replace a replacement', () => {
    expect(spoken('Na pré-daily e na daily', terms, 'edge')).toBe('Na pré deili e na deili');
  });

  it('reads issue and MR references', () => {
    expect(spoken('O sz4!9302 resolve a #15499 e o !797.', [], 'edge')).toBe('O sz4, MR 9302 resolve a 15499 e o MR 797.');
  });
});

describe('spoken per engine', () => {
  const kokoro: Term[] = [
    { term: 'merge', say: '', sayKokoro: 'mérji', heard: [] },
    { term: 'deploy', say: 'deploi', sayKokoro: 'diplói', heard: [] },
    { term: 'QA', say: 'quiu ei', heard: [] },
  ];

  it('uses the Kokoro pronunciation only for Kokoro', () => {
    expect(spoken('merge e deploy', kokoro, 'kokoro')).toBe('mérji e diplói');
    expect(spoken('merge e deploy', kokoro, 'edge')).toBe('merge e deploi');
  });

  it('falls back to the common pronunciation and then to the term', () => {
    expect(spoken('QA no merge e no hotfix', kokoro, 'kokoro')).toBe('quiu ei no mérji e no hotfix');
    expect(spoken('QA no merge', kokoro, 'edge')).toBe('quiu ei no merge');
  });

  it('treats a blank Kokoro pronunciation as unset', () => {
    expect(spoken('QA', [{ term: 'QA', say: 'quiu ei', sayKokoro: '  ', heard: [] }], 'kokoro')).toBe('quiu ei');
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

  it('keeps the Kokoro pronunciation and drops it when blank', () => {
    expect(
      sanitizeGlossary([
        { term: 'merge', say: '', sayKokoro: ' mérji\u0000 ', heard: ['merdi'] },
        { term: 'deploy', say: 'deploi', sayKokoro: '  ', heard: [] },
        { term: 'gate', say: '', sayKokoro: 42, heard: [] },
      ]),
    ).toEqual([
      { term: 'merge', say: '', sayKokoro: 'mérji', heard: ['merdi'] },
      { term: 'deploy', say: 'deploi', heard: [] },
      { term: 'gate', say: '', heard: [] },
    ]);
  });

  it('reads a file saved before the Kokoro field existed', () => {
    const old = JSON.parse('[{"term":"QA","say":"quiu ei","heard":["Q&A"]}]');
    expect(sanitizeGlossary(old)).toEqual([{ term: 'QA', say: 'quiu ei', heard: ['Q&A'] }]);
    expect(Object.keys(sanitizeGlossary(old)[0])).not.toContain('sayKokoro');
  });

  it('keeps the defaults valid', () => {
    expect(sanitizeGlossary(DEFAULT_GLOSSARY)).toEqual(DEFAULT_GLOSSARY);
  });
});
