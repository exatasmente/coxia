// Squads talk through their liaisons: an agent that needs something from another squad's area asks its own liaison (the chain), which makes a request to the
// other squad's liaison in the squads channel; that one answers, declines, turns it into an issue or hands it to the person, and what it says travels back down
// the chain without the person. Everything is a message the person can read, and the person can step into any channel.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { ForumMessage } from '../src/shared/forum';
import { SQUADS_CHANNEL, squadChannelId } from '../src/shared/forum';
import type { Run } from '../src/shared/runs';
import { doc, work } from './helpers/runner';
import { type SquadBoot, asking, bootSquads, receiving, requesting } from './helpers/squadRunner';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const built = () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] });
const channel = (s: SquadBoot): ForumMessage[] => s.b.forum.read(SQUADS_CHANNEL, 0, 100)?.messages ?? [];
const agentsOf = (s: SquadBoot): string[] => s.b.engine.calls.map((c) => c.agent.id);
const who = (m: ForumMessage): string => (m.author.type === 'agent' ? m.author.id : m.author.type);

/** A's developer asks about B's area; its liaison makes the request; B's liaison does what `receive` says. */
async function ask(s: SquadBoot, receive: () => unknown, question = 'What does the totals API of the web return?', request = 'What does the totals API return, and in which unit?') {
  const { b } = s;
  b.engine.script('dev-a', asking(question), built);
  b.engine.script('lead-a', requesting('b', 'question', request));
  b.engine.script('lead-b', receive);
  const started = await b.runner.start('app#101', 'app');
  await b.settle();
  return started;
}

