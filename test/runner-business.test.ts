// The agent cycle with its business team: an issue goes through triage (the support agent asks the reporter and waits for the reply), refinement (the product
// owner proposes a priority), the gates, the engineering stages, and, once the pull request is merged, the note and the answer for the reporter.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { removeAgent } from '../src/shared/config/team';
import { setLanguage } from '../src/shared/i18n';
import { type Run, readOutput } from '../src/shared/runs';
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

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  stop?.();
  stop = null;
});

const comment = (sections: [string, string][], technical = '') => ({ sections: sections.map(([heading, body]) => ({ heading, body })), technical });
const configure = (extra: (c: WorkspaceConfig) => void = () => undefined) => (c: WorkspaceConfig): void => {
  c.language = 'en';
  c.devCycle.priority.labels = ['^P0$', '^P1$', '^P2$'];
  extra(c);
};

function script(b: Boot): void {
  b.engine.script('support', () => work('The issue is clear except for one thing.', { reporterQuestion: 'Which browser do you use?' }), () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')], comment: comment([['How it was understood', 'A request to do X.'], ['What is missing', 'Nothing now.']]) }));
  b.engine.script('product-owner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], priority: 'P1', milestone: 'v2', comment: comment([['What is asked', '> The thing must do X and not Y.'], ['Acceptance', 'X happens.']]) }));
  b.engine.script('tech-lead', () => work('Plan.', { artifacts: [doc('2_PLAN.md')], comment: comment([['Approach', 'One place.']]) }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [], comment: comment([['Suggestions that do not block', 'None.']]) }));
  b.engine.script('developer', async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')], comment: comment([['What changed for the person using it', 'The feature exists.']]), pr: { title: 'Add the thing', ...comment([['What changes for the person using it', 'The thing does X.']]) } });
  });
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }], comment: comment([['Scenarios verified and their result', 'Passed.']]) }));
  b.engine.script('customer-success', () => work('Told the reporter.', { artifacts: [doc('6_RELEASE_NOTE.md', '# Release note\n\nThe thing now does X.\n')], comment: comment([['What changed', 'The thing now does X.'], ['How to use it', 'Open it and press the button.']]) }));
}

/** Approves gates until the run is at something that is not a gate. */
async function through(b: Boot, run: Run): Promise<Run> {
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(run.id)!;
    if (now.status !== 'gate') return now;
    b.runner.gate(run.id, 'approve');
  }
  return b.runner.get(run.id)!;
}

const issueNotes = () => forge.bodies(101).map(([, body]) => body);
const heads = () => issueNotes().map((b) => b.split('\n')[0]);

