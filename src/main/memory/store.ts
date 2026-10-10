import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_ID,
  CONVERSATION_ID,
  MEMORY_LIMITS,
  NOTE_FILE,
  NOTE_ID,
  STATE_FILE,
  STATE_VERSION,
  isNoteKind,
  type FolderState,
  type NoteKind,
  type NoteState,
  type NoteSummary,
} from '../../shared/memory';
import { redact } from '../errorlog-core';
import { checkProse, describeRefusals, type Refusal } from '../procedures/record';
import { MEMORY_DIR } from '../runner/activities';
import { parseNote, problemsOf, renderNote, shaOf, shortLine, type HeaderClaims } from './note';
import { createStateFile } from './state';

// The workspace's conversation memory: one plain-text note per file under <workspace>/memory/conversations/<conversation>/<agent>/, and beside them the state file the app
// decides by (state.ts). The app is the only writer: an agent through a tool, the person through the channels; a note is never in a worktree (it would ride the pull
// request). Nothing here imports Electron. Synchronous, so a read-compare-write inside one process cannot be interleaved; a second app instance on the same folder is not
// guarded, as for the activities and the procedures.

export const CONVERSATIONS_DIR = 'conversations';
export const conversationsPath = (dir: string): string => join(dir, MEMORY_DIR, CONVERSATIONS_DIR);

const TMP = /\.tmp-\d+$/;
const TMP_STALE_MS = 60 * 60 * 1000;
// A file past this is not read: a note is at most 8,000 characters (32 KB in the widest encoding) plus a header of a few hundred bytes.
const MAX_FILE_BYTES = 40_000;

/** Where a note is: a conversation and the agent whose folder it is in. */
export interface Scope {
  conversation: string;
  agent: string;
}

export interface SaveRequest {
  /** The session's own folder: an agent writes nowhere else. */
  scope: Scope;
  /** Replaces this note of the folder. It must name the revision it read. */
  id?: string;
  revision?: number;
  kind: unknown;
  title: unknown;
  text: unknown;
  /** The activity and the repository the note concerns (the caller checks they exist). */
  activity?: string;
  repo?: string;
  /** The call had a hand-off to the person: the note waits for their review before another agent reads it. */
  handoff?: boolean;
  /** The call's exact-value mask: a text it would change holds a secret value and is refused, not cut. */
  mask?: (text: string) => string;
  home?: string;
}

export type SaveRefusal =
  | 'invalid'
  | 'cap-files'
  | 'revision'
  | 'not-found'
  | 'other-agent'
  | 'other-conversation'
  | 'person'
  | 'foreign'
  | 'newer'
  | 'io';

export type SaveResult =
  | { ok: true; note: NoteSummary; created: boolean }
  | { ok: false; code: SaveRefusal; text: string; refusals?: Refusal[]; owner?: Scope };

export type RemoveResult = { ok: true } | { ok: false; code: Exclude<SaveRefusal, 'invalid' | 'cap-files' | 'revision'>; text: string; owner?: Scope };

/** The person's edit of a note: the fields they changed. The text is masked, not refused. */
export interface EditRequest {
  scope: Scope;
  id: string;
  title?: string;
  text?: string;
  kind?: NoteKind;
  /** The revision the editor read; a note that moved since is refused so the person does not overwrite a newer text unseen. */
  revision?: number;
  mask?: (text: string) => string;
  home?: string;
}

export type EditResult = { ok: true; note: NoteSummary } | { ok: false; code: 'invalid' | 'not-found' | 'revision' | 'newer' | 'io'; text: string; refusals?: Refusal[] };
export type ReviewResult = { ok: true; note: NoteSummary } | { ok: false; code: 'not-found' | 'unsafe' | 'newer' | 'io'; text: string };

export type ReadResult =
  | { status: 'ok'; note: NoteSummary; text: string }
  | { status: 'missing' }
  | { status: 'hidden'; reason: 'review' | 'foreign' | 'unsafe' };

export interface Listing {
  notes: NoteSummary[];
  /** Every folder, an empty one included: the person sees where each agent was called. */
  folders: Scope[];
  /** Files and folders that are not notes (no id, an id that is not the file's, a link, a stray file): never read, repaired or removed. */
  skipped: number;
}

