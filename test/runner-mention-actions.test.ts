// What an agent named in a run's thread may do besides answering: run commands over a throwaway copy of the code when it is set to (a sandbox, or this computer
// with the person's yes per command), and propose an issue when it reads the code host, which only waits in Actions. It still never writes to the run.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import type { PendingCommand, Run } from '../src/shared/runs';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { onRunnerActionDone } = await import('../src/main/runner/door');

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  stop?.();
  stop = null;
});

const agent = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
}

async function mention(b: Boot, run: Run, id: string, text: string): Promise<void> {
  const [m] = b.forum.append(`run-${run.id}`, { kind: 'post', author: { type: 'person' }, text: `@${id} ${text}`, mentions: [id] });
  b.runner.onMessage(m);
}

const mentionCalls = (b: Boot, id: string) => b.engine.calls.filter((c) => c.agent.id === id && !c.confine && c.prompt.includes('called on you'));

describe('an issue proposed in a mention', () => {
  it('waits in Actions for the person and, once approved, is created and linked in the thread', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; agent(c, 'planner').tracker = 'read'; } });
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('planner', () => ({ text: 'I proposed the issue for the two failing tests.', proposals: [{ op: 'createIssue', title: 'The release cut stops at the checks', body: '## What happens\n\nTwo tests fail.', labels: ['bug', ' '] }] }));
    await mention(b, run, 'planner', 'create the issue');
    await b.settle();
    const call = mentionCalls(b, 'planner').at(-1)!;
    expect((call.schema as { properties: Record<string, unknown> }).properties).toHaveProperty('proposals');
    // The text that says the agent may write on the code host, whichever its autonomy (an autonomous agent is told which writes go out by themselves).
    expect(call.system).toMatch(/You may (propose writes|write) on the code host/);
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(proposal).toMatchObject({ state: 'pending', summary: 'a new issue: The release cut stops at the checks' });
    // The proposal names the run it was raised in: the runner keeps telling the thread what became of it.
    expect(proposal?.unit).toMatchObject({ runId: run.id, agent: 'planner' });
    // Nothing exists on the host before the person's yes.
    expect([...forge.issues.values()].some((i) => i.title === 'The release cut stops at the checks')).toBe(false);
    expect(b.thread(run).find((m) => m.code === 'runner.mention.proposed')?.params).toMatchObject({ agent: 'planner', count: 1 });
    await actions.approveAction(proposal!.id);
    await b.settle();
    const made = [...forge.issues.values()].find((i) => i.title === 'The release cut stops at the checks');
    expect(made).toMatchObject({ body: '## What happens\n\nTwo tests fail.', labels: ['bug'] });
    // The write went out: the run's thread says so, instead of the proposal being answered in silence.
    expect(b.thread(run).find((m) => m.code === 'runner.mention.writeDone')?.params).toMatchObject({ agent: 'planner' });
  });

  it('registers a proposal made in a run on the run\'s issue, naming the run', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; agent(c, 'planner').tracker = 'read'; agent(c, 'planner').autonomous = false; } });
    stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('planner', () => ({ text: 'A comment for the tracker.', proposals: [{ op: 'comment', issue: 101, body: 'A note.' }] }));
    await mention(b, run, 'planner', 'comment on it');
    await b.settle();
    // A proposal made in a run's thread registers on the run's issue and names the run.
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write');
    expect(proposal).toMatchObject({ issue: 101, unit: { runId: run.id } });
  });

  it('is not offered to an agent that does not read the code host, and what it sends anyway is dropped', async () => {
    forge = makeForge();
    setVcsRuntimeForTests(forge.runtime());
    const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; agent(c, 'planner').tracker = 'none'; } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('planner', () => ({ text: 'Here it is.', proposals: [{ op: 'createIssue', title: 'Sneaky', body: 'Body.', labels: [] }] }));
    await mention(b, run, 'planner', 'create the issue');
    await b.settle();
    const call = mentionCalls(b, 'planner').at(-1)!;
    expect((call.schema as { properties: Record<string, unknown> }).properties).not.toHaveProperty('proposals');
    expect(actions.listActions().filter((a) => (a.unit as { purpose?: string } | null)?.purpose === 'mention-write')).toEqual([]);
  });
});

