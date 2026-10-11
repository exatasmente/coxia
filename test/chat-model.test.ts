// The persona's chat as plain functions (no component is rendered: the runner is a node environment): the live bubble assembled from events, the rule that the stored answer
// replaces it, the messages that wait their turn, the Work found by the message each answer answers, and the words of a button in both languages.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '../src/shared/activity';
import type { ForumMessage } from '../src/shared/forum';
import { createTranslator } from '../src/shared/i18n';
import type { LiveAnswer, LiveEvent } from '../src/shared/persona';
import { PUSH_SCREENS } from '../src/shared/push';
import { buildTree, hasWork } from '../src/renderer/src/activityTreeModel';
import { PERSONA_TOOLS } from '../src/shared/personaTools';
import { BUTTON_KEY, actLine, actTarget, bubblesOf, buttonLabel, cardOpen, cardParts, composerAria, composerState, liveKey, menuControls, liveOf, queuedOf, reduceLive, reduceRead, refocusAfterSend, rowKind, workItems, workOf, workOpenByDefault, workShown, workSummary } from '../src/renderer/src/chatModel';

const THREAD = 'agent-me';
const event = (to: number, rev: number, offset: number, text: string, over: Partial<LiveEvent> = {}): LiveEvent => ({ thread: THREAD, to, agent: 'me', rev, offset, text, ...over });
const answer = (to: number, rev: number, text: string): LiveAnswer => ({ thread: THREAD, to, agent: 'me', rev, text });

describe('the live answers of a device', () => {
  it('assembles the pieces in order, as each arrives', () => {
    let map = reduceLive(new Map(), event(4, 1, 0, 'Hel')).map;
    expect(liveOf(map, THREAD)).toEqual([answer(4, 1, 'Hel')]);
    for (const [rev, text] of [[2, 'lo, '], [3, 'there'], [4, '.']] as const) {
      const before = liveOf(map, THREAD)[0].text;
      map = reduceLive(map, event(4, rev, before.length, text)).map;
    }
    expect(liveOf(map, THREAD)).toEqual([answer(4, 4, 'Hello, there.')]);
  });

  it('ignores an event it already has, and asks to read when it cannot place one', () => {
    const map = reduceLive(new Map(), event(4, 1, 0, 'Hello')).map;
    const again = reduceLive(map, event(4, 1, 0, 'Hello'));
    expect(again.map).toBe(map);
    expect(again.resync).toBe(false);
    // a piece that skips one, and one that lands past the text it holds
    expect(reduceLive(map, event(4, 3, 5, 'x')).resync).toBe(true);
    expect(reduceLive(map, event(4, 2, 99, 'x')).resync).toBe(true);
    // a device that joined in the middle holds nothing to append to
    const joined = reduceLive(new Map(), event(4, 4, 11, 'rest'));
    expect(joined.resync).toBe(true);
    expect(joined.map.size).toBe(0);
  });

  it('shows what was written to a device that joins after the third piece, and goes on from there (acceptance 9)', () => {
    const pieces = ['One ', 'two ', 'three ', 'four ', 'five.'];
    // the device that was there from the start
    let early = new Map() as ReturnType<typeof reduceLive>['map'];
    let offset = 0;
    pieces.forEach((text, i) => {
      early = reduceLive(early, event(4, i + 1, offset, text)).map;
      offset += text.length;
    });
    // the late one: it reads the text so far (three pieces), then takes the fourth and the fifth
    let late = reduceRead(new Map(), THREAD, [answer(4, 3, 'One two three ')]);
    expect(liveOf(late, THREAD)[0].text).toBe('One two three ');
    late = reduceLive(late, event(4, 4, 14, 'four ')).map;
    late = reduceLive(late, event(4, 5, 19, 'five.')).map;
    expect(liveOf(late, THREAD)).toEqual(liveOf(early, THREAD));
    expect(liveOf(late, THREAD)[0].text).toBe('One two three four five.');
  });

  it('replaces the text at offset 0, as a restart or a rewrite by the masking says, and drops it at the end', () => {
    let map = reduceLive(new Map(), event(4, 1, 0, 'Some narration')).map;
    map = reduceLive(map, event(4, 2, 0, 'The answer')).map;
    expect(liveOf(map, THREAD)[0].text).toBe('The answer');
    map = reduceLive(map, event(4, 3, 0, '', { end: true })).map;
    expect(liveOf(map, THREAD)).toEqual([]);
  });

  it('keeps two answers of one thread apart, oldest message first', () => {
    let map = reduceLive(new Map(), event(9, 1, 0, 'second')).map;
    map = reduceLive(map, event(4, 1, 0, 'first')).map;
    expect(liveOf(map, THREAD).map((a) => [a.to, a.text])).toEqual([[4, 'first'], [9, 'second']]);
    expect(liveOf(map, 'agent-other')).toEqual([]);
    expect(liveKey(THREAD, 4)).not.toBe(liveKey(THREAD, 9));
  });

  describe('a read of a thread', () => {
    it('takes what is newer, keeps what the device already has newer, and drops an answer the read no longer holds', () => {
      let map = reduceLive(new Map(), event(4, 1, 0, 'ab')).map;
      map = reduceLive(map, event(4, 2, 2, 'cd')).map;
      map = reduceLive(map, event(9, 1, 0, 'gone')).map;
      const read = reduceRead(map, THREAD, [answer(4, 1, 'ab')]);
      expect(liveOf(read, THREAD).map((a) => [a.to, a.rev, a.text])).toEqual([[4, 2, 'abcd']]);
      const newer = reduceRead(map, THREAD, [answer(4, 7, 'abcdefg'), answer(9, 1, 'gone')]);
      expect(liveOf(newer, THREAD).map((a) => [a.to, a.rev])).toEqual([[4, 7], [9, 1]]);
    });

    it('leaves the answers of another thread alone and returns the same map when nothing changed', () => {
      const other = { ...answer(1, 1, 'elsewhere'), thread: 'agent-you' };
      const map = new Map([[liveKey('agent-you', 1), other], [liveKey(THREAD, 4), answer(4, 2, 'ab')]]);
      const read = reduceRead(map, THREAD, [answer(4, 2, 'ab')]);
      expect(read).toBe(map);
      expect(reduceRead(map, THREAD, []).get(liveKey('agent-you', 1))).toBe(other);
      expect(liveOf(reduceRead(map, THREAD, []), THREAD)).toEqual([]);
    });
  });
});

