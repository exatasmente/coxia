import type { Language } from '../../shared/config/types';
import { cycleText } from '../../shared/cycles/text';
import { budgetFor } from '../../shared/harness/select';
import { FAILING_OUT_OF_LIST, isOld, sameKey, type ProcedureKind, type ProcedureRecord } from '../../shared/procedures';

// What a call is told about the procedures that fit it: a short list of titles for the place it works in, built here and never by a model call. It is the only way a
// record's text reaches a prompt without a tool call, so the text is plain: a title is cut down to letters, digits, spaces and a few marks again here, whatever the
// file holds. Pure: no disk, no Electron.

/** The most characters and entries the list takes, before the model's own budget. */
export const LIST_MAX_CHARS = 2000;
export const LIST_MAX_ENTRIES = 25;

export interface SelectContext {
  /** The repositories the call works in (a run's, or a conversation place's): a `repo` record is listed for a key in here. */
  repos: readonly string[];
  /** The stage kind, for a stage: a `cycle` record is listed for it. A conversation has none. */
  stageKind?: string;
  /** The tools and plugins the agent has: enabled plugin names, the kinds of the workspace's code hosts, the first words of its allowed commands. */
  tools: readonly string[];
  /** The hosts the agent may reach (its `allowedHosts`), for `gui` records. */
  hosts: readonly string[];
  /** A conversation lists the `request` records of the workspace; a stage does not. */
  requests?: boolean;
  /** The repositories (ids) whose checkout carries an AGENTS.md, so the entry says to read that first. A conversation skips the mark. */
  agentsMd?: ReadonlySet<string>;
  language: Language;
  now: number;
  /** The model's context window in tokens, when known: a small one shrinks the list below `LIST_MAX_CHARS`. */
  contextWindow?: number | null;
}

export interface Listed {
  /** The list as it goes into the prompt. Empty when nothing fits the call. */
  text: string;
  /** The records whose line is in the text, in order. */
  listed: string[];
  /** Records that fit the call and were left out for the size. */
  more: number;
}

const KIND_ORDER: readonly ProcedureKind[] = ['repo', 'cycle', 'tool', 'gui', 'request'];
const STATE_ORDER = { ok: 0, unverified: 1, failing: 2 } as const;

/** The chars the list may take: 2,000, or the harness's share of a small model's context (a third of its budget) when that is less. */
export const budgetOf = (contextWindow: number | null | undefined): number => Math.min(LIST_MAX_CHARS, Math.round(budgetFor(contextWindow) / 3));

const lower = (list: readonly string[]): string[] => list.map((s) => s.toLowerCase());

// How well a record's key matches the call: lower is better; null is no match. The position in the call's own list ranks the keys among themselves.
function matchRank(r: ProcedureRecord, ctx: SelectContext, repos: string[], tools: string[], hosts: string[]): number | null {
  const key = r.key.toLowerCase();
  switch (r.kind) {
    case 'repo': {
      const at = repos.indexOf(key);
      return at < 0 ? null : at;
    }
    case 'cycle': {
      const [stage, repo] = key.split('@');
      if (!ctx.stageKind || stage !== ctx.stageKind.toLowerCase()) return null;
      if (repo === undefined) return repos.length + 1;
      const at = repos.indexOf(repo);
      return at < 0 ? null : at;
    }
    case 'tool': {
      const at = tools.indexOf(key);
      return at < 0 ? null : at;
    }
    case 'gui': {
      // A key is a host or an application; a host under the key's name (docs.example.com for example.com) is its site.
      const at = hosts.findIndex((h) => h === key || h.endsWith(`.${key}`));
      return at < 0 ? null : at;
    }
    case 'request':
      return ctx.requests ? 0 : null;
  }
}

