// The agent loop of the open engine: model call, tool calls (in parallel), results back, until the final answer. It offers the same
// contract as runOnce in agents.ts: a role, a prompt, an optional json_schema answer, maxTurns, resume by session id, a sources list.
import { randomUUID } from 'node:crypto';
import { type ChatClient } from './client';
import {
  type DocSources,
  type AgentDef,
  buildSystemPrompt,
  discoverClaudeMd,
  docIndex,
  loadAgentDefs,
  loadClaudeMd,
  loadSkills,
  skillTool,
} from './context';
import { EngineError } from './errors';
import { type MemberParams, type OpenPool, type PoolMember, type PoolSwitch, type Tuning, PoolClient, activityOf, weigh } from './pool';
import { scrubbedEnv } from '../guard';
import { type SdkHooks, policyFromHooks } from './policy';
import { describeErrors, prune, validate } from './schema';
import { type SessionLine, type UsageRecord, appendLines, messagesOf, readSession } from './session';
import { estimateTokens, parseToolArguments, repairJson, toApiName } from './text';
import { bashToolFor } from './tools/bash';
import { type McpServerConfig, loadMcpConfigs, mcpTools } from './tools/mcp';
import { readTool } from './tools/read';
import { editTool, writeTool } from './tools/write';
import { globTool, grepTool } from './tools/search';
import { type ToolContext, type ToolImage, type ToolImpl, ToolError } from './tools/types';
import type { ChatMessage, Completion, ContentPart, Json, ToolCall, ToolChoice, ToolDef } from './types';
import type { Activity, PoolMode } from '../../../shared/config/types';
import { effectivePoolMode } from '../../../shared/config/poolMode';
import { type SubKind, MUTATING_KINDS, KIND_TURNS, isSubKind, modelOfKind, offeredKinds, toolsOfKind } from './subagent';
import { t } from '../../../shared/i18n';
import { incomingActivity, incomingText } from '../incoming';

/** Steps in a row of nothing but notes after which a model is taken as done (see `ToolImpl.note`). */
const NOTE_STEPS_MAX = 3;

export type StructuredStrategy = 'auto' | 'response_format' | 'tool' | 'prompt';

export interface Capabilities {
  // false: the server cannot do tool calls. Unknown (undefined) is tried.
  tools?: boolean;
  // true: response_format json_schema works (from the probe).
  jsonSchema?: boolean;
  contextWindow?: number;
  // false: the model does not take images, so Read says so instead of attaching one. Unknown (undefined) is tried, and a refusal is learned.
  images?: boolean;
}

export interface RunEvents {
  onSession?: (id: string) => void;
  onToolUse?: (name: string, input: Json) => void;
  onToolResult?: (name: string, isError: boolean) => void;
  onUsage?: (u: UsageRecord & { sessionId: string; role: string; model: string }) => void;
  onText?: (text: string) => void;
  // A piece of the model's reasoning stream: a sign of life while it thinks before it says anything.
  onReasoning?: (text: string) => void;
  // What the model said alongside tool calls it is about to make (its narration between steps); never the final answer.
  onInterim?: (text: string) => void;
  // The call moved to another model of the role's pool (it was busy, or the turn is for an activity the first one does not serve).
  onSwitch?: (e: PoolSwitch) => void;
  // A call waits in the server's queue (the flex tier): a sign of life every so often, though the model says nothing.
  onWait?: () => void;
}

export interface OpenRunParams {
  role: string;
  prompt: string;
  // JSON Schema of the final answer; without it the final text is the answer.
  schema?: Json;
  client: ChatClient;
  // The spare models of the role and the lists of its activities; without it `client` is the only model and nothing changes.
  pool?: OpenPool;
  // A sub-agent shares the pool of its parent, and with it the model in use.
  poolClient?: PoolClient;
  // The activity of the first turn: a stage starts as `write`, a sub-agent as `explore`.
  startActivity?: Activity;
  // A sub-agent handed a task in `delegate` mode: it has only the tools of this kind that its parent has.
  kind?: SubKind;
  capabilities?: Capabilities;
  // What `client`'s model may be sent beyond the protocol (the tier, the effort, fail-fast), as its provider and the catalog allow; a model of the pool has its own.
  params?: MemberParams;
  // What the call is for: a call nobody waits for may use the cheaper tier, and the effort of each activity.
  tuning?: Tuning;
  structured?: StructuredStrategy;
  cwd: string;
  additionalDirectories?: string[];
  // Appended to the system prompt, like systemPrompt.append of the SDK.
  systemAppend?: string;
  // Same vocabulary as the SDK options: Read, Grep, Glob, Skill, Agent, Bash(prefix:*), mcp__server__tool.
  allowedTools: string[];
  disallowedTools?: string[];
  // tools: [] of the SDK: no tool at all (the final answer still works).
  noTools?: boolean;
  // The folder an agent that writes may change: with it, Write and Edit are offered when allowed, and the commands run with a scrubbed environment.
  writeRoot?: string;
  writeReserved?: readonly string[];
  writeAllow?: readonly string[];
  // The workspace lifted the fence of its runs: Write and Edit may land anywhere, `.git`, hooks and secrets still refused.
  writeAnywhere?: boolean;
  hooks?: SdkHooks;
  // Tools the app itself provides (in-process, not shell or MCP); one is offered when its name is in allowedTools.
  extraTools?: ToolImpl[];
  isSecret?: (path: string) => boolean;
  secretGlobs?: string[];
  docs?: DocSources;
  maxTurns: number;
  resume?: string;
  // Where the JSONL transcripts live; null keeps the session in memory only.
  sessionsDir: string | null;
  shellEnv?: Record<string, string>;
  signal?: AbortSignal;
  ripgrep?: 'auto' | 'off';
  toolOutputMax?: number;
  events?: RunEvents;
  // How a tool call shows up in the sources list.
  describeTool?: (name: string, input: Json) => string;
  // The door of a stage that talks while it works (see EngineRequest.incoming): a message delivered between two steps restarts the loop with it in the dialog.
  incoming?: (delivered: (text: string) => void) => Promise<string | null>;
  // Shared by sub-agents so their reads count as the parent's sources.
  sources?: string[];
  depth?: number;
  now?: () => Date;
}

