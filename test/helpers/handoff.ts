import { vi } from 'vitest';
import { createScreenAsks } from '../../src/main/browser/asks';
import { type BeginInput, type CallHandoff, type HandoffService, createHandoffService } from '../../src/main/screen/handoff';
import type { IntervalEnd, IntervalListener, ScreenHub } from '../../src/main/screen/hub';

// The hand-off service of the app over a hub that is only a list of what was asked of it: a test of a call path (a stage, an answer, the tools) needs to see what the call
// object was begun with, to take the screen and give it back, and to say what the person typed, without a display. The service is the real one.

export interface FakeHandoff {
  service: HandoffService;
  /** What every `begin` was given, in order. */
  begun: BeginInput[];
  /** The call objects it made, in order. */
  calls: CallHandoff[];
  /** The hub the service talks to. */
  hub: Pick<ScreenHub, 'state' | 'beginInterval' | 'endInterval' | 'control' | 'held'>;
  /** The asks the service listed (the card), by screen. */
  asks: ReturnType<typeof createScreenAsks>;
  /** The lines the service wrote in threads. */
  lines: { thread: string; stage: string; code: string; params: Record<string, string> }[];
  /** What the person types in the interval that is open now; `endInterval` hands it over. */
  typed: string[];
  /** Whether the hub has the screen (a request on a screen the hub does not have is `unavailable`). */
  live: boolean;
  /** How many stops of the call's clocks are in force now. */
  paused: number;
  /** Takes the screen of the one request that is open on the key: the person's click. */
  take(key: string): Promise<unknown>;
  /** Gives it back. */
  give(key: string): unknown;
}

export function fakeHandoff(o: { masks?: Parameters<typeof createHandoffService>[0]['masks']; step?: Parameters<typeof createHandoffService>[0]['step'] } = {}): FakeHandoff {
  const begun: BeginInput[] = [];
  const calls: CallHandoff[] = [];
  const lines: FakeHandoff['lines'] = [];
  const intervals = new Map<string, IntervalListener>();
  const state = { typed: [] as string[], live: true, paused: 0 };
  const hub = {
    state: vi.fn(() => (state.live ? ({} as never) : null)),
    beginInterval: vi.fn((key: string, on: IntervalListener) => {
      intervals.set(key, on);
      return true;
    }),
    endInterval: vi.fn((key: string, why: IntervalEnd['why']) => {
      const on = intervals.get(key);
      if (!on) return;
      intervals.delete(key);
      const typed = state.typed;
      state.typed = [];
      on.end({ from: 1_000, to: 2_000, typed, why });
    }),
    control: vi.fn(async () => ({ ok: true as const })),
    held: vi.fn((key: string) => intervals.has(key)),
  } as unknown as FakeHandoff['hub'];
  const asks = createScreenAsks({ changed: () => undefined, audit: () => undefined });
  const inner = createHandoffService({ hub, asks, say: (thread, stage, code, params) => void lines.push({ thread, stage, code, params }), ...(o.masks ? { masks: o.masks } : {}), ...(o.step ? { step: o.step } : {}) });
  const service: HandoffService = {
    ...inner,
    begin(input) {
      begun.push(input);
      // The clocks of the call are counted: a stop in force is one that was asked and not yet let go.
      const call = inner.begin({
        ...input,
        pause: () => {
          state.paused++;
          const resume = input.pause();
          let done = false;
          return () => {
            if (!done) state.paused--;
            done = true;
            resume();
          };
        },
      });
      calls.push(call);
      return call;
    },
  };
  const self: FakeHandoff = {
    service,
    begun,
    calls,
    hub,
    asks,
    lines,
    get typed() {
      return state.typed;
    },
    set typed(v: string[]) {
      state.typed = v;
    },
    get paused() {
      return state.paused;
    },
    get live() {
      return state.live;
    },
    set live(v: boolean) {
      state.live = v;
    },
    take: async (key) => {
      const ask = asks.list(key).find((a) => a.kind === 'handoff');
      if (!ask) throw new Error(`no hand-off is asked on ${key}`);
      return service.take(key, ask.id);
    },
    give: (key) => service.give(key),
  };
  return self;
}
