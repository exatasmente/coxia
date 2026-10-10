import { describe, expect, it } from 'vitest';
import { canEffort, canFailFast, canFlex, deprecationOf, effortFor } from '../src/shared/config/offer';
import { DEFAULT_EFFORT } from '../src/shared/config/types';

describe('what the server may be sent', () => {
  const on = { serviceTier: true, failFast: true, reasoningEffort: true };

  it('flex needs the server\'s tier, the model\'s mark and a flex switch that is not off', () => {
    expect(canFlex(on, { flex: true }, undefined)).toBe(true);
    expect(canFlex(on, { flex: true }, true)).toBe(true);
    expect(canFlex(on, { flex: true }, false)).toBe(false);
    expect(canFlex(on, { effort: true }, true)).toBe(false);
    expect(canFlex(on, undefined, true)).toBe(false);
    expect(canFlex({ ...on, serviceTier: false }, { flex: true }, true)).toBe(false);
    expect(canFlex(undefined, { flex: true }, true)).toBe(false);
  });

  it('effort needs the server\'s switch and a model marked for it', () => {
    expect(canEffort(on, { effort: true })).toBe(true);
    expect(canEffort(on, { flex: true })).toBe(false);
    expect(canEffort(on, undefined)).toBe(false);
    expect(canEffort({ ...on, reasoningEffort: false }, { effort: true })).toBe(false);
    expect(canEffort(undefined, { effort: true })).toBe(false);
  });

  it('fail-fast needs only the server\'s switch', () => {
    expect(canFailFast(on)).toBe(true);
    expect(canFailFast({ serviceTier: true })).toBe(false);
    expect(canFailFast(undefined)).toBe(false);
  });
});

describe('the effort of an activity', () => {
  it('is the proposal when the workspace says nothing: low to read and run, medium to edit, nothing to write and to look at the screen', () => {
    expect(DEFAULT_EFFORT).toEqual({ explore: 'low', shell: 'low', edit: 'medium' });
    expect(effortFor({}, 'explore')).toBe('low');
    expect(effortFor({}, 'shell')).toBe('low');
    expect(effortFor({}, 'edit')).toBe('medium');
    expect(effortFor({}, 'write')).toBeUndefined();
    expect(effortFor({}, 'screen')).toBeUndefined();
  });

  it('is what the workspace chose, and "default" sends nothing, even where there is a proposal', () => {
    const llm = { effort: { shell: 'high' as const, edit: 'default' as const, write: 'none' as const } };
    expect(effortFor(llm, 'shell')).toBe('high');
    expect(effortFor(llm, 'edit')).toBeUndefined();
    expect(effortFor(llm, 'write')).toBe('none');
    expect(effortFor(llm, 'explore')).toBe('low');
  });
});

describe('a model that is marked obsolete', () => {
  const at = 1_790_000_000;

  it('says when and by what it is replaced, and whether the date has passed', () => {
    expect(deprecationOf({ deprecated: at, replacedBy: 'model-b' }, (at - 10) * 1000)).toEqual({ at, past: false, replacedBy: 'model-b' });
    expect(deprecationOf({ deprecated: at }, (at + 10) * 1000)).toEqual({ at, past: true });
  });

  it('is nothing for a model with no date', () => {
    expect(deprecationOf(undefined)).toBeNull();
    expect(deprecationOf({ flex: true, replacedBy: 'model-b' })).toBeNull();
  });
});
