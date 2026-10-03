// How the findings of a review become the comments of a review on the pull request: where each one stands on the diff, what its comment says, and
// when a replacement may be a suggestion block the author applies with one click.
import { describe, expect, it } from 'vitest';
import { commentText, generalFindings, lineCountText, placeFindings, replacementBlock, reviewComments, sameFinding, withTail, withoutRepeats } from '../src/main/runner/review';
import type { Finding } from '../src/shared/runs';

const f = (over: Partial<Finding> = {}): Finding => ({ path: 'src/a.ts', line: 11, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: null, ...over });
const PATCH = '@@ -10,4 +10,5 @@\n a\n-b\n+B\n+C\n d\n e\n';
const changes = [{ path: 'src/a.ts', diff: PATCH }, { path: 'docs/a.md', diff: '' }];

describe('where a finding stands on the diff', () => {
  it('puts a finding whose lines are in the diff on them, on the side it names, a range ending on its last line', () => {
    const [single, range, removed] = placeFindings([f(), f({ line: 11, endLine: 12, suggestion: 'x' }), f({ side: 'old', line: 11 })], changes);
    expect(single).toMatchObject({ where: 'line', anchored: true, line: 11, startLine: null });
    expect(range).toMatchObject({ where: 'line', anchored: true, line: 12, startLine: 11 });
    expect(removed).toMatchObject({ where: 'line', line: 11 });
  });

  it('puts a finding about a file, or whose line is not in the diff, on the file: never on a line that is not the one it names', () => {
    const [whole, outside, partial, empty] = placeFindings([f({ line: null }), f({ line: 40 }), f({ line: 13, endLine: 20 }), f({ path: 'docs/a.md', line: 1 })], changes);
    for (const p of [whole, outside, partial, empty]) expect(p).toMatchObject({ where: 'file', anchored: false, line: null });
    // a side that is not in the diff for that number: line 12 of the old file is there, line 12 of the new file too, but 15 of the old one is not
    expect(placeFindings([f({ side: 'old', line: 15 })], changes)[0].where).toBe('file');
  });

  it('puts a finding whose file left the diff in the general comment', () => {
    expect(placeFindings([f({ path: 'src/gone.ts' })], changes)[0]).toMatchObject({ where: 'general' });
  });

  it('keeps the place of each in the round\'s list', () => {
    expect(placeFindings([f({ path: 'src/gone.ts' }), f(), f({ line: null })], changes).map((p) => [p.index, p.where])).toEqual([[0, 'general'], [1, 'line'], [2, 'file']]);
  });
});

describe('the replacement a finding proposes', () => {
  const [line, range] = placeFindings([f({ suggestion: 'export const a = 2;' }), f({ line: 11, endLine: 13, suggestion: 'one();\ntwo();' })], changes);

  it('is a suggestion block on GitHub, and says nothing of the range because the comment covers it', () => {
    expect(replacementBlock('github', line, 'en')).toBe('```suggestion\nexport const a = 2;\n```');
    expect(replacementBlock('github', range, 'en')).toBe('```suggestion\none();\ntwo();\n```');
  });

  it('is a suggestion block on GitLab that says how many lines above the commented one it replaces, computed from the range', () => {
    expect(replacementBlock('gitlab', line, 'en')).toBe('```suggestion:-0+0\nexport const a = 2;\n```');
    expect(replacementBlock('gitlab', range, 'en')).toBe('```suggestion:-2+0\none();\ntwo();\n```');
  });

  it('is only described, in a plain code block, on Bitbucket, which has no such thing', () => {
    expect(replacementBlock('bitbucket', line, 'en')).toBe('Suggested replacement:\n\n```\nexport const a = 2;\n```');
    expect(replacementBlock('bitbucket', line, 'pt-BR')).toBe('Troca sugerida:\n\n```\nexport const a = 2;\n```');
  });

  it('is described, never a block, when the comment does not stand exactly where the finding says: off the diff, on a removed line, on the file', () => {
    const [off, old, whole] = placeFindings([f({ line: 40, suggestion: 'x' }), f({ side: 'old', line: 11, suggestion: 'x' }), f({ line: null, suggestion: 'x' })], changes);
    for (const p of [off, old, whole]) for (const kind of ['github', 'gitlab'] as const) expect(replacementBlock(kind, p, 'en'), `${p.where} ${kind}`).toBe('Suggested replacement:\n\n```\nx\n```');
  });

  it('is nothing when there is no replacement, and its fence is longer than any run of backticks in it', () => {
    expect(replacementBlock('github', placeFindings([f()], changes)[0], 'en')).toBe('');
    expect(replacementBlock('github', placeFindings([f({ suggestion: '  ' })], changes)[0], 'en')).toBe('');
    const [p] = placeFindings([f({ suggestion: 'const a = `x`;\n```js\nb\n```' })], changes);
    expect(replacementBlock('github', p, 'en')).toBe('````suggestion\nconst a = `x`;\n```js\nb\n```\n````');
  });
});

