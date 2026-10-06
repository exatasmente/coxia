import type { ReleaseAction } from '../types';

// What Actions offers together: the proposals one answer raised carry a `unit.batch` and wait as one thing to the person, who may approve them in a batch. The
// grouping is pure so the screen and its test read the same rule: pending (or failed) proposals of one batch, in the order they wait; everything else is on its own.

export interface Batch {
  /** The identifier of the group (`unit.batch`). */
  id: string;
  actions: ReleaseAction[];
}

const openState = (a: ReleaseAction): boolean => a.state === 'pending' || a.state === 'failed';

/** The batches of a list of proposals, and the ones that are not part of one. */
export function batchesOf(list: readonly ReleaseAction[]): { batches: Batch[]; rest: ReleaseAction[] } {
  const byId = new Map<string, ReleaseAction[]>();
  const rest: ReleaseAction[] = [];
  for (const a of list) {
    const id = typeof a.unit?.batch === 'string' ? a.unit.batch : null;
    if (!id || !openState(a)) rest.push(a);
    else byId.set(id, [...(byId.get(id) ?? []), a]);
  }
  return { batches: [...byId.entries()].map(([id, actions]) => ({ id, actions })), rest };
}
