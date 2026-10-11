// The text of an answer being written: the store that publishes it as it grows, and the client's assembly of the events. Plain functions, a fake clock and a fake emitter.
import { beforeEach, describe, expect, it } from 'vitest';
import { redact } from '../src/main/errorlog-core';
import { LIVE_THROTTLE_MS, createPersonaLive, type LiveTimers } from '../src/main/persona/live';
import { applyLive, applyRead, type LiveAnswer, type LiveEvent } from '../src/shared/persona';

let clock = 0;
let queue: { at: number; fn: () => void; id: number }[] = [];
let nextId = 0;
const timers: LiveTimers = {
  set: (fn, ms) => {
    const id = nextId++;
    queue.push({ at: clock + ms, fn, id });
    return id;
  },
  clear: (h) => {
    queue = queue.filter((t) => t.id !== h);
  },
};
/** Moves the clock and fires the timers that fall due, in order. */
function advance(ms: number): void {
  const until = clock + ms;
  for (;;) {
    const due = queue.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    queue = queue.filter((t) => t !== due);
    clock = due.at;
    due.fn();
  }
  clock = until;
}

let events: LiveEvent[];
const make = (mask: (t: string) => string = (t) => redact(t, '/nowhere')) => createPersonaLive({ emit: (e) => events.push(e), redact: mask, now: () => clock, timers });
const T = 'agent-me';

beforeEach(() => {
  clock = 1_000;
  queue = [];
  events = [];
});

/** What a device that applied every event holds. */
const assembled = (): string => {
  let state: LiveAnswer | null = null;
  for (const e of events.filter((x) => !x.end)) state = applyLive(state, e).state;
  return state?.text ?? '';
};

