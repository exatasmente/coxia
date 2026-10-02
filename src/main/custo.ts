import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CustoKey, CustoKind, CustoScope, CustoSummary } from '../shared/custo';
import { DEFAULT_GOAL, type GenRef, type GenStat, classify, firstPromptOf, gensOf, inScope, parseGeneration, parseKey, summarize } from './custo-core';
import { ATAS, DATA_ROOT, WORKSPACE_ID } from './env';
import { openRouterKey } from './llm';
import { reuseTimes } from './falas';
import type { Module } from './module';
import { sessionOwners } from './sessions-core';
import { readRegistry } from './workspaces-core';
import { rc } from './workspaceConfig';
import { t } from '../shared/i18n';

const FILE = join(ATAS, 'custo.json');
const API = 'https://openrouter.ai/api/v1';
const transcriptsDir = (): string => rc().transcriptsDir;
const PARALLEL = 6;
const DAY = 86_400_000;

interface FileEntry {
  m: number;
  size: number;
  kind: CustoKind | null;
  gens: GenRef[];
  // 2 = generations carry the model read from the transcript; older entries are read again once.
  v?: number;
}

// What OpenRouter answered once is final, so every generation is asked only once; "gone" ones are not asked again.
interface Cache {
  version: 1;
  goal: number;
  refreshedAt: string | null;
  key: CustoKey | null;
  files: Record<string, FileEntry>;
  gens: Record<string, GenStat | { gone: true }>;
}

function read(): Cache {
  try {
    if (existsSync(FILE)) {
      const c = JSON.parse(readFileSync(FILE, 'utf8')) as Cache;
      if (c.version === 1) return c;
    }
  } catch {}
  return { version: 1, goal: DEFAULT_GOAL, refreshedAt: null, key: null, files: {}, gens: {} };
}

function write(c: Cache): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(c));
  renameSync(`${FILE}.tmp`, FILE);
}

function view(c: Cache, scope: CustoScope = 'current', keyError: string | null = null): CustoSummary {
  const modelOf = new Map(Object.values(c.files).flatMap((f) => f.gens.flatMap((g) => (g.model ? [[g.id, g.model] as const] : []))));
  const stats = Object.entries(c.gens).flatMap(([id, g]) => ('gone' in g ? [] : [g.model || !modelOf.has(id) ? g : { ...g, model: modelOf.get(id) }]));
  const known = new Set(Object.keys(c.gens));
  const reg = readRegistry(DATA_ROOT);
  const owners = reg ? sessionOwners(DATA_ROOT, reg) : new Map<string, string>();
  const mine = inScope(scope, WORKSPACE_ID, owners);
  const pending = Object.values(c.files).flatMap((f) => f.gens).filter((g) => !known.has(g.id) && mine(g.session)).length;
  const current = reg?.list.find((w) => w.id === WORKSPACE_ID) ?? { id: WORKSPACE_ID, name: WORKSPACE_ID, createdAt: '', test: false };
  return summarize({ gens: stats, pending, goal: c.goal, key: c.key, keyError, refreshedAt: c.refreshedAt, reuses: reuseTimes(), scope, owners, workspaces: reg?.list ?? [current], current });
}

const scopeOf = (v: unknown): CustoScope => (v === 'all' ? 'all' : 'current');

// Month start or the last 7 days, whichever reaches further back.
function since(now = Date.now()): number {
  const d = new Date(now);
  return Math.min(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now - 7 * DAY) - DAY;
}

function scan(c: Cache, from: number): GenRef[] {
  if (!existsSync(transcriptsDir())) return [];
  const live = new Set<string>();
  for (const name of readdirSync(transcriptsDir()).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(transcriptsDir(), name);
    const st = statSync(path);
    if (st.mtimeMs < from) continue;
    live.add(name);
    const known = c.files[name];
    if (known && known.v === 2 && known.m === st.mtimeMs && known.size === st.size) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const kind = classify(firstPromptOf(lines) ?? '');
    c.files[name] = { m: st.mtimeMs, size: st.size, v: 2, kind, gens: kind ? gensOf(lines, kind, name.replace(/\.jsonl$/, '')) : [] };
  }
  return Object.entries(c.files).flatMap(([name, f]) => (live.has(name) ? f.gens.filter((g) => g.at >= from) : []));
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(t('main.custo.httpError', { status }));
  }
}

// The key only travels in the Authorization header; no log or error message ever includes it.
async function get(path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${openRouterKey()}`, 'User-Agent': 'cerimonias/0.1' }, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    throw new HttpError(res.status);
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(size, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

// One refresh runs at a time and every caller waits for it; each gets the summary in its own scope.
let running: Promise<{ c: Cache; keyError: string | null }> | null = null;

export async function refreshCusto(progress?: (done: number, total: number) => void, scope: CustoScope = 'current'): Promise<CustoSummary> {
  running ??= (async () => {
    const c = read();
    const refs = scan(c, since()).filter((g) => !(g.id in c.gens));
    let done = 0;
    progress?.(0, refs.length);
    await pool(refs, PARALLEL, async (ref) => {
      try {
        c.gens[ref.id] = parseGeneration(await get(`/generation?id=${encodeURIComponent(ref.id)}`), ref);
      } catch (e) {
        // A generation not on the books yet (404 right after the call) is asked again next time; an old one is not coming.
        if (e instanceof HttpError && e.status === 404 && Date.now() - ref.at > DAY) c.gens[ref.id] = { gone: true };
      }
      progress?.(++done, refs.length);
    });
    let keyError: string | null = null;
    try {
      c.key = parseKey(await get('/key'));
    } catch (e) {
      keyError = e instanceof Error ? e.message : String(e);
    }
    c.refreshedAt = new Date().toISOString();
    write(c);
    return { c, keyError };
  })().finally(() => {
    running = null;
  });
  const done = await running;
  return view(done.c, scope, done.keyError);
}

export const custo: Module = (ctx) => {
  ctx.handle('custo:summary', (scope?: CustoScope) => view(read(), scopeOf(scope)));
  ctx.handle('custo:refresh', (scope?: CustoScope) => refreshCusto((done, total) => ctx.emit({ type: 'module', name: 'custo-progress', payload: { done, total } }), scopeOf(scope)));
  ctx.handle('custo:goal', (goal: number, scope?: CustoScope) => {
    if (!(goal >= 1 && goal <= 10_000)) throw new Error(t('main.custo.goalRange'));
    const c = read();
    c.goal = Math.round(goal * 100) / 100;
    write(c);
    return view(c, scopeOf(scope));
  });
};
