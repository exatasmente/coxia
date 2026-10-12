import type { Schedule, ScheduleInput, SchedulePatch, SchedulesView } from '../../shared/schedules';
import type { SystemRoutine } from '../../shared/systemRoutines';
import { api, moduleEvents } from './api';

export const schedulesApi = {
  list: () => api.invoke<SchedulesView>('schedules:list'),
  routines: () => api.invoke<SystemRoutine[]>('schedules:routines'),
  create: (input: ScheduleInput) => api.invoke<Schedule>('schedules:create', input),
  update: (id: string, patch: SchedulePatch) => api.invoke<Schedule>('schedules:update', id, patch),
  remove: (id: string) => api.invoke<boolean>('schedules:remove', id),
  setEnabled: (on: boolean) => api.invoke<SchedulesView>('schedules:setEnabled', on),
  onChanged(cb: (v: SchedulesView) => void): () => void {
    const h = (e: Event) => cb((e as CustomEvent<SchedulesView>).detail);
    moduleEvents.addEventListener('schedules:changed', h);
    return () => moduleEvents.removeEventListener('schedules:changed', h);
  },
};
