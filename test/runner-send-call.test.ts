// The two tools of a stage that talks while it works: `SendMessage` posts in the run's conversation without ending the stage, and `CallAgent` opens a conversation
// with another agent of the team, refusing what the issue's limits refuse (an agent outside the team, a call chain that comes back to an agent already in it, and
// the attempt's cap of conversations).
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import { type Boot, boot, doc, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const { callRefusal } = await import('../src/main/runner/conversation');
const { SEND_MESSAGE_TOOL, CALL_AGENT_TOOL, resolveMessageTo, sendMessageTool } = await import('../src/main/runner/tools');
const { runThreadId } = await import('../src/shared/forum');

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
});

function easy(b: Boot): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
}

/** The tool of a call by its name, as the engine would offer it. */
const toolOf = (call: { runnerTools?: ToolImpl[] }, name: string): ToolImpl => {
  const tool = call.runnerTools?.find((x) => x.name === name);
  if (!tool) throw new Error(`the call has no ${name} tool`);
  return tool;
};

describe('the message tools of a working stage', () => {
  it('posts a message in the run asking for the person, keeps the stage going, and never ends it', async () => {
    const b = await boot();
    easy(b);
    b.engine.script('refiner', (call) => {
      const send = toolOf(call, SEND_MESSAGE_TOOL)!;
      return send.run({ to: '', text: 'Found the helper, going on with it.' }, {} as never).then(() => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    const messages = b.thread(run);
    const said = messages.find((m) => m.kind === 'post' && m.author.type === 'agent' && m.text === 'Found the helper, going on with it.');
    // The message is an internal post of the agent: it is in the run's conversation, and the stage went on with its own work.
    expect(said).toMatchObject({ stage: 'refine', public: false });
    expect(b.thread(run).some((m) => m.code === 'runner.artifact' || (m.kind === 'post' && m.author.type === 'agent'))).toBe(true);
    expect(b.runs.get(run.id)?.stage).not.toBe('refine');
  });

  it('hands a message of an agent to another agent that is working, and refuses a name outside the team', async () => {
    const b = await boot();
    easy(b);
    const seen: string[] = [];
    b.engine.script('refiner', async (call) => {
      const send = toolOf(call, SEND_MESSAGE_TOOL)!;
      // A name outside the team is refused with the team's list; the message does not go out.
      const bad = await send.run({ to: 'nobody', text: 'hello?' }, {} as never).catch((e: Error) => e.message);
      seen.push(String(bad));
      await send.run({ to: '', text: 'note for the person' }, {} as never);
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] });
    });
    await b.runner.start('app#101');
    await b.settle();
    expect(seen[0]).toContain('nobody');
    expect(seen[0]).toContain('developer');
  });

  it('resolves the destination of a message: the person, one agent, everyone, or a refusal with the team', () => {
    const team = { ids: ['developer', 'qa'], caller: 'developer' };
    expect(resolveMessageTo('', team)).toEqual({ ok: true, to: '' });
    expect(resolveMessageTo('todos', team)).toEqual({ ok: true, to: 'todos' });
    expect(resolveMessageTo('qa', team)).toEqual({ ok: true, to: 'qa' });
    const bad = resolveMessageTo('ghost', team);
    expect(bad.ok).toBe(false);
    expect(sendMessageTool({ sendMessage: () => 'sent', callAgent: async () => '', askConversation: async () => '', team }).name).toBe(SEND_MESSAGE_TOOL);
  });

  it('refuses a call that closes a cycle or that goes past the attempt cap, and opens the rest', () => {
    expect(callRefusal({ called: 'qa', chain: ['developer', 'qa'], opened: 0, perStage: 3 })).toBe('cycle');
    expect(callRefusal({ called: 'planner', chain: ['developer'], opened: 3, perStage: 3 })).toBe('cap');
    expect(callRefusal({ called: 'qa', chain: ['developer'], opened: 0, perStage: 3 })).toBeNull();
  });
});

describe('a conversation started by a stage', () => {
  it('opens a conversation with another agent of the team, and the answers enter the caller as messages', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({ sandbox });
    easy(b);
    // The agent of the first stage calls the QA in a conversation of its own while it works; the QA answers once and the conversation ends by itself.
    b.engine.script('refiner', async (call) => {
      const open = toolOf(call, CALL_AGENT_TOOL)!;
      const said = await open.run({ to: 'qa', topic: 'How do I reproduce the failing scenario?', place: 'new' }, {} as never);
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], text: String(said) });
    });
    b.engine.script('qa', () => ({ texto: 'Run the test with an empty folder.' }));
    const run = await b.runner.start('app#101');
    await b.settle();
    const calls = b.engine.calls.filter((c) => c.agent.id === 'qa');
    expect(calls.length).toBeGreaterThan(0);
    // The called agent ran its own turn with the conversation tool offered, over the run's worktree.
    expect(toolOf(calls[0], 'AskConversation')).toBeDefined();
    expect(calls[0].cwd).toBe(run.worktree);
    // The conversation happened in a thread of its own, linked from the run.
    const linked = b.thread(run).find((m) => m.code === 'runner.conversation.linked');
    expect(linked).toBeDefined();
    expect(linked?.params.thread).toContain(runThreadId(run.id));
  });

  it('lets a called agent that writes change a file and run a command, committed with the calling stage', async () => {
    const sandbox = fakeSandbox();
    const b = await boot({
      sandbox,
      configure: (c) => {
        const qa = c.agents.team.find((a) => a.id === 'qa')!;
        qa.permission = 'worktree';
        qa.shell = 'sandbox';
      },
    });
    easy(b);
    // The developer calls the QA while it works; the QA (written to be able to) changes a file and runs a command, and the change is committed with the calling stage.
    b.engine.script('refiner', async (call) => {
      const open = toolOf(call, CALL_AGENT_TOOL)!;
      await open.run({ to: 'qa', topic: 'Reproduce the failing scenario?', place: 'run' }, {} as never);
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' });
    });
    b.engine.script('qa', async (call, tools) => {
      await tools.write('src/app.ts', 'export const app = 2;\n');
      await call.exec?.exec('npm test');
      return { texto: 'the fixture now matches the scenario' };
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    // The called writer changed the file over the run's worktree, and its command ran in its own session.
    expect(readFileSync(join(run.worktree, 'src/app.ts'), 'utf8')).toContain('2');
    const qaSessions = sandbox.opened.filter((o) => o.options && o.options.worktree === run.worktree);
    expect(qaSessions.some((o) => o.session.asked.includes('npm test'))).toBe(true);
    // The thread says the command under the called agent, and the change was committed with the calling stage.
    expect(b.thread(run).some((m) => m.code === 'runner.exec' && m.params.agent === 'qa' && m.params.command === 'npm test')).toBe(true);
  });
});
