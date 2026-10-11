// The runner over the persona's moves (#248): an answer, a gate decision, a send-back and a post in a run's thread made with the persona's `who` are written to the run's history
// and thread as the persona's, and the person's own calls are written as before. Scripted agents only; nothing reaches a model or a code host.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { personaWho } from '../src/shared/runs';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const ME = personaWho('me');

/** The flow driven to the question of the first stage. */
async function toQuestion(b: Boot): Promise<string> {
  b.engine.script('refiner', () => work('I need to know.', { artifacts: [doc('1_SPEC.md')], question: 'Which users does this cover?' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  const run = await b.runner.start('app#101');
  for (let i = 0; i < 4 && b.runner.get(run.id)!.status !== 'question'; i++) {
    await b.settle();
    if (b.runner.get(run.id)!.status === 'gate') b.runner.gate(run.id, 'approve');
  }
  expect(b.runner.get(run.id)).toMatchObject({ status: 'question' });
  return run.id;
}

describe('what the persona does in a run, worded as the persona\'s', () => {
  it('answers a question as the persona: the answer message and the history say so', async () => {
    const b = await boot();
    const id = await toQuestion(b);
    b.runner.answer(id, 'All signed-in users', undefined, ME);
    const answers = b.thread(id).filter((m) => m.kind === 'answer');
    expect(answers).toHaveLength(1);
    expect(answers[0].author).toEqual({ type: 'agent', id: 'me' });
    expect(b.runner.get(id)!.history.filter((h) => h.type === 'answer').map((h) => h.by)).toEqual(['persona']);
  });

  it('answers as the person when nothing says otherwise', async () => {
    const b = await boot();
    const id = await toQuestion(b);
    b.runner.answer(id, 'All signed-in users');
    expect(b.thread(id).filter((m) => m.kind === 'answer')[0].author).toEqual({ type: 'person' });
    expect(b.runner.get(id)!.history.filter((h) => h.type === 'answer').map((h) => h.by)).toEqual(['person']);
  });

  it('takes a post of the persona in the run\'s thread as the answer to the question, worded as the persona\'s, and a post that names an agent as nothing', async () => {
    const b = await boot();
    const id = await toQuestion(b);
    const thread = `run-${id}`;
    expect(b.runner.answerPost(thread, '@developer take a look', [], ME)).toBeNull();
    const posted = b.runner.answerPost(thread, 'Every signed-in user.', [], ME);
    expect(posted?.author).toEqual({ type: 'agent', id: 'me' });
    expect(b.runner.get(id)!.history.filter((h) => h.type === 'answer').map((h) => h.by)).toEqual(['persona']);
  });

  it('decides a gate and sends a run back as the persona', async () => {
    const b = await boot();
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')] }));
    const run = await b.runner.start('app#101');
    for (let i = 0; i < 4 && b.runner.get(run.id)!.status !== 'gate'; i++) await b.settle();
    expect(b.runner.get(run.id)!.status).toBe('gate');
    b.runner.gate(run.id, 'reject', 'Needs the empty case.', ME);
    const rejected = b.thread(run.id).filter((m) => m.code === 'gate.rejected');
    expect(rejected.map((m) => m.author)).toEqual([{ type: 'agent', id: 'me' }]);
    expect(b.runner.get(run.id)!.history.find((h) => h.type === 'gate-rejected')?.by).toBe('persona');
  });

  it('cancels a run as the persona', async () => {
    const b = await boot();
    const id = await toQuestion(b);
    b.runner.cancel(id, ME);
    expect(b.runner.get(id)!.history.find((h) => h.type === 'cancelled')?.by).toBe('persona');
    expect(b.thread(id).find((m) => m.code === 'run.cancelled')?.author).toEqual({ type: 'agent', id: 'me' });
  });
});
