import { type BoardCard, type BoardItem, type BoardProjectLine, type HostRead, type HostSeen, type MirrorContext, boardColumns, derivedFields, itemKey } from '../../shared/board';
import { ownStageLabels, sameIssue } from '../../shared/boardHost';
import { squadsOf } from '../../shared/config/squads';
import { shownText } from '../../shared/cycles/text';
import { boardStore } from '../boardSource';
import { getConfig, rc } from '../workspaceConfig';
import { type CardItem, issueCardItem, issueRef } from './cards';
import { cardRefContext, workspaceProjects } from './cardSource';
import { VcsError } from './errors';
import { vcsProvider, vcsReady } from './index';
import { stageOf, stagesFor } from './stages';
import type { VcsIssue } from './types';
import { pool } from './util';

// What the host says about the issues the board tracks: the cards the board opened and linked to an issue, read by number. Reads only — the answer feeds
// the day (the issues as report items) and the mirror (what each card's copy becomes); a write to the host is the board's door, in main/boardHost.ts.

/** A card is read while it is open and for this many days after it is closed, so a close or a reopen made on the host shows. */
export const TRACKED_RECENT_DAYS = 7;
/** At most this many cards are read by number; the rest keep their stored copy. */
export const TRACKED_MAX = 50;
/** How long a read of one issue is reused unless the person asks again (the same five minutes as the day's listing). */
export const TRACKED_TTL_MS = 5 * 60_000;
const POOL = 4;

export interface TrackedRead {
  at: string;
  /** The open tracked issues, built by the function the listing uses. */
  items: CardItem[];
  /** What the host said per card id. */
  seen: Record<string, HostSeen>;
}

type Found = { issue: VcsIssue } | { missing: true } | { unread: true };
const cache = new Map<string, { at: number; found: Found }>();

/** Forgets what was read: a write the board's door just made, so the next read asks the host again. */
export function forgetTracked(): void {
  cache.clear();
}

// Bumped whenever what was read is forgotten: a read that began before is not joined by one that asks after.
let generation = 0;

/** Forgets everything the board read of the host (the issues by number and the listing of the projects). */
export function forgetHost(): void {
  generation++;
  forgetTracked();
  forgetProjects();
}

/** The cards read by number: linked, open or closed within the last days, newest update first, at most `TRACKED_MAX`. */
export function trackedCards(now = Date.now()): BoardCard[] {
  const recent = TRACKED_RECENT_DAYS * 86_400_000;
  return boardStore()
    .list()
    .filter((c) => c.host && (c.state === 'open' || now - Date.parse(c.updatedAt) < recent))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, TRACKED_MAX);
}

const keyOf = (host: string, project: string, iid: number): string => `${host}|${project.toLowerCase()}#${iid}`;

/**
 * Reads the issues the board tracks. null: no usable host, nothing was read. An issue the host does not return is `missing`; any other failure is `unread`
 * (the stored copy stays). `listed` holds issues a listing already read, which cost no read by number.
 */
