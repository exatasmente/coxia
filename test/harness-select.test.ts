import { describe, expect, it } from 'vitest';
import { BUDGET_MAX, BUDGET_MIN, budgetFor, clipText } from '../src/shared/harness/select';

describe('AGENTS.md context budget', () => {
  it('uses the default cap, scales down to declared context windows, and keeps the floor', () => {
    expect(budgetFor(undefined)).toBe(BUDGET_MAX);
    expect(budgetFor(0)).toBe(BUDGET_MAX);
    expect(budgetFor(8000)).toBe(3600);
    expect(budgetFor(1000)).toBe(BUDGET_MIN);
    expect(budgetFor(1_000_000)).toBe(BUDGET_MAX);
  });

  it('clips at a nearby line boundary without exceeding the requested size', () => {
    const text = 'first line\nsecond line\nthird line\n';
    expect(clipText(text, text.length)).toBe(text);
    expect(clipText(text, 25)).toBe('first line\nsecond line');
    expect(clipText(text, 4)).toBe('firs');
    expect(clipText(text, 0)).toBe('');
  });
});
