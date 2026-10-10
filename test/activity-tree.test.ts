// The tree of the live activity, as plain functions: what the components draw is decided here (no component is rendered: the runner is a node environment).
import { describe, expect, it } from 'vitest';
import type { ActivityEntry, ActivityNode } from '../src/shared/activity';
import { createActivityStore } from '../src/renderer/src/activity';
import { buildTree, buildTreeOnce, createTreeView, defaultOpen, dockCounts, hasWork, newestLine, nodeTitle, stepText, topEntries, workingRoles } from '../src/renderer/src/activityTreeModel';

let seq = 0;
let clock = 1000;
const line = (runId: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ seq: ++seq, runId, jobId: 'run:r1', role: 'dev', at: ++clock, kind: 'tool', label: `Read f${seq}`, ...over });
const status = (runId: string, state: NonNullable<ActivityEntry['state']>, over: Partial<ActivityEntry> = {}) => line(runId, { kind: 'status', state, label: state, ...over });
const sub = (label: string): ActivityNode => ({ type: 'sub', label });
const called = (label: string): ActivityNode => ({ type: 'call', label });
/** The lines every entry of a node carries: where it hangs and what heads it. */
const under = (parent: string, node: ActivityNode, role: string) => ({ parent, node, role });

describe('buildTree', () => {
  it('groups lines by run, links children by parent and orders a node\'s lines and children by the order they began', () => {
    const root = [status('a', 'started'), line('a', { label: 'Read one' })];
    const child = [status('c', 'started', under('a', sub('explore: map the tests'), 'dev:explore')), line('c', { ...under('a', sub('explore: map the tests'), 'dev:explore'), label: 'Read deep' })];
    const after = line('a', { label: 'Read two' });
    const [tree] = buildTree([...root, ...child, after]);
    expect(tree.id).toBe('a');
    expect(tree.type).toBe('agent');
    expect(tree.items.map((i) => (i.type === 'node' ? `node ${i.node.id}` : i.entry.label))).toEqual(['started', 'Read one', 'node c', 'Read two']);
    expect(tree.children.map((c) => [c.id, c.type, c.label, c.role, c.parent])).toEqual([['c', 'sub', 'explore: map the tests', 'dev:explore', 'a']]);
    expect(tree.latest).toBe(after);
  });

  it('makes a root of a node whose parent is not in the lines, so nothing lands outside the tree', () => {
    const lonely = [status('x', 'started', under('missing', called('help'), 'qa')), line('x', under('missing', called('help'), 'qa'))];
    const roots = buildTree([...lonely, status('y', 'started')]);
    expect(roots.map((r) => [r.id, r.parent, r.type])).toEqual([['x', null, 'call'], ['y', null, 'agent']]);
  });

  it('reads the state from the newest status that is not a refusal', () => {
    const states = (lines: ActivityEntry[]) => buildTree(lines)[0].state;
    expect(states([status('a', 'queued')])).toBe('queued');
    expect(states([status('a', 'queued'), status('a', 'started')])).toBe('working');
    expect(states([status('a', 'started'), status('a', 'resumed')])).toBe('working');
    expect(states([status('a', 'started'), status('a', 'finished')])).toBe('finished');
    expect(states([status('a', 'started'), status('a', 'failed')])).toBe('failed');
    // a refusal is not an end, and a line after the end is not work
    expect(states([status('a', 'started'), status('a', 'blocked'), line('a')])).toBe('working');
    expect(states([status('a', 'started'), status('a', 'finished'), line('a', { kind: 'answer', label: 'excerpt' })])).toBe('finished');
    // a run that said nothing of the kind is not working
    expect(states([line('a')])).toBe('finished');
  });

  it('never interleaves three parallel children: each holds only its own lines and the parent none of theirs', () => {
    const ids = ['p1', 'p2', 'p3'];
    const head = (id: string) => under('root', sub(`explore: task ${id}`), 'dev:explore');
    const lines: ActivityEntry[] = [status('root', 'started')];
    for (const id of ids) lines.push(status(id, 'started', head(id)));
    // round-robin: a flat merge by sequence would mix them
    for (let round = 0; round < 3; round++) for (const id of ids) lines.push(line(id, { ...head(id), label: `Read ${id}-${round}` }));
    for (const id of ids) lines.push(status(id, 'finished', head(id)));
    lines.push(status('root', 'finished'));
    const raw = lines.filter((l) => l.kind === 'tool').map((l) => l.runId);
    expect(raw.slice(0, 6)).toEqual(['p1', 'p2', 'p3', 'p1', 'p2', 'p3']);
    const [tree] = buildTree(lines);
    expect(tree.children.map((c) => c.id)).toEqual(ids);
    for (const child of tree.children) {
      const own = child.items.flatMap((i) => (i.type === 'line' && i.entry.kind === 'tool' ? [i.entry.label] : []));
      expect(own).toEqual([0, 1, 2].map((r) => `Read ${child.id}-${r}`));
      expect(child.items.every((i) => i.type === 'line' && i.entry.runId === child.id)).toBe(true);
    }
    expect(tree.items.filter((i) => i.type === 'line' && i.entry.kind === 'tool')).toEqual([]);
  });

  it('keeps a finished sub-agent in the tree while its parent works', () => {
    const [tree] = buildTree([status('a', 'started'), status('c', 'started', under('a', sub('explore: x'), 'dev:explore')), status('c', 'finished', under('a', sub('explore: x'), 'dev:explore'))]);
    expect(tree.children[0].state).toBe('finished');
    expect(hasWork(tree)).toBe(true);
    expect(hasWork(tree.children[0])).toBe(false);
  });
});

