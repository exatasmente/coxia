// i18n-lint: allow-file JSON Schema descriptions: English documentation of the run file format
import type { JsonSchema } from '../config/jsonSchema';
import { validateSchema } from '../config/jsonSchema';
import { STAGE_KINDS, STAGE_TYPES, WAIT_KINDS } from '../config/types';
import { COMMENT_STATUSES, COMMENT_TARGETS, HISTORY_DETAIL_MAX, HISTORY_TYPES, LINK_KINDS, LINK_ROLES, LINK_STATUSES, QUESTION_KINDS, ROUTED_BY, ROUTING_WHY, RUN_ID, RUN_STATUSES, RUN_VERSION, SCENARIO_EVIDENCE, SCENARIO_RESULTS, SCENARIO_SEVERITIES, SEVERITIES, STAGE_STATUSES, VERDICTS, type Run } from './types';
import { EVIDENCE_KINDS } from '../evidence';

// What a run file must look like to be believed. The store checks every file it reads against this: a file edited by hand or written by a
// newer app is not used, and a newer one is never overwritten.

const string = (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: 'string', description, maxLength: 4000, ...extra });
const nullableString = (description: string): JsonSchema => ({ type: ['string', 'null'], description, maxLength: 4000 });
const time = (description: string): JsonSchema => string(description, { minLength: 10, maxLength: 40 });
const enumOf = (description: string, values: readonly string[]): JsonSchema => ({ type: 'string', description, enum: [...values] });
const ID = '^[a-z0-9][a-z0-9_-]{0,47}$';
const FILE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$';
/** Evidence ids a scenario or a stage output cites (`ev-<digits>`). */
const EVIDENCE_REFS: JsonSchema = { type: 'array', description: 'Evidence ids (ev-<digits>).', items: string('An evidence id.', { pattern: '^ev-\\d{1,6}$', maxLength: 12 }), maxItems: 50 };

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
    usage: object(
      'What the stage\'s model calls used, over all attempts.',
      {
        promptTokens: { type: 'integer', description: 'Tokens sent.', minimum: 0 },
        completionTokens: { type: 'integer', description: 'Tokens received.', minimum: 0 },
        cachedTokens: { type: 'integer', description: 'Of the tokens sent, the ones the provider served from its cache.', minimum: 0 },
        calls: { type: 'integer', description: 'Model calls.', minimum: 0 },
        costUsd: { type: ['number', 'null'], description: 'What a provider or the SDK said it cost; null when none did.', minimum: 0 },
        costEstimated: { type: 'boolean', description: 'The cost is an estimate: no provider reported what the calls were charged. Absent: charged.' },
      },
      ['promptTokens', 'completionTokens', 'cachedTokens', 'calls', 'costUsd'],
    ),
  },
  ['stage', 'agent', 'status', 'artifacts', 'startedAt', 'endedAt', 'attempts', 'autonomous'],
);

const history = object(
  'One transition of the run.',
  { at: time('When.'), type: enumOf('What happened.', HISTORY_TYPES), stage: { type: ['string', 'null'], description: 'The stage it concerns.', maxLength: 48 }, by: string('An agent id, "person" or "app".', { maxLength: 48 }), detail: { type: ['string', 'null'], description: 'A reason or a name.', maxLength: HISTORY_DETAIL_MAX } },
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
    evidenceIds: EVIDENCE_REFS,
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
      items: object('One scenario.', { name: string('Name.', { maxLength: 500 }), result: enumOf('The result.', SCENARIO_RESULTS), detail: string('What was seen.', { maxLength: 8000 }), severity: enumOf('Whether a failure sends the work back; absent: blocking.', SCENARIO_SEVERITIES), evidence: enumOf('executed: the agent ran something in its sandbox to check it; read: it only looked.', SCENARIO_EVIDENCE), unbacked: { type: 'boolean', description: 'Claimed as executed and nothing of the stage\'s commands backs it.' }, commands: { type: 'array', description: 'Numbers of the stage\'s commands the scenario rests on.', items: { type: 'integer', minimum: 1, maximum: 10_000 }, maxItems: 50 }, evidenceIds: EVIDENCE_REFS }, ['name', 'result', 'detail']),
      maxItems: 200,
    },
    head: { type: ['string', 'null'], description: 'The commit looked at.', maxLength: 80 },
    commands: {
      type: 'array',
      description: 'The commands the app ran before this pass.',
      items: object('One command.', { command: string('The command as run.', { maxLength: 300 }), exitCode: { type: ['integer', 'null'], description: 'The exit code; null when it did not run to one.' }, timedOut: { type: 'boolean', description: 'It was stopped for taking too long.' }, n: { type: 'integer', description: 'Its number in the stage\'s list (a stage that ran in a sandbox).', minimum: 1, maximum: 10_000 }, by: enumOf('Who ran it, in that case.', ['app', 'agent']), notRun: { type: 'boolean', description: 'It could not be started (not found, not executable): not a result of the code.' } }, ['command', 'exitCode', 'timedOut']),
      maxItems: 200,
    },
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
      limit: string('The question the person gets if this return reaches the limit.', { maxLength: 20_000 }),
    },
    ['kind', 'by', 'text', 'handoff', 'toStage', 'countRound'],
  ),
  type: ['object', 'null'],
} as JsonSchema;

