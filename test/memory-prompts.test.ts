// What the prompts say when a call has the shared memory, and that they say nothing new when it has not: the stage's system text and prompt and the mention's, in both
// languages. The goldens (test/prompts-screen.test.ts, test/cycle-prompts.test.ts, test/golden/*) are the proof that a call without a session did not move.
import { describe, expect, it } from 'vitest';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import type { ForumMessage } from '../src/shared/forum';
import { startRun } from '../src/shared/runs';
import { prompt as cycleWords } from '../src/main/cyclePrompts';
import { mentionCall } from '../src/main/mentions/call';
import { type StageInput, stagePrompt, systemText } from '../src/main/runner/prompt';
import { updateConfig } from '../src/main/workspaceConfig';
import { agentFlowConfig, agentFlowStages, at, startInput } from './helpers/runs';

const flow = agentFlowStages();
const run = startRun(startInput(), flow, at(0)).run;

function setup(language: 'en' | 'pt-BR'): { config: WorkspaceConfig; agent: AgentDef } {
  const config = agentFlowConfig();
  config.language = language;
  updateConfig(() => config);
  return { config, agent: config.agents.team.find((a) => a.id === 'developer') as AgentDef };
}

function stageInput(config: WorkspaceConfig, agent: AgentDef, over: Partial<StageInput> = {}): StageInput {
  return { run, stage: flow.find((s) => s.agent === agent.id) ?? flow[0], agent, config, kind: 'work', writes: false, commands: [], files: [], memory: null, thread: [], attempt: 1, handoff: null, answer: null, diff: null, ...over };
}

const postOf = (text: string): ForumMessage => ({ v: 1, type: 'message', seq: 3, thread: 'general', at: '2026-10-03T10:00:00.000Z', kind: 'post', author: { type: 'person' }, text, code: null, params: {}, mentions: ['developer'], refs: [], attachments: [], stage: null, to: null, replyTo: null, public: false, waitsForAnswer: false, published: null });
const mention = (config: WorkspaceConfig, agent: AgentDef, over: Record<string, unknown> = {}) => mentionCall({ agent, config, message: postOf('@developer look'), thread: [], files: [], cwd: '/tmp', place: 'general', ...over });

const LIST = '- sys:version Version: unknown (no tag or manifest was found)\n- sys:roadmap Roadmap: none (no file is configured)';

describe.each(['en', 'pt-BR'] as const)('the prompts of a call with the memory, in %s', (language) => {
  it('a stage with a session is told the rules in its system text and the index fenced in its prompt; one that writes is also told how to keep a note', () => {
    const { config, agent } = setup(language);
    const system = systemText(stageInput(config, agent, { index: LIST }));
    expect(system).toContain(cycleWords('runner.rules.sharedMemory'));
    expect(system).not.toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    expect(systemText(stageInput(config, agent, { index: LIST, indexWrite: true }))).toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    expect(system).not.toContain('sys:version');
    const prompt = stagePrompt(stageInput(config, agent, { index: LIST }));
    expect(prompt).toContain(cycleWords('runner.section.sharedIndex', { text: LIST }));
    expect(prompt).toMatch(/<data>\n- sys:version[^]*<\/data>/);
  });

  it('a stage without one is told nothing of it, as before', () => {
    const { config, agent } = setup(language);
    const plain = stageInput(config, agent);
    expect(systemText(plain)).not.toContain(cycleWords('runner.rules.sharedMemory'));
    expect(stagePrompt(plain)).not.toContain('sys:version');
    expect(stagePrompt(plain)).toBe(stagePrompt({ ...plain, index: undefined, indexWrite: undefined }));
    expect(systemText(plain)).toBe(systemText({ ...plain, index: undefined }));
  });

  it('the activities section reads as the activity of the call when the index carries the others, and as the record of every activity when it does not', () => {
    const { config, agent } = setup(language);
    const withIndex = stagePrompt(stageInput(config, agent, { shared: 'app#101 Add the thing', index: LIST }));
    const without = stagePrompt(stageInput(config, agent, { shared: 'app#101 Add the thing' }));
    expect(withIndex).toContain(cycleWords('runner.section.sharedOne', { text: 'app#101 Add the thing' }));
    expect(withIndex).not.toContain(cycleWords('runner.section.shared', { text: 'app#101 Add the thing' }));
    expect(without).toContain(cycleWords('runner.section.shared', { text: 'app#101 Add the thing' }));
    expect(without).not.toContain(cycleWords('runner.section.sharedOne', { text: 'app#101 Add the thing' }));
  });

  it('puts the index after the activities section and before the procedures', () => {
    const { config, agent } = setup(language);
    const prompt = stagePrompt(stageInput(config, agent, { shared: 'app#101 Add the thing', index: LIST, procedures: 'p-00000001 · repo · app · Run the tests' }));
    const at = (needle: string): number => prompt.indexOf(needle);
    expect(at('app#101 Add the thing')).toBeGreaterThan(-1);
    expect(at('app#101 Add the thing')).toBeLessThan(at('sys:version'));
    expect(at('sys:version')).toBeLessThan(at('p-00000001'));
  });

  it('a mention gets the same: rules in the system text, the index after the activities section, and nothing without a session', () => {
    const { config, agent } = setup(language);
    const call = mention(config, agent, { memory: 'app#101 Add the thing', index: LIST, indexWrite: true });
    expect(call.system).toContain(cycleWords('runner.rules.sharedMemory'));
    expect(call.system).toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    expect(call.prompt).toContain(cycleWords('runner.section.sharedIndex', { text: LIST }));
    expect(call.prompt).toContain(cycleWords('runner.section.sharedOne', { text: 'app#101 Add the thing' }));
    expect(call.prompt.indexOf('app#101 Add the thing')).toBeLessThan(call.prompt.indexOf('sys:version'));
    const readOnly = mention(config, agent, { index: LIST });
    expect(readOnly.system).toContain(cycleWords('runner.rules.sharedMemory'));
    expect(readOnly.system).not.toContain(cycleWords('runner.rules.sharedMemoryWrite'));
    const plain = mention(config, agent, { memory: 'app#101 Add the thing' });
    expect(plain.system).not.toContain(cycleWords('runner.rules.sharedMemory'));
    expect(plain.prompt).not.toContain('sys:version');
    expect(plain.prompt).toContain(cycleWords('runner.section.shared', { text: 'app#101 Add the thing' }));
    expect(plain.system).toBe(mention(config, agent, { memory: 'app#101 Add the thing', index: undefined }).system);
  });

  it('the rules tell the agent what to do with an entry and what an entry cannot do', () => {
    setup(language);
    const rules = cycleWords('runner.rules.sharedMemory');
    for (const word of ['memory_read', 'memory_list']) expect(rules).toContain(word);
    const write = cycleWords('runner.rules.sharedMemoryWrite');
    expect(write).toContain('memory_save');
    expect(write).toMatch(/7 (to|a) 12/);
  });
});
