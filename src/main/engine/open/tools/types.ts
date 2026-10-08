import type { Json } from '../types';
import { t } from '../../../../shared/i18n';

export interface ToolContext {
  cwd: string;
  // Folders a file tool may touch: the cwd, the additional directories and the doc sources.
  roots: string[];
  // The secret-file rule shared with the Claude path (secretPath in agents.ts).
  isSecret: (path: string) => boolean;
  // SECRET_GLOBS in gitignore syntax, handed to ripgrep so a path-less search never walks a secret file.
  secretGlobs: string[];
  signal?: AbortSignal;
  // The folder a Write or Edit may change (the run's worktree). null: the call is read-only and those tools refuse.
  writeRoot?: string | null;
  // Names directly under writeRoot that Write and Edit refuse: what the app itself keeps there.
  writeReserved?: readonly string[];
  // Exact relative file paths a single-output task may change.
  writeAllow?: readonly string[];
  outputMax: number;
  env: Record<string, string>;
  // Bash(<prefix>:*) rules from the allowed tools; empty means the hook policy alone decides.
  bashPrefixes: string[];
  // 'auto' tries ripgrep and falls back to the JS walker.
  ripgrep: 'auto' | 'off';
  // Whether the model takes images now: false when the provider says it does not, or a call with one was refused. Absent: it does not.
  seesImages?: () => boolean;
}

/** An image a tool read, for the model to see: the loop sends it in a message of its own, since a tool message carries text only. */
export interface ToolImage {
  path: string;
  mediaType: string;
  /** The file's bytes, base64. */
  data: string;
}

// What a tool returns. `response` has the same shape as the Claude tool's, so the shared PostToolUse hooks can rewrite it;
// `render` turns the (possibly rewritten) response into the text the model reads.
export interface ToolResult {
  response: unknown;
  render: (response: unknown) => string;
  /** Images the model should see along with the text (Read of a picture). */
  images?: ToolImage[];
}

export interface ToolImpl {
  // The name the policy hooks and the allowed-tools list know it by (Read, Grep, Glob, Bash, Skill, mcp__server__tool).
  name: string;
  description: string;
  parameters: Json;
  run(input: Json, ctx: ToolContext): Promise<ToolResult>;
  /**
   * A tool that only talks (posts a note) and moves no work forward. A model that calls nothing else for a few steps in a row is taken as done and asked for its
   * final answer: a model that keeps announcing the end with notes would otherwise never end its step.
   */
  note?: boolean;
}

// A failure the model should read and recover from, not a crash.
export class ToolError extends Error {}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n${t('main.engine.text.clipped', { max, total: text.length })}` : text;
}

export function asText(response: unknown): string {
  return typeof response === 'string' ? response : JSON.stringify(response);
}
