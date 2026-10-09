// The app's screen tools in both engines (acceptance 2 of #177): the tools come from one table, the open engine gets a ToolImpl for each and the Claude SDK a server with a zod shape
// made from the same rows, and the same calls give the same answers through either. The browser is the scripted fake of the intermediary's tests; no model, no network.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { HeldAnswer } from '../src/shared/browser';
import { setLanguage, t } from '../src/shared/i18n';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

import { EXPOSED_TOOLS, REFUSED_TOOLS, jsonSchemaOf, toolsFor } from '../src/main/browser/allowlist';
import { createScreenAsks } from '../src/main/browser/asks';
import { BROWSER_MCP_SERVER, CONFIRM_TOOL, CONFIRM_TOOL_NAME, SCREEN_MCP_SERVER, type ConfirmPort, type ScreenToolset, browserMcpServer, confirmPortFor, confirmToolImpl, rowsOf, screenMcpServer, screenMcpToolNames, screenToolImpls, screenToolNames, zodShapeOf } from '../src/main/browser/engineTool';
import { createHostsTally } from '../src/main/browser/hosts';
import { type HoldGate, createIntermediary } from '../src/main/browser/intermediary';
import { createMaskSet } from '../src/main/browser/mask';
import { createStepLog } from '../src/main/browser/stepLog';
import { ChatClient } from '../src/main/engine/open/client';
import { runOpen } from '../src/main/engine/open/loop';
import { ToolError, type ToolContext } from '../src/main/engine/open/tools/types';
import { fakeOpenAI, toolStep, type Fake } from './helpers/fakeOpenAI';
import { fakeServer } from './helpers/browserServer';

beforeEach(() => setLanguage('en'));

type SdkTool = { name: string; description: string; shape: Record<string, z.ZodTypeAny>; handler: (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }> };

/** The SDK's two functions as far as the shapes use them: `tool` keeps what it is given, and a server keeps its tools. */
const fakeParts = () => ({
  z,
  sdk: { tool: (name: string, description: string, shape: Record<string, z.ZodTypeAny>, handler: SdkTool['handler']): SdkTool => ({ name, description, shape, handler }) },
  server: (o: { name: string; tools: unknown[] }) => ({ type: 'sdk', name: o.name, tools: o.tools as SdkTool[] }),
});

/** A gate whose answers the test decides, in the order asked. */
function gateOf(answers: HeldAnswer[]): { gate: HoldGate; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    gate: {
      async hold(r) {
        asked.push(r.why);
        return answers.shift() ?? 'no';
      },
      passed: () => false,
    },
  };
}

function setup(over: { seesImages?: boolean; answers?: HeldAnswer[]; confirm?: ConfirmPort | null; network?: { mode: 'proxy' | 'off' | 'open'; hosts: string[] } } = {}) {
  const server = fakeServer();
  const g = gateOf(over.answers ?? []);
  const inter = createIntermediary({
    client: server.client,
    network: over.network ?? { mode: 'proxy', hosts: ['example.com'] },
    hosts: createHostsTally(),
    masks: createMaskSet(),
    log: createStepLog(),
    gate: g.gate,
    seesImages: over.seesImages ?? true,
  });
  const asked: unknown[] = [];
  const confirm: ConfirmPort | undefined =
    over.confirm === null
      ? undefined
      : (over.confirm ??
        (async (a) => {
          asked.push(a);
          return a.confirmKind === 'delete' ? { answer: 'no', note: 'not now' } : { answer: 'yes' };
        }));
  const set: ScreenToolset = { browser: inter, ...(confirm ? { confirm } : {}) };
  return { server, inter, set, held: g.asked, confirmed: asked };
}

const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({ cwd: '', roots: [], isSecret: () => false, secretGlobs: [], outputMax: 100_000, env: {}, bashPrefixes: [], ripgrep: 'off', ...over });

interface Answer {
  text: string;
  images: number;
  isError: boolean;
}

