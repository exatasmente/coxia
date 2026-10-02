import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CustoKey, CustoKind, CustoSummary } from '../shared/custo';
import { DEFAULT_GOAL, type GenRef, type GenStat, classify, firstPromptOf, gensOf, parseGeneration, parseKey, summarize } from './custo-core';
import { ATAS, HOME, WORKSPACE, openRouterKey } from './env';
import type { Module } from './module';

const FILE = join(ATAS, 'custo.json');
const API = 'https://openrouter.ai/api/v1';
const TRANSCRIPTS = process.env.CERIMONIAS_TRANSCRIPTS_DIR ?? join(HOME, '.claude/projects', WORKSPACE.replace(/\//g, '-'));
const PARALLEL = 6;
const DAY = 86_400_000;

interface FileEntry {
  m: number;
  size: number;
  kind: CustoKind | null;
  gens: GenRef[];
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

function view(c: Cache, keyError: string | null = null): CustoSummary {
  const stats = Object.values(c.gens).filter((g): g is GenStat => !('gone' in g));
  const known = new Set(Object.keys(c.gens));
  const pending = Object.values(c.files).flatMap((f) => f.gens).filter((g) => !known.has(g.id)).length;
  return summarize({ gens: stats, pending, goal: c.goal, key: c.key, keyError, refreshedAt: c.refreshedAt });
}

// Month start or the last 7 days, whichever reaches further back.
function since(now = Date.now()): number {
  const d = new Date(now);
  return Math.min(new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now - 7 * DAY) - DAY;
}

function scan(c: Cache, from: number): GenRef[] {
  if (!existsSync(TRANSCRIPTS)) return [];
  const live = new Set<string>();
  for (const name of readdirSync(TRANSCRIPTS).filter((f) => f.endsWith('.jsonl'))) {
    const path = join(TRANSCRIPTS, name);
    const st = statSync(path);
    if (st.mtimeMs < from) continue;
    live.add(name);
    const known = c.files[name];
    if (known && known.m === st.mtimeMs && known.size === st.size) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    const kind = classify(firstPromptOf(lines) ?? '');
    c.files[name] = { m: st.mtimeMs, size: st.size, kind, gens: kind ? gensOf(lines, kind, name.replace(/\.jsonl$/, '')) : [] };
  }
  return Object.entries(c.files).flatMap(([name, f]) => (live.has(name) ? f.gens.filter((g) => g.at >= from) : []));
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`OpenRouter respondeu ${status}`);
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

let running: Promise<CustoSummary> | null = null;

export function refreshCusto(progress?: (done: number, total: number) => void): Promise<CustoSummary> {
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
    return view(c, keyError);
  })().finally(() => {
    running = null;
  });
  return running;
}

export const custo: Module = (ctx) => {
  ctx.handle('custo:summary', () => view(read()));
  ctx.handle('custo:refresh', () => refreshCusto((done, total) => ctx.emit({ type: 'module', name: 'custo-progress', payload: { done, total } })));
  ctx.handle('custo:goal', (goal: number) => {
    if (!(goal >= 1 && goal <= 10_000)) throw new Error('a meta deve ficar entre US$ 1 e US$ 10.000');
    const c = read();
    c.goal = Math.round(goal * 100) / 100;
    write(c);
    return view(c);
  });
};