const stored = (seq: number, over: Partial<ForumMessage> = {}): ForumMessage =>
  ({ v: 1, type: 'message', seq, thread: THREAD, at: '2026-10-10T12:00:00.000Z', kind: 'post', author: { type: 'agent', id: 'me' }, text: 'text', code: null, params: {}, mentions: [], refs: [], attachments: [], stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null, ...over }) as ForumMessage;

describe('the bubble and the stored answer', () => {
  it('shows an answer being written until a stored message answers the same message of the person, whichever event comes first', () => {
    const writing = [answer(4, 3, 'Hel')];
    const person = stored(4, { author: { type: 'person' } });
    expect(bubblesOf(writing, [person])).toEqual(writing);
    // the post arrives before the end of the stream
    expect(bubblesOf(writing, [person, stored(5, { answersTo: 4 })])).toEqual([]);
    // the end of the stream arrives before the post: the bubble is gone and nothing else of it is left to draw
    expect(bubblesOf([], [person])).toEqual([]);
  });

  it('keeps the bubble of a message that has no answer yet, and ignores answers to other messages and messages that answer nothing', () => {
    const writing = [answer(4, 1, 'a'), answer(9, 1, 'b')];
    const messages = [stored(5, { answersTo: 4 }), stored(6, { author: { type: 'agent', id: 'qa' } }), stored(7, { author: { type: 'person' } })];
    expect(bubblesOf(writing, messages).map((b) => b.to)).toEqual([9]);
  });
});

describe('the rows', () => {
  it('tells the person, the persona, an agent it called and a line of the app apart', () => {
    expect(rowKind({ kind: 'post', author: { type: 'person' } }, 'me')).toBe('person');
    expect(rowKind({ kind: 'post', author: { type: 'agent', id: 'me' } }, 'me')).toBe('answer');
    expect(rowKind({ kind: 'post', author: { type: 'agent', id: 'qa' } }, 'me')).toBe('agent');
    expect(rowKind({ kind: 'system', author: { type: 'app' } }, 'me')).toBe('system');
    expect(rowKind({ kind: 'system', author: { type: 'agent', id: 'me' } }, 'me')).toBe('system');
  });

  it('draws the line of an act of the persona as its own row, and the line that counts the rest as a line of the app', () => {
    expect(rowKind({ kind: 'system', author: { type: 'app' }, code: 'persona.act' }, 'me')).toBe('act');
    expect(rowKind({ kind: 'system', author: { type: 'app' }, code: 'persona.act.more' }, 'me')).toBe('system');
    expect(rowKind({ kind: 'system', author: { type: 'app' }, code: 'persona.stopped.window' }, 'me')).toBe('system');
  });
});

