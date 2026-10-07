// The mailbox of a stage that talks while it works, as the engines see it through the door: asked when the model finished a step, it hands over a queued
// message or says there is none at once. A door that waited for a message held every stage that ended a step with plain text until its idle limit (seen with a
// real model on the open engine in 0.8.0-beta.1), so the stage on the open engine below is wired to a real mailbox.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, agentHooks, obj, secretPath, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { runOpen } from '../src/main/engine/open/loop';
import { createForumStore } from '../src/main/forum-core';
import { openInbox } from '../src/main/runner/inbox';
import { type Fake, fakeOpenAI, textStep } from './helpers/fakeOpenAI';

const schema = obj({ texto: str });
const answer = { texto: 'feito' };

let dir: string;
let fake: Fake | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'runner-inbox-'));
  mkdirSync(join(dir, '.sessions'), { recursive: true });
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  rmSync(dir, { recursive: true, force: true });
});

const inboxIn = (d: string, runId = 'r-abc-0001') => openInbox(runId, 'triage', 'support', createForumStore(join(d, 'forum')), () => '2026-10-07T12:00:00.000Z');

describe('the mailbox of a working stage', () => {
  it('hands over what is queued, in order, and says at once when nothing is', () => {
    const inbox = inboxIn(dir);
    expect(inbox.take()).toBeNull();
    inbox.post('primeira');
    inbox.post('segunda');
    expect(inbox.take()).toBe('primeira');
    expect(inbox.take()).toBe('segunda');
    expect(inbox.take()).toBeNull();
    inbox.close();
  });

  it('hands nothing over once the stage is finishing or closed', () => {
    const inbox = inboxIn(dir);
    inbox.post('a tempo');
    inbox.closing();
    expect(inbox.take()).toBeNull();
    expect(inbox.post('tarde demais')).toBe(false);
    inbox.close();
    expect(inbox.take()).toBeNull();
  });
});

describe('a stage on the open engine wired to its mailbox', () => {
  it('ends a step of plain text with the final answer, without waiting for a message that is not coming', async () => {
    fake = await fakeOpenAI([textStep('A issue é clara; segue a triagem.'), textStep(JSON.stringify(answer))]);
    const inbox = inboxIn(dir);
    const r = await runOpen<typeof answer>({
      role: 'deep',
      prompt: 'Faça a triagem.',
      schema,
      client: new ChatClient({ baseUrl: fake.url, model: 'fake-model', retryDelayMs: 0 }),
      cwd: dir,
      allowedTools: ['Read'],
      hooks: agentHooks(),
      isSecret: (p) => secretPath(p, dir),
      secretGlobs: SECRET_GLOBS,
      maxTurns: 8,
      sessionsDir: join(dir, '.sessions'),
      ripgrep: 'off',
      // The door exactly as the executor builds it.
      incoming: async (delivered) => {
        const message = inbox.take();
        if (message !== null) delivered(message);
        return message;
      },
    });
    inbox.close();
    expect(r.data).toEqual(answer);
    // The second call is the collection: no tool, the model can only answer.
    expect(fake.chats()).toHaveLength(2);
    expect((fake.chats()[1].body as Record<string, unknown>).tools).toBeUndefined();
  }, 5000);
});
