import type { AgentDef } from '../../shared/config/types';
import { t } from '../../shared/i18n';
import { loadClaudeSdkModule } from '../claudeSdk';
import type { ToolContext, ToolImpl } from '../engine/open/tools/types';
import { ToolError } from '../engine/open/tools/types';
import type { Json } from '../engine/open/types';

// The tools a stage that talks while it works offers the model: `SendMessage` (post to the run's conversation without ending the stage), `CallAgent` (open a
// conversation with another agent of the team) and `AskConversation` (the tool of the called agent, which answers the other side of a conversation). They are built
// as engine-neutral `ToolImpl`s, so the open engine and the Claude Agent SDK offer the same names and the same policy. Nothing here reaches the code host, the
// network or `Actions`: a message posted this way is internal to the run.

/** A place a message may go: the person, one agent of the team, or everyone. */
export type MessageTo = string;

/** What `SendMessage` does: posts the text in the run's conversation and answers what happened, in text for the model. */
export type SendMessageFn = (to: MessageTo, text: string) => string;

/** What `CallAgent` does: opens a conversation with `to` about `topic`, in the run's conversation or in a new one, and answers the model with its id or the refusal. */
export type CallAgentFn = (to: string, topic: string, place: 'run' | 'new') => Promise<string>;

/** What `AskConversation` does: hands `text` to the other side of a conversation and answers with the next message of that side, or the closing note. */
export type AskConversationFn = (to: string, text: string) => Promise<string>;

/** The team as the tools see it: the ids a message or a call may name, and where a message to the person stands. */
export interface RunnerTeam {
  /** The ids of the agents of the team, in the config's order. */
  ids: string[];
  /** The id the run is talking to on behalf of (for the lines that name who did what). */
  caller: string;
}

export interface RunnerTools {
  sendMessage: SendMessageFn;
  callAgent: CallAgentFn;
  askConversation: AskConversationFn;
  team: RunnerTeam;
}

export const SEND_MESSAGE_TOOL = 'SendMessage';
export const CALL_AGENT_TOOL = 'CallAgent';
export const ASK_CONVERSATION_TOOL = 'AskConversation';

/** The three tool names, for the allowed-tools list of both engines. */
export const RUNNER_TOOL_NAMES = [SEND_MESSAGE_TOOL, CALL_AGENT_TOOL, ASK_CONVERSATION_TOOL] as const;

const asText = (response: unknown): string => (typeof response === 'string' ? response : JSON.stringify(response));

/** Resolves a `to` the model wrote into a destination, or explains the refusal: '' is the person, 'todos' everyone, and a team id a team member. */
export function resolveMessageTo(to: string, team: RunnerTeam): { ok: true; to: MessageTo } | { ok: false; reason: string } {
  const id = to.trim();
  if (id === '') return { ok: true, to: '' };
  if (id === 'todos') return { ok: true, to: 'todos' };
  if (team.ids.includes(id)) return { ok: true, to: id };
  return { ok: false, reason: t('main.runner.tools.unknownAgent', { to: id || '—', list: team.ids.join(', ') }) };
}

/** Whether `text` looks like it asks something of the person: a question mark at the end (used only to pick the closing line of a message the stage never saw). */
export const asksSomething = (text: string): boolean => /\?\s*$/.test(text.trim());

export function sendMessageTool(tools: RunnerTools, onSend: (to: MessageTo, text: string) => string = tools.sendMessage): ToolImpl {
  return {
    name: SEND_MESSAGE_TOOL,
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    description:
      'Posts a message in the conversation of this run (to the person, to one agent of the team, or to everyone) without ending your work: use it for a progress note, a finding, or a question that does not need to block. It never reaches the code host.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
        to: { type: 'string', description: 'Who receives it: the id of an agent of the team, "" for the person, or "todos" for everyone.' },
        text: { type: 'string', description: 'What to say.' },
        // i18n-ignore-end
      },
      required: ['to', 'text'],
      additionalProperties: false,
    } as unknown as Json,
    note: true,
    async run(input) {
      const to = String(input.to ?? '');
      const text = String(input.text ?? '').trim();
      if (!text) throw new ToolError(t('main.runner.tools.emptyText'));
      const dest = resolveMessageTo(to, tools.team);
      if (!dest.ok) throw new ToolError(dest.reason);
      return { response: onSend(dest.to, text), render: asText };
    },
  };
}

