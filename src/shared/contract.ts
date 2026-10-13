import type { API_CHANNELS } from './apiChannels';
import { API_CHANNELS as API_TABLE } from './apiChannels';
import { t } from './i18n';
import type { Api } from './types';

// The contract every client speaks to a Coxia instance (#207): the desktop window over IPC, a paired browser over the HTTP RPC, and any client that comes after. It is the one
// list of channels, the shape of what a channel answers when it fails, and the version both sides exchange before a call. What a given caller may do is not here: the
// instance decides it (src/main/webPolicy.ts). Nothing in this file reaches the main process, so a client can import it.

/** Bumped when a channel changes in a way an older client cannot follow: a removed or renamed channel, a different shape of an input or an output, a new error code a client must handle. */
export const CONTRACT_VERSION = 1;

/** The header a browser sends with every call so the instance can refuse a page that outlived an update. */
export const CONTRACT_HEADER = 'x-coxia-contract';

/** The handshake: a client says its version, the instance answers its own or refuses. */
export const HELLO_CHANNEL = 'contract:hello';

/** The channels the desktop shell registers itself (they act on the window's machine); every other channel is registered by the core. */
export const DESKTOP_CHANNELS = ['clipboard:copy', 'jobs:notify', 'instances:accept-insecure', 'instances:add', 'instances:list', 'instances:remove', 'instances:select', 'instances:test', 'instances:trust'] as const;

