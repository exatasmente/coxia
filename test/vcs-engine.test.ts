import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { obj, str } from '../src/main/agents';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { VCS_READ_TOOL_NAME, vcsReadToolImpl } from '../src/main/vcs/engineTool';
import { buildRuntime } from '../src/main/vcs/runtime';
import { type FakeHost, fixture, noSleep, startFakeHost } from './helpers/fakeHost';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

// The VcsRead app tool inside the open engine's loop: offered only when allowed, read only, and a failing host reaches the model as text.

const BB = fixture<Record<string, any>>('bitbucket');
const schema = obj({ fala: str });
const finalCall = () => toolStep([{ id: 'final', name: 'final_answer', args: { fala: 'ok' } }]);

let dir: string;
let fake: Fake | null = null;
let host: FakeHost | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vcs-engine-'));
});
afterEach(async () => {
  await fake?.close();
  await host?.close();
  fake = null;
  host = null;
  rmSync(dir, { recursive: true, force: true });
});

async function runtime() {
  host = await startFakeHost({ 'GET /2.0/repositories/acme/app/issues/12': { json: BB.issue_12 }, 'GET /2.0/repositories/acme/app/issues/13': { status: 404, json: {} } });
  return buildRuntime({ id: 'bb', kind: 'bitbucket', host: 'bitbucket.org', apiUrl: `${host.url}/2.0`, user: '', secretRef: 'x', cli: null, preference: 'api', repos: [] }, { token: () => 'ana:pw', env: () => ({}), sleep: noSleep });
}

function params(f: Fake, rt: Awaited<ReturnType<typeof runtime>>, over: Partial<OpenRunParams> = {}): OpenRunParams {
  return {
    role: 'deep',
    prompt: 'Read the issue',
    schema,
    client: new ChatClient({ baseUrl: f.url, model: 'fake-model', retryDelayMs: 0 }),
    cwd: dir,
    allowedTools: [VCS_READ_TOOL_NAME],
    extraTools: [vcsReadToolImpl(() => rt.provider)],
    maxTurns: 6,
    sessionsDir: null,
    ripgrep: 'off',
    ...over,
  };
}

const toolNames = (f: Fake): string[] => ((f.chats()[0].body as Record<string, any>).tools as { function: { name: string } }[] | undefined)?.map((t) => t.function.name) ?? [];
const toolTexts = (f: Fake): string[] => ((f.chats()[1].body as Record<string, any>).messages as { role: string; content: string }[]).filter((m) => m.role === 'tool').map((m) => m.content);

describe('VcsRead in the open engine', () => {
  it('is offered when allowed, reads through the provider and feeds the answer back', async () => {
    const rt = await runtime();
    fake = await fakeOpenAI([toolStep([{ id: 'r1', name: VCS_READ_TOOL_NAME, args: { op: 'issue', project: 'acme/app', iid: 12 } }]), finalCall()]);
    const used: string[] = [];
    await runOpen(params(fake, rt, { events: { onToolUse: (n) => used.push(n) } }));
    expect(toolNames(fake)).toContain(VCS_READ_TOOL_NAME);
    expect(used).toEqual([VCS_READ_TOOL_NAME]);
    expect(toolTexts(fake)[0]).toContain('Export fails with accents');
    expect(host?.hits.map((h) => h.method)).toEqual(['GET']);
  });

  it('is not offered when the call does not allow it', async () => {
    const rt = await runtime();
    fake = await fakeOpenAI([finalCall()]);
    await runOpen(params(fake, rt, { allowedTools: ['Read'] }));
    expect(toolNames(fake)).not.toContain(VCS_READ_TOOL_NAME);
  });

  it('tells the model when the host or the arguments are wrong, and the run goes on', async () => {
    const rt = await runtime();
    fake = await fakeOpenAI([
      toolStep([
        { id: 'a', name: VCS_READ_TOOL_NAME, args: { op: 'issue', project: 'acme/app', iid: 13 } },
        { id: 'b', name: VCS_READ_TOOL_NAME, args: { op: 'merge', project: 'acme/app', iid: 12 } },
      ]),
      finalCall(),
    ]);
    const r = await runOpen<{ fala: string }>(params(fake, rt));
    expect(r.data.fala).toBe('ok');
    const texts = toolTexts(fake);
    expect(texts[0]).toMatch(/Não encontrado|erro da ferramenta/);
    expect(texts[1]).toMatch(/Requisição inválida|erro da ferramenta/);
    expect(host?.hits.every((h) => h.method === 'GET')).toBe(true);
  });
});
