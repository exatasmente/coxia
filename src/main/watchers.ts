import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isStageKind, returnedFromQa } from '../shared/cycles/stages';
import type { Card } from '../shared/types';
import type { WatcherAlert } from '../shared/watchers';
import { loadCards, specInfo } from './cards';
import { cycle } from './cyclePrompts';
import { cycleOn } from './cycle-core';
import { getSettings } from './config';
import { ATAS } from './env';
import { issueProjectKey, rc } from './workspaceConfig';
import { logError } from './errorlog';
import { gateOptions } from './gate';
import type { Module, ModuleContext } from './module';
import type { Notice } from './scheduler';
import { vcsProvider, vcsReady } from './vcs';
import { t } from '../shared/i18n';

const FILE = join(ATAS, 'watchers.json');
const EVERY_MIN = 15;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Past implementation (in review or later) the gate quiz has nothing left to gate.
const pastGates = (stage: string | null): boolean => isStageKind(cycle(), stage, ['review', 'reviewApproved', 'qa', 'qaApproved', 'done']) || returnedFromQa(cycle(), stage);
const GATE_MAX_AGE_DAYS = 14;
const POSTMORTEM_MAX_AGE_DAYS = 30;
const NOT_PROD_RECHECK_MS = 3 * HOUR_MS;
const PRUNE_MS = 120 * DAY_MS;
const MAX_SEPARATE_NOTICES = 3;

interface ProdCheck {
  at: string;
  prod: boolean;
  when: string | null;
  reason: string | null;
}

interface State {
  checkedAt: string | null;
  alerts: WatcherAlert[];
  notified: Record<string, string>;
  dismissed: Record<string, string>;
  prod: Record<string, ProdCheck>;
}

interface Deps {
  notify(n: Notice): void;
  emit: ModuleContext['emit'];
}

function read(): State {
  const empty: State = { checkedAt: null, alerts: [], notified: {}, dismissed: {}, prod: {} };
  try {
    if (existsSync(FILE)) return { ...empty, ...(JSON.parse(readFileSync(FILE, 'utf8')) as Partial<State>) };
  } catch {}
  return empty;
}

function write(s: State): void {
  mkdirSync(ATAS, { recursive: true });
  writeFileSync(`${FILE}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${FILE}.tmp`, FILE);
}

function active(s: State): WatcherAlert[] {
  return s.alerts.filter((a) => !s.dismissed[a.id]);
}

// ---------------------------------------------------------------- 1. gate waiting for its quiz

function hasQuizSection(quizFile: string, gate: number): boolean {
  if (!existsSync(quizFile)) return false;
  // Template placeholders ("## Gate 1 — <Investigation / RFC>") are not a recorded quiz.
  return new RegExp(`^##\\s+Gate\\s+${gate}\\s*[—–-]\\s*[^<\\s][^<\\n]*$`, 'm').test(readFileSync(quizFile, 'utf8'));
}

