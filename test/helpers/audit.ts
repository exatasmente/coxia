import { AUTONOMY_AUDIT_KINDS, type AuditEntry } from '../../src/shared/auditoria';

const AUTONOMY = new Set<string>(AUTONOMY_AUDIT_KINDS);

/** The lines of the writes themselves, without the ones the autonomy policy adds beside them (a decision, a step it took, a change of the policy). */
export const writesOf = (rows: AuditEntry[]): AuditEntry[] => rows.filter((r) => !AUTONOMY.has(r.kind));

/** The lines the autonomy policy added, of one kind. */
export const autonomyLines = (rows: AuditEntry[], kind: (typeof AUTONOMY_AUDIT_KINDS)[number]): AuditEntry[] => rows.filter((r) => r.kind === kind);