/** One call through the open engine's tool. */
async function throughOpen(set: ScreenToolset, name: string, args: unknown): Promise<Answer> {
  const impl = screenToolImpls(set).find((i) => i.name === name);
  if (!impl) throw new Error(`no ${name}`);
  try {
    const r = await impl.run(args as never, ctx());
    return { text: r.render(r.response), images: r.images?.length ?? 0, isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { text: e.message, images: 0, isError: true };
    throw e;
  }
}

/** The same call through the Claude SDK's servers: the zod shape checks the arguments first, as the SDK does. */
async function throughSdk(set: ScreenToolset, name: string, args: unknown): Promise<Answer> {
  const parts = fakeParts();
  const servers = { ...((await browserMcpServer(set, parts)) ?? {}), ...((await screenMcpServer(set, parts)) ?? {}) } as Record<string, { tools: SdkTool[] }>;
  const tool = Object.values(servers)
    .flatMap((s) => s.tools)
    .find((x) => x.name === name);
  if (!tool) throw new Error(`no ${name}`);
  const parsed = z.object(tool.shape).safeParse(args);
  if (!parsed.success) return { text: `schema: ${parsed.error.issues[0].path.join('.')}`, images: 0, isError: true };
  const r = await tool.handler(parsed.data, {});
  return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), images: r.content.filter((c) => c.type === 'image').length, isError: r.isError === true };
}

describe('the tools of the screen come from one table', () => {
  it('are the app\'s browser tools, the picture tool only for an engine that takes images, and the confirmation tool', () => {
    const blind = setup({ seesImages: false });
    expect(rowsOf(blind.set).map((r) => r.name)).toEqual([...toolsFor(false).map((r) => r.name), CONFIRM_TOOL_NAME]);
    expect(rowsOf(blind.set).map((r) => r.name)).not.toContain('browser_take_screenshot');
    const sighted = setup({ seesImages: true, confirm: null });
    expect(rowsOf(sighted.set).map((r) => r.name)).toEqual(EXPOSED_TOOLS.map((r) => r.name));
    expect(screenToolNames(sighted.set)).toContain('browser_take_screenshot');
  });

  it('builds the two servers with the real SDK from the same shapes', async () => {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    const parts = { z, sdk: sdk as unknown as ReturnType<typeof fakeParts>['sdk'], server: (o: { name: string; tools: unknown[] }) => sdk.createSdkMcpServer(o as Parameters<typeof sdk.createSdkMcpServer>[0]) };
    const { set } = setup();
    const browser = (await browserMcpServer(set, parts)) as Record<string, { type: string; name: string }>;
    const screen = (await screenMcpServer(set, parts)) as Record<string, { type: string; name: string }>;
    expect(browser[BROWSER_MCP_SERVER]).toMatchObject({ type: 'sdk', name: BROWSER_MCP_SERVER });
    expect(screen[SCREEN_MCP_SERVER]).toMatchObject({ type: 'sdk', name: SCREEN_MCP_SERVER });
  });

  it('offers none of the tools the app refuses, in either shape', () => {
    const { set } = setup();
    for (const name of REFUSED_TOOLS) {
      expect(screenToolNames(set), name).not.toContain(name);
      expect(screenMcpToolNames(set).map((n) => n.replace(/^mcp__[a-z_]+__/, '')), name).not.toContain(name);
    }
  });

  it('names the same tools for the open engine and for the Claude SDK, the SDK\'s under the two servers', () => {
    const { set } = setup();
    expect(screenToolNames(set)).toHaveLength(EXPOSED_TOOLS.length + 1);
    expect(screenMcpToolNames(set)).toEqual([...toolsFor(true).map((r) => `mcp__${BROWSER_MCP_SERVER}__${r.name}`), `mcp__${SCREEN_MCP_SERVER}__${CONFIRM_TOOL_NAME}`]);
    expect(screenMcpToolNames(set).map((n) => n.replace(/^mcp__[a-z_]+__/, ''))).toEqual(screenToolNames(set));
  });

  it('offers nothing for a call without a screen, and not the confirmation tool where it is not offered', async () => {
    expect(screenToolImpls({})).toEqual([]);
    expect(screenToolNames({})).toEqual([]);
    expect(await browserMcpServer({})).toBeNull();
    expect(await screenMcpServer({})).toBeNull();
    const noConfirm = setup({ confirm: null });
    expect(confirmToolImpl(noConfirm.set)).toBeNull();
    expect(await screenMcpServer(noConfirm.set, fakeParts())).toBeNull();
    expect(Object.keys((await browserMcpServer(noConfirm.set, fakeParts())) ?? {})).toEqual([BROWSER_MCP_SERVER]);
  });

  it('describes each tool the same in both shapes: the same words, the same properties, the same required ones', async () => {
    const { set } = setup();
    const impls = screenToolImpls(set);
    const parts = fakeParts();
    const servers = { ...((await browserMcpServer(set, parts)) ?? {}), ...((await screenMcpServer(set, parts)) ?? {}) } as Record<string, { tools: SdkTool[] }>;
    const sdk = Object.values(servers).flatMap((s) => s.tools);
    expect(sdk.map((x) => x.name)).toEqual(impls.map((i) => i.name));
    for (const row of rowsOf(set)) {
      const impl = impls.find((i) => i.name === row.name);
      const tool = sdk.find((x) => x.name === row.name);
      expect(impl?.description).toBe(row.description);
      expect(tool?.description).toBe(row.description);
      const json = jsonSchemaOf(row);
      expect(impl?.parameters).toEqual(json);
      // The shape the SDK turns into the model's schema names the same properties and requires the same ones.
      const made = z.toJSONSchema(z.object(zodShapeOf(z, row))) as { properties?: Record<string, { description?: string }>; required?: string[] };
      expect(Object.keys(made.properties ?? {}).sort(), row.name).toEqual(Object.keys(json.properties).sort());
      expect([...(made.required ?? [])].sort(), row.name).toEqual([...json.required].sort());
      for (const [key, prop] of Object.entries(row.properties)) expect(made.properties?.[key]?.description, `${row.name}.${key}`).toBe(prop.description);
    }
  });

  it('keeps the size limits and the ref pattern out of the SDK shape, so the app\'s own words answer on both engines', () => {
    const click = EXPOSED_TOOLS.find((r) => r.name === 'browser_click')!;
    const shape = z.object(zodShapeOf(z, click));
    expect(shape.safeParse({ target: 'button:has-text("Delete")' }).success).toBe(true);
    expect(shape.safeParse({ target: 7 }).success).toBe(false);
    expect(shape.safeParse({}).success).toBe(false);
    expect(z.object(zodShapeOf(z, CONFIRM_TOOL)).safeParse({ kind: 'steal', words: 'x' }).success).toBe(false);
  });
});

