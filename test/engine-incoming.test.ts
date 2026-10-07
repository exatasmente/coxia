// The door of a stage that talks while it works, in both engines: a message handed over between two steps enters the session and the stage goes on (it does not
// restart), and the collection pass asks for the final answer with no tool at all, so a message in the middle never costs the stage its shape. Without the door
// the call is exactly the one of today: this file also pins that a call with no `incoming` never takes the collection pass.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRET_GLOBS, agentHooks, obj, secretPath, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import type { ToolImpl } from '../src/main/engine/open/tools/types';
import { installLegacyConfig } from './helpers/config';
import { type Fake, errorStep, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

type Turn = object[];
const sdkCalls: { prompt: unknown; options: Record<string, unknown> }[] = [];
const sdkSeen: string[] = [];
let sdkTurns: Turn[][] = [];

// The SDK mock hands the prompt as the call made it (a string, or the stream of a call that talks while it works). A string prompt yields one turn; a stream
// yields one turn per user message it carries, like the SDK's streaming input keeps the session alive between turns.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: { prompt: unknown; options: Record<string, unknown> }) => {
    sdkCalls.push({ prompt, options });
    const turns = sdkTurns.shift() ?? [];
    return (async function* () {
      if (typeof prompt === 'string') {
        yield* ((turns[0] ?? []) as object[]);
        return;
      }
      let i = 0;
      for await (const message of prompt as AsyncIterable<{ message: { content: string } }>) {
        sdkSeen.push(message.message.content);
        yield* ((turns[i] ?? []) as object[]);
        i++;
      }
    })();
  },
}));

const init = (id: string) => ({ type: 'system', subtype: 'init', session_id: id });
const result = (subtype: string, id: string, structured?: unknown) => ({
  type: 'result',
  subtype,
  session_id: id,
  ...(structured === undefined ? {} : { structured_output: structured }),
});

const schema = obj({ texto: str });
const answer = { texto: 'feito' };
const finalCall = (args: object = answer, id = 'call_final') => toolStep([{ id, name: 'final_answer', args }]);

let dir: string;
let sessions: string;
let fake: Fake | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'engine-incoming-'));
  sessions = join(dir, '.sessions');
  mkdirSync(sessions, { recursive: true });
  sdkCalls.length = 0;
  sdkSeen.length = 0;
  sdkTurns = [];
});

afterEach(async () => {
  await fake?.close();
  fake = null;
  rmSync(dir, { recursive: true, force: true });
});

const clientFor = (f: Fake) => new ChatClient({ baseUrl: f.url, model: 'fake-model', retryDelayMs: 0 });

function params(f: Fake, over: Partial<OpenRunParams> = {}): OpenRunParams {
  return {
    role: 'deep',
    prompt: 'Trabalhe a etapa.',
    schema,
    client: clientFor(f),
    cwd: dir,
    allowedTools: ['Read'],
    hooks: agentHooks(),
    isSecret: (p) => secretPath(p, dir),
    secretGlobs: SECRET_GLOBS,
    maxTurns: 8,
    sessionsDir: sessions,
    ripgrep: 'off',
    ...over,
  };
}

