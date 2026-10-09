import type { AuditEntry } from '../../shared/auditoria';
import type { WorkspaceConfig } from '../../shared/config/types';
import { isProcedureId, proceduresOn, type ProcedureRecord } from '../../shared/procedures';
import { statsOf, summarize, type ProcedureDelete, type ProcedureGet, type ProcedureListView, type ProcedureStatsView, type ProcedureWrite } from '../../shared/proceduresView';
import { procedureAuditEntry, type ProcedureAuditInput } from './audit';
import type { ProcedureStore, SaveResult, Writer } from './store';

// What the Procedures view asks of the app. The reads (list, get, stats) are open to a paired browser; every write is the desktop window's, and webPolicy.ts closes the
// whole `procedures:` prefix except those three. The person's writes go through the same store and the same validator as an agent's, are marked as the person's and
// reviewed, and are audited with no issue and no thread line. They work whatever the workspace switch says: it only governs the agents' side.

export interface ChannelDeps {
  store: ProcedureStore;
  config(): WorkspaceConfig;
  audit?(entry: Omit<AuditEntry, 'at'>): void;
  now?(): number;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
}

const PERSON: Writer = { by: 'person', surface: 'person' };
const id = (v: unknown): string => (typeof v === 'string' ? v : '');
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface ProcedureChannels {
  list(): ProcedureListView;
  get(id: unknown): ProcedureGet;
  stats(): ProcedureStatsView;
  save(id: unknown, revision: unknown, input: unknown): ProcedureWrite;
  delete(id: unknown): ProcedureDelete;
  review(id: unknown): ProcedureWrite;
  restore(id: unknown, revision: unknown): ProcedureWrite;
}

export function createProcedureChannels(deps: ChannelDeps): ProcedureChannels {
  const now = deps.now ?? Date.now;
  const { store } = deps;
  const repos = (): string[] => deps.config().projects.repos.map((r) => r.id);

  const audit = (input: Omit<ProcedureAuditInput, 'by' | 'surface'>): void => {
    try {
      deps.audit?.(procedureAuditEntry({ ...input, by: PERSON.by, surface: 'person' }));
    } catch {
      // The write already happened; a failing log must not turn it into a reported failure.
    }
  };

  const gone = (v: ReturnType<ProcedureStore['get']>, who: string): ProcedureWrite | null => {
    if (v.status === 'ok') return null;
    if (v.status === 'newer') return { ok: false, code: 'newer', id: who, text: `${who} was written by a newer app and is left alone.` };
    if (v.status === 'deleted') return { ok: false, code: 'deleted', id: who, text: `${who} was deleted.` };
    return { ok: false, code: 'not-found', id: who, text: `${who} not found.` };
  };

  // A refusal is audited by its code and the fields it named, never by the text that was refused.
  const written = (op: 'replace' | 'restore', r: SaveResult): ProcedureWrite => {
    if (!r.ok) {
      audit({ op: 'refused', code: r.code, fields: r.refusals?.map((x) => x.field) ?? [] });
      return { ok: false, code: r.code, text: r.text, ...(r.refusals ? { refusals: r.refusals } : {}), ...(r.id ? { id: r.id } : {}) };
    }
    audit({ op, record: r.record });
    return { ok: true, record: r.record };
  };

  return {
    list() {
      const { records, skipped } = store.list();
      return { items: records.map((r) => summarize(r, now())), skipped, enabled: proceduresOn(deps.config()) };
    },

    get(which) {
      const want = id(which);
      return isProcedureId(want) ? store.get(want) : { status: 'missing' };
    },

    stats() {
      return statsOf(store.list().records, proceduresOn(deps.config()), now());
    },

    // The person's edit of a record: only an existing one (a record is created by an agent), the revision read named, the text through the validator.
    save(which, revision, input) {
      const want = id(which);
      const old = store.get(want);
      const missing = gone(old, want);
      if (missing || old.status !== 'ok') return missing as ProcedureWrite;
      const rev = typeof revision === 'number' && Number.isInteger(revision) ? revision : undefined;
      // The steps of a draft the agent confirmed stay "recording" until the person rewrites one.
      const steps = (input as { steps?: unknown } | null)?.steps;
      const stepsFrom = old.record.stepsFrom === 'recording' && !sameJson(steps, old.record.steps) ? 'edited' : old.record.stepsFrom;
      return written('replace', store.save({ input, id: want, revision: rev, writer: PERSON, repos: repos(), stepsFrom, home: deps.home }));
    },

    delete(which) {
      const want = id(which);
      const old = store.get(want);
      if (old.status === 'newer') return { ok: false, code: 'newer' };
      if (old.status !== 'ok' && old.status !== 'invalid') return { ok: false, code: 'not-found' };
      const done = store.remove(want);
      if (done.ok && old.status === 'ok') audit({ op: 'delete', record: old.record });
      else if (done.ok) audit({ op: 'delete' });
      return done;
    },

    // The person looked at it: the text is the same, so the revision stays and the agents that read it can still replace it.
    review(which) {
      const want = id(which);
      const old = store.get(want);
      const missing = gone(old, want);
      if (missing || old.status !== 'ok') return missing as ProcedureWrite;
      if (old.record.reviewed) return { ok: true, record: old.record };
      const r = store.review(want);
      if (!r.ok) return { ok: false, code: r.code, id: want, text: r.text };
      audit({ op: 'review', record: r.record });
      return { ok: true, record: r.record };
    },

    // The version before this one comes back as a new revision (the current text becomes the "previous", so a second restore undoes the first).
    restore(which, revision) {
      const want = id(which);
      const old = store.get(want);
      const missing = gone(old, want);
      if (missing || old.status !== 'ok') return missing as ProcedureWrite;
      const r: ProcedureRecord = old.record;
      if (!r.previous) return { ok: false, code: 'no-previous', id: want, text: `${want} has no earlier version to restore.` };
      const rev = typeof revision === 'number' && Number.isInteger(revision) ? revision : undefined;
      const input = { kind: r.kind, key: r.key, ...r.previous };
      return written('restore', store.save({ input, id: want, revision: rev, writer: PERSON, repos: repos(), stepsFrom: r.stepsFrom, home: deps.home }));
    },
  };
}
