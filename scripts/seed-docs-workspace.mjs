// Usage: node scripts/seed-docs-workspace.mjs <empty folder>
//
// Writes a complete fictional workspace into the folder given on the command line, the way the app reads it: the registry, the
// workspace folder with a `config.json` at the schema version the running app knows, runs, the board, a conversation, learned
// procedures, the minutes of a day and a paired phone. Every name, host and number is a neutral placeholder (`example.com`,
// `group/project`, `#123`), and nothing is written outside the folder.
//
// The seed is a documentation tool: it exists so the capture scripts can open the app on data that is not the person's. It refuses
// to write into a folder that already holds a workspace, and it never touches the app's own data folder.
//
// Dates are relative to a fixed day, so two runs of the capture see the same screens; the capture fakes the clock.
//
// The workspace is written in the shape the app reads (the registry, runs/<id>.json, board.json, forum/<thread>.jsonl and
// memory/procedures/<id>.json), and the `config.json` is the neutral configuration of the app, read from its own source with
// esbuild (a dependency of the app) so a schema bump cannot leave the seed behind. The two run files follow the run format the
// store validates (`parseRun`), so the app opens them without a repair.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The day the workspace's dates hang from: a Monday, so the ceremonies of a week read from it. */
export const FIXED_DAY = '2026-06-15T09:40:00.000Z';
export const WORKSPACE_ID = 'docs';
export const WORKSPACE_NAME = 'Documentação';
export const REPO_ID = 'docs';
export const ISSUE_PROJECT = 'group/project';

// The card ids double as the screen's references (`#<id>`), so they read as the neutral placeholder `#123`; the host's own
// iids are the same numbers, and the references the screens build from the cycle prefix stay neutral too.
const CARD_TODAY = 123;
const CARD_SEARCH = 124;
const CARD_TOKEN = 125;
const REF_PREFIX = 'docs#';
/** The id of the ceremony of the fixed day, in the shape the app validates (`YYYY-MM-DDTHHMMSS`). */
const CEREMONY_ID = '2026-06-15T094000';

/** Reads a source file of the repository as text (it has to read TypeScript, which Node cannot import). */
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** The schema version of the app, read from its own source so the seed cannot be left behind by a bump. */
export function schemaVersion() {
  const m = /CONFIG_SCHEMA_VERSION\s*=\s*(\d+)/.exec(source('src/shared/config/types.ts'));
  if (!m) throw new Error('the seed cannot read CONFIG_SCHEMA_VERSION: the source moved');
  return Number(m[1]);
}

/**
 * The neutral configuration of the app, read from its own source: esbuild compiles the module (and its own imports) and the
 * result is evaluated once, in memory, so the seed never has to know what the defaults are. Nothing of it is written.
 */
let neutralCache = null;
function neutralConfigSync() {
  if (neutralCache) return structuredClone(neutralCache);
  const compiled = buildSync({
    stdin: { contents: `export { neutralConfig } from ${JSON.stringify(join(ROOT, 'src/shared/config/defaults.ts'))};`, loader: 'ts', resolveDir: ROOT },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    write: false,
  }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, () => {
    throw new Error('the seed cannot resolve a module while reading the defaults of the app');
  });
  const made = mod.exports.neutralConfig;
  if (typeof made !== 'function') throw new Error('the seed cannot read the neutral configuration of the app (src/shared/config/defaults.ts)');
  neutralCache = made();
  return structuredClone(neutralCache);
}

const at = (hours, minutes = 0) => new Date(Date.parse(FIXED_DAY) + hours * 3600_000 + minutes * 60_000).toISOString();

const TEAM = [
  { id: 'support', name: 'Support', job: 'Reads the report as it came and checks it against the related work.', stages: ['triage'], permission: 'read', tracker: 'read', shell: 'none', autonomous: false, turnsTo: null, instructions: 'Read the issue, name what is missing and, when it is a duplicate, say which one.' },
  { id: 'product-owner', name: 'Product owner', job: 'Decides what the product does and writes the spec.', stages: ['refine'], permission: 'read', tracker: 'read', shell: 'none', autonomous: false, turnsTo: null, instructions: 'Write the spec from the issue and the code as it is, and say what is out of scope.' },
  { id: 'tech-lead', name: 'Tech lead', job: 'Plans the change and reviews it before it is tested.', stages: ['plan', 'review'], permission: 'read', tracker: 'read', shell: 'none', autonomous: false, turnsTo: 'product-owner', instructions: 'Plan from the spec; review the implementation against it and report findings by severity.' },
  { id: 'developer', name: 'Developer', job: 'Writes the code of the planned change, in the run\'s worktree.', stages: ['implement'], permission: 'worktree', tracker: 'none', shell: 'sandbox', autonomous: false, turnsTo: 'tech-lead', instructions: 'Follow the plan, keep the change small and run the checks before reporting.' },
  { id: 'qa', name: 'QA', job: 'Checks the change against the spec and the interfaces it touches.', stages: ['qa'], permission: 'read', tracker: 'none', shell: 'sandbox', autonomous: false, turnsTo: 'tech-lead', instructions: 'Run the scenarios of the plan and report each one as pass, fail or not-run.' },
];

