import type { AuditEntry } from '../../shared/auditoria';

// The decisions of the Audit screen above the markup, as plain functions: who an entry belongs to, the filters, where an act's entry sits in the list, and the lines of the
// folded "what it had read". An entry written before the persona has no `actor`, and reads as a person's.

export const WHO_FILTERS = ['all', 'person', 'persona', 'agent'] as const;
export type WhoFilter = (typeof WHO_FILTERS)[number];

export const isWhoFilter = (v: unknown): v is WhoFilter => typeof v === 'string' && (WHO_FILTERS as readonly string[]).includes(v);

/**
 * Who a line belongs to: the persona (it says so), an agent acting by its own autonomy (`by` is set and nobody stamped the line), or the person. A line written before the
 * persona has neither field, and reads as the person's; an autonomous agent's write is not the person's.
 */
export const whoOf = (e: Pick<AuditEntry, 'actor' | 'by'>): 'person' | 'persona' | 'agent' => (e.actor === 'persona' || e.by === 'persona' ? 'persona' : e.by && e.by !== 'person' ? 'agent' : 'person');

/** The entries the filters let through: those of an issue (digits anywhere in its number) and those of the person, of the persona or of an agent's autonomy. */
export function filterEntries(rows: readonly AuditEntry[], o: { issue: string; who: WhoFilter }): AuditEntry[] {
  const n = o.issue.replace(/\D/g, '');
  return rows.filter((r) => (!n || String(r.issue).includes(n)) && (o.who === 'all' || whoOf(r) === o.who));
}

/**
 * Where the entry an act's link points at is: the first one in the list with that id, or -1. The list holds the newest 2,000 only, so an act older than that is not found, and
 * the screen says so instead of staying silent.
 */
export const indexOfAct = (rows: readonly AuditEntry[], id: string | undefined): number => (id ? rows.findIndex((r) => r.id === id) : -1);

/** The persona approved an action it had proposed itself. */
export const approvedOwn = (e: Pick<AuditEntry, 'actor' | 'proposedBy'>): boolean => e.actor === 'persona' && e.proposedBy === 'persona';

/** How a door reads on the screen: the known ones by a catalog key, any other value (a later door) as it is. */
export function doorWords(door: string | undefined): { key: string } | { raw: string } | null {
  if (!door) return null;
  if (door === 'window') return { key: 'ui.audit.door.window' };
  if (door === 'paired') return { key: 'ui.audit.door.paired' };
  if (door === 'terminal') return { key: 'ui.audit.door.terminal' };
  return { raw: door };
}

/** The folded part of an entry: what it decided on and each thing it had read, as lines of text with no markup. Null when there is no basis. */
export function basisLines(e: Pick<AuditEntry, 'basis'>): { subject: string; reads: string[]; message: number | null } | null {
  const b = e.basis;
  if (!b) return null;
  return { subject: b.subject, reads: b.reads.map((r) => `${r.tool}.${r.op} ${r.target}${r.excerpt ? `: ${r.excerpt}` : ''}`), message: b.message };
}

/**
 * How the fold of an entry reads, or null when there is nothing to unfold: "what it had read" only when it read something, "what it decided on" when only the subject exists, and
 * no fold at all when neither does (a message number alone is not worth a click).
 */
export function basisSummary(b: { subject: string; reads: readonly unknown[] } | null): 'ui.audit.basis' | 'ui.audit.basis.decided' | null {
  if (!b) return null;
  if (b.reads.length > 0) return 'ui.audit.basis';
  return b.subject ? 'ui.audit.basis.decided' : null;
}
