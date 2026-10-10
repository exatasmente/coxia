// The shared, indexed memory of the agents (docs/cycles/215-shared-indexed-memory). The contract and the constants, shared by the main process and the renderer;
// the format of a note is in main/memory/note.ts and the files in main/memory/store.ts. Every cap is a constant here, not a setting.

/** What an agent writes: the kinds of a note. The other kinds of an entry are built by the app when it lists the memory. */
export const NOTE_KINDS = ['decision', 'finding', 'note'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type EntryKind = NoteKind | 'activity' | 'document' | 'version' | 'roadmap';

export const MEMORY_LIMITS = {
  /** A note's text, in characters. */
  note: 8000,
  filesPerAgent: 50,
  title: 80,
  /** The list in a prompt. */
  listLines: 40,
  listChars: 3000,
  /** `memory_list`, as `procedures_list`. */
  toolListLines: 40,
  toolListChars: 6000,
  excerpt: 4000,
  /** A note without a change for this many days is shown as old; it is never removed by age. */
  old: 90,
  noticePointers: 5,
  docRuns: 30,
} as const;

/** The file name of a note, and the file beside the notes of an agent's folder that holds what the app decides about them. */
export const NOTE_FILE = /^m-[0-9a-f]{8}\.md$/;
export const NOTE_ID = /^m-[0-9a-f]{8}$/;
export const STATE_FILE = '_state.json';
export const STATE_VERSION = 1;

/** A conversation is a thread id (`THREAD_ID`, shared/forum.ts) and an agent an agent id (`ID`, config/schema.ts); both fit a folder name as they are. */
export const CONVERSATION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export const isNoteKind = (v: unknown): v is NoteKind => (NOTE_KINDS as readonly unknown[]).includes(v);

/** The switch of the shared memory: absent (a config stored before it) reads as off. Off offers no tool, no prompt section, no folder and no notice, and the view still works. */
export const memoryOn = (config: { runner?: { sharedMemory?: boolean } | null } | null | undefined): boolean => config?.runner?.sharedMemory === true;

/** What the app keeps about one note, beside the notes: it decides who may change it and who may read it. The header of the note is for the reader and decides nothing. */
export interface NoteState {
  /** The agent that wrote it (an agent id); the folder, not this, says whose folder it is. */
  by: string;
  /** The person took it over: an agent can no longer replace or remove it. */
  person: boolean;
  revision: number;
  /** False while it waits for the person's review: no agent reads it. */
  reviewed: boolean;
  /** Of the whole file as the app wrote it: a file that no longer matches was edited outside the app, which reads as the person's. */
  sha: string;
  at: string;
}

export interface FolderState {
  version: typeof STATE_VERSION;
  notes: Record<string, NoteState>;
}

/** A note as the app lists it: where it is, who wrote it and in which state it is, never its text. */
export interface NoteSummary {
  id: string;
  conversation: string;
  agent: string;
  /** What the header says; null when it is not one of the kinds (the note is then `unsafe`). */
  kind: NoteKind | null;
  title: string;
  /** The agent that wrote it, from the state; for a `foreign` note, the agent whose folder it is in. */
  by: string;
  /** The person wrote it, edited it in the app or edited the file outside the app. */
  person: boolean;
  revision: number;
  /** False while it waits for the person's review. */
  reviewed: boolean;
  /** The file has no entry in the state: placed by hand, or left by a crash. No agent reads it until the person reviews it. */
  foreign: boolean;
  /** The file no longer passes what the app would accept (a header or a text that fails the checks): no agent reads it, the person sees it. */
  unsafe: boolean;
  at: string;
  size: number;
  activity?: string;
  repo?: string;
}

/** Whether an agent's list and read may offer the note: it was reviewed, the app knows it and it passes the checks. */
export const visibleToAgents = (n: Pick<NoteSummary, 'foreign' | 'unsafe' | 'reviewed'>): boolean => !n.foreign && !n.unsafe && n.reviewed;

/**
 * Where a call that reads the memory runs: a run stage, a mention in a run's thread, the general conversation, a direct conversation, a squad channel, an agent called by
 * another (or from a stage), the answer of a question chain, a squad request and a ceremony. Only the first six write; the last three read.
 */
export const MEMORY_SURFACES = ['stage', 'run-thread', 'forum', 'direct', 'channel', 'called', 'chain', 'request', 'ceremony'] as const;
export type MemorySurface = (typeof MEMORY_SURFACES)[number];
