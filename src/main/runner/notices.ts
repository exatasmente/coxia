import { runThreadId, type ForumMessage } from '../../shared/forum';
import type { WorkspaceConfig } from '../../shared/config/types';
import { MEMORY_LIMITS, memoryOn, visibleToAgents } from '../../shared/memory';
import { isTerminal, type Run } from '../../shared/runs';
import { prompt } from '../cyclePrompts';
import type { ForumStore } from '../forum-core';
import type { RunStore } from '../runs-core';
import type { MemoryWrite } from '../memory/store';
import { NOTICE_CODE, READ_CODE, inboxOf } from './inbox';
import { fence } from './prompt';

// A run is told when something relevant to it is written elsewhere in the memory (docs/cycles/215, rule 10). The hub decides without a model call whether an entry
// concerns a run, holds the entries that arrive close together, and writes ONE line in the run's thread for them: that line is the record the person reads and the state
// the next stage reads back (the run file is not touched). A stage that is working also gets the text between two steps, through its mailbox; a run between stages has
// it as the first section of the next stage that starts. A notice carries pointers, never a body, and is not repeated for the same entry. Nothing here is called for a
// person's edit, and nothing is done while the workspace's switch is off.

export { NOTICE_CODE, READ_CODE };

/** The entries of the memory that can notify: a note an agent wrote, or a document a stage produced. */
export interface NoticeEntry {
  /** What a pointer is: `m-<hex>` or `doc:<runId>/<name>`. None holds a comma. */
  id: string;
  kind: 'decision' | 'finding' | 'note' | 'document';
  title: string;
  /** The conversation it was written in (a document: the thread of the run that produced it) and the agent that wrote it. */
  conversation: string;
  agent: string;
  /** Day, `YYYY-MM-DD`. */
  day: string;
  activity?: string;
  repo?: string;
  /** A document: the run that produced it, which it never notifies. */
  runId?: string;
}

export type WhyConcerned = 'activity' | 'repo' | 'agent';

/** The thread ids of a run: its own conversation and the side conversations its stages opened. They are not "elsewhere". */
export function isOwnConversation(runId: string, conversation: string): boolean {
  const own = runThreadId(runId);
  return conversation === own || conversation.startsWith(`${own}-talk-`);
}

/**
 * Whether an entry concerns a run, and why (in this order): it is about the run's activity; it is a decision about the run's repository; or it was written by the agent
 * that works the run now. The entries of the run's own conversations never do. Pure: the decision a test pins.
 */
export function concerns(run: Pick<Run, 'id' | 'issue' | 'repo'>, entry: NoticeEntry, working: string | null): WhyConcerned | null {
  if (entry.runId === run.id || isOwnConversation(run.id, entry.conversation)) return null;
  if (entry.activity && entry.activity === run.issue.ref) return 'activity';
  if (entry.kind === 'decision' && entry.repo && entry.repo === run.repo) return 'repo';
  if (working && entry.agent === working) return 'agent';
  return null;
}

/** An agent's write as an entry that may notify, or null when it must not: held back from agents, the person's own, or not a note. */
export function entryOfWrite(write: MemoryWrite): NoticeEntry | null {
  const n = write.note;
  if (n.kind === null || n.person || !visibleToAgents(n)) return null;
  return { id: n.id, kind: n.kind, title: n.title, conversation: n.conversation, agent: n.agent, day: n.at.slice(0, 10), ...(n.activity ? { activity: n.activity } : {}), ...(n.repo ? { repo: n.repo } : {}) };
}

/** The notices of a run's thread that no stage has read: oldest first. `seq` is the line, and the marker that reads it names the same number. */
export function pendingNotices(thread: readonly ForumMessage[]): { seq: number; text: string }[] {
  const read = new Set<number>();
  for (const m of thread) {
    if (m.code !== READ_CODE) continue;
    for (const part of String(m.params?.seqs ?? '').split(',')) if (part.trim()) read.add(Number(part));
  }
  return thread.filter((m) => m.code === NOTICE_CODE && !read.has(m.seq) && typeof m.params?.text === 'string' && m.params.text.trim() !== '').map((m) => ({ seq: m.seq, text: String(m.params.text) }));
}

/** Most notices one stage prompt carries; the rest wait for the next stage. */
export const NOTICES_PER_STAGE = 5;
// What one window of merging holds before the rest is dropped: a burst of writes is told as "and N more" and never grows without end.
const MAX_HELD = 50;
const MERGE_MS = 2000;
const POINTER_MAX = 240;

export interface NoticeHubDeps {
  runs: Pick<RunStore, 'list' | 'get'>;
  forum: Pick<ForumStore, 'append' | 'read'>;
  config(): WorkspaceConfig;
  /** The agent working the stage of a run right now; null when the run is not working. */
  workingAgent(run: Run): string | null;
  /** How long entries that arrive close together are held to be told as one. A test shortens it. */
  mergeMs?: number;
  onError?(e: unknown): void;
}

