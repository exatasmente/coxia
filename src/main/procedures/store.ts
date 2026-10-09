import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StageUsage } from '../../shared/runs/types';
import {
  LIMITS,
  PROCEDURE_ID,
  PROCEDURE_VERSION,
  awaitsReview,
  isProcedureId,
  normalTitle,
  sameKey,
  type ProcedureOrigin,
  type ProcedurePrevious,
  type ProcedureRecord,
  type ProcedureUse,
  type StepsFrom,
} from '../../shared/procedures';
import { MEMORY_DIR } from '../runner/activities';
import { checkContent, describeRefusals, parseRecord, type Refusal } from './record';

// The workspace's procedures: one file per record under <workspace>/memory/procedures/, and `deleted.json`, the ids that were ever deleted. The app is the only writer,
// a record is never in a worktree (it would ride the pull request), and nothing here imports Electron: a reader module with no app in it, so a read-only wrapper
// can be added later. Store calls are synchronous inside one process, so a read-compare-write needs no lock; a second app instance on the same folder would meet
// the revision check.

export const PROCEDURES_DIR = 'procedures';
export const DELETED_FILE = 'deleted.json';

export const proceduresPath = (dir: string): string => join(dir, MEMORY_DIR, PROCEDURES_DIR);

const FILE = /^(p-[0-9a-f]{8})\.json$/;

export interface Writer {
  by: string;
  surface: ProcedureOrigin['surface'];
  stage?: string;
  ref?: string;
  permission?: ProcedureOrigin['permission'];
  shell?: ProcedureOrigin['shell'];
}

export interface SaveRequest {
  /** The content as typed by the agent or the person: the store validates it. */
  input: unknown;
  /** Replaces this record. It must name the revision it read. */
  id?: string;
  revision?: number;
  writer: Writer;
  /** The ids of the workspace's repositories, for the key of a `repo` and a `cycle` record. */
  repos: readonly string[];
  keyedBy?: 'app';
  stepsFrom?: StepsFrom;
  /** The call that writes it had a hand-off: the record waits for the person's review. */
  handoff?: boolean;
  home?: string;
}

export type SaveRefusal =
  | 'invalid'
  | 'cap-key'
  | 'cap-workspace'
  | 'duplicate'
  | 'revision'
  | 'not-found'
  | 'deleted'
  | 'newer'
  | 'io';

export type SaveResult = { ok: true; record: ProcedureRecord; created: boolean } | { ok: false; code: SaveRefusal; text: string; refusals?: Refusal[]; id?: string };

export type GetResult =
  | { status: 'ok'; record: ProcedureRecord }
  | { status: 'missing' }
  | { status: 'deleted' }
  | { status: 'newer'; v: number }
  | { status: 'invalid' };

export type MarkResult = { ok: true; record: ProcedureRecord } | { ok: false; code: 'not-found' | 'deleted' | 'newer' | 'step' | 'revision' | 'io'; text: string };

export interface CallEnd {
  at: string;
  /** The run reference or the thread id. */
  ref: string;
  /** What the call used, as metered. */
  usage: StageUsage;
  /** The procedures the call read. */
  read: readonly string[];
  /** The ones the call reported as failing (already marked when they were reported). */
  stale: readonly string[];
  /** The ones the call replaced with a new revision. */
  replaced: readonly string[];
  /** The ones the call created: the usage is the cost of finding them. */
  created: readonly string[];
}

export interface StoreDeps {
  now?: () => number;
  /** Eight hex digits for a new id. */
  hex?: () => string;
  /** Moves the written file into place; a test makes it fail. */
  rename?: (from: string, to: string) => void;
  /** Where a folder that cannot be read is reported (the error log). It gets a sentence with no path in it, once. */
  onError?: (error: Error) => void;
}

export interface ProcedureStore {
  /** Every record this app can read. A file of a newer app or one that is not a record is left out (`skipped` counts them). */
  list(): { records: ProcedureRecord[]; skipped: number };
  get(id: string): GetResult;
  save(req: SaveRequest): SaveResult;
  /** Removes the record's file and remembers the id so it is never drawn again. Only the person's door calls this. */
  remove(id: string): { ok: true } | { ok: false; code: 'not-found' | 'newer' | 'io' };
  /**
   * An agent said step `step` no longer works: the record is failing. The revision does not move (it is the text's). `revision` is the one the agent read: a report on a
   * record that has a newer revision is about text that is gone, and is refused.
   */
  stale(id: string, step: number, at: string, revision?: number): MarkResult;
  /** The person looked at this record: it is marked reviewed. The text did not change, so the revision does not move. */
  review(id: string): MarkResult;
  /** A call ended: its reads become uses, and what it created gets its baseline. Returns what to mark on the call's record. */
  finishUse(end: CallEnd): ProcedureUse[];
}