describe('the same calls through both shapes', () => {
  const calls: [string, string, unknown][] = [
    ['reads the page', 'browser_snapshot', {}],
    ['opens a listed address', 'browser_navigate', { url: 'https://example.com/a' }],
    ['refuses a host outside the list', 'browser_navigate', { url: 'https://other.example.org/' }],
    ['refuses a selector for a ref', 'browser_click', { target: 'button:has-text("Delete")' }],
    ['refuses an address that is not http', 'browser_navigate', { url: 'file:///etc/passwd' }],
    ['clicks a harmless control', 'browser_click', { target: 'e4' }],
    ['types into a field', 'browser_type', { target: 'e8', text: 'hello' }],
    ['finds a control', 'browser_find', { text: 'send' }],
    ['takes a screenshot', 'browser_take_screenshot', {}],
    ['confirms a step', CONFIRM_TOOL_NAME, { kind: 'send', words: 'send the report to the team' }],
    ['is told no on a step the person refused', CONFIRM_TOOL_NAME, { kind: 'delete', words: 'delete the old report' }],
    ['refuses a confirmation with a made-up kind', CONFIRM_TOOL_NAME, { kind: 'steal', words: 'x' }],
  ];

  it('give the same text, the same pictures and the same verdict, and reach the browser with the same calls', async () => {
    const open = setup({ answers: [] });
    const sdk = setup({ answers: [] });
    for (const [what, name, args] of calls) {
      const a = await throughOpen(open.set, name, args);
      const b = await throughSdk(sdk.set, name, args);
      // A kind the table lacks is refused by the shape of the SDK and by the table check of the open engine: the verdict is the same, the words are each engine's own.
      if (what === 'refuses a confirmation with a made-up kind') {
        expect([a.isError, b.isError], what).toEqual([true, true]);
        continue;
      }
      expect(b, what).toEqual(a);
    }
    expect(sdk.server.acts()).toEqual(open.server.acts());
    expect(open.server.acts().map((c) => c.name)).toEqual(['browser_navigate', 'browser_click', 'browser_type', 'browser_find', 'browser_take_screenshot']);
    expect(open.confirmed).toEqual(sdk.confirmed);
    expect(open.confirmed).toEqual([
      { confirmKind: 'send', words: 'send the report to the team' },
      { confirmKind: 'delete', words: 'delete the old report' },
    ]);
  });

  it('never forward an argument the table lacks: the open engine refuses it, and the zod shape of the SDK drops it before the app sees it', async () => {
    const open = setup();
    const sdk = setup();
    const args = { target: 'e4', filename: '/home/someone/.ssh/id_key' };
    expect((await throughOpen(open.set, 'browser_click', args)).isError).toBe(true);
    expect((await throughSdk(sdk.set, 'browser_click', args)).isError).toBe(false);
    expect(open.server.acts()).toEqual([]);
    expect(sdk.server.acts()).toEqual([{ name: 'browser_click', args: { target: 'e4' } }]);
  });

  it('say what the person decided, in words for the model', async () => {
    const { set } = setup();
    expect((await throughOpen(set, CONFIRM_TOOL_NAME, { kind: 'send', words: 'send it' })).text).toBe(t('main.browser.confirm.yes'));
    const no = await throughSdk(set, CONFIRM_TOOL_NAME, { kind: 'delete', words: 'delete it' });
    expect(no.text).toBe(`${t('main.browser.confirm.no')} ${t('main.browser.confirm.note', { note: 'not now' })}`);
    expect(no.isError).toBe(false);
    for (const answer of ['timeout', 'closed'] as const) {
      const quiet = setup({ confirm: async () => ({ answer }) });
      expect((await throughOpen(quiet.set, CONFIRM_TOOL_NAME, { kind: 'pay', words: 'pay' })).text).toBe(t(`main.browser.confirm.${answer}`));
    }
  });

  it('hold the same step the same way: the click that deletes waits for the person, and a no leaves the page alone', async () => {
    const open = setup({ answers: ['no'] });
    const sdk = setup({ answers: ['no'] });
    const a = await throughOpen(open.set, 'browser_click', { target: 'e22' });
    const b = await throughSdk(sdk.set, 'browser_click', { target: 'e22' });
    expect(a).toEqual({ text: t('main.browser.reason.declined'), images: 0, isError: true });
    expect(b).toEqual(a);
    expect(open.held).toEqual(['name']);
    expect(sdk.held).toEqual(['name']);
    expect(open.server.acts()).toEqual([]);
    expect(sdk.server.acts()).toEqual([]);
    // A yes does the step, once.
    const yes = setup({ answers: ['yes'] });
    expect((await throughSdk(yes.set, 'browser_click', { target: 'e22' })).isError).toBe(false);
    expect(yes.server.acts()).toHaveLength(1);
  });

  it('tell a model that takes no image so, instead of asking the browser for a picture', async () => {
    const { set, server } = setup();
    const impl = screenToolImpls(set).find((i) => i.name === 'browser_take_screenshot')!;
    const r = await impl.run({} as never, ctx({ seesImages: () => false }));
    expect(r.render(r.response)).toBe(t('main.browser.reason.noImages'));
    expect(server.acts()).toEqual([]);
  });

  it('stop a call that waits for the person when the screen closes', async () => {
    const ac = new AbortController();
    let aborted = false;
    const server = fakeServer();
    const inter = createIntermediary({
      client: server.client,
      network: { mode: 'proxy', hosts: ['example.com'] },
      hosts: createHostsTally(),
      masks: createMaskSet(),
      log: createStepLog(),
      gate: { hold: (_r, signal) => new Promise((resolve) => signal?.addEventListener('abort', () => ((aborted = true), resolve('closed')))), passed: () => false },
      seesImages: true,
    });
    const set: ScreenToolset = { browser: inter, signal: ac.signal };
    const pending = throughOpen(set, 'browser_click', { target: 'e22' });
    setTimeout(() => ac.abort(), 20);
    const r = await pending;
    expect(aborted).toBe(true);
    expect(r.isError).toBe(true);
    expect(server.acts()).toEqual([]);
  });
});

