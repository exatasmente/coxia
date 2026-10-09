// The agent's screen reaches both engines through `runAgent` (acceptance 2 of #177): the Claude SDK gets the two servers and their allowed names, the open engine gets the tools by
// name, a call with no screen is the call of today, and the wrap-up that follows a call out of turns offers neither. The model is a fake on each path; the browser is the scripted one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Msg = Record<string, unknown> | ((options: Record<string, any>) => Promise<void>);
const calls: { prompt: string; options: Record<string, any> }[] = [];
let queue: Msg[][] = [];

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const { z } = await import('zod');
  return {
    query: ({ prompt, options }: { prompt: string; options: Record<string, any> }) => {
      calls.push({ prompt, options });
      const mine = queue.shift() ?? [];
      return (async function* () {
        for (const m of mine) {
          if (typeof m === 'function') await m(options);
          else yield m;
        }
      })();
    },
    // What the real functions hand back, as far as the app and the test need: the tool keeps its parts, the server keeps its tools.
    tool: (name: string, description: string, shape: Record<string, any>, handler: (args: unknown, extra: unknown) => Promise<unknown>) => ({ name, description, inputSchema: z.object(shape), handler }),
    createSdkMcpServer: (o: { name: string; tools: unknown[] }) => ({ type: 'sdk', name: o.name, tools: o.tools }),
  };
});

import { runAgent, obj, str } from '../src/main/agents';
import { type ScreenToolset, CONFIRM_TOOL_NAME } from '../src/main/browser/engineTool';
import { createHostsTally } from '../src/main/browser/hosts';
import { createIntermediary } from '../src/main/browser/intermediary';
import { createMaskSet } from '../src/main/browser/mask';
import { createStepLog } from '../src/main/browser/stepLog';
import { neutralConfig } from '../src/shared/config';
import { t } from '../src/shared/i18n';
import type { LlmProvider } from '../src/shared/config/types';
import { newAgent } from '../src/shared/config/team';
import { installEnvSecret } from './helpers/config';
import { fakeServer } from './helpers/browserServer';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

const done = (data: unknown): Msg[] => [
  { type: 'system', subtype: 'init', session_id: 's1' },
  { type: 'result', subtype: 'success', session_id: 's1', structured_output: data },
];
const turnsOut: Msg[] = [{ type: 'system', subtype: 'init', session_id: 's1' }, { type: 'result', subtype: 'error_max_turns', session_id: 's1' }];

const schema = obj({ fala: str });
const agent = newAgent({ id: 'web', permission: 'read' });
let cwd: string;

function toolset() {
  const server = fakeServer();
  const asked: unknown[] = [];
  const inter = createIntermediary({
    client: server.client,
    network: { mode: 'proxy', hosts: ['example.com'] },
    hosts: createHostsTally(),
    masks: createMaskSet(),
    log: createStepLog(),
    gate: { hold: async () => 'yes', passed: () => false },
    seesImages: true,
  });
  const set: ScreenToolset = {
    browser: inter,
    confirm: async (a) => {
      asked.push(a);
      return { answer: 'yes' };
    },
  };
  return { server, set, asked };
}

beforeAll(async () => {
  await installEnvSecret('llm.anthropic');
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const c = neutralConfig();
  c.llm.providers = [{ ...c.llm.providers[0], kind: 'anthropic', baseUrl: 'https://api.anthropic.com', id: 'llm-target' } as LlmProvider];
  c.llm.roles = Object.fromEntries(Object.entries(c.llm.roles).map(([role, model]) => [role, { ...model, provider: 'llm-target' }])) as typeof c.llm.roles;
  saveConfig(c);
  cwd = mkdtempSync(join(tmpdir(), 'agent-screen-'));
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));
beforeEach(() => {
  calls.length = 0;
  queue = [];
});

