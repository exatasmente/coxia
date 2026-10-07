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
import { type ToolContext, type ToolImpl, ToolError } from './tools/types';
import type { ChatMessage, Completion, Json, ToolCall, ToolChoice, ToolDef } from './types';
import { t } from '../../../shared/i18n';

export type StructuredStrategy = 'auto' | 'response_format' | 'tool' | 'prompt';

export interface Capabilities {
  // false: the server cannot do tool calls. Unknown (undefined) is tried.
  tools?: boolean;
  // true: response_format json_schema works (from the probe).
  jsonSchema?: boolean;
  contextWindow?: number;
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
}

export interface OpenRunParams {
  role: string;
  prompt: string;
  // JSON Schema of the final answer; without it the final text is the answer.
  schema?: Json;
  client: ChatClient;
  capabilities?: Capabilities;
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

async function buildTools(p: OpenRunParams, skills: ReturnType<typeof loadSkills>, agents: AgentDef[], runAgent: (a: AgentDef | null, prompt: string) => Promise<string>): Promise<ToolImpl[]> {
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
  const mcpAllowed = p.allowedTools.filter((t) => t.startsWith('mcp__') && !denied.has(t));
  if (mcpAllowed.length) {
    const servers: Record<string, McpServerConfig> = loadMcpConfigs(p.docs?.mcpConfigs ?? []);
    tools.push(...(await mcpTools(servers, mcpAllowed, (s, e) => console.error('[open-engine] mcp', s, e.message))));
  }
  if (on('Agent') && (p.depth ?? 0) === 0) {
    tools.push({
      name: 'Agent',
      description:
        // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
        'Delegates a focused, read-only task to a sub-agent that has the same read tools and returns only its final answer. ' +
        // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
        `Use it for broad searches that would flood your context.${agents.length ? ` Known subagent_type values: ${agents.map((a) => a.name).join(', ')}.` : ''}`,
      parameters: {
        type: 'object',
        properties: {
          // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
          description: { type: 'string', description: 'Three to five words' },
          prompt: { type: 'string', description: 'The complete task for the sub-agent' },
          subagent_type: { type: 'string', description: 'Optional agent definition name' },
          // i18n-ignore-end
        },
        required: ['prompt'],
      },
      async run(input, ctx) {
        const def = agents.find((a) => a.name === input.subagent_type) ?? null;
        const text = await runAgent(def, String(input.prompt ?? ''));
        return { response: text, render: (r) => String(r).slice(0, ctx.outputMax) };
      },
    });
  }
  return tools;
}

function compact(messages: ChatMessage[], keepLast = 2, limit = 1200): boolean {
  const toolIdx = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  let changed = false;
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
  const write = (message: ChatMessage, u?: UsageRecord): void => {
    messages.push(message);
    if (persistent) appendLines(p.sessionsDir as string, sessionId, [{ t: 'msg', at: now().toISOString(), message, ...(u ? { usage: u, model: client.cfg.model } : {}) }]);
  };

  // --- tools
  const runAgent = async (def: AgentDef | null, prompt: string): Promise<string> => {
    const r = await runOpen<string>({
      ...p,
      role: `${p.role}:${def?.name ?? 'agent'}`,
      prompt,
      schema: undefined,
      resume: undefined,
      allowedTools: p.allowedTools.filter((t) => t !== 'Agent'),
      systemAppend: def?.body || undefined,
      maxTurns: 12,
      sessionsDir: null,
      sources,
      depth: (p.depth ?? 0) + 1,
    });
    usage.promptTokens += r.usage.promptTokens;
    usage.completionTokens += r.usage.completionTokens;
    usage.cachedTokens += r.usage.cachedTokens;
    return r.data;
  };
  const toolsAllowed = client.learned.noTools !== true && p.capabilities?.tools !== false;
  const impls = toolsAllowed ? await buildTools(p, skills, agents, runAgent) : [];
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
    outputMax,
    env: { ...(p.writeRoot ? scrubbedEnv(process.env) : (process.env as Record<string, string>)), ...p.shellEnv },
    bashPrefixes: bashPrefixesOf(p.allowedTools),
    ripgrep: p.ripgrep ?? 'auto',
  };
  const policy = policyFromHooks(p.hooks, sessionId);

