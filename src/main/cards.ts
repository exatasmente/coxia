import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, CardsResult, SpecInfo } from '../shared/types';
import { type ReportItem, readReport } from './report';
import { rc } from './workspaceConfig';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function specInfo(iid: string): SpecInfo | null {
  const specs = rc().specsDir;
  if (!specs || !existsSync(specs)) return null;
  const layout = rc().specLayout;
  const prefix = layout.folderPrefix.replace('{iid}', iid);
  const name = readdirSync(specs).filter((n) => n.startsWith(prefix)).sort()[0];
  if (!name) return null;
  const folder = join(specs, name);
  const files = walk(folder);
  const has = (base: string) => files.find((f) => f.endsWith(`/${base}`)) ?? null;
  const phase = layout.phaseFiles.find(({ file }) => has(file))?.label ?? 'pasta de spec sem artefato';
  return { folder, phase, planFile: layout.planFiles.map(has).find((f) => f !== null) ?? null };
}

function describe(c: { field: string; from: unknown; to: unknown }, prefix = ''): string {
  return `${prefix}${c.field}: ${String(c.from)} → ${String(c.to)}`;
}

// Blocked first, then with pending items, then by ref.
export function compareCards(a: Card, b: Card): number {
  return (
    Number(!a.blockers.length) - Number(!b.blockers.length) ||
    Number(!a.pending.length) - Number(!b.pending.length) ||
    a.ref.localeCompare(b.ref)
  );
}

export async function loadCards(limit: number, refresh = false): Promise<CardsResult> {
  const report = await readReport({ refresh });
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
        mrPaths: mrs.map((m) => ({ ref: m.ref, project: m.project, iid: m.iid })),
        blockers: [...it.blockers, ...mrs.flatMap((m) => m.blockers.map((b) => `${m.ref}: ${b}`))],
        pending: [...it.pending, ...mrs.flatMap((m) => m.pending.map((p) => `${m.ref}: ${p}`))],
        changes: [...it.changes.map((c) => describe(c)), ...mrs.flatMap((m) => m.changes.map((c) => describe(c, `${m.ref} `)))],
        note: it.manual_note,
        url: it.web_url,
      };
    });
  cards.sort(compareCards);
  return { generatedAt: report.generated_at, total: cards.length, cards: cards.slice(0, limit) };
}
