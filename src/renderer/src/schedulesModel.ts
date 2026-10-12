// The words of the Schedules screen above the markup: what a schedule's action does, the state line of its last firing, and the app's own routines. DOM-free, so it is
// tested as plain functions; the React side is screens/Schedules.tsx.
import { t } from '../../shared/i18n';
import type { DirectCeremony, Schedule, ScheduleAction, ScheduleActionKind } from '../../shared/schedules';
import type { SystemRoutine, SystemRoutineId } from '../../shared/systemRoutines';

/** The name of each kind of action, as the form and the list say it. */
export const ACTION_LABEL: Record<ScheduleActionKind, string> = {
  persona: 'ui.schedules.action.persona',
  agent: 'ui.schedules.action.agent',
  run: 'ui.schedules.action.run',
  ceremony: 'ui.schedules.action.ceremony',
};

/** The name of each ceremony a schedule may run. */
export const CEREMONY_LABEL: Record<DirectCeremony, string> = { retro: 'ui.schedules.ceremony.retro' };

const ROUTINE_TITLE: Record<SystemRoutineId, string> = { preDaily: 'ui.schedules.system.preDaily', retro: 'ui.schedules.system.retro', workWindow: 'ui.schedules.system.workWindow' };

const ceremonyName = (id: string): string => (id in CEREMONY_LABEL ? t(CEREMONY_LABEL[id as DirectCeremony]) : id);

/** What a schedule's action does, in a line; `nameOf` gives an agent's name. */
export function describeAction(a: ScheduleAction, nameOf: (id: string) => string): string {
  if (a.kind === 'run') return t('ui.schedules.describe.run', { ref: a.ref });
  if (a.kind === 'ceremony') return t('ui.schedules.describe.ceremony', { ceremony: ceremonyName(a.ceremony) });
  if (a.kind === 'agent') return t('ui.schedules.describe.agent', { agent: nameOf(a.agent), prompt: a.prompt });
  return a.prompt;
}

/** The states of a schedule worth a word beside its times: a wait for approval, a skipped time, the last failure. */
export function scheduleNotes(s: Schedule, when: (iso: string | null) => string): string[] {
  const out: string[] = [];
  if (s.missed === 'skip') out.push(t('ui.schedules.missedSkip'));
  if (s.waiting) out.push(t('ui.schedules.waiting', { since: when(s.waiting.since) }));
  if (s.lastSkipped) out.push(t('ui.schedules.lastSkipped', { at: when(s.lastSkipped) }));
  // `thread` is the older error (the conversation is gone); anything else is a direct action that failed.
  if (s.lastError === 'thread') out.push(t('ui.schedules.lastError'));
  else if (s.lastError) out.push(t('ui.schedules.lastFailed', { reason: s.lastError }));
  return out;
}

/** One of the app's own routines in a line: what it is, when, and whether it is on. */
export function describeRoutine(r: SystemRoutine, dayName: (d: number) => string): { title: string; when: string; on: boolean } {
  const days = r.days.map(dayName).join(', ');
  const when = r.id === 'workWindow' ? t('ui.schedules.system.window', { from: r.from ?? '', to: r.to ?? '', days, every: r.everyMin ?? 0 }) : t('ui.schedules.system.at', { time: r.time ?? '', days });
  return { title: t(ROUTINE_TITLE[r.id]), when, on: r.on };
}