describe('the line an act of the persona leaves in the chat', () => {
  const say = { en: createTranslator('en'), 'pt-BR': createTranslator('pt-BR') };
  const act = (params: Record<string, string>) => ({ params });

  it('is worded by the viewer\'s catalog from the facts the message stores, so a language change translates the lines already there', () => {
    const m = act({ tool: 'Actions', op: 'approve', subject: 'Comment on #12', result: 'ok', id: 'a-1x-1' });
    expect(actLine(m, say.en)).toMatchObject({ text: 'Actions · approve: Comment on #12', refused: false, raised: null, auditId: 'a-1x-1', target: null });
    expect(actLine(m, say['pt-BR']).text).toBe('Ações · approve: Comment on #12');
  });

  it('says a refusal as one, with the reason, and a raise of reach with the fields', () => {
    const refused = actLine(act({ tool: 'Board', op: 'update', result: 'refused', reason: 'The test workspace writes nothing.', id: 'a-2' }), say.en);
    expect(refused).toMatchObject({ refused: true, text: 'Board · update was refused: The test workspace writes nothing.' });
    const raised = actLine(act({ tool: 'Settings', op: 'set', subject: 'agents.team[me].shell (set)', result: 'ok', raised: 'agents.team[me].shell' }), say.en);
    expect(raised).toMatchObject({ raised: 'agents.team[me].shell', auditId: null });
  });

  it('offers the button of the screen it was about, only when the target is in the vocabulary of the notifications', () => {
    const target = JSON.stringify({ to: 'run', id: 'r-abc' });
    expect(actLine(act({ tool: 'Runs', op: 'accept', result: 'ok', target }), say.en).target).toEqual({ to: 'run', id: 'r-abc' });
    for (const bad of ['', 'not json', JSON.stringify({ to: 'nowhere' }), JSON.stringify({ to: 'run' }), JSON.stringify({ to: 'qa', ref: 'has space' })]) expect(actTarget(bad), bad).toBeNull();
    expect(actTarget(undefined)).toBeNull();
  });

  it.each(['en', 'pt-BR'] as const)('has the name of every tool\'s area in %s, and shows an unknown tool by its name', (language) => {
    for (const tool of PERSONA_TOOLS) {
      const text = actLine(act({ tool, op: 'x', subject: 's', result: 'ok' }), say[language]).text;
      expect(text, tool).not.toContain('ui.chat.act');
      expect(text, tool).not.toMatch(/\{\w+\}/);
    }
    expect(actLine(act({ tool: 'Future', op: 'x', subject: 's', result: 'ok' }), say[language]).text).toContain('Future');
  });

  it('opens the audit at the act\'s entry, and the Audit screen alone when there is no id', async () => {
    const { targetToScreen } = await import('../src/renderer/src/pushTarget');
    expect(targetToScreen({ to: 'auditoria', id: 'a-1x-1' }, true)).toEqual({ name: 'auditoria', id: 'a-1x-1' });
    expect(targetToScreen({ to: 'auditoria' }, true)).toEqual({ name: 'auditoria' });
  });
});

let seq = 0;
let clock = 1000;
const line = (runId: string, over: Partial<ActivityEntry> = {}): ActivityEntry => ({ seq: ++seq, runId, jobId: null, role: 'me', at: (clock += 1000), kind: 'tool', label: 'Read file', ...over });
const status = (runId: string, state: NonNullable<ActivityEntry['state']>, over: Partial<ActivityEntry> = {}) => line(runId, { kind: 'status', state, label: state, ...over });
const call = (message: number, agent = 'me') => ({ agent, thread: THREAD, message });

describe('the messages that wait their turn', () => {
  it('lists the messages whose call line still says queued', () => {
    const entries = [status('r1', 'started', { call: call(4) }), status('r2', 'queued', { call: call(6) }), status('r3', 'queued', { call: call(8) }), status('r3', 'started', { call: call(8) })];
    expect([...queuedOf(entries, THREAD, 'me')]).toEqual([6]);
  });

  it('counts only the lines of this agent in this thread', () => {
    const entries = [status('r1', 'queued', { call: { agent: 'qa', thread: THREAD, message: 4 } }), status('r2', 'queued', { call: { agent: 'me', thread: 'agent-you', message: 5 } }), line('r3')];
    expect(queuedOf(entries, THREAD, 'me').size).toBe(0);
  });
});

