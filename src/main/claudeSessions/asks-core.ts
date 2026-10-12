import { randomUUID } from 'node:crypto';
import type { Through } from '../../shared/auditoria';
import { type ClaudeAnswerResult, type PendingClaudePermission, type PermissionDecision, isPermissionDecision } from '../../shared/claudeSessions';

// The permission requests of the Claude Code sessions the app drives, modelled on the turn-limit questions (turnAsks-core.ts): they wait in memory with no timer, one entry per
// request, and end by the person's answer or by the turn being stopped (the SDK's signal), which denies. Only the window answers: a paired browser and the persona are refused
// here as well as by the phone's policy and the persona's door table, so a request is never decided by anybody but the person at the computer.

export interface ClaudeAskDeps {
  changed(list: PendingClaudePermission[]): void;
  /** An answer, written to the audit log once. Not called for a request that ended with the turn. */
  audit?(a: PendingClaudePermission, decision: PermissionDecision, through: Through): void;
  now?(): Date;
  newId?(): string;
}

export interface ClaudeAskOutcome {
  decision: PermissionDecision;
  by: 'person' | 'abort';
}

export interface ClaudeAsks {
  ask(input: Omit<PendingClaudePermission, 'id' | 'since'>, signal?: AbortSignal): Promise<ClaudeAskOutcome>;
  list(): PendingClaudePermission[];
  /** Refuses any door but the window, and a request that no longer waits. Never applies an answer twice. */
  answer(id: string, decision: unknown, through: Through): ClaudeAnswerResult;
  /** Ends every request of a session (its process ended): each one is denied, unaudited. */
  dropSession(sessionId: string): void;
}

function tell(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('[claude-sessions]', e instanceof Error ? e.message : e);
  }
}

export function createClaudeAsks(d: ClaudeAskDeps): ClaudeAsks {
  const waiting = new Map<string, { item: PendingClaudePermission; finish: (o: ClaudeAskOutcome) => void }>();
  const publish = (): void => tell(() => d.changed([...waiting.values()].map((w) => w.item)));

  return {
    ask(input, signal) {
      if (signal?.aborted) return Promise.resolve({ decision: 'deny', by: 'abort' });
      return new Promise((resolve) => {
        const item: PendingClaudePermission = { ...input, id: d.newId?.() ?? randomUUID(), since: (d.now?.() ?? new Date()).toISOString() };
        const finish = (o: ClaudeAskOutcome): void => {
          if (!waiting.delete(item.id)) return;
          signal?.removeEventListener('abort', stopped);
          publish();
          resolve(o);
        };
        const stopped = (): void => finish({ decision: 'deny', by: 'abort' });
        signal?.addEventListener('abort', stopped, { once: true });
        waiting.set(item.id, { item, finish });
        publish();
      });
    },
    list: () => [...waiting.values()].map((w) => w.item),
    answer(id, decision, through) {
      const w = waiting.get(id);
      if (!w) return { ok: false, reason: 'gone' };
      if (through !== 'window') return { ok: false, reason: 'door' };
      if (!isPermissionDecision(decision)) return { ok: false, reason: 'decision' };
      tell(() => d.audit?.(w.item, decision, through));
      w.finish({ decision, by: 'person' });
      return { ok: true };
    },
    dropSession(sessionId) {
      for (const w of [...waiting.values()]) if (w.item.sessionId === sessionId) w.finish({ decision: 'deny', by: 'abort' });
    },
  };
}