/** The fictional workspace: a fake host, the team of the example, the days and the phone. */
function config(root) {
  const c = neutralConfigSync();
  c.schemaVersion = schemaVersion();
  c.language = 'pt-BR';
  // The setup assistant is behind us: the seeded workspace opens on the day and not on the first-run wizard.
  c.setupComplete = true;
  // Every default the seed does not care about is written as it is; the repository path is the seed's own, never the machine's.
  c.projects.repos = [{ id: REPO_ID, path: join(root, 'repos', REPO_ID), remoteUrl: `https://example.com/${ISSUE_PROJECT}.git`, vcsId: null, projectPath: ISSUE_PROJECT }];
  c.projects.issues = { vcsId: null, project: ISSUE_PROJECT, projectId: null, refPrefix: REF_PREFIX, cardScope: 'assigned', cardLabels: [] };
  // The host kind is only ever a vocabulary the app draws labels from, and the real ones carry their company's name into the
  // picture: a fake host keeps the screens neutral. The workspace has no integration, so no command is ever sent anywhere.
  c.vcs = [];
  c.agents.team = TEAM.map((a) => ({ ...a, model: { role: 'deep' } }));
  // The workspace's own flow: the same stages the two runs carry, so the team's stages and the flow agree.
  c.devCycle = { ...c.devCycle, stages: FLOW_STAGES, templateId: 'agent-flow', flows: {} };
  // How the team names its daily preparation. The label is a text of the app's catalogs, and its translation for "preparation"
  // is the first meaning a Portuguese reader reads: the seeded workspace says it in words of its own, in its own language.
  c.devCycle.ceremonyParams = { ...c.devCycle.ceremonyParams, preDaily: { ...c.devCycle.ceremonyParams.preDaily, label: 'Abertura do dia' } };
  c.runner = { ...c.runner, procedures: true, worktreesDir: null, identity: { name: 'Aurora Docs', email: 'docs@example.com' } };
  return c;
}

const RUN_ONE = 'r-a1b2c3-first';
const RUN_TWO = 'r-d4e5f6-second';

/** The stages of the flow the workspace follows: the ones the runs carry and the ones the team's agents work. */
const FLOW_STAGES = [
  { id: 'triage', label: 'Triage', match: ['^Triage'], kind: 'backlog', rank: 1, type: 'work', agentId: 'support', produces: ['0_TRIAGE.md'] },
  { id: 'refine', label: 'Refine', match: ['^Refin'], kind: 'backlog', rank: 2, type: 'work', agentId: 'product-owner', produces: ['1_SPEC.md'] },
  { id: 'plan', label: 'Plan', match: ['^Plan'], kind: 'development', rank: 3, type: 'work', agentId: 'tech-lead', produces: ['2_PLAN.md'] },
  { id: 'gate2', label: 'Gate 2', match: ['^Gate 2$'], kind: 'development', rank: 4, type: 'gate' },
  { id: 'implement', label: 'Implement', match: ['^Implement'], kind: 'development', rank: 5, type: 'work', agentId: 'developer', produces: ['3_IMPLEMENTATION.md'] },
  { id: 'review', label: 'Review', match: ['^Review'], kind: 'review', rank: 6, type: 'work', agentId: 'tech-lead', produces: ['4_REVIEW.md'], returnsTo: 'implement', roundLimit: 2 },
  { id: 'qa', label: 'QA', match: ['^QA$'], kind: 'qa', rank: 7, type: 'work', agentId: 'qa', produces: ['5_TEST_PLAN.md'], returnsTo: 'implement', roundLimit: 2 },
  { id: 'ready', label: 'Ready', match: ['^Ready$'], kind: 'reviewApproved', rank: 8, type: 'wait', waitsFor: { kind: 'pr-merged' } },
];

