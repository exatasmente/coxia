import { describe, expect, it } from 'vitest';
import { priorityOf } from '../src/shared/priority';

describe('priorityOf', () => {
  const levels = ['^P0$', '^P1$', 'priority::low'];

  it('is the first configured level that one of the issue labels matches, with the issue\'s own label', () => {
    expect(priorityOf(['bug', 'p1', 'P0'], levels)).toEqual({ rank: 0, label: 'P0' });
    expect(priorityOf(['bug', 'P1'], levels)).toEqual({ rank: 1, label: 'P1' });
    expect(priorityOf(['Priority::Low'], levels)).toEqual({ rank: 2, label: 'Priority::Low' });
  });

  it('is null with no match, no labels, no levels or labels the tracker did not report', () => {
    expect(priorityOf(['bug', 'P10'], levels)).toBeNull();
    expect(priorityOf([], levels)).toBeNull();
    expect(priorityOf(['P0'], [])).toBeNull();
    expect(priorityOf(undefined, levels)).toBeNull();
  });

  it('matches like a stage pattern: a level without anchors is a substring, and a broken one is skipped', () => {
    expect(priorityOf(['urgent-now'], ['urgent'])).toEqual({ rank: 0, label: 'urgent-now' });
    expect(priorityOf(['P1'], ['[', '^P1$'])).toEqual({ rank: 1, label: 'P1' });
  });
});
