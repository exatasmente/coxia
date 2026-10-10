import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { neutralConfig } from '../../src/shared/config';
import type { WorkspaceConfig } from '../../src/shared/config/types';
import type { AuditEntry } from '../../src/shared/auditoria';
import type { MemorySurface } from '../../src/shared/memory';
import { createFacts } from '../../src/main/memory/facts';
import { createMemoryIndex, type MemoryIndex } from '../../src/main/memory/index';
import { createMemoryPort, type MemoryOpenContext, type MemoryPort } from '../../src/main/memory/port';
import { createMemorySession, type MemorySession, type MemorySessionContext } from '../../src/main/memory/session';
import { createMemoryStore, type MemoryStore, type MemoryWrite } from '../../src/main/memory/store';
import { createSharedMemory } from '../../src/main/runner/activities';
import { createRunStore, type RunStore } from '../../src/main/runs-core';
import { drive, startInput } from './runs';

// A workspace folder of the test's own with the memory over it: the store, the index, the facts and a run store. Nothing here touches the app's real data.

export const HOME = '/home/person';
export const T0 = Date.parse('2026-10-09T10:00:00Z');

export interface MemoryWorld {
  ws: string;
  config: WorkspaceConfig;
  store: MemoryStore;
  runs: RunStore;
  index: MemoryIndex;
  audits: Omit<AuditEntry, 'at'>[];
  lines: string[];
  clock: { now: number };
  session(ctx?: Partial<MemorySessionContext>): Promise<MemorySession>;
  port(): MemoryPort;
  /** The way the runner hears of an agent's write (`RunnerDeps.memoryWrites`). */
  onWrite(listener: (write: MemoryWrite) => void): () => void;
  /** A run whose worktree really exists, with the documents its stages produced. */
  runWith(id: string, ref: string, docs?: Record<string, string>, over?: { repo?: string }): string;
}

/** `ws` is a workspace folder the test already has (a runner's data folder, say): the memory then lives in it, beside its `runs/`. */
export function memoryWorld(over: { ws?: string } = {}): MemoryWorld {
  const ws = over.ws ?? mkdtempSync(join(tmpdir(), 'coxia-memory-world-'));
  let counter = 0;
  const clock = { now: T0 };
  const config = neutralConfig();
  config.runner.sharedMemory = true;
  const writers = new Set<(write: MemoryWrite) => void>();
  const store = createMemoryStore(ws, { now: () => clock.now, hex: () => (++counter).toString(16).padStart(8, '0'), home: HOME, onWrite: (write) => writers.forEach((fn) => fn(write)) });
  const runs = createRunStore(join(ws, 'runs'));
  const index = createMemoryIndex({
    store,
    runs,
    activities: createSharedMemory(ws, () => new Date(clock.now)),
    facts: createFacts({ config: () => config, secret: () => false, home: HOME }),
    language: () => 'en',
    now: () => clock.now,
  });
  const audits: Omit<AuditEntry, 'at'>[] = [];
  const lines: string[] = [];
  const base = (): MemorySessionContext => ({ surface: 'stage' as MemorySurface, agent: 'developer', conversation: 'general', writes: true, tools: true, home: HOME });
  return {
    ws,
    config,
    store,
    runs,
    index,
    audits,
    lines,
    clock,
    onWrite: (listener) => {
      writers.add(listener);
      return () => void writers.delete(listener);
    },
    session: (ctx = {}) => createMemorySession({ store, index, audit: (e) => audits.push(e), log: (l) => lines.push(l) }, { ...base(), ...ctx }),
    port: () => createMemoryPort({ config: () => config, store, index, audit: (e) => audits.push(e), log: (l) => lines.push(l), home: HOME }),
    runWith(id, ref, docs = {}, over = {}) {
      const worktree = join(ws, 'worktrees', id);
      const folder = `docs/cycles/${ref.split('#')[1]}-thing`;
      mkdirSync(join(worktree, folder), { recursive: true });
      for (const [name, text] of Object.entries(docs)) writeFileSync(join(worktree, folder, name), text);
      runs.create(drive(undefined, startInput({ id, issue: { ref, iid: Number(ref.split('#')[1]), title: `Work on ${ref}`, url: null }, repo: over.repo ?? 'app', branch: `coxia/${id}`, worktree, cycleFolder: folder })).run);
      return id;
    },
  };
}

export const openCtx = (over: Partial<MemoryOpenContext> = {}): MemoryOpenContext => ({
  surface: 'stage',
  agent: { id: 'developer', permission: 'worktree', model: { role: null, provider: 'local', model: 'qwen3:8b' } } as MemoryOpenContext['agent'],
  conversation: 'general',
  writes: true,
  tools: true,
  ...over,
});
