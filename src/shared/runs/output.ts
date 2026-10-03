import type { StageKind } from '../config/types';
import { t } from '../i18n';
import type { Finding, Scenario } from './types';

// What a stage's agent answers, and how the runner reads it. The schema goes to the model as the shape of its answer; `readOutput` turns whatever
// came back into the strict shape the rest of the runner uses, dropping what does not fit instead of failing a whole stage over one field.

export type OutputKind = 'work' | 'review' | 'qa';

/** How a stage is answered: by the kind of the stage (a review finds, QA verifies, anything else produces documents). */
export const outputKindOf = (kind: StageKind): OutputKind => (kind === 'review' ? 'review' : kind === 'qa' ? 'qa' : 'work');

export interface ArtifactOutput {
  name: string;
  content: string;
}

/** What an agent writes for a tracker comment: a text per section of the template, and the technical part. The app composes the comment around it. */
export interface StageComment {
  sections: { heading: string; body: string }[];
  technical: string;
}

/** The pull request description an agent writes: its title, and the same as a comment. */
export interface PullRequestText extends StageComment {
  title: string;
}

export interface StageOutput {
  /** What the agent did, for the thread. */
  summary: string;
  /** A short lowercase description of the change, for the commit message. */
  commit: string;
  artifacts: ArtifactOutput[];
  /** What the next stage is to do; empty: nothing to say. */
  handoff: string;
  /** Something the agent cannot go on without; non-empty pauses the stage. It goes to the agent the asker turns to, and from there up to the person. */
  question: string;
  /** The question is a decision only the person can take (scope, priority, a risk to accept): it goes to them at once, past the agents. */
  needsPerson: boolean;
  /** Something only the person who reported the issue can say; non-empty makes the stage wait for their reply on the issue. */
  reporterQuestion: string;
  /** A priority the agent proposes for the issue, one of the configured labels; always a proposal for the person to accept. */
  priority: string;
  /** A milestone the agent proposes, as text; there is no write for it, so it is said in the thread and in the proposal. */
  milestone: string;
  /** The squad the agent proposes for the issue (a squad id), asked of the front door of a run whose squad is not decided; empty: none. */
  squad: string;
  /** Why that squad. */
  squadReason: string;
  /** Review only. */
  verdict: 'approved' | 'changes' | null;
  findings: Finding[];
  /** QA only. */
  scenarios: Scenario[];
  /** The text of this stage's tracker comment, when its template asked for one and the agent wrote it. */
  comment: StageComment | null;
  /** The pull request description, asked of the stage that ends with the push. */
  pr: PullRequestText | null;
}

const str = { type: 'string' };
const strOrNull = { type: ['string', 'null'] };
const intOrNull = { type: ['integer', 'null'] };