export function gateAlerts(cards: Card[], now = Date.now()): WatcherAlert[] {
  const out: WatcherAlert[] = [];
  for (const card of cards) {
    if (!card.spec || pastGates(card.stage)) continue;
    for (const o of gateOptions(card)) {
      const mtime = Math.floor(statSync(o.file).mtimeMs);
      if (now - mtime > GATE_MAX_AGE_DAYS * DAY_MS) continue;
      if (hasQuizSection(join(dirname(o.file), rc().specLayout.documents.gateQuiz), o.gate)) continue;
      out.push({
        id: `gate:${o.file}:${mtime}`,
        kind: 'gate',
        ref: card.ref,
        iid: card.iid,
        title: card.title,
        message: t('main.watchers.gateReady', { label: o.label, iid: card.iid }),
        detail: t('main.watchers.gateNoRecord', { gate: o.gate, file: rc().specLayout.documents.gateQuiz }),
        card,
        since: new Date(mtime).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- 2. two rejections at the same point

interface HistoryRow {
  at: string;
  ref: string;
  type: string;
  field?: string;
  from?: unknown;
  to?: unknown;
}

function readHistory(): HistoryRow[] {
  try {
    return readFileSync(rc().cardSource?.historyFile ?? '', 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as HistoryRow];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

const stop = (): string => t('main.watchers.stop');

// history.jsonl only records the days the card source ran, so a return from QA the card shows but the history has not seen yet counts too.
export function rejectionAlerts(cards: Card[], history: HistoryRow[]): WatcherAlert[] {
  const out: WatcherAlert[] = [];
  const changes = history.filter((r) => r.type === 'change').sort((a, b) => a.at.localeCompare(b.at));
  for (const card of cards) {
    const stages = changes.filter((r) => r.ref === card.ref && r.field === 'stage');
    const failed = (stage: unknown) => returnedFromQa(cycle(), typeof stage === 'string' ? stage : null);
    let fails = stages.filter((r) => failed(r.to)).length;
    if (failed(card.stage) && !failed(stages[stages.length - 1]?.to)) fails++;
    if (fails >= 2 && !isStageKind(cycle(), card.stage, ['qaApproved', 'done'])) {
      out.push({
        id: `rej:${card.ref}:qa:${fails}`,
        kind: 'rejections',
        ref: card.ref,
        iid: card.iid,
        title: card.title,
        message: t('main.watchers.qaFails', { iid: card.iid, count: fails }),
        detail: stop(),
        card: null,
        since: stages.filter((r) => failed(r.to)).pop()?.at ?? new Date().toISOString(),
      });
    }
    for (const mr of card.mrs) {
      const approvals = changes.filter((r) => r.ref === mr && r.field === 'approved');
      const lost = approvals.filter((r) => r.from === true && r.to === false);
      // Approved again after the last loss: no longer waiting on a new approval.
      if (lost.length >= 2 && approvals[approvals.length - 1].to === false) {
        out.push({
          id: `rej:${mr}:review:${lost.length}`,
          kind: 'rejections',
          ref: card.ref,
          iid: card.iid,
          title: card.title,
          message: t('main.watchers.lostApproval', { mr, count: lost.length, iid: card.iid }),
          detail: stop(),
          card: null,
          since: lost[lost.length - 1].at,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. postmortem reminder

interface ReportIssue {
  kind: string;
  ref: string;
  iid: number;
  /** The issue project as the provider takes it: the numeric id in a daily-report state file, the path otherwise. */
  project_id: number | string;
  title: string;
  labels?: string[];
}

interface Severity {
  level: 0 | 1 | 2 | 3;
  source: string;
}

// P0/P1 is written in the bug report ("Severidade: [x] Alto (P1)"); the GitLab labels carry no P-number.
export function severityOf(bugReport: string | null, labels: string[]): Severity | null {
  const line = bugReport?.split('\n').find((l) => /severidade/i.test(l));
  if (line) {
    const boxes = /\[[ xX]?\]/.test(line);
    // An untouched template line (no box checked) says nothing.
    const checked = boxes ? /\[[xX]\]\s*([^[\]]*)/.exec(line)?.[1] : line.replace(/^.*?severidade:?\**/i, '');
    const levels = [...(/\(([^)]*)\)/.exec(checked ?? '')?.[1] ?? '').matchAll(/P([0-3])/g)].map((m) => Number(m[1]));
    // "(P1/P2)" is read as the milder one.
    // i18n-ignore: where the severity was read from: terms used as they are
    if (levels.length) return { level: Math.max(...levels) as Severity['level'], source: 'bug report' };
  }
  const isBug = labels.some((l) => /^(bugfix|bug|hotfix)$/i.test(l));
  if (!isBug) return null;
  if (labels.some((l) => /^(critical|urg[eê]ncia::\s*cr[ií]tica)$/i.test(l))) return { level: 0, source: 'label' };
  if (labels.some((l) => /^(hotfix|high|urg[eê]ncia::\s*alta)$/i.test(l))) return { level: 1, source: 'label' };
  return null;
}

// A closed issue alone is not enough (superseded or duplicate issues close without shipping): it needs a version label (devCycle.releaseLabelPattern).
// Reads only: the watchers never write to the code host.
async function inProduction(project: string, iid: number): Promise<{ at: string | null; reason: string } | null> {
  const prov = vcsProvider();
  const issue = await prov.getIssue(project, iid);
  // The related list also holds other repositories' MRs that merely mention the issue (the playbook's, for one).
  const mrs = (await prov.linkedMrs(project, iid)).filter((m) => m.project === issue.project);
  const shipped = mrs
    .filter((m) => m.state === 'merged' && /^(main|release\/\d[\w.]*)$/.test(m.targetBranch))
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))[0];
  if (shipped) return { at: shipped.mergedAt, reason: t('main.watchers.shippedMr', { iid: shipped.iid, target: shipped.targetBranch }) };
  const pattern = rc().releaseLabelPattern;
  const label = issue.labels.find((l) => pattern.test(l));
  const version = label ? (pattern.exec(label)?.[1] ?? label) : null;
  if (issue.state === 'closed' && version) return { at: issue.closedAt, reason: t('main.watchers.closedIn', { version }) };
  return null;
}

function reportIssues(): ReportIssue[] {
  try {
    const items = (JSON.parse(readFileSync(rc().cardSource?.stateFile ?? '', 'utf8')) as { items: Record<string, ReportIssue & { iid: number }> }).items;
    return Object.values(items).filter((i) => i.kind === 'issue');
  } catch {
    return [];
  }
}

export async function postmortemAlerts(cards: Card[], s: State, now = Date.now()): Promise<WatcherAlert[]> {
  const known = new Map<string, ReportIssue>();
  for (const i of reportIssues()) known.set(String(i.iid), i);
  let issueProject: string | null = null;
  try {
    issueProject = issueProjectKey();
  } catch {
    // no issue project configured: only the issues the card source reported can be checked
  }
  for (const c of cards) {
    if (!known.has(c.iid) && issueProject) known.set(c.iid, { kind: 'issue', ref: c.ref, iid: Number(c.iid), project_id: issueProject, title: c.title });
  }
  const out: WatcherAlert[] = [];
  for (const [iid, issue] of known) {
    if (!/^\d+$/.test(iid)) continue;
    const spec = specInfo(iid);
    if (spec && existsSync(join(spec.folder, 'postmortem', '0_POSTMORTEM.md'))) continue;
    const reportFile = spec ? join(spec.folder, 'bug', '0_BUG_REPORT.md') : null;
    const bugReport = reportFile && existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : null;
    const sev = severityOf(bugReport, issue.labels ?? []);
    if (!sev || sev.level > 1) continue;

    let check = s.prod[iid];
    if (!check || (!check.prod && now - new Date(check.at).getTime() > NOT_PROD_RECHECK_MS)) {
      try {
        const hit = await inProduction(String(issue.project_id), Number(iid));
        check = { at: new Date(now).toISOString(), prod: !!hit, when: hit?.at ?? null, reason: hit?.reason ?? null };
        s.prod[iid] = check;
      } catch (e) {
        console.error(`[watchers] gitlab #${iid}`, e);
        logError('job:watchers', e, { job: 'watchers', iid });
        continue;
      }
    }
    if (!check.prod) continue;
    if (check.when && now - new Date(check.when).getTime() > POSTMORTEM_MAX_AGE_DAYS * DAY_MS) continue;
    out.push({
      id: `pm:${iid}`,
      kind: 'postmortem',
      ref: issue.ref,
      iid,
      title: issue.title,
      message: t('main.watchers.postmortem', { iid }),
      detail: t('main.watchers.postmortemDetail', { level: sev.level, source: sev.source, reason: String(check.reason) }),
      card: null,
      since: check.when ?? check.at,
    });
  }
  return out;
}

// ---------------------------------------------------------------- run

function noticeFor(a: WatcherAlert): Notice {
  if (a.kind === 'gate' && a.card) return { title: a.message, body: t('main.watchers.clickQuiz'), onClick: { type: 'open', screen: { name: 'gate', ref: a.card.ref, card: a.card } } };
  if (a.kind === 'rejections') return { title: a.message, body: stop(), onClick: { type: 'navigate', to: 'today' } };
  return { title: a.message, body: t('main.watchers.clickPostmortem'), onClick: { type: 'navigate', to: 'today' } };
}

let running = false;

export async function checkWatchers(deps: Deps, notifyEnabled: boolean): Promise<WatcherAlert[]> {
  if (running) return active(read());
  running = true;
  try {
    const cards = (await loadCards(100)).cards;
    const s = read();
    const found: WatcherAlert[] = [];
    // One watcher failing must not hide the others.
    const attempt = async (name: string, fn: () => WatcherAlert[] | Promise<WatcherAlert[]>) => {
      try {
        found.push(...(await fn()));
      } catch (e) {
        console.error(`[watchers] ${name}`, e);
        logError('job:watchers', e, { job: 'watchers', phase: name });
      }
    };
    if (cycleOn('gate')) await attempt('gate', () => gateAlerts(cards));
    await attempt('rejections', () => rejectionAlerts(cards, readHistory()));
    await attempt('postmortem', () => postmortemAlerts(cards, s));

    const nowIso = new Date().toISOString();
    const fresh = found.filter((a) => !s.notified[a.id] && !s.dismissed[a.id]);
    for (const a of fresh) s.notified[a.id] = nowIso;
    s.alerts = found;
    s.checkedAt = nowIso;
    for (const map of [s.notified, s.dismissed]) {
      for (const [id, at] of Object.entries(map)) if (Date.now() - new Date(at).getTime() > PRUNE_MS) delete map[id];
    }
    write(s);

    if (notifyEnabled) {
      if (fresh.length > MAX_SEPARATE_NOTICES) {
        deps.notify({ title: t('main.watchers.many', { count: fresh.length }), body: t('main.watchers.manyBody'), onClick: { type: 'navigate', to: 'today' } });
      } else {
        for (const a of fresh) deps.notify(noticeFor(a));
      }
    }
    deps.emit({ type: 'module', name: 'watchers:changed', payload: active(s) });
    return active(s);
  } finally {
    running = false;
  }
}

export const register: Module = (ctx) => {
  const enabled = () => getSettings().notifications;
  ctx.job({ name: 'watchers', everyMin: EVERY_MIN, workHoursOnly: true, enabled: vcsReady, run: async () => void (await checkWatchers(ctx, enabled())) });
  ctx.handle('watchers:list', () => active(read()));
  ctx.handle('watchers:check', () => checkWatchers(ctx, false));
  ctx.handle('watchers:dismiss', (id: string) => {
    const s = read();
    if (!s.alerts.some((a) => a.id === id)) return active(s);
    s.dismissed[id] = new Date().toISOString();
    write(s);
    ctx.emit({ type: 'module', name: 'watchers:changed', payload: active(s) });
    return active(s);
  });
};
