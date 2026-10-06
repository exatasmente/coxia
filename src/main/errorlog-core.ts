import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorHint, type ErrorEntry, type ErrorGroup } from '../shared/errorlog';
import { t } from '../shared/i18n';

export const MAX_BYTES = 2 * 1024 * 1024;
export const KEEP_FILES = 3;
const MAX_MESSAGE = 300;
const MAX_STACK_LINES = 10;
const MAX_STACK = 1800;
const DAY_MS = 24 * 3600_000;

// `name: value` where the name looks like a secret's (`apiKey: string;` in a type, `token = next()` in code): right in a message, wrong in a quoted piece of code.
const ASSIGNMENT = /(["']?\b[\w-]*(?:token|secret|passw(?:or)?d|api[_-]?key|apikey|access[_-]?key|credential|cookie)\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',;&}]+)/gi;

// The same, only when the value is a quoted literal that is not empty (`password = "hunter2"`, `"apiKey": "…"`): what a person typed, as against an identifier or a type.
const QUOTED_ASSIGNMENT = /(["']?\b[\w-]*(?:token|secret|passw(?:or)?d|api[_-]?key|apikey|access[_-]?key|credential|cookie)\b["']?\s*[:=]\s*)("[^"\n]+"|'[^'\n]+')/gi;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// Ordered: specific shapes first, the generic opaque-string rule last.
const SECRETS: [RegExp, string][] = [
  [/\b(Authorization|Proxy-Authorization|PRIVATE-TOKEN|Job-Token|X-Api-Key|X-Auth-Token|Set-Cookie|Cookie)\s*[:=]\s*[^\n]+/gi, '$1: [redacted]'],
  [/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 [redacted]'],
  [/\bcer_session=[^\s;,"']+/g, 'cer_session=[redacted]'],
  [/\b(glpat|sk-or-v1|sk-or|sk-ant|sk|ghp|gho|github_pat|xox[abprs]|AKIA|AIza)[-_][\w-]{8,}/g, '[key]'],
  [/\bAKIA[0-9A-Z]{12,}\b/g, '[key]'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[jwt]'],
  [ASSIGNMENT, '$1[redacted]'],
  [/(\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[redacted]@'],
  [/(https?:\/\/[^\s?#"')]+)\?[^\s"')]+/g, '$1?[redacted]'],
  [EMAIL, '[email]'],
  [/\b(?=[A-Za-z0-9_+=-]*\d)(?=[A-Za-z0-9_+=-]*[A-Za-z])[A-Za-z0-9_+=-]{32,}\b/g, '[redacted]'],
];

export function redact(text: string, home = homedir()): string {
  return scrub(text, home, { assignments: 'all', email: 'all' });
}

interface Scrub {
  /** `quoted`: only an assignment whose value is a quoted literal (code, where `apiKey: string;` is what the code says). */
  assignments: 'all' | 'quoted';
  /** `doc`: a version pinned with `@` (`pnpm@9.0.0`, `uses: x@v4.1.1`) and an ssh remote (`git@host:org/repo.git`) are not an address. */
  email: 'all' | 'doc';
}

function scrub(text: string, home: string, o: Scrub): string {
  let out = text;
  if (home && home !== '/') out = out.split(home).join('~');
  for (const [pattern, replacement] of SECRETS) {
    if (pattern === ASSIGNMENT && o.assignments === 'quoted') out = out.replace(QUOTED_ASSIGNMENT, replacement);
    else if (pattern === EMAIL && o.email === 'doc') out = out.replace(EMAIL, (m: string, at: number, whole: string) => (/^@v?\d/.test(m.slice(m.indexOf('@'))) || /^:[\w~./-]/.test(whole.slice(at + m.length)) ? m : replacement));
    else out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * `redact` for the prose of the documentation of a repository: the same, except that what only looks like an address is left alone (a pinned version such as
 * `pnpm@9.0.0`, an ssh remote such as `git@example.com:org/repo.git`). A real address in prose is still masked.
 */
export function redactDoc(text: string, home = homedir()): string {
  return scrub(text, home, { assignments: 'all', email: 'doc' });
}

/**
 * `redact` for text that is quoted code (a fenced block, a code span of a document): the same masking of what is a credential by its shape (a key with a known prefix, a
 * token, a header, an address with a password, an email, a long opaque string) and of the home folder, and of an assignment of a quoted literal to a name that looks like a
 * secret's (`password = "hunter2"`); not of an identifier or a type (`apiKey: string;`, `token = next()`), which in code is what the code says. Pinned versions and ssh remotes
 * are left alone as in `redactDoc`.
 */
export function redactCode(text: string, home = homedir()): string {
  return scrub(text, home, { assignments: 'quoted', email: 'doc' });
}

export function trimStack(stack: string, home?: string): string {
  const lines = stack.split('\n').map((l) => l.trim()).filter(Boolean);
  // V8 stacks start with the message: keep the frames. Anything else (a Python traceback tail, a component stack) is kept whole.
  const frames = lines.filter((l) => /^at\s/.test(l));
  return redact((frames.length ? frames : lines).slice(0, MAX_STACK_LINES).join('\n'), home).slice(0, MAX_STACK);
}

// Only these keys survive, and only as short plain values: arguments, bodies and payloads never get in.
const CONTEXT_KEYS = new Set(['channel', 'via', 'job', 'module', 'ref', 'iid', 'mr', 'id', 'status', 'exitCode', 'signal', 'cmd', 'phase', 'platform', 'kind']);
const SAFE_VALUE = /^[\w#!@.:/+-]{1,80}$/;

export function safeContext(context: Record<string, unknown> | undefined, home?: string): ErrorEntry['context'] {
  const out: ErrorEntry['context'] = {};
  for (const [key, value] of Object.entries(context ?? {})) {
    if (!CONTEXT_KEYS.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string' && SAFE_VALUE.test(value)) out[key] = redact(value, home);
  }
  return out;
}

function parts(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack ?? '' };
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    return { name: typeof e.name === 'string' ? e.name : 'Error', message: typeof e.message === 'string' ? e.message : String(error), stack: typeof e.stack === 'string' ? e.stack : '' };
  }
  return { name: 'Error', message: String(error), stack: '' };
}

export function buildEntry(source: string, error: unknown, context: Record<string, unknown> | undefined, workspace: string, now = new Date(), home?: string): ErrorEntry {
  const p = parts(error);
  const message = redact(p.message.slice(0, 2000).split('\n').map((l) => l.trim()).filter(Boolean).join(' · '), home).slice(0, MAX_MESSAGE) || t('main.errorlog.noMessage');
  return {
    time: now.toISOString(),
    workspace,
    source: redact(source, home).slice(0, 80),
    name: p.name.replace(/[^\w.]/g, '').slice(0, 40) || 'Error',
    message,
    stack: trimStack(p.stack.slice(0, 8000), home),
    context: safeContext(context, home),
  };
}

const fileAt = (dir: string, n: number): string => join(dir, n === 0 ? 'errors.jsonl' : `errors.${n}.jsonl`);

export const logFile = (dir: string): string => fileAt(dir, 0);

// errors.jsonl is current; errors.1 and errors.2 are the older ones.
function rotate(dir: string): void {
  rmSync(fileAt(dir, KEEP_FILES - 1), { force: true });
  for (let n = KEEP_FILES - 2; n >= 0; n--) if (existsSync(fileAt(dir, n))) renameSync(fileAt(dir, n), fileAt(dir, n + 1));
}

export function appendEntry(dir: string, entry: ErrorEntry, maxBytes = MAX_BYTES): void {
  mkdirSync(dir, { recursive: true });
  const line = `${JSON.stringify(entry)}\n`;
  const file = fileAt(dir, 0);
  if (existsSync(file) && statSync(file).size + line.length > maxBytes) rotate(dir);
  appendFileSync(file, line);
}

function parse(line: string): ErrorEntry | null {
  try {
    const e = JSON.parse(line) as Partial<ErrorEntry>;
    return typeof e.time === 'string' && typeof e.message === 'string' ? ({ workspace: '', source: '', name: 'Error', stack: '', context: {}, ...e } as ErrorEntry) : null;
  } catch {
    return null;
  }
}

// Oldest first, up to the last `limit` entries across the three files.
export function readEntries(dir: string, limit = 500): ErrorEntry[] {
  const out: ErrorEntry[] = [];
  for (let n = 0; n < KEEP_FILES && out.length < limit; n++) {
    const file = fileAt(dir, n);
    if (!existsSync(file)) continue;
    const entries = readFileSync(file, 'utf8').split('\n').map(parse).filter((e): e is ErrorEntry => e !== null);
    out.unshift(...entries);
  }
  return out.slice(-limit);
}

export function clearLog(dir: string): void {
  for (let n = 0; n < KEEP_FILES; n++) rmSync(fileAt(dir, n), { force: true });
}

// Newest group first. `seenAt` is the last time Saúde was opened (ms); only the last 24 h count as unseen.
export function groupEntries(entries: ErrorEntry[], seenAt: number, now = Date.now(), maxGroups = 50): { groups: ErrorGroup[]; unseen: number } {
  const byMessage = new Map<string, ErrorGroup>();
  for (const e of entries) {
    const at = new Date(e.time).getTime();
    const fresh = at > seenAt && now - at <= DAY_MS;
    const g = byMessage.get(e.message);
    if (!g) {
      byMessage.set(e.message, { message: e.message, count: 1, firstAt: e.time, lastAt: e.time, sources: [e.source], workspaces: [e.workspace], stack: e.stack, context: e.context, hint: null, unseen: fresh });
      continue;
    }
    g.count += 1;
    if (e.time < g.firstAt) g.firstAt = e.time;
    if (e.time >= g.lastAt) {
      g.lastAt = e.time;
      g.stack = e.stack || g.stack;
      g.context = e.context;
    }
    if (!g.sources.includes(e.source)) g.sources.push(e.source);
    if (!g.workspaces.includes(e.workspace)) g.workspaces.push(e.workspace);
    g.unseen ||= fresh;
  }
  const all = [...byMessage.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  for (const g of all) g.hint = errorHint(g.message, g.sources[g.sources.length - 1], g.stack);
  return { groups: all.slice(0, maxGroups), unseen: all.filter((g) => g.unseen).length };
}

// Sliding window: at most `max` entries per `windowMs`, so a loop cannot fill the disk or the screen.
export function createLimiter(max: number, windowMs: number, clock: () => number = Date.now): () => boolean {
  let start = 0;
  let count = 0;
  return () => {
    const t = clock();
    if (t - start >= windowMs) {
      start = t;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}

// Channels whose first string argument is an activity or action id. Any other argument may carry what the person typed or said.
const ID_FIRST = /^(conflict|gate|actions|qa|retro):(?!fromMr|start|options)/;
const ID_LIKE = /^[\w#!.:/-]{1,64}$/;
const REF_LIKE = /^[\w./-]{1,100}[#!]\d{1,7}$|^[#!]?\d{1,7}$/;

// What a failed channel call may say about itself: its name, the way it came in and an id. Never the arguments.
export function rpcContext(channel: string, args: unknown[], via: 'ipc' | 'web'): Record<string, string> {
  const out: Record<string, string> = { channel, via };
  const first = args[0];
  if (typeof first === 'string' && ID_FIRST.test(channel) && ID_LIKE.test(first)) out.id = first;
  else if (first && typeof first === 'object') {
    const card = first as { ref?: unknown; iid?: unknown };
    if (typeof card.ref === 'string' && REF_LIKE.test(card.ref)) out.ref = card.ref;
    else if (typeof card.iid === 'string' && /^\d{1,7}$/.test(card.iid)) out.iid = card.iid;
  }
  if (channel === 'conflict:fromMr' && typeof args[1] === 'string' && REF_LIKE.test(args[1])) out.mr = args[1];
  return out;
}