describe('the work of an answer', () => {
  // Two answers, each its own call; the first has a sub-agent and a tool line and its closing excerpt, the second is still working.
  const first = [
    status('a1', 'started', { call: call(4) }),
    line('a1', { call: call(4), label: 'Read a' }),
    status('s1', 'started', { parent: 'a1', node: { type: 'sub', label: 'explore: map' }, role: 'me:explore' }),
    line('s1', { parent: 'a1', node: { type: 'sub', label: 'explore: map' }, role: 'me:explore', label: 'Read b' }),
    status('s1', 'finished', { parent: 'a1', node: { type: 'sub', label: 'explore: map' }, role: 'me:explore' }),
    line('a1', { call: call(4), kind: 'answer', label: 'the answer excerpt' }),
    status('a1', 'finished', { call: call(4) }),
  ];
  const second = [status('a2', 'started', { call: call(9) }), line('a2', { call: call(9), label: 'Read c' })];
  const roots = buildTree([...first, ...second]);

  it('finds the tree of the call that answered a message, and two answers have two', () => {
    expect(workOf(roots, 4, 'me')?.id).toBe('a1');
    expect(workOf(roots, 9, 'me')?.id).toBe('a2');
    expect(workOf(roots, 4, 'me')).not.toBe(workOf(roots, 9, 'me'));
    expect(workOf(roots, 5, 'me')).toBeNull();
    expect(workOf(roots, 4, 'qa')).toBeNull();
  });

  it('leaves the closing excerpt out of the section, since the bubble is that answer, and keeps the sub-agent', () => {
    const items = workItems(workOf(roots, 4, 'me') as never);
    const labels = items.map((i) => (i.type === 'line' ? i.entry.label : `node ${i.node.id}`));
    expect(labels).toContain('Read a');
    expect(labels).toContain('node s1');
    expect(labels).not.toContain('the answer excerpt');
  });

  it('sums the time and the steps anywhere under the root, and says whether it still works', () => {
    const done = workSummary(workOf(roots, 4, 'me') as never);
    expect(done.steps).toBe(2);
    expect(done.ms).toBeGreaterThan(0);
    expect(done.working).toBe(false);
    expect(workSummary(workOf(roots, 9, 'me') as never)).toMatchObject({ steps: 1, working: true });
  });

  it('is open while the call works and closed once the answer is complete', () => {
    expect(workOpenByDefault(workOf(roots, 9, 'me') as never)).toBe(true);
    expect(workOpenByDefault(workOf(roots, 4, 'me') as never)).toBe(false);
    expect(hasWork(workOf(roots, 4, 'me') as never)).toBe(false);
  });

  it('says an answer is going while a live bubble exists or a call of the persona works', () => {
    expect(composerState([], roots.filter((r) => r.id === 'a1'), 'me').going).toBe(false);
    expect(composerState([], roots, 'me').going).toBe(true);
    expect(composerState([answer(4, 1, 'x')], [], 'me').going).toBe(true);
    expect(composerState([], roots, 'qa').going).toBe(false);
  });
});

describe('the words of a button', () => {
  const say = { en: createTranslator('en'), 'pt-BR': createTranslator('pt-BR') };

  it('words the three examples of the spec', () => {
    expect(buttonLabel({ to: 'call' }, say.en, 'pre-daily')).toBe('Start the pre-daily');
    expect(buttonLabel({ to: 'board' }, say.en, 'pre-daily')).toBe('Open the board');
    expect(buttonLabel({ to: 'qa', ref: 'group/project#123' }, say.en, 'pre-daily')).toBe('Open the QA hand-off for group/project#123');
    expect(buttonLabel({ to: 'call' }, say['pt-BR'], 'pré-daily')).toBe('Começar a pré-daily');
  });

  it.each(['en', 'pt-BR'] as const)('has words in %s for every screen a notification can name, with its ref or id in them', (language) => {
    for (const to of PUSH_SCREENS) {
      expect(BUTTON_KEY[to], to).toBeTruthy();
      const text = buttonLabel({ to, ref: 'REF', id: 'ID' }, say[language], 'CER');
      expect(text, to).not.toBe(BUTTON_KEY[to]);
      expect(text, to).not.toMatch(/\{\w+\}/);
      expect(text.trim().length, to).toBeGreaterThan(5);
    }
    expect(buttonLabel({ to: 'deep', ref: 'REF' }, say[language], 'CER')).toContain('REF');
    expect(buttonLabel({ to: 'run', id: 'ID' }, say[language], 'CER')).toContain('ID');
    expect(buttonLabel({ to: 'conflict', id: 'ID' }, say[language], 'CER')).toContain('ID');
  });

  it('words a thread of the forum and a screen it does not know', () => {
    expect(buttonLabel({ to: 'forum', id: 'agent-x' }, say.en, 'c')).toBe('Open the conversation agent-x');
    expect(buttonLabel({ to: 'forum' }, say.en, 'c')).toBe('Open the forum');
    expect(buttonLabel({ to: 'nowhere' }, say.en, 'c')).toBe('Open the screen');
  });
});