/** The steps the board's columns are keyed by; the app reads them back with `s.stage ?? s.id`. */
const COLUMN_STAGES = [
  { stage: 'triage', agent: 'support', status: 'done', artifacts: ['0_TRIAGE.md'], startedAt: at(0), endedAt: at(0, 4), attempts: 1, autonomous: false },
  { stage: 'refine', agent: 'product-owner', status: 'done', artifacts: ['1_SPEC.md'], startedAt: at(0, 5), endedAt: at(0, 18), attempts: 1, autonomous: false },
  { stage: 'plan', agent: 'tech-lead', status: 'done', artifacts: ['2_PLAN.md'], startedAt: at(1), endedAt: at(1, 12), attempts: 1, autonomous: false },
  { stage: 'gate2', agent: null, status: 'waiting', artifacts: [], startedAt: at(1, 13), endedAt: null, attempts: 1, autonomous: false },
];

/** The two runs: one that went through the cycle with its documents and its evidence, one held at the second gate. */
function runs(id) {
  const flowStages = [
    { id: 'triage', label: 'Triage', kind: 'backlog', type: 'work', agent: 'support', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['0_TRIAGE.md'], reads: null, next: 'refine', returnsTo: null, roundLimit: 2, waitsFor: null, comment: 'triage', trackerStatus: null },
    { id: 'refine', label: 'Refine', kind: 'backlog', type: 'work', agent: 'product-owner', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['1_SPEC.md'], reads: null, next: 'plan', returnsTo: null, roundLimit: 2, waitsFor: null, comment: 'refine', trackerStatus: null },
    { id: 'plan', label: 'Plan', kind: 'development', type: 'work', agent: 'tech-lead', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['2_PLAN.md'], reads: null, next: 'gate2', returnsTo: null, roundLimit: 2, waitsFor: null, comment: 'plan', trackerStatus: null },
    { id: 'gate2', label: 'Gate 2', kind: 'development', type: 'gate', agent: null, autonomous: false, cycleAutonomous: false, display: false, artifacts: [], reads: null, next: 'implement', returnsTo: null, roundLimit: 2, waitsFor: null, comment: null, trackerStatus: null },
    { id: 'implement', label: 'Implement', kind: 'development', type: 'work', agent: 'developer', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['3_IMPLEMENTATION.md'], reads: null, next: 'review', returnsTo: null, roundLimit: 2, waitsFor: null, comment: 'implement', trackerStatus: null },
    { id: 'review', label: 'Review', kind: 'review', type: 'work', agent: 'tech-lead', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['4_REVIEW.md'], reads: null, next: 'qa', returnsTo: 'implement', roundLimit: 2, waitsFor: null, comment: 'review', trackerStatus: null },
    { id: 'qa', label: 'QA', kind: 'qa', type: 'work', agent: 'qa', autonomous: false, cycleAutonomous: false, display: false, artifacts: ['5_TEST_PLAN.md'], reads: null, next: 'ready', returnsTo: 'implement', roundLimit: 2, waitsFor: null, comment: 'qa', trackerStatus: null },
    { id: 'ready', label: 'Ready', kind: 'reviewApproved', type: 'wait', agent: null, autonomous: false, cycleAutonomous: false, display: false, artifacts: [], reads: null, next: null, returnsTo: null, roundLimit: 2, waitsFor: { kind: 'pr-merged' }, comment: null, trackerStatus: null },
  ];
  const flow = { hash: 'a1b2c3d4', stages: flowStages };
  const folder = (iid, title) => `docs/cycles/${iid}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const issue = (iid, title) => ({ ref: `${REF_PREFIX}${iid}`, iid, title, url: `https://example.com/${ISSUE_PROJECT}/issues/${iid}` });

  const first = {
    version: 3,
    rev: 12,
    id: RUN_ONE,
    issue: issue(CARD_TODAY, 'Show the queue of activities of the day'),
    repo: REPO_ID,
    branch: `cycle/${CARD_TODAY}-show-the-queue-of-activities`,
    worktree: join(id, 'worktrees', REPO_ID, String(CARD_TODAY)),
    cycleFolder: folder(CARD_TODAY, 'Show the queue of activities of the day'),
    cycleId: 'agent-flow',
    status: 'done',
    stage: 'ready',
    stages: [
      { stage: 'triage', agent: 'support', status: 'done', artifacts: ['0_TRIAGE.md'], startedAt: at(0), endedAt: at(0, 4), attempts: 1, autonomous: false },
      { stage: 'refine', agent: 'product-owner', status: 'done', artifacts: ['1_SPEC.md'], startedAt: at(0, 5), endedAt: at(0, 18), attempts: 1, autonomous: false },
      { stage: 'plan', agent: 'tech-lead', status: 'done', artifacts: ['2_PLAN.md'], startedAt: at(1), endedAt: at(1, 12), attempts: 1, autonomous: false },
      { stage: 'gate2', agent: null, status: 'done', artifacts: [], startedAt: at(1, 13), endedAt: at(1, 20), attempts: 1, autonomous: false },
      { stage: 'implement', agent: 'developer', status: 'done', artifacts: ['3_IMPLEMENTATION.md'], startedAt: at(2), endedAt: at(2, 40), attempts: 1, autonomous: false },
      { stage: 'qa', agent: 'qa', status: 'done', artifacts: ['5_TEST_PLAN.md'], startedAt: at(3), endedAt: at(3, 22), attempts: 1, autonomous: false },
      { stage: 'ready', agent: null, status: 'done', artifacts: [], startedAt: at(3, 23), endedAt: at(4), attempts: 1, autonomous: false },
    ],
    question: null,
    pending: null,
    returns: {},
    wait: null,
    flow,
    error: null,
    history: [
      { at: at(0), type: 'started', stage: null, by: 'person', detail: null },
      { at: at(0), type: 'stage-started', stage: 'triage', by: 'app', detail: null },
      { at: at(0, 4), type: 'stage-done', stage: 'triage', by: 'support', detail: 'The report is clear enough to refine.' },
      { at: at(0, 18), type: 'stage-done', stage: 'refine', by: 'product-owner', detail: 'Spec written.' },
      { at: at(1, 12), type: 'stage-done', stage: 'plan', by: 'tech-lead', detail: 'Plan written.' },
      { at: at(1, 20), type: 'gate-approved', stage: 'gate2', by: 'person', detail: null },
      { at: at(2, 40), type: 'stage-done', stage: 'implement', by: 'developer', detail: 'Implemented and checked.' },
      { at: at(3, 22), type: 'stage-done', stage: 'qa', by: 'qa', detail: 'Both scenarios pass.' },
      { at: at(4), type: 'stage-done', stage: 'ready', by: 'app', detail: null },
      { at: at(5), type: 'completed', stage: null, by: 'app', detail: null },
    ],
    comments: {},
    reviews: [],
    qa: [{ stage: 'qa', by: 'qa', at: at(3, 20), head: '0000000000000000000000000000000000000002', summary: 'Both scenarios pass and the queue is listed in the order of the day.', commands: [{ command: 'npm test', exitCode: 0, timedOut: false, n: 1, by: 'app' }], scenarios: [{ name: 'The queue lists the activities of the day in order', result: 'pass', severity: 'blocking', evidence: 'executed', detail: 'The first activity is the one with the earliest time.' }, { name: 'An activity with no time is listed last', result: 'pass', severity: 'non-blocking', evidence: 'read', detail: 'Read in the source of the list.' }] }],
    evidence: { 'ev-1': { id: 'ev-1', stage: 'qa', by: 'qa', title: 'The queue as the scenario saw it', description: 'Fictional data, taken from this workspace.', name: 'queue.png', kind: 'png', bytes: 20481, at: at(3, 21), from: null, message: null, inCycle: false } },
    base: '0000000000000000000000000000000000000001',
    baseBranch: 'main',
    createdAt: at(0),
    updatedAt: at(5),
  };

  const second = {
    version: 3,
    rev: 4,
    id: RUN_TWO,
    issue: issue(CARD_SEARCH, 'Search the actions the person already answered'),
    repo: REPO_ID,
    branch: `cycle/${CARD_SEARCH}-search-the-actions`,
    worktree: join(id, 'worktrees', REPO_ID, String(CARD_SEARCH)),
    cycleFolder: folder(CARD_SEARCH, 'Search the actions the person already answered'),
    cycleId: 'agent-flow',
    status: 'gate',
    stage: 'gate2',
    stages: COLUMN_STAGES,
    question: null,
    pending: null,
    returns: {},
    wait: null,
    flow,
    error: null,
    history: [
      { at: at(26), type: 'started', stage: null, by: 'person', detail: null },
      { at: at(26), type: 'stage-started', stage: 'triage', by: 'app', detail: null },
      { at: at(26, 6), type: 'stage-done', stage: 'triage', by: 'support', detail: 'Clear.' },
      { at: at(27, 20), type: 'stage-done', stage: 'refine', by: 'product-owner', detail: 'Spec written.' },
      { at: at(28, 15), type: 'stage-done', stage: 'plan', by: 'tech-lead', detail: 'Plan written.' },
      { at: at(28, 16), type: 'stage-started', stage: 'gate2', by: 'app', detail: null },
    ],
    comments: {},
    reviews: [],
    qa: [],
    base: '0000000000000000000000000000000000000001',
    baseBranch: 'main',
    createdAt: at(26),
    updatedAt: at(28, 16),
  };
  return [first, second];
}