describe('the open engine, a stage that talks while it works', () => {
  it('hands the message over as a user turn between two steps and keeps the final answer', async () => {
    fake = await fakeOpenAI([
      textStep('vou começar'),
      textStep(JSON.stringify(answer)),
    ]);
    const delivered: string[] = [];
    const queue = ['use o helper existente'];
    const r = await runOpen<typeof answer>(
      params(fake, {
        incoming: async (onDelivered) => {
          const next = queue.shift() ?? null;
          if (next !== null) onDelivered(next);
          return next;
        },
        events: { onInterim: (text) => delivered.push(text) },
      }),
    );
    // The message entered the dialog as a user message, between the first response and the final one, and the answer still comes out of the schema.
    const body = fake.chats()[1].body as Record<string, any>;
    const user = (body.messages as { role: string; content: string }[]).filter((m) => m.role === 'user');
    expect(user.at(-1)!.content).toContain('use o helper existente');
    expect(user.at(-1)!.content).toContain('<data>');
    expect(delivered.some((text) => text.includes('use o helper existente'))).toBe(true);
    expect(r.data).toEqual(answer);
  });

  it('asks the collection pass with no tool at all and no message to hand over', async () => {
    fake = await fakeOpenAI([textStep('terminei'), textStep(JSON.stringify(answer))]);
    const r = await runOpen<typeof answer>(
      params(fake, {
        incoming: async () => null,
      }),
    );
    expect(r.data).toEqual(answer);
    // The collection call offers no tool: the model can only answer.
    const collect = fake.chats()[1].body as Record<string, any>;
    expect(collect.tools).toBeUndefined();
    const last = (collect.messages as { role: string; content: string }[]).at(-1)!;
    expect(last.content).toMatch(/resposta final/i);
  });

  it('without the door the call is the one of today: no extra turn and no collection', async () => {
    fake = await fakeOpenAI([finalCall()]);
    const r = await runOpen<typeof answer>(params(fake));
    expect(r.data).toEqual(answer);
    expect(fake.chats()).toHaveLength(1);
    expect((fake.chats()[0].body as Record<string, any>).tools).toBeDefined();
  });

  it('does not take the text of a step as the answer: the collection asks for it again, with no tool', async () => {
    // The model answers the message ("use the existing helper") with a text that is not the schema, and the stage must not end with that text: the collection
    // asks for the answer once more, without a tool, and only what comes out of that call is the result of the stage.
    fake = await fakeOpenAI([textStep('vou usar o helper existente'), textStep('isto não é a resposta'), textStep(JSON.stringify(answer))]);
    const queue = ['use o helper existente'];
    const r = await runOpen<typeof answer>(
      params(fake, {
        incoming: async (onDelivered) => {
          const next = queue.shift() ?? null;
          if (next !== null) onDelivered(next);
          return next;
        },
      }),
    );
    expect(r.data).toEqual(answer);
    // The third call is the collection: no tool offered, and it carries the final-answer instruction.
    const collect = fake.chats()[2].body as Record<string, any>;
    expect(collect.tools).toBeUndefined();
    expect((collect.messages as { role: string; content: string }[]).at(-1)!.content).toMatch(/resposta final/i);
  });

  it('delivers a message in the middle of a plain JSON flow and keeps the schema', async () => {
    fake = await fakeOpenAI([textStep('texto solto'), textStep(JSON.stringify(answer))]);
    const queue = ['olha isto'];
    const r = await runOpen<typeof answer>(
      params(fake, {
        structured: 'response_format',
        capabilities: { jsonSchema: true },
        incoming: async (d) => {
          const next = queue.shift() ?? null;
          if (next !== null) d(next);
          return next;
        },
      }),
    );
    expect(r.data).toEqual(answer);
    expect((fake.chats()[1].body as Record<string, any>).messages.some((m: { content?: string }) => String(m.content ?? '').includes('olha isto'))).toBe(true);
  });

  it('delivers a message already queued when the step answers the schema', async () => {
    // The step is a good answer to the schema and there is a message waiting: the message is due all the same, so the door is asked when the step ends and not
    // only when the text does not follow the schema. Without it the stage would end here, with the message never handed over nor announced.
    fake = await fakeOpenAI([textStep(JSON.stringify(answer)), textStep(JSON.stringify({ texto: 'com o helper' }))]);
    const delivered: string[] = [];
    const queue = ['use o helper existente'];
    const r = await runOpen<typeof answer>(
      params(fake, {
        incoming: async (d) => {
          const next = queue.shift() ?? null;
          if (next !== null) {
            delivered.push(next);
            d(next);
          }
          return next;
        },
      }),
    );
    expect(r.data).toEqual({ texto: 'com o helper' });
    expect(delivered).toEqual(['use o helper existente']);
    // Three calls: the step, the step that answered the message, and the closing one that asks for the result. The message went in before any closing call.
    const chats = fake.chats();
    expect(chats).toHaveLength(3);
    expect((chats[1].body as Record<string, any>).messages.some((m: { content?: string }) => String(m.content ?? '').includes('use o helper existente'))).toBe(true);
    expect((chats[2].body as Record<string, any>).tools).toBeUndefined();
  });

  it('takes a model that only posts notes for three steps as done, and asks for the answer with no tool', async () => {
    // A real model behind the open engine finished its work and kept announcing it with SendMessage, step after step, never ending the stage.
    const notes: string[] = [];
    const note: ToolImpl = { name: 'SendMessage', description: 'Posts a note.', parameters: { type: 'object', properties: { text: { type: 'string' } } }, note: true, async run(input) { notes.push(String(input.text)); return { response: 'Message delivered.', render: String }; } };
    const said = (n: number) => toolStep([{ id: `call_note_${n}`, name: 'SendMessage', args: { text: `etapa concluída ${n}` } }]);
    fake = await fakeOpenAI([said(1), said(2), said(3), textStep(JSON.stringify(answer)), said(4)]);
    const r = await runOpen<typeof answer>(params(fake, { allowedTools: ['Read', 'SendMessage'], extraTools: [note], incoming: async () => null }));
    expect(r.data).toEqual(answer);
    expect(notes).toEqual(['etapa concluída 1', 'etapa concluída 2', 'etapa concluída 3']);
    // The fourth call is the collection: no tool offered, so the model can only answer.
    expect(fake.chats()).toHaveLength(4);
    expect((fake.chats()[3].body as Record<string, any>).tools).toBeUndefined();
  });

  it('counts only notes in a row: a step that does other work starts the count again', async () => {
    writeFileSync(join(dir, 'a.txt'), 'conteúdo');
    const note: ToolImpl = { name: 'SendMessage', description: 'Posts a note.', parameters: { type: 'object', properties: { text: { type: 'string' } } }, note: true, async run() { return { response: 'Message delivered.', render: String }; } };
    const said = (n: number) => toolStep([{ id: `call_note_${n}`, name: 'SendMessage', args: { text: `nota ${n}` } }]);
    const read = toolStep([{ id: 'call_read', name: 'Read', args: { file_path: join(dir, 'a.txt') } }]);
    fake = await fakeOpenAI([said(1), said(2), read, said(3), said(4), textStep('terminei'), textStep(JSON.stringify(answer))]);
    const r = await runOpen<typeof answer>(params(fake, { allowedTools: ['Read', 'SendMessage'], extraTools: [note], incoming: async () => null }));
    expect(r.data).toEqual(answer);
    // Two notes, a read, two notes: never three notes in a row, so every step kept its tools until the model ended the step with a text.
    expect(fake.chats()).toHaveLength(7);
    expect((fake.chats()[5].body as Record<string, any>).tools).toBeDefined();
    expect((fake.chats()[6].body as Record<string, any>).tools).toBeUndefined();
  });

  it('asks the door once per step and never after the closing call', async () => {
    fake = await fakeOpenAI([textStep('a resposta'), textStep('{"texto": "feito"}')]);
    let asked = 0;
    const r = await runOpen<typeof answer>(
      params(fake, {
        structured: 'prompt',
        incoming: async () => {
          asked++;
          return null;
        },
      }),
    );
    expect(r.data).toEqual(answer);
    // The closing call is the answer: the door is not asked again after it, so a message that arrives then cannot enter the session after the result was given.
    expect(asked).toBe(1);
    // The closing call carries the schema's format, and the last word of the dialog is the instruction to answer it.
    const chats = fake.chats();
    expect(chats).toHaveLength(2);
    expect((chats[1].body as Record<string, any>).response_format).toBeDefined();
    expect(((chats[1].body as Record<string, any>).messages as { content: string }[]).at(-1)!.content).toMatch(/resposta final/i);
  });

  it('gives the model one round to fix a text that did not follow the schema, before the stage fails', async () => {
    // A stage on a server that refuses the response format: the closing call cannot force the shape, so the errors of the model's own text go back into the
    // dialog and the next step has a chance to fix it. Without the round the stage would fail on whatever the model wrote first.
    // The design of the `prompt` strategy, pinned here: the step's text is a candidate result, the door is asked when the step ends, and the collection is asked
    // before anything is concluded. Whatever the collection returned counts, so the second step of the script is the collection — its text is outside the schema
    // — and the third step is the step of the loop that carries the errors back and answers to the schema, with the stage's own tools offered again.
    fake = await fakeOpenAI([textStep('prosa que não é o formato'), textStep('ainda em prosa'), textStep('{"texto": "feito"}')]);
    const client = clientFor(fake);
    client.learned.dropParams.add('response_format');
    const r = await runOpen<typeof answer>(params(fake, { client, incoming: async () => null }));
    expect(r.data).toEqual(answer);
    const chats = fake.chats();
    expect(chats).toHaveLength(3);
    const last = chats.at(-1)!.body as Record<string, any>;
    expect((last.messages as { content: string }[]).some((m) => /formato/i.test(m.content))).toBe(true);
    // The closing call offers the tools of the stage again: it is the next step of the model, not the collection.
    expect(last.tools).toBeDefined();
  });

  it('without the door the call is the one of today: no extra turn and no collection', async () => {
    fake = await fakeOpenAI([finalCall()]);
    const r = await runOpen<typeof answer>(params(fake));
    expect(r.data).toEqual(answer);
    expect(fake.chats()).toHaveLength(1);
    expect((fake.chats()[0].body as Record<string, any>).tools).toBeDefined();
  });
});

