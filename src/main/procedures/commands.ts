// i18n-lint: allow-file what the app drafts for a model to read and keep: English by design, like the tool texts of the engines
import { LIMITS } from '../../shared/procedures';
import { acceptsText } from './record';

// The app's draft of a `repo` or `tool` procedure (#187): built from the text of the commands the agent ran in its shell, and from nothing else. Output is never read, because
// output is where a secret shows. Pure: it reads `ExecEntry` values only, and a test feeds it entries with extra fields to show none is copied. A command that could carry a secret
// is left out and only counted; the draft says how many, never which and never why.

/** One command of the agent's shell, as the session's log has it. */
export interface ExecEntry {
  /** 1-based, in the order of the session. */
  n: number;
  command: string;
  /** null when it did not run to an exit. */
  exitCode: number | null;
  timedOut: boolean;
  /** Why the command was not run at all. */
  refused?: string;
}

export interface CommandDraftStep {
  /** 1-based, in the order of the draft. A save names the steps it keeps by this number. */
  n: number;
  /** The app's wording; the agent may reword it. */
  text: string;
  /** The command as the agent ran it, whitespace collapsed: the app's, never the agent's. */
  run: string;
}

export interface CommandDraft {
  steps: CommandDraftStep[];
  /** Commands that did not work, worded by the app: candidates the agent may turn into a lesson or drop. */
  pitfalls: string[];
  /** The words of the steps that did not work, as the draft would have worded them had they worked. */
  failed: string[];
  /** How many commands were left out because they could carry a secret or could not be kept. Noise is not counted. */
  leftOut: number;
  /** A command failed and a later one of the same program worked, and there is a step to keep. */
  trial: boolean;
  /** The programs of the steps, as lowercase slugs: the one with most steps first (the first to appear on a tie). */
  programs: string[];
}

export interface CommandDraftOptions {
  /** The exact-value mask of the stage's test environment: a command it would change is left out. */
  mask?: (text: string) => string;
  /** Whether a text holds something the person typed in a hand-off. */
  typedIn?: (text: string) => boolean;
  /** The person's home folder, for the validator; the machine's by default. */
  home?: string;
}

/** The most `run` the validator keeps; a longer command is left out, never cut. */
const RUN_MAX = LIMITS.stepRun;

