import { describe, expect, it } from 'vitest';
import { proposeBatches, type ProposeHunk } from '../src/main/agents';

const hunk = (id: string, file: string, size = 10): ProposeHunk => ({ id, file, ours: 'a'.repeat(size), base: null, theirs: 'b'.repeat(size) });

describe('proposeBatches', () => {
  it('groups hunks by file, keeping their order', () => {
    const batches = proposeBatches([hunk('1', 'a.ts'), hunk('2', 'b.ts'), hunk('3', 'a.ts')]);
    expect(batches.map((b) => b.map((h) => h.id))).toEqual([['1', '3'], ['2']]);
  });

  it('splits a file whose hunks pass the size budget', () => {
    const batches = proposeBatches([hunk('1', 'a.ts', 7000), hunk('2', 'a.ts', 7000), hunk('3', 'a.ts', 7000)]);
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
  });

  it('never leaves a hunk out', () => {
    const hunks = Array.from({ length: 40 }, (_, i) => hunk(String(i), `f${i % 7}.ts`, 2000 + i * 100));
    expect(proposeBatches(hunks).flat().map((h) => h.id).sort()).toEqual(hunks.map((h) => h.id).sort());
  });
});
