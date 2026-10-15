// A squad's labels start runs by themselves (`autoStart`): an open issue with one of them begins a run in that squad with no other label. `mine` takes the issues
// assigned to the person; `mine-and-unassigned` also the ones nobody is assigned to. A squad without it, or without members, starts nothing; the trigger label keeps
// working beside them.
import { describe, expect, it, vi } from 'vitest';
import type { SquadDef, WorkspaceConfig } from '../src/shared/config/types';
import { issue } from './helpers/runner';
import { bootSquads } from './helpers/squadRunner';

const never = (): Promise<never> => new Promise(() => undefined);
const on = (c: WorkspaceConfig): void => {
  c.runner = { ...c.runner, enabled: true, maxConcurrentRuns: 10, triggerLabel: 'coxia' };
};
const squad = (c: WorkspaceConfig, id: string): SquadDef => (c.squads ?? []).find((s) => s.id === id) as SquadDef;

describe('runs started by a squad label', () => {
  it('starts the issues assigned to the person that carry the label, in the squad of the label, and leaves the others alone', async () => {
    const { b } = await bootSquads((c) => {
      on(c);
      const sq = squad(c, 'b');
      sq.scope.labels = ['area:web'];
      sq.autoStart = 'mine';
    });
    b.engine.script('support', () => never());
    b.issues.add(issue(201, { labels: ['Area:Web'], assignees: ['ana'] }));
    b.issues.add(issue(202, { labels: ['area:web'], author: 'bob', assignees: [] }));
    b.issues.add(issue(203, { labels: ['area:web'], author: 'bob', assignees: ['carla'] }));
    b.issues.add(issue(204, { labels: ['area:other'], assignees: ['ana'] }));
    b.issues.add(issue(205, { labels: ['area:web'], assignees: ['ana'], state: 'closed' }));
    const started = await b.runner.scan();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#201']);
    expect(started[0]).toMatchObject({ squad: 'b', routedBy: 'label' });
  });

  it('with mine-and-unassigned also takes the issues nobody is assigned to, never one assigned to someone else', async () => {
    const { b } = await bootSquads((c) => {
      on(c);
      const sq = squad(c, 'b');
      sq.scope.labels = ['area:web'];
      sq.autoStart = 'mine-and-unassigned';
    });
    b.engine.script('support', () => never());
    b.issues.add(issue(202, { labels: ['area:web'], author: 'bob', assignees: [] }));
    b.issues.add(issue(203, { labels: ['area:web'], author: 'bob', assignees: ['carla'] }));
    const started = await b.runner.scan();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#202']);
    expect(started[0].squad).toBe('b');
    // an issue that had a run is not started again
    expect(await b.runner.scan()).toEqual([]);
  });

  it('starts nothing for a squad without autoStart, or with no members; the trigger label still starts its issues', async () => {
    const { b } = await bootSquads((c) => {
      on(c);
      squad(c, 'b').scope.labels = ['area:web'];
      const a = squad(c, 'a');
      a.scope.labels = ['area:app'];
      a.autoStart = 'mine';
      a.liaison = null;
      c.agents.team = c.agents.team.map((x) => (x.squad === 'a' ? { ...x, squad: null } : x));
    });
    b.engine.script('support', () => never());
    b.issues.add(issue(301, { labels: ['area:web'], assignees: ['ana'] }));
    b.issues.add(issue(302, { labels: ['area:app'], assignees: ['ana'] }));
    // the trigger label starts it, and the label of a squad with no autoStart still routes it there
    b.issues.add(issue(303, { labels: ['coxia', 'area:web'], assignees: ['ana'] }));
    const started = await b.runner.scan();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#303']);
    expect(started[0]).toMatchObject({ squad: 'b', routedBy: 'label' });
  });

  it('starts one run for an issue two lookups find; an issue with two squads\' labels and no repository to choose is refused once, as by hand', async () => {
    const { b } = await bootSquads((c) => {
      on(c);
      for (const [id, label] of [['a', 'area:app'], ['b', 'area:web']] as const) {
        const sq = squad(c, id);
        sq.scope.labels = [label];
        sq.autoStart = 'mine-and-unassigned';
      }
    });
    b.engine.script('support', () => never());
    b.issues.add(issue(401, { labels: ['coxia', 'area:web'], assignees: ['ana'] }));
    b.issues.add(issue(402, { labels: ['area:app', 'area:web'], author: 'bob' }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started = await b.runner.scan();
    expect(started.map((r) => r.issue.ref)).toEqual(['app#401']);
    expect(started[0].squad).toBe('b');
    expect(errors.mock.calls.some((c) => String(c[1]) === 'app#402')).toBe(true);
    expect(await b.runner.scan()).toEqual([]);
  });

  it('a lookup that fails leaves the others standing, and the scan still tells the failure', async () => {
    const { b } = await bootSquads((c) => {
      on(c);
      const sq = squad(c, 'b');
      sq.scope.labels = ['area:web'];
      sq.autoStart = 'mine';
    });
    b.engine.script('support', () => never());
    b.issues.add(issue(501, { labels: ['area:web'], assignees: ['ana'] }));
    const real = b.issues.triggered.bind(b.issues);
    b.issues.triggered = async (label: string) => (label === 'coxia' ? Promise.reject(new Error('host down')) : real(label));
    await expect(b.runner.scan()).rejects.toThrow('host down');
    expect(b.runs.list().map((r) => r.issue.ref)).toEqual(['app#501']);
  });
});
