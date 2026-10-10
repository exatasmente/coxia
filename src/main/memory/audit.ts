import type { AuditEntry } from '../../shared/auditoria';
import type { MemorySurface } from '../../shared/memory';
import { redact } from '../errorlog-core';

// What the memory writes to `auditoria.jsonl`: the person's edit, removal and review of a note and of a folder, from the window or from a paired browser, and the correction of
// an activity or of the cycle memory (those two have their own stores and are audited here for the origin of the move). Each entry is built from a fixed set of fields, so what
// the log never holds has no field to arrive in: no text, and for a refusal no title either (the text that was refused is the one thing that may be a secret).

export type MemoryOp = 'edit' | 'remove' | 'review' | 'remove-folder' | 'refused' | 'activity-correct' | 'cycle-memory-edit' | 'save' | 'replace';

export interface MemoryAuditInput {
  op: MemoryOp;
  /** Which door the call came through: the desktop window or a paired browser (`callOrigin()`); for an agent's write, the place the call ran in. */
  via: 'window' | 'paired' | MemorySurface;
  /** The agent that wrote or removed, when it was an agent and not the person. */
  by?: string;
  /** The run's issue number, for an agent's write in a stage; absent otherwise. */
  issue?: number;
  conversation?: string;
  agent?: string;
  /** The note written or marked; absent for a refusal and for a folder. */
  note?: { id: string; kind: string | null; title: string; revision: number };
  /** The activity reference or the run id of the other two stores. */
  ref?: string;
  /** A refusal: its code and the fields it named (never their values). */
  code?: string;
  fields?: readonly string[];
  /** How many notes a folder removal took with it. */
  removed?: number;
}

const RESULT: Record<MemoryOp, string> = {
  edit: 'edited',
  remove: 'removed',
  review: 'marked reviewed',
  'remove-folder': 'removed the folder',
  refused: 'refused',
  'activity-correct': 'corrected the activity',
  'cycle-memory-edit': 'edited the cycle memory',
  save: 'saved',
  replace: 'replaced',
};

export function memoryAuditEntry(o: MemoryAuditInput): Omit<AuditEntry, 'at'> {
  const fields: Record<string, string> = { surface: o.via };
  if (o.conversation) fields.conversation = o.conversation;
  if (o.agent ?? o.by) fields.agent = (o.agent ?? o.by) as string;
  if (o.note) Object.assign(fields, { id: o.note.id, kind: o.note.kind ?? '', title: redact(o.note.title), revision: String(o.note.revision) });
  if (o.ref) fields.ref = o.ref;
  if (o.code) fields.code = o.code;
  if (o.removed !== undefined) fields.removed = String(o.removed);
  if (o.fields?.length) fields.fields = [...new Set(o.fields)].join(', ');
  return {
    kind: 'memory',
    issue: o.issue && o.issue > 0 ? o.issue : 0,
    target: `memory:${o.op === 'refused' ? 'save' : o.op}`,
    via: o.via,
    fields,
    ok: o.op !== 'refused',
    code: null,
    result: RESULT[o.op],
    origin: { actionId: '', kind: 'memory', key: o.conversation ?? o.ref ?? '', summary: null },
    by: o.by ?? 'person',
  };
}