/** Every channel of the contract. A test fails when the instance registers one that is not here, or this names one nobody registers. */
export const CHANNELS = [
  // actions
  'actions:approve', 'actions:conflict', 'actions:detect', 'actions:freeBranch', 'actions:list', 'actions:preview', 'actions:skip',
  // agent
  'agent:activity:get', 'agent:prepare', 'agent:reply',
  // agentAssist
  'agentAssist:conclude', 'agentAssist:discard', 'agentAssist:review', 'agentAssist:round', 'agentAssist:saveDraft',
  // agents
  'agents:apply', 'agents:can-summarize', 'agents:propose', 'agents:scan', 'agents:summarize',
  // ata
  'ata:save', 'ata:teams',
  // auditoria
  'auditoria:list',
  // autostart
  'autostart:get', 'autostart:set',
  // board
  'board:close', 'board:comment', 'board:create', 'board:list', 'board:reopen', 'board:send', 'board:sendAll', 'board:update',
  // budget
  'budget:get', 'budget:ledger', 'budget:set',
  // cards
  'cards:load',
  // ceremony
  'ceremony:command', 'ceremony:commands',
  // claude
  'claude:command', 'claude:continue',
  // claudeSessions
  'claudeSessions:answer', 'claudeSessions:asks', 'claudeSessions:enabled', 'claudeSessions:end', 'claudeSessions:folders', 'claudeSessions:follow', 'claudeSessions:list', 'claudeSessions:read', 'claudeSessions:send', 'claudeSessions:set-enabled', 'claudeSessions:start', 'claudeSessions:stop',
  // clipboard
  'clipboard:copy',
  // config
  'config:cycle-save', 'config:export', 'config:get', 'config:import-apply', 'config:import-pick', 'config:import-preview', 'config:prompt-set', 'config:prompts', 'config:save', 'config:schema', 'config:secret-check', 'config:secret-remove', 'config:secret-set', 'config:secrets-accept-insecure', 'config:testenv-confirm', 'config:testenv-confirmations', 'config:testenv-revoke', 'config:validate',
  // conflict
  'conflict:apply', 'conflict:choose', 'conflict:commit', 'conflict:discard', 'conflict:fromMr', 'conflict:prepare', 'conflict:propose', 'conflict:reopen',
  // conflicts
  'conflicts:verify-get', 'conflicts:verify-set',
  // contract
  'contract:hello',
  // custo
  'custo:goal', 'custo:refresh', 'custo:summary',
  // cycle
  'cycle:apply', 'cycle:template-check', 'cycle:template-export', 'cycle:template-pick', 'cycle:template-remove', 'cycle:template-save', 'cycle:templates', 'cycle:view',
  // deep
  'deep:ask', 'deep:options',
  // diagram
  'diagram:fix',
  // docs
  'docs:start', 'docs:status',
  // efeitos
  'efeitos:check', 'efeitos:mark', 'efeitos:status',
  // errors
  'errors:clear', 'errors:get', 'errors:seen', 'errors:summary',
  // feedback
  'feedback:discussions:explain', 'feedback:discussions:list', 'feedback:discussions:open', 'feedback:discussions:opened', 'feedback:discussions:reply', 'feedback:discussions:resolve', 'feedback:reentry:ask', 'feedback:reentry:get', 'feedback:reentry:prepare',
  // forum
  'forum:attachment-delete', 'forum:attachment-drop', 'forum:attachment-get', 'forum:attachment-post', 'forum:attachment-put', 'forum:create', 'forum:list', 'forum:post', 'forum:read',
  // gate
  'gate:answer', 'gate:explain', 'gate:get', 'gate:insert', 'gate:options', 'gate:record', 'gate:round', 'gate:start', 'gate:visual',
  // gitlabQuick
  'gitlabQuick:context', 'gitlabQuick:members', 'gitlabQuick:propose',
  // glossary
  'glossary:get', 'glossary:hear', 'glossary:learn', 'glossary:save',
  // history
  'history:get', 'history:list',
  // instances
  'instances:accept-insecure', 'instances:add', 'instances:list', 'instances:remove', 'instances:select', 'instances:test', 'instances:trust',
  // jobs
  'jobs:notify',
  // log
  'log:renderer',
  // mcpstate
  'mcpstate:get', 'mcpstate:set-act', 'mcpstate:set-enabled', 'mcpstate:write-entry',
  // memory
  'memory:list', 'memory:read', 'memory:remove', 'memory:remove-folder', 'memory:review', 'memory:save',
  // minutes
  'minutes:day', 'minutes:day-teams', 'minutes:delete', 'minutes:delete-preview', 'minutes:restore', 'minutes:trash', 'minutes:version-teams',
  // passkey
  'passkey:assert', 'passkey:assert-options', 'passkey:enroll-allow', 'passkey:list', 'passkey:register', 'passkey:register-options', 'passkey:remove',
  // ownership
  'ownership:claim', 'ownership:release', 'ownership:status',
  // persona
  'persona:clear', 'persona:conclude', 'persona:delete', 'persona:discard', 'persona:finish', 'persona:live-read', 'persona:resume', 'persona:review', 'persona:round', 'persona:save', 'persona:saveDraft', 'persona:state', 'persona:stop',
  // plugins
  'plugins:answer', 'plugins:list', 'plugins:revoke', 'plugins:revoke-write', 'plugins:set-enabled', 'plugins:set-secret', 'plugins:set-setting', 'plugins:settings',
  // procedures
  'procedures:delete', 'procedures:get', 'procedures:list', 'procedures:offer-decline', 'procedures:offer-keep', 'procedures:offers', 'procedures:restore', 'procedures:review', 'procedures:save', 'procedures:stats',
  // push
  'push:key', 'push:status', 'push:subscribe', 'push:test', 'push:unsubscribe',
  // qa
  'qa:ask', 'qa:get', 'qa:prepare', 'qa:write',
  // radar
  'radar:latest', 'radar:run',
  // retention
  'retention:apply', 'retention:preview',
  // retro
  'retro:ask', 'retro:latest', 'retro:prepare',
  // runs
  'runs:accept', 'runs:activities', 'runs:activitySave', 'runs:answer', 'runs:artifact', 'runs:callStop', 'runs:cancel', 'runs:command', 'runs:evidence', 'runs:evidenceDelete', 'runs:evidenceList', 'runs:gate', 'runs:get', 'runs:handoffDecline', 'runs:list', 'runs:memory', 'runs:migrateFlow', 'runs:removeSquad', 'runs:retry', 'runs:retryPr', 'runs:return', 'runs:screen', 'runs:screenAnswer', 'runs:screenClose', 'runs:screens', 'runs:sendBack', 'runs:setAutonomous', 'runs:setSquad', 'runs:setSquadAutonomous', 'runs:skipWait', 'runs:start', 'runs:startRelease', 'runs:startStage', 'runs:unassigned', 'runs:undoPost',
  // sameday
  'sameday:agenda',
  // sandbox
  'sandbox:probe', 'sandbox:status',
  // saude
  'saude:check', 'saude:get',
  // schedules
  'schedules:create', 'schedules:list', 'schedules:remove', 'schedules:routines', 'schedules:setEnabled', 'schedules:update',
  // screen
  'screen:control', 'screen:handoffFrame', 'screen:handoffGive', 'screen:handoffTake', 'screen:input', 'screen:revoke', 'screen:sites',
  // settings
  'settings:get', 'settings:save',
  // state
  'state:load', 'state:save',
  // status
  'status:check',
  // suggestions
  'suggestions:edited', 'suggestions:list', 'suggestions:reject', 'suggestions:suggest',
  // tempo
  'tempo:day',
  // turnAsks
  'turnAsks:answer', 'turnAsks:list',
  // update
  'update:busy', 'update:check', 'update:flushed', 'update:info', 'update:install', 'update:run', 'update:seen', 'update:settings-save', 'update:status',
  // vcs
  'vcs:probe',
  // voice
  'voice:cancel', 'voice:check', 'voice:enable', 'voice:install', 'voice:install-cancel', 'voice:list', 'voice:plan', 'voice:segment', 'voice:status', 'voice:test', 'voice:transcribe', 'voice:uninstall',
  // watchers
  'watchers:check', 'watchers:dismiss', 'watchers:list',
  // web
  'web:configure', 'web:pair', 'web:rename', 'web:revoke', 'web:unpair', 'web:view',
  // wizard
  'wizard:availability', 'wizard:cycle-templates', 'wizard:docs-scan', 'wizard:paths-exist', 'wizard:pick-folder', 'wizard:progress-clear', 'wizard:progress-get', 'wizard:progress-set', 'wizard:provider-test', 'wizard:scan-projects', 'wizard:sdk-cancel', 'wizard:sdk-install', 'wizard:sdk-status', 'wizard:vcs-test', 'wizard:voice-run',
  // workspace
  'workspace:create', 'workspace:delete', 'workspace:list', 'workspace:rename', 'workspace:switch', 'workspace:test',
  // worktrees
  'worktrees:health',
] as const;

