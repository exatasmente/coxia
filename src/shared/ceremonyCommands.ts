// The commands a ceremony agent asks the person to allow: what they look like on the wire, the rule "allow always" writes, and which of them write to the
// code host (those are allowed once at most, never always). Pure: shared by the main process, the screens and the tests.

/** The module event carrying the commands that wait for the person, the whole list each time. */
export const CEREMONY_COMMANDS_EVENT = 'ceremony-commands';

export const CEREMONY_DECISIONS = ['once', 'always', 'deny'] as const;
export type CeremonyDecision = (typeof CEREMONY_DECISIONS)[number];

export interface CeremonyCommand {
  id: string;
  /** The agent of the team that asked (the system agent of the ceremony: deep, turn, reply...). */
  agent: string;
  /** The name the team gives an agent that is not a system one (an agent called with `@` in a conversation); absent for a system agent, whose name is translated. */
  name?: string;
  command: string;
  /** It writes to the code host: it can be allowed once, never always. */
  write: boolean;
  /** What "allow always" would add to the agent (`gh api:*`); null for a write. */
  rule: string | null;
  since: string;
}

const MAX_RULE = 200;

/** A rule as the agent's list keeps it: `prefix:*` allows the prefix and anything after a space, anything else only that exact command. */
export function ruleAllows(rule: string, command: string): boolean {
  const c = command.trim();
  const r = rule.trim();
  if (!r) return false;
  if (r.endsWith(':*')) {
    const prefix = r.slice(0, -2).trim();
    return !!prefix && (c === prefix || c.startsWith(`${prefix} `));
  }
  return c === r;
}

export const rulesAllow = (rules: readonly string[] | undefined, command: string): boolean => (rules ?? []).some((r) => ruleAllows(r, command));

/** Whether a rule may be kept: one line, not empty, not too long, and a prefix rule names at least a program. */
export function validRule(rule: unknown): rule is string {
  if (typeof rule !== 'string') return false;
  const r = rule.trim();
  return !!r && r.length <= MAX_RULE && !/[\n\r]/.test(r) && r !== ':*';
}

const GROUPS = new Set(['pr', 'issue', 'release', 'run', 'repo', 'label', 'workflow', 'mr', 'ci', 'api', 'cache', 'gist', 'project', 'secret', 'variable', 'search', 'auth', 'config', 'tag']);

/**
 * The rule "allow always" proposes, in the manner of Claude Code: the program and its subcommands, never an argument (`gh api repos/o/r/releases` gives
 * `gh api:*`, `gh pr list -R o/r` gives `gh pr list:*`, `npm test` gives `npm test:*`). A command with a shell operator gets the exact command, never a prefix.
 */
export function suggestRule(command: string): string {
  const c = command.trim().replace(/\s+/g, ' ');
  if (/[|;&<>`$()]/.test(c)) return c.slice(0, MAX_RULE);
  const words = c.split(' ');
  const out = [words[0]];
  for (const w of words.slice(1)) {
    if (out.length >= 3 || w.startsWith('-') || /[/=:"'@.]/.test(w) || /^\d/.test(w)) break;
    out.push(w);
    // `gh api` and `glab api` take a path next: the rule stops at the group.
    if (w === 'api') break;
    if (out.length === 2 && !GROUPS.has(w)) break;
  }
  return `${out.join(' ')}:*`.slice(0, MAX_RULE);
}

/** The subcommand of a git command line, past the options that take a value (`-C <path>`, `-c <key=value>`). */
function gitSubcommand(words: string[]): string | null {
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === '-C' || w === '-c' || w === '--git-dir' || w === '--work-tree') i++;
    else if (!w.startsWith('-')) return w;
  }
  return null;
}

const READ_VERBS = new Set(['view', 'list', 'status', 'diff', 'checks', 'download', 'watch', 'search', 'browse']);
const WRITE_METHOD = /(?:^|\s)(?:-X|--method)(?:\s+|=)['"]?(POST|PUT|PATCH|DELETE)\b/i;
const WITH_BODY = /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=)/;

/**
 * Whether a command writes to the code host: a `git push`, a `gh`/`glab` API call with a writing method or a body, a GraphQL call, or a `gh`/`glab`
 * subcommand that is not a read (`gh pr merge`, `glab mr note`...). Anything it does not recognise as a host CLI is not counted as a host write.
 */
export function isHostWrite(command: string): boolean {
  const c = command.trim().replace(/\s+/g, ' ');
  for (const part of c.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
    const words = part.split(' ');
    const [bin, sub, verb] = words;
    if (bin === 'git' && gitSubcommand(words) === 'push') return true;
    if (bin !== 'gh' && bin !== 'glab') continue;
    if (sub === 'api') {
      if (words.includes('graphql') || WRITE_METHOD.test(part) || WITH_BODY.test(part)) return true;
      continue;
    }
    if (!sub || sub.startsWith('-') || READ_VERBS.has(sub)) continue;
    if (sub === 'auth' || sub === 'config' || sub === 'alias' || sub === 'extension') return true;
    if (!verb || verb.startsWith('-') || !READ_VERBS.has(verb)) return true;
  }
  return false;
}
