import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_KINDS, type CheckKind, type CheckSpec, type EffectEntry, type EfeitosView, WINDOW_DAYS, effectKey } from '../shared/efeitos';
import type { Card, Effect } from '../shared/types';
import { askAgent, obj, str, strOrNull } from './agents';
import { prompt as cp } from './cyclePrompts';
import { ATAS } from './env';
import { rc } from './workspaceConfig';
import type { Module } from './module';
import { getHistory, listHistory } from './state';
import { vcsProvider, vcsReady } from './vcs';
import { getTerms, t } from '../shared/i18n';

const FILE = join(ATAS, 'efeitos.json');
const DAY_MS = 86_400_000;
const PRUNE_MS = 30 * DAY_MS;
const MAX_CLASSIFY_PER_RUN = 8;
const MAX_CLASSIFY_TRIES = 3;
const PROJECT = /^[\w.-]+(\/[\w.-]+)+$/;
const NEEDS_IID = new Set<CheckKind>(CHECK_KINDS.filter((k) => !['issue_created', 'mr_created'].includes(k)));

interface Store {
  checkedAt: string | null;
  entries: Record<string, EffectEntry>;
}

interface Verdict {
  done: boolean;
  at?: string | null;
  evidence: string;
}

type Deps = Parameters<Module>[0];

let running = false;
let deps: Deps | null = null;

function read(): Store {
  try {
    if (existsSync(FILE)) return { checkedAt: null, entries: {}, ...(JSON.parse(readFileSync(FILE, 'utf8')) as Partial<Store>) };
  } catch {}
  return { checkedAt: null, entries: {} };
}

function write(s: Store): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${FILE}.tmp`, FILE);
}

// Every await in the job may overlap a manual mark: patch one entry on a fresh read instead of writing a stale copy.
function patch(key: string, change: (e: EffectEntry) => EffectEntry): void {
  const s = read();
  if (!s.entries[key]) return;
  s.entries[key] = change(s.entries[key]);
  write(s);
}

function emitView(): void {
  deps?.emit({ type: 'module', name: 'efeitos:changed', payload: view() });
}

export function view(): EfeitosView {
  const s = read();
  return { checkedAt: s.checkedAt, entries: s.entries };
}

function inWindow(since: string, now = Date.now()): boolean {
  return now - new Date(since).getTime() <= WINDOW_DAYS * DAY_MS;
}

// Brings the effects of the last 7 days of ceremonies into efeitos.json. The history files are only read.
export function syncFromHistory(now = Date.now()): number {
  const s = read();
  let added = 0;
  for (const h of listHistory()) {
    if (!h.effects) continue;
    const since = h.startedAt ? new Date(h.startedAt).toISOString() : `${h.date}T00:00:00.000Z`;
    if (!inWindow(since, now)) continue;
    const saved = getHistory(h.id);
    for (const e of saved?.effects ?? []) {
      const key = effectKey(e);
      const known = s.entries[key];
      if (known) {
        // Marked by hand in the Ata before the ceremony was saved: adopt the real ceremony and its time.
        if (!known.ceremonyId) s.entries[key] = { ...known, ceremonyId: h.id, since };
        continue;
      }
      s.entries[key] = fresh(e, key, h.id, since);
      added++;
    }
  }
  for (const [k, e] of Object.entries(s.entries)) if (now - new Date(e.since).getTime() > PRUNE_MS) delete s.entries[k];
  if (added || Object.keys(s.entries).length) write(s);
  return added;
}

function fresh(e: Effect, key: string, ceremonyId: string | null, since: string): EffectEntry {
  return {
    key,
    ceremonyId,
    ref: e.ref,
    text: e.text,
    repo: e.repo,
    since,
    classifyTries: 0,
    state: 'waiting',
    doneAt: null,
    evidence: null,
    manual: false,
    checkedAt: null,
    error: null,
  };
}

// ---------------------------------------------------------------- classification (one agent call per effect)

function classifyPrompt(entry: EffectEntry, card: Card | undefined): string {
  const issueIid = /#(\d+)$/.exec(entry.ref)?.[1] ?? null;
  return cp('effects.classify', {
    text: entry.text,
    ref: entry.ref,
    repo: String(entry.repo),
    issue: issueIid ? `#${issueIid}` : '',
    project: rc().issues.project ?? cp('effects.unconfigured'),
    mrs: JSON.stringify(card?.mrPaths ?? []),
    stage: card?.stage ?? cp('effects.unknownStage'),
    kinds: CHECK_KINDS.map((k) => `- ${k}: ${cp(`effects.kind.${k}`)}`).join('\n'),
  });
}

