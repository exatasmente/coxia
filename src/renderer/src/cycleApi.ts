import { useSyncExternalStore } from 'react';
import { CONFIG_EVENT } from '../../shared/configView';
import { CYCLE_EVENT } from '../../shared/cycles/events';
import type { CycleView } from '../../shared/cycles/view';
import type { ApplyOptions, TemplateCheck } from '../../shared/cycles/apply';
import type { DestinationLabels } from '../../shared/destination';
import { t } from '../../shared/i18n';
import type { TemplateSummary } from '../../shared/cycles/types';
import { api, moduleEvents } from './api';
import { applyTerms } from './i18n';

export const cycleApi = {
  view: () => api.invoke<CycleView>('cycle:view'),
  templates: () => api.invoke<TemplateSummary[]>('cycle:templates'),
  apply: (id: string, options?: ApplyOptions) => api.invoke<CycleView>('cycle:apply', id, options),
  exportTemplate: (meta: { id: string; name: string; description?: string }) => api.invoke<{ text: string; filename: string }>('cycle:template-export', meta),
  checkTemplate: (text: string) => api.invoke<TemplateCheck>('cycle:template-check', text),
  saveTemplate: (text: string) => api.invoke<TemplateSummary>('cycle:template-save', text),
  removeTemplate: (id: string) => api.invoke<TemplateSummary[]>('cycle:template-remove', id),
  pickTemplate: () => api.invoke<string | null>('cycle:template-pick'),
};

// The cycle as the app last knew it: loaded once, kept current by the `cycle` event (a template was applied) and the `config` event (the
// configuration was saved or imported anywhere, which may have changed the ceremonies, stages or the name of the person).
let state: CycleView | null = null;
let started = false;
const subscribers = new Set<() => void>();

function set(next: CycleView): void {
  state = next;
  applyTerms(next.terms);
  for (const fn of subscribers) fn();
}

function reload(): void {
  void cycleApi.view().then(set, () => undefined);
}

function start(): void {
  if (started) return;
  started = true;
  moduleEvents.addEventListener(CYCLE_EVENT, (e) => set((e as CustomEvent<CycleView>).detail));
  moduleEvents.addEventListener(CONFIG_EVENT, reload);
  reload();
}

/** Loads the cycle (and with it the workspace's terms) at start, for the screens that do not read the cycle themselves. */
export function startCycle(): void {
  start();
}

/** The words a decision's destination is written with, before the cycle has loaded as well as after. */
export function destinationLabels(cycle: CycleView | null): DestinationLabels {
  return cycle?.destination ?? { heading: '', noteTool: null, noteFallback: t('cycle.noteFallback'), minutes: t('cycle.minutes') };
}

/** The development cycle of the workspace: which ceremonies to show, the stages, how to greet the person. Null until the first load. */
export function useCycle(): CycleView | null {
  start();
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state,
  );
}