describe('the live store', () => {
  it('publishes nothing before the first whole word, then the first event replaces from the start', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('Hel');
    advance(500);
    expect(events).toEqual([]);
    sink.piece('lo wor');
    advance(500);
    expect(events).toEqual([{ thread: T, to: 7, agent: 'me', rev: 1, offset: 0, text: 'Hello' }]);
  });

  it('coalesces the pieces of one window into one event, and appends with the length it held', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('one ');
    expect(events.map((e) => e.text)).toEqual(['one']);
    clock += 10;
    for (const p of ['two ', 'three ', 'four ']) {
      sink.piece(p);
      clock += 10;
    }
    expect(events).toHaveLength(1);
    advance(LIVE_THROTTLE_MS);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ rev: 2, offset: 3, text: ' two three four' });
    expect(assembled()).toBe('one two three four');
  });

  it('is a dozen events a second for a long answer, not hundreds', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    for (let i = 0; i < 1000; i++) {
      sink.piece('word ');
      advance(1);
    }
    expect(events.length).toBeLessThanOrEqual(Math.ceil(1000 / LIVE_THROTTLE_MS) + 1);
  });

  it('never publishes a secret that straddles two pieces, and releases the rest at the end', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('use the key sk-ant-api03-abcd');
    advance(200);
    sink.piece('efghijklmnop now');
    advance(200);
    live.end(T, 7);
    const wire = JSON.stringify(events);
    expect(wire).not.toContain('sk-ant');
    expect(wire).not.toContain('abcdefgh');
    expect(assembled()).toBe('use the key [key] now');
  });

  it('holds back the last unfinished word and releases it at the end', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('alpha beta gam');
    advance(200);
    expect(events.map((e) => e.text)).toEqual(['alpha beta']);
    sink.piece('ma');
    advance(200);
    expect(events).toHaveLength(1);
    live.end(T, 7);
    expect(events.filter((e) => !e.end).map((e) => e.text)).toEqual(['alpha beta', ' gamma']);
  });

  it('rewrites with an offset 0 event when the masking changes text already published', () => {
    // A mask that spans two words: the first is published before the second is known to complete it.
    const live = make((t) => t.replace(/foo bar/g, '[x]'));
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('a foo ');
    advance(200);
    expect(events.map((e) => e.text)).toEqual(['a foo']);
    sink.piece('bar baz ');
    advance(200);
    live.end(T, 7);
    const written = events.filter((e) => !e.end);
    expect(written.at(-1)).toMatchObject({ offset: 0, text: 'a [x] baz' });
    expect(written.reduce<LiveAnswer | null>((st, e) => applyLive(st, e).state, null)?.text).toBe('a [x] baz');
  });

  it('empties the bubble on a restart at once, not on the throttle', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('I will look at the files. ');
    advance(200);
    sink.restart();
    expect(events.at(-1)).toMatchObject({ offset: 0, text: '' });
    sink.piece('The answer is here. ');
    advance(200);
    live.end(T, 7);
    expect(events.filter((e) => !e.end).at(-1)?.text).toBe('The answer is here.');
  });

  it('settle gives a sink that got no piece the whole text, once', () => {
    const live = make();
    live.begin(T, 7, 'me');
    live.sink(T, 7).settle('A whole answer written in one go.');
    live.end(T, 7);
    expect(events.filter((e) => !e.end).map((e) => e.text)).toEqual(['A whole answer written in one go.']);
    expect(events.filter((e) => !e.end)[0].offset).toBe(0);
  });

  it('end flushes: the last published text is the masked, trimmed whole text', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    sink.piece('  The reply with a trailing blank  \n');
    live.end(T, 7);
    expect(events.at(-1)).toMatchObject({ end: true, rev: events.length });
    const text = events.filter((e) => !e.end).reduce<LiveAnswer | null>((s, e) => applyLive(s, e).state, null)?.text;
    expect(text).toBe(redact('The reply with a trailing blank', '/nowhere'));
  });

  it('a failure ends the answer without publishing the unfinished text', () => {
    const live = make();
    live.begin(T, 7, 'me');
    live.sink(T, 7).piece('half a sent');
    live.end(T, 7, 'dropped');
    // What the devices already had stays unchanged until the end event drops it; nothing more of the unfinished word is published.
    expect(events.map((e) => ({ end: e.end, text: e.text }))).toEqual([{ end: undefined, text: 'half a' }, { end: true, text: '' }]);
    expect(live.read(T)).toEqual([]);
  });

  it('snapshot is what a Stop posts: the whole text, masked, with the last word', () => {
    const live = make();
    live.begin(T, 7, 'me');
    live.sink(T, 7).piece('so far and unfin');
    expect(live.snapshot(T, 7)).toBe('so far and unfin');
    expect(live.snapshot(T, 8)).toBe('');
    live.end(T, 7);
    expect(live.snapshot(T, 7)).toBe('');
  });

  it('reads what the devices hold: the text so far per answer of the thread, empty after the end', () => {
    const live = make();
    live.begin(T, 7, 'me');
    live.begin(T, 9, 'me');
    live.begin('agent-other', 1, 'other');
    live.sink(T, 7).piece('first answer going ');
    advance(200);
    expect(live.read(T)).toEqual([
      { thread: T, to: 7, agent: 'me', rev: 1, text: 'first answer going' },
      { thread: T, to: 9, agent: 'me', rev: 0, text: '' },
    ]);
    expect(live.active()).toBe(true);
    live.end(T, 7);
    live.end(T, 9);
    live.end('agent-other', 1);
    expect(live.read(T)).toEqual([]);
    expect(live.active()).toBe(false);
  });

  it('ignores a sink whose answer has ended, and an answer that was never begun', () => {
    const live = make();
    const sink = live.sink(T, 7);
    sink.piece('nobody listens ');
    sink.restart();
    sink.settle('nor here');
    live.end(T, 7);
    expect(events).toEqual([]);
  });
});