describe('the accessibility attributes of the box and the menu', () => {
  it('makes the box a combobox only where @agent is completed', () => {
    expect(composerAria(false, 'x', 3, 1)).toEqual({});
    expect(composerAria(true, 'x', 0, 0)).toEqual({ role: 'combobox', 'aria-expanded': false, 'aria-controls': 'x', 'aria-autocomplete': 'list', 'aria-activedescendant': undefined });
    expect(composerAria(true, 'x', 2, 1)).toMatchObject({ 'aria-expanded': true, 'aria-activedescendant': 'x-1' });
  });

  it('points the menu button at the menu only while the desktop menu is in the page', () => {
    expect(menuControls(false, false)).toBeUndefined();
    expect(menuControls(true, false)).toBe('chat-menu');
    expect(menuControls(true, true)).toBeUndefined();
  });
});

describe('what the Work section shows and when', () => {
  it('shows nothing for an answer the persona gave with no step, no thought and no one else called', () => {
    const quiet = buildTree([status('q1', 'started', { call: call(4) }), line('q1', { call: call(4), kind: 'answer', label: 'the answer excerpt' }), status('q1', 'finished', { call: call(4) })]);
    expect(workShown(workOf(quiet, 4, 'me') as never)).toBe(false);
  });

  it('shows the section while the call works, and after it for a step, a thought, a narration or a sub-agent', () => {
    expect(workShown(workOf(buildTree([status('w1', 'started', { call: call(4) })]), 4, 'me') as never)).toBe(true);
    for (const kind of ['tool', 'thought', 'text'] as const) {
      const done = buildTree([status('w2', 'started', { call: call(5) }), line('w2', { call: call(5), kind }), status('w2', 'finished', { call: call(5) })]);
      expect(workShown(workOf(done, 5, 'me') as never), kind).toBe(true);
    }
    const sub = buildTree([status('w3', 'started', { call: call(6) }), status('s3', 'started', { parent: 'w3', node: { type: 'sub', label: 'explore: map' } }), status('s3', 'finished', { parent: 'w3', node: { type: 'sub', label: 'explore: map' } }), status('w3', 'finished', { call: call(6) })]);
    expect(workShown(workOf(sub, 6, 'me') as never)).toBe(true);
  });
});

describe('the ceremony card on a small screen', () => {
  it('is one line on a phone and in full on the computer until the person chooses, and the choice wins', () => {
    expect(cardOpen(true, null)).toBe(false);
    expect(cardOpen(false, null)).toBe(true);
    expect(cardOpen(true, true)).toBe(true);
    expect(cardOpen(false, false)).toBe(false);
  });
});

describe('the card when the chip is its header', () => {
  it('is the body only on a phone, where the chip says "Now" and the title, and whole on the computer', () => {
    expect(cardParts(true).head).toBe(false);
    expect(cardParts(false).head).toBe(true);
  });
});

describe('the focus of the box after a send', () => {
  it('goes back to the box on the computer always, and on a phone only when the box had it', () => {
    expect(refocusAfterSend(false, false)).toBe(true);
    expect(refocusAfterSend(false, true)).toBe(true);
    expect(refocusAfterSend(true, true)).toBe(true);
    expect(refocusAfterSend(true, false)).toBe(false);
  });

  it('keeps the box read-only and busy while it sends, never disabled (a disabled box drops the focus)', () => {
    const text = readFileSync(join(import.meta.dirname, '../src/renderer/src/screens/cycle/Composer.tsx'), 'utf8');
    expect(text).toMatch(/readOnly=\{busy\}/);
    expect(text).toMatch(/aria-busy=\{busy \|\| undefined\}/);
    expect(text.slice(text.indexOf('<textarea'), text.indexOf('onChange='))).not.toMatch(/disabled=\{/);
  });
});
