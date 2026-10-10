import { describe, expect, it } from 'vitest';
import { DEFAULT_POOL_MODE, POOL_MODES, effectivePoolMode, resolvePoolMode } from '../src/shared/config';

// How a pool is used is chosen in three places; the nearest to the work wins, and without a list for an activity `switch` and `delegate` mean nothing.

describe('which mode applies', () => {
  it('lists the three modes and defaults to delegate', () => {
    expect([...POOL_MODES]).toEqual(['fallback', 'switch', 'delegate']);
    expect(DEFAULT_POOL_MODE).toBe('delegate');
    expect(resolvePoolMode({})).toBe('delegate');
  });

  it('takes the agent, then the stage, then the workspace', () => {
    expect(resolvePoolMode({ agent: 'fallback', stage: 'switch', workspace: 'delegate' })).toBe('fallback');
    expect(resolvePoolMode({ stage: 'switch', workspace: 'fallback' })).toBe('switch');
    expect(resolvePoolMode({ workspace: 'fallback' })).toBe('fallback');
    expect(resolvePoolMode({ agent: undefined, stage: undefined, workspace: undefined })).toBe('delegate');
  });

  it('lets an agent fall back to the default when it and the others say nothing', () => {
    expect(resolvePoolMode({ agent: 'delegate', workspace: 'fallback' })).toBe('delegate');
  });
});

describe('the mode a pool really has', () => {
  const ref = { provider: 'p', model: 'model-a' };

  it('keeps fallback whatever the lists say', () => {
    expect(effectivePoolMode('fallback', { shell: [ref] })).toBe('fallback');
  });

  it('is fallback for switch and delegate without a list of its own for explore, edit, shell or screen', () => {
    expect(effectivePoolMode('delegate', undefined)).toBe('fallback');
    expect(effectivePoolMode('switch', {})).toBe('fallback');
    expect(effectivePoolMode('delegate', { shell: [] })).toBe('fallback');
    // `write` is the main model's own list, not a reason to hand work out.
    expect(effectivePoolMode('delegate', { write: [ref] })).toBe('fallback');
  });

  it('keeps switch and delegate when one of the four activities has a list', () => {
    for (const a of ['explore', 'edit', 'shell', 'screen'] as const) {
      expect(effectivePoolMode('delegate', { [a]: [ref] })).toBe('delegate');
      expect(effectivePoolMode('switch', { [a]: [ref] })).toBe('switch');
    }
  });
});