export type Channel = (typeof CHANNELS)[number];

// The channels the typed API methods already name carry their input and output from the `Api` interface; the others are listed with `unknown` until each is typed.
type MethodShape<F> = F extends (...args: infer A) => infer R ? { input: A; output: Awaited<R> } : never;
type Typed = {
  [M in keyof typeof API_CHANNELS as (typeof API_CHANNELS)[M]]: M extends keyof Api ? MethodShape<Api[M]> : never;
} & { [HELLO_CHANNEL]: { input: [clientVersion: number]; output: Hello } };
type Untyped = { input: unknown[]; output: unknown };

export type Contract = { [C in Channel]: C extends keyof Typed ? Typed[C] : Untyped };
export type Input<C extends Channel> = Contract[C]['input'];
export type Output<C extends Channel> = Contract[C]['output'];

export interface Hello {
  version: number;
}

/** The channels whose input and output are typed, from the API methods that name them and the handshake. */
export const TYPED_CHANNELS: readonly string[] = [...Object.values(API_TABLE), HELLO_CHANNEL];

const KNOWN = new Set<string>(CHANNELS);
export const inContract = (channel: string): channel is Channel => KNOWN.has(channel);

// Error codes. A channel that fails answers { code, message }: the code is for the program, the message is translated text for the person. The list is closed:
// a code outside it never leaves the instance (it becomes 'internal'). The domain codes are written with their domain in front, so two domains may use one word.
const GENERIC = ['internal', 'invalid-input', 'not-found', 'forbidden', 'unauthorized', 'rate-limited', 'conflict', 'unknown-channel', 'browser-only', 'contract-mismatch', 'host-unavailable', 'voice-off', 'passkey-required', 'budget-exceeded', 'not-owner', 'connection-lost'] as const;
export const DOMAIN_CODES = {
  sandbox: ['unavailable', 'no-node', 'copy-too-big', 'path-missing', 'path-refused', 'start-failed', 'hostile-link', 'copy-failed', 'git-untrusted'],
  runner: ['bad-version', 'no-release-flow', 'no-docs-flow', 'bad-docs-mode', 'nothing-to-undo', 'not-agent-flow', 'bad-ref', 'no-issue-project', 'issue-closed', 'repo-ambiguous', 'no-clone', 'no-identity', 'unknown-agent', 'bad-action', 'branch-exists', 'dest-exists', 'not-worktree', 'no-sandbox', 'no-command', 'no-host', 'worktree-gone', 'memory-busy', 'docs-folder-unsafe'],
  run: ['no-flow', 'no-agent', 'wrong-state', 'empty-reason', 'empty-text', 'duplicate', 'unknown-stage', 'not-active', 'unknown-run', 'newer-version', 'invalid', 'unknown-comment', 'unknown-evidence', 'invalid-flow', 'flow-mismatch', 'not-waiting', 'unknown-squad', 'not-routing', 'unknown-link'],
  forum: ['bad-thread', 'unknown-thread', 'empty', 'too-long', 'bad-title', 'bad-author'],
  schedule: ['prompt', 'recurrence', 'interval', 'time', 'days', 'past', 'persona', 'thread', 'action', 'agent', 'ceremony', 'ref', 'missed', 'notFound', 'tooMany', 'fromSchedule'],
  vcs: ['not_configured', 'no_token', 'auth', 'forbidden', 'not_found', 'rate_limited', 'network', 'timeout', 'server', 'invalid', 'unsupported', 'cli_missing', 'upload_needs_api'],
  secret: ['invalid', 'missing', 'unavailable', 'insecure-refused', 'command-failed'],
  worktree: ['branch-exists', 'dest-exists', 'not-worktree'],
  engine: ['auth', 'forbidden', 'budget', 'not_found', 'rate_limit', 'quota', 'context', 'no_tools', 'bad_request', 'server', 'overloaded', 'timeout', 'network', 'aborted', 'invalid_response'],
} as const;

