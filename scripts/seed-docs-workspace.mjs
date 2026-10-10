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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The day the workspace's dates hang from: a Saturday, so the ceremonies of a week read from it. */
export const FIXED_DAY = '2026-06-15T09:40:00.000Z';
export const WORKSPACE_ID = 'principal';
export const WORKSPACE_NAME = 'Aurora';
export const REPO_ID = 'app';
export const ISSUE_PROJECT = 'group/project';

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
  c.projects.repos = [{ id: REPO_ID, path: join(root, 'repos', REPO_ID), remoteUrl: 'https://example.com/group/project.git', vcsId: 'host', projectPath: ISSUE_PROJECT }];
  c.projects.issues = { vcsId: 'host', project: ISSUE_PROJECT, projectId: null, refPrefix: 'app#', cardScope: 'assigned', cardLabels: [] };
  c.vcs = [{ id: 'host', kind: 'github', host: 'example.com', apiUrl: '', user: 'ana', secretRef: 'host.token', cliPreference: 'api', cliCommand: null }];
  c.agents.team = TEAM.map((a) => ({ ...a, model: { role: 'deep' } }));
  // The workspace's own flow: the same stages the two runs carry, so the team's stages and the flow agree.
  c.devCycle = { ...c.devCycle, stages: FLOW_STAGES, templateId: 'agent-flow', flows: {} };
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
  const issue = (iid, title) => ({ ref: `app#${iid}`, iid, title, url: `https://example.com/group/project/issues/${iid}` });

  const first = {
    version: 3,
    rev: 12,
    id: RUN_ONE,
    issue: issue(101, 'Show the queue of activities of the day'),
    repo: REPO_ID,
    branch: 'cycle/101-show-the-queue-of-activities',
    worktree: join(id, 'worktrees', REPO_ID, '101'),
    cycleFolder: folder(101, 'Show the queue of activities of the day'),
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
    issue: issue(102, 'Search the actions the person already answered'),
    repo: REPO_ID,
    branch: 'cycle/102-search-the-actions',
    worktree: join(id, 'worktrees', REPO_ID, '102'),
    cycleFolder: folder(102, 'Search the actions the person already answered'),
    cycleId: 'agent-flow',
    status: 'gate',
    stage: 'gate2',
    stages: [
      { stage: 'triage', agent: 'support', status: 'done', artifacts: ['0_TRIAGE.md'], startedAt: at(26), endedAt: at(26, 6), attempts: 1, autonomous: false },
      { stage: 'refine', agent: 'product-owner', status: 'done', artifacts: ['1_SPEC.md'], startedAt: at(27), endedAt: at(27, 20), attempts: 1, autonomous: false },
      { stage: 'plan', agent: 'tech-lead', status: 'done', artifacts: ['2_PLAN.md'], startedAt: at(28), endedAt: at(28, 15), attempts: 1, autonomous: false },
      { stage: 'gate2', agent: null, status: 'waiting', artifacts: [], startedAt: at(28, 16), endedAt: null, attempts: 1, autonomous: false },
    ],
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
      id: 'a101today',
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
      host: { vcs: 'github', project: ISSUE_PROJECT, iid: 101, url: 'https://example.com/group/project/issues/101' },
    },
    {
      id: 'b102search',
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
      host: { vcs: 'github', project: ISSUE_PROJECT, iid: 102, url: 'https://example.com/group/project/issues/102' },
    },
    {
      id: 'c103token',
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
      host: { vcs: 'github', project: ISSUE_PROJECT, iid: 103, url: 'https://example.com/group/project/issues/103' },
    },
  ],
});

