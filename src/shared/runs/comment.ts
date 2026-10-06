import type { CommentTemplate, Language } from '../config/types';
import { cycleText } from '../cycles/text';
import { createTranslator } from '../i18n';
import type { StageComment } from './output';

// The comment a stage leaves on the tracker: composed from a template of the cycle and what the agent wrote for it, then checked. The composing is
// deterministic (the status first, the sections in the template's order, the technical detail last and collapsed, a hidden marker at the end), and the
// check enforces what can be enforced on the text: it rewrites what can be rewritten without changing the meaning (secrets, local paths, ids of the
// run, a mention that would notify someone) and reports what cannot (the agents, the tools and the forum named, first person). Pure: the secret
// redaction comes in as a function, and nothing here hashes or posts.

export interface CommentContext {
  language: Language;
  /** The issue as the cards write it: "app#101". */
  ref: string;
  /** The label of the stage. */
  stage: string;
  /** The review round, for `{round}`. */
  round?: number;
  /** The word for how the stage ended, for `{result}` ("approved", "changes requested", "passed"). */
  result?: string;
  /** What the person decided at a gate, for `{decision}`. */
  decision?: string;
}

export interface RenderOptions {
  /** The hidden marker that identifies the comment (see `markerOf`). */
  marker: string;
  /** Used as the text of the first section when the agent wrote no comment of its own. */
  fallback?: string;
  /** A line after the sections and before the technical detail ("Closes #101"). */
  tail?: string;
}

export interface Rendered {
  body: string;
  /** The first line, as the template's status says it. */
  status: string;
}

const norm = (s: string): string => s.trim().replace(/[:.]+$/, '').toLowerCase();

/** The text of a section in the agent's comment: by its heading, else by its place when the agent wrote as many sections as the template has. */
function pick(content: StageComment | null, heading: string, index: number, count: number): string {
  if (!content) return '';
  const byName = content.sections.find((s) => norm(s.heading) === norm(heading));
  if (byName) return byName.body.trim();
  return content.sections.length === count ? (content.sections[index]?.body.trim() ?? '') : '';
}

/** Anything that would break the structure of the comment if it came from outside: HTML comments (a fake marker) and a `<details>` of its own. */
export function plainContent(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?details[^>]*>/gi, '').replace(/<\/?summary[^>]*>/gi, '').trim();
}

export function renderComment(tpl: CommentTemplate, ctx: CommentContext, content: StageComment | null, options: RenderOptions): Rendered {
  const tr = createTranslator(ctx.language);
  const params = { stage: ctx.stage, ref: ctx.ref, round: ctx.round ?? '', result: ctx.result ?? '', decision: ctx.decision ?? '' };
  const status = cycleText(tpl.status, ctx.language, params).trim();
  const parts: string[] = [`**${status}**`];
  const count = tpl.sections.length;
  let used = false;
  tpl.sections.forEach((s, i) => {
    const heading = cycleText(s.heading, ctx.language, params).trim();
    let text = plainContent(pick(content, heading, i, count));
    if (!text && i === 0 && !content && options.fallback) text = plainContent(options.fallback);
    if (!text) return;
    used = true;
    parts.push(`### ${heading}\n\n${text}`);
  });
  // A template with no section at all still says what the agent wrote, below the status.
  if (!count && !used && options.fallback && !content) parts.push(plainContent(options.fallback));
  if (options.tail) parts.push(options.tail.trim());
  const technical = tpl.technicalDetail ? plainContent(content?.technical ?? '') : '';
  if (technical) parts.push(`<details>\n<summary>${tr('main.runner.comment.technicalDetail')}</summary>\n\n${technical}\n\n</details>`);
  parts.push(options.marker);
  return { body: `${parts.join('\n\n')}\n`, status };
}

// ---- the hidden marker ------------------------------------------------------------------------------------------------------------------

/**
 * What identifies a comment as the one a run left for a stage (or for a round of the review, and for one finding of it), so it is found again, and
 * edited, when the run lost its note id.
 */
export function markerOf(runId: string, key: string, round?: number, finding?: number): string {
  return `<!-- coxia:run=${runId} stage=${key}${round ? ` round=${round}` : ''}${finding !== undefined ? ` finding=${finding}` : ''} -->`;
}

const MARKER = /<!--\s*coxia:run=(\S+)\s+stage=(\S+?)(?:\s+round=(\d+))?(?:\s+finding=(\d+))?\s*-->/;

export function readMarker(body: string): { run: string; key: string; round: number | null; finding: number | null } | null {
  const m = MARKER.exec(body);
  return m ? { run: m[1], key: m[2], round: m[3] ? Number(m[3]) : null, finding: m[4] ? Number(m[4]) : null } : null;
}

