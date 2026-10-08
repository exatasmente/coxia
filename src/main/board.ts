import { randomBytes } from 'node:crypto';
import { SEND_ALL_MAX, type BoardCard, type BoardPatch, type BoardTarget, type SendAllResult, type HostChange, type HostRead, type HostRequest, type HostSent, type HostState, type Waiting, boardColumns, boardId, boardPriorities, boardSquadChoices, columnLabel, columnOf, squadLabel } from '../shared/board';
import { writtenLabel } from '../shared/boardHost';
import type { VcsKind } from '../shared/config/types';
import { squadsOf } from '../shared/config/squads';
import { t } from '../shared/i18n';
import type { AppEvent } from '../shared/types';
import { boardStore } from './boardSource';
import { cycle, language } from './cyclePrompts';
import type { Module, ModuleContext } from './module';
import { assertExternalWrite } from './workspace';
import { getConfig, rc } from './workspaceConfig';

// The workspace's own board. A card lives in a file the workspace owns, its channels change it, and every write goes through the same guard as the rest of
// the app (a test workspace refuses to open, move, comment, prioritise or close a card). With a usable code host the same channels also reach it — but only
// through the port below, which `index.ts` hands in: nothing in this file imports the host or Actions, and the test that pins it walks the imports. A write
// to the host is a proposal that waits for the person's "yes", or goes straight through the audited door when the board's own autonomy is on.

const EVENT = 'board:changed';

let deps: { emit(ev: AppEvent): void } | null = null;

/** What the board needs of a code host. The real one is `boardHost.ts`; the default is a host that is never ready, which is the board of a workspace with none. */
export interface BoardHost {
  /** The workspace has a code host the app can use right now. */
  ready(): boolean;
  /** The host's name for the screen, or null. */
  name(): string | null;
  kind(): VcsKind | null;
  /** The host's issues have labels (Bitbucket's do not): a column, a priority and a squad can be written there. */
  labels(): boolean;
  /** Why a card cannot become an issue now (no issue project, no issue tracker), else null. */
  cannotSend(): string | null;
  /** Reads the host: the project listing and the issues the board tracks (cached; `refresh` asks again). null: no usable host. */
  read(refresh: boolean): Promise<HostRead | null>;
  /** Plans the write and, by the board's autonomy, runs it audited or proposes it in Actions. Throws a reason a person can read. */
  send(request: HostRequest): Promise<HostSent>;
  /** What waits in Actions, by card id or `<project>#<iid>`. */
  waiting(): Map<string, Waiting>;
  /** Tells `fn` when a proposal of the board was carried out or set aside, after the board's copy was brought up to it. */
  onSettled(fn: () => void): void;
}

const NO_HOST: BoardHost = {
  ready: () => false,
  name: () => null,
  kind: () => null,
  labels: () => false,
  cannotSend: () => t('main.board.host.notReady'),
  read: async () => null,
  send: async () => {
    throw new Error(t('main.board.host.notReady'));
  },
  waiting: () => new Map(),
  onSettled: () => undefined,
};
let host: BoardHost = NO_HOST;

/** The host the board talks to; called once, before the modules are registered. */
export function setBoardHost(next: BoardHost): void {
  host = next;
}

