// i18n-lint: allow-file JSON Schema descriptions: English documentation of the run file format
import type { JsonSchema } from '../config/jsonSchema';
import { validateSchema } from '../config/jsonSchema';
import { COMMENT_STATUSES, COMMENT_TARGETS, HISTORY_TYPES, QUESTION_KINDS, RUN_ID, RUN_STATUSES, RUN_VERSION, SCENARIO_RESULTS, SEVERITIES, STAGE_STATUSES, VERDICTS, type Run } from './types';

// What a run file must look like to be believed. The store checks every file it reads against this: a file edited by hand or written by a
// newer app is not used, and a newer one is never overwritten.

const string = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, maxLength: 4000, ...extra });
const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description, maxLength: 4000 });
const time = (description: string): JsonSchema => string(description, { minLength: 10, maxLength: 40 });
const enumOf = (description: string, values: readonly string[]): JsonSchema => ({ type: 'string', description, enum: [...values] });
const ID = '^[a-z0-9][a-z0-9_-]{0,47}$';
const FILE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';

function object(description: string, properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: 'object', description, properties, required, additionalProperties: false };
}

const stageRecord = object(
  'What one stage has done in this run.',
  {
    stage: string('Stage id.', { pattern: ID }),
    agent: { type: ['string', 'null'], description: 'The agent that works it; null for a gate.', pattern: ID },
    status: enumOf('Where the stage is.', STAGE_STATUSES),
    artifacts: { type: 'array', description: 'Files of the cycle folder it produced.', items: string('File name.', { pattern: FILE, maxLength: 100 }), maxItems: 50 },
    startedAt: { type: ['string', 'null'], description: 'Start of the latest attempt.', maxLength: 40 },
    endedAt: { type: ['string', 'null'], description: 'End of the latest attempt.', maxLength: 40 },
    attempts: { type: 'integer', description: 'How many times the stage was entered.', minimum: 0, maximum: 10_000 },
    autonomous: { type: 'boolean', description: 'Whether the agent was autonomous when the stage was entered.' },
  },
  ['stage', 'agent', 'status', 'artifacts', 'startedAt', 'endedAt', 'attempts', 'autonomous'],
);

const history = object(
  'One transition of the run.',
  { at: time('When.'), type: enumOf('What happened.', HISTORY_TYPES), stage: { type: ['string', 'null'], description: 'The stage it concerns.', maxLength: 48 }, by: string('An agent id, "person" or "app".', { maxLength: 48 }), detail: nullableString('A reason or a name.') },
  ['at', 'type', 'stage', 'by', 'detail'],
);

const comment = object(
  'The tracker comment of a stage or of the pull request.',
  {
    target: enumOf('Where it is: the issue or the pull request.', COMMENT_TARGETS),
    noteId: { type: ['string', 'integer', 'null'], description: 'The id the host returned; null until published.', maxLength: 200 },
    url: nullableString('Web address of the comment.'),
    bodyHash: { type: ['string', 'null'], description: 'Hash of the body last proposed or published.', maxLength: 200 },
    status: enumOf('Where the comment is.', COMMENT_STATUSES),
    updatedAt: time('When it last changed.'),
    body: { type: ['string', 'null'], description: 'The text last written for it, as it goes to the tracker.', maxLength: 200_000 },
    headline: { type: ['string', 'null'], description: 'The first line of the body: its status.', maxLength: 1000 },
    title: { type: ['string', 'null'], description: 'The title of the pull request (the `pr` record).', maxLength: 500 },
  },
  ['target', 'noteId', 'url', 'bodyHash', 'status', 'updatedAt'],
);

const finding = object(
  'One point of a review.',
  {
    path: string('File path relative to the repository root.', { minLength: 1, maxLength: 500 }),
    line: { type: ['integer', 'null'], description: 'First line, 1-based; null for the whole file.', minimum: 1 },
    endLine: { type: ['integer', 'null'], description: 'Last line of a range.', minimum: 1 },
    side: enumOf('The code after the change, or a removed line.', ['new', 'old']),
    severity: enumOf('Whether it blocks.', SEVERITIES),
    body: string('What is wrong and why it matters.', { maxLength: 8000 }),
    suggestion: { type: ['string', 'null'], description: 'A complete replacement for exactly the lines named.', maxLength: 8000 },
  },
  ['path', 'line', 'endLine', 'side', 'severity', 'body', 'suggestion'],
);

const review = object(
  'One review pass.',
  {
    round: { type: 'integer', description: 'Pass number, from 1.', minimum: 1 },
    stage: string('Stage id.', { pattern: ID }),
    by: string('Agent id.', { maxLength: 48 }),
    at: time('When.'),
    verdict: enumOf('Approved, or changes asked for.', VERDICTS),
    summary: string('What the reviewer said overall.', { maxLength: 20_000 }),
    findings: { type: 'array', description: 'The findings.', items: finding, maxItems: 200 },
    head: { type: ['string', 'null'], description: 'The commit looked at.', maxLength: 80 },
  },
  ['round', 'stage', 'by', 'at', 'verdict', 'summary', 'findings', 'head'],
);

const qaRecord = object(
  'One QA pass.',
  {
    stage: string('Stage id.', { pattern: ID }),
    by: string('Agent id.', { maxLength: 48 }),
    at: time('When.'),
    summary: string('What QA said overall.', { maxLength: 20_000 }),
    scenarios: {
      type: 'array',
      description: 'The scenarios checked.',
      items: object('One scenario.', { name: string('Name.', { maxLength: 500 }), result: enumOf('The result.', SCENARIO_RESULTS), detail: string('What was seen.', { maxLength: 8000 }) }, ['name', 'result', 'detail']),
      maxItems: 200,
    },
    head: { type: ['string', 'null'], description: 'The commit looked at.', maxLength: 80 },
  },
  ['stage', 'by', 'at', 'summary', 'scenarios', 'head'],
);

