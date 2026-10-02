import { describe, expect, it } from 'vitest';
import { hasMarkers, parseConflicts, regions, resolveSegments, withTerminator } from '../src/main/conflictHunks';

const MERGE = ['top', '<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs 1', '>>>>>>> origin/main', 'middle', '<<<<<<< HEAD', '=======', 'added by main', '>>>>>>> origin/main', 'end', ''].join('\n');

const DIFF3 = ['a', '<<<<<<< HEAD', 'ours', '||||||| merged common ancestors', 'base', '=======', 'theirs', '>>>>>>> origin/main', 'z', ''].join('\n');

describe('parseConflicts', () => {
  it('splits a merge-style file into plain text and regions, keeping the labels', () => {
    const segs = parseConflicts(MERGE);
    const rs = regions(segs);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual({ ours: 'ours 1\nours 2\n', base: null, theirs: 'theirs 1\n', oursLabel: 'HEAD', theirsLabel: 'origin/main' });
    expect(rs[1].ours).toBe('');
    expect(rs[1].theirs).toBe('added by main\n');
    expect('text' in segs[0] && segs[0].text).toBe('top\n');
  });

  it('reads the base of a diff3 hunk', () => {
    const [r] = regions(parseConflicts(DIFF3));
    expect(r).toMatchObject({ ours: 'ours\n', base: 'base\n', theirs: 'theirs\n' });
  });

  it('keeps CRLF line endings and a missing final newline', () => {
    const text = 'a\r\n<<<<<<< HEAD\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> origin/main\r\nlast';
    const segs = parseConflicts(text);
    const [r] = regions(segs);
    expect(r.ours).toBe('ours\r\n');
    expect(r.theirs).toBe('theirs\r\n');
    expect(resolveSegments(segs, () => 'X\r\n')).toBe('a\r\nX\r\nlast');
  });

  it('puts the chosen text back in place of each region', () => {
    const segs = parseConflicts(MERGE);
    const out = resolveSegments(segs, (i) => (i === 0 ? 'ours 1\nours 2\ntheirs 1\n' : ''));
    expect(out).toBe('top\nours 1\nours 2\ntheirs 1\nmiddle\nend\n');
    expect(hasMarkers(out)).toBe(false);
  });

  it('returns a file without conflicts as one plain segment', () => {
    expect(parseConflicts('just\ntext\n')).toEqual([{ text: 'just\ntext\n' }]);
    expect(parseConflicts('')).toEqual([]);
  });

  it('refuses a region that never closes or opens inside another', () => {
    expect(() => parseConflicts('<<<<<<< HEAD\nours\n=======\ntheirs\n')).toThrow(/não fecha/);
    expect(() => parseConflicts('<<<<<<< HEAD\n<<<<<<< again\n=======\nx\n>>>>>>> m\n')).toThrow(/aninhado/);
  });

  it('treats a "=======" line inside the theirs side as content', () => {
    const [r] = regions(parseConflicts('<<<<<<< HEAD\na\n=======\nTitle\n=======\n>>>>>>> m\n'));
    expect(r.theirs).toBe('Title\n=======\n');
  });
});

describe('hasMarkers', () => {
  it('flags opening and closing markers, with or without a label', () => {
    expect(hasMarkers('x\n<<<<<<< HEAD\ny')).toBe(true);
    expect(hasMarkers('x\n>>>>>>> origin/main\n')).toBe(true);
    expect(hasMarkers('x\n<<<<<<<\n')).toBe(true);
    expect(hasMarkers('x\r\n>>>>>>> m\r\n')).toBe(true);
  });

  it('does not flag a markdown heading underline or arrows in code', () => {
    expect(hasMarkers('Title\n=======\nbody\n')).toBe(false);
    expect(hasMarkers('a <<<<<<< b\n')).toBe(false);
    expect(hasMarkers('x << y\n>>>>>> six\n')).toBe(false);
  });
});

describe('withTerminator', () => {
  it('ends a resolution on a line break in the file own line ending', () => {
    expect(withTerminator('a', 'x\n')).toBe('a\n');
    expect(withTerminator('a', 'x\r\ny\r\n')).toBe('a\r\n');
    expect(withTerminator('a\n', 'x')).toBe('a\n');
    expect(withTerminator('', 'x')).toBe('');
  });
});
