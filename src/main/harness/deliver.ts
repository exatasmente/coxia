import { existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import type { StageKind } from '../../shared/config/types';
import type { CycleView } from '../../shared/config/squads';
import { flowOfRun } from '../../shared/runs/flow';
import type { Run } from '../../shared/runs/types';
import { AGENTS_FILE, type AgentsDocsState } from '../../shared/harness/agentsMd';
import { budgetFor, clipText } from '../../shared/harness/select';
import { git } from '../conflictGit';
import { prompt as cp } from '../cyclePrompts';
import { scanHarness } from './scan';

export interface DocsAsk {
  repos: string[];
  stage: { id: string; kind: StageKind } | null;
  paths: string[];
}

const CITED_MAX = 200;
const CITED = /(?:^|[\s`"'(\[<])((?:[\w@.-]+\/)+[\w@.-]+|[\w-]+\.[A-Za-z0-9]{1,5})(?=$|[\s`"')\]>,;:.])/g;

export function citedPaths(wt: string, texts: string[], limit = CITED_MAX): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(CITED)) {
      const path = m[1].replace(/^\.\//, '');
      if (!path || path.startsWith('/') || path.split('/').includes('..')) continue;
      if (existsSync(join(wt, path))) out.add(path);
      if (out.size >= limit) return [...out];
    }
  }
  return [...out];
}

export async function workPaths(wt: string, base: string | null, cycleFolder: string, texts: string[]): Promise<string[]> {
  const result = await git(wt, ['diff', '--name-only', '--no-renames', '-z', base ?? 'HEAD'], { fail: false, timeout: 10_000 });
  const changed = result.code === 0 ? result.stdout.split('\0').filter((path) => path && path !== cycleFolder && !path.startsWith(`${cycleFolder}/`)) : [];
  return [...new Set([...changed, ...citedPaths(wt, texts)])].slice(0, 400);
}

export function stageOfRun(run: Pick<Run, 'flow' | 'squad' | 'stage'>, config: CycleView): { id: string; kind: StageKind } | null {
  const stage = flowOfRun(run, config).find((item) => item.id === run.stage);
  return stage ? { id: stage.id, kind: stage.kind } : null;
}

export async function runDocsAsk(input: { wt: string; base: string | null; cycleFolder: string; stage: { id: string; kind: StageKind } | null; texts: string[] }): Promise<DocsAsk> {
  return { repos: [input.wt], stage: input.stage, paths: [] };
}

const wrap = (text: string): string => text.replace(/<(\/?)doc\b/gi, '&lt;$1doc');

function section(state: AgentsDocsState, cwd: string, budget: number): string {
  if (!state.document) return '';
  const absolute = join(state.repo, AGENTS_FILE);
  const rel = relative(cwd, absolute);
  const path = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : absolute;
  const frame = cp('runner.docs.overview', { path, text: '' });
  const clipNote = cp('runner.docs.clipped', { path });
  const max = Math.max(0, budget - frame.length - clipNote.length - 1);
  const clipped = state.document.text.length > max;
  const text = clipped ? clipText(state.document.text, max) : state.document.text;
  return cp('runner.docs.overview', { path, text: wrap(text) }) + (clipped ? `\n${clipNote}` : '');
}

/** The root AGENTS.md instructions for every repository in this call, bounded by the provider's context window. */
export async function harnessSection(ask: DocsAsk, _agent: { id: string }, opts: { cwd: string; contextWindow?: number | null }): Promise<string> {
  const prepared: AgentsDocsState[] = [];
  for (const repo of new Set(ask.repos)) {
    const state = await scanHarness(repo);
    if (state.document) prepared.push(state);
  }
  if (!prepared.length) return '';
  const total = budgetFor(opts.contextWindow);
  const head = cp('runner.docs.head');
  let share = Math.floor(total / prepared.length);
  let text = `${head}\n\n${prepared.map((state) => section(state, opts.cwd, share)).filter(Boolean).join('\n\n')}`;
  for (let round = 0; round < 12 && text.length > total && share > 0; round++) {
    share = Math.max(0, share - Math.ceil((text.length - total) / prepared.length) - 20);
    text = `${head}\n\n${prepared.map((state) => section(state, opts.cwd, share)).filter(Boolean).join('\n\n')}`;
  }
  return text.length <= total ? text : text.slice(0, total);
}