describe('topEntries', () => {
  const run = (...extra: ActivityEntry[]) => [
    status('stage', 'started', { jobId: 'run:r1' }),
    status('s1', 'started', { jobId: 'run:r1', ...under('stage', sub('explore: one'), 'dev:explore') }),
    status('s2', 'started', { jobId: 'run:r1', ...under('stage', sub('explore: two'), 'dev:explore') }),
    status('c1', 'started', { jobId: 'run:r1', ...under('stage', called('help'), 'qa') }),
    line('c1', { jobId: 'run:r1', ...under('stage', called('help'), 'qa'), label: 'Read deep' }),
    ...extra,
  ];
  const conversation = (...extra: ActivityEntry[]) => [status('agent', 'started', { jobId: 'mention:squads' }), ...extra];

  it('counts a run and a conversation as two, whatever works inside them at any depth', () => {
    const all = new Map<string, readonly ActivityEntry[]>([
      ['run:r1', run()],
      ['mention:squads', conversation(status('call', 'started', { jobId: 'mention:squads', ...under('agent', called('and you?'), 'qa') }), status('deeper', 'started', { jobId: 'mention:squads', ...under('call', called('third'), 'ux') }))],
    ]);
    const tops = topEntries(all, new Set());
    expect(tops.map((t) => [t.kind, t.id])).toEqual([['run', 'r1'], ['conversation', 'squads']]);
    expect(tops).toHaveLength(2);
    // more children do not change the number
    const more = new Map(all).set('run:r1', [...run(), status('s3', 'started', { jobId: 'run:r1', ...under('s2', sub('shell: three'), 'dev:shell') })]);
    expect(topEntries(more, new Set())).toHaveLength(2);
  });

  it('builds the tree of a bucket once per change: the same array gives the same nodes, a new array builds again, and the other buckets are left alone', () => {
    const busy = run();
    const other = conversation();
    const first = topEntries(new Map<string, readonly ActivityEntry[]>([['run:r1', busy], ['mention:squads', other]]), new Set());
    // a line arrives in the conversation only: the store keeps the array of the run
    const grown = [...other, line('agent', { jobId: 'mention:squads', label: 'Read x' })];
    const second = topEntries(new Map<string, readonly ActivityEntry[]>([['run:r1', busy], ['mention:squads', grown]]), new Set());
    expect(second[0].nodes[0]).toBe(first[0].nodes[0]);
    expect(second[1].nodes[0]).not.toBe(first[1].nodes[0]);
    expect(buildTreeOnce(busy)).toBe(buildTreeOnce(busy));
    expect(buildTreeOnce(grown)).toEqual(buildTree(grown));
  });

  it('leaves a bucket a running renderer job owns to the job', () => {
    const all = new Map<string, readonly ActivityEntry[]>([['deep:#1:ask', [status('own', 'started', { jobId: 'deep:#1:ask' })]], ['run:r1', run()]]);
    expect(topEntries(all, new Set(['deep:#1:ask'])).map((t) => t.kind)).toEqual(['run']);
  });

  it('gives an activity with no run or conversation one entry per root, named for the agent', () => {
    const all = new Map<string, readonly ActivityEntry[]>([['', [status('f1', 'started', { jobId: null, role: 'turn' }), status('f2', 'started', { jobId: null, role: 'reply' }), status('f3', 'started', { jobId: null, role: 'deep' }), status('f3', 'finished', { jobId: null, role: 'deep' })]]]);
    const tops = topEntries(all, new Set());
    expect(tops.map((t) => [t.kind, t.id, workingRoles(t)])).toEqual([['agent', 'f1', ['turn']], ['agent', 'f2', ['reply']]]);
  });

  it('has no entry for a bucket with nothing working, and no generic one', () => {
    const done = [status('a', 'started', { jobId: 'run:r1' }), status('a', 'finished', { jobId: 'run:r1' })];
    expect(topEntries(new Map([['run:r1', done]]), new Set())).toEqual([]);
    expect(topEntries(new Map([['', [line('x', { jobId: null })]]]), new Set())).toEqual([]);
  });

  it('keeps a finished child while its parent is in the entry, and loses the entry with the last one working', () => {
    const lines = run();
    const first = [...lines, status('s1', 'finished', { jobId: 'run:r1', ...under('stage', sub('explore: one'), 'dev:explore') })];
    const [entry] = topEntries(new Map([['run:r1', first]]), new Set());
    expect(entry.nodes[0].children.map((c) => [c.id, c.state])).toEqual([['s1', 'finished'], ['s2', 'working'], ['c1', 'working']]);
    const ended = [
      ...first,
      status('s2', 'finished', { jobId: 'run:r1', ...under('stage', sub('explore: two'), 'dev:explore') }),
      status('c1', 'finished', { jobId: 'run:r1', ...under('stage', called('help'), 'qa') }),
      status('stage', 'finished', { jobId: 'run:r1' }),
    ];
    expect(topEntries(new Map([['run:r1', ended]]), new Set())).toEqual([]);
  });

  it('keeps an entry while only a called agent works, and shows the roots with work only', () => {
    const lines = [status('first', 'started', { jobId: 'run:r1' }), status('first', 'finished', { jobId: 'run:r1' }), ...run()];
    const stage = [...lines.filter((l) => l.runId === 'stage'), ...lines.filter((l) => l.runId !== 'stage' && l.runId !== 'first')];
    expect(topEntries(new Map([['run:r1', lines]]), new Set())[0].nodes.map((n) => n.id)).toEqual(['stage']);
    // the stage ended and the callee still works: the entry stays
    const onlyCallee = [...stage.filter((l) => l.runId !== 's1' && l.runId !== 's2'), status('stage', 'finished', { jobId: 'run:r1' })];
    expect(topEntries(new Map([['run:r1', onlyCallee]]), new Set())).toHaveLength(1);
  });

  it('shows the newest line anywhere in the tree as the entry\'s latest, and orders entries by when they began', () => {
    const early = [status('e', 'started', { jobId: 'run:early', at: 10 })];
    const lines = run();
    const [first, second] = topEntries(new Map([['run:r1', lines], ['run:early', early]]), new Set());
    expect(first.id).toBe('early');
    expect(second.latest).toBe(lines[lines.length - 1]);
    expect(newestLine(second.nodes)?.label).toBe('Read deep');
  });

  it('builds the same entries from a store that was backfilled as from one fed line by line', () => {
    const lines = run();
    const live = createActivityStore();
    for (const l of lines) live.add(l);
    const fetched = createActivityStore();
    fetched.backfill('run:r1', lines);
    const ids = (store: ReturnType<typeof createActivityStore>) => topEntries(store.snapshot(), new Set()).map((t) => [t.key, t.nodes.map((n) => [n.id, n.children.map((c) => c.id)])]);
    expect(ids(fetched)).toEqual(ids(live));
  });
});

