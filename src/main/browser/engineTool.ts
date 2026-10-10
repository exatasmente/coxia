// i18n-lint: allow-file what the app's screen tools tell a model: English by design, like the other tool texts of the engines
import { CONFIRM_KINDS, type ConfirmKind } from '../../shared/browser';
import { HANDOFF_HELD_TEXT, HANDOFF_TEXT_MAX, type HandoffResult } from '../../shared/handoff';
import { t } from '../../shared/i18n';
import { loadClaudeSdkModule } from '../claudeSdk';
import { type ToolImpl, ToolError, clip } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';
import { type ExposedTool, type Prop, checkToolArguments, jsonSchemaOf } from './allowlist';
import type { AskContext, AskResult, ScreenAsks } from './asks';
import { type BrowserResult, problemText } from './intermediary';
import { resultText } from '../screen/handoff';
import type { TypedValues } from '../screen/typedValues';

// The app's screen tools in the shapes the two engines take them, built from one table: the tools of the app's browser (`allowlist.ts`, the app's own schemas), the
// confirmation tool (`screen_confirm`, below) and the hand-off tool (`screen_handoff`). The open engine gets a `ToolImpl` for each, with the JSON schema of the table; the Claude Agent SDK gets two in-process MCP servers,
// `coxia_browser` and `coxia_screen`, with a zod shape made from the same rows. Every call, in either shape, ends in the same two functions (`runBrowser`, `runConfirm`), so the
// two engines differ only in how the arguments arrive and how the answer is wrapped. Nothing here classifies, holds or masks: that is the intermediary's.

export const BROWSER_MCP_SERVER = 'coxia_browser';
export const SCREEN_MCP_SERVER = 'coxia_screen';
export const CONFIRM_TOOL_NAME = 'screen_confirm';
export const HANDOFF_TOOL_NAME = 'screen_handoff';
/**
 * How long the Claude SDK lets one of this server's tool calls run (ms): its largest value. The SDK's default is about 28 hours and an environment variable can lower it, but a
 * hand-off waits up to 15 minutes for the person and then as long as they hold the screen, so the server says its own bound and nothing shorter can cut a wait.
 */
export const HANDOFF_TOOL_TIMEOUT_MS = 2_147_483_647;
/** The name the Claude SDK knows a tool of a server by (`allowedTools`). */
export const screenMcpToolName = (server: string, name: string): string => `mcp__${server}__${name}`;

/** The app's browser, as an engine reaches it: the tools to offer and the way to run one. A lease's `browser` is exactly this. */
export interface BrowserPort {
  tools(): ExposedTool[];
  call(tool: string, args: unknown, options?: { signal?: AbortSignal; held?: () => boolean }): Promise<BrowserResult>;
}

/** Asks the person to confirm a step the agent is about to take. */
export type ConfirmPort = (ask: { confirmKind: ConfirmKind; words: string; site?: string }, signal?: AbortSignal) => Promise<AskResult>;

/** The hand-off as the tool reaches it: the request, and whether the person has the screen now. */
export interface HandoffPort {
  /** Asks the person for the screen and waits. Resolves with the result the agent is given, or null when the call ended and nobody is left to read one. */
  request(input: { what: string; why?: string }): Promise<HandoffResult | null>;
  /** The person holds the screen: the agent's other calls are refused. */
  active(): boolean;
}

/** What a call carries of the agent's screen: any tool may be absent. */
export interface ScreenToolset {
  /** The app's browser; absent when the agent has no app browser on this call. */
  browser?: BrowserPort;
  /** The confirmation tool; absent when the call is not one that is offered it. */
  confirm?: ConfirmPort;
  /** The hand-off tool; absent when the call has no screen the person could take. */
  handoff?: HandoffPort;
  /** What the person typed in this call's hand-offs, in memory (the masker, and whether there was one): the seam the procedure memory reads. Present with `handoff`. */
  typed?: TypedValues;
  /** Aborted when the screen closes: a call that waits for the person or the browser stops with it. */
  signal?: AbortSignal;
}

/** The confirmation tool's row. */
export const CONFIRM_TOOL: ExposedTool = {
  name: CONFIRM_TOOL_NAME,
  kind: 'act',
  description:
    'Asks the person to confirm a step that cannot be undone before you take it any way other than the browser tools: with your own script or command, on a site, in a service. It waits for the answer: send, save to an external service, delete, publish and pay are the cases. ' +
    'The app does not stop you from skipping it; the recording and the audit show what you did. Say the step in one sentence, as you would to the person.',
  properties: {
    kind: { type: 'string', enum: CONFIRM_KINDS, description: 'What the step does: send, save, delete, publish, pay, or other.' },
    words: { type: 'string', maxLength: 300, description: 'The step, in one sentence the person can decide on.' },
    site: { type: 'string', maxLength: 200, description: 'Optional: the site or service it acts on.' },
  },
  required: ['kind', 'words'],
};