/** The comment among `comments` that carries this marker (the newest when there are several). */
export function findMarked<T extends { body: string }>(comments: T[], runId: string, key: string, round?: number): T | null {
  const found = comments.filter((c) => {
    const m = readMarker(c.body);
    return m && m.run === runId && m.key === key && (round === undefined || m.round === round);
  });
  return found.length ? found[found.length - 1] : null;
}

// ---- the check --------------------------------------------------------------------------------------------------------------------------

export const COMMENT_PROBLEMS = ['status', 'details', 'marker', 'agent', 'tool', 'forum', 'firstPerson'] as const;
export type CommentProblem = (typeof COMMENT_PROBLEMS)[number];

export const COMMENT_REWRITES = ['secret', 'localPath', 'runId', 'mention'] as const;
export type CommentRewrite = (typeof COMMENT_REWRITES)[number];

export interface CheckOptions extends TextOptions {
  /** The status line the comment must open with (as `renderComment` returned it). */
  status: string;
  /** The marker the comment must end with. */
  marker: string;
  /** Whether the template has a technical section (a `<details>` is only allowed then). */
  technicalDetail: boolean;
}

export interface Checked {
  body: string;
  /** What could not be fixed by rewriting: when there is any, the comment does not go out by itself. */
  problems: { code: CommentProblem; sample: string }[];
  /** What was rewritten, with how many times. */
  rewrites: { code: CommentRewrite; count: number }[];
}

const ABSOLUTE = /(?<![\w:./~-])(?:\/(?:home|Users|root|tmp|var|opt|mnt|srv|etc|usr|private)\/[^\s`'"<>)\]},;]+|[A-Za-z]:\\[^\s`'"<>)\]},;]+)/g;
const HOME_RELATIVE = /(?<![\w:./~-])~\/[^\s`'"<>)\]},;]+/g;
const RUN_ID = /\br-[a-z0-9]{1,12}-[a-z0-9]{2,8}\b/g;
const MENTION = /(?<![\w`@/.-])@([A-Za-z0-9][A-Za-z0-9_-]*)(?![\w@.-]*`)/g;
const TOOL = [/\b(?:Bash|WebFetch|WebSearch|NotebookEdit|MultiEdit|TodoWrite|MCP)\b/, /`(?:Read|Write|Edit|Grep|Glob)`/, /\b(?:Read|Write|Edit|Grep|Glob) tool\b/, /\b(?:Claude(?: Code)?|Anthropic|Agent SDK|LLM)\b/];
const FORUM = /\b(?:forum|f[óo]rum)\b/i;
const FIRST_EN = /(?<![\w'-])(?:I|I'm|I've|I'll|I'd|[Ww]e|[Ww]e're|[Ww]e've|[Ww]e'll|[Mm]y|[Oo]ur)(?![\w'-])/;
const FIRST_PT = /(?<![\wÀ-ÿ-])(?:eu|nós|meu|minha|meus|minhas|nosso|nossa|nossos|nossas)(?![\wÀ-ÿ-])/i;

function count(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).length;
}

/** The part of the comment a person who is not an engineer reads: without the technical detail, the quotes (the issue's own words), code and the marker. */
function proseOf(body: string, keepCode = false): string {
  const noDetails = body.replace(/<details[\s\S]*?<\/details>/gi, '');
  const noFences = noDetails.replace(/```[\s\S]*?```/g, '');
  return noFences
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>') && !l.includes('<!--'))
    .join('\n')
    .replace(keepCode ? /(?!)/g : /`[^`\n]*`/g, '');
}

export interface TextOptions {
  /** The hidden marker the text carries, which keeps the id of the run it names. */
  marker?: string;
  /** The worktree of the run: a path under it is rewritten to a path in the repository. */
  worktree: string;
  /** The ids of the agents of the team: naming one is a problem. */
  agentIds: string[];
  /** Masks what looks like a credential (`redact` of the error log). */
  redact: (text: string) => string;
}

export interface Rewritten {
  body: string;
  /** How many local paths were rewritten. */
  paths: number;
  /** Whether the redaction masked anything. */
  secret: boolean;
}

/**
 * The part of the check that only rewrites: local paths become paths of the repository (or the last name), and what looks like a credential is masked. It says
 * nothing about the wording, so a text that has its own rules about words (the documentation of a project) uses it without the problems `checkText` finds.
 */
export function rewriteLocal(raw: string, o: Pick<TextOptions, 'worktree' | 'redact'>): Rewritten {
  // Local paths first: the redaction below turns the home folder into "~", and the worktree usually lives under it.
  // A path inside the worktree becomes the path in the repository, any other absolute one keeps only its last name.
  const root = o.worktree.replace(/\/+$/, '');
  let paths = 0;
  const rel = (p: string): string => {
    paths++;
    if (root && (p === root || p.startsWith(`${root}/`))) return p.slice(root.length + 1) || '.';
    return p.split(/[\\/]/).filter(Boolean).pop() ?? '';
  };
  const local = raw.replace(ABSOLUTE, (p) => rel(p)).replace(HOME_RELATIVE, (p) => rel(p));
  const body = o.redact(local);
  return { body, paths, secret: body !== local };
}

/**
 * Rewrites what can be rewritten in a piece of text that goes to the tracker and reports what cannot: the part every comment shares, and the whole of a
 * comment on a line of the code, which has no structure of its own.
 */
export function checkText(raw: string, o: TextOptions): Checked {
  const rewrites: Checked['rewrites'] = [];
  const note = (code: CommentRewrite, n: number): void => {
    if (n > 0) rewrites.push({ code, count: n });
  };
  const local = rewriteLocal(raw, o);
  note('localPath', local.paths);
  note('secret', local.secret ? 1 : 0);
  let body = local.body;

  // The id of a run is the app's, not the reader's; the marker is the one place it stays, and it is put back after.
  const marked = !!o.marker && body.includes(o.marker);
  const bare = marked ? body.split(o.marker as string).join('\u0000') : body;
  const ids = count(bare, RUN_ID);
  body = (marked ? bare.replace(RUN_ID, '') : bare.replace(RUN_ID, '')).split('\u0000').join(o.marker ?? '');
  note('runId', ids);

  // Naming an agent is judged on the text as written: a mention is about to be turned into code, which the prose check skips.
  const written = proseOf(body, true);

  // A mention would notify somebody the comment is not for: it stays as text.
  let mentions = 0;
  body = body.replace(MENTION, (m) => {
    mentions++;
    return `\`${m}\``;
  });
  note('mention', mentions);

  const problems: Checked['problems'] = [];
  const flag = (code: CommentProblem, sample: string): void => void problems.push({ code, sample: sample.slice(0, 80) });
  const prose = proseOf(body);
  for (const id of o.agentIds) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = new RegExp(`@${e}\\b|\\b(?:agents?|agentes?) \`?${e}\\b|\\b${e}\`? (?:agent|agente)\\b|\`${e}\``, 'i').exec(written);
    if (named) flag('agent', named[0]);
  }
  for (const re of TOOL) {
    const m = re.exec(prose);
    if (m) flag('tool', m[0]);
  }
  const forum = FORUM.exec(prose);
  if (forum) flag('forum', forum[0]);
  const person = FIRST_EN.exec(prose) ?? FIRST_PT.exec(prose);
  if (person) flag('firstPerson', person[0]);

  return { body, problems, rewrites };
}

