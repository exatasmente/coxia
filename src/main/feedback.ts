import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { listActions, proposeVcsCommands } from './actions';
import { askAgent, obj, str, strOrNull } from './agents';
import { answerCeremonyMentions } from './mentions/ceremony';
import { returnedFromQa } from '../shared/cycles/stages';
import { cycle, formatTime, prompt as cp, text as cycleWord } from './cyclePrompts';
import { loadCards } from './cards';
import { getSettings } from './config';
import { ATAS } from './env';
import { docsSources, isIssueRef, issueProjectKey, qaUser, rc } from './workspaceConfig';
import { logError } from './errorlog';
import type { Module } from './module';
import type { Notice } from './scheduler';
import { vcsProvider, vcsReady } from './vcs';
import { mrChangesHint } from './vcs/readPolicy';
import type { VcsComment, VcsThread } from './vcs/types';
import { tv, t } from '../shared/i18n';

const SEEN_FILE = join(ATAS, 'feedback.json');
const DIR = join(ATAS, 'feedback');
// The team's pipeline skill (devCycle.pipelineSkill), when one of the configured skills folders has it.
function pipelineSkill(): string | null {
  const name = cycle().pipelineSkill.trim();
  return name ? (docsSources().skillsDirs.map((d) => join(d, name, 'SKILL.md')).find((f) => existsSync(f)) ?? null) : null;
}
const POOL = 4;
const MAX_NOTICES = 4;

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

// ---------- code host reads ----------

function checkMr(mr: MrPath): MrPath {
  if (!/^[\w.-]+\/[\w.-]+$/.test(mr.project) || !Number.isInteger(mr.iid) || mr.iid <= 0 || !mr.ref) throw new Error(t('main.feedback.badMr'));
  return mr;
}

const isUnresolved = (d: VcsThread): boolean => !d.resolved;

function realNotes(d: VcsThread): VcsComment[] {
  return d.notes.filter((n) => !n.system);
}

