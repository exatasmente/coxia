// The machine's Claude Code sessions in the desktop window (#280): what travels between the main process and the screen. Every text here is masked in the main process
// before it leaves it. Pure: shared by the main process, the screen and the tests.

import type { ActivityEntry } from './activity';

/** Every channel and event of the feature carries this prefix, which webPolicy.ts denies to a paired browser as a whole. */
export const CLAUDE_SESSIONS_PREFIX = 'claudeSessions:';
/** The lines of a session, whole (`replace`) or as they arrive (`append`). Window only. */
export const CLAUDE_SESSIONS_LINES_EVENT = 'claudeSessions:lines';
/** The permission requests that wait for the person, the whole list each time. Window only. */
export const CLAUDE_SESSIONS_ASKS_EVENT = 'claudeSessions:asks';
/** A session driven by the app changed: started, busy, idle or ended. Window only. */
export const CLAUDE_SESSIONS_STATE_EVENT = 'claudeSessions:state';

/** A saved transcript, as the SDK's listSessions describes it. */
export interface ClaudeTranscript {
  sessionId: string;
  title: string;
  firstPrompt: string;
  cwd: string;
  branch: string;
  /** Epoch ms. */
  lastModified: number;
}

export type LiveKind = 'interactive' | 'background';
export type LiveStatus = 'idle' | 'busy';

/** A Claude Code process alive on this machine, from the fields of its own session record (never its key). */
export interface ClaudeLiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  kind: LiveKind;
  status: LiveStatus;
  /** Epoch ms. */
  updatedAt: number;
}

/** A session the app drives right now (one it started or resumed): only these may be ended. */
export interface ClaudeOwnedSession {
  sessionId: string;
  cwd: string;
  busy: boolean;
  /** Sent to a copy because another process held the session open. */
  forked: boolean;
  /** The session the person opened, when this one is its copy. */
  of: string | null;
}

export interface ClaudeSessionsList {
  /** `missing`: the Claude Code SDK cannot be loaded; `reason` says why. No login is ever offered. */
  cli: 'ok' | 'missing';
  reason: string;
  transcripts: ClaudeTranscript[];
  running: ClaudeLiveSession[];
  background: ClaudeLiveSession[];
  owned: ClaudeOwnedSession[];
}

/** The lines of one session, in the activity view's shape. `of` is the session the screen opened (the original of a copy). */
export interface ClaudeSessionLines {
  of: string;
  mode: 'replace' | 'append';
  entries: ActivityEntry[];
}

export interface PendingClaudePermission {
  id: string;
  sessionId: string;
  tool: string;
  /** What the tool would be called with: masked and clipped. */
  input: string;
  /** ISO time. */
  since: string;
}

export const PERMISSION_DECISIONS = ['allow', 'deny'] as const;
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];
export const isPermissionDecision = (v: unknown): v is PermissionDecision => typeof v === 'string' && (PERMISSION_DECISIONS as readonly string[]).includes(v);

/**
 * `test-workspace`: sending and starting are refused in a test workspace. `empty`: no text. `busy`: a turn of the app's runs there. `folder`: not a project folder of the
 * workspace. `not-running`: no turn of the app's to stop. `not-owned`: the app did not start that process. `gone`: the request no longer waits. `decision`: not allow or deny.
 * `unknown`: no session with that id. `failed`: the SDK refused (the message says why).
 */
export type ClaudeSessionRefusal = 'test-workspace' | 'empty' | 'busy' | 'folder' | 'not-running' | 'not-owned' | 'gone' | 'decision' | 'unknown' | 'failed';
export type ClaudeSessionResult = { ok: true; sessionId: string; forked: boolean } | { ok: false; reason: ClaudeSessionRefusal; message?: string };
/** `door`: answered from anywhere but the desktop window. */
export type ClaudeAnswerResult = { ok: true } | { ok: false; reason: 'gone' | 'decision' | 'door' };

/** The activity job a session's lines are kept under. */
export const claudeJob = (sessionId: string): string => `claude:${sessionId}`;
