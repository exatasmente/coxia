import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { AgentTurn, Card, CardSeen } from '../shared/types';
import { seenOf } from '../shared/sameDay';
import { rc } from './workspaceConfig';
import { ATAS } from './env';
import { type Artifact, type Saved, fingerprint, isReusable, reusedTurn } from './falas-core';

const FILE = join(ATAS, 'falas.json');
const KEEP_REUSES_MS = 60 * 86_400_000;

interface Store {
  version: 1;
  turns: Record<string, Saved>;
  reuses: { ref: string; at: string }[];
}

function read(): Store {
  try {
    if (existsSync(FILE)) {
      const s = JSON.parse(readFileSync(FILE, 'utf8')) as Store;
      if (s.version === 1) return { version: 1, turns: s.turns ?? {}, reuses: s.reuses ?? [] };
    }
  } catch {}
  return { version: 1, turns: {}, reuses: [] };
}

function write(s: Store): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s));
  renameSync(`${FILE}.tmp`, FILE);
}

function artifactsOf(dir: string): Artifact[] {
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((name) => {
      const path = join(d, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  try {
    return walk(dir).map((p) => ({ path: relative(dir, p), mtime: statSync(p).mtimeMs }));
  } catch {
    return [];
  }
}

export function cardFingerprint(card: Card): string {
  return fingerprint(card, card.spec ? artifactsOf(card.spec.folder) : []);
}

// The fingerprint and what it was made from, so a later meeting of the day can say what moved and not only that something did.
export function cardSnapshot(card: Card, now = Date.now()): { fp: string; seen: CardSeen } {
  const artifacts = card.spec ? artifactsOf(card.spec.folder) : [];
  const fp = fingerprint(card, artifacts);
  return { fp, seen: seenOf(card, fp, artifacts, new Date(now).toISOString()) };
}

export const sessionIsAlive = (id: string | null): boolean => sessionAlive(id);

const sessionAlive = (id: string | null) => !!id && existsSync(join(rc().transcriptsDir, `${id}.jsonl`));

// A turn saved within the last days for the same fingerprint, rebuilt to say nothing changed; null means ask the agent.
export function reusableTurn(card: Card, now = Date.now()): AgentTurn | null {
  const store = read();
  const saved = store.turns[card.ref];
  if (!isReusable(saved, cardFingerprint(card), now)) return null;
  store.reuses = [...store.reuses, { ref: card.ref, at: new Date(now).toISOString() }].filter((r) => now - Date.parse(r.at) < KEEP_REUSES_MS);
  write(store);
  return reusedTurn(saved, now, sessionAlive(saved.turn.sessionId));
}

// The fingerprint is taken before the agent call, so a spec edited while it ran is not saved as if the speech had seen it.
export function rememberTurn(card: Card, turn: AgentTurn, fp: string, now = Date.now()): void {
  const store = read();
  store.turns[card.ref] = { fp, turn, at: new Date(now).toISOString() };
  write(store);
}

// A speech not made because the card did not change since an earlier meeting of the same day.
export function recordReuse(ref: string, now = Date.now()): void {
  const store = read();
  store.reuses = [...store.reuses, { ref, at: new Date(now).toISOString() }].filter((r) => now - Date.parse(r.at) < KEEP_REUSES_MS);
  write(store);
}

export function reuseTimes(): number[] {
  return read().reuses.map((r) => Date.parse(r.at));
}