type Domain = keyof typeof DOMAIN_CODES;
export type ErrorCode = (typeof GENERIC)[number] | { [D in Domain]: `${D}:${(typeof DOMAIN_CODES)[D][number]}` }[Domain];

export const ERROR_CODES: readonly ErrorCode[] = [...GENERIC, ...(Object.keys(DOMAIN_CODES) as Domain[]).flatMap((d) => DOMAIN_CODES[d].map((c) => `${d}:${c}` as ErrorCode))];
const CLOSED = new Set<string>(ERROR_CODES);
export const isErrorCode = (code: unknown): code is ErrorCode => typeof code === 'string' && CLOSED.has(code);

/** What a failed call answers on every transport. */
export interface WireError {
  code: ErrorCode;
  message: string;
}

/** What a call settles to on a transport that cannot carry a thrown error's fields (Electron's IPC keeps only the message). */
export type Settled = { ok: true; value: unknown } | { ok: false; error: WireError };

/** A failure with a code of the closed list; its message is the translated text, unchanged from what the person saw before codes existed. */
export class ContractError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ContractError';
  }
}

/** The refusal of a client and an instance that speak different versions. The message names both, so whoever reads it knows which side to update. */
export const contractMismatch = (client: number | string, instance: number): ContractError => new ContractError('contract-mismatch', t('main.contract.mismatch', { client, instance }));

// The classes the core throws on purpose, told apart by the name they set. A name and not instanceof: the contract is shared code and cannot import the modules that define them.
const BY_NAME: Record<string, Domain> = { SandboxError: 'sandbox', RunnerError: 'runner', RunError: 'run', ForumError: 'forum', ScheduleError: 'schedule', VcsError: 'vcs', SecretError: 'secret', WorktreeError: 'worktree' };

/** The code of a failure: the one its class carries when that is in the closed list, 'internal' for anything else. */
export function errorCodeOf(e: unknown): ErrorCode {
  if (!(e instanceof Error)) return 'internal';
  const { name } = e;
  const own = (e as { code?: unknown }).code;
  const kind = (e as { kind?: unknown }).kind;
  const candidate = name === 'EngineError' || name === 'StructuredOutputError' ? `engine:${String(kind)}` : name in BY_NAME ? `${BY_NAME[name]}:${String(own)}` : String(own);
  return isErrorCode(candidate) ? candidate : 'internal';
}

/** A failure as every transport carries it. */
export const wireErrorOf = (e: unknown): WireError => ({ code: errorCodeOf(e), message: e instanceof Error ? e.message : String(e) });
