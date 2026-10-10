// A run sent back by the person, through the runner: the developer gets the note with the open points, the later stages run again, and the run is reopened
// from the end. Scripted agents only; nothing reaches a model or a code host.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { messageText } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const at = (c: WorkspaceConfig, id: string): StageDef => c.devCycle.stages.find((s) => s.id === id) as StageDef;

/** The engineering cycle with `ready` as a wait for the merged pull request and a stage after it, like the cycle the maintainer runs. */
const withWait = (c: WorkspaceConfig): void => {
  c.language = 'en';
  at(c, 'ready').type = 'wait';
  at(c, 'ready').waitsFor = { kind: 'pr-merged' };
  c.devCycle.stages.push({ id: 'communicate', label: 'communicate', match: [], kind: 'development', rank: 0, type: 'work', agentId: 'writer', produces: ['6_NOTE.md'] });
  c.agents.team.push(newAgent({ id: 'writer', name: 'writer', stages: ['communicate'], autonomous: true, model: { role: 'deep' } }));
};

const suggestion = { path: 'src/feature.ts', line: 1, endLine: null, side: 'new', severity: 'suggestion', body: 'Name the constant.', suggestion: null };

function script(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
  b.engine.script('developer', async (_c, tools, n) => {
    await tools.write('src/feature.ts', `export const feature = ${n};\n`);
    return work(`Done ${n}.`, { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Approved with a note.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [suggestion] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 'Edge case', result: 'not-run', detail: 'needs a browser', severity: 'non-blocking' }] }));
  b.engine.script('writer', () => work('Written.', { artifacts: [doc('6_NOTE.md')] }));
}

async function toTheWait(b: Boot): Promise<Run> {
  const run = await b.runner.start('app#101');
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(run.id)!;
    if (now.status !== 'gate') break;
    b.runner.gate(run.id, 'approve');
  }
  return b.runner.get(run.id)!;
}

describe('sending a run back through the runner', () => {
  it('from the wait, with no stage named, goes back to the developer with the note and what review and QA left open, and then through review and QA again', async () => {
    const b = await boot({ configure: withWait });
    script(b);
    const run = await toTheWait(b);
    expect(run).toMatchObject({ status: 'waiting', stage: 'ready' });
    const calls = b.engine.calls.length;

    const sent = b.runner.sendBack(run.id, '', 'Go through the comments on the pull request.');
    expect(sent).toMatchObject({ stage: 'implement', status: 'working' });
    await b.settle();

    const dev = b.engine.calls.slice(calls).filter((c) => c.agent.id === 'developer');
    expect(dev).toHaveLength(1);
    expect(dev[0].prompt).toContain('Go through the comments on the pull request.');
    expect(dev[0].prompt).toContain('Name the constant.');
    expect(dev[0].prompt).toContain('Edge case, not run: needs a browser');
    // the attempt opens with why it runs again and what was asked, said once and before the cycle folder; the handoff is not repeated at the end
    const prompt = dev[0].prompt;
    expect(prompt).toContain('This attempt picks the stage up again: the person sent the work back to you.');
    expect(prompt.indexOf('What this attempt is for, from person')).toBeLessThan(prompt.indexOf('MEMORY.md'));
    expect(prompt).toContain('Context for the request above, not new work');
    expect(prompt).not.toContain('Handoff for you, from');
    // review sees round 2 with the first round before it, QA runs again, and the run is back at the wait
    const reviews = b.engine.calls.slice(calls).filter((c) => c.agent.id === 'reviewer');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].prompt).toContain('Name the constant.');
    const now = b.runner.get(run.id)!;
    expect(now).toMatchObject({ status: 'waiting', stage: 'ready' });
    expect(now.reviews.map((r) => r.round)).toEqual([1, 2]);
    expect(now.qa).toHaveLength(2);
    expect(now.stages.find((s) => s.stage === 'implement')).toMatchObject({ attempts: 2, status: 'done' });
    expect(now.returns).toEqual(run.returns);
  });

  it('from a finished run reopens it, goes back to a stage of the person\'s choice, and finishes again', async () => {
    const b = await boot({ configure: withWait });
    script(b);
    const run = await toTheWait(b);
    b.runner.skipWait(run.id, 'Merged by hand.');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'done', stage: 'communicate' });

    expect(() => b.runner.sendBack(run.id, 'communicate', 'x')).toThrow(expect.objectContaining({ code: 'unknown-stage' }));
    expect(() => b.runner.sendBack(run.id, 'implement', '   ')).not.toThrow();
    await b.settle();
    const now = b.runner.get(run.id)!;
    // the approved review and the QA left points open, so no note is needed; the run went through everything again and stopped at the wait
    expect(now).toMatchObject({ status: 'waiting', stage: 'ready' });
    expect(now.history.some((h) => h.type === 'reopened' && h.by === 'person')).toBe(true);
    expect(b.thread(run).some((m) => m.code === 'run.reopened')).toBe(true);
    expect(b.thread(run).filter((m) => m.code === 'run.reopened').map((m) => [m.stage, messageText(m)])).toEqual([['communicate', expect.stringMatching(/^The run was reopened and sent back to \w+\. What was asked:/)]]);
  });

  it('is refused for a run that was cancelled, and for one an agent is working', async () => {
    const b = await boot({ configure: withWait });
    script(b);
    const run = await b.runner.start('app#101');
    expect(() => b.runner.sendBack(run.id, 'refine', 'x')).toThrow(expect.objectContaining({ code: 'wrong-state' }));
    b.runner.cancel(run.id);
    await b.settle();
    expect(() => b.runner.sendBack(run.id, 'refine', 'x')).toThrow(expect.objectContaining({ code: 'not-active' }));
    expect(() => b.runner.sendBack('r-none-0000', 'refine', 'x')).toThrow(expect.objectContaining({ code: 'unknown-run' }));
  });
});
