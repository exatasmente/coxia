// Sessions of the open engine: one JSONL transcript per session in the workspace data dir, so `resume` works across app restarts and
// the cost panel can read token usage the way it reads Claude Code transcripts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage } from './types';
import { t } from '../../../shared/i18n';

export interface UsageRecord {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  // What the provider said the call cost, in US dollars, when it said.
  costUsd?: number;
  // True when the server sent no usage and the numbers are estimates.
  estimated?: boolean;
}

export type SessionLine =
  | { t: 'meta'; id: string; role: string; model: string; provider: string; at: string }
  | { t: 'msg'; at: string; message: ChatMessage; usage?: UsageRecord; model?: string }
  | { t: 'resume'; at: string; role: string }
  // The call moved to another model of the pool: not a message, so it never reaches the history.
  | { t: 'switch'; at: string; from: string; to: string; reason: string; until: number | null; activity: string };

export const SESSION_EXT = '.jsonl';

export function sessionPath(dir: string, id: string): string {
  // i18n-ignore: developer error
  if (!/^[\w-]{8,64}$/.test(id)) throw new Error('invalid session id');
  return join(dir, `${id}${SESSION_EXT}`);
}

export function appendLines(dir: string, id: string, lines: SessionLine[]): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(sessionPath(dir, id), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
}

export function readSession(dir: string, id: string): SessionLine[] | null {
  let file: string;
  try {
    file = sessionPath(dir, id);
  } catch {
    return null;
  }
  if (!existsSync(file)) return null;
  const out: SessionLine[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SessionLine);
    } catch {
      // a half-written last line from a crash
    }
  }
  return out;
}

// A crash between an assistant turn and its tool results leaves calls with no answer; the API refuses that history.
export function healMessages(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    out.push(m);
    if (m.role !== 'assistant' || !m.tool_calls?.length) continue;
    const answered = new Set<string>();
    let j = i + 1;
    while (messages[j]?.role === 'tool') answered.add(messages[j++].tool_call_id ?? '');
    for (const c of m.tool_calls) {
      if (!answered.has(c.id)) out.push({ role: 'tool', tool_call_id: c.id, content: t('main.engine.text.interrupted') });
    }
  }
  return out;
}

export function messagesOf(lines: SessionLine[]): ChatMessage[] {
  return healMessages(lines.flatMap((l) => (l.t === 'msg' ? [l.message] : [])));
}

export function usageOf(lines: SessionLine[]): UsageRecord {
  const total: UsageRecord = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 };
  for (const l of lines) {
    if (l.t !== 'msg' || !l.usage) continue;
    total.promptTokens += l.usage.promptTokens;
    total.completionTokens += l.usage.completionTokens;
    total.cachedTokens += l.usage.cachedTokens;
  }
  return total;
}

export function listSessions(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(SESSION_EXT))
      .map((f) => f.slice(0, -SESSION_EXT.length));
  } catch {
    return [];
  }
}
