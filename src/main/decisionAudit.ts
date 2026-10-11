import type { AuditEntry, Through } from '../shared/auditoria';
import type { SecretSourceType } from '../shared/secrets';

// The audit lines of two decisions a person (or the persona) makes in the app and that wrote no line before: what happens to a secret and what is decided about a plugin. Built
// from a fixed set of fields, so what the log must never hold has no field to arrive in: no value, no command or its arguments, no variable's name, no path, no request text.

export type SecretOp = 'set' | 'remove' | 'accept-insecure' | 'read';

/** A secret's name is a reference of a known shape; anything else is not written. */
const REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SOURCES: readonly string[] = ['stored', 'command', 'env'];

/** A secret that runs a command, set by the persona: the app will run what it names whenever the secret is resolved, so the line is marked as a raise, like a change of reach. */
export const SECRET_RAISED = 'secret command';

export function secretAuditEntry(o: { op: SecretOp; ref?: unknown; source?: unknown; ok: boolean; via: Through }): Omit<AuditEntry, 'at'> {
  const ref = typeof o.ref === 'string' && REF.test(o.ref) ? o.ref : '';
  const source = typeof o.source === 'string' && SOURCES.includes(o.source) ? (o.source as SecretSourceType) : '';
  return {
    kind: 'secret',
    issue: 0,
    target: `secret:${o.op}`,
    via: o.via,
    fields: { op: o.op, ...(ref ? { ref } : {}), ...(source ? { source } : {}), ...(o.op === 'set' && source === 'command' && o.via === 'persona' ? { raised: SECRET_RAISED } : {}) },
    ok: o.ok,
    code: null,
    result: o.ok ? o.op : 'refused',
    origin: { actionId: '', kind: 'secret', key: ref || o.op, summary: null },
    by: null,
  };
}

export type PluginDecisionOp = 'answer' | 'revoke' | 'revoke-write' | 'set-enabled' | 'settings' | 'set-setting' | 'set-secret';

const WORD = /^[A-Za-z0-9][\w.-]{0,63}$/;
const word = (v: unknown): string => (typeof v === 'string' && WORD.test(v) ? v : '');

/** The plugin, the need and the choice; a setting is named by its key and never by its value. */
export function pluginDecisionEntry(o: { op: PluginDecisionOp; plugin?: unknown; need?: unknown; choice?: unknown; key?: unknown; issue?: number; actionId?: string; ok: boolean; via: Through }): Omit<AuditEntry, 'at'> {
  const plugin = word(o.plugin);
  const need = word(o.need);
  const choice = word(o.choice);
  const key = word(o.key);
  return {
    kind: 'plugin-decision',
    issue: o.issue ?? 0,
    target: `plugin:${o.op}`,
    via: o.via,
    fields: { op: o.op, ...(plugin ? { plugin } : {}), ...(need ? { need } : {}), ...(choice ? { choice } : {}), ...(key ? { key } : {}) },
    ok: o.ok,
    code: null,
    result: o.ok ? (choice || o.op) : 'refused',
    origin: { actionId: o.actionId ?? '', kind: 'plugin-decision', key: plugin || o.op, summary: null },
    by: null,
  };
}
