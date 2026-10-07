import { describe, expect, it } from 'vitest';
import type { ForumMessage } from '../src/shared/forum';
import { countCommands, groupCommands } from '../src/shared/runCommands';

const msg = (over: Partial<ForumMessage>): ForumMessage =>
  ({ v: 1, type: 'message', seq: 1, thread: 'run:1', at: '2026-01-01T00:00:00.000Z', kind: 'system', author: { type: 'app' }, text: '', code: null, params: {}, mentions: [], refs: [], stage: null, to: null, replyTo: null, public: false, published: null, ...over }) as ForumMessage;

const exec = (agent: string, stage: string, n: number, command: string, over: Partial<ForumMessage> = {}, params: Record<string, unknown> = {}): ForumMessage =>
  msg({ code: 'runner.exec', author: { type: 'app' }, stage, params: { agent, n, command, result: 'exit code 0', ms: 12, ...params }, ...over });

describe('the list of the commands an agent ran', () => {
  it('groups by agent and, inside it, by stage, in the order they ran', () => {
    const list = [
      exec('dev', 'implement', 1, 'npm test'),
      exec('dev', 'implement', 2, 'npm run build'),
      msg({ code: 'run.stage.started', stage: 'build' }),
      exec('dev', 'qa', 1, 'node -e 1'),
      exec('reviewer', 'review', 1, 'git diff --stat'),
    ];
    const grouped = groupCommands(list);
    expect(grouped.map((g) => g.agent)).toEqual(['dev', 'reviewer']);
    expect(grouped[0].stages.map((s) => s.stage)).toEqual(['implement', 'qa']);
    expect(grouped[0].stages[0].commands.map((c) => c.command)).toEqual(['npm test', 'npm run build']);
    expect(countCommands(grouped)).toBe(4);
  });

  it('says where each command ran, and keeps the result and the time', () => {
    const grouped = groupCommands([exec('dev', 'implement', 1, 'ls', { code: 'runner.exec.host' }, { result: 'refused: you did not allow it', ms: 0.4 })]);
    expect(grouped[0].stages[0].commands[0]).toMatchObject({ via: 'host', result: 'refused: you did not allow it', ms: 0.4 });
  });

  it('ignores messages that are not commands, and orders the commands by their number', () => {
    const grouped = groupCommands([msg({ code: 'run.started' }), exec('dev', 'implement', 2, 'b'), exec('dev', 'implement', 1, 'a')]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].stages[0].commands.map((c) => c.n)).toEqual([1, 2]);
  });

  it('reads an empty thread as no commands', () => {
    expect(groupCommands([])).toEqual([]);
    expect(countCommands([])).toBe(0);
  });
});
