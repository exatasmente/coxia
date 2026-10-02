import { describe, expect, it } from 'vitest';
import { proposalLines, sideLines } from '../src/renderer/src/conflictView';

describe('conflict view lines', () => {
  it('marks what a side added over the common ancestor', () => {
    expect(sideLines('keep\nnew\n', 'keep\n', 'ours')).toEqual([
      { text: 'keep', kind: 'plain' },
      { text: 'new', kind: 'ours' },
    ]);
    expect(sideLines('x\n', '', 'theirs')).toEqual([{ text: 'x', kind: 'theirs' }]);
  });

  it('does not guess without an ancestor, and an empty side has no lines', () => {
    expect(sideLines('a\nb\n', null, 'ours').every((l) => l.kind === 'plain')).toBe(true);
    expect(sideLines('', 'a\n', 'theirs')).toEqual([]);
  });

  it('tells where each proposal line came from and flags the ones neither side wrote', () => {
    const lines = proposalLines('shared\nfrom branch\nfrom main\ninvented\n', { ours: 'shared\nfrom branch\n', theirs: 'shared\nfrom main\n' });
    expect(lines.map((l) => l.kind)).toEqual(['plain', 'ours', 'theirs', 'new']);
  });

  it('handles CRLF text', () => {
    expect(sideLines('a\r\nb\r\n', 'a\r\n', 'ours').map((l) => l.text)).toEqual(['a', 'b']);
  });
});
