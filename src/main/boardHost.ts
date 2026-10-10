import { createHash } from 'node:crypto';
import { type BoardCard, type BoardPatch, type BoardHostLink, type BoardTarget, type HostRequest, type HostSent, type Waiting, derivedFields } from '../shared/board';
import { type WrittenLabel, cardLabelChanges, issueBodyOf, issueLabelsOfCard, issueRefOfAnswer, moveLabels, stageLabel } from '../shared/boardHost';
import { boardAutonomous } from '../shared/config/autonomy';
import { squadsOf } from '../shared/config/squads';
import { t } from '../shared/i18n';
import type { ReleaseAction, VcsCommand } from '../shared/types';
import { listActions, onActionDone, onActionSkipped, proposeVcsGroup, runVcsAuto } from './actions';
import type { BoardHost } from './board';
import { boardStore } from './boardSource';
import { vcsName } from './cyclePrompts';
import { invalidateReport } from './report';
import { vcsProvider, vcsReady } from './vcs';
import { boardProjects, forgetHost, readBoard } from './vcs/boardRead';
import { cardRefContext } from './vcs/cardSource';
import { getConfig, issueProjectKey, rc } from './workspaceConfig';

// The board's one way to the code host, and the only file of the board that imports it and Actions: the board proper (`board.ts`) holds a port and nothing
// else, the same arrangement as the runner's door (`runner/door.ts`). Every write leaves through the same proposals, the same refusal in a test workspace and
// the same audit log as what a person starts by hand: the board's own autonomy only decides whether the person's "yes" comes first.

const BY = 'board';
const PURPOSE = 'board-';

const sha = (v: unknown): string => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 8);
const refOf = (project: string, iid: number): string => `${project}#${iid}`;

/** What the host will be asked, worked out before anything is sent or stored. */
interface Planned {
  op: 'create' | 'labels' | 'comment' | 'close' | 'reopen';
  cardId: string | null;
  project: string;
  /** The issue's number; 0 for one that does not exist yet. */
  iid: number;
  issueTitle: string;
  commands: VcsCommand[];
  summary: string;
  key: string;
  bodyHash: string | undefined;
}

/** Why a column cannot be written: no stage by that name, or a mapping rule would read the label as another column. */
function refusal(written: Extract<WrittenLabel, { refused: string }>, column: string): string {
  if (written.refused === 'shadowed') return t('main.board.noRoundTrip', { column, rule: written.rule.pattern, label: stageLabel(column) });
  return t('main.board.unknownColumn', { column });
}

/** The card a request names, and the issue it stands for: its link, or the project and number of a listed issue. */
function resolve(target: BoardTarget): { card: BoardCard | null; project: string; iid: number | null } {
  if (typeof target !== 'string') {
    // A listed issue is one of the projects the board lists; the board is not a way to write to any issue the token reaches.
    const listed = boardProjects(vcsProvider().id).find((p) => p.toLowerCase() === target.project.toLowerCase());
    if (!listed) throw new Error(t('main.board.host.notBoardProject', { project: target.project }));
    return { card: null, project: listed, iid: target.iid };
  }
  const card = boardStore().get(target);
  if (!card) throw new Error(t('main.board.missing', { id: target }));
  // A number on another host is another issue: a card linked there is not written here.
  if (card.host && card.host.vcs !== vcsProvider().kind) throw new Error(t('main.board.host.elsewhere', { host: card.host.vcs }));
  return { card, project: card.host?.project ?? '', iid: card.host?.iid ?? null };
}

