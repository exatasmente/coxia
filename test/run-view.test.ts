import { describe, expect, it } from 'vitest';
import {
  ask,
  cancel,
  gateApprove,
  gateReject,
  passQuestion,
  recordCommentPublished,
  recordCommentProposal,
  recordReview,
  stageDone,
  stageFailed,
  startStage,
  type Finding,
  type Run,
} from '../src/shared/runs';
import { RUN_FILTERS, RUN_TONE, filterCounts, inFilter, listRuns, canUndoPost, commentKey, commentRows, currentAgent, followsOlderFlow, isRunBlocker, needsPerson, reposToChoose, reviewRounds, runActions, runOfCard, stageLabelOf, stageRows, usageParams } from '../src/shared/runs/view';
import { RUN_STATUSES } from '../src/shared/runs';
import { drive, flowWithAutonomy, at } from './helpers/runs';

const done = (name: string) => ({ summary: `${name} done`, handoff: '', artifacts: [`${name}.md`] });

/** A run of the agent cycle driven to `to`, with every agent autonomous unless `autonomy` says otherwise. */
function until(to: string, autonomy: Record<string, boolean> = {}) {
  const d = drive(flowWithAutonomy(autonomy));
  for (let i = 0; i < 40 && d.run.stage !== to; i++) {
    if (d.run.status === 'gate') d.do((r, when) => gateApprove(r, d.flow, when));
    else if (d.run.status === 'to-start') d.do((r, when) => startStage(r, d.flow, when));
    else d.do((r, when) => stageDone(r, d.flow, done(r.stage), when));
  }
  return d;
}

const ids = (run: Pick<Run, 'status' | 'question'>) => runActions(run).map((a) => a.id);

describe('what the person can do about a run, by state', () => {
  it('offers only a cancel while an agent works, and nothing once the run ended', () => {
    const d = until('plan');
    expect(d.run.status).toBe('working');
    expect(ids(d.run)).toEqual(['cancel']);
    expect(ids({ status: 'done', question: null })).toEqual([]);
    expect(ids({ status: 'cancelled', question: null })).toEqual([]);
  });

  it('lets the person start a stage whose agent waits, then accept it or send it back with a note', () => {
    const d = until('plan', { planner: false });
    expect(d.run.status).toBe('to-start');
    expect(ids(d.run)).toEqual(['startStage', 'cancel']);
    d.do((r, when) => startStage(r, d.flow, when));
    d.do((r, when) => stageDone(r, d.flow, done('plan'), when));
    expect(d.run.status).toBe('to-accept');
    const [accept, back] = runActions(d.run);
    expect([accept.id, accept.input, back.id, back.input]).toEqual(['accept', 'optional', 'return', 'required']);
  });

  it('asks for a reason to reject or skip a gate, not to approve it', () => {
    const d = until('gate1');
    expect(d.run.status).toBe('gate');
    expect(runActions(d.run).map((a) => [a.id, a.input])).toEqual([['approve', 'optional'], ['reject', 'required'], ['skip', 'required'], ['cancel', 'none']]);
  });

  it('answers a question with a text, and chooses the squad of a run that is routing instead of answering', () => {
    const d = until('plan');
    d.do((r, when) => ask(r, { by: 'planner', text: 'Which way?' }, when));
    expect(d.run.status).toBe('question');
    expect(runActions(d.run).map((a) => [a.id, a.input, a.desktopOnly])).toEqual([['answer', 'required', false], ['cancel', 'none', true]]);
    expect(ids({ status: 'question', question: { by: 'support', kind: 'squad', text: '', askedAt: '', stage: 'triage' } })).toEqual(['chooseSquad', 'cancel']);
  });

  it('offers a retry for a failed stage and a way out of a wait', () => {
    const d = until('plan');
    d.do((r, when) => stageFailed(r, 'boom', when));
    expect(ids(d.run)).toEqual(['retry', 'cancel']);
    expect(ids({ status: 'waiting', question: null })).toEqual(['skipWait', 'cancel']);
  });

  it('keeps everything but answering to the window, and asks twice before cancelling', () => {
    for (const status of RUN_STATUSES) {
      for (const a of runActions({ status, question: null })) {
        expect(a.desktopOnly, `${status}/${a.id}`).toBe(a.id !== 'answer');
        expect(a.confirm, `${status}/${a.id}`).toBe(a.id === 'cancel');
      }
    }
    expect(runActions({ status: 'question', question: { by: 'planner', kind: 'agent', text: 'x', askedAt: '', stage: 'plan' } })[0].desktopOnly).toBe(false);
  });
});