describe('the confirmation tool over the app\'s asks', () => {
  it('asks the person through the screen\'s own context and waits for the answer', async () => {
    const audit: unknown[] = [];
    const asks = createScreenAsks({ changed: () => undefined, audit: (e) => audit.push(e) });
    const pauses: string[] = [];
    const context = { key: 'call:general:web', agent: 'web', place: 'conversation' as const, pause: () => (pauses.push('pause'), () => void pauses.push('resume')) };
    const set: ScreenToolset = { confirm: confirmPortFor(asks, context) };
    const pending = throughOpen(set, CONFIRM_TOOL_NAME, { kind: 'pay', words: 'pay the invoice', site: 'billing.example.com' });
    await vi.waitFor(() => expect(asks.list()).toHaveLength(1));
    expect(asks.list()[0]).toMatchObject({ kind: 'confirm', key: 'call:general:web', agent: 'web', confirmKind: 'pay', agentWords: 'pay the invoice', site: 'billing.example.com' });
    expect(pauses).toEqual(['pause']);
    asks.answer(asks.list()[0].id, 'yes', 'window');
    expect(await pending).toEqual({ text: t('main.browser.confirm.yes'), images: 0, isError: false });
    expect(pauses).toEqual(['pause', 'resume']);
    expect(audit).toHaveLength(1);
  });
});

