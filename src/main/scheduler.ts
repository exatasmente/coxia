import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppEvent, Card } from '../shared/types';
import { t } from '../shared/i18n';
import { detectRelease } from './actions';
import { loadCards } from './cards';
import { getSettings } from './config';
import { ceremonyLabel } from './cyclePrompts';
import { cycleOn } from './cycle-core';
import { ATAS } from './env';
import type { Job } from './module';
import { knownTask, track } from './saude';
import { rc } from './workspaceConfig';

interface Snapshot {
  checkedAt: string | null;
  items: Record<string, { stage: string | null; blockers: string[] }>;
  preDailyNotified: string | null;
  retroNotified?: string | null;
}

export interface Notice {
  title: string;
  body: string;
  onClick: AppEvent;
}

interface Deps {
  notify(n: Notice): void;
  emit(ev: AppEvent): void;
}

const FILE = join(ATAS, 'status.json');
const TICK_MS = 60_000;
const PRE_DAILY_WINDOW_MIN = 30;

function read(): Snapshot {
  try {
    if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, 'utf8')) as Snapshot;
  } catch {}
  return { checkedAt: null, items: {}, preDailyNotified: null };
}

function write(s: Snapshot): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s));
  renameSync(`${FILE}.tmp`, FILE);
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function today(): string {
  return new Date().toLocaleDateString('sv-SE');
}

let deps: Deps | null = null;
const jobs: Job[] = [];
const lastRun = new Map<string, number>();

export function registerJob(job: Job): void {
  jobs.push(job);
  knownTask(job.name, job.everyMin);
}
let running = false;

export async function checkStatus(manual: boolean): Promise<string> {
  if (running) return 'Já estou conferindo o status.';
  running = true;
  try {
    const snap = read();
    const firstRun = !snap.checkedAt;
    const result = await loadCards(100);
    const fresh: { card: Card; blocker: string }[] = [];
    const moved: { card: Card; from: string | null }[] = [];
    for (const card of result.cards) {
      const prev = snap.items[card.ref];
      if (firstRun) continue;
      for (const b of card.blockers) if (!prev?.blockers.includes(b)) fresh.push({ card, blocker: b });
      if (prev && prev.stage !== card.stage) moved.push({ card, from: prev.stage });
    }
    const since = snap.checkedAt ? new Date(snap.checkedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
    write({
      ...snap,
      checkedAt: new Date().toISOString(),
      items: Object.fromEntries(result.cards.map((c) => [c.ref, { stage: c.stage, blockers: c.blockers }])),
    });
    deps?.emit({ type: 'status', result, checkedAt: new Date().toISOString() });

    const notify = getSettings().notifications ? deps?.notify : undefined;
    if (fresh.length === 1) {
      const { card, blocker } = fresh[0];
      notify?.({ title: `Bloqueio novo na #${card.iid}`, body: `${blocker}\nClique para abrir um desbloqueio.`, onClick: { type: 'deep', card } });
      return `Bloqueio novo na #${card.iid}: ${blocker}`;
    }
    if (fresh.length > 1) {
      const refs = [...new Set(fresh.map((f) => `#${f.card.iid}`))].join(', ');
      notify?.({ title: `${fresh.length} bloqueios novos`, body: `${refs}\nClique para ver as atividades.`, onClick: { type: 'navigate', to: 'today' } });
      return `${fresh.length} bloqueios novos: ${refs}`;
    }
    if (moved.length) {
      const body = moved.map((m) => `#${m.card.iid}: ${m.from ?? 'sem estágio'} → ${m.card.stage ?? 'sem estágio'}`).join('\n');
      notify?.({ title: 'Status das atividades mudou', body, onClick: { type: 'navigate', to: 'today' } });
      return body;
    }
    const summary = firstRun ? `Status registrado: ${result.total} atividades acompanhadas.` : `Nada mudou${since ? ` desde ${since}` : ''}.`;
    if (manual) notify?.({ title: 'Status das atividades', body: summary, onClick: { type: 'navigate', to: 'today' } });
    return summary;
  } finally {
    running = false;
  }
}

function tick(): void {
  const s = getSettings();
  const now = new Date();
  const workday = s.schedule.days.includes(now.getDay());
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const snap = read();

  const pre = minutes(s.schedule.preDaily);
  if (cycleOn('preDaily') && workday && s.notifications && snap.preDailyNotified !== today() && nowMin >= pre && nowMin < pre + PRE_DAILY_WINDOW_MIN) {
    write({ ...snap, preDailyNotified: today() });
    deps?.notify({ title: t('cycle.notice.preDailyTitle', { ceremony: ceremonyLabel() }), body: t('cycle.notice.preDailyBody'), onClick: { type: 'navigate', to: 'call' } });
  }

  const retro = minutes(s.schedule.retroTime);
  if (cycleOn('retro') && s.notifications && now.getDay() === s.schedule.retroDay && snap.retroNotified !== today() && nowMin >= retro && nowMin < retro + PRE_DAILY_WINDOW_MIN) {
    write({ ...read(), retroNotified: today() });
    deps?.notify({ title: t('cycle.notice.retroTitle'), body: t('cycle.notice.retroBody'), onClick: { type: 'navigate', to: 'retro' } });
  }

  const inWindow = nowMin >= minutes(s.schedule.from) && nowMin <= minutes(s.schedule.to);
  const due = !snap.checkedAt || Date.now() - new Date(snap.checkedAt).getTime() >= s.schedule.statusEveryMin * 60_000;
  for (const job of jobs) {
    if (job.workHoursOnly && !(workday && inWindow)) continue;
    if (job.enabled && !job.enabled()) continue;
    if (Date.now() - (lastRun.get(job.name) ?? 0) < job.everyMin * 60_000) continue;
    lastRun.set(job.name, Date.now());
    void track(job.name, () => job.run()).catch((e) => console.error(`[job ${job.name}]`, e));
  }

  if (workday && inWindow && due) {
    if (rc().cardSource) void track('status', () => checkStatus(false)).catch((e) => console.error('[scheduler]', e));
    if (rc().releaseSync && cycleOn('releaseConflicts')) void track('release', () => detectRelease(false)).catch((e) => console.error('[release]', e));
  }
}

export function startScheduler(d: Deps): void {
  deps = d;
  knownTask('status', getSettings().schedule.statusEveryMin);
  knownTask('release', getSettings().schedule.statusEveryMin);
  setTimeout(tick, 15_000);
  setInterval(tick, TICK_MS);
}