/** Three activities on the board of the fake host, in the states of a day (the shape the board store reads). */
const board = () => ({
  version: 1,
  cards: [
    {
      id: String(CARD_TODAY),
      title: 'Show the queue of activities of the day',
      body: 'The day lists the activities in the order of the morning.',
      column: 'ready',
      squad: null,
      priority: null,
      labels: ['coxia'],
      repo: REPO_ID,
      state: 'closed',
      createdAt: at(0),
      updatedAt: at(5),
      history: [{ at: at(5), what: 'ready' }],
      host: { vcs: 'host', project: ISSUE_PROJECT, iid: CARD_TODAY, url: `https://example.com/${ISSUE_PROJECT}/issues/${CARD_TODAY}` },
    },
    {
      id: String(CARD_SEARCH),
      title: 'Search the actions the person already answered',
      body: 'A filter over the actions queue, by the answer the person gave.',
      column: 'gate2',
      squad: null,
      priority: null,
      labels: ['coxia'],
      repo: REPO_ID,
      state: 'open',
      createdAt: at(26),
      updatedAt: at(28, 16),
      history: [{ at: at(28, 16), what: 'gate2' }],
      host: { vcs: 'host', project: ISSUE_PROJECT, iid: CARD_SEARCH, url: `https://example.com/${ISSUE_PROJECT}/issues/${CARD_SEARCH}` },
    },
    {
      id: String(CARD_TOKEN),
      title: 'Say which token the host refused',
      body: 'The reporter cannot read the log, so the app should say which token it refused.',
      column: 'refine',
      squad: null,
      priority: null,
      labels: [],
      repo: REPO_ID,
      state: 'open',
      createdAt: at(30),
      updatedAt: at(30),
      history: [{ at: at(30), what: 'refine' }],
      host: { vcs: 'host', project: ISSUE_PROJECT, iid: CARD_TOKEN, url: `https://example.com/${ISSUE_PROJECT}/issues/${CARD_TOKEN}` },
    },
  ],
});