describe('a question about another squad\'s area', () => {
  it('goes from the developer of A to the liaison of A to the liaison of B, in the squads channel, and is answered back down the chain without the person', async () => {
    const s = await bootSquads();
    const { b } = s;
    const started = await ask(s, receiving({ verdict: 'answer', text: 'Cents, as an integer.' }));
    const run = b.runner.get(started.id) as Run;
    expect(run).toMatchObject({ status: 'done', squad: 'a' });
    expect(agentsOf(s)).toEqual(['support', 'dev-a', 'lead-a', 'lead-b', 'dev-a']);

    // the squads channel holds the request, addressed to the other liaison, and the answer that closes it
    const [request, answer, ...rest] = channel(s);
    expect(rest).toEqual([]);
    expect(request).toMatchObject({ kind: 'request', to: 'lead-b', text: 'What does the totals API return, and in which unit?', public: false, params: { from: 'a', squad: 'b', kind: 'question', run: started.id, ref: 'app#101' } });
    expect(who(request)).toBe('lead-a');
    expect(answer).toMatchObject({ kind: 'answer', to: 'lead-a', text: 'Cents, as an integer.', replyTo: request.seq });
    expect(who(answer)).toBe('lead-b');
    expect(b.forum.summary(SQUADS_CHANNEL)).toMatchObject({ kind: 'channel', squad: null, openQuestion: false, count: 2 });

    // the liaison of A was offered the request and told about the other squads; the liaison of B only read, in B's repository
    const leadA = b.engine.calls[2];
    expect(JSON.stringify(leadA.schema)).toContain('"enum":["answer","pass","needs-person","request"]');
    expect(JSON.stringify(leadA.schema)).toContain('"squad":{"enum":["b"]}');
    expect(leadA.system).toContain('- b (Squad B): The web.');
    const leadB = b.engine.calls[3];
    expect(leadB.confine).toBeUndefined();
    expect(leadB.agent.permission).toBe('read');
    expect(leadB.cwd).toBe(s.web.clone);
    expect(leadB.prompt).toContain('What does the totals API return, and in which unit?');
    expect(leadB.system).toContain('Squad B');

    // in the run's thread: the developer's question, the line that says a request was made, and the answer coming from its own liaison, none of it public
    const thread = b.thread(run).filter((m) => m.stage === 'implement' && ['question', 'answer', 'system'].includes(m.kind) && (m.kind !== 'system' || m.code === 'runner.request.sent'));
    expect(thread.map((m) => [m.kind, who(m), m.to, m.public])).toEqual([['question', 'dev-a', 'lead-a', false], ['system', 'app', null, false], ['answer', 'lead-a', 'dev-a', false]]);
    expect(thread[1]).toMatchObject({ code: 'runner.request.sent', params: { agent: 'lead-a', squad: 'Squad B', kind: 'question' } });
    expect(thread[2].text).toContain('The squad Squad B answered (lead-b):\nCents, as an integer.');
    // and the developer went on with it
    expect(b.engine.calls[4].prompt).toContain('Cents, as an integer.');
    expect(b.engine.calls[4].prompt).toContain('The answer, from lead-a');
    expect(b.notices.filter((n) => /question/i.test(n.title))).toEqual([]);
  });

  it('opens the channels of the squads: one for each and the one they talk in, with the runs of a squad listed under it', async () => {
    const s = await bootSquads();
    const started = await ask(s, receiving({ verdict: 'answer', text: 'Cents.' }));
    const channels = s.b.forum.list().filter((t) => t.kind === 'channel');
    expect(channels.map((c) => [c.id, c.squad, c.title]).sort()).toEqual([[SQUADS_CHANNEL, null, 'Squads'], [squadChannelId('a'), 'a', 'Squad A'], [squadChannelId('b'), 'b', 'Squad B']].sort());
    expect(started.squad).toBe('a');
  });

  it('a request the other liaison declines comes back as the reason, and the developer goes on knowing it', async () => {
    const s = await bootSquads();
    const started = await ask(s, receiving({ verdict: 'decline', reason: 'Not this quarter.' }));
    expect(s.b.runner.get(started.id)?.status).toBe('done');
    const [, answer] = channel(s);
    expect(answer).toMatchObject({ kind: 'answer', code: 'runner.request.declined', params: { reason: 'Not this quarter.' } });
    expect(s.b.engine.calls.at(-1)?.prompt).toContain('The squad Squad B declined the request (lead-b): Not this quarter.');
  });

  it('a decision only the person can take goes to the person, who is told what the other squad needs decided, and the answer resumes the stage', async () => {
    const s = await bootSquads();
    const started = await ask(s, receiving({ verdict: 'needs-person', reason: 'Which unit is the contract: cents or decimals?' }));
    const run = s.b.runner.get(started.id) as Run;
    expect(run).toMatchObject({ status: 'question', question: { kind: 'agent', holder: null, by: 'dev-a' } });
    expect(run.question?.text).toContain('What does the totals API of the web return?');
    expect(run.question?.text).toContain('The squad Squad B says this is a decision for the person: Which unit is the contract: cents or decimals?');
    expect(channel(s)[1]).toMatchObject({ kind: 'answer', code: 'runner.request.handedUp' });
    expect(s.b.notices.some((n) => /question/i.test(n.title))).toBe(true);
    s.b.runner.answer(started.id, 'Cents.');
    await s.b.settle();
    expect(s.b.runner.get(started.id)?.status).toBe('done');
  });

  it('a request that cannot be made (a squad that is not there) is handed up with what went wrong', async () => {
    const s = await bootSquads();
    const { b } = s;
    b.engine.script('dev-a', asking('Where?'), built);
    b.engine.script('lead-a', requesting('ghost', 'question', 'Where?'));
    const started = await b.runner.start('app#101', 'app');
    await b.settle();
    expect(b.runner.get(started.id)).toMatchObject({ status: 'question', question: { holder: null } });
    expect(b.thread(started.id).find((m) => m.code === 'runner.chain.failed')).toBeTruthy();
    expect(channel(s)).toEqual([]);
    expect(agentsOf(s)).not.toContain('lead-b');
  });

  it('a liaison that fails to answer closes the request with that and hands the question up', async () => {
    const s = await bootSquads();
    const started = await ask(s, () => {
      throw new Error('the model is down');
    });
    expect(s.b.runner.get(started.id)).toMatchObject({ status: 'question', question: { holder: null } });
    const [request, answer] = channel(s);
    expect(answer).toMatchObject({ kind: 'answer', code: 'runner.request.failed', replyTo: request.seq, params: { agent: 'lead-b' } });
    expect(s.b.forum.summary(SQUADS_CHANNEL)?.openQuestion).toBe(false);
    expect(s.b.thread(started.id).find((m) => m.code === 'runner.chain.failed')?.params.detail).toContain('Squad B');
  });

  it('what the other liaison says after the person already answered is not used, and the request stays open in the channel as it was', async () => {
    const s = await bootSquads();
    const { b } = s;
    let id = '';
    const started = ask(s, () => {
      b.runner.answer(id, 'Never mind, I know.');
      return { verdict: 'answer', text: 'Cents.', reason: '', title: '' };
    });
    // the run id is known once it started; the responder runs later, while the run waits for the other liaison
    id = await new Promise<string>((resolve) => {
      const t = setInterval(() => {
        const run = b.runner.list()[0];
        if (run) {
          clearInterval(t);
          resolve(run.id);
        }
      }, 5);
    });
    await started;
    expect(b.runner.get(id)?.status).toBe('done');
    const messages = channel(s);
    expect(messages.map((m) => m.kind)).toEqual(['request']);
    expect(b.forum.summary(SQUADS_CHANNEL)?.openQuestion).toBe(true);
    expect(b.thread(id).some((m) => m.kind === 'answer' && who(m) === 'lead-a')).toBe(false);
  });

  it('the person can step into the squads channel: a post there is a post, in the order it happened', async () => {
    const s = await bootSquads();
    await ask(s, receiving({ verdict: 'answer', text: 'Cents.' }));
    const { personPost } = await import('../src/main/forum');
    personPost(s.b.forum, ['lead-a', 'lead-b'], SQUADS_CHANNEL, 'Please keep the units in cents.');
    const last = channel(s).at(-1) as ForumMessage;
    expect(last).toMatchObject({ kind: 'post', author: { type: 'person' }, text: 'Please keep the units in cents.' });
    expect(channel(s).map((m) => m.kind)).toEqual(['request', 'answer', 'post']);
  });
});
