import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CustoKind } from '../shared/custo';
import { refOpenersOf } from '../shared/cycles/prompts';
import { classify } from './custo-core';
import { type Registry, workspaceDir } from './workspaces-core';

export const SESSIONS_FILE = 'sessions.jsonl';

// One line per agent session a workspace started; the transcript itself stays in the shared ~/.claude/projects folder.
export interface SessionEntry {
  id: string;
  at: string;
  role: string;
  kind: CustoKind | null;
  ref: string | null;
}

// The prompts whose first line names the card: its ref is what ties a session to an activity.
const REF_PROMPTS = ['turn.main', 'deep.intro', 'gate.start', 'qa.prepare', 'reentry.main'];

function refOf(prompt: string): string | null {
  for (const id of REF_PROMPTS) {
    for (const re of refOpenersOf(id)) {
      const m = re.exec(prompt);
      if (m) return m[1];
    }
  }
  return null;
}

export function entryOf(id: string, role: string, prompt: string, now = new Date()): SessionEntry {
  return { id, at: now.toISOString(), role, kind: classify(prompt), ref: refOf(prompt) };
}

export function parseIndex(text: string): SessionEntry[] {
  const seen = new Set<string>();
  const out: SessionEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<SessionEntry>;
      if (typeof e.id !== 'string' || !e.id || typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at)) || seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({
        id: e.id,
        at: e.at,
        role: typeof e.role === 'string' ? e.role : '',
        kind: typeof e.kind === 'string' ? (e.kind as CustoKind) : null,
        ref: typeof e.ref === 'string' ? e.ref : null,
      });
    } catch {}
  }
  return out;
}

export function readIndex(dir: string): SessionEntry[] {
  try {
    const file = join(dir, SESSIONS_FILE);
    return existsSync(file) ? parseIndex(readFileSync(file, 'utf8')) : [];
  } catch {
    return [];
  }
}

// Append-only; a resumed session that is already listed is not written again.
export function recordEntry(dir: string, entry: SessionEntry): boolean {
  if (readIndex(dir).some((e) => e.id === entry.id)) return false;
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, SESSIONS_FILE), `${JSON.stringify(entry)}\n`);
  return true;
}

// session id -> workspace id. A session recorded by two workspaces (a resumed id) belongs to the one that recorded it first.
export function sessionOwners(root: string, reg: Registry): Map<string, string> {
  const owners = new Map<string, { ws: string; at: number }>();
  for (const w of reg.list) {
    for (const e of readIndex(workspaceDir(root, w.id))) {
      const at = Date.parse(e.at);
      const known = owners.get(e.id);
      if (!known || at < known.at) owners.set(e.id, { ws: w.id, at });
    }
  }
  return new Map([...owners].map(([id, o]) => [id, o.ws]));
}

// The sessions another workspace started count as uses of their transcripts for retention.
export function sessionRefs(root: string, reg: Registry, exceptId: string): { sessionId: string; at: number; keep: boolean; from: string }[] {
  return reg.list
    .filter((w) => w.id !== exceptId)
    .flatMap((w) => readIndex(workspaceDir(root, w.id)).map((e) => ({ sessionId: e.id, at: Date.parse(e.at), keep: false, from: `sessão do workspace ${w.name}` })));
}