/**
 * A whole comment: the rewrites and the reports of `checkText`, and the structure checked on the final text (status first, the technical detail last
 * and collapsed, one marker at the end), not trusted from how it was composed.
 */
export function checkComment(raw: string, o: CheckOptions): Checked {
  const text = checkText(raw, o);
  const body = text.body;
  const problems = text.problems;
  const flag = (code: CommentProblem, sample: string): void => void problems.push({ code, sample: sample.slice(0, 80) });

  const first = body.split('\n').find((l) => l.trim());
  if (first?.trim() !== `**${o.status}**`) flag('status', first ?? '');

  const opens = count(body, /<details\b/i);
  const closes = count(body, /<\/details>/gi);
  const after = body.includes('</details>') ? body.slice(body.lastIndexOf('</details>') + '</details>'.length).split(o.marker).join('').trim() : '';
  if (opens !== closes || opens > 1 || (opens > 0 && !o.technicalDetail) || /<details[^>]*\bopen\b/i.test(body) || after) flag('details', opens ? 'details' : '');

  if (body.split(o.marker).length !== 2 || !body.trimEnd().endsWith(o.marker)) flag('marker', '');

  // The structure problems come first: they say the comment is not the standard one before any word in it is judged.
  const rank = (code: CommentProblem): number => (['status', 'details', 'marker'] as CommentProblem[]).indexOf(code) >= 0 ? (['status', 'details', 'marker'] as CommentProblem[]).indexOf(code) : 99;
  problems.sort((a, b) => rank(a.code) - rank(b.code));
  return { body, problems, rewrites: text.rewrites };
}