const waitFor = object('What a wait waits for.', { kind: enumOf('The event.', WAIT_KINDS), label: string('For label: the label name.', { maxLength: 200 }), minutes: { type: 'integer', description: 'For time: minutes.', minimum: 1, maximum: 525_600 } }, ['kind']);

const fileNames = { type: 'array', description: 'File names.', items: string('File name.', { pattern: FILE, maxLength: 100 }), maxItems: 50 } as JsonSchema;

const evidenceRecord = object(
  'One piece of evidence a stage kept.',
  {
    id: string('The evidence id.', { pattern: '^ev-\\d{1,6}$', maxLength: 12 }),
    stage: string('The stage that kept it.', { pattern: ID }),
    by: string('The agent that kept it.', { maxLength: 48 }),
    title: string('The title a person reads.', { maxLength: 200 }),
    description: string('An optional short text.', { maxLength: 1000 }),
    name: string('The name the agent gave the file.', { maxLength: 200 }),
    kind: enumOf('The kind, read from the content.', EVIDENCE_KINDS),
    bytes: { type: 'integer', description: 'The size of the file.', minimum: 0 },
    at: time('When it was kept.'),
    from: { type: ['string', 'null'], description: 'The evidence this one was made from.', pattern: '^ev-\\d{1,6}$', maxLength: 12 },
    message: { type: ['integer', 'null'], description: 'The forum message it was published as an attachment of.', minimum: 1 },
    inCycle: { type: 'boolean', description: 'The file was also copied into the cycle folder.' },
  },
  ['id', 'stage', 'by', 'title', 'description', 'name', 'kind', 'bytes', 'at', 'from', 'message'],
);

const flowStage = object(
  'One stage of the flow the run follows, with every default filled in.',
  {
    id: string('Stage id.', { pattern: ID }),
    label: string('Name shown.', { maxLength: 200 }),
    kind: enumOf('What the stage means to the ceremonies.', STAGE_KINDS),
    type: enumOf('work, gate or wait.', STAGE_TYPES),
    agent: { type: ['string', 'null'], description: 'The agent that works it.', pattern: ID },
    autonomous: { type: 'boolean', description: 'Whether that agent was autonomous when the copy was made (the live value is read from the team).' },
    cycleAutonomous: { type: 'boolean', description: 'Whether the run\'s autonomy block had its general switch on when the flow was resolved (the stage starts by itself regardless of the agent).' },
    artifacts: fileNames,
    reads: { ...fileNames, type: ['array', 'null'] },
    next: { type: ['string', 'null'], description: 'The stage that follows; null: the run ends after it.', pattern: ID },
    returnsTo: { type: ['string', 'null'], description: 'Where the work goes back to.', pattern: ID },
    roundLimit: { type: 'integer', description: 'Returns allowed before the run asks the person.', minimum: 1, maximum: 20 },
    waitsFor: { ...waitFor, type: ['object', 'null'] },
    comment: { type: ['string', 'null'], description: 'The comment template key.', maxLength: 48 },
    trackerStatus: { type: ['string', 'null'], description: 'The label the issue gets on entering.', maxLength: 200 },
  },
  // `cycleAutonomous` is not required: a run written before the autonomy block existed reads as having it off (parseRun fills it in).
  ['id', 'label', 'kind', 'type', 'agent', 'autonomous', 'artifacts', 'reads', 'next', 'returnsTo', 'roundLimit', 'waitsFor', 'comment', 'trackerStatus'],
);