describe('the open engine\'s loop with the screen tools', () => {
  let data: string;
  let dir: string;
  let fake: Fake | null = null;
  const realData = process.env.CERIMONIAS_DATA_DIR;
  beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'coxia-screen-tools-data-'));
    dir = mkdtempSync(join(tmpdir(), 'coxia-screen-tools-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    process.env.CERIMONIAS_DATA_DIR = data;
  });
  afterEach(async () => {
    process.env.CERIMONIAS_DATA_DIR = realData;
    await fake?.close();
    fake = null;
    rmSync(data, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the tool a model calls by name, validates its arguments against the table\'s schema, and sends the answer back as the tool result', async () => {
    const { set, server } = setup({ answers: [] });
    fake = await fakeOpenAI([
      toolStep([{ id: 'c1', name: 'browser_navigate', args: { url: 'https://example.com/a' } }]),
      toolStep([{ id: 'c2', name: 'browser_click', args: { target: 'e4', filename: 'x' } }]),
      toolStep([{ id: 'c3', name: 'final_answer', args: { answer: 'done' } }]),
    ]);
    const r = await runOpen<{ answer: string }>({
      role: 'deep',
      prompt: 'Open the page.',
      schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false },
      client: new ChatClient({ baseUrl: fake.url, model: 'fake-model', retryDelayMs: 0 }),
      cwd: dir,
      allowedTools: screenToolNames(set),
      extraTools: screenToolImpls(set),
      maxTurns: 6,
      sessionsDir: join(dir, '.sessions'),
      ripgrep: 'off',
    });
    expect(r.data.answer).toBe('done');
    // The model was offered the tools by name, with the table's schema.
    const offered = (fake.chats()[0].body as { tools: { function: { name: string; parameters: unknown } }[] }).tools.map((x) => x.function.name);
    expect(offered).toEqual(expect.arrayContaining(['browser_navigate', 'browser_click', CONFIRM_TOOL_NAME]));
    // The first call reached the browser; the second had an argument the schema lacks and never did.
    expect(server.acts().map((c) => c.name)).toEqual(['browser_navigate']);
    const second = fake.chats()[2].body as { messages: { role: string; content: string }[] };
    const results = second.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(results[0]).toContain('example.com');
    expect(results[1]).toMatch(/filename|not allowed|additional/i);
  });
});
