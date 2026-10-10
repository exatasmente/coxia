import { describe, expect, it } from 'vitest';
import { poolFieldsOf, poolWithoutProvider } from '../src/shared/config/pool';

const a = { provider: 'p1', model: 'model-a' };
const b = { provider: 'p2', model: 'model-b' };

describe('pool edits', () => {
  it('keeps only what is there, as copies', () => {
    expect(poolFieldsOf({})).toEqual({});
    expect(poolFieldsOf({ fallbacks: [], activities: { edit: [], shell: [] } })).toEqual({});
    const pool = { fallbacks: [a], activities: { edit: [b], shell: [] } };
    const out = poolFieldsOf(pool);
    expect(out).toEqual({ fallbacks: [a], activities: { edit: [b] } });
    expect(out.fallbacks?.[0]).not.toBe(a);
  });

  it('takes the entries of a provider out of every list, and a list that empties out of the pool', () => {
    expect(poolWithoutProvider({ fallbacks: [a, b], activities: { edit: [a], screen: [a, b] } }, 'p1')).toEqual({ fallbacks: [b], activities: { screen: [b] } });
    expect(poolWithoutProvider({ fallbacks: [a] }, 'p1')).toEqual({});
    expect(poolWithoutProvider({ fallbacks: [b] }, 'p1')).toEqual({ fallbacks: [b] });
  });
});