/** One action waiting for the person: a comment the app proposes on the fake host, with its exact command. */
const actions = () => ({
  releaseSeen: null,
  actions: [
    {
      id: 'a1b2c3d4',
      key: `comment:${CARD_SEARCH}`,
      kind: 'comment',
      issue: CARD_SEARCH,
      issueTitle: 'Search the actions the person already answered',
      stage: 'refine',
      release: null,
      mrs: [],
      files: [],
      retest: false,
      state: 'pending',
      createdAt: at(28, 20),
      finishedAt: null,
      output: null,
      noteId: null,
      currentBody: null,
      proposedBody: 'The spec is ready and the plan is waiting for your yes.',
      sessionId: null,
      msgs: [],
      unit: null,
      summary: `Comment on ${REF_PREFIX}${CARD_SEARCH}`,
      command: { kind: 'comment', iid: CARD_SEARCH, body: 'The spec is ready and the plan is waiting for your yes.' },
    },
  ],
});

/** The conversation of a ceremony with one step held and its recording kept. */
function conversation() {
  const thread = 'call-aurora';
  return {
    header: { v: 1, type: 'header', id: thread, kind: 'call', title: 'Pre-daily of 2026-06-15', at: at(0), ref: null, stage: null, closed: false },
    messages: [
      { v: 1, type: 'message', seq: 1, thread, at: at(0), kind: 'system', author: { type: 'app' }, text: '', code: 'call.started', params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null },
      { v: 1, type: 'message', seq: 2, thread, at: at(0, 1), kind: 'post', author: { type: 'agent', id: 'support' }, text: `Two activities are open: the search of the answered actions (#${CARD_SEARCH}) is at its second gate, and the report about the refused token (#${CARD_TOKEN}) has no owner.`, code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null },
      { v: 1, type: 'message', seq: 3, thread, at: at(0, 2), kind: 'post', author: { type: 'person' }, text: `Put #${CARD_TOKEN} with me and let us look at #${CARD_SEARCH} first.`, code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null },
      { v: 1, type: 'message', seq: 4, thread, at: at(0, 3), kind: 'handoff', author: { type: 'agent', id: 'support' }, text: `Open the board and move #${CARD_TOKEN} to the person.`, code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: 'person' },
    ],
  };
}

