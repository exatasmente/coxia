import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { StageKind } from '../../shared/config/types';
import type { CycleView } from '../../shared/config/squads';
import { flowOfRun } from '../../shared/runs/flow';
import type { Run } from '../../shared/runs/types';
import { HARNESS_DIR } from '../../shared/harness/format';
import { type Item, type Mark, type SelectInput, budgetFor, selectDocs, wantsInvalid } from '../../shared/harness/select';
import { git } from '../conflictGit';
import { prompt as cp } from '../cyclePrompts';
import { scanHarness } from './scan';
import { checkHarness } from './stale';

// What a call of a team agent is given of the documentation of the repositories it works in: one section of text, the same for both engines, appended to the
// system text. A repository with no `.coxia/` adds nothing at all, not even a line saying so (the screen of Settings says it).

/** What the delivery needs to know about a call: where it works, at what, and over which files. */
export interface DocsAsk {
  /** The repositories (folders) the call works in: the run's worktree, the folder of a squad's repository, or the repositories of a conversation. */
  repos: string[];
  stage: { id: string; kind: StageKind } | null;
  /** The paths, relative to the repository, the work touches: see `workPaths`. */
  paths: string[];
}

/** The folders `.coxia/` of the repositories that have one, for the agent to read besides its working directory. */
export function harnessDirs(ask: DocsAsk | undefined): string[] {
  return [...new Set(ask?.repos ?? [])].map((r) => join(r, HARNESS_DIR)).filter((d) => existsSync(d));
}

const CITED_MAX = 200;
// A path with at least one slash, or a file name with an extension, standing alone: after a space, a quote, a backtick or an opening bracket.
const CITED = /(?:^|[\s`"'(\[<])((?:[\w@.-]+\/)+[\w@.-]+|[\w-]+\.[A-Za-z0-9]{1,5})(?=$|[\s`"')\]>,;:.])/g;

/** The paths of the repository a text names (the spec and the plan of a run), as far as they exist in it. */
export function citedPaths(wt: string, texts: string[], limit = CITED_MAX): string[] {
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(CITED)) {
      const p = m[1].replace(/^\.\//, '');
      if (!p || p.startsWith('/') || p.split('/').includes('..')) continue;
      if (existsSync(join(wt, p))) out.add(p);
      if (out.size >= limit) return [...out];
    }
  }
  return [...out];
}

/**
 * The files the work of a run touches, without calling a model: what the branch already changed (and what is not committed yet), outside the cycle folder, and
 * the paths the documents of the cycle name, which is what gives the first pass of a stage the rules of the files the plan speaks of before it touched any.
 */
export async function workPaths(wt: string, base: string | null, cycleFolder: string, texts: string[]): Promise<string[]> {
  const r = await git(wt, ['diff', '--name-only', '--no-renames', '-z', base ?? 'HEAD'], { fail: false, timeout: 10_000 });
  const changed = r.code === 0 ? r.stdout.split('\0').filter((p) => p && p !== cycleFolder && !p.startsWith(`${cycleFolder}/`)) : [];
  return [...new Set([...changed, ...citedPaths(wt, texts)])].slice(0, 400);
}

/** The stage a run is at, as the delivery needs it (its id and its kind), or null when the flow no longer has it. */
export function stageOfRun(run: Pick<Run, 'flow' | 'squad' | 'stage'>, config: CycleView): { id: string; kind: StageKind } | null {
  const s = flowOfRun(run, config).find((x) => x.id === run.stage);
  return s ? { id: s.id, kind: s.kind } : null;
}

/** The ask of a stage of a run (or of a call that answers inside it): nothing is read from git when the worktree has no documentation folder. */
export async function runDocsAsk(i: { wt: string; base: string | null; cycleFolder: string; stage: { id: string; kind: StageKind } | null; texts: string[] }): Promise<DocsAsk> {
  const has = existsSync(join(i.wt, HARNESS_DIR));
  return { repos: [i.wt], stage: i.stage, paths: has ? await workPaths(i.wt, i.base, i.cycleFolder, i.texts) : [] };
}

// The documentation is text to apply, not a quotation: it sits between its own tags, and a closing tag inside it is turned into plain text.
const wrap = (text: string): string => text.replace(/<(\/?)doc\b/gi, '&lt;$1doc');

const NAMES_MAX = 40;

function markText(mark: Mark | null): string {
  if (!mark || mark.state === 'checked') return '';
  if (mark.state === 'stale') return ` ${cp('runner.docs.mark.stale', { count: mark.total, commit: mark.ref.slice(0, 7), names: mark.changed.slice(0, 3).join(', ') })}`;
  if (mark.state === 'unverified') return ` ${cp('runner.docs.mark.unverified')}`;
  return ` ${cp('runner.docs.mark.invalid')}`;
}

/**
 * The section of the system text for one call, or '' when none of the repositories has documentation. The budget is the call's: it comes from the context window of
 * the model when the provider declares it, and it is divided among the repositories that have a folder.
 */
export async function harnessSection(ask: DocsAsk, agent: { id: string }, opts: { cwd: string; contextWindow?: number | null }): Promise<string> {
  const states = [];
  for (const repo of new Set(ask.repos)) {
    const state = await scanHarness(repo).catch(() => null);
    if (state?.exists && state.entries.length) states.push(state);
  }
  if (!states.length) return '';
  const budget = Math.floor(budgetFor(opts.contextWindow) / states.length);
  const shown = (repo: string, path: string): string => {
    const abs = join(repo, HARNESS_DIR, path);
    const rel = relative(opts.cwd, abs);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs;
  };
  const parts: string[] = [cp('runner.docs.head')];
  for (const state of states) {
    const check = await checkHarness(state).catch(() => null);
    const texts: SelectInput['texts'] = {};
    for (const e of state.entries) {
      if (e.parse.ok || !wantsInvalid(e, agent.id)) continue;
      const text = await readFile(join(state.repo, HARNESS_DIR, e.path), 'utf8').catch(() => null);
      if (text !== null) texts[e.path] = text;
    }
    const sel = selectDocs({ entries: state.entries, marks: check?.files ?? {}, texts, stage: ask.stage, paths: ask.paths, agent: agent.id, budget });
    const render = (id: 'overview' | 'item', item: Item): string => {
      const path = shown(state.repo, item.path);
      const body = wrap(item.text) + (item.clipped ? `\n${cp('runner.docs.clipped', { path })}` : '');
      return id === 'overview' ? cp('runner.docs.overview', { path, mark: markText(item.mark), text: body }) : cp('runner.docs.item', { path, mark: markText(item.mark), text: body });
    };
    if (sel.overview) parts.push(render('overview', sel.overview));
    for (const item of sel.picked) parts.push(render('item', item));
    if (sel.indexed.length) parts.push(cp('runner.docs.index', { lines: sel.indexed.map((l) => `- ${shown(state.repo, l.path)}${l.summary ? `: ${l.summary}` : ''}${markText(l.mark)}`).join('\n') }));
    if (sel.notIncluded.length) {
      const names = sel.notIncluded.slice(0, NAMES_MAX).map((n) => shown(state.repo, n));
      const more = sel.notIncluded.length - names.length;
      parts.push(cp('runner.docs.notIncluded', { names: more > 0 ? `${names.join(', ')}, +${more}` : names.join(', ') }));
    }
  }
  return parts.join('\n\n');
}