export interface NoticeHub {
  /** An agent created or replaced a note. */
  noteWritten(write: MemoryWrite): void;
  /** A stage of `run` produced these documents (accepted, in the run's cycle folder). */
  documentsWritten(run: Pick<Run, 'id' | 'issue' | 'repo'>, agent: string, names: readonly string[]): void;
}

interface Held {
  entries: Map<string, { entry: NoticeEntry; why: WhyConcerned; agent: string }>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createNoticeHub(deps: NoticeHubDeps): NoticeHub {
  const mergeMs = deps.mergeMs ?? MERGE_MS;
  const held = new Map<string, Held>();
  // What each run was told already, by entry id. Seeded the first time a run is looked at from the notice lines of its thread, so a restart does not tell it again.
  const told = new Map<string, Set<string>>();

  const fail = (e: unknown): void => {
    if (deps.onError) deps.onError(e);
    else console.error('[runner] could not tell a run about the memory', e instanceof Error ? e.message : e);
  };

  function toldOf(runId: string): Set<string> {
    let set = told.get(runId);
    if (set) return set;
    set = new Set();
    for (const m of deps.forum.read(runThreadId(runId), 0, 2000)?.messages ?? []) {
      if (m.code !== NOTICE_CODE) continue;
      for (const id of String(m.params?.ids ?? '').split(',')) if (id) set.add(id);
    }
    told.set(runId, set);
    return set;
  }

  const whyText = (why: WhyConcerned, agent: string): string => (why === 'activity' ? prompt('runner.notice.sharedWhy.activity') : why === 'repo' ? prompt('runner.notice.sharedWhy.repo') : prompt('runner.notice.sharedWhy.agent', { agent }));

  function pointer(e: NoticeEntry, why: WhyConcerned, working: string): string {
    const line = prompt('runner.notice.sharedPointer', { id: e.id, kind: e.kind, title: fence(e.title), agent: e.agent, conversation: e.conversation, day: e.day, why: whyText(why, working) });
    return line.length > POINTER_MAX ? `${line.slice(0, POINTER_MAX)}…` : line;
  }

  function flush(runId: string): void {
    const slot = held.get(runId);
    held.delete(runId);
    if (!slot) return;
    try {
      const run = deps.runs.get(runId);
      if (!run || isTerminal(run) || !memoryOn(deps.config())) return;
      const all = [...slot.entries.values()];
      const shown = all.slice(0, MEMORY_LIMITS.noticePointers);
      const lines = shown.map((x) => pointer(x.entry, x.why, x.agent));
      if (all.length > shown.length) lines.push(prompt('runner.notice.sharedMore', { n: all.length - shown.length }));
      const text = prompt('runner.notice.sharedMemory', { pointers: lines.join('\n') });
      // The line is the record: written before the stage is reached, so the person sees what the agent was told even when the stage closed in between.
      const [line] = deps.forum.append(runThreadId(runId), { kind: 'system', author: { type: 'app' }, code: NOTICE_CODE, params: { ids: all.map((x) => x.entry.id).join(','), n: all.length, text }, stage: run.stage });
      const set = toldOf(runId);
      for (const x of all) set.add(x.entry.id);
      inboxOf(runId)?.notice(text, line.seq);
    } catch (e) {
      fail(e);
    }
  }

  function offer(entry: NoticeEntry): void {
    try {
      if (!memoryOn(deps.config())) return;
      const runs = deps.runs.list();
      // A run that is gone takes its memory of what it was told with it.
      for (const id of told.keys()) if (!runs.some((r) => r.id === id)) told.delete(id);
      for (const run of runs) {
        if (isTerminal(run)) continue;
        const working = deps.workingAgent(run);
        const why = concerns(run, entry, working);
        if (!why || toldOf(run.id).has(entry.id)) continue;
        let slot = held.get(run.id);
        if (!slot) {
          slot = { entries: new Map(), timer: null };
          held.set(run.id, slot);
        }
        if (slot.entries.has(entry.id) || slot.entries.size >= MAX_HELD) continue;
        slot.entries.set(entry.id, { entry, why, agent: working ?? entry.agent });
        if (!slot.timer) {
          slot.timer = setTimeout(() => flush(run.id), mergeMs);
          // The notice is not worth keeping the app open for.
          slot.timer.unref?.();
        }
      }
    } catch (e) {
      fail(e);
    }
  }

  return {
    noteWritten(write) {
      const entry = entryOfWrite(write);
      if (entry) offer(entry);
    },
    documentsWritten(run, agent, names) {
      const day = new Date().toISOString().slice(0, 10);
      for (const name of names) offer({ id: `doc:${run.id}/${name}`, kind: 'document', title: name, conversation: runThreadId(run.id), agent, day, activity: run.issue.ref, repo: run.repo, runId: run.id });
    },
  };
}
