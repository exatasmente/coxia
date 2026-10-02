import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Card, CardsResult, SpecInfo } from '../shared/types';
import { DAILY_REPORT, SPECS } from './env';

const run = promisify(execFile);

interface ReportItem {
  kind: 'issue' | 'mr';
  ref: string;
  title: string;
  stage: string | null;
  web_url: string;
  issue_refs?: string[];
  blockers: string[];
  pending: string[];
  changes: { field: string; from: unknown; to: unknown }[];
  manual_note: string | null;
}

const PHASES: [string, string][] = [
  ['ISSUE_COMPLETION.md', 'ISSUE_COMPLETION escrito'],
  ['3_TEST_PLAN.md', 'test plan escrito'],
  ['4_TEST_PLAN.md', 'test plan escrito'],
  ['2_PLAN.md', 'Plan escrito'],
  ['3_PLAN.md', 'Plan escrito'],
  ['2_SPEC_TECNICO.md', 'spec técnico escrito'],
  ['1_SPEC_FUNCIONAL.md', 'spec funcional escrito'],
  ['1_INVESTIGATION.md', 'investigação escrita'],
  ['1_FINDINGS.md', 'findings escritos'],
  ['0_RFC.md', 'RFC escrita'],
  ['0_BUG_REPORT.md', 'bug report escrito'],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function specInfo(iid: string): SpecInfo | null {
  if (!existsSync(SPECS)) return null;
  const name = readdirSync(SPECS).filter((n) => n.startsWith(`#${iid}-`)).sort()[0];
  if (!name) return null;
  const folder = join(SPECS, name);
  const files = walk(folder);
  const has = (base: string) => files.find((f) => f.endsWith(`/${base}`)) ?? null;
  const phase = PHASES.find(([base]) => has(base))?.[1] ?? 'pasta de spec sem artefato';
  return { folder, phase, planFile: has('2_PLAN.md') ?? has('3_PLAN.md') };
}

function describe(c: { field: string; from: unknown; to: unknown }, prefix = ''): string {
  return `${prefix}${c.field}: ${String(c.from)} → ${String(c.to)}`;
}

export async function loadCards(limit: number): Promise<CardsResult> {
  const { stdout } = await run(DAILY_REPORT, ['report', '--format', 'json', '--dry-run'], {
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const report = JSON.parse(stdout) as { generated_at: string; items: ReportItem[] };
  const mrsByIssue = new Map<string, ReportItem[]>();
  for (const it of report.items) {
    if (it.kind !== 'mr') continue;
    for (const ref of it.issue_refs ?? []) mrsByIssue.set(String(ref), [...(mrsByIssue.get(String(ref)) ?? []), it]);
  }
  const cards: Card[] = report.items
    .filter((it) => it.kind === 'issue')
    .map((it) => {
      const iid = it.ref.split('#').pop() ?? it.ref;
      const mrs = mrsByIssue.get(iid) ?? [];
      return {
        ref: it.ref,
        iid,
        title: it.title,
        stage: it.stage,
        spec: /^\d+$/.test(iid) ? specInfo(iid) : null,
        mrs: mrs.map((m) => m.ref),
        blockers: [...it.blockers, ...mrs.flatMap((m) => m.blockers.map((b) => `${m.ref}: ${b}`))],
        pending: [...it.pending, ...mrs.flatMap((m) => m.pending.map((p) => `${m.ref}: ${p}`))],
        changes: [...it.changes.map((c) => describe(c)), ...mrs.flatMap((m) => m.changes.map((c) => describe(c, `${m.ref} `)))],
        note: it.manual_note,
        url: it.web_url,
      };
    });
  cards.sort(
    (a, b) =>
      Number(!a.blockers.length) - Number(!b.blockers.length) ||
      Number(!a.pending.length) - Number(!b.pending.length) ||
      a.ref.localeCompare(b.ref),
  );
  return { generatedAt: report.generated_at, total: cards.length, cards: cards.slice(0, limit) };
}
