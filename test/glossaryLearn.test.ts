import { describe, expect, it } from 'vitest';
import { type Term, corrected } from '../src/shared/glossary';
import { diffCorrections, isKnown, learn, newCorrections } from '../src/shared/glossaryLearn';

describe('diffCorrections', () => {
  it('pairs a replaced word with its fix', () => {
    expect(diffCorrections('fiz o merdi hoje', 'fiz o merge hoje')).toEqual([{ heard: 'merdi', term: 'merge' }]);
  });

  it('pairs adjacent changed words as one correction', () => {
    expect(diffCorrections('o pipe line quebrou', 'o pipeline quebrou')).toEqual([{ heard: 'pipe line', term: 'pipeline' }]);
    expect(diffCorrections('o hub whats app caiu', 'o hub-whatsapp caiu')).toEqual([{ heard: 'hub whats app', term: 'hub-whatsapp' }]);
  });

  it('finds several separate corrections in one sentence', () => {
    expect(diffCorrections('o merdi do deploi passou', 'o merge do deploy passou')).toEqual([
      { heard: 'merdi', term: 'merge' },
      { heard: 'deploi', term: 'deploy' },
    ]);
  });

  it('ignores punctuation and case', () => {
    expect(diffCorrections('Fiz o merdi, hoje.', 'fiz o merge hoje')).toEqual([{ heard: 'merdi', term: 'merge' }]);
    expect(diffCorrections('o gate abriu', 'o Gate abriu')).toEqual([]);
  });

  it('ignores pure insertions and deletions', () => {
    expect(diffCorrections('o merge passou', 'o merge já passou')).toEqual([]);
    expect(diffCorrections('o merge já passou', 'o merge passou')).toEqual([]);
  });

  it('does not treat a rewritten sentence as a mishearing', () => {
    expect(diffCorrections('fechei a tarefa ontem à noite', 'abri outro cartão agora de manhã cedo')).toEqual([]);
  });

  it('skips very short heard words that would swallow ordinary text', () => {
    expect(diffCorrections('o QA de hoje', 'o MR de hoje')).toEqual([]);
    expect(diffCorrections('foi de ontem', 'foi do ontem')).toEqual([]);
  });

  it('returns nothing when nothing changed', () => {
    expect(diffCorrections('igual', 'igual')).toEqual([]);
    expect(diffCorrections('', '')).toEqual([]);
  });

  it('keeps accents and symbols inside words', () => {
    expect(diffCorrections('abri o rótfix agora', 'abri o hotfix agora')).toEqual([{ heard: 'rótfix', term: 'hotfix' }]);
    expect(diffCorrections('o Q&A liberou', 'o Q.A. liberou')).toEqual([{ heard: 'Q&A', term: 'Q.A.' }]);
  });
});

const terms: Term[] = [
  { term: 'merge', say: '', heard: ['merdi'] },
  { term: 'deploy', say: '', heard: ['deploi', 'diploy'] },
  { term: 'QA', say: 'quiu ei', heard: [] },
];

describe('newCorrections', () => {
  it('drops what the glossary already knows', () => {
    expect(isKnown(terms, { heard: 'MERDI', term: 'Merge' })).toBe(true);
    expect(newCorrections(terms, 'o merdi e o diplói', 'o merge e o deploy')).toEqual([{ heard: 'diplói', term: 'deploy' }]);
  });
});

describe('learn', () => {
  it('adds the variant to an existing term, ignoring case of the term', () => {
    const next = learn(terms, { heard: 'mérgi', term: 'Merge' });
    expect(next[0]).toEqual({ term: 'merge', say: '', heard: ['merdi', 'mérgi'] });
    expect(next).toHaveLength(3);
  });

  it('creates the term when it is new', () => {
    expect(learn(terms, { heard: 'rótfix', term: 'hotfix' }).at(-1)).toEqual({ term: 'hotfix', say: '', heard: ['rótfix'] });
  });

  it('does not duplicate a known variant', () => {
    expect(learn(terms, { heard: 'MERDI', term: 'merge' })).toEqual(terms);
  });

  it('moves a variant away from the term that had it', () => {
    const next = learn(terms, { heard: 'deploi', term: 'merge' });
    expect(next[0].heard).toEqual(['merdi', 'deploi']);
    expect(next[1].heard).toEqual(['diploy']);
  });

  it('makes room by dropping the oldest variant of a full term', () => {
    const full: Term[] = [{ term: 'x', say: '', heard: Array.from({ length: 12 }, (_, i) => `v${i}`) }];
    const next = learn(full, { heard: 'novo', term: 'x' })[0].heard;
    expect(next).toHaveLength(12);
    expect(next[0]).toBe('v1');
    expect(next.at(-1)).toBe('novo');
  });

  it('does not change the list it received', () => {
    const before = JSON.stringify(terms);
    learn(terms, { heard: 'mérgi', term: 'merge' });
    expect(JSON.stringify(terms)).toBe(before);
  });

  it('makes the next transcription come back right', () => {
    const next = learn(terms, { heard: 'mérgi', term: 'merge' });
    expect(corrected('fiz o mérgi', next)).toBe('fiz o merge');
  });
});
