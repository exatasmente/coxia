import { homedir } from 'node:os';
import { STAGE_KINDS } from '../../shared/config/types';
import {
  LIMITS,
  PROCEDURE_KINDS,
  PROCEDURE_STATES,
  PROCEDURE_SURFACES,
  PROCEDURE_VERSION,
  STEPS_FROM,
  contentSize,
  isProcedureId,
  type ProcedureContent,
  type ProcedureKind,
  type ProcedureRecord,
  type ProcedureStep,
} from '../../shared/procedures';
import { redact } from '../errorlog-core';

// The validator of a procedure record: pure, no Electron, no disk. A field is refused, never silently cut or masked; the refusal names the field and the class of
// the problem and never echoes the value, so a rejected secret does not reach a log or a thread. `redact` is the net under the named classes: what it would still
// change is refused too.

export type RefusalCode =
  | 'type'
  | 'empty'
  | 'too-long'
  | 'too-many'
  | 'control'
  | 'charset'
  | 'unknown-field'
  | 'key-form'
  | 'key-repo'
  | 'key-stage'
  | 'email'
  | 'home'
  | 'credential'
  | 'url-query'
  | 'digits'
  | 'token'
  | 'quote'
  | 'size';

export interface Refusal {
  /** The path of the field: `title`, `steps[2].text`, `pitfalls[0]`. */
  field: string;
  code: RefusalCode;
  /** What to fix, in English, without the value. */
  text: string;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; refusals: Refusal[] };

export interface CheckContext {
  /** The ids of the workspace's repositories: the only keys a `repo` record may have. */
  repos: readonly string[];
  /** The person's home folder; the default is the machine's. */
  home?: string;
}

const REASON: Record<RefusalCode, string> = {
  type: 'has the wrong type',
  empty: 'is empty',
  'too-long': 'is too long',
  'too-many': 'has too many items',
  control: 'holds a line break or a control character; one line only',
  charset: "may hold only letters, digits, spaces and . , - / ( ) '",
  'unknown-field': 'is not a field of a step',
  'key-form': 'is not in the form of its kind',
  'key-repo': 'is not a repository of this workspace',
  'key-stage': 'is not a stage kind of the flow',
  email: 'holds an email address; write <your login> or <value> instead',
  home: "holds the person's home folder; write a path from the repository or from ~",
  credential: 'holds what looks like a credential; write <value> where a value goes',
  'url-query': 'holds a URL with a query string or a fragment; keep the path only',
  digits: 'holds a run of 6 or more digits (an account number, a code, a phone); write <value> where it goes',
  token: 'holds a 20+ character string with no space that mixes letters and digits (a token, a key, an id); write <value> or :id',
  quote: `quotes more than ${LIMITS.quote} characters; name a control by its role and visible label, never by page content`,
  size: `is more than ${LIMITS.content} characters in all`,
};

// C0, C1, the line separators, every format character (zero width, bidi overrides, joiners) and the tag block: all of them can hide text from the person who reviews it.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\u{E0000}-\u{E007F}]/u;
const TITLE_CHARS = /^[\p{L}\p{N} .,\-/()']+$/u;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const DIGIT_RUN = /\d(?:[\s.-]?\d){5,}/;
const URL_QUERY = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b)\S*[?#]\S/i;
const GUI_KEY = /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]*$/u;
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