const pending = {
  ...object(
    'What a non-autonomous agent finished and the person has not accepted yet.',
    {
      kind: enumOf('A finished stage, or work handed back.', ['done', 'return']),
      by: string('The agent id.', { maxLength: 48 }),
      text: string('The findings of a return.', { maxLength: 20_000 }),
      handoff: string('What the next stage is to do.', { maxLength: 20_000 }),
      toStage: { type: ['string', 'null'], description: 'The stage the work goes back to.', maxLength: 48 },
      countRound: { type: 'boolean', description: 'The return is a review pass.' },
    },
    ['kind', 'by', 'text', 'handoff', 'toStage', 'countRound'],
  ),
  type: ['object', 'null'],
} as JsonSchema;

export const RUN_SCHEMA: JsonSchema = object(
  'A run: one issue going through the agent cycle.',
  {
    version: { type: 'integer', description: 'Version of this file format.', const: RUN_VERSION },
    rev: { type: 'integer', description: 'Grows by one on every save.', minimum: 0 },
    id: string('Run id.', { pattern: RUN_ID.source }),
    issue: object('The issue.', { ref: string('How the cards write it.', { minLength: 1, maxLength: 200 }), iid: { type: 'integer', description: 'Issue number.', minimum: 0 }, title: string('Title.', { maxLength: 500 }), url: nullableString('Web address.') }, ['ref', 'iid', 'title', 'url']),
    repo: string('A projects.repos id.', { pattern: ID }),
    branch: string('The run branch.', { minLength: 1, maxLength: 300 }),
    worktree: string('Absolute path of the worktree.', { minLength: 1 }),
    cycleFolder: string('Cycle documents folder, relative to the worktree; never absolute and never leaving it.', { minLength: 1, pattern: '^(?!/)(?!.*(^|/)\\.\\.(/|$))[^\\u0000]+$' }),
    cycleId: string('The template the run follows.', { pattern: '^[a-z0-9][a-z0-9_.-]{0,47}$' }),
    status: enumOf('Where the run is.', RUN_STATUSES),
    stage: string('The stage the run is in.', { pattern: ID }),
    stages: { type: 'array', description: 'One record per stage entered.', items: stageRecord, maxItems: 60 },
    question: {
      ...object('What the run waits for the person to answer.', { by: string('Agent id or "app".', { maxLength: 48 }), kind: enumOf('Who raised it.', QUESTION_KINDS), text: string('The question.', { maxLength: 20_000 }), askedAt: time('When.'), stage: string('The stage.', { pattern: ID }) }, ['by', 'kind', 'text', 'askedAt', 'stage']),
      type: ['object', 'null'],
    },
    pending,
    review: object('Review passes.', { rounds: { type: 'integer', description: 'Passes that ended in findings.', minimum: 0, maximum: 1000 }, max: { type: 'integer', description: 'Passes allowed before the run asks the person.', minimum: 1, maximum: 1000 } }, ['rounds', 'max']),
    error: {
      ...object('Why the run is failed.', { code: enumOf('What went wrong.', ['no-agent', 'stage-failed']), stage: string('The stage.', { pattern: ID }), detail: nullableString('Detail.') }, ['code', 'stage', 'detail']),
      type: ['object', 'null'],
    },
    history: { type: 'array', description: 'Every transition, in order.', items: history, maxItems: 1000 },
    comments: { type: 'object', description: 'Tracker comments by stage id, and `pr` for the pull request.', additionalProperties: comment },
    reviews: { type: 'array', description: 'Every review pass with its findings.', items: review, maxItems: 100 },
    qa: { type: 'array', description: 'Every QA pass with its scenarios.', items: qaRecord, maxItems: 100 },
    base: { type: ['string', 'null'], description: 'The commit the branch was cut from.', maxLength: 80 },
    createdAt: time('When the run started.'),
    updatedAt: time('When it last changed.'),
  },
  ['version', 'rev', 'id', 'issue', 'repo', 'branch', 'worktree', 'cycleFolder', 'cycleId', 'status', 'stage', 'stages', 'question', 'pending', 'review', 'error', 'history', 'comments', 'createdAt', 'updatedAt'],
);

export type RunParse = { ok: true; run: Run } | { ok: false; reason: 'newer' | 'invalid'; errors: string[] };

/** Reads a run from what the disk held: a newer format and anything that does not match the schema are refused, with the reason. */
export function parseRun(raw: unknown): RunParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'invalid', errors: ['expected an object'] };
  const version = (raw as { version?: unknown }).version;
  if (typeof version === 'number' && version > RUN_VERSION) return { ok: false, reason: 'newer', errors: [`written by a newer app (run format ${version})`] };
  const issues = validateSchema(raw, RUN_SCHEMA);
  if (issues.length) return { ok: false, reason: 'invalid', errors: issues.slice(0, 6).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)) };
  const badKey = Object.keys((raw as { comments: object }).comments).find((k) => !new RegExp(ID).test(k));
  if (badKey) return { ok: false, reason: 'invalid', errors: [`comments.${badKey}: not a stage id`] };
  // A file written before these fields existed reads as having none.
  const run = raw as Run;
  return { ok: true, run: { ...run, reviews: run.reviews ?? [], qa: run.qa ?? [], base: run.base ?? null } };
}
