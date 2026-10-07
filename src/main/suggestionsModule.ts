import { randomUUID } from 'node:crypto';
import { addAgent, isSystemId, newAgent } from '../shared/config/team';
import type { StageDef, WorkspaceConfig } from '../shared/config/types';
import type { AgentDef } from '../shared/config/types';
import { ID } from '../shared/config/schema';
import { t } from '../shared/i18n';
import type { SavedCeremony } from '../shared/types';
import type { ReleaseAction, SuggestionDecisionKind } from '../shared/suggestions';
import { SUGGEST_PER_RETRO } from '../shared/suggestions';
import { askAgent, obj, str } from './agents';
import { suggestionHooks, proposeAgentSuggestion, skipAction, listActions } from './actions';
import { listAudit } from './auditoria';
import { prompt as cp } from './cyclePrompts';
import { getHistory, listHistory } from './state';
import {
  DEFAULT_THRESHOLD,
  type Evidence,
  type Pattern,
  type SuggestionRecord,
  type SuggestionsStore,
  blockedByRejection,
  evidenceKeyOf,
  gatherEvidence,
  impressionOf,
  patterns,
  readSuggestions,
  stageIds,
  writeSuggestions,
} from './suggestions';
import { runStore } from './runs';
import { getConfig, issueWebUrl, updateConfig } from './workspaceConfig';
import type { Module } from './module';

// From what the cycle repeats to a suggestion an agent waits to be accepted: reads the history the app already writes, groups it into patterns, asks
// the model for a name/role/draft when something is above the threshold, and leaves the proposal in Actions. Accepting creates an ordinary agent;
// the decision is recorded in the workspace's own data (`suggestions.json`), never in the repository.

const ID_RE = new RegExp(ID);

/** A suggestion the model proposed from the evidence (before it becomes a proposal and a record). */
export interface AgentSuggestion {
  name: string;
  role: string;
  stage: string;
  prompt: string;
  pattern: Pattern;
  /** Set when an impression of this suggestion was rejected before and the evidence has changed since. */
  rejectedBefore: { at: string; changed: string[] } | null;
}

// The suggestions still waiting in Actions, by the id the card carries: what the decision needs (the pattern) without re-reading the history.
const waiting = new Map<string, AgentSuggestion>();

function ceremonies(): SavedCeremony[] {
  return listHistory().flatMap((entry) => {
    const state = getHistory(entry.id);
    return state ? [state] : [];
  });
}

/** The patterns the workspace's history shows above the threshold, with the runs' links. Pure reading, no model. */
export function readPatterns(): Pattern[] {
  const config = getConfig();
  const input = { runs: runStore().list(), audit: listAudit(), ceremonies: ceremonies() };
  return patterns(gatherEvidence(input, { stages: config.devCycle.stages, issueLink: (iid) => issueWebUrl(iid) }), DEFAULT_THRESHOLD);
}

/** One line of the evidence a person reads in the proposal: where it came from and what repeated. */
function evidenceLine(e: Evidence): string {
  const where = e.link ? `${e.ref} (${e.link})` : e.ref;
  return `- ${t(`main.suggestions.source.${e.source}`)} · ${t(`main.suggestions.kind.${e.kind}`)}${e.stage ? ` · ${e.stage}` : ''} · ${where}: ${e.text}`;
}

