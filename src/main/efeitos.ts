import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { CHECK_KINDS, type CheckKind, type CheckSpec, type EffectEntry, type EfeitosView, WINDOW_DAYS, effectKey } from '../shared/efeitos';
import type { Card, Effect } from '../shared/types';
import { askAgent, obj, str, strOrNull } from './agents';
import { baseParams } from './cyclePrompts';
import { ATAS } from './env';
import { gitlabCliReady, rc, vcsCliEnv } from './workspaceConfig';
import type { Module } from './module';
import { getHistory, listHistory } from './state';

const run = promisify(execFile);

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

const KIND_HELP: Record<CheckKind, string> = {
  mr_ready: 'o MR deixou de ser draft (project + iid do MR)',
  mr_reviewer: 'o MR tem reviewer definido (valor opcional: username esperado)',
  mr_merged: 'o MR foi mergeado',
  mr_created: 'um MR novo foi aberto no projeto (valor: palavras do título; iid null)',
  mr_synced_with_main: 'a branch do MR está atualizada com a main, sem commits de divergência',
  mr_new_commit: 'o MR recebeu commit novo (push) depois da cerimônia',
  mr_pipeline: 'uma pipeline do MR rodou depois da cerimônia (valor opcional: status esperado, como success)',
  mr_job: 'um job com esse nome rodou numa pipeline do MR depois da cerimônia (valor: nome do job)',
  mr_comment: '{theUser} comentou no MR depois da cerimônia',
  issue_comment: '{theUser} comentou na issue depois da cerimônia (project do rastreador de issues + iid da issue)',
  issue_label: 'a issue ganhou a label (valor: a label, como STAGE::Ready to test)',
  issue_label_removed: 'a issue deixou de ter a label (valor: a label)',
  issue_closed: 'a issue foi fechada',
  issue_created: 'uma issue nova foi criada no projeto (valor: palavras do título; iid null)',
};

