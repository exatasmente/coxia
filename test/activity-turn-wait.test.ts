// A node that reached its turn limit waits for the person (#246): its own state in the activity log, alive like any working node, cleared when the question is answered.
import { describe, expect, it } from 'vitest';
import type { ActivityEntry, ActivityNode } from '../src/shared/activity';
import { runActive } from '../src/shared/activity';
import { createActivityLog } from '../src/main/activity';
import { setLanguage, t } from '../src/shared/i18n';
import { activeRunIds } from '../src/renderer/src/activity';
import { anyWaiting, buildTree, dockCounts, hasWork, topEntries, waitingLine, waitsBelow } from '../src/renderer/src/activityTreeModel';

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

// The tree model: the lines as the screens get them. No component is rendered; what the rows say is decided by these functions.
let seq = 0;
let clock = 1000;
const line = (runId: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ seq: ++seq, runId, jobId: 'run:r1', role: 'dev', at: ++clock, kind: 'tool', label: `Read f${seq}`, ...over });
const status = (runId: string, state: NonNullable<ActivityEntry['state']>, over: Partial<ActivityEntry> = {}) => line(runId, { kind: 'status', state, label: state === 'waiting' ? 'Reached 12 turns: waiting for you' : state, ...over });
const sub = (label: string): ActivityNode => ({ type: 'sub', label });
const under = (parent: string, label: string) => ({ parent, node: sub(label), role: 'dev:explore' });

/** A run whose agent works, with a sub-agent that waits for the person and another that works. */
function tree(): ActivityEntry[] {
  return [
    status('root', 'started'),
    status('w', 'started', under('root', 'explore: map')),
    status('b', 'started', under('root', 'explore: other')),
    line('w', under('root', 'explore: map')),
    status('w', 'waiting', under('root', 'explore: map')),
  ];
}

describe('the waiting state in the tree model', () => {
  it('gives a node that waits its own state, apart from waiting its turn', () => {
    const [root] = buildTree(tree());
    const byId = (id: string) => root.children.find((c) => c.id === id)!;
    expect(byId('w').state).toBe('waiting');
    expect(byId('b').state).toBe('working');
    expect(buildTree([status('q', 'queued')])[0].state).toBe('queued');
    expect(root.state).toBe('working');
  });

  it('counts a waiting node as work, at the top and below, so the entry stays and is counted once', () => {
    const lines = tree();
    const [root] = buildTree(lines);
    expect(hasWork(root)).toBe(true);
    // the agent itself has finished and only the sub-agent waits: the tree is still live
    const only = [status('root', 'finished'), ...lines.slice(1)];
    const [done] = buildTree(only);
    expect(done.state).toBe('finished');
    expect(hasWork(done)).toBe(true);
    const all = new Map([['run:r1', only]]);
    const tops = topEntries(all, new Set());
    expect(tops).toHaveLength(1);
    expect(dockCounts([], tops.length).total).toBe(1);
    // a waiting root alone is work as well
    expect(hasWork(buildTree([status('r', 'started'), status('r', 'waiting')])[0])).toBe(true);
  });

  it('says on every ancestor, and not on the node itself or its siblings, that something below waits', () => {
    const lines = [
      status('root', 'started'),
      status('mid', 'started', under('root', 'explore: mid')),
      status('leaf', 'started', { parent: 'mid', node: sub('explore: leaf'), role: 'dev:explore' }),
      status('leaf', 'waiting', { parent: 'mid', node: sub('explore: leaf'), role: 'dev:explore' }),
      status('sib', 'started', under('root', 'explore: sibling')),
    ];
    const [root] = buildTree(lines);
    const byId = (id: string) => root.children.find((c) => c.id === id)!;
    const mid = byId('mid');
    const leaf = mid.children[0];
    expect(waitsBelow(root)).toBe(true);
    expect(waitsBelow(mid)).toBe(true);
    expect(waitsBelow(leaf)).toBe(false);
    expect(waitsBelow(byId('sib'))).toBe(false);
    expect(anyWaiting([root])).toBe(true);
    expect(anyWaiting([byId('sib')])).toBe(false);
    expect(topEntries(new Map([['run:r1', lines]]), new Set())[0].waits).toBe(true);
  });

  it('is false for a tree that only works, and goes back to false once the node continues or finishes', () => {
    const plain = [status('root', 'started'), status('c', 'started', under('root', 'explore: x'))];
    expect(topEntries(new Map([['run:r1', plain]]), new Set())[0].waits).toBe(false);
    const waiting = tree();
    expect(waitsBelow(buildTree(waiting)[0])).toBe(true);
    const continued = [...waiting, status('w', 'started', under('root', 'explore: map'))];
    expect(waitsBelow(buildTree(continued)[0])).toBe(false);
    expect(buildTree(continued)[0].children.find((c) => c.id === 'w')!.state).toBe('working');
    const finished = [...waiting, status('w', 'finished', under('root', 'explore: map'))];
    expect(waitsBelow(buildTree(finished)[0])).toBe(false);
    expect(buildTree(finished)[0].children.find((c) => c.id === 'w')!.state).toBe('finished');
  });

  it('gives the reason of the newest node that waits, for the closed line of the entry', () => {
    const lines = tree();
    const roots = buildTree(lines);
    expect(waitingLine(roots)?.label).toBe('Reached 12 turns: waiting for you');
    expect(waitingLine(buildTree([status('root', 'started')]))).toBeNull();
    // two waiting: the newest wins
    const second = [...lines, status('b', 'waiting', { ...under('root', 'explore: other'), label: 'Reached 5 turns: waiting for you' })];
    expect(waitingLine(buildTree(second))?.label).toBe('Reached 5 turns: waiting for you');
  });

  it('keeps the run active for the dock through the shared rule', () => {
    expect(activeRunIds(tree())).toEqual(expect.arrayContaining(['root', 'w']));
  });

  it('has the words for every state a row can show, in both languages, the waiting ones apart from waiting a turn', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      try {
        for (const state of ['queued', 'waiting', 'working', 'finished', 'failed']) expect(t(`activity.node.state.${state}`), `${language} ${state}`).not.toBe(`activity.node.state.${state}`);
        expect(t('activity.node.state.waiting')).not.toBe(t('activity.node.state.queued'));
        expect(t('activity.node.waitsBelow')).not.toBe('activity.node.waitsBelow');
      } finally {
        setLanguage('pt-BR');
      }
    }
  });
});
