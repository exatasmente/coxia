import { describe, expect, it } from 'vitest';
import { type ForumMessage, type ThreadSummary, GENERAL_THREAD, SQUADS_CHANNEL } from '../src/shared/forum';
import { applyMention, baselineSeen, commandRound, forumLists, groupThread, markSeen, mentionAt, mentionOptions, mergeMessages, totalUnread, unreadOf } from '../src/shared/forumView';

let seq = 0;
const msg = (over: Partial<ForumMessage>): ForumMessage => ({
  v: 1,
  type: 'message',
  seq: ++seq,
  thread: 'run-r-abc123-x1y2',
  at: '2026-10-03T10:00:00.000Z',
  kind: 'post',
  author: { type: 'person' },
  text: '',
  code: null,
  params: {},
  mentions: [],
  refs: [],
  attachments: [],
  stage: null,
  to: null,
  replyTo: null,
  public: false,
  waitsForAnswer: false,
  published: null,
  ...over,
});
const dev = { type: 'agent', id: 'developer' } as const;
const lead = { type: 'agent', id: 'tech-lead' } as const;
const owner = { type: 'agent', id: 'product-owner' } as const;

describe('the chain a question walks through the thread', () => {
  it('shows who asked whom, each pass and why it reached the person, then the answer that closed it', () => {
    seq = 0;
    const rows = groupThread([
      msg({ kind: 'system', author: { type: 'app' }, code: 'run.stage.started', text: '' }),
      msg({ kind: 'question', author: dev, text: 'Include archived rows?', to: 'tech-lead' }),
      msg({ kind: 'post', author: lead, text: 'Not technical: a scope question.' }),
      msg({ kind: 'question', author: lead, text: 'Include archived rows?', to: 'product-owner' }),
      msg({ kind: 'post', author: owner, text: 'It changes what people export: a decision for the person.' }),
      msg({ kind: 'question', author: owner, text: 'Include archived rows?', to: 'person', public: true }),
      msg({ kind: 'answer', author: { type: 'person' }, text: 'No.', public: true }),
      msg({ kind: 'post', author: dev, text: 'Done.' }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(['message', 'chain', 'message']);
    const chain = rows[1].type === 'chain' ? rows[1] : null;
    expect(chain?.chain.asker).toEqual(dev);
    expect(chain?.chain.first).toBe('tech-lead');
    expect(chain?.chain.steps.map((s) => [s.from, s.to, s.reason])).toEqual([
      [lead, 'product-owner', 'Not technical: a scope question.'],
      [owner, 'person', 'It changes what people export: a decision for the person.'],
    ]);
    expect(chain?.chain.reachedPerson).toBe(true);
    expect(chain?.chain.why).toBe('It changes what people export: a decision for the person.');
    expect(chain?.chain.open).toBe(false);
    expect(chain?.chain.answer?.text).toBe('No.');
    expect(chain?.messages).toHaveLength(6);
  });

  it('keeps a question with an agent open, and says it has not reached the person', () => {
    seq = 0;
    const rows = groupThread([msg({ kind: 'question', author: dev, text: 'Which API?', to: 'tech-lead' })]);
    const chain = rows[0].type === 'chain' ? rows[0].chain : null;
    expect(chain).toMatchObject({ open: true, holder: 'tech-lead', reachedPerson: false, steps: [] });
  });

  it('uses the app\'s own line as the reason when the question went up because of the hops or an agent gone', () => {
    seq = 0;
    const rows = groupThread(
      [
        msg({ kind: 'question', author: dev, text: 'Which?', to: 'tech-lead' }),
        msg({ kind: 'system', author: { type: 'app' }, code: 'runner.chain.gone', params: { agent: 'tech-lead' } }),
        msg({ kind: 'question', author: { type: 'app' }, text: 'Which?', to: 'person' }),
      ],
      (m) => (m.code ? `line:${m.code}` : m.text),
    );
    const first = rows[0];
    expect(first.type).toBe('chain');
    expect(first.type === 'chain' && first.chain.reachedPerson).toBe(true);
    expect(first.type === 'chain' && first.chain.why).toBe('line:runner.chain.gone');
  });

  it('treats a question that goes straight to the person, or a review limit the app asks, as already with the person', () => {
    seq = 0;
    const direct = groupThread([msg({ kind: 'question', author: dev, text: 'Which?', to: null })]);
    expect(direct[0].type === 'chain' && direct[0].chain.reachedPerson).toBe(true);
    const limit = groupThread([msg({ kind: 'question', author: { type: 'app' }, code: 'review.limit', to: null })]);
    expect(limit[0].type === 'chain' && [limit[0].chain.reachedPerson, limit[0].chain.open]).toEqual([true, true]);
  });

  it('attaches an answer that comes after other talk to the question it answers instead of leaving it alone', () => {
    seq = 0;
    const rows = groupThread([
      msg({ kind: 'question', author: dev, text: 'Which?', to: null }),
      msg({ kind: 'post', author: { type: 'person' }, text: '@qa what do you think?' }),
      msg({ kind: 'answer', author: { type: 'person' }, text: 'Use the second.' }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(['chain', 'message']);
    expect(rows[0].type === 'chain' && [rows[0].chain.open, rows[0].chain.answer?.text]).toEqual([false, 'Use the second.']);
  });

  it('leaves every other kind of message as its own row, in order', () => {
    seq = 0;
    const list = [msg({ kind: 'post', author: dev }), msg({ kind: 'handoff', author: dev, to: 'qa' }), msg({ kind: 'decision', author: { type: 'person' } }), msg({ kind: 'request', author: lead, to: 'web-dev' })];
    expect(groupThread(list).map((r) => (r.type === 'message' ? r.message.kind : r.type))).toEqual(['post', 'handoff', 'decision', 'request']);
  });
});

describe('the rounds of commands', () => {
  const app = { type: 'app' } as const;
  const line = (code: string, agent: string) => msg({ kind: 'system', author: app, code, params: { agent } });

  it('folds the commands one agent ran one after the other into one round, the asks and the answers included', () => {
    seq = 0;
    const list = [
      msg({ kind: 'post', author: { type: 'person' }, text: '@developer where is it?' }),
      line('runner.command.ask', 'developer'),
      line('runner.command.stage', 'developer'),
      line('runner.exec.host', 'developer'),
      line('runner.exec.host', 'developer'),
      msg({ kind: 'post', author: dev, text: 'Here.' }),
    ];
    const rows = groupThread(list);
    expect(rows.map((r) => r.type)).toEqual(['message', 'commands', 'message']);
    const round = rows[1];
    expect(round.type === 'commands' && round.agent).toBe('developer');
    expect(round.type === 'commands' && round.messages.map((m) => m.seq)).toEqual([2, 3, 4, 5]);
    expect(round.type === 'commands' && commandRound(round.messages)).toEqual({ ran: 2, waiting: false });
  });

  it('starts a new round for another agent, and after anything else is said', () => {
    seq = 0;
    const list = [line('runner.exec', 'developer'), line('runner.exec', 'qa'), msg({ kind: 'system', author: app, code: 'runner.partial', params: { agent: 'qa' } }), line('runner.exec', 'qa')];
    expect(groupThread(list).map((r) => (r.type === 'commands' ? `${r.agent}:${r.messages.length}` : r.type))).toEqual(['developer:1', 'qa:1', 'message', 'qa:1']);
  });

  it('says a round whose last line is an ask still waits for the person', () => {
    seq = 0;
    expect(commandRound([line('runner.exec.host', 'developer'), line('runner.command.ask', 'developer')])).toEqual({ ran: 1, waiting: true });
  });
});

describe('unread counts', () => {
  const s = (id: string, count: number): Pick<ThreadSummary, 'id' | 'count'> => ({ id, count });
  it('counts what came after the last message the person saw, never below zero, and everything for a thread never opened', () => {
    expect(unreadOf(s('a', 5), { a: 3 })).toBe(2);
    expect(unreadOf(s('a', 5), { a: 9 })).toBe(0);
    expect(unreadOf(s('b', 4), {})).toBe(4);
    expect(totalUnread([s('a', 5), s('b', 4)], { a: 5 })).toBe(4);
  });
  it('starts a device that never kept the count from what is there now', () => {
    expect(baselineSeen([s('a', 5), s('b', 0)])).toEqual({ a: 5, b: 0 });
    expect(totalUnread([s('a', 5)], baselineSeen([s('a', 5)]))).toBe(0);
  });
  it('moves forward only', () => {
    expect(markSeen({ a: 3 }, 'a', 2)).toEqual({ a: 3 });
    expect(markSeen({ a: 3 }, 'a', 7)).toEqual({ a: 7 });
    const before = { a: 3 };
    markSeen(before, 'b', 1);
    expect(before).toEqual({ a: 3 });
  });
  it('folds new messages into a thread without a copy of any and in order', () => {
    seq = 0;
    const a = msg({});
    const b = msg({});
    const c = msg({});
    const list = [a, b];
    expect(mergeMessages(list, [b])).toBe(list);
    expect(mergeMessages([a], [c, b, a]).map((m) => m.seq)).toEqual([1, 2, 3]);
  });
});

describe('what the forum lists', () => {
  const thread = (id: string, kind: ThreadSummary['kind'], over: Partial<ThreadSummary> = {}): ThreadSummary => ({ id, kind, runId: null, squad: null, title: id, createdAt: '2026-10-01T00:00:00Z', count: 0, lastAt: null, lastKind: null, openQuestion: false, ...over });
  const all = [
    thread('run-a', 'run', { runId: 'a', squad: 'platform', lastAt: '2026-10-03T09:00:00Z' }),
    thread('squad-web', 'channel', { squad: 'web', title: 'Web' }),
    thread(SQUADS_CHANNEL, 'channel', { title: 'Squads' }),
    thread('run-b', 'run', { runId: 'b', squad: 'web', lastAt: '2026-10-03T11:00:00Z' }),
    thread('squad-platform', 'channel', { squad: 'platform', title: 'Platform' }),
    thread(GENERAL_THREAD, 'general', { title: 'General' }),
    thread('release-planning', 'general', { title: 'Release planning', lastAt: '2026-10-03T10:00:00Z' }),
  ];
  it('puts the general thread first, then the squads\' channel and the channels of the squads, and the other threads by latest activity', () => {
    const lists = forumLists(all);
    expect(lists.channels.map((s) => s.id)).toEqual([GENERAL_THREAD, SQUADS_CHANNEL, 'squad-platform', 'squad-web']);
    expect(lists.threads.map((s) => s.id)).toEqual(['run-b', 'release-planning', 'run-a']);
  });
  it('narrows to one squad: its channel and the threads of its runs', () => {
    const lists = forumLists(all, 'platform');
    expect(lists.channels.map((s) => s.id)).toEqual(['squad-platform']);
    expect(lists.threads.map((s) => s.id)).toEqual(['run-a']);
  });
});

describe('@agent while typing', () => {
  const team = [{ id: 'developer', name: 'Developer' }, { id: 'tech-lead', name: 'Tech Lead' }, { id: 'qa', name: 'QA' }, { id: 'dev-ops', name: 'Ops' }];
  it('finds the mention the caret ends, with the same boundary the parser uses', () => {
    expect(mentionAt('hello @dev', 10)).toEqual({ start: 6, query: 'dev' });
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionAt('ana@example.com', 15)).toBeNull();
    expect(mentionAt('see src/@types', 14)).toBeNull();
    expect(mentionAt('hello @dev and more', 17)).toBeNull();
    expect(mentionAt('hello @dev and more', 10)).toEqual({ start: 6, query: 'dev' });
  });
  it('offers the agents that start with it first, then those that contain it, by id or by name', () => {
    expect(mentionOptions(team, 'dev').map((a) => a.id)).toEqual(['developer', 'dev-ops']);
    expect(mentionOptions(team, 'lead').map((a) => a.id)).toEqual(['tech-lead']);
    expect(mentionOptions(team, 'tech').map((a) => a.id)).toEqual(['tech-lead']);
    expect(mentionOptions(team, '').length).toBe(4);
    expect(mentionOptions(team, 'zzz')).toEqual([]);
    expect(mentionOptions(team, '', 2)).toHaveLength(2);
  });
  it('puts the whole mention in place of the partial one, with a space after', () => {
    expect(applyMention('hello @de and more', 6, 9, 'developer')).toEqual({ text: 'hello @developer and more', caret: 17 });
    expect(applyMention('@t', 0, 2, 'tech-lead')).toEqual({ text: '@tech-lead ', caret: 11 });
  });
});
