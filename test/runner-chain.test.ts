// Agents talk before they ask the person: a question goes to the agent the asker turns to, in the run's thread, and that agent answers it, passes it on with
// a reason, or says it is the person's to decide. Every step is a message, the chain ends at the person, and no agent ever decides a gate.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { ForumMessage } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Boot, PartialAnswer, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

/** Every agent of the business team does its stage at once; the developer is the one that asks. */
function script(b: Boot, over: { developer?: Parameters<Boot['engine']['script']>[1][]; techLead?: Parameters<Boot['engine']['script']>[1][]; productOwner?: Parameters<Boot['engine']['script']>[1][] } = {}): void {
  b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
  b.engine.script('product-owner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }), ...(over.productOwner ?? []));
  b.engine.script('tech-lead', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }), ...(over.techLead ?? [() => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })]));
  b.engine.script('developer', ...(over.developer ?? [async (_c, tools) => {
    await tools.write('src/feature.ts', 'export const feature = 1;\n');
    return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  }]));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
  b.engine.script('customer-success', () => work('Told.', { artifacts: [doc('6_RELEASE_NOTE.md'), doc('USER_MANUAL.md')] }));
}

const build = async (configure: (c: WorkspaceConfig) => void = () => undefined): Promise<Boot> => boot({ flow: 'business', configure: (c) => { c.language = 'en'; configure(c); } });

/** Approves gates until the run is at something else. */
async function through(b: Boot, run: Run | string): Promise<Run> {
  const id = typeof run === 'string' ? run : run.id;
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(id)!;
    if (now.status !== 'gate') return now;
    b.runner.gate(id, 'approve');
  }
  return b.runner.get(id)!;
}

const trail = (b: Boot, run: Run): [string, string, string | null, boolean][] =>
  b.thread(run)
    .filter((m: ForumMessage) => m.stage === 'implement' && ['question', 'answer', 'post'].includes(m.kind))
    .map((m) => [m.kind, m.author.type === 'agent' ? m.author.id : m.author.type, m.to, m.public]);
const asked = (text: string) => () => work('Stuck.', { question: text });

