// i18n-lint: allow-file English diagnostics of the config migration, written to the log
import { mergeDeep, neutralConfig, neutralRunner, neutralSandbox, withConfigDefaults } from './defaults';
import type { LegacyProfile } from './legacy';
import { validateConfig, type ConfigIssue } from './validate';
import { agentFlowComments } from '../cycles/templates/agentFlowComments';
import { AGENT_FLOW_STAGES, agentFlowTeam } from '../cycles/templates/agentFlow';
import { systemAgents } from './team';
import { CONFIG_SCHEMA_VERSION, LLM_ROLES, type DeepPartial, type LlmRole, type WorkspaceConfig } from './types';

// config.json history:
//   v1  no schemaVersion; the flat "Settings" of the app before configuration existed (models, tools, schedule, voice, ...; web lived in it too).
//   v2  WorkspaceConfig (types.ts).
//   v3  devCycle.priority, and the card fields `priority` and `milestone` offered to the agents.
//   v4  projects.issues.cardScope and cardLabels: which issues become cards. Nothing stored changes; the bump makes an app that does not know the
//       fields refuse the file instead of repairing (and then saving) a `projects.issues` block it cannot read.
//   v5  agents.team (the five system agents, seeded from agents.roles) and, on a stage, `agentId`, `artifacts` and `human`.
//   v6  runner (the section that takes an issue through the agent cycle by itself), off by default.
//   v7  devCycle.comments (the templates of the comments the runner leaves on the tracker): the agent cycle's own, none for any other cycle.
//   v8  the stages of an agent cycle are a flow: `type` (work, gate, wait), `produces` (was `artifacts`), `returnsTo` and `roundLimit` (the review and QA rules the
//       runner used to have built in), and the order of the list is the order of the run (it used to be the rank). The agent cycle itself grew a business team
//       (support, product owner, tech lead, customer success): a workspace still on its untouched default gets it, any other keeps what it has.
//   v9  `runner.stageTimeoutMs` (one wall-clock limit) is two: `stageIdleMs` (no sign of life from the agent) and `stageMaxMs` (the cap on a stage).
//   v10 `agents.team[].tracker` and `.shell` (what an agent of a run may read from the code host and run), and `runner.sandbox` (what the sandbox of an agent set to
//       `shell: sandbox` may reach and use). Nothing is raised: an agent that writes keeps its commands (`allowlist`, or `none` when the workspace lists none), an agent
//       that only reads keeps no commands and keeps the code host read it had when the workspace switches for it were on.
//   v11 projects.verifyCommands: the conflict verification command of each project, which used to live in one file shared by every workspace.
//       The step only adds the empty map; the commands of the old file are moved by a startup step in the main process (verify-move.ts), because
//       a migration never reads the disk. The bump makes an older app refuse the file instead of resetting the whole `projects` block.
// A migration takes the document of version N and returns the document of version N+1, never reading the disk or the machine:
// everything it needs comes in the context, so it is testable with plain objects.

export interface MigrationContext {
  /**
   * The workspace belongs to an install that existed before configuration did, and has no config file to read.
   * Such a workspace gets the optional profile (legacy.ts) so it keeps behaving as before; without one, the neutral defaults apply.
   */
  legacyInstall: boolean;
  /** The profile file of the person, when there is one. */
  profile?: LegacyProfile | null;
}

export interface MigrationResult {
  config: WorkspaceConfig;
  fromVersion: number;
  /** True when the stored document had to change (a v1 file, a missing file on a legacy install, or invalid fields reset). */
  changed: boolean;
  notes: string[];
}

type Doc = Record<string, unknown>;
type Step = (doc: Doc, ctx: MigrationContext, notes: string[]) => Doc;

const isObject = (v: unknown): v is Doc => typeof v === 'object' && v !== null && !Array.isArray(v);
const pick = (v: unknown): Doc => (isObject(v) ? v : {});

// The base a migrated document starts from: the neutral defaults, plus the person's profile when there is one.
function baseOf(ctx: MigrationContext): WorkspaceConfig {
  return ctx.profile ? (mergeDeep(neutralConfig(), ctx.profile.config) as WorkspaceConfig) : neutralConfig();
}