/** The records that fit the call, in the order they are listed: kind, key match, ok before unverified before failing, most recently used. */
export function selectProcedures(records: readonly ProcedureRecord[], ctx: SelectContext): ProcedureRecord[] {
  const repos = lower(ctx.repos);
  const tools = lower(ctx.tools);
  const hosts = lower(ctx.hosts);
  const ranked: { r: ProcedureRecord; rank: number }[] = [];
  for (const r of records) {
    // A record that failed twice since it was last saved is not offered; the person still sees it and the agent can find it with procedures_list.
    if (r.stats.failuresSinceSave >= FAILING_OUT_OF_LIST) continue;
    const rank = matchRank(r, ctx, repos, tools, hosts);
    if (rank !== null) ranked.push({ r, rank });
  }
  const used = (r: ProcedureRecord): number => (r.stats.lastUsed ? Date.parse(r.stats.lastUsed) : Number.NEGATIVE_INFINITY);
  return ranked
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.r.kind) - KIND_ORDER.indexOf(b.r.kind) ||
        a.rank - b.rank ||
        STATE_ORDER[a.r.state] - STATE_ORDER[b.r.state] ||
        used(b.r) - used(a.r) ||
        b.r.origin.at.localeCompare(a.r.origin.at) ||
        a.r.id.localeCompare(b.r.id),
    )
    .map((x) => x.r);
}

// A title or a key, as it may stand in a prompt: letters, digits, spaces and a few marks, on one line. A stored file that holds more is cut down to this, not trusted.
const plain = (text: string): string => text.replace(/[^\p{L}\p{N} .,\-/()'@_+]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** One line of the list: id, kind, key, title, state, when it was last verified, who wrote it, and the marks that tell the reader how far to trust it. */
export function procedureLine(r: ProcedureRecord, ctx: Pick<SelectContext, 'language' | 'now' | 'agentsMd'>): string {
  const word = (key: string, params?: Record<string, string | number>): string => cycleText(`main.runner.procedures.list.${key}`, ctx.language, params);
  const verified = r.lastVerified ? word('verified', { date: r.lastVerified.slice(0, 10) }) : word('neverVerified');
  const by =
    r.origin.by === 'person'
      ? word('byPerson')
      : word('byAgent', { agent: plain(r.origin.by) || '?', permission: r.origin.permission ? word(`permission.${r.origin.permission}`) : '?', shell: r.origin.shell ?? '?' });
  const parts = [r.id, r.kind, plain(r.key), plain(r.title), word(`state.${r.state}`), verified];
  if (isOld(r, ctx.now)) parts.push(word('old'));
  parts.push(by);
  if (!r.reviewed) parts.push(word('unreviewed'));
  if (r.kind === 'repo' && ctx.agentsMd && [...ctx.agentsMd].some((id) => sameKey(id, r.key))) parts.push(word('agentsMd'));
  return parts.join(' · ');
}

/**
 * The list a call reads: at most 25 entries and 2,000 characters (less for a small model), the rest named in a closing line that points at `procedures_list`.
 * The records are chosen by `selectProcedures`; this renders them in the call's language and keeps the text inside the budget.
 */
export function listProcedures(records: readonly ProcedureRecord[], ctx: SelectContext): Listed {
  const fit = selectProcedures(records, ctx);
  if (!fit.length) return { text: '', listed: [], more: 0 };
  const budget = budgetOf(ctx.contextWindow);
  const lines: string[] = [];
  const ids: string[] = [];
  const footer = (left: number): string => (left > 0 ? `\n${cycleText('main.runner.procedures.list.more', ctx.language, { count: left })}` : '');
  for (const r of fit.slice(0, LIST_MAX_ENTRIES)) {
    const line = procedureLine(r, ctx);
    // The closing line is counted with the entry that would make it necessary, so the text never goes over.
    const after = [...lines, line].join('\n').length + footer(fit.length - ids.length - 1).length;
    if (after > budget && lines.length > 0) break;
    lines.push(line);
    ids.push(r.id);
  }
  const more = fit.length - ids.length;
  return { text: `${lines.join('\n')}${footer(more)}`, listed: ids, more };
}