describe('the screen on the Claude SDK', () => {
  it('mounts the two servers and allows each tool by its name, and a tool of the server runs the app\'s browser', async () => {
    const { set, server, asked } = toolset();
    queue = [done({ fala: 'ok' })];
    await runAgent({ agent, prompt: 'p', schema, system: 's', cwd, label: 'web', maxTurns: 5, screen: set });
    const o = calls[0].options;
    expect(Object.keys(o.mcpServers).sort()).toEqual(['coxia_browser', 'coxia_screen']);
    const tools = [...o.mcpServers.coxia_browser.tools, ...o.mcpServers.coxia_screen.tools] as { name: string; handler: (a: unknown, e: unknown) => Promise<{ content: { text: string }[] }> }[];
    expect(tools.map((x) => x.name)).toContain(CONFIRM_TOOL_NAME);
    for (const x of tools) expect(o.allowedTools, x.name).toContain(`mcp__${x.name === CONFIRM_TOOL_NAME ? 'coxia_screen' : 'coxia_browser'}__${x.name}`);
    // The tools are the app's, not the server's: none of the refused ones is mounted.
    expect(tools.map((x) => x.name)).not.toEqual(expect.arrayContaining(['browser_evaluate']));
    const click = tools.find((x) => x.name === 'browser_click')!;
    await click.handler({ target: 'e4' }, {});
    expect(server.acts().map((c) => c.name)).toEqual(['browser_click']);
    const confirm = tools.find((x) => x.name === CONFIRM_TOOL_NAME)!;
    expect((await confirm.handler({ kind: 'send', words: 'send it' }, {})).content[0].text).toBe(t('main.browser.confirm.yes'));
    expect(asked).toEqual([{ confirmKind: 'send', words: 'send it' }]);
  });

  it('is the call of today when there is no screen: no server, no allowed name', async () => {
    queue = [done({ fala: 'ok' })];
    await runAgent({ agent, prompt: 'p', schema, system: 's', cwd, label: 'web', maxTurns: 5 });
    const o = calls[0].options;
    expect(o.mcpServers).toBeUndefined();
    expect(JSON.stringify(o.allowedTools)).not.toMatch(/coxia_browser|coxia_screen|browser_/);
  });

  it('offers a call with only the confirmation tool just that server', async () => {
    const { set } = toolset();
    queue = [done({ fala: 'ok' })];
    await runAgent({ agent, prompt: 'p', schema, system: 's', cwd, label: 'web', maxTurns: 5, screen: { confirm: set.confirm } });
    expect(Object.keys(calls[0].options.mcpServers)).toEqual(['coxia_screen']);
    expect(calls[0].options.allowedTools).toContain('mcp__coxia_screen__screen_confirm');
    expect(JSON.stringify(calls[0].options.allowedTools)).not.toContain('coxia_browser');
  });

  it('strips the screen from the wrap-up that answers after the turns ran out', async () => {
    const { set } = toolset();
    queue = [turnsOut, done({ fala: 'what I have' })];
    const r = await runAgent<{ fala: string }>({ agent, prompt: 'p', schema, system: 's', cwd, label: 'web', maxTurns: 5, wrapUp: true, screen: set });
    expect(r.partial).toBe(true);
    expect(calls[0].options.mcpServers).toBeDefined();
    expect(calls[1].options.mcpServers).toBeUndefined();
    expect(calls[1].options.allowedTools).toEqual([]);
  });
});

describe('the screen on the open engine', () => {
  let fake: Fake;
  let data: string;
  const realData = process.env.CERIMONIAS_DATA_DIR;
  beforeEach(async () => {
    data = mkdtempSync(join(tmpdir(), 'agent-screen-open-'));
    process.env.CERIMONIAS_DATA_DIR = data;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    process.env.CERIMONIAS_DATA_DIR = realData;
    await fake?.close();
    rmSync(data, { recursive: true, force: true });
  });

  it('offers the tools by name to the model, and runs the one it calls on the app\'s browser', async () => {
    const { set, server } = toolset();
    fake = await fakeOpenAI((req) => (req.n === 1 ? toolStep([{ id: 'c1', name: 'browser_navigate', args: { url: 'https://example.com/a' } }]) : toolStep([{ name: 'final_answer', args: { fala: 'opened' } }])));
    vi.stubEnv('COXIA_ENGINE', 'open');
    vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
    vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
    vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
    const r = await runAgent<{ fala: string }>({ agent, prompt: 'Open it.', schema, system: 's', cwd, label: 'web', maxTurns: 5, screen: set });
    expect(r.data.fala).toBe('opened');
    const offered = (fake.chats()[0].body as { tools: { function: { name: string } }[] }).tools.map((x) => x.function.name);
    expect(offered).toEqual(expect.arrayContaining(['browser_navigate', 'browser_snapshot', CONFIRM_TOOL_NAME]));
    expect(offered).not.toContain('browser_evaluate');
    expect(server.acts().map((c) => c.name)).toEqual(['browser_navigate']);
  });
});