async function plan(req: HostRequest): Promise<Planned> {
  const provider = vcsProvider();
  const config = getConfig();
  const cycle = config.devCycle;
  const { card, project, iid } = resolve(req.target);
  const change = req.change;
  const cardId = card?.id ?? null;
  const where = cardId ?? `host:${project}#${iid}`;

  if (change.kind === 'create') {
    if (!card) throw new Error(t('main.board.missing', { id: String(req.target) }));
    if (card.host) throw new Error(t('main.board.alreadySent', { ref: refOf(card.host.project, card.host.iid) }));
    const issueProject = issueProjectKey();
    const { labels, written } = issueLabelsOfCard(cycle, provider.kind, card, cycle.priority.labels);
    // A column that would read back as another one is not written: the card stays local with the reason instead of landing in the wrong column.
    if ('refused' in written && provider.caps.issueLabels) throw new Error(refusal(written, card.column));
    const body = issueBodyOf(card, t('main.board.host.notesSoFar'));
    const commands = await provider.planWrite({ op: 'createIssue', project: issueProject, title: card.title, body, labels: provider.caps.issueLabels ? labels : [] });
    return { op: 'create', cardId, project: issueProject, iid: 0, issueTitle: card.title, commands, summary: t('main.board.host.summary.create', { title: card.title, project: issueProject }), key: `board:${card.id}:create`, bodyHash: sha(body) };
  }

  if (iid === null || !project) throw new Error(t('main.board.host.noIssue'));
  const ref = refOf(project, iid);
  const issueTitle = card?.title ?? ref;

  if (change.kind === 'comment') {
    const commands = await provider.planWrite({ op: 'commentIssue', project, iid, body: change.text });
    return { op: 'comment', cardId, project, iid, issueTitle, commands, summary: t('main.board.host.summary.comment', { ref }), key: `board:${where}:comment:${sha(commands)}`, bodyHash: sha(change.text) };
  }
  if (change.kind === 'close' || change.kind === 'reopen') {
    const commands = await provider.planWrite({ op: change.kind === 'close' ? 'closeIssue' : 'reopenIssue', project, iid });
    return { op: change.kind, cardId, project, iid, issueTitle, commands, summary: t(`main.board.host.summary.${change.kind}`, { ref }), key: `board:${where}:${change.kind}:${sha(commands)}`, bodyHash: undefined };
  }

  // A column, a priority and a squad are labels of the issue: read it now, so only labels it carries are taken off and none it already has is added again.
  if (!provider.caps.issueLabels) throw new Error(t('main.board.noLabelsItem', { host: vcsName() }));
  const issue = await provider.getIssue(project, iid);
  const add: string[] = [];
  const remove: string[] = [];
  if (change.column !== undefined) {
    const moved = moveLabels(cycle, provider.kind, issue.labels, change.column);
    if ('refused' in moved.written) throw new Error(refusal(moved.written, change.column));
    add.push(...moved.add);
    remove.push(...moved.remove);
  }
  if (change.priority !== undefined || change.squad !== undefined) {
    const ctx = { levels: cycle.priority.labels, squads: squadsOf(config) };
    const old = derivedFields(issue.labels, ctx);
    const next = { priority: change.priority !== undefined ? change.priority : old.priority, squad: change.squad !== undefined ? change.squad : old.squad };
    const c = cardLabelChanges(old, next, { ...ctx, issueLabels: issue.labels });
    add.push(...c.add);
    remove.push(...c.remove);
  }
  const lower = (l: string): string => l.toLowerCase();
  const once = (list: string[]): string[] => list.filter((l, i) => list.findIndex((o) => lower(o) === lower(l)) === i);
  const adds = once(add);
  const removes = once(remove).filter((l) => !adds.some((a) => lower(a) === lower(l)));
  const commands = adds.length || removes.length ? await provider.planWrite({ op: 'setIssueLabels', project, iid, add: adds, remove: removes }) : [];
  const changes = [...adds.map((l) => `+${l}`), ...removes.map((l) => `-${l}`)].join(' ');
  return { op: 'labels', cardId, project, iid, issueTitle, commands, summary: t('main.board.host.summary.labels', { ref, changes: changes || '-' }), key: `board:${where}:labels:${sha(commands)}`, bodyHash: undefined };
}

/** The link a creation left, from what the host answered; null when it did not say the number. */
function linkOf(answer: unknown, project: string): BoardHostLink | null {
  const provider = vcsProvider();
  const { iid, url } = issueRefOfAnswer(answer);
  if (iid === null) return null;
  const path = cardRefContext().issueProject ?? project;
  return { vcs: provider.kind, project: path, iid, url: url ?? provider.issueUrl(path, iid), linkedAt: new Date().toISOString() };
}

/** What the board read of the host is stale once it wrote: the next read asks again, and the day's listing is read again too. */
function stale(): void {
  forgetHost();
  invalidateReport();
}

/** The proposals of the board that still wait (or failed when approved), by card id or `<project>#<iid>`. */
function waiting(): Map<string, Waiting> {
  const out = new Map<string, Waiting>();
  for (const a of listActions()) {
    const purpose = a.unit?.purpose;
    if (typeof purpose !== 'string' || !purpose.startsWith(PURPOSE)) continue;
    if (a.state !== 'pending' && a.state !== 'running' && a.state !== 'failed') continue;
    const key = typeof a.unit?.cardId === 'string' ? a.unit.cardId : refOf(String(a.unit?.project), Number(a.unit?.iid));
    const before = out.get(key);
    out.set(key, { kinds: [...(before?.kinds ?? []), purpose.slice(PURPOSE.length)], failed: (before ? before.failed : true) && a.state === 'failed', actionId: before?.actionId ?? a.id });
  }
  return out;
}

/** One change of the same kind waits at a time for a target: two computed against the same state of the issue could disagree once both are approved. */
function exclusive(p: Planned): void {
  const here = waiting().get(p.cardId ?? refOf(p.project, p.iid));
  const kinds = here?.kinds ?? [];
  const clash = p.op === 'labels' ? kinds.includes('labels') : p.op === 'close' || p.op === 'reopen' ? kinds.some((k) => k === 'close' || k === 'reopen') : false;
  if (clash) throw new Error(t('main.board.host.alreadyWaiting', { ref: p.iid ? refOf(p.project, p.iid) : p.issueTitle }));
}

