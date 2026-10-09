import type { AuditEntry } from '../../shared/auditoria';
import type { ProcedureRecord, ProcedureSurface } from '../../shared/procedures';

// What the procedure memory writes to `auditoria.jsonl`: a save, a replacement, a report that a step no longer works, and a refusal. Each entry is built from a fixed set of
// fields, so what the log never holds has no field to arrive in: no step, no pitfall, no wait, and for a refusal no title or key either (the text that was refused is
// the one thing that may be a secret). The log's own scrubbing (tokens) applies on top.

export type ProcedureOp = 'save' | 'replace' | 'stale' | 'refused';

export interface ProcedureAuditInput {
  op: ProcedureOp;
  /** The agent that did it, or `person`. */
  by: string;
  surface: ProcedureSurface;
  /** The run's issue number; absent outside a run. */
  issue?: number;
  /** The run reference or the thread id. */
  ref?: string;
  /** The record written or marked; absent for a refusal. */
  record?: Pick<ProcedureRecord, 'id' | 'revision' | 'kind' | 'key' | 'title'>;
  /** The step reported (`stale`). */
  step?: number;
  /** A refusal: its code and the fields it named (never their values). */
  code?: string;
  fields?: readonly string[];
}

const RESULT: Record<ProcedureOp, string> = { save: 'saved', replace: 'replaced', stale: 'marked failing', refused: 'refused' };

export function procedureAuditEntry(o: ProcedureAuditInput): Omit<AuditEntry, 'at'> {
  const fields: Record<string, string> = { agent: o.by, surface: o.surface };
  if (o.record) Object.assign(fields, { id: o.record.id, revision: String(o.record.revision), kind: o.record.kind, key: o.record.key, title: o.record.title });
  if (o.step !== undefined) fields.step = String(o.step);
  if (o.code) fields.code = o.code;
  if (o.fields?.length) fields.fields = o.fields.join(', ');
  return {
    kind: 'procedure',
    issue: o.issue && o.issue > 0 ? o.issue : 0,
    target: `procedures:${o.op === 'refused' ? 'save' : o.op}`,
    via: o.surface,
    fields,
    ok: o.op !== 'refused',
    code: null,
    result: RESULT[o.op],
    origin: { actionId: '', kind: 'procedure', key: o.ref ?? '', summary: null },
    by: o.by,
  };
}
