import { describe, expect, it } from 'vitest';
import { ACTIVITY_ANSWER_MAX, ACTIVITY_NODE_MAX, ACTIVITY_RING, ACTIVITY_TEXT_MAX, ACTIVITY_THOUGHT_MAX, runActive, takeContext, tagArgs, type ActivityEntry } from '../src/shared/activity';
import { activityLog, beginActivity, bindActivityParent, createActivityLog, currentActivity, currentJobId, safeText, setThoughtsGate, withActivityContext, withActivityParent } from '../src/main/activity';
import { handle, invoke } from '../src/main/rpc';

const clock = () => {
  let t = 1000;
  return () => (t += 10);
};

describe('the activity log', () => {
  it('numbers the entries, keeps the run, role and job on each, and pushes them to the sink', () => {
    const log = createActivityLog({ now: clock() });
    const pushed: unknown[] = [];
    log.setSink((e) => pushed.push(e));
    const run = log.begin('deep', { jobId: 'job-1', callId: 'c1' });
    run.status('started');
    run.tool('Read /repo/a.ts');
    run.status('finished');
    const entries = log.get(run.id);
    expect(entries.map((e) => [e.kind, e.state ?? null])).toEqual([['status', 'started'], ['tool', null], ['status', 'finished']]);
    expect(entries.every((e) => e.runId === run.id && e.role === 'deep' && e.jobId === 'job-1')).toBe(true);
    expect(entries.map((e) => e.seq)).toEqual([...entries.map((e) => e.seq)].sort((a, b) => a - b));
    expect(entries[1]).toMatchObject({ kind: 'tool', label: 'Read /repo/a.ts', at: expect.any(Number) });
    expect(pushed).toEqual(entries);
  });

  it('bounds the ring of a run to the newest entries', () => {
    const log = createActivityLog({ ring: 5 });
    const run = log.begin('deep');
    for (let i = 0; i < 12; i++) run.tool(`Read f${i}`);
    const entries = log.get(run.id);
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.label)).toEqual(['Read f7', 'Read f8', 'Read f9', 'Read f10', 'Read f11']);
    expect(ACTIVITY_RING).toBe(200);
  });

  it('forgets the oldest finished runs past the cap and keeps the running ones', () => {
    const log = createActivityLog({ maxRuns: 3 });
    const first = log.begin('deep');
    first.status('started');
    const done = log.begin('deep');
    done.status('started');
    done.status('finished');
    for (let i = 0; i < 3; i++) log.begin('deep').status('started');
    expect(log.get(done.id)).toEqual([]);
    expect(log.get(first.id).length).toBeGreaterThan(0);
  });

  it('shows the narration only when a tool call follows it', () => {
    const log = createActivityLog();
    const run = log.begin('deep');
    run.text('Vou ler o arquivo de rotas.');
    run.tool('Read routes.ts');
    run.text('{"fala":"resposta final"}');
    run.status('finished');
    expect(log.get(run.id).map((e) => [e.kind, e.label])).toEqual([
      ['text', 'Vou ler o arquivo de rotas.'],
      ['tool', 'Read routes.ts'],
      ['status', expect.any(String)],
    ]);
  });

  it('trims the narration to 200 characters on one line', () => {
    const log = createActivityLog();
    const run = log.begin('deep');
    run.text(`primeira linha\n\n${'palavra '.repeat(80)}`);
    run.tool('Grep x');
    const text = log.get(run.id)[0];
    expect(text.label.length).toBeLessThanOrEqual(ACTIVITY_TEXT_MAX);
    expect(text.label).not.toMatch(/\n/);
    expect(text.label.endsWith('…')).toBe(true);
  });

  it('marks a refused call as blocked', () => {
    const log = createActivityLog();
    const run = log.begin('deep');
    run.blocked('Read /repo/.env');
    expect(log.get(run.id)[0]).toMatchObject({ kind: 'status', state: 'blocked', label: expect.stringMatching(/^Bloqueado: Read /) });
  });

  it('never lets a failing sink or path check break the run', () => {
    const log = createActivityLog();
    log.setSink(() => {
      throw new Error('sink down');
    });
    const run = log.begin('deep', { isSecretPath: () => { throw new Error('fs'); } });
    expect(() => run.tool('Read /a/b')).not.toThrow();
    expect(log.get(run.id)[0].label).toBe('Read [arquivo secreto]');
  });

  it('answers by run id, by job id (latest invocation only) and for the runs no job asked for', () => {
    const log = createActivityLog();
    log.startCall('j', 'old');
    const a = log.begin('deep', { jobId: 'j', callId: 'old' });
    a.tool('Read old');
    log.startCall('j', 'new');
    const b = log.begin('deep', { jobId: 'j', callId: 'new' });
    const c = log.begin('deep', { jobId: 'j', callId: 'new' });
    b.tool('Read b');
    c.tool('Read c');
    const free = log.begin('turn');
    free.tool('Read free');
    expect(log.get('j').map((e) => e.label)).toEqual(['Read b', 'Read c']);
    expect(log.get(a.id).map((e) => e.label)).toEqual(['Read old']);
    expect(log.get(null).map((e) => e.label)).toEqual(['Read free']);
    expect(log.get('')).toEqual(log.get(null));
  });
});