describe('who a run waits for', () => {
  it('waits for the person at a gate, a stage to start or accept, a failure, and a question that reached them', () => {
    const q = (holder: string | null) => ({ status: 'question' as const, question: { by: 'developer', holder, kind: 'agent' as const, text: 'x', askedAt: '', stage: 'implement' } });
    expect(needsPerson(q(null))).toBe(true);
    expect(needsPerson(q('tech-lead'))).toBe(false);
    for (const status of ['gate', 'to-start', 'to-accept', 'failed'] as const) expect(needsPerson({ status, question: null }), status).toBe(true);
    for (const status of ['working', 'waiting', 'done', 'cancelled'] as const) expect(needsPerson({ status, question: null }), status).toBe(false);
  });

  it('counts a question (anywhere along its chain) and a failure as a blocker, nothing else', () => {
    expect(RUN_STATUSES.filter((status) => isRunBlocker({ status }))).toEqual(['question', 'failed']);
    expect(isRunBlocker(null)).toBe(false);
  });

  it('draws every status in a tone', () => {
    expect(Object.keys(RUN_TONE).sort()).toEqual([...RUN_STATUSES].sort());
  });

  it('shows on a card the run that is going, else the newest that ended', () => {
    const run = (id: string, status: Run['status'], createdAt: string, ref = 'app#101') => ({ id, status, createdAt, issue: { ref } });
    const runs = [run('a', 'done', '2026-10-01T00:00:00Z'), run('b', 'cancelled', '2026-10-03T00:00:00Z'), run('c', 'gate', '2026-10-02T00:00:00Z'), run('d', 'working', '2026-10-03T00:00:00Z', 'app#102')];
    expect(runOfCard(runs, 'app#101')?.id).toBe('c');
    expect(runOfCard(runs.filter((r) => r.id !== 'c'), 'app#101')?.id).toBe('a');
    expect(runOfCard(runs, 'app#999')).toBeNull();
  });

  it('names the stage from the run\'s own flow, and the agent that works it', () => {
    const d = until('plan');
    expect(d.flow.find((s) => s.id === 'plan')?.label).toBe('cycle.agentFlow.stage.plan');
    expect(stageLabelOf(d.run)).toBe('Plano');
    expect(currentAgent(d.run, d.flow)).toBe(d.flow.find((s) => s.id === 'plan')?.agent);
    expect(stageLabelOf({ stage: 'x', flow: undefined })).toBe('x');
  });
});

describe('the repositories to choose from before a run can start', () => {
  const repos = [{ id: 'api', projectPath: 'group/api' }, { id: 'web', projectPath: 'group/web' }, { id: 'web2', projectPath: 'group/web' }];
  it('lets the runner decide when one repository lives in the issue project, or the workspace has only one', () => {
    expect(reposToChoose(repos, 'group/api')).toBeNull();
    expect(reposToChoose([repos[0]], 'group/elsewhere')).toBeNull();
  });
  it('asks when several repositories share the project, or none does and there are several', () => {
    expect(reposToChoose(repos, 'group/web')?.map((r) => r.id)).toEqual(['web', 'web2']);
    expect(reposToChoose(repos, 'group/none')?.map((r) => r.id)).toEqual(['api', 'web', 'web2']);
    expect(reposToChoose(repos, null)?.length).toBe(3);
  });
});

describe('the stages of a run as a timeline', () => {
  it('marks the stages behind as done, the current one by the run, and the rest as not reached', () => {
    const d = until('gate1');
    const rows = stageRows(d.run, d.flow);
    const state = Object.fromEntries(rows.map((r) => [r.stage.id, r.state]));
    expect(state.gate1).toBe('gate');
    expect(state.refine).toBe('done');
    expect(state.implement).toBe('upcoming');
    expect(rows.filter((r) => r.current).map((r) => r.stage.id)).toEqual(['gate1']);
    expect(rows.find((r) => r.stage.id === 'refine')?.record?.artifacts.length).toBeGreaterThan(0);
  });

  it('shows a stage the work went back from as sent back, and its attempts', () => {
    const d = until('gate1');
    d.do((r, when) => gateReject(r, d.flow, 'Not enough.', when));
    const rows = stageRows(d.run, d.flow);
    expect(rows.find((r) => r.stage.id === 'gate1')?.state).toBe('rejected');
    expect(rows.find((r) => r.stage.id === 'refine')?.record?.attempts).toBe(2);
  });

  it('reads the current stage from the run when an agent asks, and a cancelled run keeps where it stopped', () => {
    const d = until('plan');
    d.do((r, when) => ask(r, { by: 'planner', text: 'Which way?' }, when));
    expect(stageRows(d.run, d.flow).find((r) => r.current)?.state).toBe('question');
    d.do((r, when) => cancel(r, 'person', when));
    expect(stageRows(d.run, d.flow).find((r) => r.stage.id === 'plan')?.state).toBe('cancelled');
  });
});