/** The activities of the seeded day, by number: the same card serves the board, the ceremony and the turns' fingerprints. */
const CARD_TITLES = { [CARD_SEARCH]: ['Search the actions the person already answered', 'gate2'], [CARD_TOKEN]: ['Say which token the host refused', 'refine'], [CARD_TODAY]: ['Show the queue of activities of the day', 'ready'] };

/** The stage label a card of the ceremony shows, by the column of the board it sits in. */
const STAGE_LABELS = { gate2: 'Gate 2', refine: 'Refine', ready: 'Ready' };

/** One card of the ceremony, in the shape the app's agenda holds (`Card`). */
function ceremonyCard(n, stage = CARD_TITLES[n][1]) {
  return {
    ref: `${REF_PREFIX}${n}`,
    iid: String(n),
    title: CARD_TITLES[n][0],
    stage: STAGE_LABELS[stage] ?? null,
    spec: null,
    mrs: [],
    mrPaths: [],
    blockers: [],
    pending: [],
    changes: [],
    note: null,
    url: `https://example.com/${ISSUE_PROJECT}/issues/${n}`,
    labels: [],
    updatedAt: at(2),
    project: ISSUE_PROJECT,
  };
}

/**
 * The fingerprint the app gives a card (`fingerprint`, src/main/falas-core.ts), with no spec folder behind it. A turn saved under
 * the same fingerprint within the last days is served again without calling an agent, which is how a capture shows a ceremony
 * with its turns while running no model.
 */
function cardFingerprint(card) {
  const sorted = (xs) => [...xs].sort();
  const body = { v: 1, stage: card.stage, blockers: sorted(card.blockers), pending: sorted(card.pending), mrs: sorted(card.mrs), changes: sorted(card.changes), note: card.note, phase: null, artifacts: [] };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 24);
}

/** The turns the agents prepared the day before, kept by fingerprint: what the app serves again instead of asking a model. */
function savedTurns() {
  const turns = {};
  for (const n of [CARD_SEARCH, CARD_TOKEN]) {
    const card = ceremonyCard(n);
    turns[card.ref] = { fp: cardFingerprint(card), turn: ceremonyTurn(card.ref), at: at(-24) };
  }
  return { version: 1, turns, reuses: [] };
}

/** One agent turn of the ceremony, with the sources it read: what the screen shows next to the card. */
function ceremonyTurn(ref, n = Number(String(ref).replace(/\D+/g, ''))) {
  const search = n === CARD_SEARCH;
  return {
    ref,
    sessionId: null,
    speech: search
      ? 'The filter over the answered actions is written and tested; what is left is the second gate, and the spec says which answers the filter may see.'
      : n === CARD_TOKEN
        ? 'The report has no owner yet: the app says the command was refused but not which token the host refused.'
        : 'The queue of the day shipped and the activity is closed.',
    did: search ? 'Ordered the actions by the answer the person gave, in the list of the day.' : n === CARD_TOKEN ? 'Read the report and the command that answers it.' : 'Shipped the list of the day.',
    next: search ? 'Read the spec and say whether the filter may show an action of another squad.' : n === CARD_TOKEN ? 'Say who takes the report before the end of the day.' : 'Nothing left.',
    blocker: n === CARD_TOKEN ? 'Carries two open questions and no decision yet.' : null,
    question: null,
    sources: search
      ? ['docs/cycles/218-search-the-actions/1_SPEC.md', 'src/renderer/src/screens/Actions.tsx']
      : n === CARD_TOKEN
        ? ['docs/cycles/219-refused-token/1_SPEC.md']
        : ['src/renderer/src/screens/Today.tsx'],
  };
}

/**
 * The ceremony in progress of the seeded day: its own file (`historico/`), read by the app on start as the state of today.
 * The cards carry their prepared turns, so the screen draws a ceremony that is going on — the agenda and the agent's own
 * reading of it — next to the state of the app's own data folder and not a ceremony whose agent failed for want of a key.
 */
