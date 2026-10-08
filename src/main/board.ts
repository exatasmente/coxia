import { randomBytes } from 'node:crypto';
import { type BoardCard, type BoardPatch, type HostRead, type HostState, boardColumns, boardId, boardPriorities, boardSquadChoices, columnLabel, columnOf, squadLabel } from '../shared/board';
import { squadsOf } from '../shared/config/squads';
import { t } from '../shared/i18n';
import type { AppEvent } from '../shared/types';
import { boardStore } from './boardSource';
import { cycle, language, text as cycleText } from './cyclePrompts';
import type { Module, ModuleContext } from './module';
import { assertExternalWrite } from './workspace';
import { getConfig, rc } from './workspaceConfig';

// The workspace's own board: the cards no code host holds. The file lives in the workspace data folder, its channels change it, and every write
// goes through the same guard as the rest of the app (a test workspace refuses to open, move, comment, prioritise or close a card). Nothing here
// proposes or runs a write to a code host, and nothing here starts a run: a run still begins with an issue read from the host.

const EVENT = 'board:changed';

let deps: { emit(ev: AppEvent): void } | null = null;

/**
 * What the board needs of a code host, as a port: `index.ts` hands the real one in once (`boardHost.ts`, the only board file that reaches the host), so this
 * file never imports `./vcs` or `./actions` and the test that pins it walks the imports. Its default is a host that is never ready, which is the board of a
 * workspace with no code host.
 */
export interface BoardHost {
  /** The workspace has a code host the app can use right now. */
  ready(): boolean;
  /** The host's name for the screen, or null. */
  name(): string | null;
  /** The host's issues have labels (Bitbucket's do not): a column, a priority and a squad can be written there. */
  labels(): boolean;
  /** Reads the host: the project listing and the issues the board tracks (cached; `refresh` asks again). null: no usable host. */
  read(refresh: boolean): Promise<HostRead | null>;
}

const NO_HOST: BoardHost = { ready: () => false, name: () => null, labels: () => false, read: async () => null };
let host: BoardHost = NO_HOST;

/** The host the board talks to; called once, before the modules are registered. */
export function setBoardHost(next: BoardHost): void {
  host = next;
}

/** Whether the workspace has a code host the app can read: what decides if the board is offered at all (until a card of a host workspace may be written). */
export function boardAvailable(): boolean {
  return !host.ready();
}

/** Nothing of the board is written where the board is not offered: the same test the day's cards make before they read the host. */
function checked(): void {
  if (!boardAvailable()) throw new Error(t('main.board.noHost'));
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const optional = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A card as the screen sees it: the card, and where it stands in relation to the host. */
export type BoardCardView = BoardCard & { hostState: HostState };

/** What the screen needs: the columns, the priorities, the squads a card may go to, the repositories, the cards, and what the host says. */
export async function boardView(refresh = false) {
  const config = getConfig();
  const ready = host.ready();
  const read = ready ? await host.read(refresh) : null;
  const cards: BoardCardView[] = boardStore()
    .list()
    .map((card) => {
      if (!ready) return { ...card, hostState: 'none' as const };
      const seen = read?.seen[card.id];
      return { ...card, hostState: !card.host ? ('notSent' as const) : seen === 'missing' || seen === 'unread' ? seen : ('linked' as const) };
    });
  return {
    available: boardAvailable(),
    host: ready ? { name: host.name(), labels: host.labels(), readAt: read?.at ?? null, error: read?.error ?? null } : null,
    projects: read?.projects ?? [],
    noProject: read?.noProject ?? false,
    items: read?.items ?? [],
    columns: boardColumns(cycle().stages).map((s) => ({ id: s.id, label: columnLabel(s.label, s.kind, language()) })),
    priorities: boardPriorities(cycle().priority.labels),
    squads: boardSquadChoices(squadsOf(config), config.language),
    squadCount: squadsOf(config).length,
    repos: rc().repos.map((r) => ({ id: r.id, label: r.id })),
    cards,
  };
}

function changed(card: BoardCard): BoardCard {
  deps?.emit({ type: 'module', name: EVENT, payload: { cards: boardStore().list() } });
  return card;
}

function required(id: string): void {
  if (!boardStore().get(id)) throw new Error(t('main.board.missing', { id }));
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

export const register: Module = (ctx: ModuleContext) => {
  deps = { emit: ctx.emit };
  ctx.handle('board:list', (refresh?: unknown) => boardView(refresh === true));
  ctx.handle('board:create', (input: unknown) => {
    checked();
    const o = (input ?? {}) as Record<string, unknown>;
    const title = text(o.title).trim();
    if (!title) throw new Error(t('main.board.noTitle'));
    const column = checkedColumn(text(o.column));
    const { squad, label } = checkedSquad(optional(o.squad));
    const priority = checkedPriority(optional(o.priority));
    const repo = checkedRepo(optional(o.repo));
    const labels = [...new Set([...(label ? [label] : []), ...(Array.isArray(o.labels) ? o.labels.map(text).filter(Boolean) : [])])];
    assertExternalWrite(t('main.board.what'));
    return changed(boardStore().create({ id: boardId(randomBytes(16)), title, body: text(o.body), column, squad, priority, labels, repo }));
  });
  ctx.handle('board:update', (id: unknown, patch: unknown) => {
    checked();
    const cardId = text(id);
    required(cardId);
    const p = (patch ?? {}) as Record<string, unknown>;
    const out: BoardPatch = {};
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
      const previous = squad ? null : labelOfSquad(boardStore().get(cardId)?.squad ?? null);
      const kept = (asked ?? boardStore().get(cardId)?.labels ?? []).filter((l) => l !== previous);
      out.labels = squad && label ? [...new Set([...kept, label])] : kept;
    }
    if (p.priority !== undefined) out.priority = checkedPriority(optional(p.priority));
    if (p.labels !== undefined && p.squad === undefined) out.labels = Array.isArray(p.labels) ? p.labels.map(text).filter(Boolean) : [];
    assertExternalWrite(t('main.board.what'));
    return changed(boardStore().update(cardId, out));
  });
  ctx.handle('board:comment', (id: unknown, body: unknown) => {
    checked();
    const cardId = text(id);
    required(cardId);
    const comment = text(body).trim();
    if (!comment) throw new Error(t('main.board.noComment'));
    assertExternalWrite(t('main.board.what'));
    return changed(boardStore().comment(cardId, comment));
  });
  ctx.handle('board:close', (id: unknown) => {
    checked();
    const cardId = text(id);
    required(cardId);
    assertExternalWrite(t('main.board.what'));
    return changed(boardStore().close(cardId));
  });
  ctx.handle('board:reopen', (id: unknown) => {
    checked();
    const cardId = text(id);
    required(cardId);
    assertExternalWrite(t('main.board.what'));
    return changed(boardStore().reopen(cardId));
  });
};
