// The key of an agent's screen: what names it, what splits it, and the rule that a bare id is a stage's run.
import { describe, expect, it } from 'vitest';
import { callKey, keyOf, parseKey, runKey } from '../src/shared/browser';

describe('the key of a screen', () => {
  it('is made from a run or from a thread and an agent, and reads back the same', () => {
    expect(runKey('r-1')).toBe('run:r-1');
    expect(callKey('squad-web', 'dev')).toBe('call:squad-web:dev');
    expect(parseKey('run:r-1')).toEqual({ kind: 'run', run: 'r-1' });
    expect(parseKey(callKey('run-r-1', 'qa'))).toEqual({ kind: 'call', thread: 'run-r-1', agent: 'qa' });
  });

  it.each(['', 'r-1', 'run:', 'run:a:b', 'call:t', 'call:t:', 'call::a', 'call:t:a:b', 'other:a', 'run: a', 'call:a b:c'])('is not a key: %j', (text) => {
    expect(parseKey(text)).toBeNull();
  });

  it.each([null, undefined, 3, {}, ['run:a']])('is not a key when it is not text: %j', (v) => {
    expect(parseKey(v)).toBeNull();
    expect(keyOf(v)).toBeNull();
  });

  it('turns a bare run id into the stage\'s key and leaves a key as it is', () => {
    expect(keyOf('r-1')).toBe('run:r-1');
    expect(keyOf('run:r-1')).toBe('run:r-1');
    expect(keyOf('call:general:dev')).toBe('call:general:dev');
  });

  it('refuses what is neither a key nor a bare id', () => {
    for (const text of ['', 'run:', 'a:b', 'call:general', 'x y']) expect(keyOf(text), text).toBeNull();
  });
});
