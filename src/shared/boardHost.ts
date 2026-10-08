import { literalLabel } from './priority';
import { mapStageByRules } from './cycles/stages';
import { boardPriorities, squadLabel, type BoardCard } from './board';
import type { DevCycleConfig, SquadDef, StageDef, StageMappingRule, VcsKind } from './config/types';

// The vocabulary a board card shares with its issue on a code host: which label says a column, which labels a move may add and take off, what a new issue
// is born with. Pure — no I/O and no host call; the door (main/boardHost.ts) and the read side both import this file, so what is written is what is read back.

/** The stages and the mapping rules of the workspace: what decides which stage a label means. */
export type StageVocabulary = Pick<DevCycleConfig, 'stages' | 'stageMapping'>;

/** The prefix of the label the app writes for a column when the workspace's mapping has no label of its own for it. */
export const BOARD_LABEL_PREFIX = 'board:';

export const stageLabel = (id: string): string => BOARD_LABEL_PREFIX + id;

const lower = (s: string): string => s.toLowerCase();
const carries = (labels: readonly string[], label: string): boolean => labels.some((l) => lower(l) === lower(label));
const dedupe = (labels: readonly string[]): string[] => labels.filter((l, i) => labels.findIndex((o) => lower(o) === lower(l)) === i);

/** What a host accepts as a label to write (the same test as the providers': text, no comma, no line break, 200 characters at most). */
function writable(label: string): boolean {
  const one = label.trim();
  return !!one && one === label && one.length <= 200 && !/[,\n\r]/.test(one);
}

/** The stage a `board:<id>` label means, for the stages given; with several such labels, the highest-ranked stage. */
export function stageOfBoardLabel(labels: readonly string[], stages: readonly StageDef[]): StageDef | null {
  let found: StageDef | null = null;
  for (const stage of stages) {
    if (carries(labels, stageLabel(stage.id)) && (!found || stage.rank > found.rank)) found = stage;
  }
  return found;
}

/** The mapping rules that apply to a host, in the order written. */
const rulesOf = (v: StageVocabulary, kind: VcsKind): StageMappingRule[] => (v.stageMapping ?? []).filter((r) => r.provider === 'any' || r.provider === kind);

/** The plain label a rule can be written as: a label rule whose pattern is a plain name (`literalLabel`) the host accepts. */
const plainLabelOf = (rule: StageMappingRule): string | null => {
  if (rule.source !== 'label') return null;
  const name = literalLabel(rule.pattern);
  return name !== null && writable(name) ? name : null;
};

/** The label a mapping rule can write for the stage, or null: the first rule written for it that is a plain label name. */
export function ruleLabel(v: StageVocabulary, kind: VcsKind, stageId: string): string | null {
  for (const rule of rulesOf(v, kind)) {
    if (rule.stage !== stageId) continue;
    const name = plainLabelOf(rule);
    if (name !== null) return name;
  }
  return null;
}

/** The stage a label reads back as on the read side: the mapping rules first, then the app's own label. The stages' free-text patterns do not count. */
export function readsAs(v: StageVocabulary, kind: VcsKind, label: string): StageDef | null {
  return mapStageByRules({ stages: [...v.stages], stageMapping: v.stageMapping }, { provider: kind, labels: [label] }) ?? stageOfBoardLabel([label], v.stages);
}

/** The rule whose pattern matches a label, in the order of the read side: the one that would claim it. */
function claimedBy(v: StageVocabulary, kind: VcsKind, label: string): StageMappingRule | null {
  const stages = new Set(v.stages.map((s) => s.id));
  for (const rule of rulesOf(v, kind)) {
    if (rule.source !== 'label' || !stages.has(rule.stage)) continue;
    try {
      if (new RegExp(rule.pattern, 'i').test(label)) return rule;
    } catch {
      // a pattern that is not a regular expression never claims anything, as on the read side
    }
  }
  return null;
}

export type WrittenLabel =
  | { label: string; by: 'mapping' }
  /** `no-rule`: the mapping says nothing about the stage on this host. `unwritable-rule`: it does, but not in a form that can be written (a field, a column, a status, a state, a regular expression) or not one that reads back. */
  | { label: string; by: 'default'; why: 'no-rule' | 'unwritable-rule' }
  /** `shadowed`: a rule would read the default label as another stage; `unknownStage`: the workspace has no such stage. */
  | { refused: 'shadowed'; rule: StageMappingRule }
  | { refused: 'unknownStage' };

/**
 * The label the app writes for a column on a host. The mapping's own label wins when it is a plain name that reads back as the same stage; otherwise
 * `board:<id>`, checked the same way. When a rule would read that one as another stage, the move is refused with the rule named, not written.
 */
export function writtenLabel(v: StageVocabulary, kind: VcsKind, stageId: string): WrittenLabel {
  if (!v.stages.some((s) => s.id === stageId)) return { refused: 'unknownStage' };
  const mapped = ruleLabel(v, kind, stageId);
  if (mapped !== null && readsAs(v, kind, mapped)?.id === stageId) return { label: mapped, by: 'mapping' };
  const hasRule = rulesOf(v, kind).some((r) => r.stage === stageId);
  const label = stageLabel(stageId);
  if (writable(label) && readsAs(v, kind, label)?.id === stageId) return { label, by: 'default', why: hasRule ? 'unwritable-rule' : 'no-rule' };
  const rule = claimedBy(v, kind, label);
  // Nothing claims it and it still does not read back (an id the host would not take as a label): refuse rather than write a label that reads as no column.
  return rule ? { refused: 'shadowed', rule } : { refused: 'unknownStage' };
}

