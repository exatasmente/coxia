import { PERSONA_TOOLS, type PersonaToolName } from '../../shared/personaTools';
import { type ArgSpec, arg } from './args';

// The table of the persona's door (#248): every channel the app registers is either named by exactly one operation of one of the eleven tools, or is on the exclusion list with
// its reason. test/persona-door-table.test.ts reads the sources and fails for a channel that is in neither, in both, or named here and registered nowhere, the way an unlisted
// `persona:` channel is denied to the phone. Data only: what an operation builds, says and runs is in doorOps.ts. The names of the operations follow the channel, and where two
// channels of a tool share a suffix the group leads.

export const TOOL_NAMES = PERSONA_TOOLS;
export type ToolName = PersonaToolName;

export interface Op {
  tool: ToolName;
  op: string;
  /** The channel whose handler it runs; null for the four operations that have no channel. */
  channel: string | null;
  /** It changes something: it takes a reason (`why`), makes an act, and is recorded. */
  write: boolean;
  args: ArgSpec[];
  /** The arguments that carry text composed for the code host: the footer is added to them. */
  hostText?: string[];
  /** The result holds text that comes from outside the app, and is returned inside the data fence. */
  outside?: true;
}

const op = (tool: ToolName, name: string, channel: string | null, write: boolean, args: string[], more: Partial<Pick<Op, 'hostText' | 'outside'>> = {}): Op => ({ tool, op: name, channel, write, args: args.map(arg), ...more });
const read = (tool: ToolName, name: string, channel: string, args: string[] = [], more: Partial<Pick<Op, 'hostText' | 'outside'>> = {}): Op => op(tool, name, channel, false, args, more);
const act = (tool: ToolName, name: string, channel: string, args: string[] = [], more: Partial<Pick<Op, 'hostText' | 'outside'>> = {}): Op => op(tool, name, channel, true, args, more);