function v1ToV2(old: Doc, ctx: MigrationContext, notes: string[]): Doc {
  const models = pick(old.models);
  const tools = pick(old.tools);
  const carried = ctx.profile?.migratedModels ?? null;
  const model = (role: LlmRole): string => {
    const m = models[role === 'fix' ? 'reply' : role];
    return typeof m === 'string' && m.trim() ? m.trim() : (carried?.defaultModel ?? '');
  };
  const patch: DeepPartial<WorkspaceConfig> & Doc = {
    llm: carried ? { roles: Object.fromEntries(LLM_ROLES.map((r) => [r, { provider: carried.provider, model: model(r) }])) as Record<LlmRole, { provider: string; model: string }> } : undefined,
    agents: { tools: { files: tools.files as boolean, skills: tools.skills as boolean, trackerMcp: tools.gitlabMcp as boolean, vcsCli: tools.glab as boolean, subagents: tools.subagents as boolean } },
    schedule: pick(old.schedule),
    voice: pick(old.voice),
    notifications: old.notifications as boolean,
    closeToTray: old.closeToTray as boolean,
    retention: pick(old.retention),
    appearance: pick(old.appearance),
  };
  if (isObject(old.web)) notes.push('web settings are not part of the workspace config (they stay in the shared web.json)');
  notes.push(ctx.profile ? 'built from the v1 settings and the legacy profile file' : 'built from the v1 settings over the neutral defaults (no legacy profile)');
  return { ...(mergeDeep(baseOf(ctx), dropUndefined(patch)) as unknown as Doc), schemaVersion: 2 };
}

function dropUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v as T;
  if (!isObject(v)) return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, dropUndefined(x)])) as T;
}

// A stored v2 file lists its card fields explicitly, so the two new ones are appended: without that an existing workspace would never show them to the agent.
function v2ToV3(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  if (!Object.keys(cycle).length) return { ...old, schemaVersion: 3 };
  const enrichment = pick(cycle.enrichment);
  const fields = Array.isArray(enrichment.cardFields) ? (enrichment.cardFields as unknown[]) : null;
  const added = fields ? ['priority', 'milestone'].filter((f) => !fields.includes(f)) : [];
  if (added.length) notes.push(`card fields ${added.join(', ')} added to what the agents see`);
  return {
    ...old,
    schemaVersion: 3,
    devCycle: {
      ...cycle,
      priority: isObject(cycle.priority) ? cycle.priority : { labels: [] },
      ...(fields && added.length ? { enrichment: { ...enrichment, cardFields: [...fields, ...added] } } : {}),
    },
  };
}

// A v3 file has no card scope: it gets today's behavior written out, and nothing else in the file moves.
function v3ToV4(old: Doc, _ctx: MigrationContext, _notes: string[]): Doc {
  const projects = pick(old.projects);
  if (!Object.keys(projects).length) return { ...old, schemaVersion: 4 };
  const issues = pick(projects.issues);
  return {
    ...old,
    schemaVersion: 4,
    projects: { ...projects, issues: { ...issues, cardScope: issues.cardScope ?? 'assigned', cardLabels: issues.cardLabels ?? [] } },
  };
}

// The team starts as the five system agents, one per role, taking each role's model and extra instructions: nothing the ceremonies do changes.
// A file with no agents section is left to the defaults, which hold the same five.
function v4ToV5(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const agents = pick(old.agents);
  if (!Object.keys(agents).length || Array.isArray(agents.team)) return { ...old, schemaVersion: 5 };
  const roles = pick(agents.roles);
  const seeds = Object.fromEntries(LLM_ROLES.map((r) => [r, pick(roles[r])]));
  notes.push('agent team created with the five built-in agents, taken from agents.roles');
  return { ...old, schemaVersion: 5, agents: { ...agents, team: systemAgents(seeds) } };
}

// The runner starts switched off with its defaults, so a workspace that never heard of it behaves exactly as before.
function v5ToV6(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  if (isObject(old.runner)) return { ...old, schemaVersion: 6 };
  notes.push('runner section created with its defaults (off)');
  return { ...old, schemaVersion: 6, runner: neutralRunner() };
}

// A workspace on the agent cycle gets that cycle's comment templates (the runner then has something to post); any other cycle brings none, so nothing
// is ever posted for it. A file that already carries templates keeps them.
function v6ToV7(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  if (!Object.keys(cycle).length || isObject(cycle.comments)) return { ...old, schemaVersion: 7 };
  const own = cycle.templateId === 'agent-flow';
  if (own) notes.push('comment templates of the agent cycle added to devCycle');
  return { ...old, schemaVersion: 7, devCycle: { ...cycle, comments: own ? agentFlowComments() : {} } };
}