describe('the Claude SDK engine, a stage that talks while it works', () => {
  const request = (over: Record<string, unknown> = {}) => ({
    role: 'deep' as const,
    prompt: 'Trabalhe a etapa.',
    schema,
    target: { role: 'deep' as const, providerId: 'anthropic', engine: 'claude-sdk' as const, model: 'sonnet', kind: 'anthropic' as const, baseUrl: '', headers: {}, secretRef: null, capabilities: null, structured: 'auto' as const, maxOutputTokens: null, temperature: null, timeoutMs: null, modelRole: 'deep' as const, envFile: null, options: {}, legacyCustomEndpoint: false },
    system: 'Você é o agente.',
    cwd: dir,
    allowedTools: ['Read'],
    extraDirs: [],
    shell: { rules: [], patterns: [] },
    extra: { maxTurns: 8 },
    ...over,
  });

  it('keeps the session open, hands the message over and collects the final answer', async () => {
    const { runnerFor } = await import('../src/main/engine/registry');
    await import('../src/main/agents');
    sdkTurns = [
      [
        [init('s1'), result('success', 's1')],
        [result('success', 's1', answer)],
      ],
    ];
    const delivered: string[] = [];
    const queue = ['use o helper existente'];
    const r = await runnerFor(request().target)<typeof answer>(
      request({
        incoming: async (onDelivered: (t: string) => void) => {
          const next = queue.shift() ?? null;
          if (next !== null) {
            delivered.push(next);
            onDelivered(next);
          }
          return next;
        },
      }) as never,
    );
    expect(r.data).toEqual(answer);
    expect(delivered).toEqual(['use o helper existente']);
    // One call, one session: the process was not restarted to deliver the message.
    expect(sdkCalls).toHaveLength(1);
    // The message went in as a user message of the same session, after the first turn.
    expect(sdkSeen[0]).toContain('Trabalhe a etapa.');
    expect(sdkSeen.at(-1)).toContain('use o helper existente');
  });

  it('without the door the SDK call is the one of today, with the prompt as a string', async () => {
    const { runnerFor } = await import('../src/main/engine/registry');
    await import('../src/main/agents');
    sdkTurns = [[[init('s1'), result('success', 's1', answer)]]];
    const r = await runnerFor(request().target)<typeof answer>(request() as never);
    expect(r.data).toEqual(answer);
    expect(sdkCalls[0].prompt).toBe('Trabalhe a etapa.');
  });

  it('hands a queued message over when the turn already answered, and asks the door only while the session is open', async () => {
    // The first turn answers in the schema and a message is waiting: it is handed over all the same, before any closing call, and the result is the answer of the
    // turn that came after it. The door is not asked again once the closing call went in, so no message enters the session behind the stage's result.
    const { runnerFor } = await import('../src/main/engine/registry');
    await import('../src/main/agents');
    sdkTurns = [
      [
        [init('s1'), result('success', 's1', answer)],
        [result('success', 's1', { texto: 'com o helper' })],
      ],
    ];
    const delivered: string[] = [];
    const queue = ['use o helper existente'];
    let asked = 0;
    const r = await runnerFor(request().target)<typeof answer>(
      request({
        incoming: async (onDelivered: (t: string) => void) => {
          asked++;
          const next = queue.shift() ?? null;
          if (next !== null) {
            delivered.push(next);
            onDelivered(next);
          }
          return next;
        },
      }) as never,
    );
    expect(r.data).toEqual({ texto: 'com o helper' });
    expect(delivered).toEqual(['use o helper existente']);
    expect(asked).toBe(2);
    // The message went in before the closing instruction, in the same session.
    const opened = sdkSeen.filter((t) => t.includes('use o helper existente') || t.includes('resposta final'));
    expect(opened[0]).toContain('use o helper existente');
    expect(sdkCalls).toHaveLength(1);
  });
});

await installLegacyConfig();
