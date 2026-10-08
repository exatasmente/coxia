import { squadsOf } from './config/squads';
import { AGENT_PERMISSIONS, AGENT_TRACKERS, type AgentPermission, type AgentShell, type AgentToolsConfig, type AgentTracker, type StageDef, type WorkspaceConfig } from './config/types';
import { isFlowCycle, isWork } from './runs/flow';

// The assistant that creates and adjusts an agent asks a model for two things, a round of questions with a refined draft and a review of the settings, and
// reads what comes back here. Nothing in this file calls a model or reaches Electron: it takes `unknown`, drops what is out of shape without losing what is
// valid, and never throws. The values a model proposes are never taken as they come: `clampSettings` is the one place that decides which of them exist.

export type AssistMode = 'create' | 'adjust';

export const QUESTION_KINDS = ['open', 'single', 'multi'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** The limits of what goes in and out. The main process imposes them again on what the screen sends; the screen only respects them. */
export const ASSIST_LIMITS = {
  /** What the person asks the assistant for. */
  request: 2000,
  /** An open answer, and the text of "Other". */
  answer: 600,
  /** The remark the person adds to a test conversation. */
  note: 600,
  rounds: 4,
  answersPerRound: 6,
  minQuestions: 3,
  questions: 6,
  question: 400,
  options: 6,
  option: 120,
  why: 200,
  reason: 300,
  // The editor's limits for the fields of an agent, so what the assistant makes can always be saved. The name is the stricter of the editor's and the schema's.
  name: 80,
  job: 1000,
  instructions: 4000,
  stages: 60,
  /** The test conversation the assistant reads: the last messages, and the characters of all of them. */
  testMessages: 40,
  testChars: 12_000,
  /** The workspace the model is told about: how many of each, and how long a name or a sentence. */
  contextStages: 60,
  contextSquads: 20,
  contextAgents: 40,
  contextText: 200,
} as const;

export interface AssistQuestion {
  /** `q1`..`q6`, by position and made by the app: a model may repeat ids, so answers are matched to questions by this one. */
  id: string;
  text: string;
  kind: QuestionKind;
  /** The offered options of a choice question, 2 to 6; empty for an open one. "Other" is not here: the screen adds it to every choice. */
  options: string[];
  /** One line on why the answer matters. */
  why: string;
}

/** The answer to one question. Everything empty is a question the person skipped. */
export interface AssistAnswer {
  /** The id of the question. */
  question: string;
  picked: string[];
  /** The text of "Other". */
  other: string;
  /** The text of an open question. */
  text: string;
}

export interface AssistRound {
  questions: AssistQuestion[];
  answers: AssistAnswer[];
}

/** What the editor shows first: the three texts that are the agent. */
export interface AssistDraft {
  name: string;
  job: string;
  instructions: string;
}

export interface AssistSettings {
  permission: AgentPermission;
  tracker: AgentTracker;
  shell: AgentShell;
  /** The tools of this agent alone; null: the workspace's tools. */
  tools: AgentToolsConfig | null;
  stages: string[];
  squad: string | null;
  turnsTo: string | null;
}

export type AssistField = keyof AssistSettings;
export const ASSIST_FIELDS: readonly AssistField[] = ['permission', 'tracker', 'shell', 'tools', 'stages', 'squad', 'turnsTo'];

/** The reason a model gave for each value above the minimum. A field that stayed at the minimum has none. */
export type AssistReasons = Partial<Record<AssistField, string>>;

/** What the editor offers this person on this computer: the only values a model may propose. */
export interface AssistOffers {
  /** A sandbox works here: `shell: sandbox` exists. */
  sandbox: boolean;
  permission: readonly AgentPermission[];
  /** Ids of the stages an agent can work: the work stages of the workspace's flow and of the squads' flows. */
  stages: readonly string[];
  squads: readonly string[];
  /** Ids of the agents one may turn to: not a draft and not the agent itself. */
  turnsTo: readonly string[];
  /** The workspace's tools, what an agent without tools of its own uses. */
  workspaceTools: AgentToolsConfig;
}

/**
 * The work stages an agent can be given: those of the workspace's flow and those of the flow of each squad. A cycle that only classifies cards for the ceremonies has no
 * flow, so no stage is offered. A gate and a wait are not work. The model is told these, the editor lists these, and only these are accepted.
 */
export function offeredStages(config: WorkspaceConfig): StageDef[] {
  if (!isFlowCycle(config.devCycle.stages)) return [];
  const squads = new Set(squadsOf(config).map((s) => s.id));
  const own = Object.entries(config.devCycle.flows ?? {}).filter(([key]) => squads.has(key)).flatMap(([, flow]) => flow);
  const seen = new Set<string>();
  return [...config.devCycle.stages, ...own].filter((s) => isWork(s) && !seen.has(s.id) && !!seen.add(s.id));
}

/** The minimum, the settings of a new blank agent: reads, no tracker, no commands, the workspace's tools, no stages, shared, asks the person. */
export const MINIMUM_SETTINGS: AssistSettings = { permission: 'read', tracker: 'none', shell: 'none', tools: null, stages: [], squad: null, turnsTo: null };

/** Text cleaning that needs the main process (the masking of secrets); passed in so this file stays free of it and the screen can import it. */
export type Scrub = (text: string) => string;
const keep: Scrub = (text) => text;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Trimmed, scrubbed and cut: scrubbed first, so a secret that straddles the cut is not left half readable. */
function cleaned(v: unknown, max: number, scrub: Scrub): string {
  if (typeof v !== 'string') return '';
  const text = scrub(v.trim()).trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** Whether the person left the question without an answer. */
export const isSkipped = (a: Pick<AssistAnswer, 'picked' | 'other' | 'text'>): boolean => !a.picked.length && !a.other.trim() && !a.text.trim();

/**
 * The questions of a round, read from the `questions` of the answer. One without text, of a kind that does not exist, or a choice with fewer than two useful
 * options is dropped without losing the others; at most six pass. The minimum of three is asked of the model, not enforced here: one valid question is shown.
 */
export function readQuestions(raw: unknown, scrub: Scrub = keep): AssistQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistQuestion[] = [];
  for (const entry of raw) {
    if (out.length >= ASSIST_LIMITS.questions) break;
    if (!isRecord(entry)) continue;
    const text = cleaned(entry.text, ASSIST_LIMITS.question, scrub);
    const kind = QUESTION_KINDS.find((k) => k === entry.kind);
    if (!text || !kind) continue;
    let options: string[] = [];
    if (kind !== 'open') {
      const seen = new Set<string>();
      for (const option of Array.isArray(entry.options) ? entry.options : []) {
        const value = cleaned(option, ASSIST_LIMITS.option, scrub);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        options.push(value);
      }
      options = options.slice(0, ASSIST_LIMITS.options);
      if (options.length < 2) continue;
    }
    out.push({ id: `q${out.length + 1}`, text, kind, options, why: cleaned(entry.why, ASSIST_LIMITS.why, scrub) });
  }
  return out;
}

/** The draft of the answer, cut to the editor's limits. A text the model left empty keeps what the draft had, so a round never blanks the name. */
export function readAssistDraft(raw: unknown, previous: AssistDraft = { name: '', job: '', instructions: '' }, scrub: Scrub = keep): AssistDraft {
  const r = isRecord(raw) ? raw : {};
  return {
    name: cleaned(r.name, ASSIST_LIMITS.name, scrub) || previous.name,
    job: cleaned(r.job, ASSIST_LIMITS.job, scrub) || previous.job,
    instructions: cleaned(r.instructions, ASSIST_LIMITS.instructions, scrub) || previous.instructions,
  };
}

// ---- the settings -------------------------------------------------------------------------------------------------------------------------

const TOOL_KEYS = ['files', 'skills', 'vcsCli', 'subagents'] as const;

const sameTools = (a: AgentToolsConfig, b: AgentToolsConfig): boolean =>
  a.files === b.files && a.skills === b.skills && a.vcsCli === b.vcsCli && a.subagents === b.subagents && a.trackerMcp === b.trackerMcp && a.trackerMcpServer === b.trackerMcpServer;

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

function sameField<K extends AssistField>(field: K, a: AssistSettings[K], b: AssistSettings[K]): boolean {
  if (field === 'tools') {
    const x = a as AssistSettings['tools'];
    const y = b as AssistSettings['tools'];
    return x === null || y === null ? x === y : sameTools(x, y);
  }
  if (field === 'stages') return sameSet(a as string[], b as string[]);
  return a === b;
}

/** Whether a field has moved from the minimum: the settings of a new agent when creating, the agent as it is when adjusting. */
export const isAboveMinimum = (field: AssistField, settings: AssistSettings, base: AssistSettings): boolean => !sameField(field, settings[field], base[field]);

/** The shells a model may propose for a permission: `host` is never one of them, `sandbox` only where one works, `allowlist` only for an agent that writes. */
export function shellsOffered(offers: Pick<AssistOffers, 'sandbox'>, permission: AgentPermission): AgentShell[] {
  return ['none', ...(offers.sandbox ? (['sandbox'] as const) : []), ...(permission === 'worktree' ? (['allowlist'] as const) : [])];
}

/** A field of the review: `{ [key]: value, reason }` as the schema asks, or the bare value the screen sends back to be saved. */
function entryOf(raw: Record<string, unknown>, field: string, key: string, scrub: Scrub): { value: unknown; reason: string } | null {
  const f = raw[field];
  if (isRecord(f)) return key in f ? { value: f[key], reason: cleaned(f.reason, ASSIST_LIMITS.reason, scrub) } : null;
  return f === undefined ? null : { value: f, reason: '' };
}

export interface ClampOptions {
  /** A value above the minimum without a reason goes back to the minimum (what a model's review is held to). Off for settings the person already saw with theirs. */
  needReason?: boolean;
  scrub?: Scrub;
}

/**
 * The settings a model proposed, held to what exists. `raw` is the review of the model (each field `{ value, reason }`) or the settings the screen sends back
 * (each field bare); `base` is where the proposal starts and what a refused field falls back to. A value is taken only when the editor offers it here, and (for
 * a model's review) only with its reason: `permission` is read first, because `allowlist` depends on the permission that was accepted. `host`, the autonomy, the
 * commands always allowed, the model and the id are not read at all, and the tracker tools of an agent are copied from `base`, never from `raw`.
 * Never throws: input that is not an object leaves `base`.
 */
export function clampSettings(raw: unknown, offers: AssistOffers, base: AssistSettings, options: ClampOptions = {}): { settings: AssistSettings; reasons: AssistReasons } {
  const scrub = options.scrub ?? keep;
  const needReason = options.needReason !== false;
  const r = isRecord(raw) ? raw : {};
  const settings: AssistSettings = { ...base, tools: base.tools ? { ...base.tools } : null, stages: [...base.stages] };
  const reasons: AssistReasons = {};

  // A field moves only when it differs from the base and, for a model, comes with its reason.
  const take = <K extends AssistField>(field: K, value: AssistSettings[K], reason: string, unchanged = sameField(field, value, base[field])): void => {
    if (unchanged || (needReason && !reason)) return;
    settings[field] = value;
    if (reason) reasons[field] = reason;
  };

  const permission = entryOf(r, 'permission', 'value', scrub);
  if (permission && typeof permission.value === 'string' && (AGENT_PERMISSIONS as readonly string[]).includes(permission.value) && (offers.permission as readonly string[]).includes(permission.value)) {
    take('permission', permission.value as AgentPermission, permission.reason);
  }

  const tracker = entryOf(r, 'tracker', 'value', scrub);
  if (tracker && typeof tracker.value === 'string' && (AGENT_TRACKERS as readonly string[]).includes(tracker.value)) take('tracker', tracker.value as AgentTracker, tracker.reason);

  // `host` is not offered; one the agent already had stays because the model did not move it (a value equal to the base is not a change).
  const shell = entryOf(r, 'shell', 'value', scrub);
  if (shell && typeof shell.value === 'string' && (shell.value === base.shell || (shellsOffered(offers, settings.permission) as string[]).includes(shell.value))) {
    take('shell', shell.value as AgentShell, shell.reason);
  }

  const toolsRaw = r.tools;
  const effectiveBase = base.tools ?? offers.workspaceTools;
  if (toolsRaw === null || isRecord(toolsRaw)) {
    let candidate: AgentToolsConfig | null = null;
    let opinion = toolsRaw === null;
    if (isRecord(toolsRaw)) {
      // Only the four switches come from the model; the tracker tools stay what the agent (or the workspace) had.
      const next: AgentToolsConfig = { ...effectiveBase };
      for (const key of TOOL_KEYS) {
        if (typeof toolsRaw[key] === 'boolean') {
          next[key] = toolsRaw[key] as boolean;
          opinion = true;
        }
      }
      candidate = sameTools(next, offers.workspaceTools) ? null : next;
    }
    if (opinion) {
      const unchanged = sameTools(candidate ?? offers.workspaceTools, effectiveBase);
      take('tools', candidate, isRecord(toolsRaw) ? cleaned(toolsRaw.reason, ASSIST_LIMITS.reason, scrub) : '', unchanged);
    }
  }

  const stages = entryOf(r, 'stages', 'ids', scrub);
  if (stages && Array.isArray(stages.value)) {
    const known = new Set(offers.stages);
    const given = stages.value.filter((id): id is string => typeof id === 'string');
    const valid = [...new Set(given.filter((id) => known.has(id)))].slice(0, ASSIST_LIMITS.stages);
    // Ids that all fail to exist are not a request to clear the stages.
    if (valid.length || !given.length) take('stages', valid, stages.reason);
  }

  const squad = entryOf(r, 'squad', 'id', scrub);
  if (squad && (squad.value === null || (typeof squad.value === 'string' && offers.squads.includes(squad.value)))) take('squad', squad.value as string | null, squad.reason);

  const turnsTo = entryOf(r, 'turnsTo', 'id', scrub);
  if (turnsTo && (turnsTo.value === null || (typeof turnsTo.value === 'string' && offers.turnsTo.includes(turnsTo.value)))) take('turnsTo', turnsTo.value as string | null, turnsTo.reason);

  // The editor drops `allowlist` to `none` when the permission stops writing; the same here, so a lowered permission leaves a combination the editor accepts.
  if (settings.shell === 'allowlist' && settings.permission !== 'worktree') settings.shell = 'none';

  // A field that did not move has no reason to show.
  for (const field of ASSIST_FIELDS) if (!isAboveMinimum(field, settings, base)) delete reasons[field];
  return { settings, reasons };
}

// ---- the two schemas the model answers ----------------------------------------------------------------------------------------------------------
// Only `type`, `properties`, `required`, `additionalProperties` and `enum`: some servers of the open engine refuse the size keywords in strict mode, so the limits are
// above, in the readers.

type Schema = Record<string, unknown>;

const object = (properties: Record<string, unknown>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = { type: 'string' };
const draftSchema = object({ name: text, job: text, instructions: text });

/** The round: the refined draft, the next questions and whether nothing important is left to ask. */
export const ASSIST_ROUND_SCHEMA: Schema = object({
  draft: draftSchema,
  // `kind` is left a plain string: an engine that checks the schema would send a question of an unknown kind back to the model and could spend the round on it,
  // where the reader drops that one question and keeps the others.
  questions: { type: 'array', items: object({ text, kind: { type: 'string' }, options: { type: 'array', items: text }, why: text }) },
  enough: { type: 'boolean' },
});

/** An id from a list of ids that exist, or `null`; with none to offer, only `null`. */
const idOrNull = (ids: readonly string[]): Schema => (ids.length ? { type: ['string', 'null'], enum: [...ids, null] } : { type: 'null' });

/** The review: the draft and each setting, with its reason. The values a model may pick are the ones `offers` lists. */
export function assistReviewSchema(offers: AssistOffers): Schema {
  const reason = { reason: text };
  const flag = { type: ['boolean', 'null'] };
  return object({
    draft: draftSchema,
    permission: object({ value: { type: 'string', enum: [...offers.permission] }, ...reason }),
    tracker: object({ value: { type: 'string', enum: [...AGENT_TRACKERS] }, ...reason }),
    shell: object({ value: { type: 'string', enum: shellsOffered(offers, 'worktree') }, ...reason }),
    tools: object({ files: flag, skills: flag, vcsCli: flag, subagents: flag, ...reason }),
    stages: object({ ids: { type: 'array', items: offers.stages.length ? { type: 'string', enum: [...offers.stages] } : text }, ...reason }),
    squad: object({ id: idOrNull(offers.squads), ...reason }),
    turnsTo: object({ id: idOrNull(offers.turnsTo), ...reason }),
  });
}