/** Waits until the run is where the test needs it, approving gates along the way. A timeout fails the test instead of letting a slow machine skip the wait. */
async function until(b: Boot, run: Run, match: (r: Run) => boolean, ms = 10_000): Promise<Run> {
  const end = Date.now() + ms;
  for (;;) {
    const now = b.runner.get(run.id)!;
    if (match(now)) return now;
    if (now.status === 'gate') b.runner.gate(run.id, 'approve');
    if (Date.now() > end) throw new Error(`the run never reached the state the test waits for (status ${now.status})`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('a question between agents', () => {
  it('goes to the tech lead, who answers it from what it has: the developer goes on with the answer and the person is not asked', async () => {
    const b = await build();
    script(b, {
      developer: [asked('Where does the helper live?'), async (call, tools) => {
        expect(call.prompt).toContain('In src/helpers.');
        expect(call.prompt).toContain('The answer, from tech-lead');
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
      }],
      techLead: [() => ({ verdict: 'answer', text: 'In src/helpers.', reason: '' }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })],
    });
    const run = await b.runner.start('app#101');
    const end = await through(b, run);
    expect(end).toMatchObject({ status: 'waiting', stage: 'ready' });
    // the thread shows who asked whom and who answered; none of it is public, and nothing reached the person
    expect(trail(b, run)).toEqual([
      ['post', 'developer', null, true],
      ['question', 'developer', 'tech-lead', false],
      ['answer', 'tech-lead', 'developer', false],
      ['post', 'developer', null, true],
    ]);
    expect(b.notices.filter((n) => /question|pergunta/i.test(n.title))).toEqual([]);
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['support', 'product-owner', 'tech-lead', 'developer', 'tech-lead', 'developer', 'tech-lead', 'qa']);
    // the one who answered read only, whatever its own permission
    const call = b.engine.calls[4];
    expect(call.confine).toBeUndefined();
    // and its reading stays inside the run's worktree
    expect(call.readRoot?.root).toBe(run.worktree);
    expect(call.readRoot?.hooks).toBeTruthy();
    expect(call.prompt).toContain('Where does the helper live?');
    // a gate is the person's: nothing an agent said decided one
    expect(end.history.filter((h) => h.type === 'gate-approved').every((h) => h.by === 'person')).toBe(true);
    expect(end.history.some((h) => h.type === 'question-passed')).toBe(false);
  });

  it('a scope question goes from the tech lead to the product owner and from there to the person, and the thread shows the chain', async () => {
    const b = await build();
    script(b, {
      developer: [asked('Should it also cover archived items?'), async (call, tools) => {
        expect(call.prompt).toContain('Only active ones.');
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
      }],
      techLead: [() => ({ verdict: 'pass', text: '', reason: 'It is about scope, not about the code.' }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })],
      productOwner: [() => ({ verdict: 'needs-person', text: '', reason: 'Scope is a decision for the person.' })],
    });
    const run = await b.runner.start('app#101');
    const stopped = await through(b, run);
    expect(stopped).toMatchObject({ status: 'question', stage: 'implement', question: { by: 'developer', holder: null, hops: 2, kind: 'agent' } });
    expect(trail(b, run)).toEqual([
      ['post', 'developer', null, true],
      ['question', 'developer', 'tech-lead', false],
      ['post', 'tech-lead', null, false],
      ['question', 'tech-lead', 'product-owner', false],
      ['post', 'product-owner', null, false],
      ['question', 'product-owner', 'person', true],
    ]);
    expect(b.thread(run).find((m) => m.author.type === 'agent' && m.author.id === 'tech-lead' && m.kind === 'post' && m.stage === 'implement')?.text).toBe('It is about scope, not about the code.');
    // now the person is told, and answers; the developer goes on with it
    expect(b.notices.filter((n) => /question|pergunta/i.test(n.title))).toHaveLength(1);
    b.runner.answer(run.id, 'Only active ones.');
    const end = await through(b, run);
    expect(end).toMatchObject({ status: 'waiting', stage: 'ready' });
    expect(end.history.filter((h) => h.type === 'question-passed').map((h) => [h.by, h.detail])).toEqual([['tech-lead', 'product-owner'], ['product-owner', 'person']]);
  });

  it('a decision only the person can take goes to them at once, past the agents', async () => {
    const b = await build();
    script(b, {
      developer: [async () => work('Stuck.', { question: 'May we accept the risk of a slower page?', needsPerson: true }), async (_c, tools) => {
        await tools.write('src/feature.ts', 'export const feature = 1;\n');
        return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
      }],
    });
    const run = await b.runner.start('app#101');
    const stopped = await through(b, run);
    expect(stopped).toMatchObject({ status: 'question', question: { holder: null, hops: 0 } });
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['support', 'product-owner', 'tech-lead', 'developer']);
    expect(trail(b, run).at(-1)).toEqual(['question', 'developer', null, true]);
    expect(b.notices.filter((n) => /question|pergunta/i.test(n.title))).toHaveLength(1);
  });

  it('is told to the asker as an answer from the one who gave it, and a question to an agent that is not in the team goes to the person', async () => {
    const b = await build((c) => void (c.agents.team.find((a) => a.id === 'developer')!.turnsTo = null));
    script(b, { developer: [asked('Which file?')] });
    const run = await b.runner.start('app#101');
    expect(await through(b, run)).toMatchObject({ status: 'question', question: { holder: null } });
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['support', 'product-owner', 'tech-lead', 'developer']);
  });

  it('is stopped by a hop limit that does not depend on what the agents say, and the person gets the question', async () => {
    const chain = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const b = await build((c) => {
      for (const id of chain) c.agents.team.push(newAgent({ id, name: id, autonomous: false, model: { role: 'deep' }, turnsTo: chain[chain.indexOf(id) + 1] ?? null }));
      c.agents.team.find((a) => a.id === 'developer')!.turnsTo = 'a1';
    });
    script(b, { developer: [asked('Where?')] });
    for (const id of chain) b.engine.script(id, () => ({ verdict: 'pass', text: '', reason: `Not mine (${id}).` }));
    const run = await b.runner.start('app#101');
    const stopped = await through(b, run);
    // four passes among the agents, and the fifth is the one that hands the question up
    expect(stopped).toMatchObject({ status: 'question', question: { holder: null, hops: 5 } });
    expect(b.engine.calls.map((c) => c.agent.id).filter((a) => chain.includes(a))).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(b.thread(run).find((m) => m.code === 'runner.chain.hops')).toMatchObject({ kind: 'system', params: { agent: 'a5', hops: 4 } });
  });

  it('gives the agent that answers the read-turn limit of the runner settings, with the wrap-up on', async () => {
    const b = await build((c) => void (c.runner.turns.read = 9));
    script(b, { developer: [asked('Where?'), () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] })], techLead: [() => ({ verdict: 'answer', text: 'Here.', reason: '' }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })] });
    await through(b, await b.runner.start('app#101'));
    const answering = b.engine.calls.find((c) => c.prompt.includes('asks:'));
    expect(answering?.agent.id).toBe('tech-lead');
    expect(answering).toMatchObject({ maxTurns: 9, wrapUp: true });
  });

  it('uses the answer of an agent that ran out of turns and answered from the wrap-up, and says so in the thread', async () => {
    const b = await build();
    script(b, { developer: [asked('Where?'), () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] })], techLead: [() => new PartialAnswer({ verdict: 'answer', text: 'Here, as far as I read.', reason: '' }), () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })] });
    const run = await b.runner.start('app#101');
    await through(b, run);
    expect(b.thread(run).find((m) => m.code === 'runner.partial')).toMatchObject({ kind: 'system', params: { agent: 'tech-lead' } });
    expect(b.thread(run).find((m) => m.kind === 'answer')?.text).toContain('Here, as far as I read.');
    expect(b.thread(run).some((m) => m.code === 'runner.chain.failed')).toBe(false);
  });

  it('goes to the person with the reason when the wrap-up of the agent fails too', async () => {
    const b = await build();
    script(b, { developer: [asked('Where?')], techLead: [() => { throw new Error('stopped at the step limit and the partial answer failed (provider error)'); }] });
    const run = await b.runner.start('app#101');
    expect(await through(b, run)).toMatchObject({ status: 'question', question: { holder: null } });
    expect(b.thread(run).find((m) => m.code === 'runner.chain.failed')?.params.detail).toContain('provider error');
    expect(b.thread(run).some((m) => m.code === 'runner.partial')).toBe(false);
  });

  it('goes to the person when the agent it was given to cannot answer at all', async () => {
    const b = await build();
    script(b, { developer: [asked('Where?')], techLead: [() => { throw new Error('the model is down'); }, () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })] });
    const run = await b.runner.start('app#101');
    const stopped = await through(b, run);
    expect(stopped).toMatchObject({ status: 'question', question: { holder: null } });
    expect(b.thread(run).find((m) => m.code === 'runner.chain.failed')).toMatchObject({ params: { agent: 'tech-lead', detail: 'the model is down' } });
  });

  it('is not answered by an agent once the person has answered it', async () => {
    const b = await build();
    let release: (v: unknown) => void = () => undefined;
    const late = new Promise((resolve) => (release = resolve));
    script(b, { developer: [asked('Where?'), async (call, tools) => {
      expect(call.prompt).toContain('Use the helper.');
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    }], techLead: [() => late, () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] })] });
    const run = await b.runner.start('app#101');
    // the tech-lead is silent while the chain holds the question: what raced a fixed number of waits here is now waited for, with a timeout
    const held = await until(b, run, (r) => r.status === 'question' && r.question?.holder === 'tech-lead');
    expect(held.question?.text).toBe('Where?');
    b.runner.answer(run.id, 'Use the helper.');
    release({ verdict: 'answer', text: 'Somewhere else.', reason: '' });
    const end = await through(b, run);
    expect(end).toMatchObject({ status: 'waiting', stage: 'ready' });
    expect(b.thread(run).filter((m) => m.kind === 'answer').map((m) => m.author.type)).toEqual(['person']);
  });
});