describe('the nodes of a tree', () => {
  const sub = (label = 'explore: map the tests') => ({ type: 'sub' as const, label });

  it('hangs a node under a run: same job and call, a ring of its own, and the parent and the words on every line', () => {
    const log = createActivityLog();
    const root = log.begin('dev', { jobId: 'run:r1', callId: 'c1' });
    root.status('started');
    const child = root.child(sub(), 'dev:explore');
    child.status('started');
    child.tool('Read a.ts');
    child.status('finished');
    const lines = log.get(child.id);
    expect(lines.length).toBe(3);
    expect(lines.every((e) => e.parent === root.id && e.node?.type === 'sub' && e.node.label === 'explore: map the tests' && e.jobId === 'run:r1' && e.role === 'dev:explore')).toBe(true);
    // the root's lines carry none of the optional fields, and a child of the root's run is one of its job's
    expect(Object.keys(log.get(root.id).find((e) => e.runId === root.id) as ActivityEntry).sort()).toEqual(['at', 'jobId', 'kind', 'label', 'role', 'runId', 'seq', 'state']);
    log.startCall('run:r1', 'c1');
    expect(new Set(log.get('run:r1').map((e) => e.runId))).toEqual(new Set([root.id, child.id]));
  });

  it('takes the job and call of its parent even when the caller says otherwise, and keeps no call of its own', () => {
    const log = createActivityLog();
    const root = log.begin('dev', { jobId: 'run:r1', callId: 'c1', call: { agent: 'dev', thread: 'run-1', message: 2 } });
    const child = log.begin('qa', { jobId: 'other', callId: 'c9', parent: root.id, node: { type: 'call', label: 'check' } });
    child.status('started');
    root.status('started');
    expect(log.get(child.id)[0]).toMatchObject({ jobId: 'run:r1', parent: root.id });
    expect(log.get(child.id)[0].call).toBeUndefined();
    expect(log.get(root.id).find((e) => e.runId === root.id)?.call).toBeDefined();
  });

  it('masks and cuts the words that head a node', () => {
    const log = createActivityLog();
    const root = log.begin('dev');
    const child = root.child({ type: 'call', label: `read ${'word '.repeat(60)} ghp_0123456789abcdefghij` });
    child.status('started');
    const label = log.get(child.id)[0].node?.label as string;
    expect(label.length).toBeLessThanOrEqual(ACTIVITY_NODE_MAX);
    expect(label.endsWith('…')).toBe(true);
    const short = root.child({ type: 'sub', label: 'use ghp_0123456789abcdefghij' });
    short.status('started');
    expect(log.get(short.id)[0].node?.label).toBe('use [key]');
  });

  it('answers a run with the nodes under it, and a child that floods never pushes its parent out', () => {
    const log = createActivityLog({ ring: 5 });
    const root = log.begin('dev', { jobId: 'run:r1', callId: 'c1' });
    log.startCall('run:r1', 'c1');
    root.status('started');
    root.tool('Read root-1');
    root.tool('Read root-2');
    const child = root.child(sub());
    child.status('started');
    for (let i = 0; i < 40; i++) child.tool(`Read child-${i}`);
    root.tool('Read root-3');
    const own = (id: string) => log.get(id).filter((e) => e.runId === id).map((e) => e.label);
    expect(own(root.id).slice(1)).toEqual(['Read root-1', 'Read root-2', 'Read root-3']);
    expect(own(root.id)).toHaveLength(4);
    // the child keeps its newest lines (and the status line that says it started, which is older than all of them)
    expect(own(child.id).slice(-5)).toEqual(['Read child-35', 'Read child-36', 'Read child-37', 'Read child-38', 'Read child-39']);
    // a run id answers that node and what is under it; the job answers every node, with no cut over all of them
    expect(log.get(root.id).map((e) => e.runId)).toContain(child.id);
    expect(log.get(child.id).every((e) => e.runId === child.id)).toBe(true);
    const job = log.get('run:r1');
    expect(job.length).toBe(own(root.id).length + own(child.id).length);
    expect(job.map((e) => e.seq)).toEqual([...job.map((e) => e.seq)].sort((a, b) => a - b));
  });

  it('keeps the newest status line of a node whose ring turned over, so it does not read as finished by accident', () => {
    const log = createActivityLog({ ring: 4 });
    const run = log.begin('dev');
    run.status('started');
    for (let i = 0; i < 20; i++) run.tool(`Read f${i}`);
    const lines = log.get(run.id);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toMatchObject({ kind: 'status', state: 'started' });
    expect(lines.slice(1).map((e) => e.label)).toEqual(['Read f16', 'Read f17', 'Read f18', 'Read f19']);
    expect(runActive(lines, run.id)).toBe(true);
    // a newer status replaces the old one, and a refusal is not the status
    run.blocked('Read /repo/.env');
    run.status('finished');
    for (let i = 0; i < 6; i++) run.tool(`Read g${i}`);
    const after = log.get(run.id);
    expect(after.filter((e) => e.kind === 'status').map((e) => e.state)).toEqual(['finished']);
    expect(runActive(after, run.id)).toBe(false);
  });

  describe('eviction counts trees', () => {
    const tree = (log: ReturnType<typeof createActivityLog>, end: 'finished' | 'live' = 'finished') => {
      const root = log.begin('dev');
      root.status('started');
      const child = root.child(sub());
      child.status('started');
      child.status('finished');
      if (end === 'finished') root.status('finished');
      return { root, child };
    };

    it('drops the oldest finished tree whole, past the cap of trees', () => {
      const log = createActivityLog({ maxRuns: 2 });
      const first = tree(log);
      const second = tree(log);
      const third = tree(log);
      expect(log.get(first.root.id)).toEqual([]);
      expect(log.get(first.child.id)).toEqual([]);
      expect(log.get(second.root.id).length).toBeGreaterThan(0);
      expect(log.get(second.child.id).length).toBeGreaterThan(0);
      expect(log.get(third.root.id).length).toBeGreaterThan(0);
    });

    it('never drops a finished child of a tree that still works, nor a finished root with a callee still working', () => {
      const log = createActivityLog({ maxRuns: 2 });
      const live = tree(log, 'live');
      // a finished root whose called agent is still working
      const done = log.begin('dev');
      done.status('started');
      const callee = done.child({ type: 'call', label: 'help' });
      callee.status('started');
      done.status('finished');
      tree(log);
      tree(log);
      tree(log);
      expect(log.get(live.child.id).length).toBeGreaterThan(0);
      expect(log.get(live.root.id).length).toBeGreaterThan(0);
      expect(log.get(done.id).length).toBeGreaterThan(0);
      expect(log.get(callee.id).length).toBeGreaterThan(0);
    });

    it('bounds the nodes in all by dropping finished trees, and never a live one', () => {
      const log = createActivityLog({ maxRuns: 50, maxNodes: 6 });
      const first = tree(log);
      const live = tree(log, 'live');
      const third = tree(log);
      tree(log);
      expect(log.get(first.root.id)).toEqual([]);
      expect(log.get(third.root.id).length).toBeGreaterThan(0);
      expect(log.get(live.root.id).length).toBeGreaterThan(0);
      // all live: nothing may be dropped for the node cap
      const busy = createActivityLog({ maxRuns: 50, maxNodes: 2 });
      const roots = [0, 1, 2].map(() => tree(busy, 'live'));
      expect(roots.every((r) => busy.get(r.root.id).length > 0 && busy.get(r.child.id).length > 0)).toBe(true);
    });

    it('keeps a live tree under the old allowance: it goes only far past the cap', () => {
      const log = createActivityLog({ maxRuns: 2 });
      const live = tree(log, 'live');
      for (let i = 0; i < 3; i++) tree(log, 'live');
      expect(log.get(live.root.id).length).toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) tree(log, 'live');
      expect(log.get(live.root.id)).toEqual([]);
    });
  });
});