describe('the tracker comments of a run', () => {
  it('belong to the stage their key names', () => {
    const d = until('review');
    d.do((r, when) => recordReview(r, { stage: 'review', by: 'reviewer', verdict: 'changes', summary: '', findings: [], head: null }, when));
    const run = d.run;
    expect(commentKey(run, 'plan')).toEqual({ kind: 'stage', stage: 'plan' });
    expect(commentKey(run, 'decision-gate1-2')).toEqual({ kind: 'decision', stage: 'gate1' });
    expect(commentKey(run, 'question-implement-1')).toEqual({ kind: 'question', stage: 'implement' });
    expect(commentKey(run, 'review-1')).toEqual({ kind: 'review', stage: 'review' });
    expect(commentKey(run, 'review-9')).toEqual({ kind: 'review', stage: null });
    expect(commentKey(run, 'pr')).toEqual({ kind: 'pr', stage: null });
  });

  it('list oldest first with their titles, and only a post that is up can be undone (never the pull request description)', () => {
    const d = until('plan');
    d.do((r) => recordCommentProposal(r, 'refine', { target: 'issue', bodyHash: 'h1', title: 'Spec ready', headline: 'Spec ready' }, at(50)));
    d.do((r) => recordCommentPublished(r, 'refine', { target: 'issue', noteId: 7, url: 'https://example.com/n/7', bodyHash: 'h1' }, at(51)));
    d.do((r) => recordCommentPublished(r, 'pr', { target: 'mr', noteId: 3, url: 'https://example.com/pr/3', bodyHash: 'h2', title: 'Add the thing' }, at(52)));
    d.do((r) => recordCommentProposal(r, 'plan', { target: 'issue', bodyHash: 'h3', headline: 'Plan ready' }, at(53)));
    const rows = commentRows(d.run);
    expect(rows.map((r) => [r.key, r.label])).toEqual([['refine', 'Spec ready'], ['pr', 'Add the thing'], ['plan', 'Plan ready']]);
    expect(rows.map(canUndoPost)).toEqual([true, false, false]);
  });
});

describe('the review rounds', () => {
  const f = (body: string, over: Partial<Finding> = {}): Finding => ({ path: 'src/a.ts', line: 3, endLine: null, side: 'new', severity: 'blocking', body, suggestion: null, ...over });
  const round = (verdict: 'changes' | 'approved', findings: Finding[]) => ({ stage: 'review', by: 'reviewer', verdict, summary: '', findings, head: null });

  it('says a finding found again is still open, one no later round has again is resolved, and the latest round decides the rest', () => {
    const d = until('review');
    d.do((r, when) => recordReview(r, round('changes', [f('The constant must be 2, not 1.'), f('Missing test for the empty list.', { path: 'src/b.ts' })]), when));
    d.do((r, when) => recordReview(r, round('changes', [f('The constant has to be 2 and not 1.'), f('A new problem in the loop.', { path: 'src/c.ts', severity: 'suggestion' })]), when));
    const rounds = reviewRounds(d.run);
    expect(rounds[0].findings.map((x) => x.thread)).toEqual(['still', 'fixed']);
    expect(rounds[1].findings.map((x) => x.thread)).toEqual(['open', 'open']);
    d.do((r, when) => recordReview(r, round('approved', []), when));
    expect(reviewRounds(d.run)[1].findings.map((x) => x.thread)).toEqual(['fixed', 'fixed']);
  });

  it('marks the findings of an approved last round as resolved', () => {
    const d = until('review');
    d.do((r, when) => recordReview(r, round('approved', [f('A nit.', { severity: 'suggestion' })]), when));
    expect(reviewRounds(d.run)[0].findings[0].thread).toBe('fixed');
  });
});

describe('the flow a run follows', () => {
  it('is older when its copy has another hash than the cycle has now; a run with no copy follows the current one', () => {
    expect(followsOlderFlow({ flow: { hash: 'aaaa', stages: [] } }, 'bbbb')).toBe(true);
    expect(followsOlderFlow({ flow: { hash: 'bbbb', stages: [] } }, 'bbbb')).toBe(false);
    expect(followsOlderFlow({}, 'bbbb')).toBe(false);
  });
});

