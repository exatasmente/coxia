import type { AuditEntry } from '../../shared/auditoria';
import type { WorkspaceConfig } from '../../shared/config/types';
import { THREAD_ID } from '../../shared/forum';
import { AGENT_ID, NOTE_ID, isNoteKind, memoryOn, type NoteSummary } from '../../shared/memory';
import { isOldNote, type MemoryFolder, type MemoryListView, type NoteGet, type NoteItem, type NotePatch, type NoteRemove, type NoteWrite } from '../../shared/memoryView';
import { memoryAuditEntry, type MemoryAuditInput } from './audit';
import type { MemoryStore, Scope } from './store';

// What the Memory view asks of the app. Every channel is open to a paired browser (gate 1: the phone has the desktop's capabilities over the memory, ahead of #218), and
// webPolicy.ts names them on purpose, with a pattern that closes any other `memory:` channel. The person's writes go through the same store as an agent's, are marked as the
// person's and reviewed, and are audited with the door they came through (the window or a paired browser) and never the text. They work whatever the workspace switch says:
// it only governs the agents' side. Arguments are checked before any path is built: a conversation against the thread id, an agent against the agent id, a note against its id.

export interface ChannelDeps {
  store: MemoryStore;
  config(): WorkspaceConfig;
  audit?(entry: Omit<AuditEntry, 'at'>): void;
  /** Which door the call came through. */
  via(): 'window' | 'paired';
  /** The title of a conversation, when the app knows the thread. */
  titleOf?(conversation: string): string | null;
  now?(): number;
}

export interface MemoryChannels {
  list(): MemoryListView;
  read(conversation: unknown, agent: unknown, id: unknown): NoteGet;
  save(conversation: unknown, agent: unknown, id: unknown, revision: unknown, patch: unknown): NoteWrite;
  review(conversation: unknown, agent: unknown, id: unknown): NoteWrite;
  remove(conversation: unknown, agent: unknown, id: unknown): NoteRemove;
  /** An agent's folder in a conversation, or the whole conversation's when no agent is named. */
  removeFolder(conversation: unknown, agent?: unknown): NoteRemove;
}

const BAD: { ok: false; code: 'invalid'; text: string } = { ok: false, code: 'invalid', text: 'the conversation, the agent or the note is not a valid id' };

/** The note a channel was asked about, or null when any argument is not what it must be. */
function scopeOf(conversation: unknown, agent: unknown): Scope | null {
  return typeof conversation === 'string' && typeof agent === 'string' && THREAD_ID.test(conversation) && AGENT_ID.test(agent) ? { conversation, agent } : null;
}

const noteId = (v: unknown): string | null => (typeof v === 'string' && NOTE_ID.test(v) ? v : null);