describe('the client assembly', () => {
  const ev = (rev: number, offset: number, text: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({ thread: T, to: 7, agent: 'me', rev, offset, text, ...extra });
  const at = (rev: number, text: string): LiveAnswer => ({ thread: T, to: 7, agent: 'me', rev, text });

  it('applies the events in order', () => {
    let state: LiveAnswer | null = null;
    for (const e of [ev(1, 0, 'Hello'), ev(2, 5, ' there'), ev(3, 11, ', friend')]) {
      const r = applyLive(state, e);
      expect(r.resync).toBe(false);
      state = r.state;
    }
    expect(state).toEqual(at(3, 'Hello there, friend'));
  });

  it('ignores an event it already has', () => {
    const r = applyLive(at(2, 'Hello there'), ev(2, 5, ' there'));
    expect(r).toEqual({ state: at(2, 'Hello there'), resync: false });
    expect(applyLive(at(3, 'x'), ev(1, 0, 'old')).state).toEqual(at(3, 'x'));
  });

  it('asks for a resync when it joined in the middle, skipped an event or the offset is past the text', () => {
    expect(applyLive(null, ev(4, 20, ' more'))).toEqual({ state: null, resync: true });
    expect(applyLive(at(2, 'Hello there'), ev(4, 11, ' more'))).toEqual({ state: at(2, 'Hello there'), resync: true });
    expect(applyLive(at(2, 'Hello there'), ev(3, 40, ' more'))).toEqual({ state: at(2, 'Hello there'), resync: true });
    expect(applyLive(at(2, 'Hello there'), ev(3, 3, ' more')).resync).toBe(true);
  });

  it('takes a replacement whatever came before it, even one that skipped revisions', () => {
    expect(applyLive(at(2, 'Hello there'), ev(5, 0, 'Fresh start')).state).toEqual(at(5, 'Fresh start'));
    expect(applyLive(null, ev(9, 0, 'Whole text')).state).toEqual(at(9, 'Whole text'));
  });

  it('drops the answer on end', () => {
    expect(applyLive(at(2, 'Hello there'), ev(3, 0, '', { end: true }))).toEqual({ state: null, resync: false });
  });

  it('takes a read only when it is newer than what it holds', () => {
    expect(applyRead(null, at(3, 'abc'))).toEqual(at(3, 'abc'));
    expect(applyRead(at(5, 'newer'), at(3, 'abc'))).toEqual(at(5, 'newer'));
    expect(applyRead(at(2, 'old'), at(3, 'abc'))).toEqual(at(3, 'abc'));
  });

  it('a device that connects after the third piece shows the first three and then the rest', () => {
    const live = make();
    live.begin(T, 7, 'me');
    const sink = live.sink(T, 7);
    let late: LiveAnswer | null = null;
    ['alpha ', 'beta ', 'gamma ', 'delta ', 'epsilon.'].forEach((piece, i) => {
      sink.piece(piece);
      advance(LIVE_THROTTLE_MS + 1);
      if (i === 2) {
        // It connects now: it reads what was written, and listens from there.
        late = live.read(T)[0];
        events = [];
      }
    });
    live.end(T, 7);
    expect(late).toMatchObject({ text: 'alpha beta gamma' });
    let state: LiveAnswer | null = late;
    for (const e of events.filter((x) => !x.end)) {
      const r = applyLive(state, e);
      expect(r.resync).toBe(false);
      state = r.state;
    }
    expect(state?.text).toBe('alpha beta gamma delta epsilon.');
    expect(events.at(-1)?.end).toBe(true);
  });

  it('hides a value the answer must never show (a secret the persona read), before the redaction, in the text it publishes and in the snapshot a Stop posts', () => {
    const live = make();
    live.begin(T, 9, 'me', (text) => text.split('hunter2-secret').join('[secret]'));
    const sink = live.sink(T, 9);
    sink.piece('The key is hunter2-secret and ');
    sink.piece('that is all.');
    advance(LIVE_THROTTLE_MS + 1);
    expect(live.snapshot(T, 9)).toBe('The key is [secret] and that is all.');
    sink.settle('The key is hunter2-secret and that is all.');
    expect(assembled()).toBe('The key is [secret] and that is all.');
    expect(JSON.stringify(events)).not.toContain('hunter2');
    // an answer begun without a mask is published as before
    live.begin(T, 10, 'me');
    live.sink(T, 10).settle('hunter2-secret');
    expect(live.snapshot(T, 10)).toBe('hunter2-secret');
  });
});