export const OPS: readonly Op[] = [
  // ---- Overview: what the day looks like, and the refreshes of it -------------------------------------------------------------------------------------------------------
  read('Overview', 'cards', 'cards:load', ['limit:i', 'refresh:b', 'squad:s'], { outside: true }),
  read('Overview', 'cycle', 'cycle:view', [], { outside: true }),
  read('Overview', 'historyList', 'history:list'),
  read('Overview', 'historyGet', 'history:get', ['id:s@!'], { outside: true }),
  read('Overview', 'cost', 'custo:summary', ['scope:e[current,all]']),
  read('Overview', 'health', 'saude:get'),
  read('Overview', 'errors', 'errors:get', [], { outside: true }),
  read('Overview', 'errorsSummary', 'errors:summary'),
  read('Overview', 'radar', 'radar:latest', [], { outside: true }),
  read('Overview', 'watchers', 'watchers:list', [], { outside: true }),
  read('Overview', 'audit', 'auditoria:list'),
  read('Overview', 'worktrees', 'worktrees:health'),
  act('Overview', 'dismissWatcher', 'watchers:dismiss', ['id:s@!']),
  act('Overview', 'checkWatchers', 'watchers:check'),
  act('Overview', 'runRadar', 'radar:run'),
  act('Overview', 'checkHealth', 'saude:check'),
  act('Overview', 'refreshCost', 'custo:refresh', ['scope:e[current,all]']),
  act('Overview', 'markErrorsSeen', 'errors:seen'),
  act('Overview', 'clearErrors', 'errors:clear'),
  act('Overview', 'checkStatus', 'status:check'),
  act('Overview', 'exportDay', 'tempo:day', ['date:s']),

  // ---- Runs: the runs of the cycle, their gates and answers -------------------------------------------------------------------------------------------------------------
  read('Runs', 'list', 'runs:list', [], { outside: true }),
  read('Runs', 'get', 'runs:get', ['run:s@!'], { outside: true }),
  read('Runs', 'activities', 'runs:activities'),
  read('Runs', 'artifact', 'runs:artifact', ['run:s@!', 'name:s!'], { outside: true }),
  read('Runs', 'evidenceList', 'runs:evidenceList', ['run:s@!']),
  read('Runs', 'screens', 'runs:screens', ['thread:s']),
  read('Runs', 'unassigned', 'runs:unassigned', [], { outside: true }),
  read('Runs', 'docsStatus', 'docs:status'),
  act('Runs', 'start', 'runs:start', ['ref:s@!', 'repo:s']),
  act('Runs', 'startStage', 'runs:startStage', ['run:s@!']),
  act('Runs', 'startRelease', 'runs:startRelease', ['version:s@!', 'from:s', 'repo:s']),
  act('Runs', 'accept', 'runs:accept', ['run:s@!', 'note:t']),
  act('Runs', 'return', 'runs:return', ['run:s@!', 'note:t!']),
  act('Runs', 'gate', 'runs:gate', ['run:s@!', 'action:e[approve,reject,skip]!', 'reason:t']),
  act('Runs', 'answer', 'runs:answer', ['run:s@!', 'answer:t!', 'attachments:j']),
  act('Runs', 'command', 'runs:command', ['run:s@!', 'command:t!', 'decision:e[once,stage,deny]!', 'note:t']),
  act('Runs', 'retry', 'runs:retry', ['run:s@!']),
  act('Runs', 'retryPr', 'runs:retryPr', ['run:s@!', 'base:s!']),
  act('Runs', 'cancel', 'runs:cancel', ['run:s@!']),
  act('Runs', 'skipWait', 'runs:skipWait', ['run:s@!', 'reason:t!']),
  act('Runs', 'sendBack', 'runs:sendBack', ['run:s@!', 'stage:s!', 'note:t!']),
  act('Runs', 'migrateFlow', 'runs:migrateFlow', ['run:s@!']),
  act('Runs', 'undoPost', 'runs:undoPost', ['run:s@!', 'key:s!']),
  act('Runs', 'setSquad', 'runs:setSquad', ['run:s@!', 'squad:s']),
  act('Runs', 'removeSquad', 'runs:removeSquad', ['squad:s@!', 'confirm:b']),
  act('Runs', 'setSquadAutonomous', 'runs:setSquadAutonomous', ['squad:s@!', 'on:b!']),
  act('Runs', 'setAutonomous', 'runs:setAutonomous', ['agent:s@!', 'on:b!']),
  act('Runs', 'activitySave', 'runs:activitySave', ['ref:s@!', 'body:t!']),
  act('Runs', 'memory', 'runs:memory', ['run:s@!', 'body:t!']),
  act('Runs', 'evidenceDelete', 'runs:evidenceDelete', ['run:s@!', 'evidence:s!']),
  act('Runs', 'callStop', 'runs:callStop', ['thread:s@!', 'agent:s!']),
  act('Runs', 'docsStart', 'docs:start', ['repo:s@!', 'mode:s!', 'apply:b']),

  // ---- Actions: the proposals that wait, and the conflict flow ----------------------------------------------------------------------------------------------------------
  read('Actions', 'list', 'actions:list', [], { outside: true }),
  read('Actions', 'preview', 'actions:preview', ['id:s@!'], { outside: true }),
  read('Actions', 'quickContext', 'gitlabQuick:context', ['card:c@!']),
  read('Actions', 'quickMembers', 'gitlabQuick:members', ['projectPath:s@!']),
  act('Actions', 'approve', 'actions:approve', ['id:s@!']),
  act('Actions', 'skip', 'actions:skip', ['id:s@!']),
  act('Actions', 'detect', 'actions:detect'),
  act('Actions', 'freeBranch', 'actions:freeBranch', ['id:s@!']),
  act('Actions', 'conflictAsk', 'actions:conflict', ['id:s@!', 'question:t!']),
  act('Actions', 'quickPropose', 'gitlabQuick:propose', ['req:j!']),
  act('Actions', 'conflictFromMr', 'conflict:fromMr', ['card:c@!', 'ref:s!']),
  act('Actions', 'conflictPrepare', 'conflict:prepare', ['id:s@!']),
  act('Actions', 'conflictPropose', 'conflict:propose', ['id:s@!']),
  act('Actions', 'conflictChoose', 'conflict:choose', ['id:s@!', 'hunkId:s!', 'choice:e[proposal,ours,theirs,edit]!', 'edited:t']),
  act('Actions', 'conflictApply', 'conflict:apply', ['id:s@!', 'skipTests:b']),
  act('Actions', 'conflictCommit', 'conflict:commit', ['id:s@!']),
  act('Actions', 'conflictReopen', 'conflict:reopen', ['id:s@!']),
  act('Actions', 'conflictDiscard', 'conflict:discard', ['id:s@!']),

  // ---- Board: the workspace's own board ---------------------------------------------------------------------------------------------------------------------------------
  read('Board', 'list', 'board:list', ['refresh:b'], { outside: true }),
  act('Board', 'create', 'board:create', ['title:t!', 'body:t', 'column:s!', 'squad:s', 'priority:s', 'repo:s', 'labels:j'], { hostText: ['body'] }),
  act('Board', 'send', 'board:send', ['id:s@!']),
  act('Board', 'sendAll', 'board:sendAll'),
  act('Board', 'update', 'board:update', ['id:s@', 'project:s', 'iid:i', 'title:t', 'body:t', 'column:s', 'squad:s', 'priority:s', 'labels:j'], { hostText: ['body'] }),
  act('Board', 'comment', 'board:comment', ['id:s@', 'project:s', 'iid:i', 'body:t!'], { hostText: ['body'] }),
  act('Board', 'close', 'board:close', ['id:s@', 'project:s', 'iid:i']),
  act('Board', 'reopen', 'board:reopen', ['id:s@', 'project:s', 'iid:i']),
  op('Board', 'proposePriority', null, true, ['ref:c@!', 'to:s!']),

  // ---- Conversations: the forum --------------------------------------------------------------------------------------------------------------------------------------
  read('Conversations', 'list', 'forum:list', ['squad:s']),
  read('Conversations', 'read', 'forum:read', ['thread:s@!', 'afterSeq:i', 'limit:i'], { outside: true }),
  read('Conversations', 'attachmentGet', 'forum:attachment-get', ['thread:s@!', 'message:i!', 'id:s!'], { outside: true }),
  act('Conversations', 'post', 'forum:post', ['thread:s@!', 'text:t!']),
  act('Conversations', 'create', 'forum:create', ['title:t!']),
  act('Conversations', 'attachmentDelete', 'forum:attachment-delete', ['thread:s@!', 'seq:i!']),
  // The schedules that wake the persona (#275), which post in a conversation.
  read('Conversations', 'schedules', 'schedules:list'),
  // The app's own timed jobs (#250), read-only: they are set in Settings, not here.
  read('Conversations', 'routines', 'schedules:routines'),
  act('Conversations', 'scheduleCreate', 'schedules:create', ['prompt:t', 'action:j', 'missed:e[run,skip]', 'recurrence:j!', 'thread:s', 'workdaysOnly:b', 'paused:b']),
  act('Conversations', 'scheduleUpdate', 'schedules:update', ['schedule:s@!', 'patch:j!']),
  act('Conversations', 'scheduleRemove', 'schedules:remove', ['schedule:s@!']),

  // ---- Memory: the shared memory and the learned procedures ------------------------------------------------------------------------------------------------------------
  read('Memory', 'list', 'memory:list'),
  read('Memory', 'read', 'memory:read', ['conversation:s@!', 'agent:s!', 'id:s!'], { outside: true }),
  read('Memory', 'procedureList', 'procedures:list'),
  read('Memory', 'procedureGet', 'procedures:get', ['id:s@!'], { outside: true }),
  read('Memory', 'procedureStats', 'procedures:stats'),
  read('Memory', 'offers', 'procedures:offers', ['thread:s']),
  act('Memory', 'save', 'memory:save', ['conversation:s@!', 'agent:s!', 'id:s!', 'revision:i!', 'title:t', 'text:t', 'kind:s']),
  act('Memory', 'review', 'memory:review', ['conversation:s@!', 'agent:s!', 'id:s!']),
  act('Memory', 'remove', 'memory:remove', ['conversation:s@!', 'agent:s!', 'id:s!']),
  act('Memory', 'removeFolder', 'memory:remove-folder', ['conversation:s@!', 'agent:s']),
  act('Memory', 'procedureSave', 'procedures:save', ['id:s@!', 'revision:i!', 'input:j!']),
  act('Memory', 'procedureReview', 'procedures:review', ['id:s@!']),
  act('Memory', 'procedureRestore', 'procedures:restore', ['id:s@!', 'revision:i!']),
  act('Memory', 'procedureDelete', 'procedures:delete', ['id:s@!']),
  act('Memory', 'offerKeep', 'procedures:offer-keep', ['offerId:s@!', 'title:t']),
  act('Memory', 'offerDecline', 'procedures:offer-decline', ['offerId:s@!']),

  // ---- Settings: the configuration, the app's settings and the workspaces --------------------------------------------------------------------------------------------------
  read('Settings', 'get', 'config:get', ['path:s@']),
  read('Settings', 'schema', 'config:schema', ['path:s']),
  read('Settings', 'validate', 'config:validate', ['config:j!']),
  read('Settings', 'prompts', 'config:prompts'),
  read('Settings', 'testEnvConfirmations', 'config:testenv-confirmations'),
  read('Settings', 'getApp', 'settings:get', ['path:s@']),
  read('Settings', 'templates', 'cycle:templates'),
  read('Settings', 'templateCheck', 'cycle:template-check', ['text:t!']),
  read('Settings', 'verifyGet', 'conflicts:verify-get'),
  read('Settings', 'glossary', 'glossary:get'),
  read('Settings', 'retentionPreview', 'retention:preview', ['days:i!']),
  read('Settings', 'workspaces', 'workspace:list'),
  read('Settings', 'sandboxStatus', 'sandbox:status'),
  read('Settings', 'suggestions', 'suggestions:list'),
  act('Settings', 'set', 'config:save', ['path:s@!', 'value:j', 'mode:e[set,append,remove]']),
  act('Settings', 'promptSet', 'config:prompt-set', ['id:s@!', 'language:e[pt-BR,en]!', 'text:t']),
  act('Settings', 'setApp', 'settings:save', ['path:s@!', 'value:j', 'mode:e[set,append,remove]']),
  act('Settings', 'applyCycle', 'cycle:apply', ['id:s@!', 'options:j']),
  act('Settings', 'templateSave', 'cycle:template-save', ['text:t!']),
  act('Settings', 'templateRemove', 'cycle:template-remove', ['id:s@!']),
  act('Settings', 'templateExport', 'cycle:template-export', ['meta:j!']),
  act('Settings', 'agentsApply', 'agents:apply', ['docs:j!']),
  act('Settings', 'createWorkspace', 'workspace:create', ['name:s@!', 'copySettings:b']),
  act('Settings', 'renameWorkspace', 'workspace:rename', ['id:s@!', 'name:s!']),
  act('Settings', 'verifySet', 'conflicts:verify-set', ['commands:j!']),
  act('Settings', 'costGoal', 'custo:goal', ['goal:n!', 'scope:e[current,all]']),
  act('Settings', 'glossarySave', 'glossary:save', ['terms:j!']),
  act('Settings', 'glossaryLearn', 'glossary:learn', ['heard:s!', 'term:s!']),
  act('Settings', 'retentionApply', 'retention:apply', ['days:i!', 'fingerprint:s!']),
  act('Settings', 'suggest', 'suggestions:suggest'),
  act('Settings', 'rejectSuggestion', 'suggestions:reject', ['suggestionId:s@!', 'reason:t']),
  act('Settings', 'suggestionEdited', 'suggestions:edited', ['suggestionId:s@!', 'agentId:s!']),

  // ---- Secrets: names and sources, and (through the door alone) a value ---------------------------------------------------------------------------------------------------
  read('Secrets', 'check', 'config:secret-check', ['ref:s@!']),
  op('Secrets', 'list', null, false, []),
  op('Secrets', 'read', null, true, ['ref:s@!']),
  act('Secrets', 'set', 'config:secret-set', ['ref:s@!', 'source:e[stored,command,env]!', 'value:t*', 'command:s', 'args:j', 'name:s']),
  act('Secrets', 'remove', 'config:secret-remove', ['ref:s@!']),
  act('Secrets', 'acceptInsecure', 'config:secrets-accept-insecure'),

  // ---- Plugins: the decisions about them ------------------------------------------------------------------------------------------------------------------------------
  read('Plugins', 'list', 'plugins:list', [], { outside: true }),
  act('Plugins', 'answer', 'plugins:answer', ['id:s@!', 'answer:e[once,session,always,refuse]!']),
  act('Plugins', 'revoke', 'plugins:revoke', ['id:s@!', 'need:e[network,write]!']),
  act('Plugins', 'revokeWrite', 'plugins:revoke-write', ['actionId:s@!']),
  act('Plugins', 'setEnabled', 'plugins:set-enabled', ['id:s@!', 'enabled:b!']),
  act('Plugins', 'settings', 'plugins:settings', ['dir:s!', 'confirmSeconds:i!']),
  act('Plugins', 'setSetting', 'plugins:set-setting', ['id:s@!', 'key:s!', 'value:t']),
  act('Plugins', 'setSecret', 'plugins:set-secret', ['id:s@!', 'key:s!', 'value:t*']),

  // ---- Asks: everything that waits for the person ----------------------------------------------------------------------------------------------------------------------
  read('Asks', 'turnAsks', 'turnAsks:list'),
  read('Asks', 'ceremonyCommands', 'ceremony:commands'),
  op('Asks', 'list', null, false, [], { outside: true }),
  act('Asks', 'screenAnswer', 'runs:screenAnswer', ['askId:s@!', 'decision:e[yes,no,site]!', 'note:t']),
  act('Asks', 'handoffDecline', 'runs:handoffDecline', ['askId:s@!']),
  act('Asks', 'screenClose', 'runs:screenClose', ['key:s@!']),
  act('Asks', 'turnAnswer', 'turnAsks:answer', ['id:s@!', 'choice:e[continue,finish]!']),
  act('Asks', 'ceremonyCommand', 'ceremony:command', ['id:s@!', 'verdict:e[once,always,deny]!', 'note:t']),

  // ---- Ceremonies: the ceremonies' main-side channels ------------------------------------------------------------------------------------------------------------------
  read('Ceremonies', 'gateOptions', 'gate:options', ['card:c@!']),
  read('Ceremonies', 'gateGet', 'gate:get', ['id:s@!'], { outside: true }),
  read('Ceremonies', 'qaGet', 'qa:get', ['iid:s@!'], { outside: true }),
  read('Ceremonies', 'retroLatest', 'retro:latest', ['squad:s'], { outside: true }),
  read('Ceremonies', 'reentryGet', 'feedback:reentry:get', ['iid:s@!'], { outside: true }),
  read('Ceremonies', 'discussionsList', 'feedback:discussions:list', ['mr:j!'], { outside: true }),
  read('Ceremonies', 'minutesDay', 'minutes:day', ['date:s@!']),
  read('Ceremonies', 'minutesTrash', 'minutes:trash'),
  read('Ceremonies', 'minutesDeletePreview', 'minutes:delete-preview', ['date:s@!', 'which:j!']),
  read('Ceremonies', 'agenda', 'sameday:agenda', ['refs:j!', 'ceremonyId:s']),
  read('Ceremonies', 'effectsStatus', 'efeitos:status'),
  read('Ceremonies', 'teamsText', 'ata:teams', ['minutes:j!', 'refs:j!']),
  act('Ceremonies', 'gateStart', 'gate:start', ['card:c@!', 'gate:i!']),
  act('Ceremonies', 'gateAnswer', 'gate:answer', ['id:s@!', 'q:i!', 'choice:i', 'text:t']),
  act('Ceremonies', 'gateExplain', 'gate:explain', ['id:s@!', 'question:t!']),
  act('Ceremonies', 'gateVisual', 'gate:visual', ['id:s@!']),
  act('Ceremonies', 'gateInsert', 'gate:insert', ['id:s@!']),
  act('Ceremonies', 'gateRound', 'gate:round', ['id:s@!']),
  act('Ceremonies', 'gateRecord', 'gate:record', ['id:s@!']),
  act('Ceremonies', 'qaPrepare', 'qa:prepare', ['card:c@!']),
  act('Ceremonies', 'qaAsk', 'qa:ask', ['iid:s@!', 'question:t!']),
  act('Ceremonies', 'qaWrite', 'qa:write', ['iid:s@!']),
  act('Ceremonies', 'retroPrepare', 'retro:prepare', ['squad:s']),
  act('Ceremonies', 'retroAsk', 'retro:ask', ['id:s@!', 'question:t!']),
  act('Ceremonies', 'deepAsk', 'deep:ask', ['card:c@!', 'question:t!', 'sessionId:s']),
  act('Ceremonies', 'deepOptions', 'deep:options', ['card:c@!', 'sessionId:s!']),
  act('Ceremonies', 'reentryPrepare', 'feedback:reentry:prepare', ['card:c@!']),
  act('Ceremonies', 'reentryAsk', 'feedback:reentry:ask', ['iid:s@!', 'question:t!']),
  act('Ceremonies', 'discussionsExplain', 'feedback:discussions:explain', ['card:c@!', 'mr:j!', 'discussion:s!']),
  act('Ceremonies', 'discussionsReply', 'feedback:discussions:reply', ['card:c@!', 'mr:j!', 'discussion:s!', 'body:t!'], { hostText: ['body'] }),
  act('Ceremonies', 'discussionsResolve', 'feedback:discussions:resolve', ['card:c@!', 'mr:j!', 'discussion:s!']),
  act('Ceremonies', 'saveMinutes', 'ata:save', ['minutes:j!', 'teams:t!', 'selected:j!', 'ceremonyId:s']),
  act('Ceremonies', 'minutesDayTeams', 'minutes:day-teams', ['date:s@!', 'key:s!', 'text:t!']),
  act('Ceremonies', 'minutesDelete', 'minutes:delete', ['date:s@!', 'which:j!']),
  act('Ceremonies', 'minutesRestore', 'minutes:restore', ['id:s@!']),
  act('Ceremonies', 'minutesVersionTeams', 'minutes:version-teams', ['date:s@!', 'n:i!', 'text:t!']),
  act('Ceremonies', 'effectsMark', 'efeitos:mark', ['effect:j!', 'ceremonyId:s', 'done:b!']),
  act('Ceremonies', 'effectsCheck', 'efeitos:check'),
];