// What the runner did before the flow was data, written as the fields that say the same: a gate is `human`, the review sends the work back to the stage
// before it, a QA failure to the first stage whose agent changes files, both after two rounds, and the stage where the run ends (the last by rank) has no
// agent. A cycle with none of the agent fields is one of the ceremonies' and is left as it is.
function v7ToV8(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const cycle = pick(old.devCycle);
  const list = Array.isArray(cycle.stages) ? (cycle.stages as unknown[]).filter(isObject) : [];
  if (!list.some((s) => s.human !== undefined || s.agentId !== undefined || s.artifacts !== undefined)) return { ...old, schemaVersion: 8 };
  const team = Array.isArray(pick(old.agents).team) ? (pick(old.agents).team as unknown[]).filter(isObject) : [];
  const rank = (s: Doc): number => (typeof s.rank === 'number' ? s.rank : 0);
  // The flow's order used to be rank, then the list: now it is the list.
  const ordered = list.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => ({ ...x.s }));
  const agentOf = (s: Doc): Doc | undefined => team.find((a) => a.id === s.agentId) ?? team.find((a) => Array.isArray(a.stages) && (a.stages as unknown[]).includes(s.id));
  const writer = (s: Doc): boolean => s.human !== true && agentOf(s)?.permission === 'worktree';
  const stages = ordered.map((s, i) => {
    const { human, artifacts, ...rest } = s;
    const out: Doc = { ...rest, type: human === true ? 'gate' : 'work' };
    if (Array.isArray(artifacts) && artifacts.length) out.produces = artifacts;
    if (i === ordered.length - 1) delete out.agentId;
    if (human !== true && s.kind === 'review') {
      const before = ordered.slice(0, i).reverse().find((x) => x.human !== true);
      if (before) Object.assign(out, { returnsTo: before.id, roundLimit: 2 });
    }
    if (human !== true && s.kind === 'qa') {
      const builder = ordered.slice(0, i).find(writer);
      if (builder) Object.assign(out, { returnsTo: builder.id, roundLimit: 2 });
    }
    return out;
  });
  if (ordered.some((s, i) => s !== undefined && list[i] !== undefined && s.id !== list[i].id)) notes.push('the stages of the agent cycle are listed in the order a run goes through them (they were ordered by rank)');
  notes.push('the stages of the agent cycle became a flow (type, produces, returnsTo, roundLimit)');
  const flowDoc = { ...old, schemaVersion: 8, devCycle: { ...cycle, stages } };
  return cycle.templateId === 'agent-flow' ? withBusinessTeam(flowDoc, stages, notes) : flowDoc;
}

// The agent cycle as it was before it had a business team, written as what identifies it: the stages, their agents, files and returns.
const ENGINEERING_SIGNATURE = 'refine:work:refiner:1_SPEC.md:|gate1:gate:::|plan:work:planner:2_PLAN.md:|gate2:gate:::|implement:work:developer:3_IMPLEMENTATION.md:|review:work:reviewer:4_REVIEW.md:implement|qa:work:qa:5_TEST_PLAN.md:implement|ready:work:::';
const signatureOf = (stages: Doc[]): string => stages.map((s) => [s.id, s.type, s.agentId ?? '', Array.isArray(s.produces) ? s.produces.join(',') : '', s.returnsTo ?? ''].join(':')).join('|');