function classifyPrompt(entry: EffectEntry, card: Card | undefined): string {
  const issueIid = /#(\d+)$/.exec(entry.ref)?.[1] ?? null;
  return [
    'Classifique UMA ação pendente da pré-daily numa verificação objetiva, que o app fará depois só com GET no GitLab. Não use ferramentas.',
    `Ação: «${entry.text}»`,
    `Atividade: ${entry.ref} (repositório citado: ${entry.repo}). A issue ${issueIid ? `#${issueIid}` : ''} vive no projeto ${rc().issues.project ?? 'não configurado'}.`,
    `MRs da atividade (project e iid para usar): ${JSON.stringify(card?.mrPaths ?? [])}. Estágio: ${card?.stage ?? 'desconhecido'}.`,
    'Tipos de verificação disponíveis:',
    ...CHECK_KINDS.map((k) => `- ${k}: ${KIND_HELP[k].replace('{theUser}', String(baseParams().theUser))}`),
    'Regras: escolha um tipo só se o estado do GitLab provar que a ação foi feita. Se ela for vaga, pessoal, local (git, worktree, spec), mudança de status de work item (não é label) ou exigir julgamento, responda tipo "nenhum" e verificavel false.',
    'Quando o MR citado não está na lista de MRs acima, use "nenhum". "projeto" é o caminho do projeto (grupo/repo), "iid" o número do MR ou da issue (null nos tipos que criam coisa), "valor" o parâmetro do tipo ou null, "motivo" uma frase curta.',
  ].join('\n');
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

async function get<T>(path: string): Promise<T> {
  const { stdout } = await run('glab', ['api', path], { env: vcsCliEnv(), timeout: 45_000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

let me: string | null = null;
async function myUsername(): Promise<string> {
  me ??= (await get<{ username: string }>('user')).username;
  return me;
}

const enc = encodeURIComponent;
const after = (iso: string | null | undefined, since: string) => !!iso && new Date(iso).getTime() >= new Date(since).getTime();

interface GlMr {
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  merged_at: string | null;
  reviewers?: { username: string }[];
  diverged_commits_count?: number | null;
  web_url?: string;
}
interface GlIssue {
  iid: number;
  title: string;
  state: string;
  closed_at: string | null;
  labels: string[];
  created_at: string;
}
interface GlNote {
  system: boolean;
  created_at: string;
  author: { username: string };
}
interface GlPipeline {
  id: number;
  status: string;
  created_at: string;
}
interface GlJob {
  name: string;
  status: string;
  started_at: string | null;
  created_at: string;
}

export async function verify(c: CheckSpec, since: string): Promise<Verdict> {
  const p = `projects/${enc(c.project)}`;
  const mr = `${p}/merge_requests/${c.iid}`;
  const issue = `${p}/issues/${c.iid}`;
  const v = c.value ?? '';
  switch (c.kind) {
    case 'mr_ready': {
      const m = await get<GlMr>(mr);
      return { done: !(m.draft ?? m.work_in_progress) && m.state !== 'closed', evidence: `!${c.iid} ${m.draft ?? m.work_in_progress ? 'ainda é draft' : 'não é mais draft'}` };
    }
    case 'mr_reviewer': {
      const m = await get<GlMr>(mr);
      const names = (m.reviewers ?? []).map((r) => r.username);
      const done = v ? names.some((n) => n.toLowerCase() === v.toLowerCase().replace(/^@/, '')) : names.length > 0;
      return { done, evidence: names.length ? `reviewers de !${c.iid}: ${names.join(', ')}` : `!${c.iid} sem reviewer` };
    }
    case 'mr_merged': {
      const m = await get<GlMr>(mr);
      return { done: m.state === 'merged', at: m.merged_at, evidence: `!${c.iid} está ${m.state}` };
    }
    case 'mr_synced_with_main': {
      const m = await get<GlMr>(`${mr}?include_diverged_commits_count=true`);
      const n = m.diverged_commits_count;
      return { done: n === 0, evidence: n == null ? `!${c.iid}: GitLab não informou a divergência` : `!${c.iid} está ${n} commit(s) atrás da main` };
    }
    case 'mr_new_commit': {
      const commits = await get<{ id: string; committed_date: string }[]>(`${mr}/commits?per_page=50`);
      const hit = commits.find((x) => after(x.committed_date, since));
      return { done: !!hit, at: hit?.committed_date, evidence: hit ? `commit ${hit.id.slice(0, 8)} em !${c.iid}` : `nenhum commit novo em !${c.iid}` };
    }
    case 'mr_pipeline': {
      const list = (await get<GlPipeline[]>(`${mr}/pipelines`)).filter((x) => after(x.created_at, since) && (v ? x.status === v : x.status !== 'skipped'));
      const hit = list.sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
      return { done: !!hit, at: hit?.created_at, evidence: hit ? `pipeline ${hit.id} (${hit.status}) em !${c.iid}` : `nenhuma pipeline nova em !${c.iid}` };
    }
    case 'mr_job': {
      const pipes = (await get<GlPipeline[]>(`${mr}/pipelines`)).filter((x) => after(x.created_at, since)).slice(0, 5);
      for (const pipe of pipes) {
        const jobs = await get<GlJob[]>(`${p}/pipelines/${pipe.id}/jobs?per_page=100`);
        const job = jobs.find((j) => j.name.toLowerCase().includes(v.toLowerCase()) && ['success', 'failed', 'running', 'canceled'].includes(j.status));
        if (job) return { done: true, at: job.started_at ?? job.created_at, evidence: `job ${job.name} (${job.status}) na pipeline ${pipe.id}` };
      }
      return { done: false, evidence: `job ${v} não rodou em !${c.iid}` };
    }
    case 'mr_comment':
    case 'issue_comment': {
      const notes = await get<GlNote[]>(`${c.kind === 'mr_comment' ? mr : issue}/notes?sort=desc&order_by=created_at&per_page=50`);
      const user = await myUsername();
      const hit = notes.find((n) => !n.system && n.author.username === user && after(n.created_at, since));
      return { done: !!hit, at: hit?.created_at, evidence: hit ? `comentário seu em ${c.kind === 'mr_comment' ? '!' : '#'}${c.iid}` : 'nenhum comentário seu desde a cerimônia' };
    }
    case 'issue_label':
    case 'issue_label_removed': {
      const i = await get<GlIssue>(issue);
      const has = i.labels.some((l) => l.toLowerCase() === v.toLowerCase());
      return { done: c.kind === 'issue_label' ? has : !has, evidence: `#${c.iid} ${has ? 'tem' : 'não tem'} a label ${v}` };
    }
    case 'issue_closed': {
      const i = await get<GlIssue>(issue);
      return { done: i.state === 'closed', at: i.closed_at, evidence: `#${c.iid} está ${i.state}` };
    }
    case 'issue_created': {
      const list = await get<GlIssue[]>(`${p}/issues?search=${enc(v)}&in=title&scope=all&created_after=${enc(since)}&per_page=20`);
      const hit = list[0];
      return { done: !!hit, at: hit?.created_at, evidence: hit ? `issue #${hit.iid} «${hit.title.slice(0, 60)}»` : `nenhuma issue nova com «${v}»` };
    }
    case 'mr_created': {
      const list = await get<(GlIssue & { created_at: string })[]>(`${p}/merge_requests?search=${enc(v)}&in=title&scope=all&created_after=${enc(since)}&per_page=20`);
      const hit = list[0];
      return { done: !!hit, at: hit?.created_at, evidence: hit ? `MR !${hit.iid} «${hit.title.slice(0, 60)}»` : `nenhum MR novo com «${v}»` };
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
    ? { ...e, state: 'done', doneAt: new Date().toISOString(), evidence: 'marcado como feito por você', manual: true }
    : { ...e, state: e.check === null ? 'unverifiable' : 'waiting', doneAt: null, evidence: null, manual: false };
  write(s);
  emitView();
  return view();
}

export const register: Module = (ctx) => {
  deps = ctx;
  ctx.job({ name: 'efeitos', everyMin: 30, workHoursOnly: true, enabled: gitlabCliReady, run: async () => void (await runCycle()) });
  ctx.handle('efeitos:status', () => {
    syncFromHistory();
    return view();
  });
  ctx.handle('efeitos:mark', (effect: Effect, ceremonyId: string | null, done: boolean) => mark(effect, ceremonyId, done));
  ctx.handle('efeitos:check', () => runCycle());
};