/** The hand-off tool's row. */
export const HANDOFF_TOOL: ExposedTool = {
  name: HANDOFF_TOOL_NAME,
  kind: 'act',
  description:
    'Hands the screen to the person for something only they should do: a login, a code that reached their phone, a payment or any field whose value you must not see. It waits until the person gives the screen back, and answers with one sentence: done, declined, not responded in time, or not available. ' +
    'What the person types never reaches you, and while they have the screen your other calls are refused. After "done", read the page again and go on. After the other answers, stop and say what you could not do. Say in `what` what you need from the person, in one sentence.',
  properties: {
    what: { type: 'string', description: `What you need the person to do on the screen, in one sentence (at most ${HANDOFF_TEXT_MAX} characters; longer is cut).` },
    why: { type: 'string', description: `Optional: why, in one more sentence (at most ${HANDOFF_TEXT_MAX} characters).` },
  },
  required: ['what'],
};

/** The rows an engine is offered for a call: the browser's, then the confirmation tool, then the hand-off. */
export const rowsOf = (set: ScreenToolset): ExposedTool[] => [...(set.browser?.tools() ?? []), ...(set.confirm ? [CONFIRM_TOOL] : []), ...(set.handoff ? [HANDOFF_TOOL] : [])];

/** The names the open engine must have allowed for the tools to reach the model. */
export const screenToolNames = (set: ScreenToolset): string[] => rowsOf(set).map((r) => r.name);

/** The names the Claude SDK must have allowed. */
export const screenMcpToolNames = (set: ScreenToolset): string[] => [
  ...(set.browser?.tools() ?? []).map((r) => screenMcpToolName(BROWSER_MCP_SERVER, r.name)),
  ...(set.confirm ? [screenMcpToolName(SCREEN_MCP_SERVER, CONFIRM_TOOL_NAME)] : []),
  ...(set.handoff ? [screenMcpToolName(SCREEN_MCP_SERVER, HANDOFF_TOOL_NAME)] : []),
];

/** The confirmation tool over the app's asks, for a screen: it asks as the screen asks, with its clocks. */
export const confirmPortFor =
  (asks: Pick<ScreenAsks, 'confirm'>, context: AskContext): ConfirmPort =>
  (ask, signal) =>
    asks.confirm({ ...context, ...ask }, signal);

// ---- one run, whatever the shape --------------------------------------------------------------------------------------------------------------

interface Outcome {
  text: string;
  images: BrowserResult['images'];
  isError: boolean;
}

const merged = (...signals: (AbortSignal | undefined)[]): AbortSignal | undefined => {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  return live.length > 1 ? AbortSignal.any(live) : live[0];
};

/** One call of a browser tool. A tool the call does not have is a plain refusal, never a crash. */
export async function runBrowser(set: ScreenToolset, tool: string, args: unknown, signal?: AbortSignal): Promise<Outcome> {
  if (!set.browser) return { text: t('main.browser.reason.unknownTool'), images: [], isError: true };
  // The browser asks again when the call's turn comes: a call queued behind a slow one may start after the person took the screen.
  return set.browser.call(tool, args, { signal: merged(signal, set.signal), ...(set.handoff ? { held: set.handoff.active } : {}) });
}

/** The confirmation tool: the arguments are checked against its row, the person is asked, and the answer comes back in words for the model. */
export async function runConfirm(set: ScreenToolset, args: unknown, signal?: AbortSignal): Promise<Outcome> {
  if (!set.confirm) return { text: t('main.browser.reason.unknownTool'), images: [], isError: true };
  const checked = checkToolArguments(CONFIRM_TOOL, args);
  if (!checked.ok) return { text: problemText(checked.problem), images: [], isError: true };
  const a = checked.forward as { kind: ConfirmKind; words: string; site?: string };
  const r = await set.confirm({ confirmKind: a.kind, words: a.words, ...(a.site ? { site: a.site } : {}) }, merged(signal, set.signal));
  if (r.answer === 'yes' || r.answer === 'site') return { text: t('main.browser.confirm.yes'), images: [], isError: false };
  const why = r.answer === 'timeout' ? t('main.browser.confirm.timeout') : r.answer === 'closed' ? t('main.browser.confirm.closed') : t('main.browser.confirm.no') + (r.note ? ` ${t('main.browser.confirm.note', { note: r.note })}` : '');
  return { text: why, images: [], isError: false };
}