// A workspace whose agent cycle is still exactly the one the app delivered gets the new default: triage, the business roles and the communication after the pull
// request is merged. Its own agents are not renamed or touched (the refiner, the planner and the reviewer stay in the team; the stages now name the product owner
// and the tech lead instead), and the agents the app adds are added by id. A cycle the person changed keeps its stages and agents, and the notes say what is new.
function withBusinessTeam(doc: Doc, stages: Doc[], notes: string[]): Doc {
  if (signatureOf(stages) !== ENGINEERING_SIGNATURE) {
    notes.push('the agent cycle has a new default flow (triage, product owner, tech lead, customer success, communicate): your stages and agents were left as they are; apply the agent cycle template to try it');
    return doc;
  }
  const agents = pick(doc.agents);
  const team = (Array.isArray(agents.team) ? (agents.team as unknown[]).filter(isObject) : []).map((a) => ({ ...a }));
  const have = new Set(team.map((a) => a.id));
  const brought = agentFlowTeam().filter((a) => !have.has(a.id));
  // The developer and QA that were delivered turn to the tech lead; one the person already pointed somewhere is left alone.
  for (const a of team) if ((a.id === 'developer' || a.id === 'qa') && a.turnsTo === undefined) a.turnsTo = 'tech-lead';
  const cycle = pick(doc.devCycle);
  const comments = { ...agentFlowComments(true), ...pick(cycle.comments) };
  const layout = pick(cycle.specLayout);
  const phases = Array.isArray(layout.phaseFiles) ? (layout.phaseFiles as Doc[]) : [];
  const phase = (file: string, key: string): Doc => ({ file, label: `cycle.agentFlow.phase.${key}` });
  const phaseFiles = [...(phases.some((p) => p.file === '6_RELEASE_NOTE.md') ? [] : [phase('6_RELEASE_NOTE.md', 'releaseNote')]), ...phases, ...(phases.some((p) => p.file === '0_TRIAGE.md') ? [] : [phase('0_TRIAGE.md', 'triage')])];
  notes.push(`the agent cycle got its new default flow: triage, product owner, tech lead, customer success and communicate after the pull request is merged (added: ${brought.map((a) => a.id).join(', ') || 'no new agent'}); Refiner is now the Product Owner, Planner and Reviewer the Tech Lead, and your agents stay in the team`);
  return { ...doc, agents: { ...agents, team: [...team, ...brought] }, devCycle: { ...cycle, stages: structuredClone(AGENT_FLOW_STAGES), comments, ...(Object.keys(layout).length ? { specLayout: { ...layout, phaseFiles } } : {}) } };
}

// The stage timeout used to be one wall-clock limit (`runner.stageTimeoutMs`, 30 minutes by default). It is two now: an idle limit (no sign of life from the
// agent for that long) and a generous wall-clock cap. A value the person set keeps being the longest a stage may take (the cap, and the idle limit too when it
// is shorter than the default idle limit); the old default becomes the new defaults.
const OLD_STAGE_TIMEOUT_MS = 30 * 60_000;
function v8ToV9(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const runner = pick(old.runner);
  if (runner.stageTimeoutMs === undefined) return { ...old, schemaVersion: 9 };
  const { stageTimeoutMs, ...rest } = runner;
  const own = typeof stageTimeoutMs === 'number' && stageTimeoutMs !== OLD_STAGE_TIMEOUT_MS ? stageTimeoutMs : null;
  const idle = neutralRunner().stageIdleMs;
  if (own !== null) notes.push(`runner.stageTimeoutMs (${own} ms) is now runner.stageMaxMs, the cap on a stage; the idle limit is runner.stageIdleMs`);
  else notes.push('runner.stageTimeoutMs became two limits: runner.stageIdleMs (no sign of life from the agent) and runner.stageMaxMs (the cap on a stage), with their defaults');
  return { ...old, schemaVersion: 9, runner: { ...rest, ...(own !== null ? { stageMaxMs: own, ...(own < idle ? { stageIdleMs: own } : {}) } : {}) } };
}

// Every agent gets the two permissions it effectively had: they are written down, not guessed from the permission each time, so a later default never moves them.
// A reader had the code host read of the ceremonies (a workspace-wide switch) and ran no command; an agent that writes ran the commands of `runner.commands` and had
// no host read. The migration raises nothing; the new defaults per role are offered by the team editor, never applied here.
function v9ToV10(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const agents = pick(old.agents);
  const tools = pick(agents.tools);
  const reads = tools.vcsCli === true || tools.trackerMcp === true;
  const runner = pick(old.runner);
  const none = Array.isArray(runner.commands) && runner.commands.length === 0;
  const team = (Array.isArray(agents.team) ? (agents.team as unknown[]).filter(isObject) : []).map((a) => {
    const writes = a.permission === 'worktree';
    return { ...a, tracker: a.tracker ?? (writes ? 'none' : reads ? 'read' : 'none'), shell: a.shell ?? (writes && !none ? 'allowlist' : 'none') };
  });
  notes.push('agents got "tracker" and "shell": nothing was raised (an agent that writes keeps the commands of the runner, one that only reads keeps the code host read the workspace gave it and runs nothing); the team editor offers the recommended permissions of each role, and the new runner.sandbox is closed (no network, no extra folder)');
  return { ...old, schemaVersion: 10, agents: { ...agents, team }, runner: { ...runner, sandbox: runner.sandbox ?? neutralSandbox() } };
}

// A v10 file has no verification commands: it gets an empty map (one already there is kept), and nothing else in the file moves.
function v10ToV11(old: Doc, _ctx: MigrationContext, _notes: string[]): Doc {
  const projects = pick(old.projects);
  if (!Object.keys(projects).length) return { ...old, schemaVersion: 11 };
  return { ...old, schemaVersion: 11, projects: { ...projects, verifyCommands: isObject(projects.verifyCommands) ? projects.verifyCommands : {} } };
}