function obj(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const finding = obj({ path: str, line: intOrNull, endLine: intOrNull, side: { enum: ['new', 'old'] }, severity: { enum: ['blocking', 'suggestion'] }, body: str, suggestion: strOrNull });
const scenario = obj({ name: str, result: { enum: ['pass', 'fail', 'not-run'] }, severity: { enum: ['blocking', 'non-blocking'] }, detail: str });
// An agent that can run commands says, per scenario, whether it did and which commands (their numbers) back it.
const scenarioWithEvidence = obj({ name: str, result: { enum: ['pass', 'fail', 'not-run'] }, severity: { enum: ['blocking', 'non-blocking'] }, detail: str, evidence: { enum: ['executed', 'read'] }, commands: { type: 'array', items: { type: 'integer' } } });

const commentText = (extra: Record<string, unknown> = {}) => obj({ ...extra, sections: { type: 'array', items: obj({ heading: str, body: str }) }, technical: str });

export interface OutputWants {
  /** The agent may ask the person who reported the issue: ask for `reporterQuestion`. */
  reporter?: boolean;
  /** The agent may propose a priority and a milestone: ask for `priority` and `milestone`. */
  priority?: boolean;
  /** The agent turns to another agent before the person: ask whether the question is the person's alone (`needsPerson`). */
  ask?: boolean;
  /** The agent proposes the squad of the issue, one of these ids (the front door of a run whose squad the scope rules could not pick): ask for `squad` and `squadReason`. */
  squads?: string[];
  /** The stage has a comment template: ask for `comment`. */
  comment?: boolean;
  /** The stage ends with the push: ask for the pull request description too. */
  pr?: boolean;
  /** QA can run commands in a sandbox: ask each scenario for its `evidence` and the numbers of the commands behind it. */
  evidence?: boolean;
}

/** The JSON Schema of a stage's answer. */
export function outputSchema(kind: OutputKind, wants: OutputWants = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    summary: str,
    commit: str,
    artifacts: { type: 'array', items: obj({ name: str, content: str }) },
    handoff: strOrNull,
    question: strOrNull,
  };
  if (kind === 'review') Object.assign(base, { verdict: { enum: ['approved', 'changes'] }, findings: { type: 'array', items: finding } });
  if (kind === 'qa') Object.assign(base, { scenarios: { type: 'array', items: wants.evidence ? scenarioWithEvidence : scenario } });
  if (wants.ask) base.needsPerson = { type: 'boolean' };
  if (wants.reporter) base.reporterQuestion = strOrNull;
  if (wants.priority) Object.assign(base, { priority: strOrNull, milestone: strOrNull });
  if (wants.squads?.length) Object.assign(base, { squad: { type: ['string', 'null'], enum: [...wants.squads, null] }, squadReason: strOrNull });
  if (wants.comment) base.comment = commentText();
  if (wants.pr) base.pr = commentText({ title: str });
  return obj(base);
}

const NULLISH = /^(null|none|nenhum|nenhuma|n\/a|-)\.?$/i;
const text = (v: unknown, max = 20_000): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return !s || NULLISH.test(s) ? '' : s.slice(0, max);
};
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const lineOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);

/** The file names a stage may write: plain names, no folder, nothing that starts with a dot. */
export const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function readFinding(raw: unknown): Finding | null {
  const f = record(raw);
  const path = text(f.path, 500).replace(/^\.?\//, '');
  const body = text(f.body, 8000);
  if (!path || !body || path.split('/').includes('..')) return null;
  const line = lineOf(f.line);
  const end = lineOf(f.endLine);
  return {
    path,
    line,
    // A range needs a first line and ends at or after it.
    endLine: line !== null && end !== null && end > line ? end : null,
    side: f.side === 'old' ? 'old' : 'new',
    severity: f.severity === 'suggestion' ? 'suggestion' : 'blocking',
    body,
    suggestion: line !== null ? text(f.suggestion, 8000) || null : null,
  };
}

export function readScenario(raw: unknown): Scenario | null {
  const s = record(raw);
  const name = text(s.name, 500);
  if (!name) return null;
  const commands = list(s.commands).filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1).slice(0, 50);
  return {
    name,
    result: s.result === 'pass' || s.result === 'fail' ? s.result : 'not-run',
    severity: s.severity === 'non-blocking' ? 'non-blocking' : 'blocking',
    detail: text(s.detail, 8000),
    ...(s.evidence === 'executed' || s.evidence === 'read' ? { evidence: s.evidence } : {}),
    ...(commands.length ? { commands } : {}),
  };
}