/** The prompt the model answers: the evidence of one pattern and the stages an agent could cover. */
function draftPrompt(pattern: Pattern, stages: readonly StageDef[], rejected: { at: string; changed: string[] } | null): string {
  return cp('suggest.main', {
    evidence: pattern.evidence.slice(0, 20).map(evidenceLine).join('\n'),
    stages: stages.map((s) => s.id).join(', '),
    count: pattern.count,
    sources: pattern.sources,
    rejected: rejected ? cp('suggest.rejected', { at: rejected.at, changed: rejected.changed.join(', ') || cp('suggest.rejectedNoChange') }) : '',
  });
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

/** An id for the agent this suggestion would create: a slug of its name, made unique against the team and the built-in ids. */
export function agentIdFor(name: string, team: readonly AgentDef[]): string {
  const taken = new Set(team.map((a) => a.id));
  const root = slug(name) || 'agent';
  if (ID_RE.test(root) && !isSystemId(root) && !taken.has(root)) return root;
  for (let n = 2; ; n++) {
    const candidate = `${root.slice(0, 44)}-${n}`;
    if (ID_RE.test(candidate) && !isSystemId(candidate) && !taken.has(candidate)) return candidate;
  }
}

/** Asks the model for a name, a role and a draft prompt for one pattern. Never a model call without evidence above the threshold. */
async function draftSuggestion(pattern: Pattern, config: WorkspaceConfig, rejected: { at: string; changed: string[] } | null): Promise<{ name: string; role: string; prompt: string; stage: string } | null> {
  const known = stageIds(config);
  const r = await askAgent<{ nome: string; papel: string; etapa: string; prompt: string }>(
    'deep',
    draftPrompt(pattern, config.devCycle.stages, rejected),
    obj({ nome: str, papel: str, etapa: { enum: known }, prompt: str }),
    { maxTurns: 12 },
  );
  // The stage is always one of the workspace: an agent is never pointed at a stage that does not exist.
  if (!known.includes(r.data.etapa)) return null;
  return { name: r.data.nome.trim(), role: r.data.papel.trim(), prompt: r.data.prompt.trim(), stage: r.data.etapa };
}

/** Builds the suggestions the history supports, above the threshold and not blocked by a rejection. Never offered without evidence. */
export async function buildSuggestions(from: Pattern[]): Promise<AgentSuggestion[]> {
  const config = getConfig();
  const store = readSuggestions();
  const out: AgentSuggestion[] = [];
  for (const pattern of from) {
    const made = await draftSuggestion(pattern, config, null);
    if (!made) continue;
    const impression = impressionOf(made.role, made.stage, pattern.kind);
    const refs = [...new Set(pattern.evidence.map((e) => `${e.source}:${e.ref}:${e.subject}`))];
    const block = blockedByRejection(store, impression, refs);
    // A rejection blocks it unless the evidence has something the rejection never saw; then the proposal says it was refused before.
    if (block && !block.changed.length) continue;
    out.push({ ...made, pattern, rejectedBefore: block && block.changed.length ? block : null });
  }
  return out;
}

/** The proposal of each suggestion: it waits in Actions; accepting creates the agent, editing opens the editor, rejecting keeps the reason. */
export function proposeAll(list: AgentSuggestion[]): ReleaseAction[] {
  const made: ReleaseAction[] = [];
  for (const s of list) {
    const suggestionId = randomUUID();
    const detail = s.pattern.evidence.slice(0, 20).map(evidenceLine).join('\n');
    const action = proposeAgentSuggestion({
      key: `suggest-agent:${impressionOf(s.role, s.stage, s.pattern.kind)}:${evidenceKeyOf(s.pattern.evidence)}`,
      summary: t('main.suggestions.summary', { name: s.name, stage: s.stage }),
      name: s.name,
      role: s.role,
      stage: s.stage,
      draft: s.prompt,
      evidence: detail,
      rejectedBefore: s.rejectedBefore,
      suggestionId,
    });
    if (action) {
      waiting.set(suggestionId, s);
      made.push(action);
    }
  }
  return made;
}

/** The whole flow a person asked for: read the history, draft above the threshold, propose in Actions, and say why nothing came when it did not. */
export async function suggestAgents(options: { patterns?: Pattern[]; max?: number } = {}): Promise<{ actions: ReleaseAction[]; reason?: string }> {
  const config = getConfig();
  if (!stageIds(config).length) return { actions: [], reason: t('main.suggestions.noStages') };
  const from = await buildSuggestions(options.patterns ?? readPatterns());
  const limited = options.max ? from.slice(0, options.max) : from;
  const actions = proposeAll(limited);
  return { actions, ...(limited.length ? {} : { reason: t('main.suggestions.none') }) };
}

/** The end of a retro: at most two suggestions, and only the ones above the threshold and not blocked by a rejection. */
export async function suggestFromRetro(): Promise<ReleaseAction[]> {
  return (await suggestAgents({ max: SUGGEST_PER_RETRO })).actions;
}

/** Records one decision on a suggestion: accepted (with the agent it created), edited, or rejected with the (optional) reason. */
function withDecision(store: SuggestionsStore, id: string, decision: SuggestionDecisionKind, suggestion: AgentSuggestion, reason: string | null, agentId: string | null): SuggestionsStore {
  const record: SuggestionRecord = {
    id,
    impression: impressionOf(suggestion.role, suggestion.stage, suggestion.pattern.kind),
    proposed: { name: suggestion.name, role: suggestion.role, stage: suggestion.stage, prompt: suggestion.prompt, permission: 'read' },
    evidence: suggestion.pattern.evidence,
    decision,
    reason,
    by: 'person',
    at: new Date().toISOString(),
    agentId,
    evidenceKey: evidenceKeyOf(suggestion.pattern.evidence),
  };
  // One record per suggestion id: the decision replaces what waited.
  return { records: [...store.records.filter((r) => r.id !== id), record] };
}

/**
 * Accepting a suggestion: the stage must still exist, and the agent enters the team as any other (read only, no shell, no tracker), so the person
 * may edit it afterwards. Nothing above the minimum is ever given.
 */
export function acceptSuggestion(suggestion: AgentSuggestion): { config: WorkspaceConfig; output: string; agentId: string } {
  const config = getConfig();
  // The stage the agent would cover must be one of the workspace; one that vanished since the proposal is refused with a reason.
  if (!stageIds(config).includes(suggestion.stage)) throw new Error(t('main.suggestions.stageGone', { stage: suggestion.stage }));
  const id = agentIdFor(suggestion.name, config.agents.team);
  const next = addAgent(config, newAgent({ id, name: suggestion.name, job: suggestion.role, instructions: suggestion.prompt, stages: [suggestion.stage], permission: 'read', tracker: 'none', shell: 'none', autonomous: false }));
  updateConfig(() => next);
  return { config: next, output: t('main.suggestions.accepted', { name: suggestion.name, id }), agentId: id };
}

// ---- the channels -------------------------------------------------------------------------------------------------------------------------

/** Records a rejection of a waiting suggestion, with the optional reason, and skips its proposal in Actions. */
export async function rejectSuggestion(suggestionId: string, reason: string | null): Promise<SuggestionsStore> {
  const suggestion = waiting.get(suggestionId);
  if (!suggestion) throw new Error(t('main.suggestions.unknown', { id: suggestionId.slice(0, 40) }));
  const store = withDecision(readSuggestions(), suggestionId, 'rejected', suggestion, reason, null);
  writeSuggestions(store);
  const action = listActions().find((a) => a.kind === 'suggest-agent' && String((a.unit ?? {}).suggestionId ?? '') === suggestionId);
  if (action) await skipAction(action.id);
  return store;
}

/** Records that a suggestion went through the editor, with the id the editor saved. */
export function editSuggestion(suggestionId: string, agentId: string | null): SuggestionsStore {
  const suggestion = waiting.get(suggestionId);
  if (!suggestion) throw new Error(t('main.suggestions.unknown', { id: suggestionId.slice(0, 40) }));
  const store = withDecision(readSuggestions(), suggestionId, 'edited', suggestion, null, agentId);
  writeSuggestions(store);
  return store;
}

/** Actions asks this to carry out an acceptance: it creates the agent and records the decision, so the record keeps the agent it created. */
export function acceptWaiting(action: ReleaseAction): { config: WorkspaceConfig; output: string; agentId: string; store: SuggestionsStore } {
  const suggestionId = String((action.unit ?? {}).suggestionId ?? '');
  const suggestion = waiting.get(suggestionId);
  if (!suggestion) throw new Error(t('main.suggestions.unknown', { id: suggestionId.slice(0, 40) }));
  const accepted = acceptSuggestion(suggestion);
  const store = withDecision(readSuggestions(), suggestionId, 'accepted', suggestion, null, accepted.agentId);
  writeSuggestions(store);
  return { ...accepted, store };
}

// Registered at import: approving a suggestion always creates the agent and records it, whether the app's module has been wired up yet or not.
suggestionHooks.accept = (action) => acceptWaiting(action);

/** Registers the suggestion channels: the button, the decision the card makes, and the end-of-retro hook. All of them are desktop-only. */
export const suggestionsModule: Module = (ctx) => {
  // The module adds the event so the screens follow the decision; the acceptance itself is the hook above.
  suggestionHooks.accept = (action) => {
    const accepted = acceptWaiting(action);
    ctx.emit({ type: 'module', name: 'suggestions:decided', payload: accepted.store });
    return accepted;
  };

  ctx.handle('suggestions:suggest', () => suggestAgents());
  ctx.handle('suggestions:list', () => readSuggestions());
  // Editing: the editor was opened filled in and saved through `config:save`; this records which agent it made and that the path was "edit".
  ctx.handle('suggestions:edited', (suggestionId: unknown, agentId: unknown) => {
    const store = editSuggestion(String(suggestionId), typeof agentId === 'string' ? agentId : null);
    ctx.emit({ type: 'module', name: 'suggestions:decided', payload: store });
    return store;
  });
  // Rejecting: the reason is optional and stays in the record; the proposal in Actions is marked as skipped, nothing external is written.
  ctx.handle('suggestions:reject', async (suggestionId: unknown, reason?: unknown) => {
    const store = await rejectSuggestion(String(suggestionId), typeof reason === 'string' ? reason : null);
    ctx.emit({ type: 'module', name: 'suggestions:decided', payload: store });
    return store;
  });
};

/** The id a proposal of a suggestion carries, for the reject and edit paths of the card. */
export { skipAction, SUGGEST_PER_RETRO, readSuggestions };
