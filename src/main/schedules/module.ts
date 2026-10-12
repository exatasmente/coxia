import { join } from 'node:path';
import { mentionJob } from '../../shared/activity';
import { personaOf } from '../../shared/config/team';
import { t } from '../../shared/i18n';
import { DIRECT_CEREMONIES, type Schedule, type ScheduleInput, type SchedulePatch, SCHEDULE_DOOR } from '../../shared/schedules';
import { type SystemRoutine, systemRoutines } from '../../shared/systemRoutines';
import { listActions, onActionDone, onActionRefused, onActionSkipped } from '../actions';
import { activityLog } from '../activity';
import { getSettings } from '../config';
import { cycleOn } from '../cycle-core';
import { ATAS } from '../env';
import { forumStore } from '../forum';
import { wakePersona } from '../mentions/module';
import type { Module } from '../module';
import { openAct } from '../persona/act';
import { personaDoor } from '../persona/door';
import { createSession } from '../persona/session';
import { getConfig, rc } from '../workspaceConfig';
import { type ScheduleWorld, ScheduleError } from './core';
import { createDirectRunner } from './direct';
import { createFirer } from './fire';
import { createScheduleService } from './service';
import { createScheduleStore } from './store';

// The schedules of the workspace (#275, #250): the channels the screen and the persona's tools use, and the job on the app's own clock that fires them. The person and the persona
// manage the same list; a turn a schedule started cannot make another schedule, so a schedule never multiplies itself.

/** Who is changing a schedule: the persona inside its act, the person otherwise (the window or a paired browser). */
const who = (): string => (openAct() ? (personaOf(getConfig().agents.team)?.id ?? 'persona') : 'user');

/** An issue or card the runner starts a run for: the number, with or without the workspace's prefix, as the runner reads it. */
function isRunRef(ref: string): boolean {
  const prefix = rc().issues.refPrefix;
  const bare = prefix && ref.startsWith(prefix) ? ref.slice(prefix.length) : ref;
  return /^\d{1,9}$/.test(bare) && Number(bare) >= 1;
}

const directCeremonies = (): string[] => DIRECT_CEREMONIES.filter((id) => cycleOn(id));

const world = (): ScheduleWorld => {
  const team = getConfig().agents.team;
  const persona = personaOf(team)?.id ?? null;
  return {
    persona,
    hasThread: (id) => forumStore().summary(id) !== null,
    now: new Date(),
    agents: team.map((a) => a.id).filter((id) => id !== persona),
    ceremonies: directCeremonies(),
    isRef: isRunRef,
  };
};

const workdays = (): readonly number[] => getSettings().schedule.days;

/** The words of a schedule's action, for its lines and its node in the activity tree. */
function describe(s: Schedule): string {
  const a = s.action;
  if (a.kind === 'run') return t('main.schedules.action.run', { ref: a.ref });
  if (a.kind === 'ceremony') return t('main.schedules.action.ceremony', { ceremony: t(`main.schedules.ceremony.${a.ceremony}`) });
  if (a.kind === 'agent') return t('main.schedules.action.agent', { agent: getConfig().agents.team.find((x) => x.id === a.agent)?.name ?? a.agent, prompt: a.prompt });
  return a.prompt;
}

/** The app's own timed jobs, read from the settings that set them. */
export function routines(): SystemRoutine[] {
  const s = getSettings();
  return systemRoutines(s.schedule, { notifications: s.notifications, preDaily: cycleOn('preDaily'), retro: cycleOn('retro') });
}

/** A schedule's error in the words of the catalog; anything else as it came. */
function worded(e: unknown): Error {
  return e instanceof ScheduleError ? new Error(t(`main.schedules.error.${e.code}`)) : e instanceof Error ? e : new Error(String(e));
}

const guarded = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw worded(e);
  }
};

/** A turn a schedule woke may read and remove schedules, never make or change one. */
function refuseFromSchedule(): void {
  if (openAct()?.door === SCHEDULE_DOOR) throw new ScheduleError('fromSchedule');
}

