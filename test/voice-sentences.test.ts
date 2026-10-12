// The sentences of an answer that can be spoken while it is still being written: a sentence is given out only once it is complete, never cut at a decimal, an
// abbreviation or inside a code block, and the live text arriving in pieces gives the same sentences as the whole text.
import { describe, expect, it } from 'vitest';
import { nextSentences } from '../src/renderer/src/voice/sentences';

/** Feeds `text` growing `step` characters at a time, then closes it, as the chat does with the live answer. */
function streamed(text: string, step: number): string[] {
  const out: string[] = [];
  let from = 0;
  for (let end = step; end < text.length; end += step) {
    const r = nextSentences(text.slice(0, end), from);
    out.push(...r.sentences);
    from = r.next;
  }
  out.push(...nextSentences(text, from, { final: true }).sentences);
  return out;
}

describe('nextSentences', () => {
  it('gives out a sentence only once a space follows its terminator', () => {
    expect(nextSentences('Hello there.', 0).sentences).toEqual([]);
    const r = nextSentences('Hello there. How are', 0);
    expect(r.sentences).toEqual(['Hello there.']);
    expect(nextSentences('Hello there. How are you? Fine', r.next).sentences).toEqual(['How are you?']);
  });

  it('does not cut at a decimal nor at an abbreviation', () => {
    expect(nextSentences('It costs 3.5 dollars. Ok', 0).sentences).toEqual(['It costs 3.5 dollars.']);
    expect(nextSentences('Use e.g. this one. Next', 0).sentences).toEqual(['Use e.g. this one.']);
    expect(nextSentences('Ask Dr. Silva today. Then', 0).sentences).toEqual(['Ask Dr. Silva today.']);
  });

  it('ends a sentence at a line break', () => {
    expect(nextSentences('A title\nmore', 0).sentences).toEqual(['A title']);
  });

  it('keeps a code block as one unit, given out only when it closes', () => {
    expect(nextSentences('Here:\n```\nconst a = 1. b\n', 0).sentences).toEqual(['Here:']);
    const text = 'Here:\n```\nconst a = 1. b\n```\nDone.';
    expect(nextSentences(text, 0).sentences).toEqual(['Here:', '```\nconst a = 1. b\n```']);
    expect(nextSentences(text, 0, { final: true }).sentences).toEqual(['Here:', '```\nconst a = 1. b\n```', 'Done.']);
  });

  it('gives out the rest without a terminator when the answer is final', () => {
    expect(nextSentences('One. And the rest', 0, { final: true })).toEqual({ sentences: ['One.', 'And the rest'], next: 17 });
  });

  it('gives the same sentences fed a character at a time as fed at once', () => {
    const text = 'First, 3.5 points. Then e.g. "quoted!" now?\nA list:\n```\nx = 1. y\n```\nLast one';
    const whole = nextSentences(text, 0, { final: true }).sentences;
    expect(whole.length).toBeGreaterThan(3);
    expect(streamed(text, 1)).toEqual(whole);
    expect(streamed(text, 7)).toEqual(whole);
  });
});