/** What the app knows of a command of the stage, for checking a claim of execution. */
export interface ExecSummary {
  n: number;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * The scenarios of a QA pass with their evidence checked. When the agent was not asked (it had no sandbox) every scenario is `read`. When it was, an `executed` claim stands only
 * if it cites a command of this stage that backs it: a pass needs one that ended with exit code 0, a failure any that ran to an end. A claim that nothing backs is recorded as
 * `read` and marked `unbacked`, so a pass nobody ran is visible as one. It proves that a command ran, not that the behaviour is right.
 */
export function backEvidence(scenarios: Scenario[], log: readonly ExecSummary[], asked: boolean): Scenario[] {
  return scenarios.map((s) => {
    const { commands, evidence: _claimed, unbacked: _flag, ...rest } = s;
    if (!asked || s.evidence !== 'executed') return { ...rest, evidence: 'read' };
    const cited = [...new Set((commands ?? []).filter((n) => log.some((l) => l.n === n)))];
    const ran = (n: number): ExecSummary | undefined => log.find((l) => l.n === n);
    const backed = cited.some((n) => (s.result === 'pass' ? ran(n)?.exitCode === 0 : s.result === 'fail' ? ran(n)?.exitCode !== null || ran(n)?.timedOut === true : true));
    return backed ? { ...rest, evidence: 'executed', commands: cited } : { ...rest, evidence: 'read', unbacked: true };
  });
}

/** A failed scenario that sends the work back: any failure that is not marked non-blocking. */
export const scenarioBlocks = (s: Pick<Scenario, 'result' | 'severity'>): boolean => s.result === 'fail' && s.severity !== 'non-blocking';

/** A failed scenario that is only reported. */
export const scenarioNotes = (s: Pick<Scenario, 'result' | 'severity'>): boolean => s.result === 'fail' && s.severity === 'non-blocking';

export function readComment(raw: unknown): StageComment | null {
  const c = record(raw);
  const sections = list(c.sections).flatMap((x) => {
    const s = record(x);
    const body = text(s.body, 8000);
    return body ? [{ heading: text(s.heading, 300), body }] : [];
  });
  const technical = text(c.technical, 12_000);
  return sections.length || technical ? { sections, technical } : null;
}

export function readPullRequest(raw: unknown): PullRequestText | null {
  const c = readComment(raw);
  const title = text(record(raw).title, 200).split('\n')[0].trim();
  return c || title ? { title, sections: c?.sections ?? [], technical: c?.technical ?? '' } : null;
}

/** The answer of the agent, read leniently. A review that says "approved" but lists a blocking finding is not approved: the findings are what the developer gets. */
export function readOutput(raw: unknown, kind: OutputKind): StageOutput {
  const o = record(raw);
  const findings = kind === 'review' ? list(o.findings).flatMap((f) => readFinding(f) ?? []) : [];
  const blocks = findings.some((f) => f.severity === 'blocking');
  const summary = text(o.summary);
  const asked = text(o.question);
  // "A decision only the person can take" with no question written: the stage cannot go on and the person has nothing to answer, so the question is made of what the agent said.
  const question = asked || (o.needsPerson === true && !text(o.reporterQuestion) && summary ? t('main.runner.needsPerson.question', { summary: summary.slice(0, 4000) }) : '');
  const verdict = kind === 'review' ? (o.verdict === 'changes' || blocks ? 'changes' : 'approved') : null;
  return {
    summary,
    commit: text(o.commit, 200),
    artifacts: list(o.artifacts).flatMap((a) => {
      const x = record(a);
      const name = typeof x.name === 'string' ? x.name.trim() : '';
      return ARTIFACT_NAME.test(name) && typeof x.content === 'string' ? [{ name, content: x.content }] : [];
    }),
    handoff: text(o.handoff),
    question,
    needsPerson: o.needsPerson === true,
    reporterQuestion: text(o.reporterQuestion),
    priority: text(o.priority, 200),
    milestone: text(o.milestone, 200),
    squad: text(o.squad, 48),
    squadReason: text(o.squadReason, 2000),
    verdict,
    findings,
    scenarios: kind === 'qa' ? list(o.scenarios).flatMap((s) => readScenario(s) ?? []) : [],
    comment: readComment(o.comment),
    pr: readPullRequest(o.pr),
  };
}

/** Where a finding points, as a person reads it: "src/a.ts:12", "src/a.ts:12-14", or the file alone. */
export function whereOf(f: Pick<Finding, 'path' | 'line' | 'endLine'>): string {
  return f.line === null ? f.path : f.endLine !== null ? `${f.path}:${f.line}-${f.endLine}` : `${f.path}:${f.line}`;
}

const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []);