export interface OpenRunResult<T> {
  data: T;
  sessionId: string;
  sources: string[];
  usage: UsageRecord;
  turns: number;
  strategy: 'response_format' | 'tool' | 'prompt' | 'text';
}

export class OpenMaxTurnsError extends Error {
  constructor(
    readonly sessionId: string,
    readonly sources: string[],
  ) {
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    super('agent ended with error_max_turns');
  }
}

const FINAL = 'final_answer';
const finalizePrompt = (): string => t('main.engine.text.finalize');

function defaultDescribe(name: string, input: Json): string {
  const detail = input.command ?? input.file_path ?? input.pattern ?? input.skill ?? input.iid ?? input.issue_iid ?? input.mr_iid ?? input.merge_request_iid ?? '';
  return `${name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '')} ${String(detail)}`.trim();
}

function bareNames(list: string[] | undefined): Set<string> {
  return new Set((list ?? []).filter((t) => !t.includes('(')));
}

export function bashPrefixesOf(allowed: string[]): string[] {
  const out: string[] = [];
  for (const a of allowed) {
    const m = /^Bash\((.*?)(?::\*)?\)$/.exec(a);
    if (m) out.push(m[1]);
  }
  return out;
}

interface Delegation {
  /** The kinds the `Agent` tool offers; empty: the tool is the plain read-only sub-agent. */
  kinds: SubKind[];
}

async function buildTools(
  p: OpenRunParams,
  skills: ReturnType<typeof loadSkills>,
  agents: AgentDef[],
  runAgent: (a: AgentDef | null, prompt: string, kind?: SubKind) => Promise<string>,
  mode: PoolMode,
  delegation: Delegation,
): Promise<ToolImpl[]> {
  if (p.noTools) return [];
  const allowed = new Set(p.allowedTools);
  const denied = bareNames(p.disallowedTools);
  const on = (n: string) => allowed.has(n) && !denied.has(n);
  const tools: ToolImpl[] = [];
  if (on('Read')) tools.push(readTool);
  if (on('Grep')) tools.push(grepTool);
  if (on('Glob')) tools.push(globTool);
  if (on('Skill') && skills.length) tools.push(skillTool(skills));
  if (p.writeRoot && on('Write')) tools.push(writeTool);
  if (p.writeRoot && on('Edit')) tools.push(editTool);
  for (const extra of p.extraTools ?? []) if (on(extra.name)) tools.push(extra);
  if (!denied.has('Bash') && p.allowedTools.some((t) => t === 'Bash' || t.startsWith('Bash('))) tools.push(bashToolFor(bashPrefixesOf(p.allowedTools)));
  // A sub-agent of a kind has no MCP tool (`toolsOfKind` drops them), so its servers are not asked about.
  const mcpAllowed = p.kind ? [] : p.allowedTools.filter((t) => t.startsWith('mcp__') && !denied.has(t));
  if (mcpAllowed.length) {
    const servers: Record<string, McpServerConfig> = loadMcpConfigs(p.docs?.mcpConfigs ?? []);
    tools.push(...(await mcpTools(servers, mcpAllowed, (s, e) => console.error('[open-engine] mcp', s, e.message))));
  }
  if (on('Agent') && (p.depth ?? 0) === 0) {
    // In `delegate` mode the tool hands work to a sub-agent of a kind; the kinds are fixed for the session, from the tools the principal has at this point.
    if (mode === 'delegate') delegation.kinds = offeredKinds({ lists: p.pool?.activities, tools, writes: !!p.writeRoot });
    const kinds = delegation.kinds;
    tools.push({
      name: 'Agent',
      activity: 'explore',
      description: kinds.length
        ? // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
          'Hands a task to a sub-agent of the given kind. The sub-agent starts with an empty history, has only the tools of that kind and returns only its final answer, so write the complete task: it sees nothing of this conversation. ' +
          // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
          `Kinds: ${kinds.map((k) => `${k} (${KIND_HINT[k]})`).join('; ')}.${agents.length ? ` Known subagent_type values: ${agents.map((a) => a.name).join(', ')}.` : ''}`
        : // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
          'Delegates a focused, read-only task to a sub-agent that has the same read tools and returns only its final answer. ' +
          // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
          `Use it for broad searches that would flood your context.${agents.length ? ` Known subagent_type values: ${agents.map((a) => a.name).join(', ')}.` : ''}`,
      parameters: {
        type: 'object',
        properties: {
          // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
          description: { type: 'string', description: 'Three to five words' },
          prompt: { type: 'string', description: 'The complete task for the sub-agent' },
          ...(kinds.length ? { kind: { type: 'string', enum: kinds, description: 'The kind of sub-agent: which tools it has' } } : {}),
          subagent_type: { type: 'string', description: 'Optional agent definition name' },
          // i18n-ignore-end
        },
        required: kinds.length ? ['prompt', 'kind'] : ['prompt'],
      },
      async run(input, ctx) {
        const def = agents.find((a) => a.name === input.subagent_type) ?? null;
        let text: string;
        if (kinds.length) {
          if (!isSubKind(input.kind) || !kinds.includes(input.kind)) throw new ToolError(t('main.engine.text.subKind', { kind: String(input.kind ?? ''), kinds: kinds.join(', ') }));
          text = await runAgent(def, String(input.prompt ?? ''), input.kind);
        } else {
          text = await runAgent(def, String(input.prompt ?? ''));
        }
        return { response: text, render: (r) => String(r).slice(0, ctx.outputMax) };
      },
    });
  }
  return tools;
}

