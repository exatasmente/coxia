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
  outputMax: number;
  env: Record<string, string>;
  // Bash(<prefix>:*) rules from the allowed tools; empty means the hook policy alone decides.
  bashPrefixes: string[];
  // 'auto' tries ripgrep and falls back to the JS walker.
  ripgrep: 'auto' | 'off';
}

// What a tool returns. `response` has the same shape as the Claude tool's, so the shared PostToolUse hooks can rewrite it;
// `render` turns the (possibly rewritten) response into the text the model reads.
export interface ToolResult {
  response: unknown;
  render: (response: unknown) => string;
}

export interface ToolImpl {
  // The name the policy hooks and the allowed-tools list know it by (Read, Grep, Glob, Bash, Skill, mcp__server__tool).
  name: string;
  description: string;
  parameters: Json;
  run(input: Json, ctx: ToolContext): Promise<ToolResult>;
}

// A failure the model should read and recover from, not a crash.
export class ToolError extends Error {}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n${t('main.engine.text.clipped', { max, total: text.length })}` : text;
}

export function asText(response: unknown): string {
  return typeof response === 'string' ? response : JSON.stringify(response);
}
