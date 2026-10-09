// The reads of the state server, pure over a fixture workspace's data folder: the shapes each read answers, the isolation from another
// workspace, the masking of planted secret shapes, and the freshness (a change between two calls is answered).
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildActivities, buildCycles, resolveWorkspace, stateTools, type ToolArgs } from '../src/main/mcp-state/tools';
import { createBoardStore } from '../src/main/board-core';
import { createForumStore } from '../src/main/forum-core';
import { createRunStore } from '../src/main/runs-core';
import { createProcedureStore, proceduresPath } from '../src/main/procedures/store';
import { emptyIndex, frontOfActivity, writeIndex } from '../src/main/runner/activities';
import { runThreadId, type ForumDraft } from '../src/shared/forum';
import { RUN_ID, type Run } from '../src/shared/runs';
import { CATALOGS, setLanguage } from '../src/shared/i18n';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';

const servedId = 'state-server-ws';
const otherId = 'state-server-other';
const AT = '2026-10-03T10:00:00.000Z';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mcp-state-tools-'));
});

afterEach(() => {
  setLanguage('pt-BR');
  root = '';
});

/** The two workspaces the fixture names in the registry; the first is served, the second must never appear in an answer. */
function makeWorkspaces(): { workspace: string; other: string } {
  mkdirSync(join(root, 'workspaces', servedId), { recursive: true });
  mkdirSync(join(root, 'workspaces', otherId), { recursive: true });
  writeFileSync(
    join(root, 'workspaces.json'),
    JSON.stringify({
      current: servedId,
      list: [
        { id: servedId, name: 'Served', createdAt: AT, test: false },
        { id: otherId, name: 'Other', createdAt: AT, test: false },
      ],
    }),
  );
  const config = (enabled: boolean): unknown => ({ schemaVersion: CONFIG_SCHEMA_VERSION, language: 'en', mcpState: { enabled } });
  writeFileSync(join(root, 'workspaces', servedId, 'config.json'), JSON.stringify(config(true)));
  writeFileSync(join(root, 'workspaces', otherId, 'config.json'), JSON.stringify(config(false)));
  return { workspace: join(root, 'workspaces', servedId), other: join(root, 'workspaces', otherId) };
}

type Served = Extract<ReturnType<typeof resolveWorkspace>, { ok: true }>;

const env = (): NodeJS.ProcessEnv => ({ CERIMONIAS_MCP_WORKSPACE: servedId, CERIMONIAS_DATA_DIR: root });
const served = (): Served => {
  const w = resolveWorkspace(env());
  if (!w.ok) throw new Error(w.text);
  setLanguage(w.language);
  return w;
};

