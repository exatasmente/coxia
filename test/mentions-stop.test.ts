// The registry that lets the person stop one answer of an agent in a conversation (rule 16 of #177): the screen is not touched, only the call's abort.
import { describe, expect, it } from 'vitest';
import { createCallStops } from '../src/main/mentions/stop';

describe('stopping a call', () => {
  it('aborts every running call of the agent in the thread, and none of another agent or thread', () => {
    const stops = createCallStops();
    const a = new AbortController();
    const b = new AbortController();
    const other = new AbortController();
    const elsewhere = new AbortController();
    stops.register('general', 'dev', a);
    stops.register('general', 'dev', b);
    stops.register('general', 'ops', other);
    stops.register('squad-web', 'dev', elsewhere);
    expect(stops.stop('general', 'dev')).toBe(true);
    expect([a.signal.aborted, b.signal.aborted, other.signal.aborted, elsewhere.signal.aborted]).toEqual([true, true, false, false]);
  });

  it('forgets a call when it ends, so a later Stop finds nothing', () => {
    const stops = createCallStops();
    const a = new AbortController();
    const done = stops.register('general', 'dev', a);
    expect(stops.running()).toEqual([{ thread: 'general', agent: 'dev' }]);
    done();
    done();
    expect(stops.running()).toEqual([]);
    expect(stops.stop('general', 'dev')).toBe(false);
    expect(a.signal.aborted).toBe(false);
  });

  it('keeps a call that is still running when another of the same agent ends', () => {
    const stops = createCallStops();
    const first = new AbortController();
    const second = new AbortController();
    const endFirst = stops.register('t', 'dev', first);
    stops.register('t', 'dev', second);
    endFirst();
    expect(stops.running('t')).toEqual([{ thread: 't', agent: 'dev' }]);
    expect(stops.stop('t', 'dev')).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(first.signal.aborted).toBe(false);
  });

  it('lists the running calls of one thread', () => {
    const stops = createCallStops();
    stops.register('t1', 'a', new AbortController());
    stops.register('t2', 'b', new AbortController());
    expect(stops.running('t2')).toEqual([{ thread: 't2', agent: 'b' }]);
    expect(stops.running()).toHaveLength(2);
  });
});
