import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CardField, DevCycleConfig, Language } from '../shared/config/types';
import type { DestinationLabels } from '../shared/destination';
import { renderPrompt } from '../shared/cycles/prompts';
import { cycleText, joinList, userTerms, voiceText } from '../shared/cycles/text';
import type { Params, Translate } from '../shared/i18n';
import { hostWords } from '../shared/i18n/terms';
import type { Card } from '../shared/types';
import { docsSources, getConfig, rc } from './workspaceConfig';

// The prompts and cycle texts of the running workspace: the cycle config says which text, the language says in what words, and the user
// config says who the agents are talking to. Every module that builds a prompt goes through here, never through a literal.

export const cycle = (): DevCycleConfig => getConfig().devCycle;
export const language = (): Language => getConfig().language;

/** The localized text of a cycle config value (a catalog key or a literal). */
export function text(value: string, params?: Params): string {
  return cycleText(value, language(), { ...userTerms(language(), getConfig()), ...params });
}

/** "GitLab", "GitHub", "Bitbucket", or a neutral phrase when the workspace has no integration. */
export function vcsName(): string {
  const kind = rc().primaryVcs?.kind;
  return kind ? hostWords(kind, language()).vcsName : text('cycle.vcs.fallback');
}

/** What the team calls the daily preparation ("pré-daily", "daily scrum", "standup"). */
export const ceremonyLabel = (): string => text(cycle().ceremonyParams.preDaily.label);

/** Where the cards come from, as the card context names it: " (GitLab via the card source command)", " (GitHub)", or nothing. */
function origin(): string {
  const tool = rc().cardSource?.command;
  const host = rc().primaryVcs ? vcsName() : '';
  const label = host && tool ? text('cycle.origin.via', { vcs: host, tool: basename(tool) }) : host || (tool ? basename(tool) : '');
  return label ? ` (${label})` : '';
}

/** "@qa.user" for a workspace with a QA user, a phrase for one without. */
export function qaMention(): string {
  const user = rc().qaUser;
  return user ? `@${user}` : text('cycle.qa.userFallback');
}

/** Placeholders every prompt may use. */
export function baseParams(): Params {
  const lang = language();
  const terms = userTerms(lang, getConfig());
  const c = cycle();
  const base: Params = {
    ...terms,
    vcsName: vcsName(),
    ceremony: ceremonyLabel(),
    qaMention: qaMention(),
    // How the conversation reaches the person: "por voz" / "em texto", "transcrição por voz" / "texto digitado", "Call" / "Conversa".
    mode: voiceText('cycle.voice.mode', lang),
    heard: voiceText('cycle.voice.heard', lang),
    call: voiceText('cycle.voice.call', lang),
    answered: voiceText('cycle.voice.answered', lang),
  };
  const rule = (id: string, extra: Params = {}) => renderPrompt(c, id, lang, { ...base, ...extra });
  return {
    ...base,
    speechRules: rule('rules.speech', { examples: rule('rules.speechExamples') }),
    chatRules: rule('rules.chat'),
    optionsRule: rule('options.rule'),
  };
}

/** A prompt of the cycle, rendered for the workspace's language, user and VCS. `params` add to (and override) the base ones. */
export function prompt(id: string, params: Params = {}, options?: { keepEmpty?: string[] }): string {
  return renderPrompt(cycle(), id, language(), { ...baseParams(), ...params }, options);
}

/** A single-use translator for catalog keys outside the prompt families (cycle.* words). */
export const word: Translate = (key, params) => text(key, params);

/** The words a decision's destination is written with (the plan's decision-log heading, the card note tool). */
export function destinationLabels(): DestinationLabels {
  const tool = rc().cardSource?.command;
  return { heading: decisionLogHeading(), noteTool: tool ? basename(tool) : null, noteFallback: text('cycle.noteFallback'), minutes: text('cycle.minutes') };
}

/** The label of a "Registro"-style heading and the way a prompt refers to the place decisions are recorded. */
export function decisionLogHeading(): string {
  return text(cycle().specLayout.decisionLog.heading);
}

