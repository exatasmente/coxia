import type { ForumMessage } from '../../shared/forum';
import { t } from '../../shared/i18n';
import type { Schedule } from '../../shared/schedules';
import type { DirectResult, DirectRunner } from './fire';

// The direct actions of a schedule (#250): a run of the cycle and a ceremony, taken with no model deciding what to do. Each one is the persona door's own operation, called by
// the app inside an act of the `schedule` door: the same channel and handler as the persona's and the person's, the same policy, the same audit line (which records the door),
// the same line in the conversation. The list of operations is fixed here; a schedule reaches nothing else, so it gains no permission of its own.

/** The door operation a direct action is, and nothing more: what the door is called with, under an act of the `schedule` door. */
export type DoorCall = (s: Schedule, message: ForumMessage, tool: 'Runs' | 'Ceremonies', input: Record<string, unknown>) => Promise<string>;

export interface DirectDeps {
  call: DoorCall;
  /** The direct ceremonies on in the workspace now: one that is no longer there fails the firing. */
  ceremonies(): readonly string[];
}

/** The id of a proposal waiting in Actions, when the operation answered with one: what the schedule then waits for. */
export function pendingActionOf(answer: string): string | null {
  try {
    const v = JSON.parse(answer) as { id?: unknown; state?: unknown; kind?: unknown } | null;
    return v && typeof v === 'object' && v.state === 'pending' && typeof v.id === 'string' && typeof v.kind === 'string' ? v.id : null;
  } catch {
    return null;
  }
}

export function createDirectRunner(deps: DirectDeps): DirectRunner {
  return {
    async run(s, message): Promise<DirectResult> {
      const a = s.action;
      const why = t('main.schedules.why', { id: s.id });
      let answer: string;
      if (a.kind === 'run') answer = await deps.call(s, message, 'Runs', { op: 'start', ref: a.ref, ...(a.repo ? { repo: a.repo } : {}), why });
      else if (a.kind === 'ceremony') {
        // Checked at the firing, not only when the schedule was made: a ceremony turned off since then is a failure said in the conversation.
        if (a.ceremony !== 'retro' || !deps.ceremonies().includes(a.ceremony)) throw new Error(t('main.schedules.error.ceremony'));
        answer = await deps.call(s, message, 'Ceremonies', { op: 'retroPrepare', ...(a.squad ? { squad: a.squad } : {}), why });
      } else {
        // i18n-ignore: developer error: the firer gives only the direct actions to this runner
        throw new Error(`not a direct action: ${a.kind}`);
      }
      const pending = pendingActionOf(answer);
      // The door's answer is for a model to read (the run, the retro as data): the conversation says the action is done, and its own act line says what was touched.
      return pending ? { state: 'awaiting', actionId: pending } : { state: 'done', detail: '' };
    },
  };
}