/** What waits in Actions for the board's cards, for the day to say so. */
export function boardWaiting(): Map<string, Waiting> {
  return host.waiting();
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const optional = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A card as the screen sees it: the card, where it stands in relation to the host, and what waits for it in Actions. */
export type BoardCardView = BoardCard & { hostState: HostState; waiting: Waiting | null };

/** Where a column is written on the host: the label, and whether it is the mapping's, the app's own default, or cannot be written. */
export interface ColumnWrite {
  label: string | null;
  by: 'mapping' | 'default' | 'refused';
}

function columnWrite(id: string): ColumnWrite | null {
  const kind = host.kind();
  if (!host.ready() || !host.labels() || !kind) return null;
  const w = writtenLabel(cycle(), kind, id);
  return 'refused' in w ? { label: null, by: 'refused' } : { label: w.label, by: w.by };
}

/** What the screen needs: the columns, the priorities, the squads a card may go to, the repositories, the cards, and what the host says. */
export async function boardView(refresh = false) {
  const config = getConfig();
  const ready = host.ready();
  const read = ready ? await host.read(refresh) : null;
  const waiting = ready ? host.waiting() : new Map<string, Waiting>();
  const cards: BoardCardView[] = boardStore()
    .list()
    .map((card) => {
      const wait = waiting.get(card.id) ?? null;
      if (!ready) return { ...card, hostState: 'none' as const, waiting: null };
      const seen = read?.seen[card.id];
      const state: HostState = wait ? (wait.failed ? 'failed' : 'waiting') : !card.host ? 'notSent' : seen === 'missing' || seen === 'unread' ? seen : 'linked';
      return { ...card, hostState: state, waiting: wait };
    });
  const items = (read?.items ?? []).map((item) => ({ ...item, waiting: waiting.get(`${item.project}#${item.iid}`) ?? null }));
  const reason = ready ? host.cannotSend() : null;
  return {
    host: ready ? { name: host.name(), labels: host.labels(), readAt: read?.at ?? null, error: read?.error ?? null, cannotSend: reason } : null,
    projects: read?.projects ?? [],
    noProject: read?.noProject ?? false,
    items,
    sendable: ready && !reason ? sendableCards().length : 0,
    columns: boardColumns(cycle().stages).map((s) => ({ id: s.id, label: columnLabel(s.label, s.kind, language()), writes: columnWrite(s.id) })),
    priorities: boardPriorities(cycle().priority.labels),
    squads: boardSquadChoices(squadsOf(config), config.language),
    squadCount: squadsOf(config).length,
    repos: rc().repos.map((r) => ({ id: r.id, label: r.id })),
    cards,
  };
}

function changed<T extends BoardCard | null>(card: T): T {
  deps?.emit({ type: 'module', name: EVENT, payload: { cards: boardStore().list() } });
  return card;
}

function required(id: string): BoardCard {
  const card = boardStore().get(id);
  if (!card) throw new Error(t('main.board.missing', { id }));
  return card;
}

/** The column a card may sit in: one of the stages the workspace configured, else the reason. */
function checkedColumn(id: string): string {
  const column = optional(id);
  if (!column || !columnOf(cycle().stages, column)) throw new Error(t('main.board.unknownColumn', { column: column ?? '' }));
  return column;
}

/** Giving a card to a squad writes the squad's own label: that is how the cards' scope claims a card with no host. */
function checkedSquad(id: string | null): { squad: string | null; label: string | null } {
  if (!id) return { squad: null, label: null };
  const squad = squadsOf(getConfig()).find((s) => s.id === id);
  if (!squad) throw new Error(t('main.squad.unknown', { id }));
  const label = squadLabel(squad);
  if (!label) throw new Error(t('main.board.squadNoLabel', { squad: id }));
  return { squad: squad.id, label };
}

/** The label a squad id stands for on the board, or null when the config no longer has that squad or it names no label. */
function labelOfSquad(id: string | null): string | null {
  const squad = squadsOf(getConfig()).find((s) => s.id === id);
  return squad ? squadLabel(squad) : null;
}

function checkedPriority(value: string | null): string | null {
  if (!value) return null;
  const found = boardPriorities(cycle().priority.labels).find((l) => l.toLowerCase() === value.toLowerCase());
  if (!found) throw new Error(t('main.board.unknownPriority', { value }));
  return found;
}

function checkedRepo(id: string | null): string | null {
  if (!id) return null;
  if (!rc().repos.some((r) => r.id === id)) throw new Error(t('main.board.unknownRepo', { repo: id }));
  return id;
}

/** A card id, or an issue the host lists by its project and number. */
function targetOf(v: unknown): BoardTarget {
  if (typeof v === 'string') return v;
  const o = (v ?? {}) as { project?: unknown; iid?: unknown };
  if (typeof o.project === 'string' && o.project.trim() && typeof o.iid === 'number' && Number.isSafeInteger(o.iid) && o.iid > 0) return { project: o.project.trim(), iid: o.iid };
  throw new Error(t('main.board.badTarget'));
}

/** A card with a proposal waiting in Actions carries the exact command it will run, so nothing about it changes until that is decided. */
function unlocked(card: BoardCard): void {
  if (host.waiting().get(card.id)?.kinds.includes('create')) throw new Error(t('main.board.waiting'));
  if (card.host && !host.ready()) throw new Error(t('main.board.hostGone'));
}

/** An issue the host lists can be written only while the host is usable. */
function itemReady(): void {
  if (!host.ready()) throw new Error(t('main.board.host.notReady'));
}

// ---- a card going to the host

const inFlight = new Set<string>();

/** The outcome of sending one card, and the reason when it did not go. */
interface Sending {
  outcome: 'sent' | 'proposed' | 'failed';
  reason: string | null;
}

/** Sends one card that has no issue yet and leaves the outcome on the card (a link, or a note with the reason). Never throws: the card exists whatever the host does. */
async function sendCard(id: string, batch?: HostRequest['batch']): Promise<Sending> {
  const store = boardStore();
  const why = host.cannotSend();
  if (why) {
    store.note(id, { kind: 'unsupported', text: why });
    return { outcome: 'failed', reason: why };
  }
  if (inFlight.has(id)) return { outcome: 'failed', reason: t('main.board.inFlight') };
  inFlight.add(id);
  try {
    const sent = await host.send({ target: id, change: { kind: 'create' }, ...(batch ? { batch } : {}) });
    if (sent.mode === 'proposed') {
      store.note(id, null);
      return { outcome: 'proposed', reason: null };
    }
    if (sent.link) {
      store.link(id, sent.link);
      return { outcome: 'sent', reason: null };
    }
    const text = t('main.board.host.unlinked');
    store.note(id, { kind: 'unlinked', text });
    return { outcome: 'failed', reason: text };
  } catch (e) {
    const text = (e as Error).message;
    store.note(id, { kind: 'failed', text });
    return { outcome: 'failed', reason: text };
  } finally {
    inFlight.delete(id);
  }
}

/** Whether a card can be sent now: open, no issue, nothing waiting for it, and not being sent. The reason when not. */
function sendable(card: BoardCard, waiting: Map<string, Waiting> = host.waiting()): string | null {
  if (card.host) return t('main.board.alreadySent', { ref: `${card.host.project}#${card.host.iid}` });
  if (card.state !== 'open') return t('main.board.sendClosed');
  if (waiting.get(card.id)) return t('main.board.waiting');
  if (inFlight.has(card.id)) return t('main.board.inFlight');
  return null;
}

/** The cards "Send all" would send, oldest first. */
function sendableCards(): BoardCard[] {
  const waiting = host.waiting();
  return boardStore()
    .list()
    .filter((c) => sendable(c, waiting) === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---- the writes that change a card, planned (checked) before the guard and run after it

type Plan =
  | { kind: 'none'; card: BoardCard }
  /** The card's own file only: a card with no issue, or a host with no labels for a column, a priority and a squad. */
  | { kind: 'local'; id: string; effect: BoardPatch }
  | { kind: 'card'; id: string; change: HostChange; effect: BoardPatch }
  | { kind: 'item'; target: BoardTarget; change: HostChange };

/** What the change of a card does: to the board's file, or to the host too. A card with no issue never reaches the host. */
function planCard(card: BoardCard, change: HostChange, effect: BoardPatch): Plan {
  unlocked(card);
  return card.host ? { kind: 'card', id: card.id, change, effect } : { kind: 'local', id: card.id, effect };
}

async function run(plan: Plan): Promise<BoardCard | null> {
  const store = boardStore();
  if (plan.kind === 'none') return plan.card;
  if (plan.kind === 'local') return changed(store.update(plan.id, plan.effect));
  if (plan.kind === 'item') {
    await host.send({ target: plan.target, change: plan.change });
    return changed(null);
  }
  // A proposal changes nothing here: the copy follows once the person said yes, and the screen says the card is waiting.
  const sent = await host.send({ target: plan.id, change: plan.change, effect: plan.effect });
  return changed(sent.mode === 'ran' ? store.update(plan.id, plan.effect) : required(plan.id));
}

export const register: Module = (ctx: ModuleContext) => {
  deps = { emit: ctx.emit };
  host.onSettled(() => changed(null));
  ctx.handle('board:list', (refresh?: unknown) => boardView(refresh === true));
  ctx.handle('board:create', async (input: unknown) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const title = text(o.title).trim();
    if (!title) throw new Error(t('main.board.noTitle'));
    const column = checkedColumn(text(o.column));
    const { squad, label } = checkedSquad(optional(o.squad));
    const priority = checkedPriority(optional(o.priority));
    const repo = checkedRepo(optional(o.repo));
    const labels = [...new Set([...(label ? [label] : []), ...(Array.isArray(o.labels) ? o.labels.map(text).filter(Boolean) : [])])];
    assertExternalWrite(t('main.board.what'));
    const card = boardStore().create({ id: boardId(randomBytes(16)), title, body: text(o.body), column, squad, priority, labels, repo });
    // Saved first, so the card exists whatever happens next; the host then gets it, or a proposal waits, or the card says why it did not.
    if (host.ready()) await sendCard(card.id);
    return changed(boardStore().get(card.id) ?? card);
  });
  ctx.handle('board:send', async (id: unknown) => {
    const card = required(text(id));
    const why = sendable(card);
    if (why) throw new Error(why);
    if (!host.ready()) throw new Error(t('main.board.host.notReady'));
    const cannot = host.cannotSend();
    if (cannot) throw new Error(cannot);
    assertExternalWrite(t('main.board.what'));
    await sendCard(card.id);
    return changed(boardStore().get(card.id) ?? card);
  });
  ctx.handle('board:sendAll', async (): Promise<SendAllResult> => {
    assertExternalWrite(t('main.board.what'));
    if (!host.ready()) throw new Error(t('main.board.host.notReady'));
    const cannot = host.cannotSend();
    if (cannot) throw new Error(cannot);
    const all = sendableCards();
    const chosen = all.slice(0, SEND_ALL_MAX);
    const batch = `board-send-${Date.now().toString(36)}`;
    const result: SendAllResult = { sent: 0, proposed: 0, failed: [], remaining: all.length - chosen.length };
    // One after the other, never in parallel: the audit stays in order and a host's rate limit is not hit by a burst. One that fails does not stop the rest.
    for (const [i, first] of chosen.entries()) {
      // Looked at again right before it goes: the person may have sent it by hand, or something may be waiting for it, since the cards were chosen.
      const card = boardStore().get(first.id);
      if (!card || sendable(card) !== null) continue;
      const { outcome, reason } = await sendCard(card.id, { id: batch, notify: i === 0 });
      if (outcome === 'sent') result.sent++;
      else if (outcome === 'proposed') result.proposed++;
      else result.failed.push({ id: card.id, reason: reason ?? '' });
    }
    changed(null);
    return result;
  });
  ctx.handle('board:update', async (targetArg: unknown, patch: unknown) => {
    const target = targetOf(targetArg);
    const p = (patch ?? {}) as Record<string, unknown>;
    const plan = planUpdate(target, p);
    assertExternalWrite(t('main.board.what'));
    return run(plan);
  });
  ctx.handle('board:comment', async (targetArg: unknown, body: unknown) => {
    const target = targetOf(targetArg);
    const comment = text(body).trim();
    if (!comment) throw new Error(t('main.board.noComment'));
    const plan = planState(target, { kind: 'comment', text: comment }, { comment });
    assertExternalWrite(t('main.board.what'));
    return run(plan);
  });
  ctx.handle('board:close', async (targetArg: unknown) => {
    const plan = planState(targetOf(targetArg), { kind: 'close' }, { state: 'closed' });
    assertExternalWrite(t('main.board.what'));
    return run(plan);
  });
  ctx.handle('board:reopen', async (targetArg: unknown) => {
    const plan = planState(targetOf(targetArg), { kind: 'reopen' }, { state: 'open' });
    assertExternalWrite(t('main.board.what'));
    return run(plan);
  });
};

/** Comment, close and reopen: the card's file for a card with no issue, the issue for a card that has one or a listed issue. */
function planState(target: BoardTarget, change: HostChange, effect: BoardPatch): Plan {
  if (typeof target !== 'string') {
    itemReady();
    return { kind: 'item', target, change };
  }
  return planCard(required(target), change, effect);
}

function planUpdate(target: BoardTarget, p: Record<string, unknown>): Plan {
  if (typeof target !== 'string') return planItemUpdate(target, p);
  const card = required(target);
  unlocked(card);
  const out: BoardPatch = {};
  if (card.host && (p.title !== undefined || p.body !== undefined)) throw new Error(t('main.board.hostOwnsText'));
  if (p.title !== undefined) {
    const title = text(p.title).trim();
    if (!title) throw new Error(t('main.board.noTitle'));
    out.title = title;
  }
  if (p.body !== undefined) out.body = text(p.body);
  if (p.column !== undefined) out.column = checkedColumn(text(p.column));
  if (p.squad !== undefined) {
    const { squad, label } = checkedSquad(optional(p.squad));
    out.squad = squad;
    const asked = Array.isArray(p.labels) ? p.labels.map(text).filter(Boolean) : undefined;
    // Giving it to a squad adds that squad's label; taking it back from one takes off the label of the squad it was in.
    const previous = squad ? null : labelOfSquad(card.squad);
    const kept = (asked ?? card.labels).filter((l) => l !== previous);
    out.labels = squad && label ? [...new Set([...kept, label])] : kept;
  }
  if (p.priority !== undefined) out.priority = checkedPriority(optional(p.priority));
  if (p.labels !== undefined && p.squad === undefined && !card.host) out.labels = Array.isArray(p.labels) ? p.labels.map(text).filter(Boolean) : [];
  if (!card.host || !host.labels()) return { kind: 'local', id: card.id, effect: out };
  // On the host a column, a priority and a squad are labels of the issue: only what differs from the card goes out.
  const change: HostChange = { kind: 'labels' };
  if (out.column !== undefined && out.column !== card.column) change.column = out.column;
  if (out.priority !== undefined && (out.priority ?? '') !== (card.priority ?? '')) change.priority = out.priority;
  if (out.squad !== undefined && (out.squad ?? '') !== (card.squad ?? '')) change.squad = out.squad;
  if (change.column === undefined && change.priority === undefined && change.squad === undefined) return { kind: 'none', card };
  return { kind: 'card', id: card.id, change, effect: out };
}

/** A listed issue: column, priority and squad are its labels; its title and description are the host's. */
function planItemUpdate(target: { project: string; iid: number }, p: Record<string, unknown>): Plan {
  itemReady();
  if (p.title !== undefined || p.body !== undefined) throw new Error(t('main.board.hostOwnsText'));
  if (!host.labels()) throw new Error(t('main.board.noLabelsItem', { host: host.name() ?? '' }));
  const change: HostChange = { kind: 'labels' };
  if (p.column !== undefined) change.column = checkedColumn(text(p.column));
  if (p.priority !== undefined) change.priority = checkedPriority(optional(p.priority));
  if (p.squad !== undefined) change.squad = checkedSquad(optional(p.squad)).squad;
  if (change.column === undefined && change.priority === undefined && change.squad === undefined) throw new Error(t('main.board.noChange'));
  return { kind: 'item', target, change };
}
