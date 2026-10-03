import { t } from './i18n';

// The forum: one thread per run plus general threads. Messages are what agents and people say about an activity; the stores are in
// main/forum-core.ts (JSONL, append only) and main/runs-core.ts (the run each thread belongs to).

export const MESSAGE_KINDS = ['post', 'question', 'answer', 'handoff', 'decision', 'system'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Who said it: an agent of the team, the person, or the app itself (stage changes, the review limit). */
export type Author = { type: 'agent'; id: string } | { type: 'person' } | { type: 'app' };

/** A file of the run's cycle folder, by its path inside that folder. */
export interface ArtifactRef {
  path: string;
  label?: string;
}

export type ParamValue = string | number;

/** Where a thread message was mirrored on the tracker, so the thread links to it. */
export interface PublishedRef {
  target: 'issue' | 'mr';
  noteId: string | number;
  url: string | null;
}

/** What a transition asks the forum to record. The store adds the sequence number, the time and the thread. */
export interface ForumDraft {
  kind: MessageKind;
  author: Author;
  /** What the author wrote. Empty for the messages the app words itself (`code`). */
  text?: string;
  /** A message the app words: a key under `main.forum.code.*`, rendered at display time with `params`, so a language change also translates old threads. */
  code?: string;
  params?: Record<string, ParamValue>;
  /** Agent ids named in the text. */
  mentions?: string[];
  refs?: ArtifactRef[];
  /** The stage of the run the message belongs to. */
  stage?: string | null;
  /** Handoff: the agent id that takes over, or "person". */
  to?: string | null;
  /** Public record: what an agent did, asked, was answered or was decided, and may appear on the tracker. Handoffs and stage changes stay internal. Default false. */
  public?: boolean;
  published?: PublishedRef | null;
}

export interface ForumMessage {
  v: 1;
  type: 'message';
  /** 1, 2, 3... per thread, with no gap. */
  seq: number;
  thread: string;
  /** ISO time. */
  at: string;
  kind: MessageKind;
  author: Author;
  text: string;
  code: string | null;
  params: Record<string, ParamValue>;
  mentions: string[];
  refs: ArtifactRef[];
  stage: string | null;
  to: string | null;
  /** An answer: the `seq` of the question it answers. */
  replyTo: number | null;
  /** Eligible to appear on the tracker. Being public is not being published: nothing is mirrored without the workspace option and an approval. */
  public: boolean;
  /** Set once the message was mirrored to the tracker. */
  published: PublishedRef | null;
}

export const THREAD_KINDS = ['run', 'general'] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];

export interface ThreadHeader {
  v: 1;
  type: 'thread';
  id: string;
  kind: ThreadKind;
  /** The run a `run` thread belongs to. */
  runId: string | null;
  title: string;
  createdAt: string;
}

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  runId: string | null;
  title: string;
  createdAt: string;
  count: number;
  lastAt: string | null;
  lastKind: MessageKind | null;
  /** A question nobody has answered yet. */
  openQuestion: boolean;
}

export interface ThreadRead {
  thread: ThreadSummary;
  messages: ForumMessage[];
  /** The highest sequence number in the thread: what to pass as `afterSeq` next time. */
  last: number;
}

/** Pushed to every window and browser on each append. */
export interface ForumEventPayload {
  thread: string;
  message: ForumMessage;
}

export const FORUM_EVENT = 'forum:message';
export const MAX_TEXT = 20_000;
export const MAX_TITLE = 120;
export const GENERAL_THREAD = 'general';
export const THREAD_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const runThreadId = (runId: string): string => `run-${runId}`;

/** The text of a message as a person reads it: what the author wrote, or the app's own wording of its `code`. */
export function messageText(m: { text?: string; code?: string | null; params?: Record<string, ParamValue> }): string {
  const own = m.code ? t(`main.forum.code.${m.code}`, m.params) : '';
  return [own, m.text ?? ''].filter(Boolean).join(m.code && m.text ? '\n' : '');
}

/**
 * The agents a person addressed: `@developer` names the agent with that id (case does not matter). Only ids the team has count, so an unknown
 * `@word`, an address like `ana@example.com` or a path stays plain text. Each agent once, in the order named.
 */
export function parseMentions(text: string, agentIds: readonly string[]): string[] {
  const known = new Set(agentIds);
  const found: string[] = [];
  for (const m of text.matchAll(/(^|[^\w@/.-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const id = m[2].toLowerCase();
    if (known.has(id) && !found.includes(id)) found.push(id);
  }
  return found;
}