async function runNow(p: Planned): Promise<HostSent> {
  const answers: unknown[] = [];
  try {
    for (const [i, command] of p.commands.entries()) {
      answers.push(await runVcsAuto({ issue: p.iid, key: p.commands.length > 1 ? `${p.key}#${i + 1}` : p.key, summary: p.summary, by: BY, ...(p.bodyHash ? { bodyHash: p.bodyHash } : {}) }, command));
    }
  } finally {
    stale();
  }
  const link = p.op === 'create' ? linkOf(answers[0], p.project) : null;
  return { mode: 'ran', summary: p.summary, ...(link ? { link } : {}) };
}

function propose(p: Planned, req: HostRequest): HostSent {
  exclusive(p);
  const unit = { purpose: `${PURPOSE}${p.op}`, cardId: p.cardId, project: p.project, iid: p.iid, effect: req.effect ?? null, ...(req.batch ? { batch: req.batch.id } : {}) };
  // The proposals of one "Send all" are one batch in Actions and one notification, from the first.
  const notify = req.batch && !req.batch.notify ? undefined : { title: t('main.board.host.notifyTitle'), body: p.summary };
  // A proposal that was approved stays in the list as done, and its key would refuse the same change again (close, reopen, close; a move out and back):
  // every change but the creation (one issue per card) gets a key of its own. `exclusive` already refuses a second change of a kind while one waits.
  const key = p.op === 'create' ? p.key : `${p.key}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const action = proposeVcsGroup({ key, issue: p.iid, issueTitle: p.issueTitle, summary: p.summary, unit, ...(notify ? { notify } : {}) }, p.commands);
  if (!action) throw new Error(t('main.board.host.alreadyWaiting', { ref: p.iid ? refOf(p.project, p.iid) : p.issueTitle }));
  return { mode: 'proposed', summary: p.summary, actionId: action.id };
}

// ---- what becomes of a proposal of the board

const settled = new Set<() => void>();
let started = false;

const isBoard = (a: ReleaseAction): boolean => typeof a.unit?.purpose === 'string' && a.unit.purpose.startsWith(PURPOSE);

/** Brings the card's copy up to what the person approved: a creation links it, any other change applies the effect it was proposed with. */
function done(action: ReleaseAction, responses: unknown[]): void {
  if (!isBoard(action)) return;
  stale();
  const unit = action.unit ?? {};
  const cardId = typeof unit.cardId === 'string' ? unit.cardId : null;
  if (cardId) {
    try {
      if (unit.purpose === `${PURPOSE}create`) {
        const link = linkOf(responses[0], String(unit.project));
        if (link) boardStore().link(cardId, link);
        else boardStore().note(cardId, { kind: 'unlinked', text: t('main.board.host.unlinked') });
      } else if (unit.effect && typeof unit.effect === 'object') {
        boardStore().update(cardId, unit.effect as BoardPatch);
      }
    } catch (e) {
      console.error('[board] could not bring the card up to the host', (e as Error).message);
    }
  }
  for (const fn of settled) fn();
}

/** A proposal of the board the person set aside: a card that was to be opened on the host says so and can be sent again. */
function skipped(action: ReleaseAction): void {
  if (!isBoard(action)) return;
  const cardId = typeof action.unit?.cardId === 'string' ? action.unit.cardId : null;
  if (cardId && action.unit?.purpose === `${PURPOSE}create`) {
    try {
      boardStore().note(cardId, { kind: 'declined', text: t('main.board.host.declined') });
    } catch (e) {
      console.error('[board] could not note the declined card', (e as Error).message);
    }
  }
  for (const fn of settled) fn();
}

/** Listens, once, to what becomes of the board's proposals in Actions. A proposal that fails when approved has no listener: the board reads it from the list. */
export function startBoardHost(): void {
  if (started) return;
  started = true;
  onActionDone(done);
  onActionSkipped(skipped);
}

export const realBoardHost: BoardHost = {
  ready: () => vcsReady(),
  name: () => vcsName(),
  kind: () => {
    try {
      return vcsProvider().kind;
    } catch {
      return null;
    }
  },
  labels: () => {
    try {
      return vcsProvider().caps.issueLabels;
    } catch {
      return false;
    }
  },
  cannotSend() {
    if (!vcsReady()) return t('main.board.host.notReady');
    if (!vcsProvider().caps.issues) return t('main.board.host.noTracker', { host: vcsName() });
    const issues = rc().issues;
    if (issues.vcsId && issues.vcsId !== rc().primaryVcs?.id) return t('main.board.host.noIssueProject');
    try {
      issueProjectKey();
    } catch {
      return t('main.board.host.noIssueProject');
    }
    return null;
  },
  read: (refresh) => readBoard(refresh),
  async send(req) {
    const planned = await plan(req);
    // Nothing to ask the host for (a label it already has): the board's copy changes at once.
    if (!planned.commands.length) return { mode: 'ran', summary: planned.summary };
    return boardAutonomous(getConfig()) ? runNow(planned) : propose(planned, req);
  },
  waiting,
  onSettled(fn) {
    settled.add(fn);
    startBoardHost();
  },
};