export async function readTracked(refresh: boolean, listed: readonly VcsIssue[] = []): Promise<TrackedRead | null> {
  if (!vcsReady()) return null;
  const provider = vcsProvider();
  const cards = trackedCards();
  const now = Date.now();
  const reads = await pool(cards, POOL, async (card): Promise<Found> => {
    const link = card.host!;
    const key = keyOf(provider.id, link.project, link.iid);
    const has = listed.find((i) => sameIssue(link, i));
    if (has) {
      cache.set(key, { at: now, found: { issue: has } });
      return { issue: has };
    }
    const hit = cache.get(key);
    if (!refresh && hit && now - hit.at < TRACKED_TTL_MS) return hit.found;
    try {
      const found: Found = { issue: await provider.getIssue(link.project, link.iid) };
      cache.set(key, { at: Date.now(), found });
      return found;
    } catch (e) {
      if (e instanceof VcsError && e.code === 'not_found') {
        const found: Found = { missing: true };
        cache.set(key, { at: Date.now(), found });
        return found;
      }
      console.error(`[vcs:board] ${link.project}#${link.iid}`, (e as Error).message);
      // Remembered for the same five minutes, so a host that is down is not asked again by every reload; the person's refresh asks again.
      const found: Found = { unread: true };
      cache.set(key, { at: Date.now(), found });
      return found;
    }
  });

  const stages = stagesFor(provider.kind, rc().stages);
  const mapping = getConfig().devCycle.stageMapping;
  const refs = cardRefContext();
  const items: CardItem[] = [];
  const seen: Record<string, HostSeen> = {};
  cards.forEach((card, i) => {
    const link = card.host!;
    const read = reads[i];
    if ('unread' in read || 'missing' in read) {
      seen[card.id] = { state: 'unread' in read ? 'unread' : 'missing', title: '', labels: [], stageId: null, updatedAt: null, url: link.url };
      return;
    }
    const { issue } = read;
    const stage = stageOf(issue, [], stages, mapping, provider.kind);
    seen[card.id] = { state: issue.state, title: issue.title, labels: issue.labels, stageId: stage?.id ?? null, updatedAt: issue.updatedAt, url: issue.webUrl };
    if (issue.state === 'open') items.push(issueCardItem(issue, stage ? shownText(stage.label) : null, issueRef(issue, refs)));
  });
  return { at: new Date().toISOString(), items, seen };
}

/** What the mirror needs to know about the workspace and the host. */
export function mirrorContext(): MirrorContext {
  const provider = vcsProvider();
  const config = getConfig();
  return { stages: config.devCycle.stages, levels: config.devCycle.priority.labels, squads: squadsOf(config), labelsOnHost: provider.caps.issueLabels, ownLabels: ownStageLabels(config.devCycle, provider.kind) };
}

/**
 * Takes what the host said into the cards' copies. The host is canonical: the copy changes to match it and a line in the card's history says so; nothing
 * is deleted. It writes the workspace's own file and nothing outside it, so a test workspace is not refused (it only follows what the host says).
 */
export function mirrorTracked(read: TrackedRead): void {
  const ctx = mirrorContext();
  for (const [id, seen] of Object.entries(read.seen)) {
    try {
      boardStore().mirror(id, seen, ctx);
    } catch (e) {
      console.error('[vcs:board] mirror', (e as Error).message);
    }
  }
}

// ---------------------------------------------------------------- the project's issues, for the board only

/** At most this many projects of the workspace are listed. */
export const BOARD_PROJECTS_MAX = 10;
/** At most this many open issues of one project, the most recently updated first. */
export const BOARD_ISSUES_PER_PROJECT = 100;

interface ListedProject {
  project: string;
  issues: VcsIssue[];
  truncated: boolean;
  error: string | null;
}
interface Listing {
  noProject: boolean;
  projects: ListedProject[];
}

let listing: { at: number; key: string; value: Listing } | null = null;

/** Forgets the listing: a write the board's door just made, so the next read asks the host again and a closed issue does not linger. */
export function forgetProjects(): void {
  listing = null;
}

/** The projects of the workspace on this host, once each (case ignored), the first `BOARD_PROJECTS_MAX`. */
export function boardProjects(hostId: string): string[] {
  const all = workspaceProjects(hostId, cardRefContext().issueProject);
  return all.filter((p, i) => all.findIndex((o) => o.toLowerCase() === p.toLowerCase()) === i).slice(0, BOARD_PROJECTS_MAX);
}

/**
 * Lists the open issues of the workspace's projects, whoever they are assigned to. Read only when the board is opened or refreshed by hand, never by the
 * day. null: no usable host or a host with no issues. A project that cannot be read carries its reason and the others still list.
 */