export function createMemoryChannels(deps: ChannelDeps): MemoryChannels {
  const now = deps.now ?? Date.now;
  const { store } = deps;
  const team = (): Set<string> => new Set(deps.config().agents.team.map((a) => a.id));

  const audit = (input: Omit<MemoryAuditInput, 'via'>): void => {
    try {
      deps.audit?.(memoryAuditEntry({ ...input, via: deps.via() }));
    } catch {
      // The write already happened; a failing log must not turn it into a reported failure.
    }
  };

  const item = (n: NoteSummary, members: ReadonlySet<string>): NoteItem => ({ ...n, old: isOldNote(n.at, now()), left: !members.has(n.agent) });
  const titleOf = (conversation: string): string => {
    try {
      return deps.titleOf?.(conversation) || conversation;
    } catch {
      return conversation;
    }
  };

  const noteWrite = (op: 'edit' | 'review', scope: Scope, r: ReturnType<MemoryStore['edit']> | ReturnType<MemoryStore['review']>): NoteWrite => {
    if (!r.ok) {
      // A refusal is audited by its code and the fields it named, never by the text that was refused.
      audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: r.code, fields: 'refusals' in r && r.refusals ? r.refusals.map((x) => x.field) : [] });
      return { ok: false, code: r.code, text: r.text, ...('refusals' in r && r.refusals ? { refusals: r.refusals } : {}) };
    }
    audit({ op, conversation: scope.conversation, agent: scope.agent, note: { id: r.note.id, kind: r.note.kind, title: r.note.title, revision: r.note.revision } });
    return { ok: true, note: item(r.note, team()) };
  };

  return {
    list() {
      const members = team();
      const { notes, folders, skipped } = store.list();
      const view: MemoryFolder[] = folders.map((f) => ({ conversation: f.conversation, agent: f.agent, title: titleOf(f.conversation), left: !members.has(f.agent) }));
      return { enabled: memoryOn(deps.config()), folders: view, items: notes.map((n) => item(n, members)), skipped };
    },

    read(conversation, agent, id) {
      const scope = scopeOf(conversation, agent);
      const want = noteId(id);
      if (!scope || !want) return { status: 'missing' };
      const got = store.read(scope, want, 'person');
      return got.status === 'ok' ? { status: 'ok', note: item(got.note, team()), text: got.text } : { status: 'missing' };
    },

    // The person's edit of a note: only an existing one (a note is created by an agent), the revision they opened named (a save without it is refused), the text masked and checked for its shape.
    save(conversation, agent, id, revision, patch) {
      const scope = scopeOf(conversation, agent);
      const want = noteId(id);
      if (!scope || !want) return BAD;
      // The stale check is the person's protection against an agent that moved on: a save that does not name the revision it read would skip it.
      if (typeof revision !== 'number' || !Number.isInteger(revision)) return { ok: false, code: 'revision', text: 'the revision the note was opened at must be named; open it again' };
      const p = (patch && typeof patch === 'object' ? patch : {}) as NotePatch;
      if (typeof p.title !== 'string' && typeof p.text !== 'string' && p.kind === undefined) return { ok: false, code: 'invalid', text: 'there is nothing to change' };
      if ((p.title !== undefined && typeof p.title !== 'string') || (p.text !== undefined && typeof p.text !== 'string') || (p.kind !== undefined && !isNoteKind(p.kind))) return { ok: false, code: 'invalid', text: 'the title, the text or the kind has the wrong type' };
      return noteWrite('edit', scope, store.edit({ scope, id: want, title: p.title, text: p.text, kind: p.kind, revision }));
    },

    // The person looked at a note that waited for review, or at a foreign one: it can now be read by the agents.
    review(conversation, agent, id) {
      const scope = scopeOf(conversation, agent);
      const want = noteId(id);
      if (!scope || !want) return BAD;
      return noteWrite('review', scope, store.review(scope, want));
    },

    remove(conversation, agent, id) {
      const scope = scopeOf(conversation, agent);
      const want = noteId(id);
      if (!scope || !want) return BAD;
      const seen = store.read(scope, want, 'person');
      const before = seen.status === 'ok' ? seen.note : null;
      const done = store.removeNote(scope, want);
      if (!done.ok) {
        audit({ op: 'refused', conversation: scope.conversation, agent: scope.agent, code: done.code });
        return done;
      }
      audit({ op: 'remove', conversation: scope.conversation, agent: scope.agent, note: before ? { id: before.id, kind: before.kind, title: before.title, revision: before.revision } : { id: want, kind: null, title: '', revision: 0 } });
      return done;
    },

    removeFolder(conversation, agent) {
      if (typeof conversation !== 'string' || !THREAD_ID.test(conversation)) return BAD;
      if (agent !== undefined && agent !== null && (typeof agent !== 'string' || !AGENT_ID.test(agent))) return BAD;
      const named = typeof agent === 'string' ? agent : undefined;
      const count = store.list({ conversation, ...(named ? { agent: named } : {}) }).notes.length;
      const done = named ? store.removeFolder({ conversation, agent: named }) : store.removeConversation(conversation);
      if (!done) return { ok: false, code: 'not-found', text: 'there is no such folder' };
      audit({ op: 'remove-folder', conversation, ...(named ? { agent: named } : {}), removed: count });
      return { ok: true };
    },
  };
}