// A pinned version (`pkg@1.2.3`, `@scope/pkg@1.2.3-beta.1`) is email-shaped and an ISO date or instant is a digit run; both are ordinary in a command or a pitfall, so the
// checks of those two classes (and the net under them) read the text with them taken out. The shared `redact` is not changed for other callers.
const PINNED = /([\w.-])@v?\d+(?:\.\d+){1,2}(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?(?![\w@-]|\.\w)/g;
const ISO_DATE = /(?<![\d.-])\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g;
const withoutPinsAndDates = (s: string): string => s.replace(PINNED, '$1').replace(ISO_DATE, 'DATE');

// A secret given as the value of a flag. `--pass-through` and `--port 5432` are not: the name must be followed by a separator and a value, and a placeholder is the value
// to write.
const SECRET_FLAG = /(?<![\w-])--?(?:password|passwd|pwd|pass|token|secret|api[-_]?key|access[-_]?key|auth\w*)(?:[-_](?:token|key|secret|pass(?:word)?))?[ =:]+(\S[^]*)/gi;
const PLACEHOLDER = /^["']?(?:<[^<>]*>|\$\{\w+\}|\$\w+)(?=["']?(?:\s|$))/;
const PORT_LIKE = /^\d+(?::\d+)*(?:-\d+)?(?:\/\w+)?$/;
// Clients whose `-p` is the password, not the port (psql and redis-cli take the port there and are not listed).
const PASSWORD_CLIENTS = new Set(['mysql', 'mysqldump', 'mysqladmin', 'mysqlsh', 'mysqlimport', 'mysqlcheck', 'mariadb', 'mariadb-dump', 'mongo', 'mongosh', 'mongodump', 'mongorestore', 'sqlcmd', 'sshpass']);
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command']);

const placeholder = (value: string): boolean => PLACEHOLDER.test(value);

function hasPasswordFlag(s: string): boolean {
  for (const m of s.matchAll(SECRET_FLAG)) if (!placeholder(m[1])) return true;
  for (const seg of s.split(/\s*(?:&&|\|\||[|;&])\s*/)) {
    const tokens = seg.trim().split(/\s+/);
    let i = 0;
    while (i < tokens.length && (WRAPPERS.has(tokens[i]) || /^\w+=/.test(tokens[i]))) i++;
    const cmd = (tokens[i] ?? '').split('/').pop()!.replace(/\.exe$/i, '').toLowerCase();
    const strict = PASSWORD_CLIENTS.has(cmd) || tokens.slice(i + 1).includes('login');
    for (let j = i + 1; j < tokens.length; j++) {
      const glued = /^-p(.+)$/.exec(tokens[j]);
      if (glued && !glued[1].startsWith('-')) {
        const v = glued[1];
        // `-pv`, `-pr`: a cluster of short flags (mkdir -pv); a port mapping (-p8080:80). Neither is a password, except after a client that takes it there.
        if (placeholder(v) || (!strict && (PORT_LIKE.test(v) || /^[A-Za-z]{1,4}$/.test(v)))) continue;
        return true;
      }
      if (tokens[j] === '-p' && strict && j + 1 < tokens.length && !tokens[j + 1].startsWith('-') && !placeholder(tokens.slice(j + 1).join(' '))) return true;
    }
  }
  return false;
}

const hasOpaqueToken = (text: string): boolean => text.split(/\s+/).some((w) => w.length >= 20 && /\d/.test(w) && /\p{L}/u.test(w));

// Pairs of quotation marks. A single quote counts as one only when it is not inside a word, so "don't" and "user's" do not pair up.
const QUOTES: RegExp[] = [/"([^"\n]*)"/g, /\u201c([^\u201d\n]*)\u201d/g, /\u2018([^\u2019\n]*)\u2019/g, /\u00ab([^\u00bb\n]*)\u00bb/g, /(?<![\p{L}\p{N}])'([^'\n]*)'(?![\p{L}\p{N}])/gu];

const quotesTooMuch = (text: string): boolean => QUOTES.some((re) => [...text.matchAll(re)].some((m) => m[1].length > LIMITS.quote));

interface Out {
  refusals: Refusal[];
}

const refuse = (out: Out, field: string, code: RefusalCode, text?: string): void => {
  if (out.refusals.some((r) => r.field === field && r.code === code)) return;
  out.refusals.push({ field, code, text: `${field} ${text ?? REASON[code]}` });
};

interface TextRule {
  max: number;
  /** The title's character set. */
  title?: boolean;
  /** Check the 20-character token and the digit run; false for a key whose form already bounds it (a host, a repository id, a stage kind). */
  free?: boolean;
  /** A `gui` record: a long quotation is page content. */
  gui?: boolean;
}

/** One text field: its type, size, characters and the classes of secret. Returns the trimmed text, or null when it was refused. */
function text(out: Out, field: string, value: unknown, rule: TextRule, home: string): string | null {
  if (typeof value !== 'string') {
    refuse(out, field, 'type', 'must be a string');
    return null;
  }
  const s = value.trim();
  if (!s) {
    refuse(out, field, 'empty');
    return null;
  }
  let ok = true;
  if (s.length > rule.max) {
    refuse(out, field, 'too-long', `is ${s.length} characters; the most is ${rule.max}`);
    ok = false;
  }
  if (CONTROL.test(s)) {
    refuse(out, field, 'control');
    ok = false;
  }
  if (rule.title && !TITLE_CHARS.test(s)) {
    refuse(out, field, 'charset');
    ok = false;
  }
  const before = out.refusals.length;
  const plain = withoutPinsAndDates(s);
  if (EMAIL.test(plain)) refuse(out, field, 'email');
  if (home && home !== '/' && s.includes(home)) refuse(out, field, 'home');
  if (URL_QUERY.test(s)) refuse(out, field, 'url-query');
  if (rule.free !== false && DIGIT_RUN.test(plain)) refuse(out, field, 'digits');
  if (rule.free !== false && hasOpaqueToken(plain)) refuse(out, field, 'token');
  if (hasPasswordFlag(s)) refuse(out, field, 'credential');
  if (rule.gui && quotesTooMuch(s)) refuse(out, field, 'quote');
  // What `redact` would change and no class above named: a credential-shaped string, an assignment to a secret-looking name.
  // A placeholder after `=` or `:` is what the refusals ask for, so the net reads the text without it.
  const net = plain.replace(/[=:](?:<[^<>]*>|\$\{\w+\}|\$\w+)(?=["']?(?:\s|$))/g, ' ');
  if (out.refusals.length === before && redact(net, home) !== net) refuse(out, field, 'credential');
  return ok && out.refusals.length === before ? s : null;
}

function key(out: Out, kind: ProcedureKind, value: unknown, ctx: CheckContext, home: string): string | null {
  const bounded = kind === 'gui' || kind === 'repo' || kind === 'cycle';
  const k = text(out, 'key', value, { max: LIMITS.key, free: !bounded }, home);
  if (k === null) return null;
  const before = out.refusals.length;
  if (kind === 'gui') {
    if (!GUI_KEY.test(k)) refuse(out, 'key', 'key-form', 'must be a host such as docs.example.com (no scheme, path, port or query) or the name of a desktop application');
  } else if (kind === 'repo') {
    if (!ctx.repos.includes(k)) refuse(out, 'key', 'key-repo', `is not a repository of this workspace (${ctx.repos.length ? ctx.repos.join(', ') : 'none is configured'})`);
  } else if (kind === 'cycle') {
    const [stage, repo, ...rest] = k.split('@');
    if (rest.length || !(STAGE_KINDS as readonly string[]).includes(stage)) refuse(out, 'key', 'key-stage', `must be a stage kind (${STAGE_KINDS.join(', ')}), optionally followed by @ and a repository id`);
    else if (repo !== undefined && !ctx.repos.includes(repo)) refuse(out, 'key', 'key-repo', 'names a repository that is not in this workspace');
  } else if (!SLUG.test(k)) {
    refuse(out, 'key', 'key-form', 'must be a lowercase slug: letters, digits, . _ -');
  }
  return out.refusals.length === before ? k : null;
}

function steps(out: Out, value: unknown, gui: boolean, home: string): ProcedureStep[] | null {
  if (!Array.isArray(value)) {
    refuse(out, 'steps', 'type', 'must be a list of steps');
    return null;
  }
  if (value.length === 0) {
    refuse(out, 'steps', 'empty');
    return null;
  }
  if (value.length > LIMITS.steps) {
    refuse(out, 'steps', 'too-many', `has ${value.length} steps; the most is ${LIMITS.steps}`);
    return null;
  }
  const before = out.refusals.length;
  const done: ProcedureStep[] = [];
  value.forEach((raw, i) => {
    const at = `steps[${i}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      refuse(out, at, 'type', 'must be an object with text and, optionally, run');
      return;
    }
    const o = raw as Record<string, unknown>;
    // The key is the agent's own text: the refusal and the audit name the place, never the name it chose.
    if (Object.keys(o).some((name) => name !== 'text' && name !== 'run' && name !== 'edited')) refuse(out, `${at}.<unknown>`, 'unknown-field');
    const t = text(out, `${at}.text`, o.text, { max: LIMITS.stepText, gui }, home);
    const r = o.run === undefined ? undefined : text(out, `${at}.run`, o.run, { max: LIMITS.stepRun, gui }, home);
    if (t !== null && (o.run === undefined || r !== null)) done.push({ text: t, ...(r !== undefined && r !== null ? { run: r } : {}), ...(o.edited === true ? { edited: true as const } : {}) });
  });
  return out.refusals.length === before ? done : null;
}

function list(out: Out, field: string, value: unknown, max: number, each: number, gui: boolean, home: string): string[] | null {
  if (!Array.isArray(value)) {
    refuse(out, field, 'type', 'must be a list of strings');
    return null;
  }
  if (value.length > max) {
    refuse(out, field, 'too-many', `has ${value.length} items; the most is ${max}`);
    return null;
  }
  const before = out.refusals.length;
  const done = value.map((v, i) => text(out, `${field}[${i}]`, v, { max: each, gui }, home));
  return out.refusals.length === before ? (done as string[]) : null;
}

/** Checks the content of a record (the agent's or the person's) in one pass and returns every refusal at once. */
export function checkContent(input: unknown, ctx: CheckContext): Checked<ProcedureContent> {
  const out: Out = { refusals: [] };
  const home = ctx.home ?? homedir();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, refusals: [{ field: 'record', code: 'type', text: 'record must be an object' }] };
  const o = input as Record<string, unknown>;
  const kind = (PROCEDURE_KINDS as readonly unknown[]).includes(o.kind) ? (o.kind as ProcedureKind) : null;
  if (!kind) refuse(out, 'kind', 'type', `must be one of ${PROCEDURE_KINDS.join(', ')}`);
  const gui = kind === 'gui';
  const k = kind ? key(out, kind, o.key, ctx, home) : null;
  const title = text(out, 'title', o.title, { max: LIMITS.title, title: true }, home);
  const s = steps(out, o.steps, gui, home);
  const pitfalls = list(out, 'pitfalls', o.pitfalls ?? [], LIMITS.pitfalls, LIMITS.pitfall, gui, home);
  const waits = list(out, 'waits', o.waits ?? [], LIMITS.waits, LIMITS.wait, gui, home);
  if (out.refusals.length || !kind || k === null || title === null || !s || !pitfalls || !waits) return { ok: false, refusals: out.refusals };
  const value: ProcedureContent = { kind, key: k, title, steps: s, pitfalls, waits };
  if (contentSize(value) > LIMITS.content) return { ok: false, refusals: [{ field: 'record', code: 'size', text: `record ${REASON.size}; shorten the steps or split the procedure` }] };
  return { ok: true, value };
}

/** The refusals as one text for the agent or the person: one line each, naming the field. */
export const describeRefusals = (refusals: readonly Refusal[]): string => refusals.map((r) => `- ${r.text}`).join('\n');

export type Parsed = { status: 'ok'; record: ProcedureRecord } | { status: 'newer'; v: number } | { status: 'invalid' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isStepList = (v: unknown): v is ProcedureStep[] => Array.isArray(v) && v.every((s) => isObj(s) && isStr(s.text) && (s.run === undefined || isStr(s.run)));
const isIso = (v: unknown): boolean => isStr(v) && Number.isFinite(Date.parse(v));

/**
 * A stored file as a record. A record a newer app wrote (`v` above ours) is `newer`: it is not read and the store never overwrites it. A file that is not shaped like
 * a record is `invalid`. The caps are not re-checked: they were checked at the write, and a person's hand edit of the file is not the app's to repair.
 */
export function parseRecord(raw: unknown): Parsed {
  if (!isObj(raw)) return { status: 'invalid' };
  if (typeof raw.v === 'number' && raw.v > PROCEDURE_VERSION) return { status: 'newer', v: raw.v };
  const stats = raw.stats;
  const origin = raw.origin;
  const previous = raw.previous;
  const valid =
    raw.v === PROCEDURE_VERSION &&
    isProcedureId(raw.id) &&
    Number.isInteger(raw.revision) &&
    (raw.revision as number) >= 1 &&
    (PROCEDURE_KINDS as readonly unknown[]).includes(raw.kind) &&
    isStr(raw.key) &&
    isStr(raw.title) &&
    isStepList(raw.steps) &&
    isStrList(raw.pitfalls) &&
    isStrList(raw.waits) &&
    (PROCEDURE_STATES as readonly unknown[]).includes(raw.state) &&
    (raw.lastVerified === null || isIso(raw.lastVerified)) &&
    (raw.lastFailed === null || (isObj(raw.lastFailed) && isIso(raw.lastFailed.at) && Number.isInteger(raw.lastFailed.step))) &&
    isObj(stats) &&
    Number.isInteger(stats.uses) &&
    Number.isInteger(stats.failures) &&
    Number.isInteger(stats.failuresSinceSave) &&
    (stats.lastUsed === null || isIso(stats.lastUsed)) &&
    (stats.baseline === null || isObj(stats.baseline)) &&
    Array.isArray(stats.recent) &&
    isObj(origin) &&
    isStr(origin.by) &&
    isStr(origin.createdBy) &&
    (PROCEDURE_SURFACES as readonly unknown[]).includes(origin.surface) &&
    isIso(origin.at) &&
    (STEPS_FROM as readonly unknown[]).includes(raw.stepsFrom) &&
    typeof raw.reviewed === 'boolean' &&
    (previous === null || (isObj(previous) && isStr(previous.title) && isStepList(previous.steps) && isStrList(previous.pitfalls) && isStrList(previous.waits)));
  return valid ? { status: 'ok', record: raw as unknown as ProcedureRecord } : { status: 'invalid' };
}