// What each kind of sub-agent is for, as the principal reads it in the tool and in the prompt.
const KIND_HINT: Record<SubKind, string> = {
  // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
  explore: 'read and search',
  edit: 'change files',
  shell: 'run commands',
  screen: 'drive the virtual screen',
  // i18n-ignore-end
};

/** What a sub-agent of a kind is told: its job is the task, and its answer is all the principal reads. */
function subagentNote(kind: SubKind): string {
  // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
  return `You are a sub-agent of kind ${kind} (${KIND_HINT[kind]}), handed one task by another agent that sees only your final answer. Do the task completely with your tools, then answer with a short report: what you did, what you found, and anything the other agent must check. Do not ask questions; if something is missing, say what in the report.`;
}

/** The paragraph that tells the principal to delegate by kind: only the kinds on offer, and that the sub-agent sees none of the conversation. */
function delegationNote(kinds: SubKind[]): string {
  // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
  return `Sub-agents: the Agent tool hands a task to a sub-agent of a kind (${kinds.join(', ')}). A sub-agent starts with an empty history and has only the tools of its kind, so give it the complete task: the files, what to change or run and how to tell it worked. Hand it the work of its kind (${kinds.filter((k) => k !== 'explore').map((k) => `${k}: ${KIND_HINT[k]}`).join('; ') || 'nothing but reading'}) one task at a time, do not edit yourself the files a sub-agent is editing, and read its final answer instead of doing the work again.`;
}

/** The message that shows the model the images its tools read: one line naming them, then each picture. */
function imageMessage(images: ToolImage[]): ChatMessage {
  const parts: ContentPart[] = [{ type: 'text', text: t('main.engine.text.images', { paths: images.map((i) => i.path).join(', ') }) }];
  for (const i of images) parts.push({ type: 'image_url', image_url: { url: `data:${i.mediaType};base64,${i.data}` } });
  return { role: 'user', content: parts };
}