/**
 * Whether two findings (from different rounds) say the same thing: the same file and either the same words or a good deal of them, or the same
 * replacement. The line is not compared: code moves between rounds.
 */
export function sameFinding(a: Finding, b: Finding): boolean {
  if (a.path !== b.path) return false;
  if (a.suggestion && b.suggestion && a.suggestion.trim() === b.suggestion.trim()) return true;
  const x = words(a.body);
  const y = words(b.body);
  if (!x.size || !y.size) return a.body.trim() === b.body.trim();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.5;
}

/** One finding as a line of the thread and of the handoff to the developer: severity, where, what, and the suggested replacement when there is one. */
export function findingText(f: Finding): string {
  const head = t(f.severity === 'blocking' ? 'main.runner.finding.blocking' : 'main.runner.finding.suggestion', { where: whereOf(f), body: f.body });
  return f.suggestion ? `${head}\n${t('main.runner.finding.replacement')}\n${f.suggestion}` : head;
}

/** The findings of a review pass as text: the review's own words first, then each finding, blocking ones first. */
export function findingsText(summary: string, findings: Finding[]): string {
  const order = [...findings].sort((a, b) => Number(b.severity === 'blocking') - Number(a.severity === 'blocking'));
  return [summary, ...order.map(findingText)].filter(Boolean).join('\n\n');
}

/** What QA found wrong that blocks, as text for the developer; what it noted without blocking comes after, said so. */
export function failuresText(summary: string, scenarios: Scenario[]): string {
  const failed = scenarios.filter(scenarioBlocks).map((s) => t('main.runner.scenario.failed', { name: s.name, detail: s.detail || '—' }));
  return [summary, ...failed, notesText(scenarios)].filter(Boolean).join('\n\n');
}

/** What QA saw fail without blocking the delivery, one line each; empty when there is none. */
export function notesText(scenarios: Scenario[]): string {
  const notes = scenarios.filter(scenarioNotes);
  return notes.length ? [t('main.runner.scenario.notesHead'), ...notes.map((s) => t('main.runner.scenario.note', { name: s.name, detail: s.detail || '—' }))].join('\n') : '';
}

export interface LimitInput {
  /** The label of the stage that sent the work back. */
  stage: string;
  /** How many times it sent it back. */
  rounds: number;
  /** What the previous round asked to change, one line each. */
  asked: string[];
  /** What the producer said it did since (its latest summary). */
  did: string;
  /** What the latest round still finds, one line each. */
  open: string[];
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** A blocking finding as one line of the limit's question. */
export const findingLine = (f: Finding): string => t('main.runner.limit.item', { where: whereOf(f), body: clip(f.body.replace(/\s+/g, ' '), 300) });

/** A failed scenario as one line of the limit's question. */
export const scenarioLine = (s: Scenario): string => t('main.runner.limit.item', { where: s.name, body: clip((s.detail || '—').replace(/\s+/g, ' '), 300) });

/**
 * The question the person gets when a stage has sent the work back as many times as it may: what was asked, what the producer did about it and what is
 * still open, each from the records of the rounds (not the reviewer's whole text).
 */
export function limitText(i: LimitInput): string {
  const none = t('main.runner.limit.none');
  const list = (lines: string[]): string => (lines.length ? lines.join('\n') : none);
  return t('main.runner.limit.text', { stage: i.stage, rounds: i.rounds, asked: list(i.asked), did: i.did.trim() ? clip(i.did.trim().replace(/\n{3,}/g, '\n\n'), 800) : none, open: list(i.open) });
}
