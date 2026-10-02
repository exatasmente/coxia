import { describe, expect, it } from 'vitest';
import { ACTIVITY_RING, ACTIVITY_TEXT_MAX, runActive, takeContext, tagArgs } from '../src/shared/activity';
import { beginActivity, createActivityLog, currentJobId, safeText, withActivityContext, activityLog } from '../src/main/activity';
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
    expect(log.get(run.id)[0].label).toBe('Read [secret file]');
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
    expect(safeText('Read /srv/app/.env', 240, isSecret)).toBe('Read [secret file]');
    expect(safeText('Read "/srv/app/src/a.ts"', 240, isSecret)).toBe('Read "/srv/app/src/a.ts"');
  });

  it('keeps a plain label as it is', () => {
    expect(safeText('Grep needle', 240)).toBe('Grep needle');
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