const link = object(
  'A run linked to another: one this run asked something of, or the one it was made for.',
  {
    key: string('Unique in the run.', { pattern: ID }),
    role: enumOf('requested: this run asked another squad and waits for it. origin: this run exists because another squad asked.', LINK_ROLES),
    kind: enumOf('A question or a change.', LINK_KINDS),
    squad: { type: ['string', 'null'], description: 'The other squad.', pattern: ID },
    run: { type: ['string', 'null'], description: 'The other run, once it exists.', pattern: RUN_ID.source },
    issue: { type: ['string', 'null'], description: 'The issue of the other run, once it exists.', maxLength: 200 },
    title: string('What was asked, in a line.', { maxLength: 500 }),
    status: enumOf('proposed: the issue waits for a yes. open: the other run is going. done: it ended. refused: it will not exist.', LINK_STATUSES),
    at: time('When.'),
  },
  ['key', 'role', 'kind', 'squad', 'run', 'issue', 'title', 'status', 'at'],
);

const routing = {
  ...object(
    'A run whose squad is not decided yet.',
    {
      candidates: { type: 'array', description: 'The squads the issue may belong to.', items: string('A squad id.', { pattern: ID }), maxItems: 50 },
      why: enumOf('Why the scope rules did not decide: several squads matched, or none.', ROUTING_WHY),
      proposal: {
        ...object('The squad the front-door agent proposed.', { squad: string('A squad id.', { pattern: ID }), by: string('The agent id.', { maxLength: 48 }), reason: string('Why.', { maxLength: 4000 }) }, ['squad', 'by', 'reason']),
        type: ['object', 'null'],
      },
      result: {
        ...object('What the front door produced, held until the squad is chosen.', { by: string('The agent id.', { maxLength: 48 }), summary: string('What it did.', { maxLength: 20_000 }), handoff: string('What the next stage is to do.', { maxLength: 20_000 }), artifacts: fileNames }, ['by', 'summary', 'handoff', 'artifacts']),
        type: ['object', 'null'],
      },
    },
    ['candidates', 'why', 'proposal', 'result'],
  ),
  type: ['object', 'null'],
} as JsonSchema;

const VERSION = '^(?:0|[1-9][0-9]{0,8})\\.(?:0|[1-9][0-9]{0,8})\\.(?:0|[1-9][0-9]{0,8})$';

const activity = object(
  'One pull request of a release, as the run last read it.',
  {
    pr: { type: 'integer', description: 'The pull request number.', minimum: 1 },
    title: string('Title.', { maxLength: 500 }),
    url: string('Web address.', { maxLength: 1000 }),
    head: string('The commit it was at.', { maxLength: 80 }),
    state: enumOf('open, merged or closed.', ['open', 'merged', 'closed']),
    approved: { type: 'boolean', description: 'Approved on the host.' },
    selfReview: { type: 'boolean', description: 'Not approved, but the only maintainer\'s own and ready: merged on their "sim", which stands for the review. Optional.' },
    issue: { type: ['integer', 'null'], description: 'The issue it closes.', minimum: 0 },
  },
  ['pr', 'title', 'url', 'head', 'state', 'approved', 'issue'],
);

const subject = object(
  'What the run is about when it is not one issue: a release of a version.',
  {
    kind: enumOf('The kind of subject.', ['release']),
    version: string('X.Y.Z.', { pattern: VERSION, maxLength: 40 }),
    from: { type: ['string', 'null'], description: 'The stable tag a patch is cut from.', maxLength: 40 },
    tracking: { ...object('The tracking issue on the tracker.', { iid: { type: 'integer', description: 'Its number.', minimum: 1 }, url: nullableString('Web address.'), closed: { type: 'boolean', description: 'The app closed it: the stable version was published.' } }, ['iid', 'url']), type: ['object', 'null'] },
    activities: { type: 'array', description: 'The pull requests of the version, as last read.', items: activity, maxItems: 200 },
    seen: { type: 'object', description: 'The head of each pull request (by number) when the run entered the plan gate: what the person is shown there.', additionalProperties: string('A commit.', { maxLength: 80 }) },
    planned: { type: 'object', description: 'The head of each pull request (by number) when the person accepted the plan.', additionalProperties: string('A commit.', { maxLength: 80 }) },
  },
  ['kind', 'version', 'from', 'tracking', 'activities'],
);