// Programs whose output is what they are for: they change nothing a procedure could repeat. Dropped without being counted.
const NOISE = new Set(['ls', 'cat', 'pwd', 'echo', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'tree', 'which', 'whoami', 'cd', 'true', 'false', 'sleep', 'date', 'env', 'printenv', 'stat', 'file', 'du', 'df', 'less', 'more', 'sort', 'uniq', 'diff', 'basename', 'dirname', 'realpath', 'test', '[']);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'remote', 'rev-parse', 'ls-files', 'blame']);
// Commands that change the shell of the agent, not the work, or that read a script into it.
const SHELL_STATE = new Set(['export', 'set', 'unset', 'source', '.']);
// The words the validator also reads in a command: `sudo env time nohup exec command` come before the program.
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command']);
const SEGMENT = /\s*(?:&&|\|\||[|;&])\s*/;
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
// A value that holds a substitution or a stray quote is not stripped: the command then starts with an assignment and is left out.
const LEADING_ASSIGNMENT = /^[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|[^\s"'`$()&|;<>]*)\s+/;
const LEADING_CD = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s"'`$()&|;<>]+)\s*&&\s*/;
const PLAIN_PROGRAM = /^[\w.+@-]+$/;
const PLAIN_SUBCOMMAND = /^[a-z][\w:-]*$/i;

// Carriers: what mentions a place or a word where a secret lives. A command with one is left out whole, which errs toward leaving out (`npm run test:token` goes too).
const CARRIERS: RegExp[] = [
  /\.env\b|\.npmrc|\.netrc|\.aws\b|\.ssh\b|id_rsa|id_ed25519|\.pem\b|credentials|secret/i,
  /authorization|bearer|cookie|api[-_]?key|passw|token/i,
  /:\/\/[^\s/@:]+:[^\s/@]*@/,
  /<</,
];
const NET_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh']);
// The flags of a network client that carry a header, a login, a body or a cookie. Single-dash flags may sit in a cluster (`-su`).
const NET_PAYLOAD_LONG = /^--(?:header|user|data|form|cookie|oauth2-bearer|post-data|post-file|http-user|body)/i;
const NET_PAYLOAD_SHORT = /^-[A-Za-z]*[HudFb]/;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The command without a leading `cd <path> &&`, `env`, and the environment assignments before the program. */
function strip(command: string): string {
  let s = command;
  for (;;) {
    const cd = LEADING_CD.exec(s);
    if (cd) {
      s = s.slice(cd[0].length);
      continue;
    }
    if (/^env\s+/.test(s)) {
      s = s.replace(/^env\s+/, '');
      continue;
    }
    const as = LEADING_ASSIGNMENT.exec(s);
    if (as) {
      s = s.slice(as[0].length);
      continue;
    }
    return s;
  }
}

/** The words of the first segment of a chain, after the wrappers and assignments that come before the program. */
function wordsOf(command: string): string[] {
  const tokens = (command.split(SEGMENT)[0] ?? '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && (WRAPPERS.has(tokens[i]) || ASSIGNMENT.test(tokens[i]))) i++;
  return tokens.slice(i);
}

const baseName = (word: string | undefined): string => (word ?? '').split('/').pop()!.replace(/\.exe$/i, '').toLowerCase();

/** The program of a command: the first word of its first segment, after `sudo env time nohup exec command`. */
export const programOf = (command: string): string => baseName(wordsOf(command)[0]);

function isNoise(command: string): boolean {
  const words = wordsOf(command);
  const program = baseName(words[0]);
  if (program === 'git') return GIT_READ.has(words[1] ?? '');
  return NOISE.has(program);
}

/** Whether a segment of the command is a network client given a header, login, body or cookie. */
function netPayload(command: string): boolean {
  for (const segment of command.split(SEGMENT)) {
    const words = wordsOf(segment);
    if (!NET_CLIENTS.has(baseName(words[0]))) continue;
    if (words.slice(1).some((w) => NET_PAYLOAD_LONG.test(w) || NET_PAYLOAD_SHORT.test(w))) return true;
  }
  return false;
}

const carries = (command: string): boolean => CARRIERS.some((re) => re.test(command)) || netPayload(command);

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

interface Counted {
  at: number;
  run: string;
  program: string;
  text: string;
  failed: boolean;
  timedOut: boolean;
  exitCode: number | null;
}

/** The draft of a call from the commands its shell ran in it. */
export function buildCommandDraft(entries: readonly ExecEntry[], options: CommandDraftOptions = {}): CommandDraft {
  let leftOut = 0;
  const counted: Counted[] = [];

  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    // A refused command and one that never ran did nothing a procedure could repeat.
    if (e.refused || (e.exitCode === null && !e.timedOut)) continue;
    const raw = e.command.trim();
    if (!raw) continue;
    // A pasted script or a heredoc: more than one line is never a step.
    if (/[\r\n]/.test(raw)) {
      leftOut++;
      continue;
    }
    const whole = collapse(raw);
    // The exact values are read on the command as it was typed, before anything is stripped from it.
    if ((options.mask && options.mask(whole) !== whole) || options.typedIn?.(whole)) {
      leftOut++;
      continue;
    }
    const run = strip(whole);
    const program = programOf(run);
    if (!run || ASSIGNMENT.test(run) || /^[;&|]/.test(run) || SHELL_STATE.has(program) || carries(run) || run.length > RUN_MAX) {
      leftOut++;
      continue;
    }
    if (isNoise(run)) continue;
    // A shell construct with no plain program name (a subshell, a substitution) cannot be worded as a step.
    if (!PLAIN_PROGRAM.test(program)) {
      leftOut++;
      continue;
    }
    const sub = wordsOf(run)[1];
    const text = `Run ${program}${sub && PLAIN_SUBCOMMAND.test(sub) ? ` ${sub}` : ''}`;
    counted.push({ at: e.n, run, program, text, failed: e.exitCode !== 0 || e.timedOut, timedOut: e.timedOut, exitCode: e.exitCode });
  }

  // The failures, in order: each one a pitfall candidate, never a step. A success repeated word for word keeps its last place.
  const successes = counted.filter((c) => !c.failed);
  const last = new Map<string, number>();
  for (const c of successes) last.set(c.run, c.at);
  const kept: Counted[] = [];
  for (const c of successes) {
    if (last.get(c.run) !== c.at) continue;
    if (!acceptsText(c.text, { max: LIMITS.stepText }, options.home) || !acceptsText(c.run, { max: RUN_MAX }, options.home)) {
      leftOut++;
      continue;
    }
    kept.push(c);
  }

  const pitfalls: string[] = [];
  const failed: string[] = [];
  for (const c of counted.filter((x) => x.failed)) {
    const line = c.timedOut ? `Timed out: ${c.run}` : `Failed (exit ${c.exitCode}): ${c.run}`;
    if (!acceptsText(line, { max: LIMITS.pitfall }, options.home)) {
      leftOut++;
      continue;
    }
    if (!pitfalls.includes(line)) pitfalls.push(line);
    if (!failed.includes(c.text)) failed.push(c.text);
  }

  const trial = kept.length > 0 && counted.some((f) => f.failed && kept.some((k) => k.at > f.at && k.program === f.program));

  const count = new Map<string, number>();
  for (const k of kept) {
    const name = slugOf(k.program);
    if (name) count.set(name, (count.get(name) ?? 0) + 1);
  }
  const programs = [...count.keys()].sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0));

  return {
    steps: kept.map((k, i) => ({ n: i + 1, text: k.text, run: k.run })),
    pitfalls: pitfalls.slice(0, LIMITS.pitfalls),
    failed,
    leftOut,
    trial,
    programs,
  };
}