describe('an issue through the agent cycle', () => {
  it('is triaged, asks the reporter and waits for the reply, is refined with a proposed priority, goes through the engineering stages, waits for the merge and tells the reporter', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', configure: configure() });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    b.deps.now = () => new Date('2026-10-03T11:00:00Z');
    const started = await b.runner.start('app#101');
    await b.settle();

    // triage: the support agent asked the reporter, on the issue, and the run waits for the reply
    let run = b.runner.get(started.id)!;
    expect(run).toMatchObject({ status: 'waiting', stage: 'triage', wait: { kind: 'reporter-reply', by: 'support' } });
    expect(heads()).toEqual(['**Waiting for an answer**']);
    expect(issueNotes()[0]).toContain('Which browser do you use?');
    expect(await b.runner.tick()).toEqual([]);
    forge.say(101, 'ana', 'Firefox on a phone.', '2026-10-03T12:30:00Z');
    expect(await b.runner.tick()).toHaveLength(1);
    run = await through(b, run);

    // refine proposed a priority: it waits in Actions, whatever the autonomy of the agent, and nothing was written to the issue's labels
    expect(forge.labels).toEqual([]);
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'priority');
    expect(proposal).toMatchObject({ state: 'pending', summary: 'Priority P1 for app#101' });
    expect(JSON.parse(proposal!.command!.json!)).toEqual({ labels: ['P1'] });
    expect(b.thread(run).map((m) => m.code)).toEqual(expect.arrayContaining(['runner.priority.proposed', 'runner.priority.milestone']));
    await actions.approveAction(proposal!.id);
    expect(forge.labels).toEqual(['P1']);

    // the stages, in order, with the person at the gates; the tech lead worked the plan and the review
    expect(run).toMatchObject({ status: 'waiting', stage: 'ready', wait: { kind: 'pr-merged' } });
    expect(run.stages.map((s) => [s.stage, s.agent])).toEqual([['triage', 'support'], ['refine', 'product-owner'], ['gate1', null], ['plan', 'tech-lead'], ['gate2', null], ['implement', 'developer'], ['review', 'tech-lead'], ['qa', 'qa'], ['ready', null]]);
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['support', 'support', 'product-owner', 'tech-lead', 'developer', 'tech-lead', 'qa']);

    // until the pull request is merged, the run stays where it is
    expect(await b.runner.tick()).toEqual([]);
    forge.pr!.merged = true;
    expect(await b.runner.tick()).toHaveLength(1);
    await b.settle();
    run = b.runner.get(run.id)!;
    expect(run).toMatchObject({ status: 'done', stage: 'communicate' });
    expect(b.engine.calls.at(-1)?.agent.id).toBe('customer-success');

    // the release note is in the cycle folder, and the reporter was answered on the issue
    expect(readFileSync(join(run.worktree, run.cycleFolder, '6_RELEASE_NOTE.md'), 'utf8')).toContain('The thing now does X.');
    // (the reporter's own reply is the second note; the review went to the pull request)
    expect(heads()).toEqual(['**Waiting for an answer**', 'Firefox on a phone.', '**Issue triaged**', '**Spec ready for gate 1**', '**Gate 1: approved**', '**Plan ready for gate 2**', '**Gate 2: approved**', '**Implementation ready for review**', '**QA: all scenarios passed**', '**Change delivered**']);
    const told = issueNotes().at(-1)!;
    expect(told).toContain('### What changed\n\nThe thing now does X.');
    expect(told).toContain('### How to use it');
    expect(told).not.toContain('<details>');
    expect(told).not.toMatch(/customer-success|support|product-owner|tech-lead|forum|\/home\//);
    expect(run.comments.communicate).toMatchObject({ target: 'issue', status: 'published' });
    expect(run.comments.triage).toMatchObject({ target: 'issue', status: 'published' });
  });

  it('with no customer success agent, ends after the merge without communicating, and says so', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', configure: configure((c) => Object.assign(c, removeAgent(c, 'customer-success'))) });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')], comment: comment([['How it was understood', 'X.']]) }));
    const started = await b.runner.start('app#101');
    await through(b, started);
    expect(b.runner.get(started.id)).toMatchObject({ status: 'waiting', stage: 'ready' });
    forge.pr!.merged = true;
    await b.runner.tick();
    await b.settle();
    const run = b.runner.get(started.id)!;
    expect(run.status).toBe('done');
    expect(b.thread(run).at(-1)).toMatchObject({ kind: 'system', code: 'run.completed.noAgent', params: { stage: 'cycle.agentFlow.stage.communicate' } });
    expect(heads().some((h) => h.includes('Change delivered'))).toBe(false);
  });

  it('asks the person on the issue only when a question reaches them, not at each step of the chain between the agents', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', configure: configure() });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
    b.engine.script('developer', () => work('Stuck.', { question: 'Should archived items be covered?' }));
    b.engine.script('tech-lead', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }), () => ({ verdict: 'pass', text: '', reason: 'Scope.' }));
    b.engine.script('product-owner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }), () => ({ verdict: 'needs-person', text: '', reason: 'The person decides scope.' }));
    const started = await b.runner.start('app#101');
    const run = await through(b, started);
    expect(run).toMatchObject({ status: 'question', question: { holder: null } });
    const waiting = issueNotes().filter((n) => n.startsWith('**Waiting for an answer**'));
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toContain('Should archived items be covered?');
    expect(b.thread(run).filter((m) => m.kind === 'question' && m.public).map((m) => [m.author.type === 'agent' ? m.author.id : '', m.to])).toEqual([['product-owner', 'person']]);
    expect(b.thread(run).find((m) => m.kind === 'question' && m.public)?.published).toMatchObject({ target: 'issue' });
  });

  it('proposes the priority only from the stage that owns it: triage may suggest a level but its proposal is said not to have been taken', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', configure: configure() });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    // the support agent returns a priority anyway (the schema does not ask for it); the product owner's, in the next stage, is the one that counts
    b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')], priority: 'P0', comment: comment([['How it was understood', 'X.']]) }));
    const started = await b.runner.start('app#101');
    const run = await through(b, started);
    const [triage, refine] = [b.engine.calls.find((c) => c.agent.id === 'support')!, b.engine.calls.find((c) => c.agent.id === 'product-owner')!];
    expect(Object.keys((triage.schema as { properties: object }).properties)).not.toContain('priority');
    expect(triage.prompt).toContain('proposed by the product refinement stage');
    expect(triage.prompt).toContain('P0, P1, P2');
    expect(Object.keys((refine.schema as { properties: object }).properties)).toEqual(expect.arrayContaining(['priority', 'milestone']));
    const codes = b.thread(run).filter((m) => m.code?.startsWith('runner.priority')).map((m) => [m.code, m.stage]);
    expect(codes).toEqual([['runner.priority.notOwner', 'triage'], ['runner.priority.milestone', 'refine'], ['runner.priority.proposed', 'refine']]);
    const proposals = actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'priority');
    expect(proposals.map((a) => [a.key, a.summary])).toEqual([[`priority:${run.id}:refine:1`, 'Priority P1 for app#101']]);
  });

  it('says so when the same stage would propose the same priority again, and keeps the first proposal', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, flow: 'business', configure: configure() });
    script(b);
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')], comment: comment([['How it was understood', 'X.']]) }));
    const started = await b.runner.start('app#101');
    const run = await through(b, started);
    const refine = run.flow!.stages.find((s) => s.id === 'refine')!;
    const agent = b.runner.get(run.id) && b.deps.config().agents.team.find((a) => a.id === 'product-owner')!;
    const end = { stage: refine, agent, kind: 'work' as const, output: readOutput({ summary: 'Spec.', priority: 'P1' }, 'work'), autonomous: true };
    await b.deps.publisher!.stageEnded(run.id, end);
    expect(b.thread(run).filter((m) => m.code === 'runner.priority.duplicate')).toHaveLength(1);
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'priority')).toHaveLength(1);
  });

  it('starts the flow of a workspace only when it has no problem: the agent cycle as delivered is fine', async () => {
    const b = await boot({ flow: 'business', configure: configure() });
    script(b);
    b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
    const run = await b.runner.start('app#101');
    expect(run.flow?.stages.map((s) => s.id)).toEqual(['triage', 'refine', 'gate1', 'plan', 'gate2', 'implement', 'review', 'qa', 'ready', 'communicate']);
    expect(existsSync(run.worktree)).toBe(true);
  });
});
