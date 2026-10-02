import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DepHealth, DepId, SaudeSnapshot, TaskHealth } from '../shared/saude';
import { getSettings } from './config';
import { logError } from './errorlog';
import { DATA_ROOT, GITLAB, HOME, openRouterKey } from './env';
import type { Module, ModuleContext } from './module';
import { readReport, reportStatus } from './report';
import { voiceStatus } from './voice';

const run = promisify(execFile);

const FILE = join(DATA_ROOT, 'saude.json');
const DEPS_EVERY_MIN = 30;
const STREAK_ALERT = 3;

const LABELS: Record<string, string> = {
  status: 'Conferir status das atividades',
  release: 'Conferir release',
  watchers: 'Vigias',
  efeitos: 'Conferir efeitos da ata',
  retention: 'Limpeza de dados antigos',
  feedback: 'Feedback dos MRs',
  radar: 'Radar de trabalho paralelo',
  'gitlab-quick': 'Ações rápidas do GitLab',
  'tempo-export': 'Exportar o tempo do dia',
  'saude-deps': 'Verificar dependências',
};

const DEP_LABELS: Record<DepId, string> = {
  glab: 'glab autenticado',
  'openrouter-key': 'Chave da OpenRouter',
  'daily-report': 'daily-report',
  voice: 'Sidecar de voz',
  model: 'Modelo respondendo',
};

interface Stored {
  tasks: Record<string, TaskHealth>;
  deps: Partial<Record<DepId, DepHealth>>;
}

let stored: Stored | null = null;
let ctx: ModuleContext | null = null;
let checking: Promise<SaudeSnapshot> | null = null;

function state(): Stored {
  if (stored) return stored;
  try {
    stored = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Stored) : { tasks: {}, deps: {} };
  } catch {
    stored = { tasks: {}, deps: {} };
  }
  return stored;
}

function save(): void {
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify(state(), null, 2));
    renameSync(`${FILE}.tmp`, FILE);
  } catch (e) {
    console.error('[saude] could not write saude.json', e);
  }
}

// Keys and tokens never reach the file or the screen.
function short(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/(glpat-|sk-or-v1-|sk-)[\w-]+/g, '$1***')
    .slice(0, 160) ?? '';
}

export function snapshot(): SaudeSnapshot {
  const s = state();
  const tasks = Object.values(s.tasks).sort((a, b) => a.label.localeCompare(b.label));
  const deps = (Object.keys(DEP_LABELS) as DepId[]).map(
    (id): DepHealth => s.deps[id] ?? { id, label: DEP_LABELS[id], ok: null, message: 'Ainda não verificado.', checkedAt: null, durationMs: null },
  );
  const problems = tasks.filter((t) => t.ok === false).length + deps.filter((d) => d.ok === false).length;
  return { tasks, deps, problems, checking: checking !== null };
}

function changed(): void {
  save();
  ctx?.emit({ type: 'module', name: 'saude:changed', payload: snapshot() });
}

function entry(name: string, everyMin?: number | null): TaskHealth {
  const s = state();
  s.tasks[name] ??= { name, label: LABELS[name] ?? name, everyMin: everyMin ?? null, lastRunAt: null, durationMs: null, ok: null, message: 'Ainda não rodou.', failStreak: 0 };
  if (everyMin !== undefined) s.tasks[name].everyMin = everyMin;
  return s.tasks[name];
}

// Lists a periodic task before its first run.
export function knownTask(name: string, everyMin: number | null): void {
  entry(name, everyMin);
}

// Wraps one run of a periodic task: records when, how long and how it ended, and warns on the third failure in a row.
export async function track<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = entry(name);
  const started = Date.now();
  try {
    const result = await fn();
    t.ok = true;
    t.failStreak = 0;
    t.message = (typeof result === 'string' && short(result)) || 'Ok.';
    return result;
  } catch (e) {
    t.ok = false;
    t.failStreak += 1;
    logError(`job:${name}`, e, { job: name });
    t.message = short(e instanceof Error ? e.message : String(e)) || 'Falhou sem mensagem.';
    // Only the third failure of a sequence warns; a success resets the count.
    if (t.failStreak === STREAK_ALERT && ctx && getSettings().notifications) {
      ctx.notify({
        title: `${t.label} falhou ${STREAK_ALERT} vezes seguidas`,
        body: `${t.message}\nClique para ver a saúde do app.`,
        onClick: { type: 'open', screen: { name: 'saude' } },
      });
    }
    throw e;
  } finally {
    t.lastRunAt = new Date().toISOString();
    t.durationMs = Date.now() - started;
    changed();
  }
}

// ---------- dependencies ----------

