// Squads in the runner: an issue is routed to its squad by the scope (the repository, then the labels, then the folders it mentions) and the run goes on with
// that squad's flow and agents; an issue two squads claim stops at the front door, whose agent proposes a squad and, when it does not run by itself, leaves the
// choice to the person; a workspace with no squads is exactly one team.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newSquad } from '../src/shared/config/squads';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, issue, makeRepo, work } from './helpers/runner';
import { squadStages, withSquads } from './helpers/squads';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

/** The lean flow of the squad tests is scripted: the front door triages, each squad's developer implements, B's security stage reviews. */
function script(b: Boot, over: { support?: Parameters<Boot['engine']['script']>[1] } = {}): void {
  b.engine.script('support', over.support ?? (() => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] })));
  for (const dev of ['dev-a', 'dev-b']) b.engine.script(dev, () => work(`Built by ${dev}.`, { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('sec-b', () => work('Safe.', { artifacts: [doc('4_SECURITY.md')], verdict: 'approved', findings: [] }));
}

/** A workspace with the two squads scoped by repository (`app` is A's, `web` is B's), each repository a clone of its own. */
async function build(edit: (c: WorkspaceConfig) => void = () => undefined): Promise<{ b: Boot; web: ReturnType<typeof makeRepo> }> {
  const app = makeRepo();
  const web = makeRepo();
  const b = await boot({
    repo: app,
    configure: (c) => {
      c.language = 'en';
      withSquads(c);
      c.projects.repos = [
        { id: 'app', path: app.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' },
        { id: 'web', path: web.clone, remoteUrl: null, vcsId: null, projectPath: 'group/project' },
      ];
      edit(c);
    },
  });
  for (const iid of [102, 103]) b.issues.add(issue(iid));
  script(b);
  return { b, web };
}

const stagesOf = (run: Run): string[] => run.stages.map((s) => s.stage);
const agentsOf = (b: Boot): string[] => b.engine.calls.map((c) => c.agent.id);

describe('an issue whose repository is one squad\'s', () => {
  it('starts its run in that squad, with the squad\'s flow and its agents', async () => {
    const { b } = await build();
    const inA = await b.runner.start('app#101', 'app');
    await b.settle();
    const inB = await b.runner.start('app#102', 'web');
    await b.settle();

    const a = b.runner.get(inA.id) as Run;
    const bb = b.runner.get(inB.id) as Run;
    expect([a.squad, a.routedBy, a.routing ?? null]).toEqual(['a', 'repo', null]);
    expect([bb.squad, bb.routedBy, bb.routing ?? null]).toEqual(['b', 'repo', null]);
    // A follows the workspace's flow; B its own, with the security stage; each run keeps the copy of the flow it started with
    expect(a.flow?.stages.map((s) => s.id)).toEqual(['triage', 'implement', 'ready']);
    expect(bb.flow?.stages.map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(stagesOf(a)).toEqual(['triage', 'implement', 'ready']);
    expect(stagesOf(bb)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect([a.status, bb.status]).toEqual(['done', 'done']);
    // the shared front door triaged both; the developer of each squad did its own implement and nobody else's
    expect(agentsOf(b)).toEqual(['support', 'dev-a', 'support', 'dev-b', 'sec-b']);
    expect(a.stages.find((s) => s.stage === 'implement')?.agent).toBe('dev-a');
    expect(bb.stages.find((s) => s.stage === 'implement')?.agent).toBe('dev-b');
    // the thread says why the run is in the squad
    expect(b.thread(a).find((m) => m.code === 'run.squad.routed.repo')).toMatchObject({ kind: 'system', params: { squad: 'Squad A' } });
    // the squad is told to the agents that work for it
    expect(b.engine.calls[1].system).toContain('Squad A');
    expect(b.engine.calls[1].system).toContain('The app.');
  });

  it('an issue with a label and no repository claim goes by the label, and a repository the scheduler did not choose goes with the squad that owns one of them', async () => {
    const { b } = await build((c) => {
      c.squads = (c.squads ?? []).map((s) => ({ ...s, scope: { ...s.scope, repos: s.id === 'a' ? ['app'] : ['web'], labels: s.id === 'b' ? ['mobile'] : [] } }));
    });
    // no repository is named (what the scheduler does): the label names the squad, and the squad owns exactly one repository of the project
    b.issues.add(issue(104, { labels: ['mobile'] }));
    const run = await b.runner.start('app#104');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ squad: 'b', routedBy: 'repo', repo: 'web' });
  });
});

describe('an issue two squads claim', () => {
  const both = (c: WorkspaceConfig): void => {
    for (const s of c.squads ?? []) s.scope.repos = ['app'];
  };
  const proposing = (squad: string | null, reason = 'It is about the web.') => () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')], squad, squadReason: reason });

  it('stops at triage: the front door proposes a squad and, when it does not run by itself, the person\'s choice starts the run there', async () => {
    const { b } = await build((c) => {
      both(c);
      (c.agents.team.find((a) => a.id === 'support') as { autonomous: boolean }).autonomous = false;
    });
    script(b, { support: proposing('b') });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();

    const waiting = b.runner.get(started.id) as Run;
    expect(waiting).toMatchObject({ status: 'question', stage: 'triage', question: { kind: 'squad', by: 'support' } });
    expect(waiting.squad ?? null).toBeNull();
    expect(waiting.routing).toMatchObject({ candidates: ['a', 'b'], why: 'several', proposal: { squad: 'b', by: 'support', reason: 'It is about the web.' }, result: { summary: 'Triaged.', artifacts: ['0_TRIAGE.md'] } });
    expect(agentsOf(b)).toEqual(['support']);
    // the agent was told which squads it may name, and its schema offers exactly those
    const call = b.engine.calls[0];
    expect(call.prompt).toContain('- a (Squad A): The app.');
    expect(call.prompt).toContain('- b (Squad B): The web.');
    expect(JSON.stringify(call.schema)).toContain('"enum":["a","b",null]');
    // the proposal is in the thread, in the person's way
    const ask = b.thread(waiting).find((m) => m.code === 'run.squad.ask.proposal');
    expect(ask).toMatchObject({ kind: 'question', to: 'person', public: true, params: { proposal: 'b', squads: 'a, b' } });
    // a person's words are not the answer to this question, and the run did not move
    await expect(Promise.resolve().then(() => b.runner.answer(started.id, 'b'))).rejects.toThrow();
    expect(b.runner.answerPost(`run-${started.id}`, 'b')).toBeNull();
    expect(b.notices.some((n) => /question/i.test(n.title))).toBe(true);

    b.runner.setSquad(started.id, 'b');
    await b.settle();
    const end = b.runner.get(started.id) as Run;
    expect([end.squad, end.routedBy, end.routing ?? null, end.status]).toEqual(['b', 'person', null, 'done']);
    // it goes on from the stage after the front door, in B's flow, with B's agents; the front door is not run again
    expect(stagesOf(end)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(agentsOf(b)).toEqual(['support', 'dev-b', 'sec-b']);
    expect(end.flow?.stages.map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    const thread = b.thread(end);
    expect(thread.find((m) => m.code === 'run.squad.chosen')).toMatchObject({ kind: 'answer', author: { type: 'person' }, params: { squad: 'Squad B' }, replyTo: ask?.seq });
    // what the front door produced and said travelled on with the run
    expect(end.stages.find((s) => s.stage === 'triage')).toMatchObject({ status: 'done', artifacts: ['0_TRIAGE.md'] });
    expect(thread.some((m) => m.kind === 'post' && m.author.type === 'agent' && m.author.id === 'support' && m.text === 'Triaged.')).toBe(true);
    expect(thread.filter((m) => m.kind === 'post' && m.text === 'Triaged.')).toHaveLength(1);
  });

  it('the person may pick another squad than the proposed one, or none', async () => {
    const { b } = await build(both);
    script(b, { support: proposing('b') });
    const first = await b.runner.start('app#101', 'app');
    const second = await b.runner.start('app#102', 'app');
    await b.settle();
    // the front door runs by itself here, so its proposal decided: B for the first; the second has nobody proposing
    expect(b.runner.get(first.id)).toMatchObject({ squad: 'b', routedBy: 'agent' });
    b.engine.script('support', proposing(null));
    const third = await b.runner.start('app#103', 'app');
    await b.settle();
    expect(b.runner.get(third.id)).toMatchObject({ status: 'question', question: { kind: 'squad' } });
    expect(b.runner.setSquad(third.id, 'a')).toMatchObject({ squad: 'a', routedBy: 'person' });
    await b.settle();
    expect(b.runner.get(third.id)).toMatchObject({ status: 'done', squad: 'a' });
    expect(second.id).not.toBe(first.id);
  });

  it('a front door that runs by itself and proposes a squad decides it: the run goes on in that squad and the thread says who chose', async () => {
    const { b } = await build(both);
    script(b, { support: proposing('a', 'Only the app is touched.') });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    const end = b.runner.get(started.id) as Run;
    expect([end.squad, end.routedBy, end.routing ?? null, end.status]).toEqual(['a', 'agent', null, 'done']);
    expect(agentsOf(b)).toEqual(['support', 'dev-a']);
    expect(b.thread(end).find((m) => m.code === 'run.squad.proposed')).toMatchObject({ params: { squad: 'Squad A', agent: 'support', reason: 'Only the app is touched.' } });
    expect(end.history.find((h) => h.type === 'squad-routed')).toMatchObject({ by: 'support', detail: 'agent:a' });
    // nobody asked the person
    expect(b.thread(end).some((m) => m.code?.startsWith('run.squad.ask'))).toBe(false);
  });

  it('a proposal that names a squad the scope did not leave is not a decision: it is not offered, not taken, and the person chooses', async () => {
    const { b } = await build((c) => {
      both(c);
      c.agents.team.push({ ...(c.agents.team.find((a) => a.id === 'dev-a') as AgentDef), id: 'dev-c', squad: 'c' });
      c.squads = [...(c.squads ?? []), newSquad({ id: 'c', name: 'Squad C', scope: { repos: ['web'] }, liaison: 'dev-c' })];
    });
    script(b, { support: proposing('c') });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(JSON.stringify(b.engine.calls[0].schema)).toContain('"enum":["a","b",null]');
    expect(b.runner.get(started.id)).toMatchObject({ status: 'question', routing: { candidates: ['a', 'b'], proposal: null } });
  });

  it('with no agent at the front door the person chooses before anything runs, and the front door\'s stage is not run at all', async () => {
    const { b } = await build((c) => {
      both(c);
      // the first stage has no agent: a wait for a label; squad A has a flow of its own, which does not have it
      c.devCycle.flows = { ...c.devCycle.flows, a: squadStages() };
      c.devCycle.stages = [{ id: 'intake', label: 'Intake', match: [], kind: 'backlog', rank: 0, type: 'wait', waitsFor: { kind: 'label', label: 'ready' } }, ...c.devCycle.stages];
    });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(agentsOf(b)).toEqual([]);
    expect(b.runner.get(started.id)).toMatchObject({ status: 'question', stage: 'intake', question: { kind: 'squad', by: 'app' }, routing: { why: 'several', result: null } });
    b.runner.setSquad(started.id, 'a');
    await b.settle();
    // A's flow has no intake stage: the run starts at A's first stage
    const end = b.runner.get(started.id) as Run;
    expect(end.stages.map((s) => [s.stage, s.status])).toEqual([['intake', 'skipped'], ['triage', 'done'], ['implement', 'done'], ['ready', 'done']]);
    expect(agentsOf(b)).toEqual(['support', 'dev-a']);
  });

  it('refuses a choice when nothing waits for one, and a squad that is not there', async () => {
    const { b } = await build(both);
    script(b, { support: proposing(null) });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(() => b.runner.setSquad(started.id, 'ghost')).toThrow(/ghost/);
    b.runner.setSquad(started.id, null);
    await b.settle();
    // without a squad the run goes on in the workspace's flow with the whole team
    const end = b.runner.get(started.id) as Run;
    expect([end.squad ?? null, end.routedBy ?? null, end.status]).toEqual([null, null, 'done']);
    expect(() => b.runner.setSquad(started.id, 'a')).toThrow(/not waiting for a squad/);
  });
});

describe('a workspace with no squads', () => {
  it('runs exactly as a single team: no squad, no routing, no choice, and the same agents in the same order', async () => {
    const { b } = await build((c) => {
      c.squads = [];
      c.agents.team = c.agents.team.filter((a) => a.id !== 'sec-b');
      for (const a of c.agents.team) delete a.squad;
      c.devCycle.flows = {};
    });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    const end = b.runner.get(started.id) as Run;
    expect(end.squad).toBeUndefined();
    expect(end.routing).toBeUndefined();
    expect(end.routedBy).toBeUndefined();
    expect(end.status).toBe('done');
    expect(agentsOf(b)).toEqual(['support', 'dev-a']);
    expect(b.thread(end).some((m) => m.code?.startsWith('run.squad'))).toBe(false);
  });

  it('squads with no members take no work: the run is as if there were none', async () => {
    const { b } = await build((c) => {
      c.agents.team = c.agents.team.filter((a) => a.id !== 'sec-b');
      for (const a of c.agents.team) delete a.squad;
      for (const s of c.squads ?? []) s.liaison = null;
      c.devCycle.flows = {};
    });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(b.runner.get(started.id)?.squad).toBeUndefined();
  });
});

describe('squads that are wrong', () => {
  it('a run does not start in a workspace whose squads have an error, and says which', async () => {
    const { b } = await build();
    // a file edited by hand: the app opens it as it is, and the runner will not start on it
    const broken = structuredClone(b.deps.config());
    (broken.squads ?? [])[0].liaison = null;
    const { writeConfigFile } = await import('../src/main/config-bootstrap');
    const { reloadConfig } = await import('../src/main/workspaceConfig');
    const { ATAS } = await import('../src/main/env');
    writeConfigFile(ATAS, broken);
    reloadConfig();
    expect(b.deps.config().squads?.[0].liaison).toBeNull();
    await expect(b.runner.start('app#101', 'app')).rejects.toThrow(/no liaison/);
    expect(b.runner.list()).toEqual([]);
  });
});

describe('removing a squad', () => {
  it('moves its runs to no squad only after the person confirms', async () => {
    const { b } = await build((c) => {
      // a flow that waits: its runs stay active
      c.devCycle.stages = c.devCycle.stages.map((s) => {
        const { produces: _produces, ...rest } = s;
        return s.id === 'implement' ? { ...rest, type: 'gate' as const } : s;
      });
    });
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(b.runner.get(started.id)).toMatchObject({ squad: 'a', status: 'gate' });

    // without the confirmation nothing changes, and the runs are listed
    expect(b.runner.removeSquad('a', false)).toEqual({ removed: false, runs: [started.id] });
    expect(b.deps.config().squads?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(b.runner.get(started.id)?.squad).toBe('a');

    expect(b.runner.removeSquad('a', true)).toEqual({ removed: true, runs: [started.id] });
    const after = b.runner.get(started.id) as Run;
    expect(after.squad).toBeNull();
    expect(after.status).toBe('gate');
    expect(b.deps.config().squads?.map((s) => s.id)).toEqual(['b']);
    expect(b.deps.config().agents.team.find((x) => x.id === 'dev-a')?.squad).toBeUndefined();
    expect(b.thread(after).some((m) => m.code === 'run.squad.removed')).toBe(true);
    expect(() => b.runner.removeSquad('a', true)).toThrow(/a/);
  });
});