export const schedulesModule: Module = (ctx) => {
  const store = createScheduleStore(join(ATAS, 'schedules.json'));
  // A direct action is the persona door's own operation, in an act of the `schedule` door: what the persona may not do, the schedule may not either.
  const direct = createDirectRunner({
    call: (s, message, tool, input) => personaDoor.run(createSession({ persona: s.persona, thread: s.thread, seq: message.seq, door: SCHEDULE_DOOR }), tool, input),
    ceremonies: directCeremonies,
  });
  const firer = createFirer({
    store,
    forum: forumStore(),
    wake: wakePersona,
    direct,
    describe,
    activity: (s, label) => {
      const node = activityLog.begin(s.persona, { jobId: mentionJob(s.thread), node: { type: 'schedule', label, schedule: s.id } });
      return { status: (state, detail) => node.status(state, detail), awaitingApproval: () => node.awaitingApproval() };
    },
    now: () => new Date(),
    workdays,
  });
  const service = createScheduleService({ store, firer, now: () => new Date() });
  const changed = (): void => ctx.emit({ type: 'module', name: 'schedules:changed', payload: service.view() });

  // The wait of a direct action ends with its proposal: carried out, refused, or set aside by the person.
  const settled = (id: string, outcome: Parameters<typeof firer.settle>[1]): void => {
    if (firer.settle(id, outcome)) changed();
  };
  onActionDone((a) => settled(a.id, { ok: true }));
  onActionRefused((a, reason) => settled(a.id, { ok: false, reason }));
  onActionSkipped((a) => settled(a.id, { ok: false, reason: t('main.schedules.setAside') }));
  // A proposal handled while the app was closed: the wait it held ends now, said as the proposal ended.
  try {
    const actions = listActions();
    for (const s of store.list()) {
      if (!s.waiting) continue;
      const a = actions.find((x) => x.id === s.waiting?.actionId);
      // A failed proposal is still the person's to retry or set aside in Actions, as it is while the app runs.
      if (a?.state === 'pending' || a?.state === 'running' || a?.state === 'failed') continue;
      firer.settle(s.waiting.actionId, a?.state === 'done' ? { ok: true } : { ok: false, reason: t('main.schedules.setAside') });
    }
  } catch (e) {
    console.error('[schedules] could not read the waits', e instanceof Error ? e.message : e);
  }

  // Every minute, whatever the hours of work: a schedule says its own days.
  ctx.job({
    name: 'schedules',
    everyMin: 1,
    workHoursOnly: false,
    enabled: () => service.enabled(),
    run: async () => {
      // The firings run beside the clock: a long turn does not hold the next tick, and the list on screen follows the times they set.
      void service.tick().finally(changed);
    },
  });

  ctx.handle('schedules:list', () => service.view());
  ctx.handle('schedules:routines', () => routines());
  ctx.handle('schedules:create', (input: ScheduleInput) =>
    guarded(() => {
      refuseFromSchedule();
      // The persona's schedule answers in the conversation it was asked in, unless it names another.
      const act = openAct();
      const made: Schedule = store.create({ ...input, thread: input?.thread || act?.thread || '' }, who(), world(), workdays());
      changed();
      return made;
    }),
  );
  ctx.handle('schedules:update', (id: string, patch: SchedulePatch) =>
    guarded(() => {
      refuseFromSchedule();
      const next = store.update(id, patch, who(), world(), workdays());
      changed();
      return next;
    }),
  );
  ctx.handle('schedules:remove', (id: string) =>
    guarded(() => {
      // A wait ends with its schedule: said in the conversation, and its node in the activity closed.
      const waiting = store.get(id)?.waiting;
      if (waiting) firer.settle(waiting.actionId, { ok: false, reason: t('main.schedules.removed') });
      if (!store.remove(id)) throw new ScheduleError('notFound');
      changed();
      return true;
    }),
  );
  // The person's answer to the question at the start, or the switch of the screen; the persona has no operation for it.
  // Turning it on fires what was missed at once; the answer does not wait for those turns.
  ctx.handle('schedules:setEnabled', (on: boolean) => {
    void service.setEnabled(on === true).finally(changed);
    return service.view();
  });
};