export function toSpec(o: { verificavel: boolean; tipo: string; projeto: string; iid: number | null; valor: string | null }): CheckSpec | null {
  const kind = CHECK_KINDS.find((k) => k === o.tipo);
  if (!o.verificavel || !kind || !PROJECT.test(o.projeto)) return null;
  if (NEEDS_IID.has(kind) && !(Number.isInteger(o.iid) && (o.iid as number) > 0)) return null;
  if (['mr_job', 'issue_label', 'issue_label_removed', 'mr_created', 'issue_created'].includes(kind) && !o.valor?.trim()) return null;
  return { kind, project: o.projeto, iid: o.iid, value: o.valor?.trim() || null };
}

async function classify(entry: EffectEntry, cards: Card[]): Promise<void> {
  const card = cards.find((c) => c.ref === entry.ref);
  try {
    const r = await askAgent<{ verificavel: boolean; tipo: string; projeto: string; iid: number | null; valor: string | null; motivo: string }>(
      'reply',
      classifyPrompt(entry, card),
      obj({
        verificavel: { type: 'boolean' },
        tipo: { enum: [...CHECK_KINDS, 'nenhum'] },
        projeto: str,
        iid: { type: ['integer', 'null'] },
        valor: strOrNull,
        motivo: str,
      }),
      { maxTurns: 2, tools: [] },
    );
    const check = toSpec(r.data);
    patch(entry.key, (e) => ({
      ...e,
      check,
      reason: r.data.motivo,
      classifyTries: e.classifyTries + 1,
      state: e.state === 'done' ? 'done' : check ? 'waiting' : 'unverifiable',
      error: null,
    }));
  } catch (err) {
    patch(entry.key, (e) => ({ ...e, classifyTries: e.classifyTries + 1, error: String((err as Error).message).slice(0, 200) }));
  }
}

// ---------------------------------------------------------------- verification (GET only)

const after = (iso: string | null | undefined, since: string) => !!iso && new Date(iso).getTime() >= new Date(since).getTime();

// Statuses of a CI job that mean it actually ran (GitLab words and GitHub conclusions).
const RAN = ['success', 'failed', 'failure', 'running', 'in_progress', 'canceled', 'cancelled'];

export async function verify(c: CheckSpec, since: string): Promise<Verdict> {
  const prov = vcsProvider();
  const project = c.project;
  const iid = c.iid as number;
  const v = c.value ?? '';
  switch (c.kind) {
    case 'mr_ready': {
      const m = await prov.getMr(project, iid);
      return { done: !m.draft && m.state !== 'closed', evidence: t(m.draft ? 'main.efeitos.stillDraft' : 'main.efeitos.notDraft', { iid }) };
    }
    case 'mr_reviewer': {
      const m = await prov.getMr(project, iid);
      const names = m.reviewers.map((r) => r.username);
      const done = v ? names.some((n) => n.toLowerCase() === v.toLowerCase().replace(/^@/, '')) : names.length > 0;
      return { done, evidence: names.length ? t('main.efeitos.reviewers', { iid, names: names.join(', ') }) : t('main.efeitos.noReviewer', { iid }) };
    }
    case 'mr_merged': {
      const m = await prov.getMr(project, iid);
      return { done: m.state === 'merged', at: m.mergedAt, evidence: t('main.efeitos.mrState', { iid, state: m.state }) };
    }
    case 'mr_synced_with_main': {
      const n = (await prov.getMr(project, iid, { behind: true })).behind;
      return { done: n === 0, evidence: n == null ? t('main.efeitos.behindUnknown', { iid }) : t('main.efeitos.behind', { iid, count: n }) };
    }
    case 'mr_new_commit': {
      const commits = await prov.listMrCommits(project, iid);
      const hit = commits.find((x) => after(x.date, since));
      return { done: !!hit, at: hit?.date, evidence: hit ? t('main.efeitos.commit', { sha: hit.sha.slice(0, 8), iid }) : t('main.efeitos.noCommit', { iid }) };
    }
    case 'mr_pipeline': {
      const list = (await prov.listMrCi(project, iid)).filter((x) => after(x.createdAt, since) && (v ? x.status === v : x.status !== 'skipped'));
      const hit = list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return { done: !!hit, at: hit?.createdAt, evidence: hit ? t('main.efeitos.pipeline', { id: hit.id, status: hit.status, iid }) : t('main.efeitos.noPipeline', { iid }) };
    }
    case 'mr_job': {
      const pipes = (await prov.listMrCi(project, iid)).filter((x) => after(x.createdAt, since)).slice(0, 5);
      for (const pipe of pipes) {
        const jobs = await prov.listCiJobs(project, pipe.id);
        const job = jobs.find((j) => j.name.toLowerCase().includes(v.toLowerCase()) && RAN.includes(j.status));
        if (job) return { done: true, at: job.startedAt ?? job.createdAt, evidence: t('main.efeitos.job', { name: job.name, status: job.status, id: pipe.id }) };
      }
      return { done: false, evidence: t('main.efeitos.noJob', { name: v, iid }) };
    }
    case 'mr_comment':
    case 'issue_comment': {
      const notes = c.kind === 'mr_comment' ? await prov.listMrComments(project, iid) : await prov.listIssueComments(project, iid);
      const user = (await prov.currentUser()).username;
      const hit = notes.find((n) => !n.system && n.author === user && after(n.createdAt, since));
      return { done: !!hit, at: hit?.createdAt, evidence: hit ? t('main.efeitos.comment', { target: `${c.kind === 'mr_comment' ? getTerms().words.crMark : '#'}${c.iid}` }) : t('main.efeitos.noComment') };
    }
    case 'issue_label':
    case 'issue_label_removed': {
      const i = await prov.getIssue(project, iid);
      const has = i.labels.some((l) => l.toLowerCase() === v.toLowerCase());
      return { done: c.kind === 'issue_label' ? has : !has, evidence: t(has ? 'main.efeitos.hasLabel' : 'main.efeitos.noLabel', { iid, label: v }) };
    }
    case 'issue_closed': {
      const i = await prov.getIssue(project, iid);
      return { done: i.state === 'closed', at: i.closedAt, evidence: t('main.efeitos.issueState', { iid, state: i.state }) };
    }
    case 'issue_created': {
      const hit = (await prov.searchIssues(project, { text: v, createdAfter: since }))[0];
      return { done: !!hit, at: hit?.createdAt, evidence: hit ? t('main.efeitos.issueFound', { iid: hit.iid, title: hit.title.slice(0, 60) }) : t('main.efeitos.noIssue', { value: v }) };
    }
    case 'mr_created': {
      const hit = (await prov.searchMrs(project, { text: v, createdAfter: since }))[0];
      return { done: !!hit, at: hit?.createdAt, evidence: hit ? t('main.efeitos.mrFound', { iid: hit.iid, title: hit.title.slice(0, 60) }) : t('main.efeitos.noMr', { value: v }) };
    }
  }
}