async function listProjects(refresh: boolean): Promise<Listing | null> {
  if (!vcsReady()) return null;
  const provider = vcsProvider();
  if (!provider.caps.issues) return null;
  const projects = boardProjects(provider.id);
  const key = JSON.stringify([provider.id, projects]);
  if (!refresh && listing && listing.key === key && Date.now() - listing.at < TRACKED_TTL_MS) return listing.value;
  const listed = await pool(projects, 3, async (project): Promise<ListedProject> => {
    try {
      const issues = await provider.listIssues({ project, scope: 'all', limit: BOARD_ISSUES_PER_PROJECT });
      return { project, issues, truncated: issues.length >= BOARD_ISSUES_PER_PROJECT, error: null };
    } catch (e) {
      console.error(`[vcs:board] ${project}`, (e as Error).message);
      return { project, issues: [], truncated: false, error: (e as Error).message };
    }
  });
  const value: Listing = { noProject: projects.length === 0, projects: listed };
  // A listing in which every project failed (the host is down) is not kept: the next read asks again instead of showing the failure for five minutes.
  if (!listed.length || listed.some((p) => !p.error)) listing = { at: Date.now(), key, value };
  return value;
}

/**
 * The board's read of the host in one answer: the issues of the workspace's projects that no card is linked to (derived, never stored), and the cards the
 * board opened, read by number and brought up to what the host says. null: no usable host, nothing was read.
 */
export function readBoard(refresh: boolean): Promise<HostRead | null> {
  if (!vcsReady()) return Promise.resolve(null);
  // Calls that overlap (every proposal approved in Actions asks for a reload) share one read, unless something was written since it began, or this one
  // asks for the host again and the one in flight did not.
  const host = vcsProvider().id;
  if (flight && flight.host === host && flight.generation === generation && (flight.refresh || !refresh)) return flight.promise;
  const mine: Flight = { host, generation, refresh, promise: readBoardNow(refresh) };
  flight = mine;
  void mine.promise.finally(() => {
    if (flight === mine) flight = null;
  });
  return mine.promise;
}

interface Flight {
  host: string;
  generation: number;
  refresh: boolean;
  promise: Promise<HostRead | null>;
}
let flight: Flight | null = null;

async function readBoardNow(refresh: boolean): Promise<HostRead | null> {
  if (!vcsReady()) return null;
  const at = new Date().toISOString();
  try {
    const listed = await listProjects(refresh);
    const tracked = await readTracked(refresh, listed?.projects.flatMap((p) => p.issues) ?? []);
    if (tracked) mirrorTracked(tracked);
    const provider = vcsProvider();
    const config = getConfig();
    const stages = stagesFor(provider.kind, rc().stages);
    const columns = new Set(boardColumns(config.devCycle.stages).map((s) => s.id));
    const ctx = { levels: config.devCycle.priority.labels, squads: squadsOf(config) };
    const links = boardStore().list().flatMap((c) => (c.host ? [c.host] : []));
    const items: BoardItem[] = (listed?.projects ?? []).flatMap((p) =>
      p.issues
        .filter((issue) => !links.some((l) => sameIssue(l, issue)))
        .map((issue): BoardItem => {
          const stage = stageOf(issue, [], stages, config.devCycle.stageMapping, provider.kind);
          return { key: itemKey(issue.project || p.project, issue.iid), project: issue.project || p.project, iid: issue.iid, title: issue.title, column: stage && columns.has(stage.id) ? stage.id : null, labels: issue.labels, url: issue.webUrl, updatedAt: issue.updatedAt, ...derivedFields(issue.labels, ctx) };
        }),
    );
    const lines: BoardProjectLine[] = (listed?.projects ?? []).map((p) => ({ project: p.project, count: p.issues.length, truncated: p.truncated, error: p.error }));
    const seen = Object.fromEntries(Object.entries(tracked?.seen ?? {}).map(([id, s]) => [id, s.state]));
    return { at, noProject: listed?.noProject ?? false, projects: lines, items, seen, error: null };
  } catch (e) {
    console.error('[vcs:board] read', (e as Error).message);
    return { at, noProject: false, projects: [], items: [], seen: {}, error: (e as Error).message };
  }
}
