import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Card } from '../shared/types';
import type {
  DiscussionNote,
  DiscussionView,
  DiscussionsResult,
  Explanation,
  MrPath,
  ProposalView,
  QaNoteView,
  Reentry,
  ReentryClass,
  ReentryPhase,
} from '../shared/feedback';
import { listActions, proposeGitlabAction } from './actions';
import { CHAT_RULES, SPEECH_RULES, askAgent, obj, str, strOrNull } from './agents';
import { loadCards } from './cards';
import { getSettings } from './config';
import { ATAS, GITLAB, PLAYBOOK } from './env';
import type { Module } from './module';
import type { Notice } from './scheduler';

const exec = promisify(execFile);

const QA_USER = 'qa.interno';
const ISSUE_PROJECT = 1;
const SEEN_FILE = join(ATAS, 'feedback.json');
const DIR = join(ATAS, 'feedback');
const PIPELINE_SKILL = join(PLAYBOOK, '.claude/skills/agent-pipeline/SKILL.md');
const POOL = 4;
const MAX_NOTICES = 4;

interface GlNote {
  id: number;
  body: string;
  system: boolean;
  created_at: string;
  author: { username: string };
  resolvable?: boolean;
  resolved?: boolean | null;
  position?: { new_path?: string | null; old_path?: string | null; new_line?: number | null; old_line?: number | null } | null;
}

interface GlDiscussion {
  id: string;
  notes: GlNote[];
}

interface Seen {
  version: 1;
  checkedAt: string | null;
  issues: Record<string, { stage: string | null; status: string | null; returned: boolean; qaNotes: number[] }>;
  mrs: Record<string, { discussions: string[]; qaNotes: number[] }>;
}

export type FeedbackEvent =
  | { kind: 'returned'; card: Card; why: string; note: string | null }
  | { kind: 'qa-note'; card: Card; where: string; note: string }
  | { kind: 'discussion'; card: Card; mr: MrPath; count: number; first: string };

export interface DetectResult {
  firstRun: boolean;
  checked: { issues: number; mrs: number };
  events: FeedbackEvent[];
}

interface Deps {
  notify(n: Notice): void;
}

// ---------- GitLab reads ----------

