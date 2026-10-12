import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { SECRET_READ_DENY, type AgentCall } from '../agents';
import { prompt as cp } from '../cyclePrompts';
import { WRITE_TOOLS, checkPath, writeTarget } from '../engine/guard';
import { redact } from '../errorlog-core';

// A stage whose executor is a Claude Code session hands its task to one opened through the Agent SDK the app already ships. The session obeys what any agent of a run
// obeys: the hooks the stage built for its call (the worktree fence) run before every tool, the path is checked once more where the permission is decided, and every
// permission request goes to the person through the same question a host command does. There is no native shell: a shell could write anywhere, and the fence only
// covers the file tools.

type SdkQuery = (args: { prompt: string; options: Options }) => AsyncIterable<SdkMessage>;
interface SdkMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  is_error?: boolean;
  structured_output?: unknown;
  message?: { content?: unknown };
}

export interface ClaudeCodeDeps {
  query(): Promise<SdkQuery>;
  /** The environment of the session child for the agent's model (provider key included): never anything of the person's `~/.claude`. */
  env(call: AgentCall): Record<string, string>;
  executable?(): string | undefined;
}

export interface ClaudeCodeInput {
  call: AgentCall;
  /** The question to the person: resolves with the answer, and ends with the stage's signal. */
  ask(question: string, signal: AbortSignal): Promise<{ ok: boolean; note?: string }>;
  /** Stops the stage's clocks while the person answers; the returned function starts them again. */
  pause(): () => void;
  signal: AbortSignal;
}

export interface ClaudeCodeResult {
  data: unknown;
  sessionId: string | null;
  engine: 'claude-sdk';
  /** What the session said and did, secrets redacted: kept by the stage as its record, never part of the answer. */
  transcript: string;
}

const clip = (text: string, n = 300): string => (text.length > n ? `${text.slice(0, n)}…` : text);

function lineOf(name: string, input: unknown): string {
  const args = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const detail = args.file_path ?? args.notebook_path ?? args.path ?? args.pattern ?? '';
  return typeof detail === 'string' && detail ? `${name}: ${detail}` : name;
}

export async function runClaudeCodeTask(deps: ClaudeCodeDeps, input: ClaudeCodeInput): Promise<ClaudeCodeResult> {
  const { call } = input;
  const query = await deps.query();
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(redact(text));
  };
  const root = call.confine?.root ?? call.cwd;
  const exe = deps.executable?.();
  const options: Options = {
    cwd: call.cwd,
    permissionMode: 'default',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: call.system },
    allowedTools: [],
    disallowedTools: ['Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', ...SECRET_READ_DENY],
    ...(call.confine ? { hooks: call.confine.hooks } : {}),
    ...(call.schema ? { outputFormat: { type: 'json_schema' as const, schema: call.schema } } : {}),
    maxTurns: call.maxTurns,
    // Nothing of the person's Claude Code (CLAUDE.md, settings, automatic memory) enters the session.
    settingSources: [],
    settings: { autoMemoryEnabled: false },
    abortController: call.abort ?? new AbortController(),
    env: deps.env(call),
    ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
    canUseTool: async (tool, args) => {
      // The hooks already fence the file tools; this refuses again at the point of decision, so a path that slipped past them is still not written.
      if (Object.prototype.hasOwnProperty.call(WRITE_TOOLS, tool)) {
        const check = checkPath(root, writeTarget(tool, args), { keep: [] });
        if (!check.ok) {
          say(`denied ${lineOf(tool, args)}`);
          return { behavior: 'deny', message: cp(`runner.denied.${check.code}`) };
        }
      }
      if (input.signal.aborted) return { behavior: 'deny', message: 'The stage was stopped.' }; // i18n-ignore: model-facing text
      const resume = input.pause();
      try {
        const answer = await input.ask(clip(redact(lineOf(tool, args))), input.signal);
        say(`${answer.ok ? 'allowed' : 'refused'} ${lineOf(tool, args)}`);
        return answer.ok ? { behavior: 'allow', updatedInput: args } : { behavior: 'deny', message: answer.note?.trim() || 'The person refused this.' }; // i18n-ignore: model-facing text
      } finally {
        resume();
      }
    },
  };
  let sessionId: string | null = null;
  for await (const m of query({ prompt: call.prompt, options })) {
    call.beat?.();
    if (m.session_id) sessionId = m.session_id;
    if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
      for (const block of m.message.content as { type: string; text?: string; name?: string; input?: unknown }[]) {
        if (block.type === 'text' && block.text) say(block.text);
        if (block.type === 'tool_use' && block.name) say(lineOf(block.name, block.input));
      }
    }
    if (m.type !== 'result') continue;
    const transcript = lines.join('\n');
    if (m.subtype !== 'success' || m.is_error) throw new Error(`agent failed: ${redact(clip(m.result ?? `agent ended with ${m.subtype ?? 'no result'}`, 600))}`); // i18n-ignore: developer error from the SDK result
    if (call.schema) {
      if (m.structured_output == null) throw new Error('agent ended without a result'); // i18n-ignore: developer error from the SDK result
      return { data: m.structured_output, sessionId, engine: 'claude-sdk', transcript };
    }
    const said = (m.result ?? '').trim();
    if (!said) throw new Error('agent ended without a result'); // i18n-ignore: developer error from the SDK result
    return { data: { summary: said }, sessionId, engine: 'claude-sdk', transcript };
  }
  throw new Error('agent ended without a result'); // i18n-ignore: developer error from the SDK result
}