const iso = (ms: number): string => new Date(ms).toISOString();

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The ids deleted so far. A file a newer app wrote is not read and not overwritten (`writable` false). */
function readDeleted(path: string): { ids: Set<string>; writable: boolean } {
  if (!existsSync(path)) return { ids: new Set(), writable: true };
  const raw = readJson(path) as { v?: unknown; ids?: unknown } | undefined;
  if (raw && typeof raw === 'object' && typeof raw.v === 'number' && raw.v > PROCEDURE_VERSION) return { ids: new Set(), writable: false };
  return { ids: new Set(raw && Array.isArray(raw.ids) ? raw.ids.filter(isProcedureId) : []), writable: true };
}

export function createProcedureStore(workspaceDir: string, deps: StoreDeps = {}): ProcedureStore {
  const root = proceduresPath(workspaceDir);
  const deletedFile = join(root, DELETED_FILE);
  const now = deps.now ?? Date.now;
  const hex = deps.hex ?? (() => randomBytes(4).toString('hex'));
  const move = deps.rename ?? renameSync;
  const fileOf = (id: string): string => join(root, `${id}.json`);
  let unreadableSaid = false;

  // One write, atomic: a failure leaves the file as it was and no temporary file behind.
  function write(path: string, value: unknown): boolean {
    const tmp = `${path}.tmp-${process.pid}`;
    try {
      mkdirSync(root, { recursive: true });
      writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`);
      move(tmp, path);
      return true;
    } catch {
      rmSync(tmp, { force: true });
      return false;
    }
  }

  function read(id: string): GetResult {
    if (!PROCEDURE_ID.test(id)) return { status: 'missing' };
    const path = fileOf(id);
    if (!existsSync(path)) return readDeleted(deletedFile).ids.has(id) ? { status: 'deleted' } : { status: 'missing' };
    const parsed = parseRecord(readJson(path));
    if (parsed.status === 'ok') return parsed.record.id === id ? { status: 'ok', record: parsed.record } : { status: 'invalid' };
    return parsed.status === 'newer' ? parsed : { status: 'invalid' };
  }

  function list(): { records: ProcedureRecord[]; skipped: number } {
    if (!existsSync(root)) return { records: [], skipped: 0 };
    const records: ProcedureRecord[] = [];
    let skipped = 0;
    let names: string[];
    try {
      names = readdirSync(root).sort();
    } catch (e) {
      // A folder that cannot be read counts as empty: a stage and an answer go on without procedures. The path stays out of the line.
      if (!unreadableSaid) {
        unreadableSaid = true;
        try {
          deps.onError?.(new Error(`the procedures folder could not be read (${(e as NodeJS.ErrnoException).code ?? 'error'})`));
        } catch {
          // The log failing is not the store's to know.
        }
      }
      return { records: [], skipped: 0 };
    }
    for (const name of names) {
      const m = FILE.exec(name);
      if (!m) continue;
      const got = read(m[1]);
      if (got.status === 'ok') records.push(got.record);
      else skipped++;
    }
    return { records, skipped };
  }

  // The id is drawn again until it is neither a file nor a deleted one: an id is never reused.
  function freshId(): string {
    const gone = readDeleted(deletedFile).ids;
    for (let i = 0; i < 64; i++) {
      const id = `p-${hex()}`;
      if (PROCEDURE_ID.test(id) && !gone.has(id) && !existsSync(fileOf(id))) return id;
    }
    throw new Error('could not draw a free procedure id');
  }

  const leastUsed = (records: ProcedureRecord[]): ProcedureRecord | undefined =>
    [...records].sort((a, b) => a.stats.uses - b.stats.uses || (a.stats.lastUsed ?? a.origin.at).localeCompare(b.stats.lastUsed ?? b.origin.at))[0];

  const describe = (r: ProcedureRecord): string => `${r.id} "${r.title}" (${r.stats.uses} uses, ${r.state})`;

  // The version before this one, kept once. An agent that replaces an agent's version, which the person has neither written nor reviewed, keeps the person's version that is
  // already there instead of pushing it out with one of an agent's.
  function previousFor(old: ProcedureRecord, person: boolean): ProcedurePrevious {
    const byPerson = old.origin.by === 'person' || old.reviewed;
    if (!person && !byPerson && old.previous?.byPerson) return old.previous;
    return { title: old.title, steps: old.steps, pitfalls: old.pitfalls, waits: old.waits, ...(byPerson ? { byPerson: true as const } : {}) };
  }

  function save(req: SaveRequest): SaveResult {
    const checked = checkContent(req.input, { repos: req.repos, home: req.home });
    if (!checked.ok) return { ok: false, code: 'invalid', refusals: checked.refusals, text: `Not saved. Fix these and save again:\n${describeRefusals(checked.refusals)}` };
    const content = checked.value;

    let old: ProcedureRecord | null = null;
    if (req.id !== undefined) {
      const got = read(req.id);
      if (got.status === 'deleted') return { ok: false, code: 'deleted', id: req.id, text: `${req.id} was deleted by the person; it is gone. Save it as a new procedure (no id).` };
      if (got.status === 'newer') return { ok: false, code: 'newer', id: req.id, text: `${req.id} was written by a newer app and is left alone.` };
      if (got.status !== 'ok') return { ok: false, code: 'not-found', id: req.id, text: `${req.id} not found; save a new one (no id).` };
      old = got.record;
    }

    const others = list().records.filter((r) => r.id !== old?.id);
    const sameGroup = others.filter((r) => r.kind === content.kind && sameKey(r.key, content.key));
    // A record that waits for the person's review is not open to an agent: a refusal does not name it, its title or its id. The person is told everything.
    const open = (r: ProcedureRecord): boolean => req.writer.by === 'person' || !awaitsReview(r);
    const twin = sameGroup.find((r) => normalTitle(r.title) === normalTitle(content.title));
    if (twin && !open(twin)) return { ok: false, code: 'duplicate', text: `A procedure with this title already exists for ${content.kind} ${content.key} and is not open to you. Save it under another title, or none.` };
    if (twin) return { ok: false, code: 'duplicate', id: twin.id, text: `It exists: ${describe(twin)}. Update that one: save with its id and the revision you read (${twin.revision}).` };
    if (sameGroup.length >= LIMITS.perKey) {
      const victim = leastUsed(sameGroup.filter(open));
      if (!victim) return { ok: false, code: 'cap-key', text: `There are already ${LIMITS.perKey} procedures for ${content.kind} ${content.key}, and none of them is open to you. Save none.` };
      return { ok: false, code: 'cap-key', id: victim.id, text: `There are already ${LIMITS.perKey} procedures for ${content.kind} ${content.key}. Replace one instead of adding: the least used is ${describe(victim)}; save with its id and revision ${victim.revision}.` };
    }
    if (!old && others.length >= LIMITS.perWorkspace) {
      const victim = leastUsed(others.filter(open));
      if (!victim) return { ok: false, code: 'cap-workspace', text: `The workspace holds ${LIMITS.perWorkspace} procedures, the most, and none of them is open to you. Save none.` };
      return { ok: false, code: 'cap-workspace', id: victim.id, text: `The workspace holds ${LIMITS.perWorkspace} procedures, the most. Replace one instead of adding: the least used is ${describe(victim)}; save with its id and revision ${victim.revision}.` };
    }
    if (old && req.revision !== old.revision) {
      return { ok: false, code: 'revision', id: old.id, text: `${old.id} changed since you read it (it is at revision ${old.revision}, you named ${req.revision ?? 'none'}). Read it again with procedures_get, then save.` };
    }

    const at = iso(now());
    const person = req.writer.by === 'person';
    const origin: ProcedureOrigin = { ...req.writer, createdBy: old ? old.origin.createdBy : req.writer.by, ...(req.handoff && !person ? { handoff: true as const } : {}), at };
    const keyedBy = req.keyedBy ?? (old && sameKey(old.key, content.key) ? old.keyedBy : undefined);
    const base = { v: PROCEDURE_VERSION, ...content };
    let record: ProcedureRecord;
    if (!old) {
      record = {
        ...base,
        id: freshId(),
        revision: 1,
        state: 'unverified',
        lastVerified: null,
        lastFailed: null,
        stats: { uses: 0, failures: 0, failuresSinceSave: 0, lastUsed: null, baseline: null, recent: [] },
        origin,
        ...(keyedBy ? { keyedBy } : {}),
        stepsFrom: req.stepsFrom ?? 'agent',
        reviewed: person,
        previous: null,
      } as ProcedureRecord;
    } else {
      // A new revision replaces the text and keeps the one before it, once. An agent's version is unverified until a later use; the person's keeps its state, except that
      // what was failing is fresh text now. The text is new, so the failures since the last save start again; what finding it cost stays.
      const keepsState = person && old.state !== 'failing';
      record = {
        ...base,
        id: old.id,
        revision: old.revision + 1,
        state: keepsState ? old.state : 'unverified',
        lastVerified: keepsState ? old.lastVerified : null,
        lastFailed: old.lastFailed,
        stats: { ...old.stats, failuresSinceSave: 0 },
        origin,
        ...(keyedBy ? { keyedBy } : {}),
        stepsFrom: req.stepsFrom ?? 'agent',
        reviewed: person,
        previous: previousFor(old, person),
      } as ProcedureRecord;
    }
    if (!write(fileOf(record.id), record)) return { ok: false, code: 'io', text: 'The procedure could not be written. Nothing was changed.' };
    return { ok: true, record, created: !old };
  }

  function remove(id: string): { ok: true } | { ok: false; code: 'not-found' | 'newer' | 'io' } {
    const got = read(id);
    if (got.status === 'newer') return { ok: false, code: 'newer' };
    if (got.status === 'missing' || got.status === 'deleted') return { ok: false, code: 'not-found' };
    const gone = readDeleted(deletedFile);
    if (!gone.writable) return { ok: false, code: 'newer' };
    // The id is remembered first: if the file removal fails the record stays and an id is never reused anyway; the other order could draw it again.
    gone.ids.add(id);
    if (!write(deletedFile, { v: PROCEDURE_VERSION, ids: [...gone.ids].sort() })) return { ok: false, code: 'io' };
    rmSync(fileOf(id), { force: true });
    return { ok: true };
  }

  // A state or figure moves, not the text: the revision stays, so an agent that read a revision can still replace it.
  function change(id: string, apply: (r: ProcedureRecord) => ProcedureRecord): MarkResult {
    const got = read(id);
    if (got.status === 'deleted') return { ok: false, code: 'deleted', text: `${id} was deleted.` };
    if (got.status === 'newer') return { ok: false, code: 'newer', text: `${id} was written by a newer app and is left alone.` };
    if (got.status !== 'ok') return { ok: false, code: 'not-found', text: `${id} not found.` };
    const next = apply(got.record);
    return write(fileOf(id), next) ? { ok: true, record: next } : { ok: false, code: 'io', text: 'The procedure could not be written.' };
  }

  function stale(id: string, step: number, at: string, revision?: number): MarkResult {
    const got = read(id);
    if (got.status === 'ok' && revision !== undefined && got.record.revision > revision) {
      return { ok: false, code: 'revision', text: `${id} changed since you read it (it is at revision ${got.record.revision}, you read ${revision}). Read it again with procedures_get before you report a step of it.` };
    }
    if (got.status === 'ok' && (!Number.isInteger(step) || step < 1 || step > got.record.steps.length)) {
      return { ok: false, code: 'step', text: `${id} has ${got.record.steps.length} steps; name one of 1 to ${got.record.steps.length}.` };
    }
    return change(id, (r) => ({ ...r, state: 'failing', lastFailed: { at, step }, stats: { ...r.stats, failures: r.stats.failures + 1, failuresSinceSave: r.stats.failuresSinceSave + 1 } }));
  }

  const review = (id: string): MarkResult => change(id, (r) => (r.reviewed ? r : { ...r, reviewed: true }));

  function finishUse(end: CallEnd): ProcedureUse[] {
    const out: ProcedureUse[] = [];
    for (const id of new Set(end.read)) {
      const replaced = end.replaced.includes(id);
      const failed = !replaced && end.stale.includes(id);
      const done = change(id, (r) => {
        if (replaced) return r;
        // The stale report already moved the state; the use is counted here, once, with the call's figures.
        const recent = [...r.stats.recent, { at: end.at, ref: end.ref, failed, usage: end.usage }].slice(-LIMITS.recent);
        const stats = { ...r.stats, uses: r.stats.uses + 1, lastUsed: end.at, recent };
        return failed ? { ...r, stats } : { ...r, state: 'ok', lastVerified: end.at, stats };
      });
      if (done.ok) out.push({ id, revision: done.record.revision, title: done.record.title, outcome: replaced ? 'replaced' : failed ? 'failed' : 'ok' });
    }
    for (const id of new Set(end.created)) change(id, (r) => (r.stats.baseline ? r : { ...r, stats: { ...r.stats, baseline: end.usage } }));
    return out;
  }

  return { list, get: read, save, remove, stale, review, finishUse };
}