// Index N migrates a version N document to N+1.
// The ceremonies now follow the code host read of their system agent. Every system agent had `tracker: none` and the ceremonies read anyway (a workspace
// switch): one gets `read` where the workspace reads, so no ceremony loses what it did. Nothing else moves; the list of always-allowed commands starts absent.
function v11ToV12(old: Doc, _ctx: MigrationContext, notes: string[]): Doc {
  const agents = pick(old.agents);
  const tools = pick(agents.tools);
  const reads = tools.vcsCli === true || tools.trackerMcp === true;
  if (!Array.isArray(agents.team)) return { ...old, schemaVersion: 12 };
  const team = (agents.team as unknown[]).map((a) => (isObject(a) && a.system === true && reads && a.tracker !== 'read' ? { ...a, tracker: 'read' } : a));
  notes.push('the system agents keep the code host read the ceremonies had (tracker "read" where the workspace reads); the ceremonies now follow it');
  return { ...old, schemaVersion: 12, agents: { ...agents, team } };
}

const STEPS: Record<number, Step> = { 1: v1ToV2, 2: v2ToV3, 3: v3ToV4, 4: v4ToV5, 5: v5ToV6, 6: v6ToV7, 7: v7ToV8, 8: v8ToV9, 9: v9ToV10, 10: v10ToV11, 11: v11ToV12 };

const tokens = (path: string): (string | number)[] => [...path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)].map((m) => (m[2] !== undefined ? Number(m[2]) : m[1]));

function get(root: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((cur, key) => (cur !== null && typeof cur === 'object' ? (cur as Record<string | number, unknown>)[key] : undefined), root);
}

function set(root: Doc, path: (string | number)[], value: unknown): void {
  let cur = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) cur = cur[key] as Record<string | number, unknown>;
  cur[path[path.length - 1]] = value;
}

// A stored value that fails validation is replaced by the default it would have had, so one bad field never locks a workspace out.
function repair(doc: Doc, base: WorkspaceConfig, issues: ConfigIssue[], notes: string[]): Doc {
  const out = structuredClone(doc);
  for (const issue of issues) {
    let path = tokens(issue.path);
    while (path.length && typeof path[path.length - 1] === 'number') path = path.slice(0, -1);
    while (path.length > 1 && get(base, path) === undefined) path = path.slice(0, -1);
    if (!path.length || get(base, path) === undefined) continue;
    set(out, path, structuredClone(get(base, path)));
    notes.push(`reset ${path.join('.')}: ${issue.message}`);
  }
  return out;
}

/** Brings any stored document to the current version. Throws only for a document written by a newer app. */
export function migrateConfig(raw: unknown, ctx: MigrationContext): MigrationResult {
  const notes: string[] = [];
  let doc: Doc;
  let version: number;
  let changed = false;
  if (isObject(raw)) {
    doc = raw;
    version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  } else if (ctx.legacyInstall) {
    doc = {};
    version = 1;
    notes.push('no config file on an existing install: the legacy profile, or the neutral defaults without one');
  } else {
    return { config: neutralConfig(), fromVersion: CONFIG_SCHEMA_VERSION, changed: false, notes: ['fresh install: neutral defaults'] };
  }
  const fromVersion = version;
  if (version > CONFIG_SCHEMA_VERSION) throw new Error(`config written by a newer app (schema ${version}); this app understands up to ${CONFIG_SCHEMA_VERSION}`);
  while (version < CONFIG_SCHEMA_VERSION) {
    const step = STEPS[version];
    if (!step) throw new Error(`no migration from config schema ${version}`);
    doc = step(doc, ctx, notes);
    version++;
    changed = true;
  }
  let result = validateConfig(doc, { tolerateFlow: true });
  if (!result.ok) {
    doc = repair(doc, ctx.legacyInstall || fromVersion < CONFIG_SCHEMA_VERSION ? baseOf(ctx) : neutralConfig(), result.errors, notes);
    result = validateConfig(doc, { tolerateFlow: true });
    changed = true;
  }
  if (!result.ok || !result.config) {
    notes.push('config unusable after repair: neutral defaults');
    return { config: withConfigDefaults({}), fromVersion, changed: true, notes };
  }
  return { config: result.config, fromVersion, changed, notes };
}