describe('the thought and the answer of a node', () => {
  it('makes one masked line, cut at its cap with an ellipsis, and the sink receives what get returns', () => {
    const log = createActivityLog({ thoughts: () => true });
    const pushed: ActivityEntry[] = [];
    log.setSink((e) => pushed.push(e));
    const run = log.begin('dev', { isSecretPath: (p) => p.endsWith('.env') });
    run.thought('I should read /srv/app/.env with token ghp_0123456789abcdefghij\nthen decide');
    const [line] = log.get(run.id);
    expect(line.kind).toBe('thought');
    expect(line.label).not.toContain('ghp_0123456789');
    expect(line.label).not.toContain('/srv/app/.env');
    expect(line.label).not.toMatch(/\n/);
    expect(pushed).toEqual([line]);
    run.thought(`${'reason '.repeat(700)}`);
    const long = log.get(run.id)[1];
    expect(long.label.length).toBeLessThanOrEqual(ACTIVITY_THOUGHT_MAX);
    expect(long.label.endsWith('…')).toBe(true);
    expect(long.label.startsWith('reason reason')).toBe(true);
  });

  it('masks before it cuts, and bounds what it scans: a credential at the cut is never half shown, a huge text still keeps its masked start', () => {
    const log = createActivityLog({ thoughts: () => true });
    const run = log.begin('dev');
    const secret = 'ghp_0123456789abcdefghij';
    run.thought(`${'x'.repeat(ACTIVITY_THOUGHT_MAX - 10)} ${secret} tail`);
    const cut = log.get(run.id)[0].label;
    expect(cut).not.toContain('ghp_');
    expect(cut).not.toContain('0123456789abcdefghij');
    run.thought(`start ${secret} ${'word '.repeat(40_000)}`);
    const huge = log.get(run.id)[1].label;
    expect(huge.startsWith('start [key] word')).toBe(true);
    expect(huge.length).toBeLessThanOrEqual(ACTIVITY_THOUGHT_MAX);
  });

  it('makes nothing for an empty reasoning, and nothing while the switch is off; what is made earlier stays, and the next one shows when it is on again', () => {
    let on = true;
    const log = createActivityLog({ thoughts: () => on });
    const pushed: ActivityEntry[] = [];
    log.setSink((e) => pushed.push(e));
    const run = log.begin('dev');
    run.thought('   ');
    run.thought('first');
    on = false;
    run.thought('hidden');
    expect(log.get(run.id).map((e) => e.label)).toEqual(['first']);
    expect(pushed.map((e) => e.label)).toEqual(['first']);
    on = true;
    run.thought('third');
    expect(log.get(run.id).map((e) => e.label)).toEqual(['first', 'third']);
    // the switch of the process log is the same gate, set after creation
    const other = createActivityLog();
    other.setThoughtsGate(() => false);
    const quiet = other.begin('dev');
    quiet.thought('nothing');
    expect(other.get(quiet.id)).toEqual([]);
    other.setThoughtsGate(() => true);
    quiet.thought('now');
    expect(other.get(quiet.id)).toHaveLength(1);
  });

  it('makes no thought while no switch was ever given, even with a sink, and closes again when the switch is taken away', () => {
    const log = createActivityLog();
    const pushed: ActivityEntry[] = [];
    log.setSink((e) => pushed.push(e));
    const run = log.begin('dev');
    run.thought('reasoning that must not show');
    run.tool('Read routes.ts');
    expect(log.get(run.id).map((e) => e.kind)).toEqual(['tool']);
    expect(pushed.map((e) => e.kind)).toEqual(['tool']);
    log.setThoughtsGate(() => true);
    run.thought('now it shows');
    log.setThoughtsGate(null);
    run.thought('closed again');
    expect(log.get(run.id).filter((e) => e.kind === 'thought').map((e) => e.label)).toEqual(['now it shows']);
  });

  it('does not let the answer be switched off, caps it, and keeps both out of the narration rule', () => {
    const log = createActivityLog({ thoughts: () => false });
    const run = log.begin('dev');
    run.text('I will read the file.');
    run.thought('reasoning');
    run.answer(`${'The answer is long. '.repeat(60)} key=abcdef0123456789abcdef0123456789`);
    run.status('finished');
    const lines = log.get(run.id);
    expect(lines.map((e) => e.kind)).toEqual(['answer', 'status']);
    expect(lines[0].label.length).toBeLessThanOrEqual(ACTIVITY_ANSWER_MAX);
    expect(lines[0].label.endsWith('…')).toBe(true);
    // neither kind changes whether a node works
    expect(runActive([{ ...lines[0], runId: run.id }], run.id)).toBe(false);
    const working = log.begin('dev');
    working.status('started');
    working.answer('done');
    expect(runActive(log.get(working.id), working.id)).toBe(true);
  });

  it('comes before the narration and the tools of its turn, and leaves the narration rule as it is', () => {
    const log = createActivityLog({ thoughts: () => true });
    const run = log.begin('dev');
    run.text('Reading the routes.');
    run.thought('plan');
    run.tool('Read routes.ts');
    expect(log.get(run.id).map((e) => [e.kind, e.label])).toEqual([['thought', 'plan'], ['text', 'Reading the routes.'], ['tool', 'Read routes.ts']]);
  });
});