type Result = { ok: boolean; message: string };

async function glabCheck(): Promise<Result> {
  try {
    const { stdout, stderr } = await run('glab', ['auth', 'status', '--hostname', GITLAB], { env: { ...process.env, GITLAB_HOST: GITLAB }, timeout: 20_000 });
    const text = `${stdout}\n${stderr}`;
    return { ok: true, message: short(text.split('\n').find((l) => /logged in/i.test(l)) ?? text) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, message: short(`${err.stderr ?? ''}\n${err.stdout ?? ''}`) || short(err.message) };
  }
}

async function keyCheck(): Promise<Result> {
  try {
    const { stdout } = await run(join(HOME, '.local/bin/openrouter-key'), ['--status'], { timeout: 10_000 });
    const get = (k: string) => stdout.split('\n').find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).trim();
    return { ok: true, message: `Chave presente (fonte ${get('fonte') ?? '?'}, ${get('tamanho') ?? '?'} caracteres).` };
  } catch {
    return { ok: false, message: 'Sem chave da OpenRouter. Rode openrouter-key --status no terminal.' };
  }
}

async function reportCheck(): Promise<Result> {
  const before = reportStatus();
  // Fresh cache answers without a new run; a stale one makes the single shared run happen now.
  try {
    await readReport();
  } catch (e) {
    return { ok: false, message: short(e instanceof Error ? e.message : String(e)) };
  }
  const after = reportStatus();
  const took = after.lastDurationMs ? ` em ${Math.round(after.lastDurationMs / 1000)} s` : '';
  const fromCache = before.lastOkAt === after.lastOkAt && after.lastOkAt !== null;
  const age = fromCache ? ` (leitura de ${Math.round((Date.now() - (after.lastOkAt ?? 0)) / 60_000)} min atrás)` : '';
  return { ok: true, message: `Respondeu${took}${age}.` };
}

async function voiceCheck(): Promise<Result> {
  const v = await voiceStatus();
  if (!v.alive) return { ok: false, message: 'O sidecar de voz não está rodando. Reabra o app.' };
  if (v.pingMs === null) return { ok: false, message: 'O sidecar de voz não respondeu ao ping em 5 s.' };
  return { ok: true, message: `Vivo, respondeu em ${v.pingMs} ms${v.ready ? '' : ' (ainda carregando o modelo)'}.` };
}

// One minimal request (a few tokens) over the same Anthropic-compatible route the agents use.
async function modelCheck(): Promise<Result> {
  const model = getSettings().models.turn;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${openRouterKey()}` },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(40_000),
    });
    if (res.ok) return { ok: true, message: `${model} respondeu.` };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message ?? '';
    return { ok: false, message: short(`HTTP ${res.status} ${msg}`) };
  } catch (e) {
    return { ok: false, message: short(e instanceof Error ? e.message.replace(/Bearer\s+\S+/g, 'Bearer ***') : String(e)) };
  }
}

const CHECKS: { id: DepId; run: () => Promise<Result>; costly?: boolean }[] = [
  { id: 'glab', run: glabCheck },
  { id: 'openrouter-key', run: keyCheck },
  { id: 'daily-report', run: reportCheck },
  { id: 'voice', run: voiceCheck },
  { id: 'model', run: modelCheck, costly: true },
];

async function runChecks(withModel: boolean): Promise<SaudeSnapshot> {
  const s = state();
  await Promise.all(
    CHECKS.filter((c) => withModel || !c.costly).map(async (c) => {
      const started = Date.now();
      let r: Result;
      try {
        r = await c.run();
      } catch (e) {
        r = { ok: false, message: short(e instanceof Error ? e.message : String(e)) };
      }
      s.deps[c.id] = { id: c.id, label: DEP_LABELS[c.id], ok: r.ok, message: r.message, checkedAt: new Date().toISOString(), durationMs: Date.now() - started };
      changed();
    }),
  );
  return { ...snapshot(), checking: false };
}

// Concurrent calls (the 30-minute job and the button) share one round of checks.
export async function checkDeps(withModel: boolean): Promise<SaudeSnapshot> {
  if (checking) {
    const current = await checking;
    // The running round skipped the model call the button asks for.
    if (!withModel) return current;
  }
  checking ??= runChecks(withModel).finally(() => {
    checking = null;
    changed();
  });
  return checking;
}

export const saude: Module = (c) => {
  ctx = c;
  c.job({ name: 'saude-deps', everyMin: DEPS_EVERY_MIN, workHoursOnly: false, run: async () => void (await checkDeps(false)) });
  c.handle('saude:get', () => snapshot());
  c.handle('saude:check', () => checkDeps(true));
};
