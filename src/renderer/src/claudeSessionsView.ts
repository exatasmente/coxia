import type { ActivityEntry } from '../../shared/activity';
import type { ClaudeAnswerResult, ClaudeLiveSession, ClaudeSessionLines, ClaudeSessionRefusal, ClaudeSessionResult, ClaudeSessionsList, PendingClaudePermission } from '../../shared/claudeSessions';

// What the Claude Code sessions screen says. DOM-free: the screen is only the markup of these values, and the words come from the catalogs through `say`.

type Say = (key: string, params?: Record<string, string | number>) => string;

export interface SessionRow {
  id: string;
  title: string;
  meta: string;
}

export interface SessionGroups {
  transcripts: SessionRow[];
  running: SessionRow[];
  background: SessionRow[];
}

const liveRow = (s: ClaudeLiveSession, say: Say, time: (ms: number) => string): SessionRow => ({
  id: s.sessionId,
  title: s.cwd || s.sessionId,
  meta: [say(s.status === 'busy' ? 'ui.claude.status.busy' : 'ui.claude.status.idle'), time(s.updatedAt)].filter(Boolean).join(' · '),
});

/** The three groups of the list: the saved transcripts, the processes running now and the ones in the background. */
export function sessionGroups(list: ClaudeSessionsList, say: Say, time: (ms: number) => string): SessionGroups {
  return {
    transcripts: list.transcripts.map((s) => ({ id: s.sessionId, title: s.title || s.firstPrompt || s.sessionId, meta: [s.cwd, s.branch, time(s.lastModified)].filter(Boolean).join(' · ') })),
    running: list.running.map((s) => liveRow(s, say, time)),
    background: list.background.map((s) => liveRow(s, say, time)),
  };
}

/** The lines of the open session after an event: another session's lines are ignored, a whole list replaces, the arriving lines are added. */
export function applyLines(prev: ActivityEntry[], ev: ClaudeSessionLines, open: string | null): ActivityEntry[] {
  if (!open || ev.of !== open) return prev;
  return ev.mode === 'replace' ? [...ev.entries] : [...prev, ...ev.entries];
}

/** The process the app drives for the open session (itself, or its copy), if any. */
const drivenFor = (list: ClaudeSessionsList | null, open: string) => list?.owned.find((o) => o.sessionId === open || o.of === open) ?? null;

/** What the open session's controls offer: Stop while the app's turn runs, End only for a process the app started, and the note when messages go to a copy. */
export function sessionControls(list: ClaudeSessionsList | null, open: string): { canStop: boolean; canEnd: boolean; copy: boolean } {
  const d = drivenFor(list, open);
  return { canStop: !!d?.busy, canEnd: !!d, copy: !!d?.forked };
}

/** The permission requests of the open session (or of its copy). */
export function asksFor(asks: readonly PendingClaudePermission[], list: ClaudeSessionsList | null, open: string): PendingClaudePermission[] {
  const ids = new Set([open, drivenFor(list, open)?.sessionId].filter(Boolean));
  return asks.filter((a) => ids.has(a.sessionId));
}

const REFUSALS: Record<ClaudeSessionRefusal | 'door', string> = {
  'test-workspace': 'ui.claude.refusal.test-workspace',
  empty: 'ui.claude.refusal.empty',
  busy: 'ui.claude.refusal.busy',
  folder: 'ui.claude.refusal.folder',
  'not-running': 'ui.claude.refusal.not-running',
  'not-owned': 'ui.claude.refusal.not-owned',
  gone: 'ui.claude.refusal.gone',
  decision: 'ui.claude.refusal.decision',
  door: 'ui.claude.refusal.door',
  unknown: 'ui.claude.refusal.unknown',
  failed: 'ui.claude.refusal.failed',
};

/** The words of a refusal, or null when the call went through. */
export function refusalText(r: ClaudeSessionResult | ClaudeAnswerResult, say: Say): string | null {
  if (r.ok) return null;
  return say(REFUSALS[r.reason], { message: 'message' in r && r.message ? r.message : '' });
}