export function decisionLogRef(): string {
  const heading = decisionLogHeading();
  return heading ? text('cycle.decisionLog.ref', { heading }) : text('cycle.decisionLog.none');
}

/** The files a card points the agent at, from the cycle's enrichment: they exist, the spec folder first, then the projects root. */
function cardFiles(card: Card): string[] {
  const out: string[] = [];
  for (const name of cycle().enrichment.extraFiles) {
    const candidates = name.startsWith('./') ? [join(rc().projectsRoot, name.slice(2))] : card.spec ? [join(card.spec.folder, name)] : [];
    const found = candidates.find((p) => existsSync(p));
    if (found) out.push(found);
  }
  return out;
}

/** What the agents are told about a card: the fields the cycle shares, where its spec folder is, and the extra files it names. */
export function cardContext(card: Card): string {
  const { spec, ...rest } = card;
  const enrich = cycle().enrichment;
  const fields = new Set<string>(enrich.cardFields as CardField[]);
  // A card with no priority or milestone says nothing about them, rather than a null the agent has to read around.
  const shown = Object.fromEntries(Object.entries(rest).filter(([key, value]) => fields.has(key) && !((key === 'priority' || key === 'milestone') && value == null)));
  const where = enrich.specFolder ? (spec ? prompt('card.whereSpec', { folder: spec.folder, phase: spec.phase }) : prompt('card.whereNone')) : '';
  const files = cardFiles(card);
  const named = files.length ? prompt('card.files', { files: files.join(', ') }) : '';
  return prompt('card.context', { origin: origin(), card: JSON.stringify(shown), where: [where, named].filter(Boolean).join(' ') });
}

/** What the turn agent is told about a card's tracker priority and milestone, or "" (the line then disappears) when it has neither. */
export function priorityLine(card: Card): string {
  if (!cycle().enrichment.cardFields.some((f) => f === 'priority' || f === 'milestone')) return '';
  const signals = [
    card.priority && cycle().enrichment.cardFields.includes('priority') ? prompt('turn.priority.level', { label: card.priority.label }) : '',
    card.milestone && cycle().enrichment.cardFields.includes('milestone') ? prompt('turn.priority.milestone', { milestone: card.milestone }) : '',
  ].filter(Boolean);
  return signals.length ? prompt('turn.priority', { signals: joinList(signals, language()) }) : '';
}

/** Where the agent is told to look when it investigates: "spec, rules and GitLab" for a team with specs and rules, shorter for others. */
export function investigationSources(): string {
  const lang = language();
  const parts: string[] = [];
  if (cycle().enrichment.specFolder && rc().specsDir) parts.push(text('cycle.source.spec'));
  const docs = docsSources();
  if (docs.rulesDirs.length) parts.push(text('cycle.source.rules'));
  else if (docs.skillsDirs.length || docs.claudeMdRoots.length || docs.knowledgeDirs.length) parts.push(text('cycle.source.docs'));
  if (rc().primaryVcs) parts.push(vcsName());
  return parts.length ? joinList(parts, lang) : text('cycle.source.repo');
}

/** The definitions the team gave to blocker and ready-for-QA, as one sentence for the agent ("" when the cycle gives none). */
export function meaningsLine(): string {
  const m = cycle().meanings;
  const definitions = [m.blocker.text, m.readyForQa.text].map((v) => (v ? text(v) : '')).filter(Boolean);
  return definitions.length ? prompt('turn.meanings', { definitions: definitions.join(' ') }) : '';
}

/** Date in the language of the workspace ("02/10/2026", "10/2/2026"). */
export function formatDate(date: Date): string {
  return date.toLocaleDateString(language() === 'en' ? 'en-US' : 'pt-BR');
}

/** Time of day in the language of the workspace. */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(language() === 'en' ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Time of day with seconds, as the minutes print it. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(language() === 'en' ? 'en-US' : 'pt-BR');
}
