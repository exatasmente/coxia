import { NOTE_KINDS, type NoteKind } from '../../../../shared/memory';
import type { MemoryFolder, MemoryListView, NoteItem } from '../../../../shared/memoryView';

// The Memory view as pure functions: filter the notes, group them by conversation and agent, and say which badges a note carries. No React, no clock: the list already carries
// `old` and `left`, which the main side computed.

export interface NoteFilters {
  search: string;
  conversation: string;
  agent: string;
  kind: '' | NoteKind;
  /** Only the notes that wait for the person's review (a hand-off, or a file the app does not know). */
  waiting: boolean;
  /** Only the notes of an agent that left the team. */
  left: boolean;
}

export const NO_FILTERS: NoteFilters = { search: '', conversation: '', agent: '', kind: '', waiting: false, left: false };

export const isFiltering = (f: NoteFilters): boolean => JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

/** A note that needs the person: it waits for review, or the app does not know the file. */
export const needsReview = (n: Pick<NoteItem, 'reviewed' | 'foreign'>): boolean => !n.reviewed || n.foreign;

export function filterNotes(items: readonly NoteItem[], f: NoteFilters, titleOf: (conversation: string) => string = (c) => c): NoteItem[] {
  const words = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((n) => {
    if (f.conversation && n.conversation !== f.conversation) return false;
    if (f.agent && n.agent !== f.agent) return false;
    if (f.kind && n.kind !== f.kind) return false;
    if (f.waiting && !needsReview(n)) return false;
    if (f.left && !n.left) return false;
    // Title, kind, agent and conversation: what the list shows. Never the text of a note, which the list does not carry.
    const hay = `${n.title} ${n.kind ?? ''} ${n.by} ${n.agent} ${n.conversation} ${titleOf(n.conversation)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Newest first, then by id so the order is stable. */
export const sortNotes = (items: readonly NoteItem[]): NoteItem[] => [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));

export interface AgentGroup {
  agent: string;
  left: boolean;
  notes: NoteItem[];
}

export interface ConversationGroup {
  conversation: string;
  title: string;
  agents: AgentGroup[];
}

/**
 * The notes grouped conversation, then agent. A folder with no note is a group too (the person sees where an agent was called), unless a filter is on: then only the groups
 * that hold a note that passed it are shown.
 */
export function groupNotes(view: Pick<MemoryListView, 'folders'>, shown: readonly NoteItem[], filtering: boolean): ConversationGroup[] {
  const byFolder = new Map<string, NoteItem[]>();
  for (const n of shown) byFolder.set(`${n.conversation}/${n.agent}`, [...(byFolder.get(`${n.conversation}/${n.agent}`) ?? []), n]);
  const groups = new Map<string, ConversationGroup>();
  const folders: MemoryFolder[] = [...view.folders].sort((a, b) => (a.conversation === b.conversation ? a.agent.localeCompare(b.agent) : a.conversation.localeCompare(b.conversation)));
  for (const f of folders) {
    const notes = sortNotes(byFolder.get(`${f.conversation}/${f.agent}`) ?? []);
    if (filtering && notes.length === 0) continue;
    const group = groups.get(f.conversation) ?? { conversation: f.conversation, title: f.title, agents: [] };
    group.agents.push({ agent: f.agent, left: f.left, notes });
    groups.set(f.conversation, group);
  }
  return [...groups.values()];
}

export type Badge = 'edited' | 'awaits' | 'foreign' | 'unsafe' | 'old' | 'left';

/** The badges a note carries, in the order they are shown. `foreign` and `unsafe` come before the others: they say the app does not stand behind the file. */
export function badgesOf(n: Pick<NoteItem, 'person' | 'reviewed' | 'foreign' | 'unsafe' | 'old' | 'left'>): Badge[] {
  const out: Badge[] = [];
  if (n.foreign) out.push('foreign');
  if (n.unsafe) out.push('unsafe');
  if (n.person && !n.foreign) out.push('edited');
  if (!n.reviewed && !n.foreign) out.push('awaits');
  if (n.old) out.push('old');
  if (n.left) out.push('left');
  return out;
}

export const KIND_LABEL: Record<NoteKind, string> = { decision: 'ui.memory.kind.decision', finding: 'ui.memory.kind.finding', note: 'ui.memory.kind.note' };
export const BADGE_LABEL: Record<Badge, string> = {
  edited: 'ui.memory.badge.edited',
  awaits: 'ui.memory.badge.awaits',
  foreign: 'ui.memory.badge.foreign',
  unsafe: 'ui.memory.badge.unsafe',
  old: 'ui.memory.badge.old',
  left: 'ui.memory.badge.left',
};
export const NOTE_KIND_LIST: readonly NoteKind[] = NOTE_KINDS;

/** The catalog key of the reason a write did not happen. */
export const ERROR_KEY: Record<string, string> = {
  revision: 'ui.memory.error.revision',
  'not-found': 'ui.memory.error.notFound',
  invalid: 'ui.memory.error.invalid',
  unsafe: 'ui.memory.error.unsafe',
  newer: 'ui.memory.error.newer',
  io: 'ui.memory.error.io',
};

/** The distinct values of `pick`, sorted, for a filter's options. */
export function distinct<T>(items: readonly T[], pick: (item: T) => string): string[] {
  return [...new Set(items.map(pick))].sort((a, b) => a.localeCompare(b));
}
