// The agent cycle's behavior, pinned: the same scripted scenarios must always give the same stages, the same thread and the same writes to the code host.
// The expectations in test/fixtures/runner-golden/ were recorded from the runner before its flow was generalized (stage fields instead of a fixed order);
// the flow of stage fields that stands for that cycle now must reproduce them exactly. `UPDATE_GOLDEN=1` records them again: only for a change of behavior
// that was meant, never to make a red test green.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { onRunnerActionDone } = await import('../src/main/runner/door');

const FIXTURES = join(import.meta.dirname, 'fixtures/runner-golden');

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  rmSync(join(ATAS, 'runs'), { recursive: true, force: true });
  rmSync(join(ATAS, 'forum'), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  stop?.();
  stop = null;
});

const section = (heading: string, body: string) => ({ heading, body });
const comment = (sections: [string, string][], technical = 'Touches `src/feature.ts`.') => ({ sections: sections.map(([h, b]) => section(h, b)), technical });
const finding = (over: Record<string, unknown> = {}) => ({ path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 2.', suggestion: null, ...over });
const PLAN = comment([['Approach', 'Add the feature in one place.'], ['How it will be tested', 'A test for X.']]);
const PR = { title: 'Add the thing', ...comment([['What changes for the person using it', 'The thing does X.'], ['How to verify', 'Use it.']]) };
const built = (n = 1) => async (_c: unknown, tools: { write(p: string, c: string): Promise<string | null> }) => {
  await tools.write('src/feature.ts', `export const feature = ${n};\n`);
  return work('Built.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: comment([['What changed for the person using it', `The feature exists (${n}).`], ['How to verify', 'Use the feature and see X.']]), pr: PR });
};

/** Every agent does its stage at once; a scenario overrides the ones it is about. */
function script(b: Boot): void {
  b.engine.script('refiner', () => work('Spec written.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.', comment: comment([['What is asked', '> The thing must do X.'], ['Acceptance', 'X happens.']]) }));
  b.engine.script('planner', () => work('Plan written.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }));
  b.engine.script('developer', built());
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'The thing does X: passed.']]) }));
}

let counter = 0;
async function start(b: Boot): Promise<Run> {
  b.deps.newId = () => `r-golden-${String(++counter).padStart(4, '0')}`;
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101');
  await b.settle();
  return run;
}

/** Approves every gate until the run is at something else. */
async function through(b: Boot, run: Run, note = ''): Promise<Run> {
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(run.id)!;
    if (now.status !== 'gate') return now;
    b.runner.gate(run.id, 'approve', i === 0 ? note : '');
  }
  return b.runner.get(run.id)!;
}

/** What the scenario produced, with the things that change from one run to the next (ids, paths, hashes, times) taken out. */
function trace(b: Boot, run: Run): Record<string, unknown> {
  const root = b.repo.root;
  const clean = (v: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'string' ? x.split(root).join('<root>').split(run.id).join('<run>').replace(/\b[0-9a-f]{40}\b/g, '<sha>') : x)));
  const final = b.runner.get(run.id)!;
  return clean({
    status: final.status,
    stage: final.stage,
    stages: final.stages.map((s) => [s.stage, s.agent, s.status, s.artifacts, s.attempts, s.autonomous]),
    history: final.history.map((h) => [h.type, h.stage, h.by, h.detail]),
    thread: b.thread(run).map((m) => [m.kind, m.author, m.stage, m.code, m.params, m.text, m.to, m.public, m.refs, m.published ? m.published.target : null]),
    writes: forge.writes.map((w) => [w.method, w.endpoint, w.json]),
    comments: Object.fromEntries(Object.entries(final.comments).map(([k, c]) => [k, [c.target, c.status, c.noteId, c.headline]])),
    proposals: actions.listActions().map((a) => [a.kind, a.state, a.summary]),
  });
}

function pin(name: string, got: Record<string, unknown>): void {
  const path = join(FIXTURES, `${name}.json`);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(path, `${JSON.stringify(got, null, 1)}\n`);
    return;
  }
  expect(existsSync(path), `${name}: no recorded expectation`).toBe(true);
  expect(got).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

async function scenario(configure: (c: WorkspaceConfig) => void = () => undefined): Promise<Boot> {
  forge = makeForge();
  setVcsRuntimeForTests(forge.runtime());
  const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; configure(c); } });
  script(b);
  return b;
}