const tool = (name: string, args: ToolArgs = {}): string => {
  const map = stateTools(env());
  const found = map.find((tl) => tl.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.run(args).text;
};

/** A run planted through the store's own write door (the file the store writes is the file every read re-opens). */
function plantRun(over: Partial<Run> = {}): Run {
  const run: Run = {
    version: 1,
    rev: 1,
    id: 'r-plant1-x1y2',
    issue: { ref: 'app#181', iid: 181, title: 'Reads through the state server', url: 'https://example.com/group/project/issues/181' },
    repo: 'app',
    branch: 'coxia/181-state-server',
    worktree: '/tmp/mcp-state-worktree-plant',
    cycleFolder: 'docs/cycles/181-state-server',
    cycleId: 'agent-flow',
    status: 'working',
    stage: 'implement',
    stages: [{ stage: 'implement', agent: 'dev', status: 'running', artifacts: [], startedAt: AT, endedAt: null, attempts: 1, autonomous: true }],
    question: null,
    pending: null,
    returns: {},
    wait: null,
    error: null,
    history: [],
    comments: {},
    reviews: [],
    qa: [],
    base: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
  return createRunStore(join(root, 'workspaces', servedId, 'runs')).create(run);
}

const updateRun = (run: Run, change: (r: Run) => Run): Run =>
  createRunStore(join(root, 'workspaces', servedId, 'runs')).update(run.id, () => ({ run: change(run), messages: [] })).run;

describe('the cycles read', () => {
  it('answers the cards the board file holds, masked as the tracker shows them, and nothing of the other workspace', () => {
    const w = makeWorkspaces();
    const board = createBoardStore({ file: join(served().dir, 'board.json'), now: () => new Date() });
    const card = board.create({ id: 'statecard', title: 'State server board card', body: '', column: 'implement', squad: 'plataforma', priority: 'medium', labels: ['coxia'], repo: 'app' });
    const otherBoard = createBoardStore({ file: join(w.other, 'board.json'), now: () => new Date() });
    otherBoard.create({ id: 'nopeneigh', title: 'Other workspace card', body: '', column: 'implement', squad: null, priority: null, labels: [], repo: null });
    const text = tool('coxia_state_cycles');
    const cards = JSON.parse(text) as { id: string; title: string; column: string }[];
    expect(cards.map((c) => c.id)).toEqual([card.id]);
    expect(text).toContain('State server board card');
    expect(text).not.toContain('Other workspace card');
  });

  it('an empty board answers the empty message instead of an empty list', () => {
    makeWorkspaces();
    expect(tool('coxia_state_cycles')).toBe(CATALOGS.en['main.mcpstate.noCycles']);
  });
});

describe('the reads of a run', () => {
  it('a run waiting the person answers the exact question, masked', () => {
    makeWorkspaces();
    const run = updateRun(plantRun(), (r) => ({
      ...r,
      status: 'question',
      question: { by: 'dev', kind: 'agent', stage: 'implement', text: 'The api key is "apiKey: sk-or-v1-0123456789abcdef0123456789abcdef" — right?', askedAt: AT } as const,
    }));
    const text = tool('coxia_state_runs');
    expect(text).toContain('app#181');
    expect(text).toContain('question');
    expect(text).not.toContain('sk-or-v1');
    expect(text).toContain('right?');
    void run;
  });

  it('a gate run answers its status and no question; the command note says why nothing of a pending command is visible', () => {
    makeWorkspaces();
    const run = plantRun({ stage: 'gate2', status: 'gate', stages: [{ stage: 'gate2', agent: null, status: 'waiting', artifacts: [], startedAt: AT, endedAt: null, attempts: 1, autonomous: true }] });
    const text = tool('coxia_state_runs');
    expect(text).toContain(run.id);
    expect(text).toContain('"status": "gate"');
    expect(text).toContain('"question": null');
    expect(text).toContain(CATALOGS.en['main.mcpstate.commandsNote'].split('. ')[0].slice(0, 60));
  });

  it('a run the tool does not name is an error, never a guess', () => {
    makeWorkspaces();
    expect(tool('coxia_state_conversation', { runId: 'r-missing-nope' })).toBe(CATALOGS.en['main.mcpstate.runNotFound'].replace('{id}', 'r-missing-nope'));
    expect(tool('coxia_state_conversation', { runId: '../escape' })).toBe(CATALOGS.en['main.mcpstate.badRunId'].replace('{id}', '../escape'));
  });
});

describe('the conversation read', () => {
  it('answers the thread in order without system lines, and masks a planted credential shape', () => {
    makeWorkspaces();
    const run = plantRun();
    const forum = createForumStore(join(root, 'workspaces', servedId, 'forum'));
    forum.ensureThread({ id: runThreadId(run.id), kind: 'run', runId: run.id, title: 'The run thread' });
    const drafts: ForumDraft[] = [
      { kind: 'question', author: { type: 'agent', id: 'dev' }, text: 'Ready to push quoting "Authorization: Bearer plntkn1234567890abcdefgh" — allowed?' },
      { kind: 'system', author: { type: 'app' }, text: 'stage implement started' },
      { kind: 'answer', author: { type: 'person' }, text: 'Yes, push it' },
    ];
    forum.append(runThreadId(run.id), drafts);
    const text = tool('coxia_state_conversation', { runId: run.id });
    expect(text).toContain('[1]');
    expect(text).toContain('[3]');
    expect(text).not.toContain('[2]');
    expect(text).not.toContain('plntkn1234567890abcdefgh');
    expect(text).toContain('Yes, push it');
  });
});

describe('the evidence read', () => {
  it('answers the records the run kept with the stored path present and shrunk', () => {
    makeWorkspaces();
    const run = plantRun({ evidence: { 'ev-1': { id: 'ev-1', stage: 'implement', by: 'dev', title: 'Console proof', description: 'the screen at the gate', name: 'proof.txt', kind: 'text', bytes: 5, at: AT, from: null, message: null } } });
    const dir = join(served().dir, 'evidence', run.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ev-1.txt'), 'xx\n');
    const text = tool('coxia_state_evidence', { runId: run.id });
    const list = JSON.parse(text) as { id: string; title: string; path: string; kind: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe(join(served().dir, 'evidence', run.id, 'ev-1.txt'));
    expect(list[0].title).toBe('Console proof');
    expect(list[0].kind).toBe('text');
  });
});

describe('the activities read', () => {
  it('answers the front the run projects (reference, title, trailing text), built from the run store', () => {
    makeWorkspaces();
    const run = plantRun({ history: [{ at: AT, type: 'answer', stage: 'implement', by: 'person', detail: 'the answer the person gave' }] });
    writeIndex(served().dir, emptyIndex());
    const text = buildActivities(served());
    expect(text).toContain(`${run.issue.ref} `);
    expect(text).toContain('Reads through the state server');
  });

  it('an empty workspace answers the empty message, never invented state', () => {
    makeWorkspaces();
    expect(buildActivities(served())).toBe(CATALOGS.en['main.mcpstate.activitiesEmpty']);
  });
});

describe('the procedures read', () => {
  it('lists what the store can read, one entry each, and a named id that is gone is refused', () => {
    makeWorkspaces();
    const store = createProcedureStore(join(root, 'workspaces', servedId), {});
    const saved = store.save({
      input: { kind: 'repo', key: 'api', title: 'Learned procedure', steps: [{ text: 'Do the thing' }], pitfalls: [], waits: [] },
      writer: { by: 'dev', surface: 'stage', stage: 'implement' },
      repos: ['api'],
    });
    expect(saved.ok).toBe(true);
    expect(tool('coxia_state_procedures')).toContain('Learned procedure');
    expect(tool('coxia_state_procedures', { id: 'p-99999999' })).toContain('No such procedure');
  });

  it('never writes the procedures folder: a stale temporary file is still there after the read', () => {
    makeWorkspaces();
    const dir = join(root, 'workspaces', servedId);
    createProcedureStore(dir, {}).save({
      input: { kind: 'repo', key: 'api', title: 'Learned procedure', steps: [{ text: 'Do the thing' }], pitfalls: [], waits: [] },
      writer: { by: 'dev', surface: 'stage', stage: 'implement' },
      repos: ['api'],
    });
    const stale = join(proceduresPath(dir), 'p-00000001.json.tmp-4242');
    writeFileSync(stale, '{');
    const old = (Date.now() - 2 * 3600_000) / 1000;
    utimesSync(stale, old, old);
    expect(tool('coxia_state_procedures')).toContain('Learned procedure');
    expect(existsSync(stale)).toBe(true);
  });
});

describe('the freshness and the unreadable files (spec rule 3)', () => {
  it('a card written between two calls is answered by the second', () => {
    makeWorkspaces();
    expect(tool('coxia_state_cycles')).toBe(CATALOGS.en['main.mcpstate.noCycles']);
    createBoardStore({ file: join(served().dir, 'board.json'), now: () => new Date() }).create({ id: 'latecard1', title: 'Written after the first call', body: '', column: 'implement', squad: null, priority: null, labels: [], repo: null });
    expect(tool('coxia_state_cycles')).toContain('Written after the first call');
  });

  it('a run written by a newer app is not read (the store refuses it the way the app does)', () => {
    makeWorkspaces();
    const run = plantRun();
    const newer = { ...run, id: 'r-newer1-zzz' };
    (newer as unknown as { version: number }).version = 7;
    writeFileSync(join(root, 'workspaces', servedId, 'runs', 'r-newer1-zzz.json'), JSON.stringify(newer));
    const text = tool('coxia_state_runs');
    expect(text).not.toContain('r-newer1');
    expect(text).toContain('app#181');
  });
});

void [frontOfActivity, RUN_ID];

