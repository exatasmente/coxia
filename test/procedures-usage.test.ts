import { describe, expect, it } from 'vitest';
import { COMPARE_MIN_USES, compare, compareAll, type ProcedureStats, type ProcedureUseEntry } from '../src/shared/procedures';
import type { StageUsage } from '../src/shared/runs/types';

const usage = (tokens: number, over: Partial<StageUsage> = {}): StageUsage => ({ promptTokens: tokens - 100, completionTokens: 100, cachedTokens: 0, calls: 4, costUsd: null, ...over });
const use = (tokens: number, over: { failed?: boolean; usage?: Partial<StageUsage> } = {}): ProcedureUseEntry => ({ at: '2026-10-09T10:00:00.000Z', ref: 'app#1', failed: over.failed === true, usage: usage(tokens, over.usage) });
const stats = (baseline: StageUsage | null, recent: ProcedureUseEntry[], uses = recent.length): ProcedureStats => ({ uses, failures: 0, failuresSinceSave: 0, lastUsed: null, baseline, recent });

describe('compare: what a procedure cost to find with what it cost to use', () => {
  it('shows the saving as (baseline - average) x uses, labelled approximate', () => {
    const c = compare(stats(usage(10_000), [use(4_000), use(5_000), use(6_000)]));
    expect(c.enough).toBe(true);
    expect(c.approximate).toBe(true);
    expect(c.baseline).toEqual(usage(10_000));
    expect(c.average).toMatchObject({ promptTokens: 4_900, completionTokens: 100, calls: 4 });
    expect(c.saved).toEqual({ tokens: 15_000, costUsd: null, costEstimated: false });
    expect(c.counted).toBe(3);
    expect(c.noFailureShare).toBe(1);
  });

  it('multiplies by every use the procedure had, not only the last 20 kept', () => {
    const recent = Array.from({ length: 20 }, () => use(5_000));
    expect(compare(stats(usage(10_000), recent, 30)).saved?.tokens).toBe(150_000);
  });

  it('shows no saving with fewer than 3 uses, or without a baseline', () => {
    expect(COMPARE_MIN_USES).toBe(3);
    const two = compare(stats(usage(10_000), [use(1_000), use(1_000)]));
    expect(two).toMatchObject({ enough: false, saved: null, counted: 2 });
    expect(two.average).not.toBeNull();
    expect(compare(stats(null, [use(1), use(1), use(1)]))).toMatchObject({ enough: false, saved: null });
    expect(compare(stats(usage(10_000), []))).toMatchObject({ enough: false, saved: null, average: null, noFailureShare: null, counted: 0 });
  });

  it('shows no saving when the average is not below the baseline', () => {
    expect(compare(stats(usage(5_000), [use(5_000), use(5_000), use(5_000)])).saved).toBeNull();
    expect(compare(stats(usage(5_000), [use(9_000), use(9_000), use(9_000)])).saved).toBeNull();
    // Still a comparison to show, only not a saving.
    expect(compare(stats(usage(5_000), [use(9_000), use(9_000), use(9_000)])).enough).toBe(true);
  });

  it('counts a failed use in the average and takes it out of the share with no failure reported', () => {
    const c = compare(stats(usage(10_000), [use(4_000), use(4_000, { failed: true }), use(4_000), use(4_000)]));
    expect(c.noFailureShare).toBe(0.75);
    expect(c.counted).toBe(4);
  });

  describe('cost', () => {
    it('is there only where the baseline and every counted use reported one, and lower', () => {
      const priced = (tokens: number, costUsd: number, estimated = false) => use(tokens, { usage: { costUsd, ...(estimated ? { costEstimated: true } : {}) } });
      const c = compare(stats(usage(10_000, { costUsd: 0.5 }), [priced(4_000, 0.1), priced(4_000, 0.2), priced(4_000, 0.3)]));
      expect(c.saved?.costUsd).toBeCloseTo(0.3 * 3);
      expect(c.saved?.costEstimated).toBe(false);
      // One use with no figure: no cost, the tokens stay.
      const gap = compare(stats(usage(10_000, { costUsd: 0.5 }), [priced(4_000, 0.1), use(4_000), priced(4_000, 0.3)]));
      expect(gap.saved).toMatchObject({ tokens: 18_000, costUsd: null });
      expect(gap.average?.costUsd).toBeNull();
      // No baseline cost: none.
      expect(compare(stats(usage(10_000), [priced(4_000, 0.1), priced(4_000, 0.1), priced(4_000, 0.1)])).saved?.costUsd).toBeNull();
    });

    it('is an estimate when the baseline or any counted use says it is', () => {
      const priced = (estimated: boolean) => use(4_000, { usage: { costUsd: 0.1, ...(estimated ? { costEstimated: true } : {}) } });
      expect(compare(stats(usage(10_000, { costUsd: 0.5, costEstimated: true }), [priced(false), priced(false), priced(false)])).saved?.costEstimated).toBe(true);
      expect(compare(stats(usage(10_000, { costUsd: 0.5 }), [priced(false), priced(true), priced(false)])).saved?.costEstimated).toBe(true);
    });

    it('is not shown when it did not fall, though the tokens did', () => {
      const priced = use(4_000, { usage: { costUsd: 0.9 } });
      const c = compare(stats(usage(10_000, { costUsd: 0.5 }), [priced, priced, priced]));
      expect(c.saved?.tokens).toBeGreaterThan(0);
      expect(c.saved?.costUsd).toBeNull();
    });
  });
});

describe('compareAll: the workspace summary', () => {
  it('sums the savings that are shown, and nothing else', () => {
    const a = stats(usage(10_000, { costUsd: 1 }), [use(5_000, { usage: { costUsd: 0.5 } }), use(5_000, { usage: { costUsd: 0.5 } }), use(5_000, { usage: { costUsd: 0.5 } })]);
    const b = stats(usage(10_000), [use(8_000), use(8_000), use(8_000)]);
    const tooFew = stats(usage(10_000), [use(1_000)]);
    const worse = stats(usage(1_000), [use(9_000), use(9_000), use(9_000)]);
    const sum = compareAll([a, b, tooFew, worse]);
    expect(sum).toMatchObject({ procedures: 2, uses: 6, tokens: 15_000 + 6_000, approximate: true });
    expect(sum.costUsd).toBeCloseTo(1.5);
    expect(sum.costEstimated).toBe(false);
    expect(compareAll([tooFew])).toMatchObject({ procedures: 0, tokens: 0, costUsd: null });
  });
});
