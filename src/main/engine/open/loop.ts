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
import { type SubKind, MUTATING_KINDS, isSubKind, modelOfKind, offeredKinds, subTurnsOf, toolsOfKind } from './subagent';
import { t } from '../../../shared/i18n';
import { incomingActivity, incomingText } from '../incoming';
import type { TurnLimit } from '../contract';

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

/** What the loop tells the caller about a sub-agent it is about to run, so the caller can show it as a node of its own. */
export interface SubAgentStart {
  /** The role the sub-agent's usage is recorded under (`<role>:<kind or definition name>`). */
  role: string;
  /** The kind of a delegated sub-agent (`explore`, `edit`, `shell`, `screen`); null for a plain one. */
  kind: string | null;
  /** The `subagent_type` the model asked for (the name of an agent definition), when it gave one. */
  name: string | null;
  description: string;
  prompt: string;
}

/** The caller's side of one sub-agent: where its own steps go and when it starts, waits its turn and ends. */
export interface SubAgentHandle {
  /** What the sub-agent's own turns report to, instead of the parent's. The model-switch notice, usage and the sign of life stay the parent's. */
  events: Pick<RunEvents, 'onToolUse' | 'onInterim' | 'onThought'>;
  /** Runs the sub-agent with its node as the current one, so what it starts (an agent it calls) hangs under it. */
  within<T>(fn: () => T): T;
  /** `queued`: another sub-agent that changes things is ahead of it; `started`: it runs. */
  state(state: 'queued' | 'started'): void;
  /** The sub-agent reached its turn limit and waits for the person; `used` is the turns it has taken. */
  waiting?(used: number): void;
  /** The person let it go on for another round. */
  continued?(): void;
  /** The sub-agent ended; a failure carries the reason. */
  end(failure?: string): void;
}