/**
 * The hand-off tool: the arguments are checked against its row, the person is asked, and the result comes back as one of four fixed sentences, nothing else. A call that ended while
 * it waited has no one to read an answer; it still gets the plainest one.
 */
export async function runHandoff(set: ScreenToolset, args: unknown): Promise<Outcome> {
  if (!set.handoff) return { text: t('main.browser.reason.unknownTool'), images: [], isError: true };
  const checked = checkToolArguments(HANDOFF_TOOL, args);
  if (!checked.ok) return { text: problemText(checked.problem), images: [], isError: true };
  const a = checked.forward as { what: string; why?: string };
  const result = await set.handoff.request({ what: a.what, ...(a.why ? { why: a.why } : {}) });
  return { text: resultText(result ?? 'unavailable'), images: [], isError: false };
}

/** While the person has the screen the agent's confirmation and a second hand-off are refused too: nothing it asks of the person is asked now. */
const heldOutcome = (): Outcome => ({ text: HANDOFF_HELD_TEXT, images: [], isError: true });

const run = (set: ScreenToolset, name: string, args: unknown, signal?: AbortSignal): Promise<Outcome> => {
  if ((name === CONFIRM_TOOL_NAME || name === HANDOFF_TOOL_NAME) && set.handoff?.active()) return Promise.resolve(heldOutcome());
  return name === CONFIRM_TOOL_NAME ? runConfirm(set, args, signal) : name === HANDOFF_TOOL_NAME ? runHandoff(set, args) : runBrowser(set, name, args, signal);
};

// ---- the open engine ----------------------------------------------------------------------------------------------------------------------------

function toolImpl(set: ScreenToolset, row: ExposedTool): ToolImpl {
  return {
    name: row.name,
    activity: 'screen',
    description: row.description,
    parameters: jsonSchemaOf(row) as unknown as Json,
    async run(input, ctx) {
      // A model the provider says takes no image is told so, as Read does.
      if (row.image && ctx.seesImages && !ctx.seesImages()) return { response: t('main.browser.reason.noImages'), render: (r) => String(r) };
      const r = await run(set, row.name, input, ctx.signal);
      if (r.isError) throw new ToolError(r.text);
      return {
        response: r.text,
        render: (x) => clip(String(x), ctx.outputMax),
        ...(r.images.length ? { images: r.images.map((i) => ({ path: 'screenshot', mediaType: i.mimeType, data: i.data })) } : {}),
      };
    },
  };
}

/** The browser's tools for the open engine. */
export const browserToolImpls = (set: ScreenToolset): ToolImpl[] => (set.browser?.tools() ?? []).map((row) => toolImpl(set, row));

/** The confirmation tool for the open engine; null when the call is not offered it. */
export const confirmToolImpl = (set: ScreenToolset): ToolImpl | null => (set.confirm ? toolImpl(set, CONFIRM_TOOL) : null);

/** The hand-off tool for the open engine; null when the call has no screen the person could take. */
export const handoffToolImpl = (set: ScreenToolset): ToolImpl | null => (set.handoff ? toolImpl(set, HANDOFF_TOOL) : null);

/** Everything a call of the open engine is offered of the screen. */
export const screenToolImpls = (set: ScreenToolset): ToolImpl[] => [...browserToolImpls(set), ...[confirmToolImpl(set), handoffToolImpl(set)].filter((x): x is ToolImpl => x !== null)];

// ---- the Claude Agent SDK -----------------------------------------------------------------------------------------------------------------------

/** What of zod and of the SDK the shapes need: injected, so a test can drive them without loading the real SDK. */
export interface SdkParts {
  z: typeof import('zod').z;
  sdk: {
    tool(name: string, description: string, shape: Record<string, never>, handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>): unknown;
  };
}

/**
 * A zod type for a row's property. It carries the type, the enum and the words, so the model reads the same schema as the open engine; the size limits and the pattern of a ref
 * are not repeated here, because the intermediary checks every call against the table and answers in the app's own words, the same for both engines.
 */