describe('the numbers of the floating button', () => {
  it('counts the top-level entries and the renderer\'s own jobs, and says how many work', () => {
    const jobs = [{ status: 'running' }, { status: 'done' }, { status: 'failed' }];
    expect(dockCounts(jobs, 2)).toEqual({ total: 5, running: 3, failed: 1 });
    expect(dockCounts([], 0)).toEqual({ total: 0, running: 0, failed: 0 });
  });

  it('reads 2 for a run and a conversation however much runs inside them, the same for "running"', () => {
    const lines = [
      status('stage', 'started', { jobId: 'run:r1' }),
      status('s1', 'started', { jobId: 'run:r1', ...under('stage', sub('explore: one'), 'dev:explore') }),
      status('s2', 'started', { jobId: 'run:r1', ...under('stage', sub('explore: two'), 'dev:explore') }),
      status('c1', 'started', { jobId: 'run:r1', ...under('stage', called('help'), 'qa') }),
      status('c2', 'started', { jobId: 'run:r1', ...under('c1', called('third'), 'ux') }),
    ];
    const talk = [status('t', 'started', { jobId: 'mention:squads' })];
    const tops = topEntries(new Map([['run:r1', lines], ['mention:squads', talk]]), new Set());
    expect(dockCounts([], tops.length)).toEqual({ total: 2, running: 2, failed: 0 });
  });
});