describe('a question that is passed on', () => {
  it('stays the team\'s until it reaches the person', () => {
    const d = until('implement');
    d.do((r, when) => ask(r, { by: 'developer', text: 'Which API?', holder: 'tech-lead' }, when));
    expect(needsPerson(d.run)).toBe(false);
    d.do((r, when) => passQuestion(r, { from: 'tech-lead', to: null, text: 'Which API?', reason: 'A scope decision.' }, when));
    expect(needsPerson(d.run)).toBe(true);
  });
});

describe('the list of runs', () => {
  const run = (id: string, status: Run['status'], updatedAt: string, squad: string | null = null, holder: string | null = null) => ({
    id,
    status,
    updatedAt,
    squad,
    question: status === 'question' ? { by: 'developer', holder, kind: 'agent' as const, text: 'x', askedAt: '', stage: 'implement' } : null,
  });
  const runs = [
    run('working-old', 'working', '2026-10-03T08:00:00Z', 'a'),
    run('done', 'done', '2026-10-03T12:00:00Z', 'a'),
    run('gate', 'gate', '2026-10-03T09:00:00Z', 'b'),
    run('asking-agent', 'question', '2026-10-03T10:00:00Z', 'b', 'tech-lead'),
    run('asking-you', 'question', '2026-10-03T07:00:00Z', null),
    run('failed', 'failed', '2026-10-03T11:00:00Z', 'a'),
    run('waiting', 'waiting', '2026-10-03T06:00:00Z'),
    run('cancelled', 'cancelled', '2026-10-03T13:00:00Z', 'b'),
    run('working-new', 'working', '2026-10-03T11:30:00Z', 'b'),
  ];
  const ids = (list: { id: string }[]) => list.map((r) => r.id);

  it('puts what waits for the person first, then what goes on, then what ended, the newest change first inside each', () => {
    expect(ids(listRuns(runs))).toEqual(['failed', 'gate', 'asking-you', 'working-new', 'asking-agent', 'working-old', 'waiting', 'cancelled', 'done']);
  });

  it('filters by what each run waits for: a question held by an agent is waiting, not the person\'s', () => {
    expect(ids(listRuns(runs, 'you'))).toEqual(['failed', 'gate', 'asking-you']);
    expect(ids(listRuns(runs, 'working'))).toEqual(['working-new', 'working-old']);
    expect(ids(listRuns(runs, 'waiting'))).toEqual(['asking-agent', 'waiting']);
    expect(ids(listRuns(runs, 'failed'))).toEqual(['failed']);
    expect(ids(listRuns(runs, 'finished'))).toEqual(['cancelled', 'done']);
  });

  it('filters by squad, with the runs that have none under the empty squad, and together with the status', () => {
    expect(ids(listRuns(runs, 'all', 'a'))).toEqual(['failed', 'working-old', 'done']);
    expect(ids(listRuns(runs, 'all', ''))).toEqual(['asking-you', 'waiting']);
    expect(ids(listRuns(runs, 'working', 'b'))).toEqual(['working-new']);
  });

  it('counts every filter, and every status is in some filter (a failed run is both what waits for the person and a failed one)', () => {
    const counts = filterCounts(runs);
    expect(counts).toMatchObject({ all: 9, you: 3, working: 2, waiting: 2, failed: 1, finished: 2 });
    for (const status of ['working', 'gate', 'question', 'to-start', 'to-accept', 'waiting', 'failed', 'done', 'cancelled'] as const) {
      const r = run('x', status, '2026-10-03T00:00:00Z');
      const groups = RUN_FILTERS.filter((f) => f !== 'all' && inFilter(r, f));
      expect(groups.length, status).toBe(status === 'failed' ? 2 : 1);
    }
  });
});

describe('what a stage used, as the timeline says it', () => {
  it('formats the numbers in the reader\'s locale and shows a cost only when one was reported', () => {
    const u = { promptTokens: 1_234_567, completionTokens: 8_900, cachedTokens: 400_000, calls: 12, costUsd: null };
    expect(usageParams(u, 'en')).toEqual({ calls: '12', prompt: '1,234,567', cached: '400,000', completion: '8,900', cost: null });
    expect(usageParams(u, 'pt-BR').prompt).toBe('1.234.567');
    expect(usageParams({ ...u, costUsd: 0.0318 }, 'en').cost).toBe('$0.0318');
    expect(usageParams({ ...u, costUsd: 2 }, 'en').cost).toBe('$2.00');
  });
});