/** The operations that have no channel: the door runs them itself. */
export const DOOR_ONLY = ['Secrets.read', 'Secrets.list', 'Board.proposePriority', 'Asks.list'] as const;

export const keyOf = (o: Pick<Op, 'tool' | 'op'>): string => `${o.tool}.${o.op}`;

// ---- what the persona's door never reaches --------------------------------------------------------------------------------------------------------------------------------

/** Why a channel is not an operation: the code is in this table and the sentence is what a failing test says. */
export const EXCLUSION_REASONS = {
  window: "the window's own plumbing: the pre-daily's turn is the renderer's, the clipboard, the tray, the saved state of the screens",
  machine: "it reads or changes the computer rather than the app: the projects folders it scans, the state server, the probes of the host and the sandbox, the machine's Claude Code sessions",
  update: "the app's install: an update is the person's, on their computer",
  voice: "voice and its installs: the person talks to the persona through the chat's microphone, and the persona never records, speaks or installs on its own",
  wizard: "setup, native dialogs and a screen's guided flow: a person's hands on the app's own windows",
  screen: "the person's hands on an agent's screen: what they type there never goes through an agent",
  bytes: 'a picture or a file whose bytes a tool call cannot carry',
  pairing: 'devices, their passkeys and push: pairing and unpairing a device and registering a passkey for it is the person, and a push subscription belongs to the device',
  workspace: 'the switch of workspace and its deletion: the persona works in the workspace it is in',
  guard: "the test workspace's flag and the confirmations of the test environment's secrets: the guard that lets an agent be tried without writing anywhere",
  scope: "the phone's scoped save: the persona's configuration changes go through the whole-document save, with its own audit",
  own: "the persona's own wizard, editor, clear, delete and stop: the stop is the person's control of the persona, and one the controlled party could release is not a control",
  budget: "the operating budget (#198): its limits are the person's, and the party that spends is not the one that sets what it may spend; the figures are on the Settings screen",
  autonomy: "autonomy per kind of external effect (#199): the person grants and takes it back, and an agent that could grant itself would have none of the control it stands for; the figures are on the Settings screen",
  effects: "asking before an external effect and recording its cost (#199): a purchase or a destroy is asked by a client of the admin socket and allowed by the person or a grant; an agent that could ask for and settle its own would be its own gate",
  accounts: "the registry of external accounts (#200): the person opens an account and says which credentials it uses; an agent that could list itself a provider would have the registry's rule for nothing",
  scheduler: "the scheduler's switch: letting schedules wake the persona unattended is the person's yes, asked when the app opens",
} as const;
export type ExclusionReason = keyof typeof EXCLUSION_REASONS;