describe('lending a node to a longer exchange', () => {
  it('ignores a finish or a failure of the lent view, and passes everything else through', () => {
    const log = createActivityLog();
    const run = log.begin('dev');
    const lent = run.lend();
    expect(lent.id).toBe(run.id);
    expect(lent.lend()).toBe(lent);
    lent.status('started');
    lent.tool('Read a');
    lent.status('finished');
    lent.status('failed', 'boom');
    expect(runActive(log.get(run.id), run.id)).toBe(true);
    run.status('failed', 'boom');
    expect(runActive(log.get(run.id), run.id)).toBe(false);
    expect(log.get(run.id).map((e) => e.kind)).toEqual(['status', 'tool', 'status']);
  });
});

describe('what a nested context knows', () => {
  it('lets a context of the same job join the outer call, and a different job start its own', async () => {
    const log = activityLog;
    await withActivityContext('join:#1', async () => {
      const outer = beginActivity('dev');
      outer.status('started');
      const inner = await withActivityContext('join:#1', async () => beginActivity('qa'));
      inner.status('started');
      const own = await withActivityContext('join:#2', async () => beginActivity('qa'));
      own.status('started');
      const callOf = (id: string) => log.get(id).find((e) => e.runId === id);
      expect(callOf(inner.id)?.jobId).toBe('join:#1');
      // the job's latest call is still the outer one: the inner run is in the answer, and so is the outer
      expect(new Set(log.get('join:#1').map((e) => e.runId))).toEqual(new Set([outer.id, inner.id]));
      expect(log.get('join:#2').map((e) => e.runId)).toEqual([own.id]);
    });
  });

  it('carries the node whose work is current across awaits and parallel work, and a run started there hangs under it', async () => {
    expect(currentActivity()).toBeNull();
    const root = beginActivity('dev');
    root.status('started');
    const seen = await withActivityParent(root.id, async () => {
      expect(currentActivity()?.id).toBe(root.id);
      await new Promise((r) => setTimeout(r, 1));
      return Promise.all([1, 2].map(async () => {
        await Promise.resolve();
        const run = beginActivity('qa', undefined, { node: { type: 'call', label: 'help' } });
        run.status('started');
        return run.id;
      }));
    });
    expect(currentActivity()).toBeNull();
    for (const id of seen) expect(activityLog.get(id)[0]).toMatchObject({ parent: root.id, node: { type: 'call', label: 'help' } });
    // outside the parent a run is a root again
    const free = beginActivity('qa');
    free.status('started');
    expect(activityLog.get(free.id)[0].parent).toBeUndefined();
  });

  it('keeps the job of the context around a parent, and answers no node the log no longer holds', () => {
    const run = withActivityContext('keep:#1', () => {
      const root = beginActivity('dev');
      root.status('started');
      return withActivityParent(root.id, () => ({ root, child: beginActivity('qa') }));
    });
    run.child.status('started');
    expect(activityLog.get(run.child.id)[0]).toMatchObject({ jobId: 'keep:#1', parent: run.root.id });
    activityLog.clear();
    expect(withActivityParent(run.root.id, () => currentActivity())).toBeNull();
  });
});