/** One action waiting for the person: a comment the app proposes on the fake host, with its exact command. */
const actions = () => ({
  releaseSeen: null,
  actions: [
    {
      id: 'a1b2c3d4',
      key: 'comment:102',
      kind: 'comment',
      issue: 102,
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
      summary: 'Comment on app#102',
      command: { kind: 'comment', iid: 102, body: 'The spec is ready and the plan is waiting for your yes.' },
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
      { v: 1, type: 'message', seq: 2, thread, at: at(0, 1), kind: 'post', author: { type: 'agent', id: 'support' }, text: 'Two activities are open: the search of the answered actions is at its second gate, and the report about the refused token has no owner.', code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null },
      { v: 1, type: 'message', seq: 3, thread, at: at(0, 2), kind: 'post', author: { type: 'person' }, text: 'Put the token report with me and let us look at the search first.', code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: null },
      { v: 1, type: 'message', seq: 4, thread, at: at(0, 3), kind: 'handoff', author: { type: 'agent', id: 'support' }, text: 'Open the board and move the card of the report to the person.', code: null, params: {}, mentions: [], refs: [], attachments: [], anchor: null, stage: null, to: 'person' },
    ],
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
    record('p-1a2b3c4d', 'github.com', 'Open a pull request from a run branch', 'gui', [step('Open the run screen', 'button "Run"'), step('Choose the branch of the run'), step('Write the title of the pull request'), step('Confirm the push in Actions')], { revision: 3, state: 'ok', lastVerified: at(24), uses: 5, failures: 0, lastUsed: at(24), origin: origin('developer', at(0), { stage: 'implement' }), stepsFrom: 'edited' }),
    record('p-5e6f7a8b', 'coxia', 'Run the repository test suite in the QA sandbox', 'repo', [step('Point the data folder at an empty one', 'CERIMONIAS_DATA_DIR=<value> npm test'), step('Run the suite'), step('Read the failures one by one')], { revision: 2, state: 'unverified', lastVerified: null, uses: 0, failures: 0, origin: origin('qa', at(3), { stage: 'qa', handoff: true }), reviewed: false, stepsFrom: 'agent' }),
    record('p-9c0d1e2f', 'example.com', 'Upload a release file to the host', 'tool', [step('Build the package'), step('Open the host page of the release'), step('Attach the package'), step('Publish the draft')], { revision: 1, state: 'failing', lastVerified: at(-120), uses: 4, failures: 2, failuresSinceSave: 2, lastUsed: at(-12), lastFailed: { at: at(-12), step: 3 }, origin: origin('release-manager', at(-240), { stage: 'release-beta' }) }),
  ];
}

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
  json(join(root, 'workspaces.json'), { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: WORKSPACE_NAME, createdAt: at(0), test: true }] });
  written.push('workspaces.json', 'workspaces/principal/config.json');
  json(join(id, 'config.json'), config(root));
  for (const run of runs(id)) json(join(id, 'runs', `${run.id}.json`), run);
  written.push(`workspaces/principal/runs/${RUN_ONE}.json`, `workspaces/principal/runs/${RUN_TWO}.json`);
  json(join(id, 'board.json'), board());
  json(join(id, 'acoes.json'), actions());
  written.push('workspaces/principal/board.json', 'workspaces/principal/acoes.json');
  const call = conversation();
  write(join(id, 'forum', `${call.header.id}.jsonl`), [call.header, ...call.messages].map((line) => JSON.stringify(line)).join('\n'));
  written.push(`workspaces/principal/forum/${call.header.id}.jsonl`);
  for (const p of procedures()) json(join(id, 'memory', 'procedures', `${p.id}.json`), p);
  written.push('workspaces/principal/memory/procedures/p-1a2b3c4d.json', 'workspaces/principal/memory/procedures/p-5e6f7a8b.json', 'workspaces/principal/memory/procedures/p-9c0d1e2f.json');
  write(join(root, '2026-06-15-pre-daily.md'), ['# Pre-daily of 2026-06-15', '', '- The search of the answered actions is at its second gate.', '- The report about the refused token has no owner.', '- One activity shipped: the queue of the day.'].join('\n'));
  written.push('2026-06-15-pre-daily.md');
  json(join(root, 'web.json'), { enabled: true, port: 4330, paired: [{ id: 'phone-aurora', name: 'Phone of Aurora', pairedAt: at(-48) }] });
  written.push('web.json');
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
