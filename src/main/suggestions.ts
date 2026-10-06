import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditEntry } from '../shared/auditoria';
import type { StageDef, WorkspaceConfig } from '../shared/config/types';
import type { HistoryType, Run } from '../shared/runs';
import type { Decision, SavedCeremony } from '../shared/types';
import { ATAS } from './env';

// What the cycle has been repeating, read from the files the app already writes (runs, the audit log and the minutes). Nothing new is
// recorded to feed this: `gatherEvidence` is pure (it takes the rows, it does no I/O) so the reading stays where it already is and a test
// can drive it with plain objects. The suggestion itself (a name, a role and a draft prompt) comes later, from the evidence, not from here.

/** One repetition the history shows: the raw material of a suggestion. */
export interface Evidence {
  source: EvidenceSource;
  kind: EvidenceKind;
  /** The stage the pattern points at; null when the pattern is not about one. */
  stage: string | null;
  /** The agent involved, when there is one. */
  agent: string | null;
  /** Where the evidence comes from: a run id, a ceremony id, or the audit log. */
  ref: string;
  /** How to open it: a link, or null when there is none. */
  link: string | null;
  /** The thing that repeated, normalized: what makes two occurrences the same theme, reason or scenario. */
  subject: string;
  /** What a person reads about it, in one line. */
  text: string;
  /** When the repetition happened. */
  at: string | null;
}

export const EVIDENCE_KINDS = ['needs-person', 'returns', 'review-rounds', 'qa-scenarios', 'manual-stage', 'command', 'ceremony-decision'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceSource = 'run' | 'audit' | 'ceremony';

/** The impression a suggestion leaves behind: role + stage + the kind of evidence. It is the key that keeps a rejected suggestion from coming back unchanged. */
export interface Impression {
  role: string;
  stage: string;
  evidenceKind: EvidenceKind;
  /** The occurrences that passed the threshold, most recent first. */
  evidence: Evidence[];
  /** How many times the pattern repeated. */
  count: number;
  /** How many sources are behind it. */
  sources: number;
  /** The executions/ceremonies it cites, for the record's evidence key. */
  refs: string[];
}

/** Everything `gatherEvidence` reads, already loaded: the function itself does no I/O. */
export interface EvidenceInput {
  runs: readonly Run[];
  audit: readonly AuditEntry[];
  ceremonies: readonly SavedCeremony[];
}

/** What the reading is told about the workspace (the stages an agent could cover, the link of an issue). */
export interface EvidenceContext {
  stages: readonly StageDef[];
  issueLink?: (iid: number) => string | null;
}

/** How many repetitions a pattern needs before it is worth a suggestion, and out of how many sources at least. */
export interface Threshold {
  count: number;
  sources: number;
}

/** The threshold of the v1: the same pattern three times, out of at least two executions (or a run and the audit log; see `scoreFindings`). */
export const DEFAULT_THRESHOLD: Threshold = { count: 3, sources: 2 };

/** A stage that is a real stage of this workspace: an agent may only be pointed at one that exists. */
export const stageExists = (stages: readonly StageDef[], id: string | null): boolean => !!id && stages.some((s) => s.id === id);

/**
 * Lowercase, accents folded, punctuation dropped: `Garantir que a validação roda antes do merge` and `garantir que a validacao roda antes
 * do merge` are the same theme. Terms shorter than three letters are dropped, and the rest is sorted, so the order does not matter.
 */
export function normalize(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3);
  return [...new Set(words)].sort().join(' ');
}

/** All the stage ids of a workspace, the workspace flow and the squads' flows. */
export function stageIds(config: Pick<WorkspaceConfig, 'devCycle'>): string[] {
  return [...new Set([...config.devCycle.stages, ...Object.values(config.devCycle.flows ?? {}).flat()].map((s) => s.id))];
}