describe('what a label may carry', () => {
  it('replaces token-like strings and keys', () => {
    const out = safeText('Bash glab api -H "PRIVATE-TOKEN: glpat-abcdefghij1234567890" https://x.test/a?private_token=abc123def', 240);
    expect(out).not.toContain('glpat-abcdefghij');
    expect(out).not.toContain('abc123def');
    expect(safeText('Bash curl -H "Authorization: Bearer sk-or-v1-0123456789abcdef"', 240)).not.toContain('0123456789abcdef');
    expect(safeText('Bash echo ghp_0123456789abcdefghij', 240)).toBe('Bash echo [key]');
    expect(safeText(`Bash echo ${'a1'.repeat(24)}`, 240)).toBe('Bash echo [redacted]');
  });

  it('hides the path of a secret file and shortens the home folder', () => {
    const isSecret = (p: string) => p.endsWith('.env');
    expect(safeText('Read /srv/app/.env', 240, isSecret)).toBe('Read [arquivo secreto]');
    expect(safeText('Read "/srv/app/src/a.ts"', 240, isSecret)).toBe('Read "/srv/app/src/a.ts"');
  });

  it('keeps a plain label as it is', () => {
    expect(safeText('Grep needle', 240)).toBe('Grep needle');
  });
});

describe('a tree started by an `@` call', () => {
  it('keeps the whole tree in the backfill of its job while any node of it works, whatever call each was made in, and lets it go when all ended', () => {
    const log = createActivityLog();
    // The `@` call's line has no call id of its own; the agents it calls copy it.
    const line = log.begin('dev', { jobId: 'mention:t1', call: { agent: 'dev', thread: 't1', message: 1 } });
    line.status('started');
    log.startCall('mention:t1', 'later-call');
    const callee = line.child({ type: 'call', label: 'help' }, 'qa');
    callee.status('started');
    callee.status('finished');
    // the callee ended and the caller still works: both stay
    expect(new Set(log.get('mention:t1').map((e) => e.runId))).toEqual(new Set([line.id, callee.id]));
    line.status('finished');
    expect(log.get('mention:t1')).toEqual([]);
  });
});

