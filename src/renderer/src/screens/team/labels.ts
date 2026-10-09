import type { SitesRefusal } from '../../../../shared/browser';
import type { AssistField } from '../../../../shared/agentAssist';
import type { SandboxGuiStatus, SandboxReason } from '../../../../shared/sandbox';
import type { AgentPermission, SandboxNetwork, AgentShell, AgentTracker, CommentEventKey, StageKind, StageType, WaitKind } from '../../../../shared/config/types';
import type { AssistStep } from './assistEdit';
import type { TeamTab } from './teamNav';

// The catalog keys of the values a screen of the team and cycle shows by name. Tables, not built keys, so each key is written out where a search and the
// unused-key test can find it (the same way Settings holds its tables).

export const TAB_LABEL: Record<TeamTab, string> = {
  team: 'ui.team.tab.team',
  squads: 'ui.team.tab.squads',
  flow: 'ui.team.tab.flow',
  comments: 'ui.team.tab.comments',
  attachments: 'ui.team.tab.attachments',
  runner: 'ui.team.tab.runner',
};

export const PERMISSION_LABEL: Record<AgentPermission, string> = { read: 'ui.team.permission.read', worktree: 'ui.team.permission.worktree' };

export const PERMISSION_HINT: Record<AgentPermission, string> = {
  read: 'ui.team.permission.read.hint',
  worktree: 'ui.team.permission.worktree.hint',
};

export const TRACKER_LABEL: Record<AgentTracker, string> = { none: 'ui.team.tracker.none', read: 'ui.team.tracker.read' };
export const TRACKER_HINT: Record<AgentTracker, string> = { none: 'ui.team.tracker.none.hint', read: 'ui.team.tracker.read.hint' };
export const SHELL_LABEL: Record<AgentShell, string> = { none: 'ui.team.shell.none', allowlist: 'ui.team.shell.allowlist', sandbox: 'ui.team.shell.sandbox', host: 'ui.team.shell.host' };
export const SHELL_HINT: Record<AgentShell, string> = { none: 'ui.team.shell.none.hint', allowlist: 'ui.team.shell.allowlist.hint', sandbox: 'ui.team.shell.sandbox.hint', host: 'ui.team.shell.host.hint' };

export const SANDBOX_NETWORK_LABEL: Record<SandboxNetwork, string> = { off: 'ui.runner.sandbox.network.off', registry: 'ui.runner.sandbox.network.registry', open: 'ui.runner.sandbox.network.open' };
/** What the sandbox has to test an interface, as Settings words it. */
export const SANDBOX_BROWSERS_LABEL: Record<SandboxGuiStatus['browsers'], string> = {
  unset: 'ui.runner.sandbox.gui.browsers.unset',
  ready: 'ui.runner.sandbox.gui.browsers.ready',
  missing: 'ui.runner.sandbox.gui.browsers.missing',
  refused: 'ui.runner.sandbox.gui.browsers.refused',
  empty: 'ui.runner.sandbox.gui.browsers.empty',
};

export const SANDBOX_DISPLAY_LABEL: Record<SandboxGuiStatus['display'], string> = {
  off: 'ui.runner.sandbox.gui.display.off',
  ready: 'ui.runner.sandbox.gui.display.ready',
  missing: 'ui.runner.sandbox.gui.display.missing',
};

export const SANDBOX_REASON_LABEL: Record<SandboxReason, string> = {
  platform: 'ui.sandbox.reason.platform',
  'no-bwrap': 'ui.sandbox.reason.no-bwrap',
  refused: 'ui.sandbox.reason.refused',
  'no-prlimit': 'ui.sandbox.reason.no-prlimit',
  'no-timeout': 'ui.sandbox.reason.no-timeout',
};

export const TYPE_LABEL: Record<StageType, string> = { work: 'ui.flow.type.work', gate: 'ui.flow.type.gate', wait: 'ui.flow.type.wait' };
export const TYPE_HINT: Record<StageType, string> = { work: 'ui.flow.type.work.hint', gate: 'ui.flow.type.gate.hint', wait: 'ui.flow.type.wait.hint' };
/** The name a stage added of this type starts with. */
export const NEW_STAGE_LABEL: Record<StageType, string> = { work: 'ui.flow.new.work', gate: 'ui.flow.new.gate', wait: 'ui.flow.new.wait' };

export const KIND_LABEL: Record<StageKind, string> = {
  backlog: 'ui.flow.kind.backlog',
  development: 'ui.flow.kind.development',
  review: 'ui.flow.kind.review',
  reviewApproved: 'ui.flow.kind.reviewApproved',
  qa: 'ui.flow.kind.qa',
  qaApproved: 'ui.flow.kind.qaApproved',
  returned: 'ui.flow.kind.returned',
  done: 'ui.flow.kind.done',
  blocked: 'ui.flow.kind.blocked',
};

export const WAIT_LABEL: Record<WaitKind, string> = {
  'pr-merged': 'ui.flow.wait.pr-merged',
  'reporter-reply': 'ui.flow.wait.reporter-reply',
  label: 'ui.flow.wait.label',
  'linked-done': 'ui.flow.wait.linked-done',
  time: 'ui.flow.wait.time',
  'release-approved': 'ui.flow.wait.release-approved',
  'beta-age': 'ui.flow.wait.beta-age',
  'beta-out': 'ui.flow.wait.beta-out',
  'stable-out': 'ui.flow.wait.stable-out',
  budget: 'ui.flow.wait.budget',
  plugin: 'ui.flow.wait.plugin',
};

export const EVENT_LABEL: Record<CommentEventKey, string> = {
  gate: 'ui.comments.event.gate',
  question: 'ui.comments.event.question',
  pr: 'ui.comments.event.pr',
};

// The agent assistant: its steps, the name of each setting it reviews, and the tools it may switch.
export const ASSIST_STEP_LABEL: Record<AssistStep, string> = {
  request: 'ui.team.assist.step.request',
  questions: 'ui.team.assist.step.questions',
  review: 'ui.team.assist.step.review',
  test: 'ui.team.assist.step.test',
};

export const ASSIST_FIELD_LABEL: Record<AssistField, string> = {
  permission: 'ui.team.f.permission',
  tracker: 'ui.team.f.tracker',
  shell: 'ui.team.f.shell',
  tools: 'ui.team.tools',
  stages: 'ui.team.f.stages',
  squad: 'ui.team.f.squad',
  turnsTo: 'ui.team.f.turnsTo',
};

export const TOOL_LABEL = {
  files: 'ui.team.tools.files',
  skills: 'ui.team.tools.skills',
  vcsCli: 'ui.team.tools.vcsCli',
  subagents: 'ui.team.tools.subagents',
} as const;

// The app's browser: the Chromium line of the agent editor, and why the sites of a logged-in profile could not be listed or revoked.
export const CHROMIUM_LABEL: Record<NonNullable<SandboxGuiStatus['chromium']>, string> = {
  ready: 'ui.team.screen.chromium.ready',
  unset: 'ui.team.screen.chromium.unset',
  none: 'ui.team.screen.chromium.none',
};

export const SITES_REFUSAL_LABEL: Record<SitesRefusal, string> = {
  agent: 'ui.team.sessions.why.agent',
  site: 'ui.team.sessions.why.site',
  open: 'ui.team.sessions.why.open',
  busy: 'ui.team.sessions.why.busy',
  browser: 'ui.team.sessions.why.browser',
  failed: 'ui.team.sessions.why.failed',
};