// ---------------------------------------------------------------- the cycle

export async function runCycle(): Promise<EfeitosView> {
  if (running) return view();
  running = true;
  try {
    syncFromHistory();
    const now = Date.now();
    const open = () => Object.values(read().entries).filter((e) => e.state !== 'done' && inWindow(e.since, now));
    const cards = [...new Set(open().map((e) => e.ceremonyId))].flatMap((id) => (id ? (getHistory(id)?.cards?.cards ?? []) : []));

    for (const e of open().filter((x) => x.check === undefined && x.classifyTries < MAX_CLASSIFY_TRIES).slice(0, MAX_CLASSIFY_PER_RUN)) {
      await classify(e, cards);
    }

    for (const e of open().filter((x) => x.check)) {
      try {
        const r = await verify(e.check as CheckSpec, e.since);
        patch(e.key, (x) =>
          x.state === 'done'
            ? x
            : {
                ...x,
                checkedAt: new Date().toISOString(),
                error: null,
                ...(r.done ? { state: 'done' as const, doneAt: r.at ?? new Date().toISOString(), evidence: r.evidence, manual: false } : { evidence: r.evidence }),
              },
        );
      } catch (err) {
        patch(e.key, (x) => ({ ...x, checkedAt: new Date().toISOString(), error: String((err as Error).message).slice(0, 200) }));
      }
    }
    const s = read();
    s.checkedAt = new Date().toISOString();
    write(s);
    emitView();
    return view();
  } finally {
    running = false;
  }
}

export function mark(effect: Effect, ceremonyId: string | null, done: boolean): EfeitosView {
  const key = effectKey(effect);
  const s = read();
  const started = ceremonyId ? getHistory(ceremonyId)?.startedAt : null;
  s.entries[key] ??= fresh(effect, key, ceremonyId, new Date(started ?? Date.now()).toISOString());
  const e = s.entries[key];
  s.entries[key] = done
    ? { ...e, state: 'done', doneAt: new Date().toISOString(), evidence: t('main.efeitos.markedDone'), manual: true }
    : { ...e, state: e.check === null ? 'unverifiable' : 'waiting', doneAt: null, evidence: null, manual: false };
  write(s);
  emitView();
  return view();
}

export const register: Module = (ctx) => {
  deps = ctx;
  ctx.job({ name: 'efeitos', everyMin: 30, workHoursOnly: true, enabled: vcsReady, run: async () => void (await runCycle()) });
  ctx.handle('efeitos:status', () => {
    syncFromHistory();
    return view();
  });
  ctx.handle('efeitos:mark', (effect: Effect, ceremonyId: string | null, done: boolean) => mark(effect, ceremonyId, done));
  ctx.handle('efeitos:check', () => runCycle());
};
