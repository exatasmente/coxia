import { type PendingTurnAsk, type TurnAnswerer, type TurnDecision, TURN_ASKS_EVENT, isTurnDecision } from '../shared/turnLimit';
import { t } from '../shared/i18n';
import type { AppEvent } from '../shared/types';
import { recordWrite } from './auditoria';
import type { Module } from './module';
import { callOrigin } from './rpc';
import type { Notice } from './scheduler';
import { TurnAskGone, createTurnAsks } from './turnAsks-core';
import { getConfig } from './workspaceConfig';

// The questions at a turn limit: the store the engine's asker files them in, the two channels the screens answer through, the audit line and the notification. A paired browser
// may answer too (webPolicy.ts): continuing spends the person's budget on work the agent was already allowed to do, and opens no tool, host or file it did not have.

let emit: ((ev: AppEvent) => void) | null = null;
let notify: ((n: Notice) => void) | null = null;

const event = (list: PendingTurnAsk[]): AppEvent => ({ type: 'module', name: TURN_ASKS_EVENT, payload: list });

/** Where a notification opens: the run, else the conversation, else today. */
function openOf(a: PendingTurnAsk): AppEvent {
  if (a.run) return { type: 'open', screen: { name: 'run', id: a.run } };
  if (a.thread) return { type: 'open', screen: { name: 'forum', thread: a.thread } };
  return { type: 'navigate', to: 'today' };
}

export const turnAsks = createTurnAsks({
  changed: (list) => emit?.(event(list)),
  asked: (a) => {
    if (!getConfig().notifications) return;
    notify?.({ title: t('main.turnAsk.notice.title', { agent: a.name }), body: t(a.of === 'stage' ? 'main.turnAsk.notice.body.stage' : 'main.turnAsk.notice.body.sub', { used: a.used, round: a.round, task: a.task.slice(0, 120) }), onClick: openOf(a) });
  },
  // Said by the answer only: no task text, and nothing for a question that ended with the work.
  audit: (a, decision, through) =>
    recordWrite({
      kind: 'turn-limit',
      issue: a.issue ?? 0,
      target: `turns:${a.of}`,
      via: through,
      fields: { agent: a.agent, of: a.of, kind: a.kind ?? '', used: String(a.used), round: String(a.round), granted: String(a.granted), decision, through, run: a.run ?? '' },
      ok: true,
      code: null,
      result: '',
      origin: { actionId: '', kind: 'turn-limit', key: a.id, summary: null },
    }),
});

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export const register: Module = (ctx) => {
  emit = ctx.emit;
  notify = ctx.notify;
  ctx.handle('turnAsks:list', () => turnAsks.list());
  // The one call every answerer goes through. The origin is the door the call came in by; an agent that answers later is a third `through`, with no other change.
  ctx.handle('turnAsks:answer', (id: unknown, decision: unknown) => {
    if (!isTurnDecision(decision)) return { ok: false as const, reason: 'decision' as const };
    const through: TurnAnswerer = callOrigin() === 'web' ? 'paired' : 'window';
    try {
      return turnAsks.answer(text(id), decision as TurnDecision, through);
    } catch (e) {
      if (e instanceof TurnAskGone) return { ok: false as const, reason: 'gone' as const };
      throw e;
    }
  });
};