const group = (reason: ExclusionReason, channels: string[]): [string, ExclusionReason][] => channels.map((c) => [c, reason]);

export const EXCLUDED: Readonly<Record<string, ExclusionReason>> = Object.fromEntries([
  ...group('window', ['agent:activity:get', 'agent:prepare', 'agent:reply', 'autostart:get', 'autostart:set', 'clipboard:copy', 'claude:continue', 'claude:command', 'jobs:notify', 'log:renderer', 'state:load', 'state:save', 'diagram:fix', 'glossary:hear', 'persona:live-read']),
  // The client's version handshake (#207): plumbing between a client and the instance, with nothing for a tool to do.
  ...group('window', ['contract:hello']),
  // The discussions screen a button opened by project and number: its read is the screen's (the persona reads threads through VcsRead), and the line it leaves records the person's
  // tap, which the persona must never be able to write for them.
  ...group('window', ['feedback:discussions:open', 'feedback:discussions:opened']),
  ...group('machine', ['agents:scan', 'agents:propose', 'agents:summarize', 'agents:can-summarize', 'mcpstate:get', 'mcpstate:set-enabled', 'mcpstate:set-act', 'mcpstate:write-entry', 'vcs:probe', 'sandbox:probe', 'move:export', 'adminDoor:get', 'adminDoor:set']),
  // The machine's Claude Code sessions (#280): only the person sends to them, answers their permission requests, stops or starts one.
  ...group('machine', ['claudeSessions:enabled', 'claudeSessions:set-enabled', 'claudeSessions:list', 'claudeSessions:read', 'claudeSessions:follow', 'claudeSessions:folders', 'claudeSessions:send', 'claudeSessions:asks', 'claudeSessions:answer', 'claudeSessions:stop', 'claudeSessions:end', 'claudeSessions:start']),
  ...group('budget', ['budget:get', 'budget:ledger', 'budget:set']),
  ...group('accounts', ['accounts:add', 'accounts:assert', 'accounts:export', 'accounts:list', 'accounts:remove', 'accounts:update']),
  ...group('effects', ['effects:request', 'effects:settle']),
  ...group('autonomy', ['autonomy:grant', 'autonomy:incident', 'autonomy:mark-reverted', 'autonomy:revoke', 'autonomy:status']),
  // Who owns the workspace and handing it over (#209): the person's, from the window or the admin door; the persona neither hands the workspace over nor takes it.
  ...group('machine', ['ownership:claim', 'ownership:move-out', 'ownership:release', 'ownership:status']),
  ...group('update', ['update:busy', 'update:check', 'update:flushed', 'update:info', 'update:install', 'update:run', 'update:seen', 'update:settings-save', 'update:status']),
  ...group('voice', ['voice:cancel', 'voice:check', 'voice:enable', 'voice:install', 'voice:install-cancel', 'voice:list', 'voice:plan', 'voice:segment', 'voice:status', 'voice:test', 'voice:transcribe', 'voice:uninstall']),
  ...group('wizard', [
    'wizard:availability', 'wizard:cycle-templates', 'wizard:docs-scan', 'wizard:paths-exist', 'wizard:pick-folder', 'wizard:progress-clear', 'wizard:progress-get', 'wizard:progress-set', 'wizard:provider-test', 'wizard:scan-projects', 'wizard:sdk-cancel', 'wizard:sdk-install', 'wizard:sdk-status', 'wizard:vcs-test', 'wizard:voice-run',
    'config:export', 'config:import-pick', 'config:import-preview', 'config:import-apply', 'cycle:template-pick',
    'agentAssist:round', 'agentAssist:review', 'agentAssist:saveDraft', 'agentAssist:conclude', 'agentAssist:discard',
  ]),
  ...group('screen', ['screen:control', 'screen:handoffFrame', 'screen:handoffGive', 'screen:handoffTake', 'screen:input', 'screen:revoke', 'screen:sites']),
  ...group('bytes', ['forum:attachment-put', 'forum:attachment-post', 'forum:attachment-drop', 'runs:evidence', 'runs:screen']),
  ...group('pairing', ['web:configure', 'web:pair', 'web:rename', 'web:revoke', 'web:unpair', 'web:view', 'push:key', 'push:status', 'push:subscribe', 'push:test', 'push:unsubscribe', 'passkey:register-options', 'passkey:register', 'passkey:assert-options', 'passkey:assert', 'passkey:list', 'passkey:remove', 'passkey:enroll-allow']),
  ...group('workspace', ['workspace:switch', 'workspace:delete']),
  ...group('guard', ['workspace:test', 'config:testenv-confirm', 'config:testenv-revoke']),
  ...group('scope', ['config:cycle-save']),
  ...group('scheduler', ['schedules:setEnabled']),
  ...group('own', ['persona:round', 'persona:review', 'persona:saveDraft', 'persona:conclude', 'persona:discard', 'persona:finish', 'persona:save', 'persona:clear', 'persona:delete', 'persona:stop', 'persona:resume', 'persona:state']),
]);

export const opsOf = (tool: ToolName): Op[] => OPS.filter((o) => o.tool === tool);
export const findOp = (tool: string, name: string): Op | undefined => OPS.find((o) => o.tool === tool && o.op === name);
export const isTool = (v: string): v is ToolName => (TOOL_NAMES as readonly string[]).includes(v);
