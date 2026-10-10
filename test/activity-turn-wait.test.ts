// A node that reached its turn limit waits for the person (#246): its own state in the activity log, alive like any working node, cleared when the question is answered.
import { describe, expect, it } from 'vitest';
import { runActive } from '../src/shared/activity';
import { createActivityLog } from '../src/main/activity';

const log = () => createActivityLog({ maxRuns: 3 });

describe('the waiting state in the activity log', () => {
  it('makes a status line of state waiting, with the number of turns, in the words of the catalog', () => {
    const l = log();
    const run = l.begin('deep');
    run.status('started');
    run.tool('Read a.ts');
    run.waiting(12);
    const last = l.get(run.id).at(-1);
    expect(last).toMatchObject({ kind: 'status', state: 'waiting' });
    expect(last?.label).toMatch(/12/);
    expect(last?.label).toMatch(/waiting for you|esperando por você/);
  });

  it('is alive: the run is active while it waits, and stops being so when it finishes or fails', () => {
    const l = log();
    const run = l.begin('deep');
    run.status('started');
    run.waiting(3);
    expect(runActive(l.get(run.id), run.id)).toBe(true);
    run.continued();
    expect(l.get(run.id).at(-1)).toMatchObject({ kind: 'status', state: 'started' });
    expect(runActive(l.get(run.id), run.id)).toBe(true);
    run.waiting(6);
    run.status('finished');
    expect(runActive(l.get(run.id), run.id)).toBe(false);
    const other = l.begin('deep');
    other.status('started');
    other.waiting(3);
    other.status('failed', 'ended');
    expect(runActive(l.get(other.id), other.id)).toBe(false);
  });

  it('does not let a waiting node be evicted like a finished one: a tree that waits is kept past the cap, and one that finished goes first', () => {
    const l = log();
    const waiting = l.begin('deep');
    waiting.status('started');
    waiting.waiting(3);
    const done = l.begin('deep');
    done.status('started');
    done.status('finished');
    for (let i = 0; i < 3; i++) l.begin('deep').status('started');
    expect(l.get(done.id)).toEqual([]);
    expect(l.get(waiting.id).length).toBeGreaterThan(0);
  });

  it('keeps a waiting tree alive through a child, and drops it only by the far-too-many rule', () => {
    const l = createActivityLog({ maxRuns: 2 });
    const root = l.begin('deep');
    root.status('started');
    const child = root.child({ type: 'sub', label: 'explore: map' });
    child.status('started');
    child.waiting(12);
    root.status('finished');
    expect(runActive(l.get(root.id), child.id)).toBe(true);
    for (let i = 0; i < 2; i++) l.begin('deep').status('finished');
    expect(l.get(root.id).length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) l.begin('deep').status('started');
    expect(l.get(root.id)).toEqual([]);
  });

  it('is passed through a lent view, which swallows only finished and failed', () => {
    const l = log();
    const run = l.begin('deep');
    run.status('started');
    const lent = run.lend();
    lent.waiting(5);
    lent.continued();
    lent.status('finished');
    expect(l.get(run.id).map((e) => e.state)).toEqual(['started', 'waiting', 'started']);
  });
});
