import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DepHealth, DepId, SaudeSnapshot, TaskHealth } from '../shared/saude';
import { getSettings } from './config';
import { logError } from './errorlog';
import { DATA_ROOT } from './env';
import { providerSecret } from './llm';
import { secrets } from './secrets';
import { t } from '../shared/i18n';
import { getConfig, rc, vcsCliEnv } from './workspaceConfig';
import { vcsCliFor, vcsProvider, vcsReady } from './vcs';
import type { Module, ModuleContext } from './module';
import { readReport, reportStatus } from './report';
import { voiceStatus } from './voice';

const run = promisify(execFile);

const FILE = join(DATA_ROOT, 'saude.json');
const DEPS_EVERY_MIN = 30;
const STREAK_ALERT = 3;

const TASK_LABELS = ['status', 'release', 'watchers', 'efeitos', 'retention', 'feedback', 'radar', 'gitlab-quick', 'tempo-export', 'saude-deps'];
const DEP_IDS: DepId[] = ['vcs', 'llm-key', 'card-source', 'voice', 'model'];

// Labels follow the language of the moment, so they are looked up when shown and never stored.
const taskLabel = (name: string): string => (TASK_LABELS.includes(name) ? t(`main.saude.task.${name}`) : name);
const depLabel = (id: DepId): string => t(`main.saude.dep.${id}`);

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
  const tasks = Object.values(s.tasks)
    .map((task) => ({ ...task, label: taskLabel(task.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const deps = DEP_IDS.map(
    (id): DepHealth => ({ ...(s.deps[id] ?? { id, ok: null, message: t('main.saude.notChecked'), checkedAt: null, durationMs: null }), label: depLabel(id) }),
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
  s.tasks[name] ??= { name, label: taskLabel(name), everyMin: everyMin ?? null, lastRunAt: null, durationMs: null, ok: null, message: t('main.saude.notRun'), failStreak: 0 };
  if (everyMin !== undefined) s.tasks[name].everyMin = everyMin;
  return s.tasks[name];
}

// Lists a periodic task before its first run.
export function knownTask(name: string, everyMin: number | null): void {
  entry(name, everyMin);
}

// Wraps one run of a periodic task: records when, how long and how it ended, and warns on the third failure in a row.
export async function track<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const task = entry(name);
  const started = Date.now();
  try {
    const result = await fn();
    task.ok = true;
    task.failStreak = 0;
    task.message = (typeof result === 'string' && short(result)) || t('main.saude.ok');
    return result;
  } catch (e) {
    task.ok = false;
    task.failStreak += 1;
    logError(`job:${name}`, e, { job: name });
    task.message = short(e instanceof Error ? e.message : String(e)) || t('main.saude.failedNoMessage');
    // Only the third failure of a sequence warns; a success resets the count.
    if (task.failStreak === STREAK_ALERT && ctx && getSettings().notifications) {
      ctx.notify({
        title: t('main.saude.failedStreak', { task: task.label, count: STREAK_ALERT }),
        body: `${task.message}\n${t('main.saude.clickHealth')}`,
        onClick: { type: 'open', screen: { name: 'saude' } },
      });
    }
    throw e;
  } finally {
    task.lastRunAt = new Date().toISOString();
    task.durationMs = Date.now() - started;
    changed();
  }
}

// ---------- dependencies ----------

type Result = { ok: boolean; message: string };

async function vcsCheck(): Promise<Result> {
  const vcs = rc().primaryVcs;
  if (!vcs) return { ok: true, message: t('main.saude.noVcs') };
  const cli = vcsCliFor();
  if (cli) {
    try {
      const { stdout, stderr } = await run(cli.command, ['auth', 'status', '--hostname', vcs.host], { env: vcsCliEnv(), timeout: 20_000 });
      const text = `${stdout}\n${stderr}`;
      return { ok: true, message: short(text.split('\n').find((l) => /logged in/i.test(l)) ?? text) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      return { ok: false, message: short(`${err.stderr ?? ''}\n${err.stdout ?? ''}`) || short(err.message) };
    }
  }
  if (!vcsReady()) return { ok: false, message: t('vcs.health.noToken', { id: vcs.id }) };
  try {
    const me = await vcsProvider().currentUser();
    return { ok: true, message: t('vcs.health.api', { host: vcs.host, user: me.username }) };
  } catch (e) {
    return { ok: false, message: short((e as Error).message) };
  }
}

// The secrets of the providers the roles use: present, and from which source. Never the value.
async function keyCheck(): Promise<Result> {
  const used = [...new Set(Object.values(getConfig().llm.roles).map((r) => r.provider))].map((id) => getConfig().llm.providers.find((p) => p.id === id)).filter((p) => !!p);
  const withKey = used.filter((p) => p.secretRef);
  if (!withKey.length) return { ok: true, message: t('main.saude.noKeyNeeded') };
  const lines: string[] = [];
  for (const p of withKey) {
    const ref = p.secretRef as string;
    const check = secrets().check(ref);
    if (!check.ok) return { ok: false, message: t('main.saude.noKey', { id: p.id, reason: check.reason ?? t('main.saude.notConfigured') }) };
    const info = secrets().list().find((i) => i.ref === ref);
    lines.push(t('main.saude.keySource', { id: p.id, source: info?.source ?? '?' }));
  }
  return { ok: true, message: t('main.saude.keyPresent', { list: lines.join(', ') }) };
}

async function reportCheck(): Promise<Result> {
  if (!rc().cardSource) return { ok: true, message: t('main.saude.noCardSource') };
  const before = reportStatus();
  // Fresh cache answers without a new run; a stale one makes the single shared run happen now.
  try {
    await readReport();
  } catch (e) {
    return { ok: false, message: short(e instanceof Error ? e.message : String(e)) };
  }
  const after = reportStatus();
  const took = after.lastDurationMs ? t('main.saude.took', { s: Math.round(after.lastDurationMs / 1000) }) : '';
  const fromCache = before.lastOkAt === after.lastOkAt && after.lastOkAt !== null;
  const age = fromCache ? t('main.saude.age', { min: Math.round((Date.now() - (after.lastOkAt ?? 0)) / 60_000) }) : '';
  return { ok: true, message: t('main.saude.answered', { took, age }) };
}

async function voiceCheck(): Promise<Result> {
  // Voice off is a state, not a failure: no sidecar is expected to run.
  if (!getConfig().voice.enabled) return { ok: true, message: t('voice.health.off') };
  const v = await voiceStatus();
  if (!v.alive) return { ok: false, message: t('main.saude.voiceDown') };
  if (v.pingMs === null) return { ok: false, message: t('main.saude.voiceNoPing') };
  return { ok: true, message: t('main.saude.voiceAlive', { ms: v.pingMs, loading: v.ready ? '' : t('main.saude.voiceLoading') }) };
}

// One minimal request (a few tokens) over the same Anthropic-compatible route the agents use. Only for providers that speak it directly.
async function modelCheck(): Promise<Result> {
  const target = rc().role('turn');
  if (target.kind !== 'anthropic' || !target.baseUrl) return { ok: true, message: t('main.saude.noAutoTest', { kind: target.kind }) };
  try {
    const key = providerSecret(target.secretRef);
    const official = /^https:\/\/api\.anthropic\.com\/?$/.test(target.baseUrl);
    const res = await fetch(`${target.baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(key ? (official ? { 'x-api-key': key } : { authorization: `Bearer ${key}` }) : {}) },
      body: JSON.stringify({ model: target.model, max_tokens: 8, messages: [{ role: 'user', content: 'ok' }] }),
      signal: AbortSignal.timeout(40_000),
    });
    if (res.ok) return { ok: true, message: t('main.saude.modelAnswered', { model: target.model }) };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message ?? '';
    return { ok: false, message: short(`HTTP ${res.status} ${msg}`) };
  } catch (e) {
    return { ok: false, message: short(e instanceof Error ? e.message.replace(/Bearer\s+\S+/g, 'Bearer ***') : String(e)) };
  }
}

const CHECKS: { id: DepId; run: () => Promise<Result>; costly?: boolean }[] = [
  { id: 'vcs', run: vcsCheck },
  { id: 'llm-key', run: keyCheck },
  { id: 'card-source', run: reportCheck },
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
      s.deps[c.id] = { id: c.id, label: depLabel(c.id), ok: r.ok, message: r.message, checkedAt: new Date().toISOString(), durationMs: Date.now() - started };
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