export interface MemoryStoreDeps {
  now?: () => number;
  /** Eight hex digits for a new id. */
  hex?: () => string;
  /** Moves a written file into place; a test makes it fail. */
  rename?: (from: string, to: string) => void;
  /** Where a folder that cannot be read is reported (the error log). It gets a sentence with no path in it, once. */
  onError?: (error: Error) => void;
  home?: string;
  /** Told after every change that took effect (a note written, edited, reviewed or removed, a folder removed), so an open screen reads again. */
  onChange?: () => void;
}

export interface MemoryStore {
  /** Every note, every folder. `filter` narrows to a conversation, or to one agent's folder. */
  list(filter?: { conversation?: string; agent?: string }): Listing;
  /** One note. `as: 'agent'` hides what no agent may read (it waits for review, is foreign or no longer passes the checks); the text is masked either way. */
  read(scope: Scope, id: string, as: 'agent' | 'person'): ReadResult;
  /** Makes the agent's folder in the conversation (the first call), or finds it (the next). False when it could not be made. */
  ensureFolder(scope: Scope): boolean;
  /** An agent creates a note in its own folder, or replaces one of its own that the person has not taken over. */
  save(req: SaveRequest): SaveResult;
  /** An agent removes one of its own notes that the person has not taken over. */
  remove(scope: Scope, id: string): RemoveResult;
  /** The person edits a note: it becomes theirs, reviewed, and its agent can no longer replace or remove it. */
  edit(req: EditRequest): EditResult;
  /** The person looked at a note that waited for review, or at a foreign one: it is marked reviewed, the text unchanged. */
  review(scope: Scope, id: string): ReviewResult;
  /** The person removes any note, whoever wrote it. */
  removeNote(scope: Scope, id: string): RemoveResult;
  /** Removes an agent's folder in a conversation with its notes, or a whole conversation's. */
  removeFolder(scope: Scope): boolean;
  removeConversation(conversation: string): boolean;
  /** Where a note id is, when it is in a folder other than the caller's. */
  locate(id: string): Scope | null;
}

const validScope = (s: Scope): boolean => CONVERSATION_ID.test(s.conversation) && AGENT_ID.test(s.agent);
const iso = (ms: number): string => new Date(ms).toISOString();

// What is known of one file's content, cached by path, modification time and size.
interface Facts {
  size: number;
  /** The file was too large to read: it is a note by name only. */
  unread: boolean;
  sha: string;
  noteId: string | null;
  claims: HeaderClaims;
  body: string;
  problems: string[];
  /** The text and title as the prose validator sees them for an agent's note, filled in when asked. */
  prose?: boolean;
  /** The title as shown: masked. */
  shown: string;
}

