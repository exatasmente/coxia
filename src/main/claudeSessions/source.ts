import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ClaudeLiveSession, ClaudeTranscript, LiveKind, LiveStatus } from '../../shared/claudeSessions';

// Where the machine's Claude Code sessions come from. Transcripts and their messages come from the SDK; the processes alive now come from the record each one writes in
// `~/.claude/sessions/<pid>.json`. That folder also holds each session's key (`<pid>.<x>.key`), and `~/.claude` holds the credentials and the daemon's key: none of them is
// ever opened. This file is the feature's one reader of the disk, and `guardedRead` its one read: it takes only `sessions/<digits>.json` and hands back only the allowed fields.

/** The fields of a session record the app may know; anything else in the file is dropped unread by the caller. */
export const LIVE_FIELDS = ['pid', 'sessionId', 'cwd', 'kind', 'status', 'updatedAt'] as const;

const RECORD = /^\d+\.json$/;
const FORBIDDEN = /(^\.credentials\.json$|\.key$)/;

export interface DiskDeps {
  list(dir: string): string[];
  read(path: string): string;
  /** A regular file, not a link: a record that links elsewhere (to a key) is never followed. */
  plain(path: string): boolean;
}

const disk: DiskDeps = {
  list: (dir) => readdirSync(dir),
  read: (path) => readFileSync(path, 'utf8'),
  plain: (path) => {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  },
};

/**
 * Reads one session record: the file must be `<digits>.json` directly inside `sessionsDir` and a regular file (not a link), never a key or the credentials. Returns only the
 * allowed fields, or null for a refused name or a record that does not parse.
 */
export function guardedRead(path: string, sessionsDir: string, deps: Pick<DiskDeps, 'read' | 'plain'> = disk): Partial<Record<(typeof LIVE_FIELDS)[number], unknown>> | null {
  const name = basename(path);
  if (FORBIDDEN.test(name) || !RECORD.test(name) || dirname(path) !== sessionsDir || !deps.plain(path)) return null;
  try {
    const raw = JSON.parse(deps.read(path)) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    return Object.fromEntries(LIVE_FIELDS.filter((f) => f in raw).map((f) => [f, raw[f]]));
  } catch {
    return null;
  }
}

const KINDS: readonly LiveKind[] = ['interactive', 'background'];
const STATUSES: readonly LiveStatus[] = ['idle', 'busy'];

function liveOf(r: Partial<Record<(typeof LIVE_FIELDS)[number], unknown>>): ClaudeLiveSession | null {
  if (typeof r.pid !== 'number' || !Number.isInteger(r.pid) || r.pid <= 0 || typeof r.sessionId !== 'string' || !r.sessionId) return null;
  return {
    pid: r.pid,
    sessionId: r.sessionId,
    cwd: typeof r.cwd === 'string' ? r.cwd : '',
    kind: KINDS.includes(r.kind as LiveKind) ? (r.kind as LiveKind) : 'interactive',
    status: STATUSES.includes(r.status as LiveStatus) ? (r.status as LiveStatus) : 'idle',
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process is there, owned by somebody else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The processes alive now, from the records of the sessions folder. A folder that is not there is no session. */
export function liveSessions(sessionsDir: string, deps: DiskDeps & { alive?(pid: number): boolean } = disk): ClaudeLiveSession[] {
  let names: string[];
  try {
    names = deps.list(sessionsDir);
  } catch {
    return [];
  }
  const alive = deps.alive ?? isAlive;
  const out: ClaudeLiveSession[] = [];
  for (const name of names.filter((n) => RECORD.test(n))) {
    const record = guardedRead(join(sessionsDir, name), sessionsDir, deps);
    const live = record && liveOf(record);
    if (live && alive(live.pid)) out.push(live);
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A message of a transcript, as the SDK's getSessionMessages and the stream of a query carry it. */
export interface RawMessage {
  type: string;
  uuid?: string;
  session_id?: string;
  message?: unknown;
  subtype?: string;
  result?: unknown;
  is_error?: boolean;
}

/** The port the feature reads the machine through: the real one wraps the SDK and the sessions folder, the tests hand a fake. */
export interface MachineSessions {
  transcripts(): Promise<ClaudeTranscript[]>;
  messages(sessionId: string): Promise<RawMessage[]>;
  live(): ClaudeLiveSession[];
}

interface SdkInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

export const transcriptOf = (s: SdkInfo): ClaudeTranscript => ({
  sessionId: s.sessionId,
  title: s.customTitle || s.summary || '',
  firstPrompt: s.firstPrompt ?? '',
  cwd: s.cwd ?? '',
  branch: s.gitBranch ?? '',
  lastModified: s.lastModified,
});

export interface SdkSessions {
  listSessions(o?: { limit?: number }): Promise<SdkInfo[]>;
  getSessionMessages(id: string): Promise<RawMessage[]>;
}

export function machineSessions(sdk: () => Promise<SdkSessions>, sessionsDir: string): MachineSessions {
  return {
    transcripts: async () => (await (await sdk()).listSessions({ limit: 200 })).map(transcriptOf),
    messages: async (id) => (await sdk()).getSessionMessages(id),
    live: () => liveSessions(sessionsDir),
  };
}