async function glab(args: string[]): Promise<string> {
  const { stdout } = await exec('glab', args, { env: { ...process.env, GITLAB_HOST: GITLAB }, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

async function getJson<T>(endpoint: string): Promise<T> {
  return JSON.parse(await glab(['api', endpoint])) as T;
}

// GitLab caps a page at 100; a few pages cover any MR or issue this app follows.
async function getAll<T>(endpoint: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await getJson<T[]>(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

let cachedMe: string | null = null;

async function me(): Promise<string> {
  cachedMe ??= ((await getJson<{ username: string }>('user')).username ?? '').trim();
  return cachedMe;
}

const enc = encodeURIComponent;

function mrBase(mr: MrPath): string {
  return `projects/${enc(mr.project)}/merge_requests/${mr.iid}`;
}

function checkMr(mr: MrPath): MrPath {
  if (!/^[\w.-]+\/[\w.-]+$/.test(mr.project) || !Number.isInteger(mr.iid) || mr.iid <= 0 || !mr.ref) throw new Error('MR inválido');
  return mr;
}

function isUnresolved(d: GlDiscussion): boolean {
  return d.notes.some((n) => !n.system && n.resolvable && !n.resolved);
}

function realNotes(d: GlDiscussion): GlNote[] {
  return d.notes.filter((n) => !n.system);
}

async function issueStatuses(cards: Card[]): Promise<Map<string, string>> {
  const iids = cards.filter((c) => c.ref.startsWith('sz4#') && /^\d+$/.test(c.iid)).map((c) => `"${c.iid}"`);
  const out = new Map<string, string>();
  if (!iids.length) return out;
  const query = `{ project(fullPath:"sz4/sz4"){ workItems(iids:[${iids.join(',')}]){ nodes{ iid widgets{ ... on WorkItemWidgetStatus{ status{ name } } } } } } }`;
  try {
    const r = JSON.parse(await glab(['api', 'graphql', '-f', `query=${query}`])) as {
      data?: { project?: { workItems?: { nodes: { iid: string; widgets: { status?: { name: string } }[] }[] } } };
    };
    for (const n of r.data?.project?.workItems?.nodes ?? []) {
      const name = n.widgets.find((w) => w.status)?.status?.name;
      if (name) out.set(n.iid, name);
    }
  } catch (e) {
    console.error('[feedback] status query failed', (e as Error).message);
  }
  return out;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

function excerpt(body: string, max = 240): string {
  const text = body.replace(/[#*`_>]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// ---------- seen state ----------

function readSeen(): Seen {
  try {
    if (existsSync(SEEN_FILE)) return JSON.parse(readFileSync(SEEN_FILE, 'utf8')) as Seen;
  } catch {}
  return { version: 1, checkedAt: null, issues: {}, mrs: {} };
}

function writeJson(file: string, data: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 1));
  renameSync(`${file}.tmp`, file);
}

// ---------- detection ----------

export async function detectFeedback(cards: Card[]): Promise<DetectResult & { next: Seen }> {
  const prev = readSeen();
  const firstRun = !prev.checkedAt;
  const user = await me();
  const statuses = await issueStatuses(cards);
  const next: Seen = { version: 1, checkedAt: new Date().toISOString(), issues: {}, mrs: {} };
  const events: FeedbackEvent[] = [];
  const mrRuns = new Map<string, Promise<{ discussions: string[]; qaNotes: number[]; fresh: GlDiscussion[]; freshQa: GlNote[] } | null>>();

  const visitMr = (mr: MrPath) => {
    let run = mrRuns.get(mr.ref);
    if (!run) {
      run = (async () => {
        try {
          const all = await getAll<GlDiscussion>(`${mrBase(mr)}/discussions`);
          const before = prev.mrs[mr.ref];
          const open = all.filter(isUnresolved);
          const qa = all.flatMap(realNotes).filter((n) => n.author.username === QA_USER);
          const freshQa = qa.filter((n) => !before?.qaNotes.includes(n.id));
          // Threads the user opened or last answered are not news to them.
          const fresh = open.filter((d) => !before?.discussions.includes(d.id) && realNotes(d).at(-1)?.author.username !== user);
          next.mrs[mr.ref] = { discussions: open.map((d) => d.id), qaNotes: qa.map((n) => n.id) };
          return { discussions: next.mrs[mr.ref].discussions, qaNotes: next.mrs[mr.ref].qaNotes, fresh: before ? fresh : [], freshQa: before ? freshQa : [] };
        } catch (e) {
          console.error(`[feedback] ${mr.ref}`, (e as Error).message);
          if (prev.mrs[mr.ref]) next.mrs[mr.ref] = prev.mrs[mr.ref];
          return null;
        }
      })();
      mrRuns.set(mr.ref, run);
    }
    return run;
  };

  await pool(cards, POOL, async (card) => {
    const before = prev.issues[card.iid];
    const status = statuses.get(card.iid) ?? before?.status ?? null;
    const returned = card.stage === 'Test Fail' || status === 'Failed testing';
    let qaNotes = before?.qaNotes ?? [];
    let freshNotes: GlNote[] = [];
    if (card.ref.startsWith('sz4#') && /^\d+$/.test(card.iid)) {
      try {
        const notes = (await getAll<GlNote>(`projects/${ISSUE_PROJECT}/issues/${card.iid}/notes?sort=desc&order_by=created_at`)).filter(
          (n) => !n.system && n.author.username === QA_USER,
        );
        qaNotes = notes.map((n) => n.id);
        if (before) freshNotes = notes.filter((n) => !before.qaNotes.includes(n.id));
      } catch (e) {
        console.error(`[feedback] #${card.iid} notes`, (e as Error).message);
      }
    }
    next.issues[card.iid] = { stage: card.stage, status, returned, qaNotes };

    // An issue or MR seen for the first time is only registered: its old notes are not news.
    if (before && returned && !before.returned) {
      const why = card.stage === 'Test Fail' && status === 'Failed testing' ? 'Estágio Test Fail e status Failed testing.' : card.stage === 'Test Fail' ? 'Estágio Test Fail.' : 'Status Failed testing.';
      events.push({ kind: 'returned', card, why, note: freshNotes[0] ? excerpt(freshNotes[0].body) : null });
    } else if (freshNotes.length) {
      events.push({ kind: 'qa-note', card, where: `#${card.iid}`, note: excerpt(freshNotes[0].body) });
    }

    for (const mr of card.mrPaths) {
      if (mrRuns.has(mr.ref)) continue;
      const r = await visitMr(mr);
      if (!r) continue;
      if (r.freshQa.length) events.push({ kind: 'qa-note', card, where: mr.ref, note: excerpt(r.freshQa[0].body) });
      if (r.fresh.length) {
        const first = realNotes(r.fresh[0])[0];
        events.push({ kind: 'discussion', card, mr, count: r.fresh.length, first: `${first.author.username}: ${excerpt(first.body, 140)}` });
      }
    }
  });

  return { firstRun, checked: { issues: Object.keys(next.issues).length, mrs: Object.keys(next.mrs).length }, events, next };
}

function noticesFor(events: FeedbackEvent[]): Notice[] {
  if (events.length > MAX_NOTICES) {
    const refs = [...new Set(events.map((e) => `#${e.card.iid}`))].join(', ');
    return [{ title: `${events.length} retornos de QA e revisão`, body: `${refs}\nClique para ver as atividades.`, onClick: { type: 'navigate', to: 'today' } }];
  }
  return events.map((e): Notice => {
    if (e.kind === 'returned') {
      return {
        title: `A #${e.card.iid} voltou do QA`,
        body: `${e.why}${e.note ? `\n${e.note}` : ''}\nClique para a call de reentrada.`,
        onClick: { type: 'open', screen: { name: 'reentry', ref: e.card.ref, card: e.card } },
      };
    }
    if (e.kind === 'qa-note') {
      return {
        title: `Nota nova do QA na ${e.where}`,
        body: `${e.note}\nClique para a call de reentrada.`,
        onClick: { type: 'open', screen: { name: 'reentry', ref: e.card.ref, card: e.card } },
      };
    }
    return {
      title: e.count === 1 ? `Nova discussão no ${e.mr.ref}` : `${e.count} novas discussões no ${e.mr.ref}`,
      body: `${e.first}\nClique para ver uma por vez.`,
      onClick: { type: 'open', screen: { name: 'discussions', ref: e.card.ref, mr: e.mr.ref, card: e.card } },
    };
  });
}

let checking = false;

// `cards` is injectable so a test can replay a transition; the job always loads them.
export async function checkFeedback(deps: Deps, cards?: Card[]): Promise<DetectResult | null> {
  if (checking) return null;
  checking = true;
  try {
    const { firstRun, events, checked, next } = await detectFeedback(cards ?? (await loadCards(100)).cards);
    writeJson(SEEN_FILE, next);
    if (!firstRun && getSettings().notifications) for (const n of noticesFor(events)) deps.notify(n);
    return { firstRun, events, checked };
  } finally {
    checking = false;
  }
}

// ---------- reentry call ----------

function now(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function reentryFile(iid: string): string {
  if (!/^\d+$/.test(iid)) throw new Error('issue inválida');
  return join(DIR, 'reentry', `${iid}.json`);
}

export function getReentry(iid: string): Reentry | null {
  try {
    return JSON.parse(readFileSync(reentryFile(iid), 'utf8')) as Reentry;
  } catch {
    return null;
  }
}

async function qaNotesOf(card: Card): Promise<(QaNoteView & { body: string })[]> {
  const found: (QaNoteView & { body: string })[] = [];
  if (card.ref.startsWith('sz4#')) {
    const notes = await getAll<GlNote>(`projects/${ISSUE_PROJECT}/issues/${card.iid}/notes?sort=desc&order_by=created_at`);
    for (const n of notes.filter((x) => !x.system && x.author.username === QA_USER)) {
      found.push({ id: n.id, at: n.created_at, where: `#${card.iid}`, excerpt: excerpt(n.body), body: n.body, url: `https://${GITLAB}/sz4/sz4/-/work_items/${card.iid}#note_${n.id}` });
    }
  }
  for (const mr of card.mrPaths) {
    try {
      const all = await getAll<GlDiscussion>(`${mrBase(mr)}/discussions`);
      for (const n of all.flatMap(realNotes).filter((x) => x.author.username === QA_USER)) {
        found.push({ id: n.id, at: n.created_at, where: mr.ref, excerpt: excerpt(n.body), body: n.body, url: `https://${GITLAB}/${mr.project}/-/merge_requests/${mr.iid}#note_${n.id}` });
      }
    } catch (e) {
      console.error(`[feedback] ${mr.ref}`, (e as Error).message);
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at));
}

const CLASSES: ReentryClass[] = ['defeito-novo', 'causa-diferente', 'so-plano', 'ambiente'];
const PHASES: ReentryPhase[] = ['F1', 'F3', 'F4', 'nenhuma'];

export async function prepareReentry(card: Card): Promise<Reentry> {
  const notes = await qaNotesOf(card);
  const recent = notes.slice(0, 3);
  const prompt = [
    `Call de reentrada da issue ${card.ref} (${card.title}), por voz: o QA ou a revisão devolveu a atividade. Você explica ao Luiz o que voltou e onde ela reentra no pipeline.`,
    `Estágio atual: ${card.stage ?? 'sem estágio'}. ${card.spec ? `Spec em ${card.spec.folder} (${card.spec.phase}); leia o Plan, a investigação ou o spec técnico e o ISSUE_COMPLETION, no máximo 5 leituras.` : 'A issue não tem pasta de spec: diga isso.'}`,
    `MRs: ${JSON.stringify(card.mrPaths)}.`,
    recent.length
      ? `Comentários mais recentes do ${QA_USER} (a conta do QA), do mais novo para o mais antigo:\n${recent.map((n) => `--- ${n.where}, ${n.at}\n${n.body.slice(0, 5000)}`).join('\n')}`
      : `Não há nota do ${QA_USER} na issue nem nos MRs. Diga isso e não invente achado do QA.`,
    `Leia a seção "3. Ciclos" (a tabela de gatilhos e o texto abaixo dela) e a seção "7. QA-assistente" (tabela de classes) de ${PIPELINE_SKILL}.`,
    'Classifique o retorno:',
    '- "defeito-novo": o QA expôs um defeito que o fix criou ou deixou aparecer, fora do que a issue tratava. Reentra em F1 (ciclo novo, nova investigação, Gate 1 novo).',
    '- "causa-diferente": o problema é o mesmo sintoma, mas a causa não é a investigada. Reentra em F1.',
    '- "so-plano": o fix não cumpre o que o Plan já descrevia, ou falta um detalhe dentro do Plan. Reentra em F4 com o mesmo Plan; F3 só se a correção tocar arquivo fora do Plan.',
    '- "ambiente": a evidência do QA é inválida (login bloqueado, skip, ocupante do ambiente, versão diferente). "fase" é "nenhuma": não vira tarefa; corrige-se o ambiente e o QA reteste.',
    'Se o comentário não bastar para classificar, escolha a mais provável e diga a dúvida em "duvida"; senão "duvida" é null.',
    '"fala": até 130 palavras, para ser ouvida: o que o QA encontrou, a classificação, em que fase reentra e o primeiro passo.',
    '"achou": o que o QA encontrou, em um parágrafo, com os cenários que falharam. "motivo": por que essa classificação, em uma ou duas frases.',
    '"passos": de 2 a 4 passos do que o agente faz na reentrada, da coluna "O agente faz" da tabela, aplicados a esta issue (inclua o quiz do delta quando houver).',
    SPEECH_RULES,
  ].join('\n');
  const r = await askAgent<{ fala: string; achou: string; classificacao: ReentryClass; motivo: string; fase: ReentryPhase; passos: string[]; duvida: string | null }>(
    'deep',
    prompt,
    obj({
      fala: str,
      achou: str,
      classificacao: { enum: CLASSES },
      motivo: str,
      fase: { enum: PHASES },
      passos: { type: 'array', items: str, minItems: 2, maxItems: 4 },
      duvida: strOrNull,
    }),
    { maxTurns: 16 },
  );
  const reentry: Reentry = {
    id: card.iid,
    ref: card.ref,
    iid: card.iid,
    title: card.title,
    stage: card.stage,
    sessionId: r.sessionId || null,
    speech: r.data.fala,
    found: r.data.achou,
    classification: r.data.classificacao,
    why: r.data.duvida ? `${r.data.motivo} Dúvida: ${r.data.duvida}` : r.data.motivo,
    phase: r.data.fase,
    steps: r.data.passos,
    notes: recent.map(({ body: _body, ...view }) => view),
    talk: [],
    createdAt: new Date().toISOString(),
  };
  writeJson(reentryFile(card.iid), reentry);
  return reentry;
}

export async function askReentry(iid: string, question: string): Promise<Reentry> {
  const re = getReentry(iid);
  if (!re) throw new Error('call de reentrada não preparada');
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    [`Pergunta do Luiz na reentrada da ${re.ref} (transcrição por voz): «${question}»`, '"fala": até 90 palavras.', CHAT_RULES, SPEECH_RULES].join('\n'),
    obj({ fala: str, texto: str }),
    { maxTurns: 12, ...(re.sessionId ? { resume: re.sessionId } : {}) },
  );
  re.sessionId = r.sessionId || re.sessionId;
  re.talk.push({ me: true, text: question, at: now() }, { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now() });
  writeJson(reentryFile(iid), re);
  return re;
}

// ---------- discussions, one at a time ----------

interface StoredDiscussion {
  explanation: (Explanation & { notes: number }) | null;
  proposals: { key: string; kind: 'reply' | 'resolve' }[];
}

type DiscussionStore = Record<string, StoredDiscussion>;

function discussionFile(mr: MrPath): string {
  return join(DIR, 'discussions', `${mr.project.replace(/\//g, '_')}!${mr.iid}.json`);
}

function readStore(mr: MrPath): DiscussionStore {
  try {
    return JSON.parse(readFileSync(discussionFile(mr), 'utf8')) as DiscussionStore;
  } catch {
    return {};
  }
}

function checkDiscussionId(id: string): string {
  if (!/^[0-9a-f]{8,64}$/.test(id)) throw new Error('discussão inválida');
  return id;
}

function viewOf(d: GlDiscussion, stored: StoredDiscussion | undefined): DiscussionView {
  const notes = realNotes(d);
  const pos = notes.find((n) => n.position)?.position;
  const states = new Map(listActions().map((a) => [a.key, a.state]));
  const proposals: ProposalView[] = (stored?.proposals ?? []).map((p) => ({ ...p, state: states.get(p.key) ?? 'unknown' }));
  const explanation = stored?.explanation ?? null;
  return {
    id: d.id,
    path: pos?.new_path ?? pos?.old_path ?? null,
    line: pos?.new_line ?? pos?.old_line ?? null,
    notes: notes.map((n): DiscussionNote => ({ author: n.author.username, at: n.created_at, body: n.body })),
    explanation: explanation ? { speech: explanation.speech, text: explanation.text, point: explanation.point, needsCode: explanation.needsCode, draft: explanation.draft, sessionId: explanation.sessionId, at: explanation.at } : null,
    stale: !!explanation && explanation.notes !== notes.length,
    proposals,
  };
}

export async function listDiscussions(mrIn: MrPath): Promise<DiscussionsResult> {
  const mr = checkMr(mrIn);
  const all = await getAll<GlDiscussion>(`${mrBase(mr)}/discussions`);
  const store = readStore(mr);
  return { mr, fetchedAt: new Date().toISOString(), discussions: all.filter(isUnresolved).map((d) => viewOf(d, store[d.id])) };
}

export async function explainDiscussion(card: Card, mrIn: MrPath, id: string): Promise<DiscussionView> {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const d = await getJson<GlDiscussion>(`${mrBase(mr)}/discussions/${id}`);
  const notes = realNotes(d);
  const pos = notes.find((n) => n.position)?.position;
  const where = pos ? `${pos.new_path ?? pos.old_path}:${pos.new_line ?? pos.old_line ?? '?'}` : 'comentário geral, sem linha';
  const prompt = [
    `Revisão do MR ${mr.ref} (issue ${card.ref}, ${card.title}). Explique ao Luiz UMA discussão aberta do revisor e proponha o rascunho da resposta dele. Não publique nada.`,
    card.spec ? `Spec em ${card.spec.folder} (${card.spec.phase}); consulte o Plan se o ponto tocar o escopo.` : '',
    `Local: ${where}.`,
    `Discussão ${id}, da mais antiga para a mais nova:\n${notes.map((n) => `--- ${n.author.username}, ${n.created_at}\n${n.body.slice(0, 4000)}`).join('\n')}`,
    `Para ver o trecho, use glab api ${mrBase(mr)}/changes ou o MCP do GitLab (get_merge_request_details_and_changes); o checkout local pode estar em outra branch.`,
    '"ponto": o que o revisor está pedindo ou questionando, em uma frase. "precisa_codigo": true se atender exige mudar o código.',
    '"fala": até 90 palavras, para ser ouvida: o ponto, se o revisor tem razão pelo que você leu e o que o Luiz precisa decidir.',
    '"rascunho": a resposta do Luiz ao revisor, em português, direta e cordial, até 80 palavras, em primeira pessoa e com a acentuação correta. Não afirme que algo foi corrigido, testado ou commitado se você não viu isso; se exige mudança, escreva a intenção ("Vou ajustar X"). Se faltar informação, deixe o trecho entre [colchetes] para ele completar.',
    CHAT_RULES,
    SPEECH_RULES,
  ]
    .filter(Boolean)
    .join('\n');
  const r = await askAgent<{ fala: string; texto: string; ponto: string; precisa_codigo: boolean; rascunho: string }>(
    'deep',
    prompt,
    obj({ fala: str, texto: str, ponto: str, precisa_codigo: { type: 'boolean' }, rascunho: str }),
    { maxTurns: 14 },
  );
  const store = readStore(mr);
  const explanation = { speech: r.data.fala, text: r.data.texto || r.data.fala, point: r.data.ponto, needsCode: r.data.precisa_codigo, draft: r.data.rascunho, sessionId: r.sessionId || null, at: new Date().toISOString(), notes: notes.length };
  store[id] = { proposals: store[id]?.proposals ?? [], explanation };
  writeJson(discussionFile(mr), store);
  return viewOf(d, store[id]);
}

function remember(mr: MrPath, id: string, proposal: { key: string; kind: 'reply' | 'resolve' }): void {
  const store = readStore(mr);
  const entry = store[id] ?? { explanation: null, proposals: [] };
  if (!entry.proposals.some((p) => p.key === proposal.key)) entry.proposals.push(proposal);
  store[id] = entry;
  writeJson(discussionFile(mr), store);
}

// Both writes only become proposals: nothing reaches GitLab before "seguir" and the confirmation in the Actions screen.
export function proposeReply(card: Card, mrIn: MrPath, id: string, bodyIn: string): ProposalView {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const body = bodyIn.trim();
  if (!body) throw new Error('a resposta está vazia');
  if (body.length > 10_000) throw new Error('a resposta passa de 10 mil caracteres');
  const key = `mr-reply:${mr.ref}:${id}:${createHash('sha1').update(body).digest('hex').slice(0, 10)}`;
  const action = proposeGitlabAction({
    key,
    issue: Number(card.iid),
    issueTitle: card.title,
    stage: card.stage ?? '',
    summary: `Responder à discussão no ${mr.ref}`,
    detail: 'A resposta entra como nota na discussão do revisor.',
    command: { via: 'glab', method: 'POST', endpoint: `${mrBase(mr)}/discussions/${id}/notes`, fields: { body } },
  });
  if (!action) throw new Error('Já existe uma proposta igual a esta em Ações.');
  remember(mr, id, { key, kind: 'reply' });
  return { key, kind: 'reply', state: 'pending' };
}

export function proposeResolve(card: Card, mrIn: MrPath, id: string): ProposalView {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const key = `mr-resolve:${mr.ref}:${id}`;
  const action = proposeGitlabAction({
    key,
    issue: Number(card.iid),
    issueTitle: card.title,
    stage: card.stage ?? '',
    summary: `Marcar como resolvida a discussão no ${mr.ref}`,
    command: { via: 'glab', method: 'PUT', endpoint: `${mrBase(mr)}/discussions/${id}`, fields: { resolved: 'true' } },
  });
  if (!action) throw new Error('Já existe uma proposta para resolver esta discussão em Ações.');
  remember(mr, id, { key, kind: 'resolve' });
  return { key, kind: 'resolve', state: 'pending' };
}

// ---------- registration ----------

export const register: Module = (ctx) => {
  ctx.job({ name: 'feedback', everyMin: 20, workHoursOnly: true, run: async () => void (await checkFeedback({ notify: ctx.notify })) });
  ctx.handle('feedback:reentry:get', getReentry);
  ctx.handle('feedback:reentry:prepare', prepareReentry);
  ctx.handle('feedback:reentry:ask', askReentry);
  ctx.handle('feedback:discussions:list', listDiscussions);
  ctx.handle('feedback:discussions:explain', explainDiscussion);
  ctx.handle('feedback:discussions:reply', proposeReply);
  ctx.handle('feedback:discussions:resolve', proposeResolve);
};
