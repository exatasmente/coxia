// The door of a stage that talks while it works, in both engines: a message handed over between two steps enters the session and the stage goes on (it does not
// restart), and the collection pass asks for the final answer with no tool at all, so a message in the middle never costs the stage its shape. Without the door
// the call is exactly the one of today: this file also pins that a call with no `incoming` never takes the collection pass.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRET_GLOBS, agentHooks, obj, secretPath, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { installLegacyConfig } from './helpers/config';
import { type Fake, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

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
});

await installLegacyConfig();
