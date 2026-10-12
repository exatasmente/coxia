// A stage whose executor is a Claude Code session, through the whole runner (#281): the session's result is the stage's answer, its record is kept apart, the
// stage fails like any agent's when the session does, and with the option off or in a test workspace nothing is reached and the app's agent never runs in its place.
// The session is a fake port of the test's; nothing of `~/.claude` and no model.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ClaudeCodeInput, ClaudeCodeResult } from '../src/main/runner/claudeCodeTask';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { type Boot, boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const STAGE = 'implement';

interface FakePort {
  test(): boolean;
  run(input: ClaudeCodeInput): Promise<ClaudeCodeResult>;
  asked: ClaudeCodeInput[];
}

/** A session port that answers with `answer`, or throws `fail` carrying the record the session left. */
function fakePort(o: { test?: boolean; answer?: ClaudeCodeResult; fail?: Error } = {}): FakePort {
  const asked: ClaudeCodeInput[] = [];
  return {
    asked,
    test: () => o.test ?? false,
    run: async (input) => {
      asked.push(input);
      if (o.fail) throw o.fail;
      return o.answer ?? { data: work('From the session.', { artifacts: [doc('3_IMPLEMENTATION.md')] }), sessionId: 'cc-1', engine: 'claude-sdk', transcript: 'said: working\nWrite: src/a.ts' };
    },
  };
}

async function runFlow(port: FakePort, o: { option: boolean; executor?: 'claude-code' | 'agent' }): Promise<{ b: Boot; run: Run }> {
  const b = await boot({
    claudeCode: port,
    configure: (c: WorkspaceConfig) => {
      c.language = 'en';
      c.runner.commands = [];
      c.runner.claudeCodeTasks = o.option;
      const stage = c.devCycle.stages.find((s) => s.id === STAGE)!;
      if (o.executor) stage.executor = o.executor;
    },
  });
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
  b.engine.script('developer', () => work('From the app agent.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
  let run = await b.runner.start('101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id) as Run;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.status === 'failed' || run.status === 'done' || run.stage === 'ready') break;
  }
  return { b, run };
}

const developerCalls = (b: Boot) => b.engine.calls.filter((c) => c.agent.id === 'developer');

describe('a stage that hands its task to a Claude Code session', () => {
  it('uses the session for the stage, and never the app\'s agent', async () => {
    const port = fakePort();
    const { b, run } = await runFlow(port, { option: true, executor: 'claude-code' });
    expect(run.status).not.toBe('failed');
    expect(port.asked).toHaveLength(1);
    expect(developerCalls(b)).toHaveLength(0);
    // The session's result is the stage's answer: the thread carries it, and the app agent's own answer never appears.
    const text = JSON.stringify(b.thread(run));
    expect(text).toContain('From the session.');
    expect(text).not.toContain('From the app agent.');
  });

  it('keeps the transcript as the stage\'s record, apart from the answer, and says where in the thread', async () => {
    const { b, run } = await runFlow(fakePort(), { option: true, executor: 'claude-code' });
    const file = join(b.dir, 'claude-code', `${run.id}-${STAGE}.txt`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('Write: src/a.ts');
    const thread = b.thread(run);
    expect(thread.some((m) => m.kind === 'system' && m.code === 'runner.claudeCode.transcript')).toBe(true);
    expect(JSON.stringify(thread.filter((m) => m.kind !== 'system'))).not.toContain('Write: src/a.ts');
  });

  it('fails the stage like any agent when the session fails, and still keeps what the session said', async () => {
    const fail = Object.assign(new Error('session exploded'), { transcript: 'said: half way' });
    const port = fakePort({ fail });
    const { b, run } = await runFlow(port, { option: true, executor: 'claude-code' });
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toContain('session exploded');
    expect(developerCalls(b)).toHaveLength(0);
    expect(readFileSync(join(b.dir, 'claude-code', `${run.id}-${STAGE}.txt`), 'utf8')).toBe('said: half way');
  });

  it('refuses with the option off: nothing is reached and the app\'s agent does not run in its place', async () => {
    const port = fakePort();
    const { b, run } = await runFlow(port, { option: false, executor: 'claude-code' });
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toContain('Nothing was run');
    expect(port.asked).toHaveLength(0);
    expect(developerCalls(b)).toHaveLength(0);
  });

  it('refuses a test workspace even with the option on', async () => {
    const port = fakePort({ test: true });
    const { b, run } = await runFlow(port, { option: true, executor: 'claude-code' });
    expect(run.status).toBe('failed');
    expect(run.error?.detail).toContain('test workspace');
    expect(port.asked).toHaveLength(0);
    expect(developerCalls(b)).toHaveLength(0);
  });

  it('leaves a stage with the default executor on the app\'s agent, whatever the option says', async () => {
    for (const executor of [undefined, 'agent' as const]) {
      const port = fakePort();
      const { b, run } = await runFlow(port, { option: true, executor });
      expect(run.status).not.toBe('failed');
      expect(port.asked).toHaveLength(0);
      expect(developerCalls(b)).toHaveLength(1);
    }
  });
});
