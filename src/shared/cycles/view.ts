import type { CycleMeanings, Language, LlmRole, StageDef, WorkspaceConfig } from '../config/types';
import type { DestinationLabels } from '../destination';
import type { Card } from '../types';
import type { Terms } from '../i18n/terms';
import { availability, type Availability, type CeremonyContext } from './ceremonies';
import { hostFacts, type HostFacts } from './host';
import { builtInName } from './names';
import { termsFor } from './terms';
import { cycleText, userTerms } from './text';

// What the screens need to know about the cycle, as plain data: which ceremonies to show, what the stages are, how to call the person.
// The main process builds it (cycle:view) and the renderer follows config changes; nothing here reads the disk.

export interface ViewContext extends CeremonyContext {
  /** Name of the tool that stores a note on a card (the card source's command); null when there is none. */
  noteTool: string | null;
  /** The workspace this process runs, so the renderer can tell its cached terms from another workspace's. */
  workspaceId?: string | null;
}

export interface CycleView {
  templateId: string;
  templateName: string;
  language: Language;
  /** How the greeting addresses the person; empty when no name is set. */
  userName: string;
  /** Ceremonies the app offers right now (on in the cycle and with what they need present). */
  ceremonies: Availability;
  /** How the team calls the daily preparation. */
  preDailyLabel: string;
  stages: StageDef[];
  meanings: Pick<CycleMeanings, 'blocker' | 'readyForQa'>;
  /** Words a decision's destination is written with. */
  destination: DestinationLabels;
  /** The standard placeholders of the workspace ({vcsName}, {cr}, {ceremony}...): the renderer fills its catalog texts from them. */
  terms: Terms;
  /** What the configured host, tools and engines can do: what the screens hide. */
  host: HostFacts;
  /** Where the cards come from, in a word: the card source tool when one is configured, else the host. */
  cardsFrom: string;
  /** The workspace has a specs folder: the documents the cycle names exist. */
  specs: boolean;
  /** The workspace the view is of (null when the caller did not say). */
  workspaceId: string | null;
}

export function buildCycleView(config: WorkspaceConfig, ctx: ViewContext): CycleView {
  const { devCycle, language } = config;
  const terms = userTerms(language, config);
  const host = hostFacts(config);
  return {
    templateId: devCycle.templateId,
    templateName: builtInName(devCycle.templateId, language),
    language,
    userName: terms.userName,
    ceremonies: availability(devCycle, ctx),
    preDailyLabel: cycleText(devCycle.ceremonyParams.preDaily.label, language, terms),
    stages: devCycle.stages,
    meanings: { blocker: devCycle.meanings.blocker, readyForQa: devCycle.meanings.readyForQa },
    destination: {
      heading: cycleText(devCycle.specLayout.decisionLog.heading, language, terms),
      noteTool: ctx.noteTool,
      noteFallback: cycleText('cycle.noteFallback', language),
      minutes: cycleText('cycle.minutes', language),
    },
    terms: termsFor(config, language),
    host,
    cardsFrom: ctx.noteTool ?? host.name,
    specs: ctx.specs,
    workspaceId: ctx.workspaceId ?? null,
  };
}

// What the screens show or hide, from what the workspace has. Pure, so a test settles it without a screen.

/** The "host" button of an activity opens the Quick actions screen: worth it when the card has a change request to act on, or a status the app reads (GitLab). */
export function showQuickActions(card: Pick<Card, 'mrPaths'>, host: HostFacts): boolean {
  return host.kind !== null && (card.mrPaths.length > 0 || host.issueStatus);
}

/** The issue status block (status, stage labels, transitions) of the Quick actions screen: only a host with a status the app reads. */
export const showIssueStatus = (host: HostFacts): boolean => host.issueStatus;

/** The list of transitions inside that block: only when the cycle has rules for moving the status. */
export const showTransitions = (host: HostFacts): boolean => host.issueStatus && host.quickTransitions;

export type ToolSwitch = 'files' | 'skills' | 'gitlabMcp' | 'glab' | 'subagents';

/**
 * The tool switches Settings lists. The agent read switch needs an integration to govern (and is labelled by the host and its CLI, or by the
 * app's own tool when the host has none); the tracker MCP switch does nothing without a configured server.
 */
export function visibleTools(host: HostFacts): ToolSwitch[] {
  return (['files', 'skills', 'gitlabMcp', 'glab', 'subagents'] as const).filter((key) => (key === 'gitlabMcp' ? host.trackerMcp : key === 'glab' ? host.readSwitch : true));
}

/** "Continue in Claude Code" resumes a session through `claude --resume`, which only reads the sessions of the Claude engine. */
export function showContinueInClaude(host: HostFacts, role: LlmRole): boolean {
  // A turn is answered by the reply role, in the same session.
  return host.engines[role] !== 'open' && (role !== 'turn' || host.engines.reply !== 'open');
}

export interface ListedCeremonies {
  preDaily: boolean;
  unblock: boolean;
  qaHandoff: boolean;
  retro: boolean;
  gate: boolean;
  /** An activity can come back from testing: the cycle has a "returned" stage. */
  qaReturn: boolean;
  /** Discussions, Quick actions and the radar read the code host. */
  host: boolean;
}

/** The ceremonies the Help screen describes: only the ones the cycle has and the workspace can run. */
export function ceremoniesListed(view: Pick<CycleView, 'ceremonies' | 'stages' | 'host'>): ListedCeremonies {
  return {
    preDaily: view.ceremonies.preDaily,
    unblock: view.ceremonies.unblock,
    qaHandoff: view.ceremonies.qaHandoff,
    retro: view.ceremonies.retro,
    gate: view.ceremonies.gate,
    qaReturn: view.stages.some((s) => s.kind === 'returned'),
    host: view.host.kind !== null,
  };
}
