import { randomUUID } from 'node:crypto';
import { type CeremonyCommand, type CeremonyDecision, CEREMONY_DECISIONS, isHostWrite, suggestRule } from '../shared/ceremonyCommands';

// The commands ceremony agents wait to run until the person answers. An agent of a ceremony runs a command the code allows and the rules the person gave it
// ("allow always"); anything else is asked here instead of refused: the agent's call waits, and the answer comes back as allowed or refused with a note. A
// request lives as long as the call that made it and ends as a refusal when nobody answers in time, so a ceremony queued from an offline phone never hangs.

export interface Answer {
  ok: boolean;
  note?: string;
}

export interface CommandStoreDeps {
  /** The list changed: the screens get it whole. */
  changed(list: CeremonyCommand[]): void;
  /** A new request: the person is told (notification, paired phone). */
  asked?(c: CeremonyCommand): void;
  /** "Allow always": the rule is added to the agent's list in the configuration. */
  remember(agent: string, rule: string): void;
  /** A command the person allowed, written to the audit log (allowed once or always). */
  audit?(c: CeremonyCommand, decision: CeremonyDecision): void;
  /** Writes to the code host are refused here (a test workspace): the reason, or null. */
  writeRefusal?(): string | null;
  now?(): Date;
  newId?(): string;
  /** How long a request waits for an answer before it is refused (ms). */
  timeoutMs?: number;
}

export interface CommandStore {
  /** Asks the person about one command of an agent; resolves with the answer. Aborting the signal refuses it. `name` is how the notice names an agent that is not a system one. */
  ask(agent: string, command: string, signal?: AbortSignal, name?: string): Promise<Answer>;
  list(): CeremonyCommand[];
  /** The person's answer. A write is never allowed always; a request that no longer waits is refused with an error. */
  answer(id: string, decision: CeremonyDecision, note?: string): CeremonyCommand;
}

export class CommandGone extends Error {
  constructor() {
    super('command-gone');
    this.name = 'CommandGone';
  }
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export function createCommandStore(d: CommandStoreDeps): CommandStore {
  const waiting = new Map<string, { item: CeremonyCommand; finish: (a: Answer) => void }>();
  const publish = (): void => d.changed([...waiting.values()].map((w) => w.item));

  return {
    ask(agent, command, signal, name) {
      const write = isHostWrite(command);
      const refusal = write ? (d.writeRefusal?.() ?? null) : null;
      if (refusal) return Promise.resolve({ ok: false, note: refusal });
      if (signal?.aborted) return Promise.resolve({ ok: false });
      return new Promise((resolve) => {
        const item: CeremonyCommand = { id: d.newId?.() ?? randomUUID(), agent, ...(name ? { name } : {}), command, write, rule: write ? null : suggestRule(command), since: (d.now?.() ?? new Date()).toISOString() };
        let timer: NodeJS.Timeout | undefined;
        const finish = (a: Answer): void => {
          if (!waiting.delete(item.id)) return;
          clearTimeout(timer);
          signal?.removeEventListener('abort', stopped);
          publish();
          resolve(a);
        };
        const stopped = (): void => finish({ ok: false });
        timer = setTimeout(() => finish({ ok: false, note: 'no answer in time' }), d.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        timer.unref?.();
        signal?.addEventListener('abort', stopped, { once: true });
        waiting.set(item.id, { item, finish });
        publish();
        d.asked?.(item);
      });
    },
    list: () => [...waiting.values()].map((w) => w.item),
    answer(id, decision, note = '') {
      const w = waiting.get(id);
      if (!w) throw new CommandGone();
      if (!CEREMONY_DECISIONS.includes(decision)) throw new Error(`unknown decision: ${String(decision).slice(0, 20)}`);
      // A write to the code host is allowed once at most: a rule would let every later one through without asking.
      const chosen: CeremonyDecision = decision === 'always' && (w.item.write || !w.item.rule) ? 'once' : decision;
      if (chosen === 'always' && w.item.rule) d.remember(w.item.agent, w.item.rule);
      if (chosen !== 'deny') d.audit?.(w.item, chosen);
      const said = note.trim().slice(0, 500);
      w.finish(chosen === 'deny' ? { ok: false, ...(said ? { note: said } : {}) } : { ok: true });
      return w.item;
    },
  };
}