/** Every label the app could have written for any stage on this host: the default of each stage and the plain label of each label rule. The only set a column change may remove. */
export function ownStageLabels(v: StageVocabulary, kind: VcsKind): string[] {
  const fromRules = rulesOf(v, kind).flatMap((r) => (v.stages.some((s) => s.id === r.stage) ? [plainLabelOf(r)] : [])).filter((l): l is string => l !== null);
  return dedupe([...v.stages.map((s) => stageLabel(s.id)), ...fromRules]);
}

export interface LabelChange {
  add: string[];
  remove: string[];
}

/** What moving an issue to a stage changes: add the written label, take off the other labels of the app's own that the issue carries. Nothing else is ever removed. */
export function moveLabels(v: StageVocabulary, kind: VcsKind, issueLabels: readonly string[], toStage: string): LabelChange & { written: WrittenLabel } {
  const written = writtenLabel(v, kind, toStage);
  if ('refused' in written) return { add: [], remove: [], written };
  const own = ownStageLabels(v, kind);
  return {
    add: carries(issueLabels, written.label) ? [] : [written.label],
    remove: issueLabels.filter((l) => carries(own, l) && lower(l) !== lower(written.label)),
    written,
  };
}

export interface CardFields {
  priority: string | null;
  squad: string | null;
}

/** The priority levels and the squads, for the labels a priority and a squad stand for. */
export interface LabelContext {
  levels: readonly string[];
  squads: readonly SquadDef[];
}

/** The label a priority level is written as: the level's own plain label, in the spelling the configuration has. */
function priorityLabel(level: string | null, levels: readonly string[]): string | null {
  if (!level) return null;
  return boardPriorities(levels).find((l) => lower(l) === lower(level)) ?? level;
}

const squadLabelOf = (id: string | null, squads: readonly SquadDef[]): string | null => {
  const squad = id ? squads.find((s) => s.id === id) : undefined;
  return squad ? squadLabel(squad) : null;
};

/**
 * What changing a card's priority and squad does to an issue's labels: the new level's label and the new squad's label are added; the previous ones are
 * removed, and only when the issue carries them. Both sets are labels the board itself wrote.
 */
export function cardLabelChanges(old: CardFields, next: CardFields, ctx: LabelContext & { issueLabels: readonly string[] }): LabelChange {
  const add: string[] = [];
  const remove: string[] = [];
  const pairs: [string | null, string | null][] = [
    [priorityLabel(old.priority, ctx.levels), priorityLabel(next.priority, ctx.levels)],
    [squadLabelOf(old.squad, ctx.squads), squadLabelOf(next.squad, ctx.squads)],
  ];
  for (const [before, after] of pairs) {
    if (before !== null && (after === null || lower(before) !== lower(after)) && carries(ctx.issueLabels, before)) remove.push(ctx.issueLabels.find((l) => lower(l) === lower(before)) ?? before);
    if (after !== null && (before === null || lower(before) !== lower(after)) && !carries(ctx.issueLabels, after)) add.push(after);
  }
  return { add: dedupe(add), remove: dedupe(remove).filter((l) => !carries(add, l)) };
}

/** The slice of a card a new issue is made from. */
export type CardToSend = Pick<BoardCard, 'title' | 'body' | 'column' | 'priority' | 'labels' | 'history'>;

/** What a new issue is born with: the label of the column, the card's labels (which already hold the squad's), the priority level's label; each once. */
export function issueLabelsOfCard(v: StageVocabulary, kind: VcsKind, card: CardToSend, levels: readonly string[]): { labels: string[]; written: WrittenLabel } {
  const written = writtenLabel(v, kind, card.column);
  const column = 'refused' in written ? [] : [written.label];
  const priority = priorityLabel(card.priority, levels);
  return { labels: dedupe([...column, ...card.labels, ...(priority ? [priority] : [])]), written };
}

/** The card's description, then, when the card has comments in its history, the heading and one line per comment, so nothing written is lost. */
export function issueBodyOf(card: Pick<BoardCard, 'body' | 'history'>, heading: string): string {
  const notes = card.history.filter((h) => h.kind === 'commented' && h.text?.trim()).map((h) => `- ${h.text!.trim().replace(/\s*[\r\n]+\s*/g, ' ')}`);
  if (!notes.length) return card.body;
  const body = card.body.trimEnd();
  return [...(body ? [body, ''] : []), heading, ...notes].join('\n');
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The number and address of the issue a host just made, from what it answers to a creation. Read the way the runner reads it (runner/publish.ts) and kept
 * apart on purpose: the board must not import the runner. The number is `number` (GitHub), `iid` (GitLab), else `id` (Bitbucket); a host's global `id` is
 * never preferred to the project's own number.
 */
export function issueRefOfAnswer(answer: unknown): { iid: number | null; url: string | null } {
  const r = rec(answer);
  const n = r.number ?? r.iid ?? r.id;
  const iid = typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : typeof n === 'string' && /^[1-9]\d*$/.test(n) ? Number(n) : null;
  const links = rec(rec(r.links).html);
  const url = [r.html_url, r.web_url, links.href].find((u): u is string => typeof u === 'string' && !!u) ?? null;
  return { iid, url };
}

/** Whether a card's link and a listed issue are the same issue: the number, and the project too when both sides name it as a path (a numeric project id is not one). */
export function sameIssue(link: { project: string; iid: number }, item: { project: string; iid: number }): boolean {
  if (link.iid !== item.iid) return false;
  const paths = link.project.includes('/') && item.project.includes('/');
  return !paths || lower(link.project) === lower(item.project);
}