describe('the agent cycle, as before the flow was generalized', () => {
  it('a review that sends the work back once, with both gates approved', async () => {
    const b = await scenario();
    b.engine.script('developer', built(1), built(2));
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Findings that block', 'The constant is wrong.']]), findings: [finding({ suggestion: 'export const feature = 2;' })] }), () => work('Fine now.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
    const run = await start(b);
    const end = await through(b, run, 'Looks right.');
    expect(end.status).toBe('done');
    pin('review-once', trace(b, run));
  });

  it('a QA failure that sends the work back to the developer', async () => {
    const b = await scenario();
    b.engine.script('developer', built(1), built(2));
    b.engine.script('qa', () => work('One broke.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'fail', detail: 'a 500 on login' }], comment: comment([['Scenarios verified and their result', 'login: failed.']]) }), () => work('Passes now.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'login: passed.']]) }));
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    pin('qa-fail-once', trace(b, run));
  });

  it('a review that sends the work back twice reaches its own limit: the run asks the person, and the answer goes back a stage', async () => {
    const b = await scenario();
    b.engine.script('developer', built(1), built(2), built(3));
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Findings that block', 'Wrong.']]), findings: [finding()] }), () => work('Still a point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Findings that block', 'Still wrong.']]), findings: [finding({ body: 'Still wrong.' })] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
    const run = await start(b);
    let now = await through(b, run);
    expect(now.status).toBe('question');
    b.runner.answer(run.id, 'Go on, ship it as it is.');
    now = await through(b, run);
    expect(now.status).toBe('done');
    pin('review-limit', trace(b, run));
  });

  it('a review sent back once and a QA failure sent back once spend a round of their own each: the run does not stop', async () => {
    const b = await scenario();
    b.engine.script('developer', built(1), built(2), built(3));
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Findings that block', 'Wrong.']]), findings: [finding()] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
    b.engine.script('qa', () => work('Broke.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'fail', detail: 'a 500' }], comment: comment([['Scenarios verified and their result', 'login: failed.']]) }), () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'login', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'login: passed.']]) }));
    const run = await start(b);
    const end = await through(b, run);
    expect(end.status).toBe('done');
    expect(end.returns).toEqual({ review: 1, qa: 1 });
    pin('review-and-qa-once', trace(b, run));
  });

  it('a gate rejected, a gate skipped, and an agent that asks the person', async () => {
    const b = await scenario();
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', 'X.']]) }), () => work('Spec again.', { artifacts: [doc('1_SPEC.md')], comment: comment([['What is asked', 'X, and Y.']]) }));
    b.engine.script('planner', () => work('One thing is missing.', { question: 'Should it also handle Y?' }), () => work('Plan written.', { artifacts: [doc('2_PLAN.md')], comment: PLAN }));
    const run = await start(b);
    b.runner.gate(run.id, 'reject', 'Say what happens with Y.');
    await b.settle();
    b.runner.gate(run.id, 'approve');
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('question');
    b.runner.answer(run.id, 'Yes.');
    await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('gate');
    b.runner.gate(run.id, 'skip', 'The plan is trivial.');
    const end = await through(b, run);
    expect(end.status).toBe('done');
    pin('gates-and-question', trace(b, run));
  });

  it('agents that wait for the person: the stage waits to start, its result to be accepted, its comments in Actions', async () => {
    const b = await scenario((c) => {
      for (const id of ['planner', 'reviewer']) c.agents.team.find((a) => a.id === id)!.autonomous = false;
    });
    b.engine.script('reviewer', () => work('A point.', { artifacts: [doc('4_REVIEW.md')], verdict: 'changes', comment: comment([['Findings that block', 'Wrong.']]), findings: [finding()] }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
    b.engine.script('developer', built(1), built(2));
    const run = await start(b);
    for (let i = 0; i < 30; i++) {
      await b.settle();
      const s = b.runner.get(run.id)!;
      if (s.status === 'done') break;
      if (s.status === 'gate') b.runner.gate(run.id, 'approve');
      else if (s.status === 'to-start') b.runner.startStage(run.id);
      else if (s.status === 'to-accept') b.runner.accept(run.id, 'ok');
      else break;
    }
    expect(b.runner.get(run.id)!.status).toBe('done');
    pin('waiting-agents', trace(b, run));
  });
});