function ceremony(id) {
  const cards = [ceremonyCard(CARD_SEARCH), ceremonyCard(CARD_TOKEN)];
  const refOf = (n) => `${REF_PREFIX}${n}`;
  return {
    version: 1,
    id,
    kind: 'pre-daily',
    date: id.slice(0, 10),
    cards: { generatedAt: at(0), total: cards.length, cards },
    turns: { [refOf(CARD_SEARCH)]: ceremonyTurn(refOf(CARD_SEARCH)), [refOf(CARD_TOKEN)]: ceremonyTurn(refOf(CARD_TOKEN)) },
    decisions: [],
    effects: [],
    answered: {},
    // `at` is the time into the call (`m:ss`), the way the app writes a line of the transcript.
    log: [
      { who: 'Moderador', text: 'Pre-daily of 2026-06-15, with two activities on the table.', at: '0:00', color: 'ink' },
      { who: 'Support', text: 'Two activities are open: the search of the answered actions is at its second gate, and the report about the refused token has no owner.', at: '0:01', color: 'blue' },
      { who: 'Você', text: 'Put the report with me and let us look at the search first.', at: '0:02', color: 'amber' },
    ],
    startedAt: Date.parse(at(0)),
    endedAt: null,
    callIdx: 0,
    callEnded: false,
    spoken: {},
    deep: {},
    teams: null,
    teamsKey: null,
    saveResult: null,
  };
}

/** The learned procedures of the workspace: one verified, one waiting for review and one that failed. */
function procedures() {
  const step = (text, run) => (run ? { text, run } : { text });
  const origin = (by, at, extra = {}) => ({ by, createdBy: by, surface: 'stage', ...extra, at });
  const record = (id, key, title, kind, steps, extra) => ({
    v: 1,
    id,
    revision: extra.revision,
    kind,
    key,
    title,
    steps,
    pitfalls: [],
    waits: [],
    state: extra.state,
    lastVerified: extra.lastVerified,
    lastFailed: extra.lastFailed ?? null,
    stats: { uses: extra.uses, failures: extra.failures, failuresSinceSave: extra.failuresSinceSave ?? 0, lastUsed: extra.lastUsed ?? null, baseline: null, recent: [] },
    origin: extra.origin,
    stepsFrom: extra.stepsFrom ?? 'agent',
    reviewed: extra.reviewed ?? true,
    previous: null,
  });
  return [
    record('p-1a2b3c4d', 'example.com', 'Open a pull request from a run branch', 'gui', [step('Open the run screen', 'button "Run"'), step('Choose the branch of the run'), step('Write the title of the pull request'), step('Confirm the push in Actions')], { revision: 3, state: 'ok', lastVerified: at(24), uses: 5, failures: 0, lastUsed: at(24), origin: origin('developer', at(0), { stage: 'implement' }), stepsFrom: 'edited' }),
    record('p-5e6f7a8b', 'coxia', 'Run the repository test suite in the QA sandbox', 'repo', [step('Point the data folder at an empty one', 'CERIMONIAS_DATA_DIR=<value> npm test'), step('Run the suite'), step('Read the failures one by one')], { revision: 2, state: 'unverified', lastVerified: null, uses: 0, failures: 0, origin: origin('qa', at(3), { stage: 'qa', handoff: true }), reviewed: false, stepsFrom: 'agent' }),
    record('p-9c0d1e2f', 'example.com', 'Upload a release file to the host', 'tool', [step('Build the package'), step('Open the host page of the release'), step('Attach the package'), step('Publish the draft')], { revision: 1, state: 'failing', lastVerified: at(-120), uses: 4, failures: 2, failuresSinceSave: 2, lastUsed: at(-12), lastFailed: { at: at(-12), step: 3 }, origin: origin('release-manager', at(-240), { stage: 'release-beta' }) }),
  ];
}

/** The marker a reference is written with. */
export const REF_MARK = '#';

/** The token the seeded phone is signed in with. */
export const PHONE_TOKEN = `docs-phone-${WORKSPACE_ID}-token`;

/** Whether the folder already holds a workspace: the seed never writes over one. */
function holdsWorkspace(dir) {
  if (!existsSync(dir)) return false;
  if (existsSync(join(dir, 'workspaces.json'))) return true;
  if (existsSync(join(dir, 'config.json'))) return true;
  const at = /^\d{4}-\d{2}-\d{2}-pre-daily\.md$/;
  return readdirSync(dir).some((n) => ['historico', 'atividade', 'gates', 'qa', 'retros', 'feedback', 'conflicts', 'workspaces'].includes(n) || at.test(n));
}

