// What Actions offers together: the proposals of one answer (a `unit.batch`) wait as one thing the person may approve in a batch, and everything else stays on its
// own. The grouping is pure, so the screen and this test read the same rule.
import { describe, expect, it } from 'vitest';
import { batchesOf } from '../src/shared/actions/batch';
import type { ReleaseAction, VcsCommand } from '../src/shared/types';

const note = (body: string): VcsCommand => ({ via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/101/notes', fields: { body } });

const action = (over: Partial<ReleaseAction> & Pick<ReleaseAction, 'key'>): ReleaseAction =>
  ({ id: over.key, kind: 'gitlab', issue: 101, state: 'pending', command: note(over.key), commands: undefined, unit: null, ...over }) as ReleaseAction;

describe('the proposals of one answer in Actions', () => {
  it('wait as one batch, in the order they were proposed, however many commands each holds', () => {
    const a = action({ key: 'mention:general:po:po:1:0:aa', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const b = action({ key: 'mention:general:po:po:1:1:bb', unit: { purpose: 'mention-write', batch: 'general:1' }, commands: [note('one'), note('two')], command: note('one') });
    const { batches, rest } = batchesOf([a, b]);
    expect(rest).toEqual([]);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ id: 'general:1' });
    expect(batches[0].actions.map((x) => x.key)).toEqual([a.key, b.key]);
  });

  it('keeps two answers of the same conversation, and anything with no batch, on their own', () => {
    const one = action({ key: 'mention:general:po:po:1:0:aa', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const two = action({ key: 'mention:general:po:po:2:0:aa', unit: { purpose: 'mention-write', batch: 'general:2' } });
    const lone = action({ key: 'priority:r-1:refine:1', unit: { purpose: 'priority' } });
    const { batches, rest } = batchesOf([one, two, lone]);
    expect(batches.map((b) => b.actions.map((x) => x.key))).toEqual([[one.key], [two.key]]);
    expect(rest.map((x) => x.key)).toEqual([lone.key]);
  });

  it('holds only what still waits: a write already decided is not part of the batch', () => {
    const pending = action({ key: 'a', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const done = action({ key: 'b', state: 'done', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const skipped = action({ key: 'c', state: 'skipped', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const failed = action({ key: 'd', state: 'failed', unit: { purpose: 'mention-write', batch: 'general:1' } });
    const { batches, rest } = batchesOf([pending, done, skipped, failed]);
    // A failed write is still the person's to retry, so it stays in the batch; one already done or skipped is not.
    expect(batches[0].actions.map((x) => x.key)).toEqual([pending.key, failed.key]);
    expect(rest.map((x) => x.key)).toEqual([done.key, skipped.key]);
  });
});