export function createMemoryStore(workspaceDir: string, deps: MemoryStoreDeps = {}): MemoryStore {
  const root = conversationsPath(workspaceDir);
  const now = deps.now ?? Date.now;
  const hex = deps.hex ?? (() => randomBytes(4).toString('hex'));
  const move = deps.rename ?? renameSync;
  const home = deps.home ?? homedir();
  const states = createStateFile(move);
  const cache = new Map<string, { mtimeMs: number; size: number; facts: Facts }>();
  let unreadableSaid = false;

  const folderOf = (s: Scope): string => join(root, s.conversation, s.agent);
  const fileOf = (s: Scope, id: string): string => join(folderOf(s), `${id}.md`);

  function unreadable(): void {
    if (unreadableSaid) return;
    unreadableSaid = true;
    deps.onError?.(new Error('the memory folder could not be read'));
  }

  // One write, atomic: a failure leaves the file as it was and no temporary file behind.
  function writeFile(path: string, content: string): boolean {
    const tmp = `${path}.tmp-${process.pid}`;
    try {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(tmp, content);
      move(tmp, path);
      cache.delete(path);
      return true;
    } catch {
      rmSync(tmp, { force: true });
      return false;
    }
  }

  const isRealDir = (path: string): boolean => {
    try {
      const st = lstatSync(path);
      return st.isDirectory() && !st.isSymbolicLink();
    } catch {
      return false;
    }
  };

  function factsOf(path: string, fileId: string): (Facts & { mtimeMs: number }) | null {
    let st;
    try {
      st = lstatSync(path);
    } catch {
      return null;
    }
    if (!st.isFile() || st.isSymbolicLink()) return null;
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return Object.assign(hit.facts, { mtimeMs: st.mtimeMs });
    let facts: Facts;
    if (st.size > MAX_FILE_BYTES) {
      facts = { size: st.size, unread: true, sha: '', noteId: fileId, claims: {}, body: '', problems: ['text'], shown: '' };
    } else {
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        return null;
      }
      const parsed = parseNote(raw, fileId);
      facts =
        parsed.status === 'ok'
          ? { size: st.size, unread: false, sha: shaOf(raw), noteId: fileId, claims: parsed.claims, body: parsed.body, problems: problemsOf(parsed.claims, parsed.body), shown: redact(parsed.claims.title ?? '', home).slice(0, MEMORY_LIMITS.title) }
          : { size: st.size, unread: false, sha: '', noteId: null, claims: {}, body: '', problems: [], shown: '' };
    }
    cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, facts });
    return Object.assign(facts, { mtimeMs: st.mtimeMs });
  }

  // The prose validator again, for a note that is not the person's: whatever the header says and whoever edited the file, an agent's note is held to what the app would accept.
  function proseOk(f: Facts): boolean {
    if (f.prose === undefined) f.prose = !f.unread && checkProse(f.claims.title, 'title', { max: MEMORY_LIMITS.title, line: true, home }).ok && checkProse(f.body, 'text', { max: MEMORY_LIMITS.note, home }).ok;
    return f.prose;
  }

  function summary(s: Scope, id: string, f: Facts, st: NoteState | undefined, mtimeMs: number): NoteSummary {
    const person = st ? st.person || st.sha !== f.sha : false;
    const claimedRevision = Number(f.claims.revision);
    const unsafe = f.problems.length > 0 || (st !== undefined && !person && !proseOk(f));
    const note: NoteSummary = {
      id,
      conversation: s.conversation,
      agent: s.agent,
      kind: isNoteKind(f.claims.kind) ? f.claims.kind : null,
      title: f.shown,
      by: st?.by ?? s.agent,
      person,
      revision: st?.revision ?? (Number.isInteger(claimedRevision) && claimedRevision >= 1 ? claimedRevision : 1),
      reviewed: st?.reviewed ?? false,
      foreign: st === undefined,
      unsafe,
      at: st?.at ?? iso(mtimeMs),
      size: f.unread ? f.size : f.body.length,
    };
    const activity = shortLine(f.claims.activity);
    const repo = shortLine(f.claims.repo);
    if (activity) note.activity = redact(activity, home);
    if (repo) note.repo = redact(repo, home);
    return note;
  }

  // The files of one agent's folder that are notes, with the state they read against.
  function notesOf(s: Scope): { notes: NoteSummary[]; skipped: number } {
    const folder = folderOf(s);
    const read = states.read(folder);
    const state: FolderState = read.status === 'ok' ? read.state : { version: STATE_VERSION, notes: {} };
    const notes: NoteSummary[] = [];
    let skipped = 0;
    let entries: string[];
    try {
      entries = readdirSync(folder).sort();
    } catch {
      unreadable();
      return { notes, skipped };
    }
    for (const name of entries) {
      if (name === STATE_FILE) continue;
      if (TMP.test(name)) {
        sweep(join(folder, name));
        continue;
      }
      if (!NOTE_FILE.test(name)) {
        skipped++;
        continue;
      }
      const id = name.slice(0, -3);
      const facts = factsOf(join(folder, name), id);
      if (!facts || facts.noteId === null) {
        skipped++;
        continue;
      }
      notes.push(summary(s, id, facts, state.notes[id], facts.mtimeMs));
    }
    return { notes, skipped };
  }

  // A write that died between the temporary file and the move leaves `<file>.tmp-<pid>` behind; one older than an hour is no write in progress.
  function sweep(path: string): void {
    try {
      if (now() - statSync(path).mtimeMs > TMP_STALE_MS) rmSync(path, { force: true });
    } catch {
      // left for the next listing
    }
  }

  // Every folder of the memory, an empty one included; what is in the way of the layout (a file, a link, a name that is not an id) is counted and left alone.
  function scopes(filter: { conversation?: string; agent?: string } = {}): { scopes: Scope[]; skipped: number } {
    const out: { scopes: Scope[]; skipped: number } = { scopes: [], skipped: 0 };
    let conversations: string[];
    try {
      conversations = existsSync(root) ? readdirSync(root).sort() : [];
    } catch {
      unreadable();
      return out;
    }
    for (const conversation of conversations) {
      if (filter.conversation !== undefined && conversation !== filter.conversation) continue;
      const cdir = join(root, conversation);
      if (!CONVERSATION_ID.test(conversation) || !isRealDir(cdir)) {
        out.skipped++;
        continue;
      }
      let agents: string[];
      try {
        agents = readdirSync(cdir).sort();
      } catch {
        unreadable();
        continue;
      }
      for (const agent of agents) {
        if (filter.agent !== undefined && agent !== filter.agent) continue;
        if (!AGENT_ID.test(agent) || !isRealDir(join(cdir, agent))) {
          out.skipped++;
          continue;
        }
        out.scopes.push({ conversation, agent });
      }
    }
    return out;
  }

  function list(filter: { conversation?: string; agent?: string } = {}): Listing {
    const found = scopes(filter);
    const out: Listing = { notes: [], folders: found.scopes, skipped: found.skipped };
    for (const scope of found.scopes) {
      const got = notesOf(scope);
      out.notes.push(...got.notes);
      out.skipped += got.skipped;
    }
    return out;
  }

  function locate(id: string): Scope | null {
    if (!NOTE_ID.test(id)) return null;
    return scopes().scopes.find((f) => existsSync(fileOf(f, id))) ?? null;
  }

  function where(s: Scope, id: string): { code: 'other-agent' | 'other-conversation' | 'not-found'; text: string; owner?: Scope } {
    const owner = locate(id);
    if (!owner) return { code: 'not-found', text: `there is no note ${id}` };
    if (owner.conversation !== s.conversation) return { code: 'other-conversation', text: `note ${id} is in another conversation; write a new note here`, owner };
    return { code: 'other-agent', text: `note ${id} is ${owner.agent}'s; only that agent or the person changes it`, owner };
  }

  function ensureFolder(s: Scope): boolean {
    if (!validScope(s)) return false;
    try {
      mkdirSync(folderOf(s), { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  function read(s: Scope, id: string, as: 'agent' | 'person'): ReadResult {
    if (!validScope(s) || !NOTE_ID.test(id)) return { status: 'missing' };
    const path = fileOf(s, id);
    const facts = factsOf(path, id);
    if (!facts || facts.noteId === null) return { status: 'missing' };
    const state = states.read(folderOf(s));
    const st = state.status === 'ok' ? state.state.notes[id] : undefined;
    const note = summary(s, id, facts, st, facts.mtimeMs);
    if (as === 'agent') {
      if (note.foreign) return { status: 'hidden', reason: 'foreign' };
      if (note.unsafe) return { status: 'hidden', reason: 'unsafe' };
      if (!note.reviewed) return { status: 'hidden', reason: 'review' };
    }
    return { status: 'ok', note, text: facts.unread ? '' : redact(facts.body, home) };
  }

  function count(s: Scope): number {
    try {
      return readdirSync(folderOf(s)).filter((n) => NOTE_FILE.test(n)).length;
    } catch {
      return 0;
    }
  }

  function freshId(s: Scope, state: FolderState): string | null {
    for (let i = 0; i < 20; i++) {
      const id = `m-${hex()}`;
      if (NOTE_ID.test(id) && !existsSync(fileOf(s, id)) && !state.notes[id]) return id;
    }
    return null;
  }

  function save(req: SaveRequest): SaveResult {
    const s = req.scope;
    if (!validScope(s)) return { ok: false, code: 'invalid', text: 'the conversation or the agent is not a valid id' };
    const refusals: Refusal[] = [];
    if (!isNoteKind(req.kind)) refusals.push({ field: 'kind', code: 'type', text: 'kind must be one of decision, finding, note' });
    const title = checkProse(req.title, 'title', { max: MEMORY_LIMITS.title, line: true, home: req.home ?? home });
    const text = checkProse(req.text, 'text', { max: MEMORY_LIMITS.note, home: req.home ?? home });
    if (!title.ok) refusals.push(...title.refusals);
    if (!text.ok) refusals.push(...text.refusals);
    // A secret value the call knows is refused, never cut: the note would carry it to every agent.
    if (req.mask) {
      if (title.ok && req.mask(title.value) !== title.value) refusals.push({ field: 'title', code: 'credential', text: 'title holds what looks like a credential; write <value> where a value goes' });
      if (text.ok && req.mask(text.value) !== text.value) refusals.push({ field: 'text', code: 'credential', text: 'text holds what looks like a credential; write <value> where a value goes' });
    }
    for (const [field, v] of [['activity', req.activity], ['repo', req.repo]] as const) {
      if (v !== undefined && shortLine(v) === undefined) refusals.push({ field, code: 'type', text: `${field} must be one short line` });
    }
    if (refusals.length || !title.ok || !text.ok || !isNoteKind(req.kind)) return { ok: false, code: 'invalid', text: describeRefusals(refusals), refusals };

    const folder = folderOf(s);
    const read = states.read(folder);
    if (read.status === 'newer') return { ok: false, code: 'newer', text: 'this folder was written by a newer version of the app; it is left as it is' };
    const state = read.state;
    const at = iso(now());
    const activity = req.activity;
    const repo = req.repo;

    if (req.id !== undefined) {
      if (!NOTE_ID.test(req.id)) return { ok: false, code: 'not-found', text: 'the note id is not in the form m-<8 hex>' };
      const path = fileOf(s, req.id);
      const facts = factsOf(path, req.id);
      if (!facts || facts.noteId === null) {
        const w = where(s, req.id);
        return { ok: false, code: w.code, text: w.text, owner: w.owner };
      }
      const st = state.notes[req.id];
      if (!st) return { ok: false, code: 'foreign', text: `note ${req.id} is not one the app wrote; only the person changes it` };
      if (st.person || st.sha !== facts.sha) return { ok: false, code: 'person', text: `note ${req.id} was edited by the person; their version is kept, write a new note instead` };
      if (req.revision !== st.revision) return { ok: false, code: 'revision', text: `note ${req.id} is at revision ${st.revision}; read it again and name that revision` };
      const revision = st.revision + 1;
      const content = renderNote({ id: req.id, kind: req.kind, title: title.value, by: s.agent, at, revision, reviewed: req.handoff !== true, activity, repo }, text.value);
      if (!writeFile(path, content)) return { ok: false, code: 'io', text: 'the note could not be written' };
      state.notes[req.id] = { by: s.agent, person: false, revision, reviewed: req.handoff !== true, sha: shaOf(content), at };
      // A crash between the two writes leaves the old hash: the note then reads as the person's, which is the safe side.
      if (!states.write(folder, prune(s, state))) return { ok: false, code: 'io', text: 'the note could not be written' };
      return { ok: true, note: noteOf(s, req.id), created: false };
    }

    if (count(s) >= MEMORY_LIMITS.filesPerAgent) return { ok: false, code: 'cap-files', text: `this folder already holds ${MEMORY_LIMITS.filesPerAgent} notes; replace or remove one` };
    const id = freshId(s, state);
    if (!id) return { ok: false, code: 'io', text: 'a note id could not be drawn' };
    const path = fileOf(s, id);
    const content = renderNote({ id, kind: req.kind, title: title.value, by: s.agent, at, revision: 1, reviewed: req.handoff !== true, activity, repo }, text.value);
    if (!writeFile(path, content)) return { ok: false, code: 'io', text: 'the note could not be written' };
    state.notes[id] = { by: s.agent, person: false, revision: 1, reviewed: req.handoff !== true, sha: shaOf(content), at };
    if (!states.write(folder, prune(s, state))) {
      // A note with no entry would read as foreign; the write failed as a whole, so it is taken back.
      rmSync(path, { force: true });
      cache.delete(path);
      return { ok: false, code: 'io', text: 'the note could not be written' };
    }
    return { ok: true, note: noteOf(s, id), created: true };
  }

  function noteOf(s: Scope, id: string): NoteSummary {
    const r = read(s, id, 'person');
    if (r.status !== 'ok') throw new Error('the note that was just written could not be read back');
    return r.note;
  }

  // The state keeps no entry for a note that is not there (the person removed the file on disk); every write of a state drops them.
  function prune(s: Scope, state: FolderState): FolderState {
    for (const id of Object.keys(state.notes)) if (!existsSync(fileOf(s, id))) delete state.notes[id];
    return state;
  }

  function drop(s: Scope, id: string, who: 'agent' | 'person'): RemoveResult {
    if (!validScope(s)) return { ok: false, code: 'not-found', text: 'the conversation or the agent is not a valid id' };
    if (!NOTE_ID.test(id)) return { ok: false, code: 'not-found', text: 'the note id is not in the form m-<8 hex>' };
    const folder = folderOf(s);
    const path = fileOf(s, id);
    const facts = factsOf(path, id);
    if (!facts || facts.noteId === null) {
      if (who === 'person') return { ok: false, code: 'not-found', text: `there is no note ${id}` };
      const w = where(s, id);
      return { ok: false, code: w.code, text: w.text, owner: w.owner };
    }
    const read = states.read(folder);
    if (read.status === 'newer') return { ok: false, code: 'newer', text: 'this folder was written by a newer version of the app; it is left as it is' };
    const st = read.state.notes[id];
    if (who === 'agent') {
      if (!st) return { ok: false, code: 'foreign', text: `note ${id} is not one the app wrote; only the person changes it` };
      if (st.person || st.sha !== facts.sha) return { ok: false, code: 'person', text: `note ${id} was edited by the person; their version is kept` };
    }
    try {
      rmSync(path, { force: true });
    } catch {
      return { ok: false, code: 'io', text: 'the note could not be removed' };
    }
    cache.delete(path);
    delete read.state.notes[id];
    // The note is gone for the next reader whether or not the state entry could be dropped: a stale entry for a missing file is pruned by the next write.
    states.write(folder, prune(s, read.state));
    return { ok: true };
  }

  function edit(req: EditRequest): EditResult {
    const s = req.scope;
    if (!validScope(s) || !NOTE_ID.test(req.id)) return { ok: false, code: 'not-found', text: 'the note is not at a valid place' };
    const path = fileOf(s, req.id);
    const facts = factsOf(path, req.id);
    if (!facts || facts.noteId === null) return { ok: false, code: 'not-found', text: `there is no note ${req.id}` };
    const folder = folderOf(s);
    const read = states.read(folder);
    if (read.status === 'newer') return { ok: false, code: 'newer', text: 'this folder was written by a newer version of the app; it is left as it is' };
    const st = read.state.notes[req.id];
    if (req.revision !== undefined && st && req.revision !== st.revision) return { ok: false, code: 'revision', text: `note ${req.id} changed since it was opened; open it again` };
    const refusals: Refusal[] = [];
    const maskOf = (v: string): string => {
      const masked = redact(v, req.home ?? home);
      return req.mask ? req.mask(masked) : masked;
    };
    // The person's text is masked, not refused: it is theirs; only its shape is checked.
    const claimedKind = isNoteKind(facts.claims.kind) ? facts.claims.kind : undefined;
    const kind = req.kind ?? claimedKind;
    if (!isNoteKind(kind)) refusals.push({ field: 'kind', code: 'type', text: 'kind must be one of decision, finding, note' });
    const title = maskOf((req.title ?? facts.claims.title ?? '').trim());
    if (!title || title.length > MEMORY_LIMITS.title || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(title)) refusals.push({ field: 'title', code: 'type', text: `title must be one line of 1 to ${MEMORY_LIMITS.title} characters` });
    const body = maskOf((req.text ?? facts.body).replace(/\r\n/g, '\n').trim());
    if (!body || body.length > MEMORY_LIMITS.note) refusals.push({ field: 'text', code: 'type', text: `text must be 1 to ${MEMORY_LIMITS.note} characters` });
    if (refusals.length || !isNoteKind(kind)) return { ok: false, code: 'invalid', text: describeRefusals(refusals), refusals };
    const claimedRevision = Number(facts.claims.revision);
    const revision = (st?.revision ?? (Number.isInteger(claimedRevision) && claimedRevision >= 1 ? claimedRevision : 0)) + 1;
    const at = iso(now());
    const content = renderNote({ id: req.id, kind, title, by: 'person', at, revision, reviewed: true, activity: shortLine(facts.claims.activity), repo: shortLine(facts.claims.repo) }, body);
    if (!writeFile(path, content)) return { ok: false, code: 'io', text: 'the note could not be written' };
    read.state.notes[req.id] = { by: st?.by ?? s.agent, person: true, revision, reviewed: true, sha: shaOf(content), at };
    if (!states.write(folder, prune(s, read.state))) return { ok: false, code: 'io', text: 'the note could not be written' };
    return { ok: true, note: noteOf(s, req.id) };
  }

  function review(s: Scope, id: string): ReviewResult {
    if (!validScope(s) || !NOTE_ID.test(id)) return { ok: false, code: 'not-found', text: 'the note is not at a valid place' };
    const facts = factsOf(fileOf(s, id), id);
    if (!facts || facts.noteId === null) return { ok: false, code: 'not-found', text: `there is no note ${id}` };
    if (facts.problems.length) return { ok: false, code: 'unsafe', text: `note ${id} does not pass the checks; edit it first` };
    const folder = folderOf(s);
    const read = states.read(folder);
    if (read.status === 'newer') return { ok: false, code: 'newer', text: 'this folder was written by a newer version of the app; it is left as it is' };
    const st = read.state.notes[id];
    const claimedRevision = Number(facts.claims.revision);
    // A foreign note, or one changed outside the app, is the person's from now on: they looked at that text and said it may be read.
    const changed = !st || st.sha !== facts.sha;
    read.state.notes[id] = {
      by: st?.by ?? s.agent,
      person: (st?.person ?? false) || changed,
      revision: st?.revision ?? (Number.isInteger(claimedRevision) && claimedRevision >= 1 ? claimedRevision : 1),
      reviewed: true,
      sha: st && !changed ? st.sha : facts.sha,
      at: st?.at ?? iso(now()),
    };
    if (!states.write(folder, prune(s, read.state))) return { ok: false, code: 'io', text: 'the note could not be marked' };
    return { ok: true, note: noteOf(s, id) };
  }

  function removeFolder(s: Scope): boolean {
    if (!validScope(s) || !isRealDir(folderOf(s))) return false;
    try {
      rmSync(folderOf(s), { recursive: true, force: true });
    } catch {
      return false;
    }
    for (const key of cache.keys()) if (key.startsWith(`${folderOf(s)}/`)) cache.delete(key);
    return true;
  }

  function removeConversation(conversation: string): boolean {
    if (!CONVERSATION_ID.test(conversation)) return false;
    const dir = join(root, conversation);
    if (!isRealDir(dir)) return false;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      return false;
    }
    for (const key of cache.keys()) if (key.startsWith(`${dir}/`)) cache.delete(key);
    return true;
  }

  // The change is announced once the call is over, and only when it took effect; a listener that throws never turns a write into a failure.
  const announce = <R,>(r: R, took: (r: R) => boolean): R => {
    if (took(r)) {
      try {
        deps.onChange?.();
      } catch {
        // the write already happened
      }
    }
    return r;
  };
  const okOf = (r: { ok: boolean }): boolean => r.ok;

  return {
    list,
    read,
    ensureFolder: (s) => {
      const had = validScope(s) && existsSync(folderOf(s));
      return announce(ensureFolder(s), (made) => made && !had);
    },
    save: (req) => announce(save(req), okOf),
    remove: (s, id) => announce(drop(s, id, 'agent'), okOf),
    edit: (req) => announce(edit(req), okOf),
    review: (s, id) => announce(review(s, id), okOf),
    removeNote: (s, id) => announce(drop(s, id, 'person'), okOf),
    removeFolder: (s) => announce(removeFolder(s), Boolean),
    removeConversation: (c) => announce(removeConversation(c), Boolean),
    locate,
  };
}