const push = (out: Evidence[], seen: Set<string>, e: Evidence): void => {
  const key = `${e.source}|${e.kind}|${e.ref}|${e.subject}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(e);
};

const link = (ctx: EvidenceContext, run: Run): string | null => ctx.issueLink?.(run.issue.iid) ?? null;

/** The same question reaching the person in different executions: the theme is the question text, normalized. */
function fromQuestions(runs: readonly Run[], ctx: EvidenceContext, out: Evidence[], seen: Set<string>): void {
  for (const run of runs) {
    const q = run.question;
    const reachedPerson = !!q && (q.kind === 'agent' || q.kind === 'squad') && (q.holder === null || q.holder === undefined);
    const byPerson = run.history.filter((h) => h.type === 'answer' && h.by === 'person');
    const text = q?.text ?? byPerson[byPerson.length - 1]?.detail ?? '';
    if (!reachedPerson && !byPerson.length) continue;
    const subject = normalize(text);
    if (!subject) continue;
    push(out, seen, {
      source: 'run',
      kind: 'needs-person',
      stage: q?.stage ?? byPerson[byPerson.length - 1]?.stage ?? run.stage,
      agent: q?.by ?? null,
      ref: run.id,
      link: link(ctx, run),
      subject,
      text,
      at: q?.askedAt ?? run.updatedAt,
    });
  }
}

/** The work sent back to the same stage, again and again: the stage that sent it is the reason. */
function fromReturns(runs: readonly Run[], ctx: EvidenceContext, out: Evidence[], seen: Set<string>): void {
  for (const run of runs) {
    const fromHistory = new Map<string, number>();
    for (const h of run.history) if (h.type === 'stage-returned' && h.stage) fromHistory.set(h.stage, (fromHistory.get(h.stage) ?? 0) + 1);
    for (const [stage, count] of Object.entries(run.returns)) fromHistory.set(stage, Math.max(fromHistory.get(stage) ?? 0, count));
    for (const [stage, count] of fromHistory) {
      push(out, seen, {
        source: 'run',
        kind: 'returns',
        stage,
        agent: null,
        ref: run.id,
        link: link(ctx, run),
        subject: `returns:${stage}`,
        text: `${count}`,
        at: run.updatedAt,
      });
    }
  }
}

/** The review and QA passes that keep finding the same kind of thing: the scenario or the finding text, normalized. */
function fromChecks(runs: readonly Run[], ctx: EvidenceContext, out: Evidence[], seen: Set<string>): void {
  for (const run of runs) {
    for (const round of run.reviews) {
      for (const finding of round.findings) {
        if (finding.severity !== 'blocking') continue;
        const subject = normalize(finding.body);
        if (!subject) continue;
        push(out, seen, { source: 'run', kind: 'review-rounds', stage: round.stage, agent: round.by, ref: run.id, link: link(ctx, run), subject, text: finding.body, at: round.at });
      }
    }
    for (const pass of run.qa) {
      for (const scenario of pass.scenarios) {
        if (scenario.result !== 'fail' || (scenario.severity ?? 'blocking') !== 'blocking') continue;
        const subject = normalize(scenario.name);
        if (!subject) continue;
        push(out, seen, { source: 'run', kind: 'qa-scenarios', stage: pass.stage, agent: pass.by, ref: run.id, link: link(ctx, run), subject, text: scenario.name, at: pass.at });
      }
    }
  }
}

/** The stages the person did by hand: skipped, refused at the gate, sent back, or answered for the agent. */
const MANUAL_TYPES = new Set<HistoryType>(['gate-skipped', 'gate-rejected', 'stage-returned', 'sent-back']);

function fromManual(runs: readonly Run[], ctx: EvidenceContext, out: Evidence[], seen: Set<string>): void {
  for (const run of runs) {
    for (const record of run.stages) {
      if (record.status === 'skipped') push(out, seen, { source: 'run', kind: 'manual-stage', stage: record.stage, agent: record.agent, ref: run.id, link: link(ctx, run), subject: `manual:${record.stage}`, text: record.stage, at: record.endedAt ?? run.updatedAt });
    }
    for (const h of run.history) {
      if (h.by !== 'person' || !h.stage) continue;
      if (MANUAL_TYPES.has(h.type) || h.type === 'answer') push(out, seen, { source: 'run', kind: 'manual-stage', stage: h.stage, agent: null, ref: run.id, link: link(ctx, run), subject: `manual:${h.stage}`, text: h.detail ?? h.type, at: h.at });
    }
  }
}

/** The command a person keeps allowing: the same command line, normalized, allowed over and over. */
function fromAudit(audit: readonly AuditEntry[], ctx: EvidenceContext, out: Evidence[], seen: Set<string>): void {
  for (const e of audit) {
    if (e.kind !== 'exec' || !e.ok) continue;
    const subject = normalize(e.target);
    if (!subject) continue;
    const runId = e.fields.run ?? '';
    push(out, seen, {
      source: 'audit',
      kind: 'command',
      stage: e.fields.stage ?? null,
      agent: e.by ?? e.fields.agent ?? null,
      ref: runId || 'auditoria',
      link: null,
      subject,
      text: e.target,
      at: e.at,
    });
  }
}

/** The decisions and effects of the ceremonies that come back: the text of the decision, normalized. */
function fromCeremonies(ceremonies: readonly SavedCeremony[], out: Evidence[], seen: Set<string>): void {
  for (const ceremony of ceremonies) {
    for (const d of [...ceremony.decisions, ...ceremony.effects] as (Decision | { ref: string; text: string })[]) {
      const subject = normalize(d.text);
      if (!subject) continue;
      push(out, seen, { source: 'ceremony', kind: 'ceremony-decision', stage: null, agent: null, ref: ceremony.id, link: null, subject, text: d.text, at: ceremony.date ?? ceremony.id.slice(0, 10) });
    }
  }
}

/** Every repetition the history shows, in one list. Pure: the runs, the audit rows and the ceremonies come in already read. */
export function gatherEvidence(input: EvidenceInput, ctx: EvidenceContext = { stages: [] }): Evidence[] {
  const out: Evidence[] = [];
  const seen = new Set<string>();
  fromQuestions(input.runs, ctx, out, seen);
  fromReturns(input.runs, ctx, out, seen);
  fromChecks(input.runs, ctx, out, seen);
  fromManual(input.runs, ctx, out, seen);
  fromAudit(input.audit, ctx, out, seen);
  fromCeremonies(input.ceremonies, out, seen);
  return out;
}

/** Evidence of the same pattern, what a suggestion's `evidence` carries. */
export interface Pattern {
  kind: EvidenceKind;
  stage: string;
  subject: string;
  evidence: Evidence[];
  count: number;
  sources: number;
  refs: string[];
  /** The executions/ceremonies that repeat the pattern, for the record's evidence key. */
  distinct: string[];
}

function groupOf(e: Evidence): string {
  return [e.kind, e.stage ?? '—', e.subject].join('|');
}

/** Groups the evidence by the pattern it repeats (`kind` + stage + the normalized subject) and drops what is below the threshold. */
export function patterns(findings: readonly Evidence[], threshold: Threshold = DEFAULT_THRESHOLD): Pattern[] {
  const groups = new Map<string, Evidence[]>();
  for (const e of findings) {
    const key = groupOf(e);
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: Pattern[] = [];
  for (const list of groups.values()) {
    const distinct = [...new Set(list.map((e) => `${e.source}:${e.ref}`))];
    if (list.length < threshold.count || distinct.length < threshold.sources) continue;
    const first = list[0];
    out.push({ kind: first.kind, stage: first.stage ?? '', subject: first.subject, evidence: list, count: list.length, sources: distinct.length, refs: [...new Set(list.map((e) => e.ref))], distinct });
  }
  // The strongest patterns first: what repeated most, then what came from the most executions.
  return out.sort((a, b) => b.count - a.count || b.sources - a.sources || a.subject.localeCompare(b.subject));
}

/** The name the function had when the threshold lived here: the patterns above the threshold, in order of weight. */
export const scoreFindings = (findings: readonly Evidence[], threshold: Threshold = DEFAULT_THRESHOLD): Pattern[] => patterns(findings, threshold);

/** Normalizes the parts of an impression and joins them: two suggestions with the same role, stage and kind of evidence read as the same suggestion. */
export function impressionOf(role: string, stage: string, evidenceKind: string): string {
  return [normalize(role), normalize(stage), evidenceKind].join(':');
}

/** A stable hash of the evidence an impression was built from: same refs, same key; one more execution in it, another key. */
export function evidenceKeyOf(evidence: readonly Pick<Evidence, 'source' | 'ref' | 'subject'>[]): string {
  const refs = [...new Set(evidence.map((e) => `${e.source}:${e.ref}:${e.subject}`))].sort();
  return createHash('sha1').update(refs.join('\n')).digest('hex').slice(0, 16);
}

/** A suggestion decided and recorded in the workspace's own data (`suggestions.json`). */
export interface SuggestionRecord {
  id: string;
  impression: string;
  proposed: { name: string; role: string; stage: string; prompt: string; permission: 'read' };
  evidence: Evidence[];
  decision: 'accepted' | 'rejected' | 'edited';
  reason: string | null;
  by: string;
  at: string;
  agentId: string | null;
  evidenceKey: string;
}

export interface SuggestionsStore {
  records: SuggestionRecord[];
}

/** Why a suggestion that looks rejected does not come back, or what changed since the rejection when it may. */
export interface RejectionBlock {
  at: string;
  /** The occurrences the rejection never saw; empty when there are none (the suggestion must not be offered). */
  changed: string[];
}

/**
 * Whether an impression was rejected before and, if it was, whether the evidence now has an occurrence the rejection never saw. The caller
 * passes the occurrences the new suggestion rests on (`refsOf`); a rejection blocks it unless something in there is new. Null: nothing to
 * block on (no rejection of this impression), so the suggestion may be offered.
 */
export function blockedByRejection(store: SuggestionsStore, impression: string, refsOf: readonly string[]): RejectionBlock | null {
  const rejections = store.records.filter((r) => r.impression === impression && r.decision === 'rejected');
  if (!rejections.length) return null;
  const latest = [...rejections].sort((a, b) => a.at.localeCompare(b.at))[rejections.length - 1];
  const seen = new Set(rejections.flatMap((r) => r.evidence.map(evidenceRef)));
  return { at: latest.at, changed: [...new Set(refsOf)].filter((key) => !seen.has(key)) };
}

const evidenceRef = (e: Pick<Evidence, 'source' | 'ref' | 'subject'>): string => `${e.source}:${e.ref}:${e.subject}`;

const FILE = join(ATAS, 'suggestions.json');

/** The decision record of the workspace, or an empty one when the file does not exist yet (nothing is created until the first decision). */
export function readSuggestions(suggestionsFile: string = FILE): SuggestionsStore {
  try {
    if (existsSync(suggestionsFile)) return JSON.parse(readFileSync(suggestionsFile, 'utf8')) as SuggestionsStore;
  } catch {}
  return { records: [] };
}

/** Writes the record atomically, the way `acoes.json` is written. */
export function writeSuggestions(store: SuggestionsStore, suggestionsFile: string = FILE): void {
  mkdirSync(join(suggestionsFile, '..'), { recursive: true });
  writeFileSync(`${suggestionsFile}.tmp`, JSON.stringify(store, null, 1));
  renameSync(`${suggestionsFile}.tmp`, suggestionsFile);
}