  // --- structured output strategy
  const schemaObject = p.schema && (p.schema as { type?: unknown }).type === 'object';
  let strategy: OpenRunResult<T>['strategy'] = 'text';
  if (p.schema) {
    const asked = p.structured ?? 'auto';
    const auto = p.capabilities?.jsonSchema === true && !client.learned.dropParams.has('response_format') ? 'response_format' : toolsAllowed && schemaObject ? 'tool' : 'prompt';
    strategy = asked === 'auto' ? auto : asked;
    if (strategy === 'tool' && (!toolsAllowed || !schemaObject)) strategy = 'prompt';
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
      append: [p.systemAppend, structuredNote].filter(Boolean).join('\n\n'),
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
  const call = async (o: { tools?: ToolDef[]; toolChoice?: ToolChoice; responseFormat?: Json }): Promise<Completion> => {
    const window = p.capabilities?.contextWindow;
    if (window && estimateTokens(messages) + estimateTokens(o.tools ?? []) > window * 0.8) compact(messages);
    let compacted = false;
    for (;;) {
      try {
        const c = await client.complete({ messages, tools: o.tools?.length ? o.tools : undefined, toolChoice: o.toolChoice, responseFormat: o.responseFormat, signal: p.signal, onText: events.onText, onReasoning: events.onReasoning });
        const u: UsageRecord = c.usage
          ? { promptTokens: c.usage.promptTokens, completionTokens: c.usage.completionTokens, cachedTokens: c.usage.cachedTokens, ...(c.usage.costUsd !== undefined ? { costUsd: c.usage.costUsd } : {}) }
          : {
              promptTokens: estimateTokens(messages) + estimateTokens(o.tools ?? []),
              completionTokens: estimateTokens(c.text) + estimateTokens(c.toolCalls),
              cachedTokens: 0,
              estimated: true,
            };
        usage.promptTokens += u.promptTokens;
        usage.completionTokens += u.completionTokens;
        usage.cachedTokens += u.cachedTokens;
        events.onUsage?.({ ...u, sessionId, role: p.role, model: client.cfg.model });
        const msg: ChatMessage = { role: 'assistant', content: c.text };
        if (c.toolCalls.length) msg.tool_calls = c.toolCalls;
        if (c.reasoning) msg.reasoning_content = c.reasoning;
        write(msg, u);
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

  const execute = async (tc: ToolCall): Promise<{ text: string; image?: { data: Uint8Array; media: string } }> => {
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
      return { text: r.render(rewritten ?? r.response), ...(r.image ? { image: r.image } : {}) };
    } catch (e) {
      if (e instanceof EngineError && e.kind === 'aborted') throw e;
      return fail(e instanceof ToolError ? e.message : `${(e as Error).message}`);
    }
  };

  const done = (data: unknown, turns: number): OpenRunResult<T> => ({ data: data as T, sessionId, sources, usage, turns, strategy });
  const toolMessage = (tc: ToolCall, content: string): ChatMessage => ({ role: 'tool', tool_call_id: tc.id, content });
  const dataUrl = (image: { data: Uint8Array; media: string }): string => `data:${image.media};base64,${Buffer.from(image.data).toString('base64')}`;

  // --- the loop
  let turns = 0;
  let nudges = 0;
  let repairs = 0;
  let forceFinal = finalDef !== null && impls.length === 0;
  const responseFormat: Json | undefined = p.schema ? { type: 'json_schema', json_schema: { name: 'answer', schema: p.schema, strict: false } } : undefined;
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
        continue;
      }
      if (c.text.trim()) events.onInterim?.(c.text);
      const results = await Promise.all(c.toolCalls.map(execute));
      c.toolCalls.forEach((tc, i) => write(toolMessage(tc, results[i].text)));
      // An image a tool produced (the evidence tool) follows its tool message as a part of a user turn: this engine's tool results are text, and the API
      // disapproves of a tool message whose content is an array.
      for (const r of results) if (r.image) write({ role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl(r.image) } }, { type: 'text', text: t('main.engine.text.toolImage') }] });
      continue;
    }
    if (!p.schema) return done(c.text, turns);
    const first = extractAnswer(c.text, p.schema);
    if (first.ok) return done(first.value, turns);

    if (strategy === 'tool' && nudges < 2) {
      nudges++;
      turns--;
      write({ role: 'user', content: t('main.engine.text.callFinal', { tool: FINAL }) });
      forceFinal = true;
      continue;
    }
    if (strategy === 'tool') throw new StructuredOutputError(describeErrors(first.errors));

    // response_format and prompt strategies: a closing call that asks for the JSON (with response_format when the server has it),
    // then one correction round with the validation errors.
    write({ role: 'user', content: strategy === 'response_format' ? finalizePrompt() : `${finalizePrompt()} ${t('main.engine.text.previousProblems', { errors: describeErrors(first.errors) })}` });
    let last = await call({ responseFormat: strategy === 'response_format' ? responseFormat : undefined });
    let parsed = extractAnswer(last.text, p.schema);
    if (!parsed.ok) {
      write({ role: 'user', content: t('main.engine.text.invalidAnswer', { errors: describeErrors(parsed.errors) }) });
      last = await call({ responseFormat: strategy === 'response_format' ? responseFormat : undefined });
      parsed = extractAnswer(last.text, p.schema);
    }
    if (parsed.ok) return done(parsed.value, turns);
    throw new StructuredOutputError(describeErrors(parsed.errors));
  }

}