export function callAgentTool(tools: RunnerTools): ToolImpl {
  return {
    name: CALL_AGENT_TOOL,
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    description:
      'Starts a conversation with another agent of the team about a point, in the conversation of this run or in a new conversation of the forum linked to the run. The other agent answers and you get each answer as a message. It ends by itself when neither side has more to say.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
        to: { type: 'string', description: 'The id of the agent of the team to talk to.' },
        topic: { type: 'string', description: 'What the conversation is about, and what you want from it.' },
        place: { type: 'string', enum: ['run', 'new'], description: 'Where it happens: the conversation of this run, or a new conversation of the forum.' },
        // i18n-ignore-end
      },
      required: ['to', 'topic'],
      additionalProperties: false,
    } as unknown as Json,
    async run(input) {
      const to = String(input.to ?? '').trim();
      const topic = String(input.topic ?? '').trim();
      const place = input.place === 'new' ? 'new' : 'run';
      if (!topic) throw new ToolError(t('main.runner.tools.emptyTopic'));
      const dest = resolveMessageTo(to, tools.team);
      if (!dest.ok || dest.to === '' || dest.to === 'todos') throw new ToolError(t('main.runner.tools.unknownAgent', { to: to || '—', list: tools.team.ids.join(', ') }));
      return { response: await tools.callAgent(dest.to, topic, place), render: asText };
    },
  };
}

export function askConversationTool(tools: RunnerTools): ToolImpl {
  return {
    name: ASK_CONVERSATION_TOOL,
    // i18n-ignore: prompt and tool texts the open engine sends the model: English by design
    description:
      'Sends what you say to the other side of this conversation and gives you its next message. Call it to keep the conversation going; when you end your turn without calling it, the conversation is over.',
    parameters: {
      type: 'object',
      properties: {
        // i18n-ignore-start: prompt and tool texts the open engine sends the model: English by design
        to: { type: 'string', description: 'The id of the agent you are talking to, or empty when you answer the last message.' },
        text: { type: 'string', description: 'What to say.' },
        // i18n-ignore-end
      },
      required: ['text'],
      additionalProperties: false,
    } as unknown as Json,
    async run(input) {
      const text = String(input.text ?? '').trim();
      if (!text) throw new ToolError(t('main.runner.tools.emptyText'));
      return { response: await tools.askConversation(String(input.to ?? ''), text), render: asText };
    },
  };
}

/**
 * The tools a call of `mode` gets, as a pure transformation of the names it already has. `none`: nothing (the call of today — a mention, a question of the chain, a
 * request between squads). `run`: `SendMessage` and `CallAgent`, for a stage that works. `worktree`: the same, for an agent the run called that may change files.
 * A call with no tool at all (a closing pass) takes none of them.
 */
export function runnerTools(tools: RunnerTools, mode: 'none' | 'run' | 'worktree'): ToolImpl[] {
  if (mode === 'none') return [];
  return [sendMessageTool(tools), callAgentTool(tools)];
}

/** The tool of a conversation's other side: what the called agent uses to keep talking. */
export function calledAgentTools(tools: RunnerTools): ToolImpl[] {
  return [askConversationTool(tools)];
}

/**
 * The same tools as an in-process MCP server of the Claude Agent SDK, one per `ToolImpl`, so both engines offer the same names and the same policy. `null` (the
 * agent runs without them) when the SDK or zod cannot be loaded; the caller then says so in the thread.
 */
export async function runnerMcpServer(tools: ToolImpl[]): Promise<Record<string, unknown> | null> {
  if (!tools.length) return null;
  try {
    const sdk = await loadClaudeSdkModule();
    const { z } = await import('zod');
    const made = tools.map((tool) =>
      sdk.tool(
        tool.name,
        tool.description,
        // The declared parameters are the JSON Schema the open engine uses; the SDK wants the shape, so the model sends the same fields.
        (tool.parameters as { properties?: Record<string, unknown> }).properties
          ? Object.fromEntries(Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties).map((k) => [k, z.unknown()]))
          : { text: z.unknown() },
        async (args: Record<string, unknown>) => {
          try {
            const r = await tool.run(args as Json, STUB_CTX);
            return { content: [{ type: 'text' as const, text: r.render(r.response) }] };
          } catch (e) {
            return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
          }
        },
      ),
    );
    return { [RUNNER_MCP_SERVER]: sdk.createSdkMcpServer({ name: RUNNER_MCP_SERVER, tools: made }) };
  } catch (e) {
    console.error('[runner] the app tools of a working stage are not available for the Claude SDK engine:', (e as Error).message);
    return null;
  }
}

/** The tool names as the SDK knows them (their MCP server prefixes the plain name). */
export const runnerMcpToolName = (name: string): string => `mcp__${RUNNER_MCP_SERVER}__${name}`;

const RUNNER_MCP_SERVER = 'runner';

/** The tools of the runner use no filesystem: this context is what the signature asks, nothing else. */
const STUB_CTX: ToolContext = { cwd: '', roots: [], isSecret: () => false, secretGlobs: [], outputMax: 0, env: {}, bashPrefixes: [], ripgrep: 'off' };
