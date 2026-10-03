import type { SquadDef } from '../config/types';
import type { RoutedBy, RoutingWhy } from './types';

// Which squad an issue belongs to, by the scope of the squads: the repository first, then the labels, then the folders of the files the issue mentions.
// Each rule narrows the squads the one before left; one squad left is the answer. When the rules leave several squads, or none claims the issue, the answer is
// "ambiguous" and the run goes through triage (the front-door agent proposes, the person decides when that agent does not run by itself). Pure.

export interface RouteInput {
  /** The repository the run works in (a `projects.repos` id); null when it is not known yet (the scheduler does not choose one). */
  repo: string | null;
  /** The labels of the issue. */
  labels: string[];
  /** The text of the issue (title, description, comments): where the files it mentions are looked for. */
  text: string;
}

export type RouteResult = { kind: 'matched'; squad: string; rule: Exclude<RoutedBy, 'agent' | 'person'> } | { kind: 'ambiguous'; why: RoutingWhy; candidates: string[] };

const lower = (v: string): string => v.trim().toLowerCase();
const dir = (p: string): string => p.trim().replace(/^\.?\/+/, '').replace(/\/+$/, '');

// A path as an issue writes it: with a folder in it ("src/app/index.ts", "services/billing/"), after a space, a quote or a parenthesis.
const PATH = /(?:^|[\s`'"(\[<])((?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]*)/g;

/** The files and folders an issue's text mentions, normalized (no leading `./` or `/`). */
export function mentionedPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(PATH)) {
    const raw = dir(m[1].replace(/[.,;:!?)\]]+$/, ''));
    if (raw && !/^https?:/i.test(raw) && raw.includes('/')) found.add(raw);
  }
  return [...found];
}

// The file is the folder or inside it; a path copied from a diff (`a/services/x`, `b/services/x`) counts too.
const under = (file: string, prefix: string): boolean => {
  const p = dir(prefix);
  const inside = (f: string): boolean => f === p || f.startsWith(`${p}/`);
  return !!p && (inside(file) || inside(file.replace(/^[ab]\//, '')));
};

/** Which squad an issue belongs to. `squads` are the ones that can take work (the caller leaves out those with no members). */
export function routeIssue(squads: SquadDef[], input: RouteInput): RouteResult {
  const labels = new Set(input.labels.map(lower));
  const files = mentionedPaths(input.text);
  const rules: [Exclude<RoutedBy, 'agent' | 'person'>, (s: SquadDef) => boolean][] = [
    ['repo', (s) => input.repo !== null && s.scope.repos.includes(input.repo)],
    ['label', (s) => s.scope.labels.some((l) => labels.has(lower(l)))],
    ['path', (s) => s.scope.paths.some((p) => (input.repo === null || p.repo === input.repo) && files.some((f) => under(f, p.prefix)))],
  ];
  let pool = squads;
  let narrowed = false;
  for (const [rule, test] of rules) {
    const hits = pool.filter(test);
    // A rule that says nothing about this issue does not narrow anything.
    if (!hits.length) continue;
    narrowed = true;
    pool = hits;
    if (pool.length === 1) return { kind: 'matched', squad: pool[0].id, rule };
  }
  if (narrowed) return { kind: 'ambiguous', why: 'several', candidates: pool.map((s) => s.id) };
  const open = squads.filter((s) => s.scope.unclaimed);
  if (open.length === 1) return { kind: 'matched', squad: open[0].id, rule: 'unclaimed' };
  return open.length ? { kind: 'ambiguous', why: 'several', candidates: open.map((s) => s.id) } : { kind: 'ambiguous', why: 'none', candidates: squads.map((s) => s.id) };
}