describe('the comment of a finding', () => {
  it('says whether it blocks, what is wrong and the replacement, and where it was meant to be when it had to move to the file', () => {
    const [onLine, moved] = placeFindings([f({ suggestion: 'a;' }), f({ line: 40, severity: 'suggestion', body: 'Unused.' })], changes);
    expect(commentText('github', onLine, 'en')).toBe('**Blocks the change.** The constant must be 2.\n\n```suggestion\na;\n```');
    expect(commentText('github', moved, 'en')).toBe('**Suggestion, does not block.** Unused.\n\nThis is about src/a.ts:40, which is outside the lines the pull request changes.');
    expect(commentText('github', moved, 'pt-BR')).toContain('**Sugestão, não bloqueia.** Unused.');
  });

  it('turns the placed findings into the comments of the review: lines and files, in order, with the text given; the general ones are not comments', () => {
    const placed = placeFindings([f(), f({ line: null }), f({ path: 'src/gone.ts' }), f({ line: 11, endLine: 12 })], changes);
    const out = reviewComments(placed, new Map([[0, 'zero'], [1, 'one'], [3, 'three']]));
    expect(out).toEqual([
      { path: 'src/a.ts', line: 11, startLine: null, side: 'new', body: 'zero' },
      { path: 'src/a.ts', line: null, startLine: null, side: 'new', body: 'one' },
      { path: 'src/a.ts', line: 12, startLine: 11, side: 'new', body: 'three' },
    ]);
  });

  it('lists in the general comment, each with its place, the findings whose file left the change', () => {
    expect(generalFindings(placeFindings([f(), f({ path: 'src/gone.ts', line: 3, severity: 'suggestion', body: 'Left.' })], changes), 'en')).toBe('### Points about files that are no longer in the change\n- **Suggestion, does not block.** `src/gone.ts:3`: Left.');
    expect(generalFindings(placeFindings([f()], changes), 'en')).toBe('');
  });

  it('puts what the general comment adds before the technical detail, or before the marker when there is none', () => {
    expect(withTail('**S**\n\ntext\n\n<details>\nd\n</details>\n\n<!-- m -->\n', 'extra')).toBe('**S**\n\ntext\n\nextra\n\n<details>\nd\n</details>\n\n<!-- m -->\n');
    expect(withTail('**S**\n\ntext\n\n<!-- m -->\n', 'extra')).toBe('**S**\n\ntext\n\nextra\n\n<!-- m -->\n');
    expect(withTail('**S**\n', '  ')).toBe('**S**\n');
  });
});

describe('whether two findings of different rounds are the same', () => {
  it('is yes for the same file with the same words or most of them, wherever the line is now, and for the same replacement', () => {
    expect(sameFinding(f(), f({ line: 40 }))).toBe(true);
    expect(sameFinding(f({ body: 'The constant must be 2, not 1.' }), f({ body: 'The constant has to be 2 and not 1.' }))).toBe(true);
    expect(sameFinding(f({ body: 'Something else entirely.', suggestion: 'a();' }), f({ body: 'Unrelated words here.', suggestion: ' a(); ' }))).toBe(true);
  });

  it('is no for another file or another point', () => {
    expect(sameFinding(f(), f({ path: 'src/b.ts' }))).toBe(false);
    expect(sameFinding(f(), f({ body: 'The helper is never called anywhere.' }))).toBe(false);
  });
});

describe('the general comment of a review', () => {
  it('says in one line how many comments the review left on the code, in the comment\'s language', () => {
    expect(lineCountText(0, 'en')).toBe('No comment left on the code itself.');
    expect(lineCountText(1, 'en')).toBe('1 comment left on the code itself; it is not repeated here.');
    expect(lineCountText(4, 'en')).toBe('4 comments left on the code itself; they are not repeated here.');
    expect(lineCountText(2, 'pt-BR')).toBe('2 comentários deixados no próprio código; não se repetem aqui.');
  });

  it('leaves out of the agent\'s text what a finding says on its line, and keeps what is about no finding', () => {
    const findings = [f({ body: 'The substitution of every non alphanumeric sequence by one hyphen makes punctuation between letters introduce a separation.' }), f({ path: 'test/a.test.ts', line: 3, body: 'No regression case for punctuation between letters.' })];
    const text = [
      'The substitution of every non alphanumeric sequence by a single hyphen makes punctuation between letters introduce separation, which rule 3 forbids.',
      '- The suite lacks a regression case for punctuation between letters in test/a.test.ts:3.\n- The change needs a note in the changelog before it ships.',
      'The review did not run the application.',
    ].join('\n\n');
    const out = withoutRepeats({ sections: [{ heading: 'Beyond', body: text }, { heading: 'Repeated only', body: 'The substitution of every non alphanumeric sequence by one hyphen makes punctuation between letters introduce a separation.' }], technical: 'kept' }, findings);
    expect(out).toEqual({ sections: [{ heading: 'Beyond', body: '- The change needs a note in the changelog before it ships.\n\nThe review did not run the application.' }], technical: 'kept' });
  });

  it('changes nothing when there are no findings or no text, and does not drop short remarks', () => {
    const c = { sections: [{ heading: 'a', body: 'All good.' }], technical: '' };
    expect(withoutRepeats(c, [])).toBe(c);
    expect(withoutRepeats(null, [f()])).toBeNull();
    expect(withoutRepeats(c, [f({ body: 'All good, really good, all good.' })])).toEqual(c);
  });
});