describe('a parent bound where the job is known', () => {
  it('runs work under a node of the same job even from a chain that lost the async context', async () => {
    const log = activityLog;
    const bound = await withActivityContext('bind:#1', async () => {
      const root = beginActivity('dev');
      root.status('started');
      return { root, under: bindActivityParent() };
    });
    // outside the context, as an in-process tool server answering from the engine's own callbacks is
    expect(currentJobId()).toBeNull();
    const child = bound.under(bound.root.id, () => {
      expect(currentJobId()).toBe('bind:#1');
      expect(currentActivity()?.id).toBe(bound.root.id);
      // a context of the same job joins instead of starting the call over
      return withActivityContext('bind:#1', () => beginActivity('qa'));
    });
    child.status('started');
    expect(log.get(child.id)[0]).toMatchObject({ jobId: 'bind:#1', parent: bound.root.id });
    expect(currentJobId()).toBeNull();
  });
});

describe('the job of a call', () => {
  it('tags the arguments and takes the marker off again', () => {
    const tagged = tagArgs([{ ref: '#1' }, 'x'], 'deep:#1:ask');
    expect(tagged).toHaveLength(3);
    expect(takeContext(tagged)).toEqual({ args: [{ ref: '#1' }, 'x'], jobId: 'deep:#1:ask' });
    expect(tagArgs(['a'], null)).toEqual(['a']);
  });

  it('leaves alike-looking arguments alone and refuses odd ids', () => {
    expect(takeContext([{ $ctx: { job: 'a' }, other: 1 }]).args).toHaveLength(1);
    expect(takeContext(['a', { x: 1 }]).jobId).toBeNull();
    expect(takeContext([{ $ctx: { job: 'x'.repeat(500) } }])).toEqual({ args: [], jobId: null });
    expect(takeContext([{ $ctx: { job: '<script>' } }]).jobId).toBeNull();
    expect(takeContext([]).jobId).toBeNull();
  });

  it('attributes runs started inside the context, across awaits and parallel work', async () => {
    const seen = await withActivityContext('gate:#9:start', async () => {
      await new Promise((r) => setTimeout(r, 1));
      const runs = await Promise.all([1, 2].map(async () => {
        await Promise.resolve();
        return beginActivity('deep');
      }));
      return runs.map((r) => activityLog.get(r.id).length && r.id);
    });
    expect(seen).toHaveLength(2);
    expect(currentJobId()).toBeNull();
    const outside = beginActivity('deep');
    outside.status('started');
    expect(activityLog.get(outside.id)[0].jobId).toBeNull();
    const inside = withActivityContext('qa:#2:prepare', () => beginActivity('deep'));
    inside.status('started');
    expect(activityLog.get(inside.id)[0].jobId).toBe('qa:#2:prepare');
    expect(activityLog.get('qa:#2:prepare').map((e) => e.runId)).toEqual([inside.id]);
  });

  it('keeps a call that still waits its turn when a later invocation of the job is read back', () => {
    const log = createActivityLog();
    // A call accepted while another of the run still goes: it is alive and it is not the job's latest invocation.
    const queued = log.begin('dev', { jobId: 'run:r1', callId: 'call-1' });
    log.startCall('run:r1', 'call-1');
    queued.status('queued');
    // A later invocation of the same job that already finished: the recovery read must still bring the waiting call.
    const later = log.begin('qa', { jobId: 'run:r1', callId: 'call-2' });
    log.startCall('run:r1', 'call-2');
    later.status('started');
    later.status('finished');
    // The reading of the context brings both: the call still waiting and the later one that already ended.
    expect(new Set(log.get('run:r1').map((e) => e.runId))).toEqual(new Set([queued.id, later.id]));
    expect(log.get('run:r1').filter((e) => e.runId === queued.id).every((e) => e.state === 'queued')).toBe(true);
  });

  it('reaches the handler through the rpc layer without changing its arguments', async () => {
    const calls: { args: unknown[]; job: string | null }[] = [];
    handle('test:activity-job', ((...args: unknown[]) => {
      calls.push({ args, job: currentJobId() });
      return 'ok';
    }) as never);
    await invoke('test:activity-job', [{ ref: '#5' }, 'q', { $ctx: { job: 'deep:#5:ask' } }]);
    await invoke('test:activity-job', [{ ref: '#5' }, 'q']);
    expect(calls).toEqual([
      { args: [{ ref: '#5' }, 'q'], job: 'deep:#5:ask' },
      { args: [{ ref: '#5' }, 'q'], job: null },
    ]);
  });
});

describe('runActive', () => {
  it('is true from started until finished or failed', () => {
    const log = createActivityLog();
    const run = log.begin('deep');
    expect(runActive(log.get(run.id), run.id)).toBe(false);
    run.status('started');
    run.blocked('Read .env');
    expect(runActive(log.get(run.id), run.id)).toBe(true);
    run.status('resumed');
    expect(runActive(log.get(run.id), run.id)).toBe(true);
    run.status('failed', 'boom');
    expect(runActive(log.get(run.id), run.id)).toBe(false);
  });
});