async function issueStatuses(cards: Card[]): Promise<Map<string, string>> {
  const iids = cards.filter((c) => isIssueRef(c.ref) && /^\d+$/.test(c.iid)).map((c) => Number(c.iid));
  const out = new Map<string, string>();
  const project = rc().issues.project;
  if (!iids.length || !project) return out;
  try {
    for (const [iid, name] of await vcsProvider().issueStatuses(project, iids)) out.set(String(iid), name);
  } catch (e) {
    console.error('[feedback] status query failed', (e as Error).message);
    logError('job:feedback', e, { job: 'feedback', phase: 'status' });
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
  const prov = vcsProvider();
  const user = (await prov.currentUser()).username;
  const statuses = await issueStatuses(cards);
  const next: Seen = { version: 1, checkedAt: new Date().toISOString(), issues: {}, mrs: {} };
  const events: FeedbackEvent[] = [];
  const mrRuns = new Map<string, Promise<{ discussions: string[]; qaNotes: number[]; fresh: VcsThread[]; freshQa: VcsComment[] } | null>>();

  const visitMr = (mr: MrPath) => {
    let run = mrRuns.get(mr.ref);
    if (!run) {
      run = (async () => {
        try {
          const all = await prov.listMrThreads(mr.project, mr.iid);
          const before = prev.mrs[mr.ref];
          const open = all.filter(isUnresolved);
          const qa = all.flatMap(realNotes).filter((n) => n.author === qaUser());
          const freshQa = qa.filter((n) => !before?.qaNotes.includes(Number(n.id)));
          // Threads the user opened or last answered are not news to them.
          const fresh = open.filter((d) => !before?.discussions.includes(d.id) && realNotes(d).at(-1)?.author !== user);
          next.mrs[mr.ref] = { discussions: open.map((d) => d.id), qaNotes: qa.map((n) => Number(n.id)) };
          return { discussions: next.mrs[mr.ref].discussions, qaNotes: next.mrs[mr.ref].qaNotes, fresh: before ? fresh : [], freshQa: before ? freshQa : [] };
        } catch (e) {
          console.error(`[feedback] ${mr.ref}`, (e as Error).message);
          logError('job:feedback', e, { job: 'feedback', mr: mr.ref });
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
    const stageHit = returnedFromQa(cycle(), card.stage);
    const statusHit = returnedFromQa(cycle(), status);
    const returned = stageHit || statusHit;
    let qaNotes = before?.qaNotes ?? [];
    let freshNotes: VcsComment[] = [];
    if (isIssueRef(card.ref) && /^\d+$/.test(card.iid)) {
      try {
        const notes = (await prov.listIssueComments(issueProjectKey(), Number(card.iid))).filter((n) => !n.system && n.author === qaUser());
        qaNotes = notes.map((n) => Number(n.id));
        if (before) freshNotes = notes.filter((n) => !before.qaNotes.includes(Number(n.id)));
      } catch (e) {
        console.error(`[feedback] #${card.iid} notes`, (e as Error).message);
        logError('job:feedback', e, { job: 'feedback', iid: card.iid });
      }
    }
    next.issues[card.iid] = { stage: card.stage, status, returned, qaNotes };

    // An issue or MR seen for the first time is only registered: its old notes are not news.
    if (before && returned && !before.returned) {
      const why = stageHit && statusHit ? cycleWord('cycle.feedback.whyBoth', { stage: card.stage ?? '', status: status ?? '' }) : stageHit ? cycleWord('cycle.feedback.whyStage', { stage: card.stage ?? '' }) : cycleWord('cycle.feedback.whyStatus', { status: status ?? '' });
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
        events.push({ kind: 'discussion', card, mr, count: r.fresh.length, first: `${first.author}: ${excerpt(first.body, 140)}` });
      }
    }
  });

  return { firstRun, checked: { issues: Object.keys(next.issues).length, mrs: Object.keys(next.mrs).length }, events, next };
}

function noticesFor(events: FeedbackEvent[]): Notice[] {
  if (events.length > MAX_NOTICES) {
    const refs = [...new Set(events.map((e) => `#${e.card.iid}`))].join(', ');
    return [{ title: t('main.feedback.returns', { count: events.length }), body: `${refs}\n${t('main.feedback.clickActivities')}`, onClick: { type: 'navigate', to: 'today' } }];
  }
  return events.map((e): Notice => {
    if (e.kind === 'returned') {
      return {
        title: t('main.feedback.returnedTitle', { iid: e.card.iid }),
        body: `${e.why}${e.note ? `\n${e.note}` : ''}\n${tv('notify.reentry.hint')}`,
        onClick: { type: 'open', screen: { name: 'reentry', ref: e.card.ref, card: e.card } },
      };
    }
    if (e.kind === 'qa-note') {
      return {
        title: t('main.feedback.qaNoteTitle', { where: e.where }),
        body: `${e.note}\n${tv('notify.reentry.hint')}`,
        onClick: { type: 'open', screen: { name: 'reentry', ref: e.card.ref, card: e.card } },
      };
    }
    return {
      title: t('main.feedback.discussionTitle', { count: e.count, mr: e.mr.ref }),
      body: `${e.first}\n${t('main.feedback.clickOneByOne')}`,
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
  return formatTime(new Date());
}

function reentryFile(iid: string): string {
  if (!/^\d+$/.test(iid)) throw new Error(t('main.feedback.badIssue'));
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
  const prov = vcsProvider();
  if (isIssueRef(card.ref)) {
    const project = issueProjectKey();
    const notes = await prov.listIssueComments(project, Number(card.iid));
    for (const n of notes.filter((x) => !x.system && x.author === qaUser())) {
      found.push({ id: Number(n.id), at: n.createdAt, where: `#${card.iid}`, excerpt: excerpt(n.body), body: n.body, url: n.webUrl ?? prov.noteUrl(rc().issues.project ?? project, 'issue', Number(card.iid), n.id) });
    }
  }
  for (const mr of card.mrPaths) {
    try {
      const all = await prov.listMrThreads(mr.project, mr.iid);
      for (const n of all.flatMap(realNotes).filter((x) => x.author === qaUser())) {
        found.push({ id: Number(n.id), at: n.createdAt, where: mr.ref, excerpt: excerpt(n.body), body: n.body, url: prov.noteUrl(mr.project, 'mr', mr.iid, n.id) });
      }
    } catch (e) {
      console.error(`[feedback] ${mr.ref}`, (e as Error).message);
      logError('job:feedback', e, { job: 'feedback', mr: mr.ref });
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at));
}

const CLASSES: ReentryClass[] = ['defeito-novo', 'causa-diferente', 'so-plano', 'ambiente'];
const PHASES: ReentryPhase[] = ['F1', 'F3', 'F4', 'nenhuma'];

export async function prepareReentry(card: Card): Promise<Reentry> {
  const notes = await qaNotesOf(card);
  const recent = notes.slice(0, 3);
  const qa = qaUser() || cp('reentry.qaUserFallback');
  const skill = pipelineSkill();
  const prompt = cp('reentry.main', {
    ref: card.ref,
    title: card.title,
    stage: card.stage ?? cp('reentry.noStage'),
    specPart: card.spec ? cp('reentry.spec', { folder: card.spec.folder, phase: card.spec.phase, completion: rc().specLayout.documents.completion.replace(/\.md$/i, '') }) : cp('reentry.noSpec'),
    mrs: JSON.stringify(card.mrPaths),
    notesPart: recent.length
      ? cp('reentry.notes', { qaUser: qa, notes: recent.map((n) => cp('reentry.note', { where: n.where, at: n.at, body: n.body.slice(0, 5000) }, { keepEmpty: ['body'] })).join('\n') })
      : cp('reentry.noNotes', { qaUser: qa }),
    pipelineLine: skill ? cp('reentry.pipelineLine', { skill }) : '',
  });
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
    why: r.data.duvida ? t('main.feedback.whyDoubt', { reason: r.data.motivo, doubt: r.data.duvida }) : r.data.motivo,
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
  if (!re) throw new Error(tv('err.reentryNotPrepared'));
  const mentioned = await answerCeremonyMentions(question, { thread: re.iid, ref: re.ref, title: re.title, msgs: re.talk.map((m) => ({ who: m.me ? 'me' : (m.agent ?? 'app'), text: m.text })) });
  const r = await askAgent<{ fala: string; texto: string }>(
    'deep',
    cp('reentry.ask', { ref: re.ref, question }),
    obj({ fala: str, texto: str }),
    { maxTurns: 12, ...(re.sessionId ? { resume: re.sessionId } : {}) },
  );
  re.sessionId = r.sessionId || re.sessionId;
  re.talk.push({ me: true, text: question, at: now() }, ...mentioned.map((m) => ({ me: false, agent: m.agent, text: m.text, speech: m.speech, at: now() })), { me: false, text: r.data.texto || r.data.fala, speech: r.data.fala, at: now(), ...(r.partial ? { partial: true } : {}) });
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
  if (!/^[\w=-]{1,64}$/.test(id)) throw new Error(t('main.feedback.badDiscussion'));
  return id;
}

function viewOf(d: VcsThread, stored: StoredDiscussion | undefined): DiscussionView {
  const notes = realNotes(d);
  const states = new Map(listActions().map((a) => [a.key, a.state]));
  const proposals: ProposalView[] = (stored?.proposals ?? []).map((p) => ({ ...p, state: states.get(p.key) ?? 'unknown' }));
  const explanation = stored?.explanation ?? null;
  return {
    id: d.id,
    path: d.path,
    line: d.line,
    notes: notes.map((n): DiscussionNote => ({ author: n.author, at: n.createdAt, body: n.body })),
    explanation: explanation ? { speech: explanation.speech, text: explanation.text, point: explanation.point, needsCode: explanation.needsCode, draft: explanation.draft, sessionId: explanation.sessionId, at: explanation.at, ...(explanation.partial ? { partial: true } : {}) } : null,
    stale: !!explanation && explanation.notes !== notes.length,
    proposals,
  };
}

export async function listDiscussions(mrIn: MrPath): Promise<DiscussionsResult> {
  const mr = checkMr(mrIn);
  const all = await vcsProvider().listMrThreads(mr.project, mr.iid);
  const store = readStore(mr);
  return { mr, fetchedAt: new Date().toISOString(), discussions: all.filter(isUnresolved).map((d) => viewOf(d, store[d.id])) };
}

export async function explainDiscussion(card: Card, mrIn: MrPath, id: string): Promise<DiscussionView> {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const d = await vcsProvider().getMrThread(mr.project, mr.iid, id);
  const notes = realNotes(d);
  const where = d.path ? `${d.path}:${d.line ?? '?'}` : cp('discussion.noLine');
  const prompt = cp('discussion.main', {
    mr: mr.ref,
    ref: card.ref,
    title: card.title,
    specLine: card.spec ? cp('discussion.specLine', { folder: card.spec.folder, phase: card.spec.phase }) : '',
    where,
    id,
    notes: notes.map((n) => cp('discussion.note', { author: n.author, at: n.createdAt, body: n.body.slice(0, 4000) }, { keepEmpty: ['body'] })).join('\n'),
    viewHint: cp('discussion.viewHint', { hint: mrChangesHint(mr.project, mr.iid) }),
  });
  const r = await askAgent<{ fala: string; texto: string; ponto: string; precisa_codigo: boolean; rascunho: string }>(
    'deep',
    prompt,
    obj({ fala: str, texto: str, ponto: str, precisa_codigo: { type: 'boolean' }, rascunho: str }),
    { maxTurns: 20 },
  );
  const store = readStore(mr);
  const explanation = { speech: r.data.fala, text: r.data.texto || r.data.fala, point: r.data.ponto, needsCode: r.data.precisa_codigo, draft: r.data.rascunho, sessionId: r.sessionId || null, at: new Date().toISOString(), notes: notes.length, ...(r.partial ? { partial: true } : {}) };
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

// Both writes only become proposals: nothing reaches the code host before "seguir" and the confirmation in the Actions screen.
export async function proposeReply(card: Card, mrIn: MrPath, id: string, bodyIn: string): Promise<ProposalView> {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const body = bodyIn.trim();
  if (!body) throw new Error(t('main.feedback.emptyReply'));
  if (body.length > 10_000) throw new Error(t('main.feedback.longReply'));
  const key = `mr-reply:${mr.ref}:${id}:${createHash('sha1').update(body).digest('hex').slice(0, 10)}`;
  const commands = await vcsProvider().planWrite({ op: 'replyThread', project: mr.project, iid: mr.iid, threadId: id, body });
  const [action] = proposeVcsCommands(
    {
      key,
      issue: Number(card.iid),
      issueTitle: card.title,
      stage: card.stage ?? '',
      summary: t('main.feedback.replySummary', { mr: mr.ref }),
      detail: t('main.feedback.replyDetail'),
    },
    commands,
  );
  if (!action) throw new Error(t('main.feedback.dupReply'));
  remember(mr, id, { key, kind: 'reply' });
  return { key, kind: 'reply', state: 'pending' };
}

export async function proposeResolve(card: Card, mrIn: MrPath, id: string): Promise<ProposalView> {
  const mr = checkMr(mrIn);
  checkDiscussionId(id);
  const key = `mr-resolve:${mr.ref}:${id}`;
  const commands = await vcsProvider().planWrite({ op: 'resolveThread', project: mr.project, iid: mr.iid, threadId: id });
  const [action] = proposeVcsCommands({ key, issue: Number(card.iid), issueTitle: card.title, stage: card.stage ?? '', summary: t('main.feedback.resolveSummary', { mr: mr.ref }) }, commands);
  if (!action) throw new Error(t('main.feedback.dupResolve'));
  remember(mr, id, { key, kind: 'resolve' });
  return { key, kind: 'resolve', state: 'pending' };
}

// ---------- registration ----------

export const register: Module = (ctx) => {
  ctx.job({ name: 'feedback', everyMin: 20, workHoursOnly: true, enabled: vcsReady, run: async () => void (await checkFeedback({ notify: ctx.notify })) });
  ctx.handle('feedback:reentry:get', getReentry);
  ctx.handle('feedback:reentry:prepare', prepareReentry);
  ctx.handle('feedback:reentry:ask', askReentry);
  ctx.handle('feedback:discussions:list', listDiscussions);
  ctx.handle('feedback:discussions:explain', explainDiscussion);
  ctx.handle('feedback:discussions:reply', proposeReply);
  ctx.handle('feedback:discussions:resolve', proposeResolve);
};