describe('commands in a mention', () => {
  it('gives an agent set to a sandbox its session over a copy of the code, and ends it with the answer', async () => {
    const sandbox = fakeSandbox({ table: { 'npx vitest run test/a.test.ts': { exitCode: 1, output: 'FAIL a' } } });
    const b = await boot({ sandbox, configure: (c) => { c.language = 'en'; agent(c, 'planner').shell = 'sandbox'; } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    b.engine.script('planner', async (c) => {
      const r = await c.exec!.exec('npx vitest run test/a.test.ts');
      return { text: `It fails: exit ${r.exitCode}.` };
    });
    await mention(b, run, 'planner', 'reproduce it');
    await b.settle();
    const opened = sandbox.opened.at(-1)!;
    expect(opened.options.reader).toBe(true);
    expect(opened.host).toBe(false);
    expect(opened.session.closed).toBe(true);
    const call = mentionCalls(b, 'planner').at(-1)!;
    expect(call.exec).toBe(opened.session);
    expect(call.confine).toBeUndefined();
    expect(call.system).toContain('Shell tool');
    expect(b.thread(run).some((m) => m.kind === 'post' && m.text === 'It fails: exit 1.')).toBe(true);
    expect(b.thread(run).filter((m) => m.code === 'runner.exec')).toHaveLength(1);
  });

  it('asks the person before each command of an agent set to this computer', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { c.language = 'en'; agent(c, 'planner').shell = 'host'; } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    let asked: PendingCommand | null = null;
    b.engine.script('planner', async (c) => {
      const ran = c.exec!.exec('npm test');
      for (let i = 0; i < 400 && !asked; i++) {
        asked = b.runner.get(run.id)?.command ?? null;
        if (!asked) await new Promise((r) => setTimeout(r, 5));
      }
      b.runner.command(run.id, asked!.id, 'deny', 'not now');
      const r = await ran;
      return { text: `Refused: ${r.refused}.` };
    });
    await mention(b, run, 'planner', 'run the tests');
    await b.settle();
    expect(asked).toMatchObject({ agent: 'planner', command: 'npm test' });
    expect(sandbox.opened.at(-1)).toMatchObject({ host: true, options: { reader: true } });
    expect(b.thread(run).some((m) => m.kind === 'post' && m.text === 'Refused: denied.')).toBe(true);
  });

  it('still answers, without commands, where no sandbox can be made, and says why', async () => {
    const b = await boot({ sandbox: fakeSandbox({ available: false }), configure: (c) => { c.language = 'en'; } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    // Set after the start: a run whose team has an agent in a sandbox is refused on a machine without one.
    b.deps.updateConfig((c) => (agent(c, 'planner').shell = 'sandbox', c));
    b.engine.script('planner', (c) => ({ text: c.exec ? 'with a shell' : 'read only' }));
    await mention(b, run, 'planner', 'reproduce it');
    await b.settle();
    expect(b.thread(run).find((m) => m.code === 'runner.mention.noShell')?.params).toMatchObject({ agent: 'planner' });
    expect(b.thread(run).some((m) => m.kind === 'post' && m.text === 'read only')).toBe(true);
  });

  it('gives an agent with no shell no session at all', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox, configure: (c) => { c.language = 'en'; agent(c, 'planner').shell = 'none'; } });
    easy(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    const before = sandbox.opened.length;
    b.engine.script('planner', () => ({ text: 'read only' }));
    await mention(b, run, 'planner', 'reproduce it');
    await b.settle();
    expect(sandbox.opened.length).toBe(before);
    expect(mentionCalls(b, 'planner').at(-1)?.exec).toBeUndefined();
  });
});