const docsRun = object('What the run is about when it drafts the documentation of its repository.', { mode: enumOf('Whether the documentation is made or brought up to date.', ['create', 'update']) }, ['mode']);

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
      ...object('What the run waits for the person to answer.', { by: string('Agent id or "app".', { maxLength: 48 }), holder: { type: ['string', 'null'], description: 'The agent the question is with now; null: the person.', maxLength: 48 }, hops: { type: 'integer', description: 'How many times it was passed on.', minimum: 0, maximum: 100 }, kind: enumOf('Who raised it.', QUESTION_KINDS), text: string('The question.', { maxLength: 20_000 }), askedAt: time('When.'), stage: string('The stage.', { pattern: ID }) }, ['by', 'kind', 'text', 'askedAt', 'stage']),
      type: ['object', 'null'],
    },
    pending,
    returns: { type: 'object', description: 'How many times each stage sent the work back (review and QA count apart), by that stage, since the person last answered its limit.', additionalProperties: { type: 'integer', minimum: 0, maximum: 1000 } },
    wait: { ...object('What the run waits for.', { kind: enumOf('The event.', WAIT_KINDS), label: string('For label.', { maxLength: 200 }), minutes: { type: 'integer', description: 'For time.', minimum: 1, maximum: 525_600 }, since: time('Since when.'), by: string('The agent that asked.', { maxLength: 48 }), provider: string('For budget: the provider whose key ran out.', { maxLength: 48 }), detail: string('For budget: the reason, with the provider text. For plugin: what the plugin asks for.', { maxLength: 1000 }), plugin: string('For plugin: the plugin whose request waits for the person.', { maxLength: 200 }) }, ['kind', 'since']), type: ['object', 'null'] },
    squad: { type: ['string', 'null'], description: 'The squad the run works in; absent or null: none.', pattern: ID },
    routedBy: { type: ['string', 'null'], description: 'How the run came to be in its squad.', enum: [...ROUTED_BY, null] },
    routing,
    links: { type: 'array', description: 'The runs this one asked something of, and the run it was made for.', items: link, maxItems: 100 },
    flow: object('The flow the run follows: a copy of its stages and its version.', { hash: string('Version of the flow.', { maxLength: 64 }), stages: { type: 'array', description: 'The stages, in order.', items: flowStage, maxItems: 60 } }, ['hash', 'stages']),
    review: { type: 'object', description: 'Superseded by returns; read and dropped.' },
    error: {
      ...object('Why the run is failed.', { code: enumOf('What went wrong.', ['no-agent', 'stage-failed', 'no-event']), stage: string('The stage.', { pattern: ID }), detail: nullableString('Detail.') }, ['code', 'stage', 'detail']),
      type: ['object', 'null'],
    },
    history: { type: 'array', description: 'Every transition, in order.', items: history, maxItems: 1000 },
    comments: { type: 'object', description: 'Tracker comments by stage id, and `pr` for the pull request.', additionalProperties: comment },
    reviews: { type: 'array', description: 'Every review pass with its findings.', items: review, maxItems: 100 },
    qa: { type: 'array', description: 'Every QA pass with its scenarios.', items: qaRecord, maxItems: 100 },
    evidence: { type: 'object', description: 'Every piece of evidence the stages kept, by id. Optional: a run written before evidence existed kept none.', additionalProperties: evidenceRecord },
    base: { type: ['string', 'null'], description: 'The commit the branch was cut from.', maxLength: 80 },
    subject,
    docs: docsRun,
    createdAt: time('When the run started.'),
    updatedAt: time('When it last changed.'),
  },
  ['version', 'rev', 'id', 'issue', 'repo', 'branch', 'worktree', 'cycleFolder', 'cycleId', 'status', 'stage', 'stages', 'question', 'pending', 'error', 'history', 'comments', 'createdAt', 'updatedAt'],
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
  const { review: _superseded, ...run } = raw as Run & { review?: unknown };
  const flow = run.flow && { ...run.flow, stages: run.flow.stages.map((st) => ({ ...st, cycleAutonomous: st.cycleAutonomous ?? false })) };
  return { ok: true, run: { ...run, ...(flow ? { flow } : {}), reviews: run.reviews ?? [], qa: run.qa ?? [], base: run.base ?? null, returns: run.returns ?? {}, wait: run.wait ?? null } };
}
