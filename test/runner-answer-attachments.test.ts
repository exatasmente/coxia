// The files a person attaches to the message that answers a run's question: the answer message the runner records carries them (so it shows them and
// the retention sees a live message naming them), and the agent of the resumed stage can open them through its read-only tool. A file the person
// attached reaches the stage *listing* from the move that recorded the answer, before the forum write is read back (which is what the carry covers).
// Scripted agents only; nothing reaches a model or a code host.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const refs = [
  { id: 'aaaaaaaaaaaaaaaa', name: 'shot.png', kind: 'image' as const, bytes: 2048 },
  { id: 'bbbbbbbbbbbbbbbb', name: 'trace.log', kind: 'text' as const, bytes: 300 },
];

/** The flow driven to a question the person answers with a file attached: refine asks, the person answers with `refs`. */
async function answerWithFiles(b: Boot): Promise<string> {
  b.engine.script('refiner', () => work('I need to know.', { artifacts: [doc('1_SPEC.md')], question: 'Which users does this cover?' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved' }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')] }));
  const run = await b.runner.start('app#101');
  for (let i = 0; i < 4 && b.runner.get(run.id)!.status !== 'question'; i++) {
    await b.settle();
    if (b.runner.get(run.id)!.status === 'gate') b.runner.gate(run.id, 'approve');
  }
  expect(b.runner.get(run.id)).toMatchObject({ status: 'question' });
  b.runner.answer(run.id, 'All signed-in users', refs);
  return run.id;
}

describe("the files of the message that answers a run's question", () => {
  it('stay on the answer message the runner records, so the message shows them', async () => {
    const b = await boot();
    const id = await answerWithFiles(b);
    const answers = b.thread(id).filter((m) => m.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0].attachments.map((a) => a.id)).toEqual([refs[0].id, refs[1].id]);
    // the answer is a live message naming them: the retention sweep protects the files
    expect(answers[0].attachments).toHaveLength(2);
  });

  it('reach the agent of the resumed stage through the move that recorded the answer, scoped to the run\'s conversation', async () => {
    const b = await boot();
    const id = await answerWithFiles(b);
    await b.settle();
    const refiner = b.engine.calls.filter((c) => c.agent.id === 'refiner').at(-1);
    expect(refiner?.attachments).toEqual({ thread: `run-${id}`, refs });
    // and the stage's prompt names them, with the tool the agent opens them with, never a path
    expect(refiner?.prompt).toContain('ConversationAttachment');
    expect(refiner?.prompt).toContain('shot.png');
  });

  it('are left out of the agent call when the workspace turned attachments off for agents', async () => {
    const b = await boot({ configure: (c) => void (c.attachments = { enabled: true, agents: false }) });
    const id = await answerWithFiles(b);
    await b.settle();
    const refiner = b.engine.calls.filter((c) => c.agent.id === 'refiner').at(-1);
    expect(refiner?.attachments).toBeUndefined();
    // the person still sees them on the message
    expect(b.thread(id).filter((m) => m.kind === 'answer')[0].attachments).toHaveLength(2);
  });
});
