// The arguments of the persona's tools, validated in the main process before anything is attempted (#248). The Claude path turns every declared property into a loose field, so the
// model's `enum` and `required` are not enforced there; the door enforces them for both engines, and what is wrong comes back as words the model reads and recovers from. Pure.

/** `string`: a short text (an id, a name); `text`: a long one; `json`: any JSON value, at most `JSON_MAX` characters serialised; `card`: the reference of a card of the day. */
export type ArgType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'json' | 'card' | 'enum';

export interface ArgSpec {
  name: string;
  type: ArgType;
  required?: boolean;
  /** The longest a string or text may be. */
  max?: number;
  /** The values an `enum` takes. */
  values?: readonly string[];
  /** What a read or an act is about, for the record of what the persona read. */
  target?: boolean;
  /** A value the person may have typed as a secret: masked by value in everything stored from the answer once it is used. */
  secret?: boolean;
}

export const STRING_MAX = 500;
export const TEXT_MAX = 20_000;
export const JSON_MAX = 20_000;
/** The reason a write carries: one sentence. */
export const WHY_MAX = 300;

const SHORT: Record<string, ArgType> = { s: 'string', t: 'text', n: 'number', i: 'integer', b: 'boolean', j: 'json', c: 'card', e: 'enum' };

/**
 * One argument from its short form: `name:type` with `!` for required, `@` for the target of the call, `*` for a secret value, and for an enum the values in brackets,
 * `decision:e[yes,no]!`. Types: s string, t text, n number, i integer, b boolean, j json, c card, e enum.
 */
export function arg(form: string): ArgSpec {
  const m = /^([a-zA-Z][A-Za-z0-9]*):([stnibjce])(?:\[([^\]]+)\])?([!@*]*)$/.exec(form);
  // i18n-ignore: developer error: a malformed argument in the table
  if (!m) throw new Error(`bad argument form: ${form}`);
  const type = SHORT[m[2]];
  // i18n-ignore: developer error: an enum without its values
  if (type === 'enum' && !m[3]) throw new Error(`enum without values: ${form}`);
  return { name: m[1], type, ...(m[3] ? { values: m[3].split(',') } : {}), ...(m[4].includes('!') ? { required: true } : {}), ...(m[4].includes('@') ? { target: true } : {}), ...(m[4].includes('*') ? { secret: true } : {}) };
}

/** What can be wrong with a call's arguments; the door words it for the model (`arg.<code>`) and the chat words it for the person. */
export type ArgProblem = 'unknown' | 'required' | 'type' | 'long' | 'enum' | 'why';

export type Checked = { ok: true; values: Record<string, unknown> } | { ok: false; problem: { code: ArgProblem; params: Record<string, string | number> } };

const bad = (code: ArgProblem, params: Record<string, string | number>): Checked => ({ ok: false, problem: { code, params } });

/** The size of a JSON value once written; a value that cannot be written (a cycle, a bigint) is too big to take. */
function jsonSize(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The input of a call against the arguments of its operation: every argument present is of its type and within its size, every required one is there, and nothing else is.
 * `op`, and `why` on a write, are the door's and are not arguments. Nothing is coerced: a number the model wrote as a string is wrong, and it is told so.
 */
export function checkArgs(specs: readonly ArgSpec[], input: Record<string, unknown>, write: boolean): Checked {
  const known = new Set(specs.map((s) => s.name));
  for (const key of Object.keys(input)) {
    if (key === 'op' || key === 'why') continue;
    if (!known.has(key)) return bad('unknown', { name: key, args: [...known].join(', ') || '-' });
  }
  const values: Record<string, unknown> = {};
  for (const spec of specs) {
    const v = input[spec.name];
    if (v === undefined || v === null) {
      if (spec.required) return bad('required', { name: spec.name });
      continue;
    }
    switch (spec.type) {
      case 'string':
      case 'card':
      case 'text': {
        if (typeof v !== 'string') return bad('type', { name: spec.name, type: 'text' });
        const max = spec.max ?? (spec.type === 'text' ? TEXT_MAX : STRING_MAX);
        if (v.length > max) return bad('long', { name: spec.name, max });
        if (spec.required && !v.trim()) return bad('required', { name: spec.name });
        break;
      }
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) return bad('type', { name: spec.name, type: 'number' });
        break;
      case 'integer':
        if (typeof v !== 'number' || !Number.isInteger(v)) return bad('type', { name: spec.name, type: 'integer' });
        break;
      case 'boolean':
        if (typeof v !== 'boolean') return bad('type', { name: spec.name, type: 'boolean' });
        break;
      case 'enum':
        if (typeof v !== 'string' || !spec.values?.includes(v)) return bad('enum', { name: spec.name, values: (spec.values ?? []).join(', ') });
        break;
      case 'json':
        if (jsonSize(v) > JSON_MAX) return bad('long', { name: spec.name, max: JSON_MAX });
        break;
    }
    values[spec.name] = v;
  }
  if (write) {
    const why = input.why;
    if (typeof why !== 'string' || !why.trim() || why.length > WHY_MAX) return bad('why', { max: WHY_MAX });
  }
  return { ok: true, values };
}
