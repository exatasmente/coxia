// `CallAgent` in a conversation: an agent answering the person (here in its direct conversation) brings another agent of the team in. The question is posted in the
// same conversation naming the other, the other answers there, read only, and the answer comes back to the caller, who finishes its own. A call back to an agent
// already in the exchange is refused, and one answer makes at most the configured number of calls.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { answerMentions } from '../src/main/mentions/answer';
import { placeOfThread } from '../src/main/mentions/place';
import type { AgentCall } from '../src/main/agents';
import { t } from '../src/shared/i18n';
import { fakeEngine } from './helpers/runner';

let dir: string;
let forum: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-call-agent-'));
  forum = createForumStore(dir);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const config = () => {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = c.agents.team.map((a) => ({ ...a, permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const }));
  c.projects.repos = [];
  c.runner.conversations = { ...c.runner.conversations, perStage: 2 };
  return c;
};

/** Calls the conversation's `CallAgent` the way an engine would, from inside the agent's answer. */
const callAgent = async (call: AgentCall, to: string, topic: string): Promise<string> => {
  const tool = call.runnerTools?.find((x) => x.name === 'CallAgent');
  if (!tool) throw new Error('no CallAgent offered');
  const r = await tool.run({ to, topic }, {} as never);
  return String(r.response);
};

function setup() {
  const c = config();
  const [owner, lead, support] = c.agents.team.map((a) => a.id);
  ensureAgentThread(forum, { id: owner, name: owner }, 'en');
  const thread = agentThreadId(owner);
  const place = placeOfThread(forum.summary(thread), () => null, c)!;
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'Can we take the export feature this cycle?' }) as ForumMessage[];
  return { c, owner, lead, support, thread, place, message };
}

describe('an agent answering in a conversation calls another agent', () => {
  it('asks it in the same conversation, gets its answer back and finishes its own', async () => {
    const { c, owner, lead, thread, place, message } = setup();
    const engine = fakeEngine();
    let heard = '';
    engine.script(owner, async (call) => {
      heard = await callAgent(call, lead, 'Is the export doable this cycle?');
      return { text: 'Yes: the tech lead says it fits, so we take it.' };
    });
    engine.script(lead, () => ({ text: 'It fits: two days, no new dependency.' }));
    const out = await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(heard).toContain('It fits: two days, no new dependency.');
    expect(heard).toContain('<data>');
    // The person sees the whole exchange in order: the caller's question naming the other, the other's answer, then the caller's own answer.
    const posts = (forum.read(thread, 0, 100)?.messages ?? []).filter((m) => m.author.type === 'agent').map((m) => [m.author.type === 'agent' ? m.author.id : '', m.text, m.mentions ?? []]);
    expect(posts).toEqual([
      [owner, 'Is the export doable this cycle?', [lead]],
      [lead, 'It fits: two days, no new dependency.', []],
      [owner, 'Yes: the tech lead says it fits, so we take it.', []],
    ]);
    expect(out.map((a) => a.agent)).toEqual([owner]);
    // The called agent answered read only, as a mention does.
    expect(engine.calls.find((x) => x.agent.id === lead)?.agent.permission).toBe('read');
  });

  it('lets the called agent bring in a third one, and refuses a call back to one already in the exchange', async () => {
    const { c, owner, lead, support, place, message } = setup();
    const engine = fakeEngine();
    let back = '';
    engine.script(owner, async (call) => {
      await callAgent(call, lead, 'Is the export doable?');
      return { text: 'Done.' };
    });
    engine.script(lead, async (call) => {
      await callAgent(call, support, 'Do customers ask for the export?');
      back = await callAgent(call, owner, 'And you, what do you think?');
      return { text: 'It fits, and support says customers ask for it.' };
    });
    engine.script(support, () => ({ text: 'Yes, every week.' }));
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(engine.calls.map((x) => x.agent.id)).toEqual([owner, lead, support]);
    expect(back).toBe(t('main.mentions.call.refusedCycle', { called: owner }));
  });

  it('makes at most the configured number of calls in one answer', async () => {
    const { c, owner, lead, support, place, message } = setup();
    const engine = fakeEngine();
    const said: string[] = [];
    engine.script(owner, async (call) => {
      said.push(await callAgent(call, lead, 'first'));
      said.push(await callAgent(call, support, 'second'));
      said.push(await callAgent(call, lead, 'third'));
      return { text: 'Done.' };
    });
    engine.script(lead, () => ({ text: 'ok' }));
    engine.script(support, () => ({ text: 'ok' }));
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(said[2]).toBe(t('main.mentions.call.refusedCap', { cap: 2 }));
    expect(engine.calls.filter((x) => x.agent.id !== owner)).toHaveLength(2);
  });

  it('does not reach a draft: an agent saved to be tried out is not on the team a call can name', async () => {
    const { c, owner, lead, place, message } = setup();
    c.agents.team.push(newAgent({ id: 'trial', draft: true }));
    const engine = fakeEngine();
    let toDraft = '';
    let toLead = '';
    engine.script(owner, async (call) => {
      // A name the team does not have is a refusal the engine hands back to the model as the tool's error.
      toDraft = await callAgent(call, 'trial', 'Are you there?').catch((e: Error) => e.message);
      toLead = await callAgent(call, lead, 'And you?');
      return { text: 'Done.' };
    });
    engine.script(lead, () => ({ text: 'Here.' }));
    engine.script('trial', () => ({ text: 'I should not be asked.' }));
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(toDraft).toBe(t('main.runner.tools.unknownAgent', { to: 'trial', list: c.agents.team.filter((a) => !a.draft).map((a) => a.id).join(', ') }));
    expect(toLead).toContain('Here.');
    expect(engine.calls.map((x) => x.agent.id)).toEqual([owner, lead]);
  });

  it('is offered to the draft itself in its own conversation, which can call the agents of the team', async () => {
    const { c, lead } = setup();
    c.agents.team.push(newAgent({ id: 'trial', draft: true }));
    ensureAgentThread(forum, { id: 'trial', name: 'trial' }, 'en');
    const thread = agentThreadId('trial');
    const place = placeOfThread(forum.summary(thread), () => null, c)!;
    const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'Is the export doable?' }) as ForumMessage[];
    const engine = fakeEngine();
    engine.script('trial', async (call) => {
      await callAgent(call, lead, 'Is the export doable?');
      return { text: 'The lead answered.' };
    });
    engine.script(lead, () => ({ text: 'It fits.' }));
    const out = await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: ['trial'] });
    expect(out.map((a) => a.agent)).toEqual(['trial']);
    expect(engine.calls.map((x) => x.agent.id)).toEqual(['trial', lead]);
  });

  it('is not offered in a ceremony, whose answers are recorded elsewhere', async () => {
    const { c, owner, place, message } = setup();
    const engine = fakeEngine();
    engine.script(owner, (call) => ({ text: call.runnerTools?.length ? 'offered' : 'none' }));
    const out = await answerMentions({ ...place, kind: 'ceremony' }, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(out[0]?.text).toBe('none');
  });
});
