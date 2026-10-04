// A `@agent` typed inside a ceremony: the named agent of the team answers inside the ceremony, read only, with the card under discussion as its context; the
// system agent keeps leading and takes over after; a failure does not bring the ceremony down.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ran = vi.hoisted(() => ({ calls: [] as { agent: string; prompt: string }[], fail: false as boolean, partial: false as boolean, maxTurns: [] as number[] }));

vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  runAgent: async (call: { agent: { id: string }; prompt: string; maxTurns: number }) => {
    if (ran.fail) throw new Error('the model went away');
    ran.calls.push({ agent: call.agent.id, prompt: call.prompt });
    ran.maxTurns.push(call.maxTurns);
    return { data: { text: `answer from ${call.agent.id}` }, ...(ran.partial ? { partial: true } : {}) };
  },
}));

const { updateConfig } = await import('../src/main/workspaceConfig');
const { neutralConfig } = await import('../src/shared/config');
const { answerCeremonyMentions } = await import('../src/main/mentions/ceremony');

beforeEach(() => {
  ran.calls.length = 0;
  ran.fail = false;
  ran.partial = false;
  ran.maxTurns.length = 0;
  const c = neutralConfig();
  c.language = 'en';
  updateConfig(() => c);
});

const ctx = { thread: 'app#7', ref: 'app#7', title: 'The thing', msgs: [{ who: 'me', text: 'what about it?' }] };

describe('the agents named inside a ceremony', () => {
  it('answer in the order named, read only, with the card under discussion', async () => {
    const out = await answerCeremonyMentions('@turn and @reply, what do you think?', ctx);
    expect(out.map((m) => m.agent)).toEqual(['turn', 'reply']);
    expect(out[0].text).toBe('answer from turn');
    expect(ran.calls.map((c) => c.agent)).toEqual(['turn', 'reply']);
    expect(ran.calls[0].prompt).toContain('what about it?');
  });

  it('call nobody when the text names no agent', async () => {
    expect(await answerCeremonyMentions('just a plain question', ctx)).toEqual([]);
    expect(ran.calls).toHaveLength(0);
  });

  it('answer at most three, whatever a fourth name says', async () => {
    const out = await answerCeremonyMentions('@turn @reply @deep @teams', ctx);
    expect(out.map((m) => m.agent)).toEqual(['turn', 'reply', 'deep']);
  });

  it('use the read-turn limit of the runner settings, and say a wrap-up answer may be incomplete', async () => {
    const c = neutralConfig();
    c.language = 'en';
    c.runner.turns.read = 6;
    updateConfig(() => c);
    ran.partial = true;
    const out = await answerCeremonyMentions('@turn help', ctx);
    expect(ran.maxTurns).toEqual([6]);
    expect(out[0].text).toContain('answer from turn');
    expect(out[0].text).toContain('partial answer');
    expect(out[0].speech).toBe('answer from turn');
  });

  it('do not bring the ceremony down when one of them fails', async () => {
    ran.fail = true;
    const out = await answerCeremonyMentions('@turn help', ctx);
    expect(out).toHaveLength(1);
    expect(out[0].agent).toBe('turn');
    expect(out[0].text).not.toBe('');
  });
});