function compact(messages: ChatMessage[], keepLast = 2, limit = 1200): boolean {
  const toolIdx = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  let changed = false;
  // An image weighs most: every one but the latest message of them is replaced by a line that says it was there.
  const imageIdx = messages.flatMap((m, i) => (Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url') ? [i] : []));
  for (const i of imageIdx.slice(0, -1)) {
    messages[i] = { ...messages[i], content: (messages[i].content as ContentPart[]).map((c) => (c.type === 'image_url' ? { type: 'text' as const, text: t('main.engine.text.oldImage') } : c)) };
    changed = true;
  }
  for (const i of toolIdx.slice(0, Math.max(0, toolIdx.length - keepLast))) {
    const c = messages[i].content;
    if (typeof c === 'string' && c.length > limit) {
      messages[i] = { ...messages[i], content: `${c.slice(0, limit)}\n${t('main.engine.text.oldResult')}` };
      changed = true;
    }
  }
  return changed;
}

interface Extracted {
  ok: boolean;
  value?: Json;
  errors: string[];
}

function extractAnswer(text: string, schema: Json): Extracted {
  const raw = repairJson(text.replace(/<think>[\s\S]*?<\/think>/g, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: [t('main.engine.text.notObject')] };
  const value = prune(raw, schema) as Json;
  const errors = validate(value, schema);
  return errors.length ? { ok: false, errors } : { ok: true, value, errors };
}

export class StructuredOutputError extends EngineError {
  constructor(detail: string) {
    super(t('main.engine.text.badFormat', { detail }), 'invalid_response');
  }
}

export async function runOpen<T>(p: OpenRunParams): Promise<OpenRunResult<T>> {
  const { client } = p;
  const now = p.now ?? (() => new Date());
  const sources = p.sources ?? [];
  const describe = p.describeTool ?? defaultDescribe;
  const docs = p.docs ?? {};
  const events = p.events ?? {};
  const persistent = p.sessionsDir !== null && (p.depth ?? 0) === 0;

  // --- context
  const claudeMd = loadClaudeMd(docs.claudeMd ?? discoverClaudeMd(p.cwd), docs.claudeMdMax);
  const skills = loadSkills(docs.skillDirs ?? []);
  const agents = loadAgentDefs(docs.agentDirs ?? []);
  const docFiles = docs.docDirs ? docIndex(docs.docDirs) : [];

  // --- session
  const prior = p.resume && p.sessionsDir ? readSession(p.sessionsDir, p.resume) : null;
  const sessionId = prior && p.resume ? p.resume : randomUUID();
  const messages: ChatMessage[] = prior ? messagesOf(prior) : [];
  const usage: UsageRecord = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
  const write = (message: ChatMessage, u?: UsageRecord, model?: string, meta?: Completion['meta']): void => {
    messages.push(message);
    if (persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'msg', at: now().toISOString(), message, ...(u ? { usage: u, model: model ?? client.cfg.model } : {}), ...(meta?.tier ? { tier: meta.tier } : {}), ...(meta?.requestId ? { requestId: meta.requestId } : {}) }]);
  };
  // The models of the pool, the one that answers each turn; a lone model is the pool of one.
  const primary: PoolMember = {
    key: p.pool?.primary.key ?? `${client.baseUrl}|${client.cfg.model}`,
    model: client.cfg.model,
    label: p.pool?.primary.label ?? client.cfg.model,
    provider: p.pool?.primary.provider,
    client,
    images: p.capabilities?.images,
    tools: p.capabilities?.tools,
    contextWindow: p.capabilities?.contextWindow,
    ...(p.params ? { params: p.params } : {}),
  };
  // How the pool is used. Without lists for explore, edit, shell or screen only a busy model moves the call (`fallback`); a pool the engine is given without a mode
  // is a `switch` one. `switch` sends each turn to its activity's list, the other two keep the model in use on the role's `write` list.
  // A call with no pool at all has no list to switch by: it is a plain `fallback`, and its main model asks for one effort (that of `write`) on every turn.
  const mode = !p.pool ? 'fallback' : p.pool.mode ? effectivePoolMode(p.pool.mode, p.pool.activities) : 'switch';
  const pool =
    p.poolClient ??
    new PoolClient(primary, p.pool, {
      route: mode === 'switch' ? 'activity' : 'fixed',
      ...(p.tuning ? { tuning: p.tuning } : {}),
      onWait: () => events.onWait?.(),
      onSwitch: (e) => {
        if (persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'switch', at: now().toISOString(), from: e.from.label, to: e.to.label, reason: e.reason, until: e.until, activity: e.activity }]);
        events.onSwitch?.(e);
      },
    });
  // What the next turn answers: the start of a stage and anything the person or the loop says is `write`; tool results set it (see `activityOf`).
  let activity: Activity = p.startActivity ?? 'write';

  // --- tools
  // Sub-agents that change something (edit, shell, screen) run one at a time, in the order they were asked: a chain of promises per loop.
  let mutating: Promise<unknown> = Promise.resolve();
  const delegatedTo = new Set<string>();
  const inOrder = <R,>(work: () => Promise<R>): Promise<R> => {
    const result = mutating.then(work);
    mutating = result.catch(() => undefined);
    return result;
  };
  const runAgent = async (def: AgentDef | null, prompt: string, kind?: SubKind): Promise<string> => {
    // A sub-agent of a kind runs on the list of its own activity when the pool has one; without it, and for a plain sub-agent, on the principal's pool.
    const own = kind ? modelOfKind(kind, p.pool) : null;
    let model = own?.pool.primary.label ?? pool.member.label;
    // The thread hears when a sub-agent runs on another model than the main one: once per kind and model in the session.
    if (own && own.pool.primary.key !== pool.member.key) {
      const told = `${kind}|${own.pool.primary.key}`;
      if (!delegatedTo.has(told)) {
        delegatedTo.add(told);
        events.onSwitch?.({ from: { label: pool.member.label, provider: pool.member.provider }, to: { label: own.pool.primary.label, provider: own.pool.primary.provider }, reason: 'delegate', until: null, activity: kind as SubKind });
      }
    }
    const sub = async (): Promise<OpenRunResult<string>> =>
      runOpen<string>({
        ...p,
        role: `${p.role}:${def?.name ?? kind ?? 'agent'}`,
        prompt,
        schema: undefined,
        resume: undefined,
        allowedTools: p.allowedTools.filter((t) => t !== 'Agent'),
        systemAppend: [def?.body, kind ? subagentNote(kind) : undefined].filter(Boolean).join('\n\n') || undefined,
        maxTurns: kind ? KIND_TURNS[kind] : 12,
        sessionsDir: null,
        sources,
        depth: (p.depth ?? 0) + 1,
        ...(own ? { client: own.client, capabilities: own.capabilities, params: own.params, pool: own.pool, poolClient: undefined } : { poolClient: pool }),
        startActivity: 'explore',
        ...(kind ? { kind, incoming: undefined, events: { ...events, onUsage: (u) => { model = u.model; events.onUsage?.(u); } } } : {}),
      });
    try {
      const r = await (kind && MUTATING_KINDS.has(kind) ? inOrder(sub) : sub());
      usage.promptTokens += r.usage.promptTokens;
      usage.completionTokens += r.usage.completionTokens;
      usage.cachedTokens += r.usage.cachedTokens;
      if (kind && persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'sub', at: now().toISOString(), kind, model, turns: r.turns, promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens }]);
      return r.data;
    } catch (e) {
      // Out of turns is the sub-agent's failure, not the principal's: the principal reads it and decides (what the sub-agent did on disk stays).
      if (kind && e instanceof OpenMaxTurnsError) throw new ToolError(t('main.engine.text.subTurns', { kind, turns: KIND_TURNS[kind] }));
      throw e;
    }
  };
  const toolsAllowed = client.learned.noTools !== true && p.capabilities?.tools !== false;
  const delegation: Delegation = { kinds: [] };
  const built = toolsAllowed ? await buildTools(p, skills, agents, runAgent, mode, delegation) : [];
  // A sub-agent of a kind has the tools of that kind among the ones its parent has, and no others.
  const impls = p.kind ? toolsOfKind(p.kind, built) : built;
  const byApi = new Map(impls.map((t) => [toApiName(t.name), t]));
  const roots = [p.cwd, ...(p.additionalDirectories ?? []), ...(docs.docDirs ?? []), ...(docs.skillDirs ?? [])];
  const outputMax = p.toolOutputMax ?? (p.capabilities?.contextWindow ? Math.max(4000, Math.min(30_000, Math.floor(p.capabilities.contextWindow * 1.2))) : 30_000);
  const ctx: ToolContext = {
    cwd: p.cwd,
    roots,
    isSecret: p.isSecret ?? (() => false),
    secretGlobs: p.secretGlobs ?? [],
    signal: p.signal,
    writeRoot: p.writeRoot ?? null,
    writeReserved: p.writeReserved,
    writeAllow: p.writeAllow,
    writeAnywhere: p.writeAnywhere,
    outputMax,
    env: { ...(p.writeRoot ? scrubbedEnv(process.env) : (process.env as Record<string, string>)), ...p.shellEnv },
    bashPrefixes: bashPrefixesOf(p.allowedTools),
    ripgrep: p.ripgrep ?? 'auto',
    seesImages: () => pool.member.images !== false && pool.member.client.learned.noImages !== true,
  };
  const policy = policyFromHooks(p.hooks, sessionId);

  // --- structured output strategy
  // A stage with a door has a strategy of its own: no final-answer tool (only the stage's own tools are offered), because a call with no tool at all is what
  // closes the dialog — by the response format when the server has one, by the prompt otherwise. Everything else stays as it is.
  const door = !!p.incoming && !!p.schema;
  const schemaObject = p.schema && (p.schema as { type?: unknown }).type === 'object';
  let strategy: OpenRunResult<T>['strategy'] = 'text';
  if (p.schema) {
    const asked = p.structured ?? 'auto';
    const auto = p.capabilities?.jsonSchema === true && !client.learned.dropParams.has('response_format') ? 'response_format' : toolsAllowed && schemaObject ? 'tool' : 'prompt';
    strategy = asked === 'auto' ? auto : asked;
    if (door) strategy = strategy === 'response_format' ? 'response_format' : 'prompt';
    else if (strategy === 'tool' && (!toolsAllowed || !schemaObject)) strategy = 'prompt';
  }
  const finalDef: ToolDef | null =
    strategy === 'tool' && p.schema
      // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
      ? { type: 'function', function: { name: FINAL, description: 'Returns the final answer. Call it exactly once, when you have everything you need, with the complete result.', parameters: p.schema } }
      : null;
  const schemaText = p.schema ? JSON.stringify(p.schema) : '';
  const structuredNote =
    strategy === 'tool'
      // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
      ? `When you are done, call the ${FINAL} tool with the complete answer. Do not write the answer as plain text.`
      : strategy === 'text'
        ? ''
        // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
        : `Your final message must be ONLY one JSON object that follows this JSON Schema, with no text around it and no markdown fences:\n${schemaText}`;

  const apiTools = (): ToolDef[] => [
    ...impls.map<ToolDef>((t) => ({ type: 'function', function: { name: toApiName(t.name), description: t.description, parameters: t.parameters } })),
    ...(finalDef ? [finalDef] : []),
  ];

  // --- start
  if (!prior) {
    const system = buildSystemPrompt({
      cwd: p.cwd,
      claudeMd: claudeMd.text,
      skills: impls.some((t) => t.name === 'Skill') ? skills : [],
      agents: impls.some((t) => t.name === 'Agent') ? agents : [],
      docs: docFiles,
      append: [p.systemAppend, delegation.kinds.length ? delegationNote(delegation.kinds) : '', structuredNote].filter(Boolean).join('\n\n'),
      toolNames: impls.map((t) => t.name),
      now: now(),
    });
    if (persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'meta', id: sessionId, role: p.role, model: client.cfg.model, provider: client.host, at: now().toISOString() }]);
    write({ role: 'system', content: system });
  } else if (persistent) {
    appendLines(p.sessionsDir as string, sessionId, [{ t: 'resume', at: now().toISOString(), role: p.role } as SessionLine]);
  }
  events.onSession?.(sessionId);
  write({ role: 'user', content: p.prompt });

  // --- helpers
  const call = async (o: { tools?: ToolDef[]; toolChoice?: ToolChoice; responseFormat?: Json; activity?: Activity }): Promise<Completion> => {
    const need = () => ({ activity: o.activity ?? activity, tools: !!o.tools?.length, tokens: weigh(messages, o.tools) });
    const window = pool.peek(need()).contextWindow;
    if (window && need().tokens > window * 0.8) compact(messages);
    let compacted = false;
    for (;;) {
      try {
        const { completion: c, member } = await pool.complete({ messages, tools: o.tools?.length ? o.tools : undefined, toolChoice: o.toolChoice, responseFormat: o.responseFormat, signal: p.signal, onText: events.onText, onReasoning: events.onReasoning }, need(), p.kind);
        const u: UsageRecord = c.usage
          ? {
              promptTokens: c.usage.promptTokens,
              completionTokens: c.usage.completionTokens,
              cachedTokens: c.usage.cachedTokens,
              ...(c.usage.costUsd !== undefined ? { costUsd: c.usage.costUsd } : {}),
              ...(c.usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: c.usage.cacheWriteTokens } : {}),
              ...(c.usage.reasoningTokens !== undefined ? { reasoningTokens: c.usage.reasoningTokens } : {}),
            }
          : {
              promptTokens: estimateTokens(messages) + estimateTokens(o.tools ?? []),
              completionTokens: estimateTokens(c.text) + estimateTokens(c.toolCalls),
              cachedTokens: 0,
              estimated: true,
            };
        usage.promptTokens += u.promptTokens;
        usage.completionTokens += u.completionTokens;
        usage.cachedTokens += u.cachedTokens;
        events.onUsage?.({ ...u, sessionId, role: p.role, model: member.client.cfg.model });
        const msg: ChatMessage = { role: 'assistant', content: c.text };
        if (c.toolCalls.length) msg.tool_calls = c.toolCalls;
        if (c.reasoning) msg.reasoning_content = c.reasoning;
        pool.stamp(msg, member);
        write(msg, u, member.client.cfg.model, c.meta);
        return c;
      } catch (e) {
        if (e instanceof EngineError && e.kind === 'context' && !compacted && compact(messages, 1, 600)) {
          compacted = true;
          continue;
        }
        throw e;
      }
    }
  };

  const execute = async (tc: ToolCall): Promise<{ text: string; images?: ToolImage[] }> => {
    const impl = byApi.get(tc.function.name);
    const input = parseToolArguments(tc.function.arguments);
    const name = impl?.name ?? tc.function.name;
    sources.push(describe(name, input));
    events.onToolUse?.(name, input);
    const fail = (text: string): { text: string } => {
      events.onToolResult?.(name, true);
      return { text: t('main.engine.text.toolError', { text }) };
    };
    if (!impl) return fail(t('main.engine.text.unknownTool', { name, available: [...byApi.values()].map((tool) => tool.name).join(', ') }));
    const argErrors = validate(input, impl.parameters);
    if (argErrors.length) return fail(t('main.engine.text.badArgs', { errors: describeErrors(argErrors) }));
    const denied = await policy.pre(impl.name, input, p.cwd);
    if (denied) return fail(denied);
    try {
      const r = await impl.run(input, ctx);
      const rewritten = await policy.post(impl.name, input, r.response, p.cwd);
      events.onToolResult?.(name, false);
      return { text: r.render(rewritten ?? r.response), ...(r.images?.length ? { images: r.images } : {}) };
    } catch (e) {
      if (e instanceof EngineError && e.kind === 'aborted') throw e;
      // A sub-agent's model that refuses by budget or by key ends the call as the principal's own would (a budget is a wait for the stage), not a tool error to read.
      if (e instanceof EngineError && (e.kind === 'budget' || e.kind === 'auth')) throw e;
      return fail(e instanceof ToolError ? e.message : `${(e as Error).message}`);
    }
  };

  const done = (data: unknown, turns: number): OpenRunResult<T> => ({ data: data as T, sessionId, sources, usage, turns, strategy });
  const toolMessage = (tc: ToolCall, content: string): ChatMessage => ({ role: 'tool', tool_call_id: tc.id, content });

  // --- the loop
  let turns = 0;
  let nudges = 0;
  let repairs = 0;
  // Steps in a row whose every tool call was a note (`ToolImpl.note`): at NOTE_STEPS_MAX the step is taken as the end of the work.
  let noteSteps = 0;
  let forceFinal = finalDef !== null && impls.length === 0;
  const responseFormat: Json | undefined = p.schema ? { type: 'json_schema', json_schema: { name: 'answer', schema: p.schema, strict: false } } : undefined;

  // A stage that talks while it works: the door is asked what the model has already said, never before it spoke. A pending message becomes a user turn of the same
  // dialog and another step follows; when there is none, one closing call, with no tool at all and with the schema's format, asks for the result of the stage. Only
  // what comes out of that call counts, so a message delivered in the middle never costs the stage its shape. Answering is the point of the closing call, so it
  // happens here and not in a later turn of the loop: a text that merely described the message never becomes the result. `answer` carries the result of that call,
  // and `bad` the errors of a text outside the schema, so the dialog can have one round to fix them instead of failing the stage on the first text. Once the
  // closing call went in the door is never asked again: a message that arrives after the result was given cannot enter the session behind it.
  type DoorTurn = { took: 'none' } | { took: 'message' } | { took: 'answer'; value: Json } | { took: 'bad'; errors: string };
  let doorClosed = false;
  // A message waiting for the stage enters the dialog as a user turn: after any step, so the agent hears it while it works, not only when it stops.
  const deliver = async (): Promise<boolean> => {
    if (!p.incoming || doorClosed) return false;
    const message = await p.incoming((text) => events.onInterim?.(incomingActivity(text)));
    if (message === null) return false;
    write({ role: 'user', content: incomingText(message) });
    activity = 'write';
    return true;
  };
  const throughDoor = async (stepText?: string): Promise<DoorTurn> => {
    if (!p.incoming || !p.schema || doorClosed) return { took: 'none' };
    if (await deliver()) return { took: 'message' };
    doorClosed = true;
    // Nothing is waiting and the step already wrote the answer in the shape asked for: that is the result. Asking for it again only made the model write the
    // whole answer a second time (minutes and thousands of tokens on a long review).
    const ready = stepText === undefined ? null : extractAnswer(stepText, p.schema as Json);
    if (ready?.ok) return { took: 'answer', value: ready.value as Json };
    write({ role: 'user', content: t('main.engine.text.collect') });
    const last = await call({ tools: [], responseFormat, activity: 'write' });
    const got = extractAnswer(last.text, p.schema as Json);
    if (got.ok) return { took: 'answer', value: got.value as Json };
    return { took: 'bad', errors: describeErrors(got.errors) };
  };
  // One round for the model to fix a closing text that did not follow the schema, in a step of the loop with the stage's own tools; a second one ends the
  // stage with the failure, so a model that never follows the schema cannot spin.
  let doorRepairs = 0;

  for (;;) {
    if (turns >= p.maxTurns) throw new OpenMaxTurnsError(sessionId, sources);
    turns++;
    let c: Completion;
    try {
      c = await call({ tools: apiTools(), toolChoice: forceFinal && finalDef ? { type: 'function', function: { name: FINAL } } : undefined });
    } catch (e) {
      // A model that cannot do tools still answers from the prompt: switch to plain JSON instead of failing the ceremony.
      if (e instanceof EngineError && e.kind === 'no_tools' && turns === 1 && !prior && impls.length + (finalDef ? 1 : 0) > 0) {
        client.learned.noTools = true;
        return runOpen<T>({ ...p, noTools: true, structured: 'prompt', capabilities: { ...p.capabilities, tools: false } });
      }
      throw e;
    }
    if (c.toolCalls.length) {
      const fin = finalDef ? c.toolCalls.find((t) => t.function.name === FINAL) : undefined;
      if (fin && p.schema) {
        const raw = parseToolArguments(fin.function.arguments);
        const value = prune(raw, p.schema) as Json;
        const errors = validate(value, p.schema);
        if (!errors.length) {
          for (const tc of c.toolCalls) write(toolMessage(tc, tc === fin ? 'ok' : t('main.engine.text.ignored')));
          return done(value, turns);
        }
        for (const tc of c.toolCalls) write(toolMessage(tc, tc === fin ? t('main.engine.text.fixFinal', { errors: describeErrors(errors), tool: FINAL }) : t('main.engine.text.ignoredShort')));
        if (repairs++ >= 2) throw new StructuredOutputError(describeErrors(errors));
        forceFinal = true;
        activity = 'write';
        continue;
      }
      if (c.text.trim()) events.onInterim?.(c.text);
      const results = await Promise.all(c.toolCalls.map(execute));
      c.toolCalls.forEach((tc, i) => write(toolMessage(tc, results[i].text)));
      // A tool message carries text only: the pictures the tools read follow in one message the model reads right after them.
      const images = results.flatMap((r) => r.images ?? []);
      if (images.length) write(imageMessage(images));
      // The next turn answers what these tools returned: the most demanding of them decides which models may take it.
      activity = activityOf(c.toolCalls.map((tc) => byApi.get(tc.function.name)?.activity), images.length > 0);
      // A message that arrived while the tools ran is handed over now, with their results: the agent hears it on its next step, whatever it is doing.
      if (await deliver()) {
        noteSteps = 0;
        continue;
      }
      const onlyNotes = c.toolCalls.every((tc) => impls.find((i) => i.name === tc.function.name)?.note === true);
      noteSteps = onlyNotes ? noteSteps + 1 : 0;
      // A model that only posts notes for a few steps has finished and is announcing it: the step ends here and the answer is asked for, as after a plain text.
      if (noteSteps < NOTE_STEPS_MAX) continue;
      noteSteps = 0;
    }
    if (!p.schema) {
      // A call without a schema has no shape to collect: the text is the answer, but the door is asked first, since the step just ended and a message that arrived
      // meanwhile is still due.
      if ((await throughDoor()).took === 'message') continue;
      return done(c.text, turns);
    }

    // The step ended without a tool call that answers, so the door's turn is now: whether the model followed the schema or not, a message that is waiting is
    // delivered before anything of the stage is concluded. Asking the door only after a text outside the schema would leave a message already queued undelivered
    // when the stage ends answering to the format. With no message, a step text that already is the result ends the stage; otherwise the closing call asks for it,
    // and only what it returned can be the result.
    const doorTurn = await throughDoor(c.text);
    if (doorTurn.took === 'message') continue;
    if (doorTurn.took === 'answer') return done(doorTurn.value, turns);

    // The design of a step whose text does not follow the schema, with the `prompt` strategy: the step's text is a candidate result, the door is asked when the
    // step ends and the collection is asked before anything is concluded; whatever the collection returned is what counts. This is why the dialog of a stage that
    // answers to the format never ends on the text of a step that merely described a message.
    const parsed = doorTurn.took === 'bad' ? { ok: false as const, value: undefined as unknown as Json, errors: [doorTurn.errors] } : extractAnswer(c.text, p.schema);
    if (parsed.ok) return done(parsed.value, turns);

    if (strategy === 'tool' && nudges < 2) {
      nudges++;
      turns--;
      write({ role: 'user', content: t('main.engine.text.callFinal', { tool: FINAL }) });
      forceFinal = true;
      activity = 'write';
      continue;
    }
    if (strategy === 'tool') throw new StructuredOutputError(describeErrors(parsed.errors));

    // response_format and prompt strategies: a closing call that asks for the JSON (with response_format when the server has it),
    // then one correction round with the validation errors. A stage that talks lets the door ask for that JSON instead: the errors of a text outside the schema go
    // back to the model in the dialog, and the next step of the loop — with the stage's own tools — has one round to fix them before the stage fails.
    if (door) {
      if (doorRepairs++ >= 1) throw new StructuredOutputError(describeErrors(parsed.errors));
      write({ role: 'user', content: t('main.engine.text.invalidAnswer', { errors: describeErrors(parsed.errors) }) });
      activity = 'write';
      if (turns >= p.maxTurns) throw new OpenMaxTurnsError(sessionId, sources);
      turns++;
      continue;
    }
    write({ role: 'user', content: strategy === 'response_format' ? finalizePrompt() : `${finalizePrompt()} ${t('main.engine.text.previousProblems', { errors: describeErrors(parsed.errors) })}` });
    let last = await call({ responseFormat: strategy === 'response_format' ? responseFormat : undefined, activity: 'write' });
    let fixed = extractAnswer(last.text, p.schema);
    if (!fixed.ok) {
      write({ role: 'user', content: t('main.engine.text.invalidAnswer', { errors: describeErrors(fixed.errors) }) });
      last = await call({ responseFormat: strategy === 'response_format' ? responseFormat : undefined, activity: 'write' });
      fixed = extractAnswer(last.text, p.schema);
    }
    if (fixed.ok) return done(fixed.value, turns);
    throw new StructuredOutputError(describeErrors(fixed.errors));
  }

}
