import type { BoardCard, HostSeen, MirrorContext } from '../../shared/board';
import { ownStageLabels, sameIssue } from '../../shared/boardHost';
import { squadsOf } from '../../shared/config/squads';
import { shownText } from '../../shared/cycles/text';
import { boardStore } from '../boardSource';
import { getConfig, rc } from '../workspaceConfig';
import { type CardItem, issueCardItem, issueRef } from './cards';
import { cardRefContext } from './cardSource';
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

type Found = { issue: VcsIssue } | { missing: true };
const cache = new Map<string, { at: number; found: Found }>();

/** Forgets what was read: a write the board's door just made, so the next read asks the host again. */
export function forgetTracked(): void {
  cache.clear();
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
  const reads = await pool(cards, POOL, async (card): Promise<Found | 'unread'> => {
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
      return 'unread';
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
    if (read === 'unread' || 'missing' in read) {
      seen[card.id] = { state: read === 'unread' ? 'unread' : 'missing', title: '', labels: [], stageId: null, updatedAt: null, url: link.url };
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
