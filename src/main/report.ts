import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rc } from './workspaceConfig';
import { providerReport } from './vcs/cardSource';

const run = promisify(execFile);

export interface ReportItem {
  kind: 'issue' | 'mr';
  ref: string;
  project: string;
  iid: number;
  title: string;
  stage: string | null;
  web_url: string;
  issue_refs?: string[];
  blockers: string[];
  pending: string[];
  changes: { field: string; from: unknown; to: unknown }[];
  manual_note: string | null;
}

export interface Report {
  generated_at: string;
  items: ReportItem[];
}

export interface ReportStatus {
  lastOkAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  inFlight: boolean;
}

// One `daily-report` run takes ~30 s and hits GitLab: every module reads through here instead of spawning its own.
export const REPORT_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 150_000;
// A forced refresh may join a run that started this recently; an older one is waited out and run again.
const JOIN_WINDOW_MS = 10_000;

let cache: { at: number; report: Report } | null = null;
let flight: { startedAt: number; promise: Promise<Report> } | null = null;
let queued: Promise<Report> | null = null;
let spawned = 0;
const status: ReportStatus = { lastOkAt: null, lastDurationMs: null, lastError: null, lastErrorAt: null, inFlight: false };

const timedOut = (e: unknown) => Boolean((e as { killed?: boolean }).killed) || (e as { code?: string }).code === 'ETIMEDOUT';

// A workspace with no card source command (externalTools.cardSource off) builds the cards from its VCS integration; with neither it has no
// cards: the screens show an empty day, not an error.
const EMPTY: Report = { generated_at: new Date(0).toISOString(), items: [] };

async function spawnOnce(): Promise<Report> {
  const source = rc().cardSource;
  if (!source) return ((await providerReport()) as Report | null) ?? { ...EMPTY, generated_at: new Date().toISOString() };
  spawned++;
  const { stdout } = await run(source.command, source.reportArgs, { timeout: source.timeoutMs || TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(stdout) as Report;
}

async function fetchReport(): Promise<Report> {
  const started = Date.now();
  try {
    let report: Report;
    try {
      report = await spawnOnce();
    } catch (e) {
      if (!timedOut(e)) throw e;
      report = await spawnOnce();
    }
    cache = { at: Date.now(), report };
    status.lastOkAt = cache.at;
    status.lastDurationMs = cache.at - started;
    status.lastError = null;
    return report;
  } catch (e) {
    status.lastError = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    status.lastErrorAt = Date.now();
    throw e;
  }
}

function start(): Promise<Report> {
  const promise = fetchReport().finally(() => {
    flight = null;
    status.inFlight = false;
  });
  flight = { startedAt: Date.now(), promise };
  status.inFlight = true;
  return promise;
}

export async function readReport(opts: { refresh?: boolean } = {}): Promise<Report> {
  if (!opts.refresh && cache && Date.now() - cache.at < REPORT_TTL_MS) return cache.report;
  if (flight && (!opts.refresh || Date.now() - flight.startedAt < JOIN_WINDOW_MS)) return flight.promise;
  if (!flight) return start();
  // Forced refresh while an older run is in flight: wait for it, then a single new run serves every waiting refresh.
  queued ??= flight.promise
    .catch(() => undefined)
    .then(() => start())
    .finally(() => {
      queued = null;
    });
  return queued;
}

// A write through `daily-report note` makes the cached manual_note stale.
export function invalidateReport(): void {
  cache = null;
}

export function reportStatus(): ReportStatus & { spawned: number } {
  return { ...status, spawned };
}