describe('what is shown for the newest line', () => {
  it('is the word for a thought and the label for every other kind', () => {
    const thought = line('a', { kind: 'thought', label: 'the model\'s reasoning prose' });
    expect(stepText(thought, 'Thought')).toBe('Thought');
    for (const kind of ['tool', 'text', 'answer', 'status'] as const) expect(stepText(line('a', { kind, label: `a ${kind} line` }), 'Thought')).toBe(`a ${kind} line`);
  });

  it('never prints the prose of a thought that is the newest line of a node or of an entry', () => {
    const prose = 'secret-looking reasoning prose';
    const lines = [status('a', 'started', { jobId: 'run:r1' }), line('a', { jobId: 'run:r1', kind: 'thought', label: prose })];
    const [node] = buildTree(lines);
    expect(stepText(node.latest as ActivityEntry, 'Thought')).toBe('Thought');
    const [entry] = topEntries(new Map([['run:r1', lines]]), new Set());
    expect(stepText(entry.latest as ActivityEntry, 'Thought')).toBe('Thought');
    expect(stepText(entry.latest as ActivityEntry, 'Thought')).not.toContain(prose);
  });
});

describe('titles', () => {
  const nameOf = (role: string) => ({ dev: 'Developer', qa: 'QA' })[role] ?? role;

  it('heads an agent by its name, a sub-agent by its kind and task and a called agent by its name and the topic', () => {
    expect(nodeTitle({ type: 'agent', role: 'dev', label: '' }, nameOf)).toBe('Developer');
    expect(nodeTitle({ type: 'sub', role: 'dev:explore', label: 'explore: map the tests' }, nameOf)).toBe('explore: map the tests');
    expect(nodeTitle({ type: 'call', role: 'qa', label: 'how do I reproduce it?' }, nameOf)).toBe('QA: how do I reproduce it?');
    expect(nodeTitle({ type: 'call', role: 'qa', label: '' }, nameOf)).toBe('QA');
  });

  it('opens an agent\'s own node and closes a sub-agent or a called agent by default', () => {
    expect(defaultOpen({ type: 'agent' })).toBe(true);
    expect(defaultOpen({ type: 'sub' })).toBe(false);
    expect(defaultOpen({ type: 'call' })).toBe(false);
  });
});

describe('the tree view', () => {
  it('answers the default until the person chooses, and keeps the choice when new lines arrive', () => {
    const view = createTreeView();
    expect(view.open('a', true)).toBe(true);
    expect(view.open('s', false)).toBe(false);
    view.toggle('a', true);
    view.toggle('s', false);
    expect(view.open('a', true)).toBe(false);
    expect(view.open('s', false)).toBe(true);
    // the tree is rebuilt for new lines and the choices, held apart from it, are still there
    const store = createActivityStore();
    store.add(status('a', 'started'));
    const before = buildTree(store.entries('run:r1'));
    store.add(line('a'));
    expect(buildTree(store.entries('run:r1'))).not.toBe(before);
    expect(view.open('a', true)).toBe(false);
    expect(view.open('s', false)).toBe(true);
  });

  it('keeps the choice of a thought row apart from the node that holds it, and tells its listeners', () => {
    const view = createTreeView();
    const seen: number[] = [];
    const stop = view.subscribe(() => seen.push(view.version()));
    view.toggle('a:7', false);
    expect(view.open('a:7', false)).toBe(true);
    expect(view.open('a', true)).toBe(true);
    view.toggle('a:7', false);
    expect(view.open('a:7', false)).toBe(false);
    stop();
    view.toggle('a:7', false);
    expect(seen).toEqual([1, 2]);
  });
});