function zodOf(z: SdkParts['z'], prop: Prop): import('zod').ZodTypeAny {
  let type: import('zod').ZodTypeAny;
  switch (prop.type) {
    case 'string':
      type = prop.enum ? z.enum(prop.enum as unknown as [string, ...string[]]) : z.string();
      break;
    case 'number':
      type = z.number();
      break;
    case 'integer':
      type = z.number().int();
      break;
    case 'boolean':
      type = z.boolean();
      break;
    case 'array':
      type = z.array(prop.items ? zodOf(z, prop.items) : z.unknown());
      break;
    case 'object':
      type = z.object(shapeOf(z, prop.properties ?? {}, prop.required ?? []));
      break;
  }
  return type.describe(prop.description);
}

function shapeOf(z: SdkParts['z'], properties: Record<string, Prop>, required: readonly string[]): Record<string, import('zod').ZodTypeAny> {
  return Object.fromEntries(Object.entries(properties).map(([key, prop]) => [key, required.includes(key) ? zodOf(z, prop) : zodOf(z, prop).optional()]));
}

/** The zod shape of a row, the form `tool()` of the SDK takes. */
export const zodShapeOf = (z: SdkParts['z'], row: ExposedTool): Record<string, import('zod').ZodTypeAny> => shapeOf(z, row.properties, row.required);

const sdkResult = (r: Outcome): { content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]; isError?: true } => ({
  content: [{ type: 'text' as const, text: r.text }, ...r.images.map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))],
  ...(r.isError ? { isError: true as const } : {}),
});

const signalOf = (extra: unknown): AbortSignal | undefined => (extra && typeof extra === 'object' && (extra as { signal?: unknown }).signal instanceof AbortSignal ? (extra as { signal: AbortSignal }).signal : undefined);

/** The SDK tool definitions of the rows: one `tool()` each, over the zod shape of the row and the shared run. */
export function sdkTools(set: ScreenToolset, rows: ExposedTool[], parts: SdkParts): unknown[] {
  return rows.map((row) =>
    parts.sdk.tool(row.name, row.description, zodShapeOf(parts.z, row) as Record<string, never>, async (args, extra) => sdkResult(await run(set, row.name, args, signalOf(extra)))),
  );
}

/** The app's browser as an in-process MCP server; null when the call has none. */
export async function browserMcpServer(set: ScreenToolset, parts?: SdkParts & SdkServer): Promise<Record<string, unknown> | null> {
  const rows = set.browser?.tools() ?? [];
  if (!rows.length) return null;
  const p = parts ?? (await realParts());
  return { [BROWSER_MCP_SERVER]: p.server({ name: BROWSER_MCP_SERVER, tools: sdkTools(set, rows, p) }) };
}

/**
 * The confirmation and hand-off tools as an in-process MCP server; null when the call is offered neither. With the hand-off the server states its own tool-call bound, so the
 * wait for the person is not cut by the SDK's default or by an environment variable.
 */
export async function screenMcpServer(set: ScreenToolset, parts?: SdkParts & SdkServer): Promise<Record<string, unknown> | null> {
  const rows = [...(set.confirm ? [CONFIRM_TOOL] : []), ...(set.handoff ? [HANDOFF_TOOL] : [])];
  if (!rows.length) return null;
  const p = parts ?? (await realParts());
  return { [SCREEN_MCP_SERVER]: p.server({ name: SCREEN_MCP_SERVER, tools: sdkTools(set, rows, p), ...(set.handoff ? { timeout: HANDOFF_TOOL_TIMEOUT_MS } : {}) }) };
}

/** What of the SDK builds a server. */
interface SdkServer {
  server(options: { name: string; tools: unknown[]; timeout?: number }): unknown;
}

async function realParts(): Promise<SdkParts & SdkServer> {
  const sdk = await loadClaudeSdkModule();
  const { z } = await import('zod');
  return { z, sdk: sdk as unknown as SdkParts['sdk'], server: (options) => sdk.createSdkMcpServer(options as Parameters<typeof sdk.createSdkMcpServer>[0]) };
}

/**
 * Both servers for the Claude SDK, merged; null when there is nothing to offer or the SDK or zod cannot be loaded (the agent then runs without the screen tools, and
 * the caller says so).
 */
export async function screenMcpServers(set: ScreenToolset): Promise<Record<string, unknown> | null> {
  if (!set.browser && !set.confirm && !set.handoff) return null;
  try {
    const parts = await realParts();
    return { ...((await browserMcpServer(set, parts)) ?? {}), ...((await screenMcpServer(set, parts)) ?? {}) };
  } catch (e) {
    console.error('[browser] the screen tools are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}
