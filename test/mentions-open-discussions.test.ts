// `OpenDiscussions` in a conversation: an agent that is not the persona may leave one button under its answer, the discussions of a merge request named by project and
// number. The answer carries the button only when the agent offered one, a refused offer leaves none, and nothing is opened by the answer itself.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { type ForumMessage, agentThreadId } from '../src/shared/forum';
import { createForumStore, type ForumStore } from '../src/main/forum-core';
import { ensureAgentThread } from '../src/main/forum-channels';
import { OPEN_DISCUSSIONS_TOOL } from '../src/main/persona/openScreen';
import type { AgentCall } from '../src/main/agents';
import { fakeEngine } from './helpers/runner';

vi.mock('../src/main/agents', async (orig) => ({ ...(await orig<typeof import('../src/main/agents')>()), workspaceProjects: () => ['group/app'] }));

const { answerMentions } = await import('../src/main/mentions/answer');
const { placeOfThread } = await import('../src/main/mentions/place');

let dir: string;
let forum: ForumStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-open-discussions-'));
  forum = createForumStore(dir);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
  const c = neutralConfig();
  c.language = 'en';
  c.agents.team = c.agents.team.map((a) => ({ ...a, permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const }));
  c.projects.repos = [];
  const owner = c.agents.team[0].id;
  ensureAgentThread(forum, { id: owner, name: owner }, 'en');
  const thread = agentThreadId(owner);
  const place = placeOfThread(forum.summary(thread), () => null, c)!;
  const [message] = forum.append(thread, { kind: 'post', author: { type: 'person' }, text: 'Show me the discussions of group/app!7.' }) as ForumMessage[];
  return { c, owner, thread, place, message };
}

const offer = async (call: AgentCall, input: Record<string, unknown>): Promise<string> => {
  const tool = call.runnerTools?.find((x) => x.name === OPEN_DISCUSSIONS_TOOL);
  if (!tool) throw new Error('no OpenDiscussions offered');
  try {
    return String((await tool.run(input as never, {} as never)).response);
  } catch (e) {
    return `refused: ${(e as Error).message}`;
  }
};

const answerOf = (thread: string, owner: string): ForumMessage | undefined =>
  forum.read(thread, 0, 100)?.messages.filter((m) => m.author.type === 'agent' && m.author.id === owner).at(-1);

describe('an agent that is not the persona offers the discussions of a merge request', () => {
  it('posts its answer with the button, and the button is the only thing that would open the screen', async () => {
    const { c, owner, thread, place, message } = setup();
    const engine = fakeEngine();
    engine.script(owner, async (call) => {
      await offer(call, { project: 'group/app', number: 7 });
      return { text: 'The button below opens them.' };
    });
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(answerOf(thread, owner)?.buttons).toEqual([{ to: 'discussions', project: 'group/app', number: 7 }]);
  });

  it('posts an answer with no buttons when the agent offered none', async () => {
    const { c, owner, thread, place, message } = setup();
    const engine = fakeEngine();
    engine.script(owner, () => ({ text: 'Nothing to open.' }));
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(answerOf(thread, owner)?.buttons).toBeUndefined();
  });

  it('leaves no button for a project outside the workspace, and hands the reason back to the model', async () => {
    const { c, owner, thread, place, message } = setup();
    const engine = fakeEngine();
    let said = '';
    engine.script(owner, async (call) => {
      said = await offer(call, { project: 'other/app', number: 7 });
      return { text: 'That one is not of this workspace.' };
    });
    await answerMentions(place, message, { forum, config: () => c, engine, env: () => ({ fallbackCwd: dir }), calls: [owner] });
    expect(said).toMatch(/^refused: /);
    expect(said).toContain('other/app');
    expect(answerOf(thread, owner)?.buttons).toBeUndefined();
  });
});