const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
};
const json = (file, value) => write(file, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Writes the workspace into `dir`. Refuses a folder that already holds one (with a message) and refuses an empty folder that is the
 * app's own data folder; returns the list of what it wrote, for the message and the test.
 */
export async function seedDocsWorkspace(dir) {
  const root = resolve(dir);
  if (!dir || !String(dir).trim()) throw new Error('the seed needs the folder to write into: node scripts/seed-docs-workspace.mjs <folder>');
  const appData = process.env.CERIMONIAS_DATA_DIR;
  if (appData && resolve(appData) === root) throw new Error(`refusing to write into the app's own data folder (${root}); give the seed a throwaway folder`);
  if (holdsWorkspace(root)) throw new Error(`refusing to write into ${root}: it already holds a workspace`);
  const id = join(root, 'workspaces', WORKSPACE_ID);
  mkdirSync(id, { recursive: true });
  const written = [];
  const listed = (rel) => `workspaces/${WORKSPACE_ID}/${rel}`;
  json(join(root, 'workspaces.json'), { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: WORKSPACE_NAME, createdAt: at(0), test: false }] });
  written.push('workspaces.json', listed('config.json'));
  json(join(id, 'config.json'), config(root));
  for (const run of runs(id)) json(join(id, 'runs', `${run.id}.json`), run);
  written.push(listed(`runs/${RUN_ONE}.json`), listed(`runs/${RUN_TWO}.json`));
  json(join(id, 'board.json'), board());
  json(join(id, 'acoes.json'), actions());
  written.push(listed('board.json'), listed('acoes.json'));
  const call = conversation();
  write(join(id, 'forum', `${call.header.id}.jsonl`), [call.header, ...call.messages].map((line) => JSON.stringify(line)).join('\n'));
  written.push(listed(`forum/${call.header.id}.jsonl`));
  // The ceremony in progress of the day: the app reads the newest file of `historico/` of today as the state to resume.
  json(join(id, 'historico', `${CEREMONY_ID}.json`), ceremony(CEREMONY_ID));
  written.push(listed(`historico/${CEREMONY_ID}.json`));
  write(join(id, 'falas.json'), JSON.stringify(savedTurns()));
  written.push(listed('falas.json'));
  for (const p of procedures()) json(join(id, 'memory', 'procedures', `${p.id}.json`), p);
  written.push(listed('memory/procedures/p-1a2b3c4d.json'), listed('memory/procedures/p-5e6f7a8b.json'), listed('memory/procedures/p-9c0d1e2f.json'));
  write(join(root, '2026-06-15-pre-daily.md'), ['# Pre-daily of 2026-06-15', '', `- The search of the answered actions (#${CARD_SEARCH}) is at its second gate.`, `- The report about the refused token (#${CARD_TOKEN}) has no owner.`, `- One activity shipped: ${REF_PREFIX}${CARD_TODAY}, the queue of the day.`].join('\n'));
  written.push('2026-06-15-pre-daily.md');
  json(join(root, 'web.json'), { enabled: true, host: '127.0.0.1', port: 4330, basePath: '/cerimonias/', publicUrl: 'http://127.0.0.1:4330/cerimonias/', trustedProxy: '127.0.0.1/32', allowExternalEffects: false });
  written.push('web.json');
  // The session of the paired phone lives in the data root, shared by every workspace, and its token is written only as a
  // hash — the same place the app keeps it. The browser mode reads this same root, so the phone capture opens the seeded
  // workspace itself and never the person's.
  write(join(root, 'web-sessions.json'), JSON.stringify({ sessions: [{ id: 'phone-docs', name: 'Phone of the docs workspace', createdAt: at(-48), lastSeenAt: at(0), tokenHash: createHash('sha256').update(PHONE_TOKEN).digest('hex'), expiresAt: Number.MAX_SAFE_INTEGER }] }));
  written.push('web-sessions.json');
  return written;
}

async function main(argv) {
  const dir = argv.find((a) => !a.startsWith('-'));
  if (!dir) {
    console.error('usage: node scripts/seed-docs-workspace.mjs <folder>');
    return 2;
  }
  try {
    const written = await seedDocsWorkspace(dir);
    console.log(`seed-docs-workspace: wrote ${written.length} file(s) into ${resolve(dir)}`);
    console.log('point CERIMONIAS_DATA_DIR (and CERIMONIAS_SPECS_DIR) at that folder to open it.');
    return 0;
  } catch (e) {
    console.error(`seed-docs-workspace: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