export interface RunEvents {
  onSession?: (id: string) => void;
  onToolUse?: (name: string, input: Json) => void;
  onToolResult?: (name: string, isError: boolean) => void;
  onUsage?: (u: UsageRecord & { sessionId: string; role: string; model: string }) => void;
  onText?: (text: string) => void;
  // A piece of the model's reasoning stream: a sign of life while it thinks before it says anything.
  onReasoning?: (text: string) => void;
  // The reasoning of one completed model turn, whole, once per turn that reasoned (whichever way the server sent it); never a piece of a stream.
  onThought?: (text: string) => void;
  // What the model said alongside tool calls it is about to make (its narration between steps); never the final answer.
  onInterim?: (text: string) => void;
  // The three below are the principal's alone, for the text an answer shows as it is written; a sub-agent's events never carry them (what it writes is a tool result).
  // A piece of the text of the turn being written, in order; the reasoning is not in it.
  onPiece?: (text: string) => void;
  // The turn ended. `toolsFollow`: it ended in tool calls, so what was written is narration and not the answer; false: it is the answer, which the run returns.
  onTurnEnd?: (toolsFollow: boolean) => void;
  // What was written is not the answer: the call moved to another model, or the attempt failed and goes again.
  onRestart?: () => void;
  // The call moved to another model of the role's pool (it was busy, or the turn is for an activity the first one does not serve).
  onSwitch?: (e: PoolSwitch) => void;
  // A call waits in the server's queue (the flex tier): a sign of life every so often, though the model says nothing.
  onWait?: () => void;
  // A sub-agent is about to run. Called synchronously, in the order the tool calls were run, before anything else of the sub-agent happens.
  onSubAgent?: (s: SubAgentStart) => SubAgentHandle | undefined;
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
  // Folders the app keeps for itself: Write and Edit refuse them even with the fence lifted.
  writeKeep?: readonly string[];
  hooks?: SdkHooks;
  // Tools the app itself provides (in-process, not shell or MCP); one is offered when its name is in allowedTools.
  extraTools?: ToolImpl[];
  isSecret?: (path: string) => boolean;
  secretGlobs?: string[];
  docs?: DocSources;
  maxTurns: number;
  // The turns a sub-agent gets, read when it starts (the workspace's setting); without it, the defaults of `DEFAULT_SUB_TURNS`.
  subTurns?: () => Partial<Record<SubKind | 'plain', number>>;
  // Reaching the turn limit asks the person instead of failing: a sub-agent always asks through it, the agent of the call only with `own`. Absent: the loop throws as before.
  turnLimit?: TurnLimit;
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

/** What the model wrote about a sub-agent besides its prompt: the three to five words of the task and the agent definition it named. */
interface SubAgentAbout {
  description?: string;
  type?: string;
}

async function buildTools(
  p: OpenRunParams,
  skills: ReturnType<typeof loadSkills>,
  agents: AgentDef[],
  runAgent: (a: AgentDef | null, prompt: string, kind?: SubKind, about?: SubAgentAbout) => Promise<string>,
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
        const about: SubAgentAbout = { description: typeof input.description === 'string' ? input.description : undefined, type: typeof input.subagent_type === 'string' ? input.subagent_type : undefined };
        let text: string;
        if (kinds.length) {
          if (!isSubKind(input.kind) || !kinds.includes(input.kind)) throw new ToolError(t('main.engine.text.subKind', { kind: String(input.kind ?? ''), kinds: kinds.join(', ') }));
          text = await runAgent(def, String(input.prompt ?? ''), input.kind, about);
        } else {
          text = await runAgent(def, String(input.prompt ?? ''), undefined, about);
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
  // Sub-agents share the principal's list: where this run's own entries begin.
  const startSources = sources.length;
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
        // A model that fails after it began to write is tried again on the next one from the start: the first one's pieces are not the answer.
        events.onRestart?.();
        events.onSwitch?.(e);
      },
    });
  // What the next turn answers: the start of a stage and anything the person or the loop says is `write`; tool results set it (see `activityOf`).
  let activity: Activity = p.startActivity ?? 'write';

  // --- tools
  // Sub-agents that change something (edit, shell, screen) run one at a time, in the order they were asked: a chain of promises per loop.
  let mutating: Promise<unknown> = Promise.resolve();
  const delegatedTo = new Set<string>();
  const principalOnly = new Set((p.extraTools ?? []).filter((x) => x.principalOnly).map((x) => x.name));
  const inOrder = <R,>(work: () => Promise<R>): Promise<R> => {
    const result = mutating.then(work);
    mutating = result.catch(() => undefined);
    return result;
  };
  // Sub-agents of a kind that change something wait for each other: how many are asked and have not ended, to tell the one that waits from the one that runs.
  let mutatingOpen = 0;
  const runAgent = async (def: AgentDef | null, prompt: string, kind?: SubKind, about: SubAgentAbout = {}): Promise<string> => {
    const role = `${p.role}:${def?.name ?? kind ?? 'agent'}`;
    // Told first and synchronously, so the nodes under a parent come in the order the tool calls were run, whatever each one then waits for.
    const handle = events.onSubAgent?.({ role, kind: kind ?? null, name: about.type?.trim() || null, description: about.description ?? '', prompt });
    const mutates = !!kind && MUTATING_KINDS.has(kind);
    const waits = mutates && mutatingOpen > 0;
    let ended = false;
    const finish = (failure?: string): void => {
      if (ended) return;
      ended = true;
      handle?.end(failure);
    };
    // A sub-agent of a kind runs on the list of its own activity when the pool has one; without it, and for a plain sub-agent, on the principal's pool.
    let own: ReturnType<typeof modelOfKind> = null;
    let model = pool.member.label;
    // Once the node exists, anything that throws before the run ends it: a listener that throws must not leave it "started".
    try {
      handle?.state(waits ? 'queued' : 'started');
      own = kind ? modelOfKind(kind, p.pool) : null;
      model = own?.pool.primary.label ?? pool.member.label;
      // The thread hears when a sub-agent runs on another model than the main one: once per kind and model in the session.
      if (own && own.pool.primary.key !== pool.member.key) {
        const told = `${kind}|${own.pool.primary.key}`;
        if (!delegatedTo.has(told)) {
          delegatedTo.add(told);
          events.onSwitch?.({ from: { label: pool.member.label, provider: pool.member.provider }, to: { label: own.pool.primary.label, provider: own.pool.primary.provider }, reason: 'delegate', until: null, activity: kind as SubKind });
        }
      }
    } catch (e) {
      finish(e instanceof Error ? e.message : String(e));
      throw e;
    }
    // Taken when the sub-agent really begins (after its wait, for the kinds that change things), so a number changed while it queued applies.
    let allowed = subTurnsOf(undefined, kind);
    const sub = async (): Promise<OpenRunResult<string>> => {
      allowed = subTurnsOf(p.subTurns, kind);
      return runOpen<string>({
        ...p,
        role,
        prompt,
        schema: undefined,
        resume: undefined,
        // `Agent` is the principal's alone, and so is every tool that writes into the principal's place (the memory's write tools): a sub-agent reads.
        allowedTools: p.allowedTools.filter((t) => t !== 'Agent' && !principalOnly.has(t)),
        systemAppend: [def?.body, kind ? subagentNote(kind) : undefined].filter(Boolean).join('\n\n') || undefined,
        maxTurns: allowed,
        // The nested run asks through its node: the wait shows on it, and the question names the sub-agent's kind and task.
        turnLimit: p.turnLimit && {
          own: false,
          ask: async (stop, signal) => {
            handle?.waiting?.(stop.used);
            const decision = await p.turnLimit!.ask({ ...stop, kind: kind ?? null, name: about.type?.trim() || null, task: about.description?.trim() || prompt.slice(0, 200) }, signal);
            // Either answer leaves the waiting state before the work goes on (the closing call of "finish now" takes time); "continued" is for a new round only.
            if (!signal?.aborted) {
              if (decision === 'continue') handle?.continued?.();
              else handle?.state('started');
            }
            return decision;
          },
        },
        sessionsDir: null,
        sources,
        depth: (p.depth ?? 0) + 1,
        ...(own ? { client: own.client, capabilities: own.capabilities, params: own.params, pool: own.pool, poolClient: undefined } : { poolClient: pool }),
        startActivity: 'explore',
        // The sub-agent's own steps go to its node; a model-switch notice, usage and the sign of life stay with the parent. Without a node its thoughts are not the parent's.
        events: { ...events, onThought: undefined, onPiece: undefined, onTurnEnd: undefined, onRestart: undefined, ...handle?.events, ...(kind ? { onUsage: (u) => { model = u.model; events.onUsage?.(u); } } : {}) },
        ...(kind ? { kind, incoming: undefined } : {}),
      });
    };
    const inside = (): Promise<OpenRunResult<string>> => (handle ? handle.within(sub) : sub());
    if (mutates) mutatingOpen++;
    try {
      const r = await (mutates
        ? inOrder(async () => {
            if (waits) handle?.state('started');
            return inside();
          })
        : inside());
      finish();
      usage.promptTokens += r.usage.promptTokens;
      usage.completionTokens += r.usage.completionTokens;
      usage.cachedTokens += r.usage.cachedTokens;
      if (kind && persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'sub', at: now().toISOString(), kind, model, turns: r.turns, promptTokens: r.usage.promptTokens, completionTokens: r.usage.completionTokens }]);
      return r.data;
    } catch (e) {
      // Out of turns is the sub-agent's failure, not the principal's: the principal reads it and decides (what the sub-agent did on disk stays).
      const failure = kind && e instanceof OpenMaxTurnsError ? new ToolError(t('main.engine.text.subTurns', { kind, turns: allowed })) : e;
      finish(failure instanceof Error ? failure.message : String(failure));
      throw failure;
    } finally {
      if (mutates) mutatingOpen--;
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
    writeKeep: p.writeKeep,
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
        const { completion: c, member } = await pool.complete({ messages, tools: o.tools?.length ? o.tools : undefined, toolChoice: o.toolChoice, responseFormat: o.responseFormat, signal: p.signal, onText: events.onPiece ? (text) => (events.onText?.(text), events.onPiece?.(text)) : events.onText, onReasoning: events.onReasoning }, need(), p.kind);
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
        // One line per turn, after the turn is whole and before its narration and tools are handled; a retry after a full context threw before this point.
        if (c.reasoning?.trim()) events.onThought?.(c.reasoning);
        return c;
      } catch (e) {
        // Whatever the failed attempt had written is not the answer, whether the call goes again or ends.
        events.onRestart?.();
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
      // i18n-ignore-next-line: what the model reads when its tool call fails: English by design, like the tool descriptions
      return { text: `[tool error] ${text}` };
    };
    // i18n-ignore-start: what the model reads when its tool call is wrong: English by design, like the tool descriptions
    if (!impl) return fail(`Unknown tool: ${name}. Available: ${[...byApi.values()].map((tool) => tool.name).join(', ')}`);
    const argErrors = validate(input, impl.parameters);
    if (argErrors.length) return fail(`Invalid arguments: ${describeErrors(argErrors)}`);
    // i18n-ignore-end
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
  // The limit rises by one round, the size it started with, each time the person lets the work go on; the last thing the model said between steps is what a work
  // that is finished now falls back to.
  let limit = p.maxTurns;
  const round = p.maxTurns;
  let granted = 0;
  let narration = '';
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

  // At the point where the loop would stop for lack of turns: ask the person if the caller wired the question (a sub-agent always, the agent of the call with `own`), and
  // otherwise throw as before. true: there is room again (the limit rose by a round); false: the person finished the work now.
  const nested = (p.depth ?? 0) > 0;
  const room = async (): Promise<boolean> => {
    if (turns < limit) return true;
    if (!p.turnLimit || !(nested || p.turnLimit.own)) throw new OpenMaxTurnsError(sessionId, sources);
    const decision = await p.turnLimit.ask({ of: nested ? 'sub' : 'stage', role: p.role, kind: p.kind ?? null, name: null, task: '', used: turns, round, granted, canContinue: true }, p.signal);
    // A cancel or a stop ends the wait the same way, and it is not the person's choice: the work stops with the abort.
    if (p.signal?.aborted) throw new EngineError('aborted', 'aborted');
    if (decision !== 'continue') return false;
    limit += round;
    granted++;
    return true;
  };
  // "Finish now". A stage ends as running out of turns does (the caller makes its failure); a sub-agent hands back what it has, marked as partial, so the principal reads it
  // as an answer and not as a tool error. One model call with no tool says what it found; if that fails, the last thing it said, else a line naming what it read.
  const finishNow = async (): Promise<OpenRunResult<T>> => {
    if (!nested) throw new OpenMaxTurnsError(sessionId, sources);
    let said = '';
    try {
      write({ role: 'user', content: t('main.engine.text.partialAsk') });
      said = (await call({ tools: [] })).text.trim();
    } catch (e) {
      if (e instanceof EngineError && (e.kind === 'aborted' || e.kind === 'budget' || e.kind === 'auth')) throw e;
    }
    const body = said || narration || t('main.engine.text.partialNone', { sources: sources.slice(startSources).slice(-10).map((x) => x.slice(0, 120)).join('; ') || '-' });
    const note = p.kind ? t('main.engine.text.partialNote', { kind: p.kind, turns }) : t('main.engine.text.partialNotePlain', { turns });
    return done(`${note}\n\n${body}`, turns);
  };

  for (;;) {
    if (!(await room())) return finishNow();
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
      // The text of a turn that ends in tool calls is narration: it moves to the activity and leaves what is being written.
      events.onTurnEnd?.(true);
      if (c.text.trim()) {
        events.onInterim?.(c.text);
        narration = c.text.trim();
      }
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
      // A call without a schema has no shape to collect: the text is the answer, but the mailbox is asked first, since the step just ended and a message that arrived
      // meanwhile is still due (`throughDoor` is for a schema's closing call and says nothing for a call without one).
      if (await deliver()) {
        // The text just written was not the answer: the model goes on from the message, so what the bubble holds is cleared.
        events.onRestart?.();
        continue;
      }
      events.onTurnEnd?.(false);
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
      if (!(await room())) return finishNow();
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
