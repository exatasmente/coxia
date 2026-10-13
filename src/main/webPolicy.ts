import { HELLO_CHANNEL } from '../shared/contract';
import { t } from '../shared/i18n';
// What a browser session may call. The desktop window has no such limits (IPC does not go through here).
export type WebAccess = 'allow' | 'deny' | 'external';

// Acts on the desktop machine itself: terminal, clipboard, login items, local file deletion, native notifications,
// the shell commands that conflict resolutions run (a browser must not be able to set what Aplicar executes),
// the workspace test flag and deletion (a browser may create, rename and switch workspaces, not lower the guard),
// and the app update: it rebuilds or downloads and replaces the installed app, then quits it, so every update:* channel is listed
// (test/updates-policy.test.ts checks that no update channel is missing), and the VCS probe (it takes a token typed in the setup
// screen: a token never travels through the browser channel), and the decisions about a plugin: switching one and taking a permission back are the
// person's on the computer (spec rule 10). Answering a request is open here only for what a call from a conversation opened (the requests of a run's own
// events are refused whatever the channel says); blocking an announced write is actions:skip, which only takes away.
// Freeing a release branch held by another worktree (actions:freeBranch) switches that folder's checkout on this machine, so it stays here too.
export const DESKTOP_ONLY = new Set(['claude:continue', 'clipboard:copy', 'autostart:set', 'retention:apply', 'jobs:notify', 'conflicts:verify-set', 'workspace:test', 'workspace:delete', 'update:info', 'update:run', 'update:seen', 'update:flushed', 'update:status', 'update:check', 'update:settings-save', 'update:install', 'update:busy', 'vcs:probe', 'sandbox:probe', 'suggestions:suggest', 'suggestions:reject', 'suggestions:edited', 'plugins:set-enabled', 'plugins:settings', 'plugins:set-setting', 'plugins:set-secret', 'plugins:revoke', 'plugins:revoke-write', 'actions:freeBranch']);

// The voice setup installs software, deletes files and starts processes: only the window. voice:status is a read and stays open.
const VOICE_ADMIN = /^voice:(check|install|install-cancel|test|uninstall|enable)$/;

// Writes to GitLab or pushes branches. actions:approve is the only door: every proposal (gitlabQuick, feedback,
// the release sync) waits there, so refusing it refuses all of them. runs:command lets an agent set to `shell: host` run a command on this
// computer, outside any sandbox: allowing one from a phone is as far-reaching as approving a proposal, so it sits behind the same switch. runs:startRelease
// starts a run that ends in the repository's own scripts and merged code, run as the person: the same switch decides whether a phone may start one (each push
// of the release still waits for its own "yes" in actions:approve). runs:screenAnswer answers a step the app's browser holds before an irreversible act (a submit, a delete,
// a payment) or a confirmation an agent asked for: a yes lets that step happen on a site, so a phone gives it only with the same switch.
export const EXTERNAL_EFFECT = new Set(['actions:approve', 'runs:command', 'runs:startRelease', 'runs:screenAnswer', 'runs:retryPr']);

// forum:* (list, read, post, create, the four attachment channels — attachment-put, attachment-post, attachment-drop, attachment-get — and attachment-delete,
// which removes one message of the conversation and the files it carried) read and write the workspace's own thread files and its own attachment folder, and
// nothing else, so a paired browser may use them: the phone is where a person answers a question and attaches a screenshot. A mention calls on an agent that
// never writes to the run (its commands run over a copy, an issue it proposes waits in
// actions:approve), and a post is never mirrored to the code host by itself. An `@agent` calls that agent wherever a person may post, not only in a run's
// thread: that is the mention rule, and it changes no channel of this policy. test/forum-policy.test.ts pins that none of them is desktop-only or an external effect.

// board:* (list, create, send, sendAll, update, comment, close, reopen) read and write the workspace's own board file and, through the board's door
// (boardHost.ts), the code host: a paired browser may use them (the phone is where a card is answered as much as a question). The door is the one way out: with
// the board's autonomy off (the default) every host write is a proposal that waits in actions:approve, and with it on the write goes straight through, audited,
// which only the computer can switch on (runner.autonomy is not editable from a browser). sendAll makes at most 50 issues in one call. The guard inside each
// handler is what refuses a test workspace. test/board-policy.test.ts pins the list.

// runs:* are all open to a paired browser, except runs:startRelease and runs:command (above, behind the external-effects switch), and runs:retryPr: it opens the
// pull request itself through the audited direct path, a write to the code host like the one it retries, so a paired browser does it only when its external
// effects are on — the reads and the moves alike (start, startStage, accept, return, gate, answer, retry, cancel, skipWait, sendBack, migrateFlow,
// undoPost, setSquad, removeSquad, setSquadAutonomous, setAutonomous) stay open (the cycle is managed from the phone as much as from the window). None of them
// lets a
// browser name a program or a folder: the runner only runs what the configuration says (runner.commands, the worktrees folder and the identity are changed
// only on the computer, see configScope.ts), and its writes to the code host still wait in the proposals of actions:approve. The autonomy switches change how
// far an agent goes by itself inside that same confinement. test/runs-policy.test.ts pins the list.

// push:* channels are device-bound (rpc.handleDevice): only the HTTP RPC reaches them, with the session's device id.
// They take the same path as every other call: session cookie, X-Cerimonias header, this policy.

// Pairing and web access settings only exist in the desktop window.
const WEB_ADMIN = /^web:/;

// sandbox:probe starts a real sandbox process: only the window asks for it (sandbox:status, a cached read, stays open to a paired browser).

// The configuration can name programs to run and folders to read, and the secrets store holds keys: reading the config and its schema is
// open to a paired browser; saving it, the secrets and export/import files are not. The same goes for applying or importing a cycle template
// and for scanning the machine's projects (it reads folders). The one write a browser has is config:cycle-save (team, squads, flow, comment
// templates, the runner's plain settings), which is allowed here and checks its own scope in configModule.ts (configScope.ts). Confirming a test secret
// (or revoking that) decides which secret a stage launches with, so it stays on the computer too; the list of confirmations is only refs and stays open.
// The prompt editor (config:prompts, config:prompt-set) changes what every agent is told: the computer's alone, the list included.
const CONFIG_ADMIN = /^(config:(save|secret|secrets|export|import|testenv-confirm$|testenv-revoke$|prompts$|prompt-set$)|cycle:(apply|template-save|template-remove|template-pick)|agents:(scan|apply|summarize))/;

// The setup wizard opens file dialogs, runs npm, tests keys and writes the configuration: it exists only in the desktop window. A browser
// that finds the setup unfinished is told to finish it on the computer (secrets are never entered from the PWA).
const WIZARD = /^wizard:/;

// The documentation of the repositories (Settings › Documentation): creating or updating it starts a run that writes in a worktree and proposes a push, and reading
// its state reads the repositories' folders. It is the desktop window's, like the settings it lives in.
const DOCS = /^docs:/;

// The agent assistant (Settings › Team) spends the model on every question and saves an agent with permissions of its own (a tracker to read, commands to run) to be tried
// out in a conversation: it is the desktop window's, like suggesting agents. A pattern and not a list, so a channel added later is closed from the day it exists.
const AGENT_ASSIST = /^agentAssist:/;

// Taking control of an agent's virtual screen and sending it clicks and keys (screen:control, screen:input) is the desktop window's, and so is taking it over when the agent
// hands it over, giving it back and reading its picture while the person holds it (screen:handoffTake, screen:handoffGive, screen:handoffFrame): the phone only watches,
// through runs:screen, a read like the others (it answers `held`, with no picture, while the person holds the screen), and may decline (runs:handoffDecline). A pattern and not a list, so a channel added under `screen:` later is closed from the day it exists, and with or without the
// external-effects switch (nothing leaves the machine, but what a person types into the agent's screen is not for a phone to send).
const SCREEN_INPUT = /^screen:/;

// The learned procedures (#179): a paired browser may read the list, one record and the figures, and change nothing. A record is read by every agent of the workspace, so a
// phone that could write one could plant text in every prompt; editing, reviewing, restoring and deleting are the desktop window's. A pattern over the whole prefix with
// the three reads as named exceptions, so a channel added under `procedures:` later is closed from the day it exists, with or without the external-effects switch (nothing
// leaves the machine). The agents' tools are in process and have no channel at all. test/procedures-policy.test.ts pins it.
const PROCEDURES_WRITE = /^procedures:(?!(list|get|stats)$)/;

// The shared memory (#215): the Memory view's six channels are open to a paired browser on purpose. The maintainer decided at gate 1 that the phone has the desktop's
// capabilities over the memory, ahead of #218: it lists, reads, edits, reviews and removes notes, and turns the memory on and off (runner.sharedMemory is in WEB_EDITABLE).
// Unlike the procedures, whose writes stay closed because their text enters every prompt, the notes are masked, size-checked, marked as the person's and audited with the
// door they came through; nothing here leaves the machine, so none is behind the external-effects switch. They are named so a later change of the default does not close or
// open them by accident, and a pattern denies any other `memory:` channel until somebody classifies it. test/memory-policy.test.ts pins both.
export const MEMORY_CHANNELS = new Set(['memory:list', 'memory:read', 'memory:save', 'memory:review', 'memory:remove', 'memory:remove-folder']);
const MEMORY_UNLISTED = /^memory:(?!(list|read|save|review|remove|remove-folder)$)/;

// The questions an agent leaves at a turn limit (#246): a paired browser sees them and answers, with or without the external-effects switch. "Continue" spends the person's
// model budget on work the agent was already allowed to do, and "finish now" ends it early; neither opens a tool, a host or a file it did not have, and neither is a write to
// the code host or a command on the computer. Named so a later change of the default cannot close or open them by accident, and a pattern denies any other `turnAsks:` channel
// until somebody classifies it. test/turn-asks-policy.test.ts pins both.
export const TURN_ASK_CHANNELS = new Set(['turnAsks:list', 'turnAsks:answer']);
const TURN_ASKS_UNLISTED = /^turnAsks:(?!(list|answer)$)/;

// The persona's chat (#247): a paired browser does everything the window does with it, on purpose (the maintainer's decision at gate 1). The text of an answer being written is
// read through `persona:live-read`, a read like the others; the wizard that makes the persona and the editor's writes are `persona:round` to `persona:delete` (the entry is built in the
// main process from the texts alone, and the origin of every change is audited); the conversation itself goes through `forum:*` and the Stop through `runs:callStop`, which are open. The channels of
// the persona's own are named so a later change of the default cannot close or open them by accident, and a pattern built from the same set denies any other `persona:` channel
// until somebody classifies it, so the tools of the later issues of the epic start closed. test/persona-policy.test.ts pins both.
// The Stop (#248) is the person's: `persona:stop`, `persona:resume` and `persona:state` are open to a paired browser and are not external effects (stopping takes capability away, and
// resuming is the person's own act on their own persona), so they work from a phone with the external-effects switch off. They are not queueable (an offline Stop replayed later is
// worse than a failure the person sees), and no tool of the persona names them.
export const PERSONA_CHANNELS = new Set(['persona:live-read', 'persona:round', 'persona:review', 'persona:saveDraft', 'persona:conclude', 'persona:discard', 'persona:finish', 'persona:save', 'persona:clear', 'persona:delete', 'persona:stop', 'persona:resume', 'persona:state']);
const PERSONA_UNLISTED = new RegExp(`^persona:(?!(${[...PERSONA_CHANNELS].map((c) => c.slice('persona:'.length)).join('|')})$)`);

// The local state server's doors: the opt-in writes the workspace config, the write offer writes a project folder's .mcp.json (a path of this
// machine), and the view answers machine-local paths. Desktop-only in full; a paired browser never sees the panel.
const MCP_STATE_ADMIN = /^mcpstate:/;

// The machine's Claude Code sessions (#280): sending to a session, answering its permission requests, stopping and starting one act on the computer through the person's
// own signed-in CLI, and even the list names this machine's folders. Desktop-only in full, reads included, with or without the external-effects switch; a pattern and not a
// list, so a channel added under `claudeSessions:` later is closed from the day it exists. Its events go to the window only (ModuleContext.emitWindow), never through broadcast.
const CLAUDE_SESSIONS = /^claudeSessions:/;

// Remote Control (#282) hands a session to claude.ai/code, outside the paired-phone rules: any channel of it is desktop-only, a door added later included. The agent's
// own switch travels in config:cycle-save, where configScope refuses a raise from the phone.
const REMOTE_CONTROL_ADMIN = /^remoteControl:/;

// The handshake of the contract (#207) only compares two version numbers and answers the instance's own: any client may call it, and it is named so a later change of the
// default cannot close it by accident. test/contract.test.ts pins it.
export const CONTRACT_CHANNELS = new Set([HELLO_CHANNEL]);

export function webAccess(channel: string): WebAccess {
  if (DESKTOP_ONLY.has(channel) || WEB_ADMIN.test(channel) || CONFIG_ADMIN.test(channel) || VOICE_ADMIN.test(channel) || WIZARD.test(channel) || DOCS.test(channel) || AGENT_ASSIST.test(channel) || SCREEN_INPUT.test(channel) || PROCEDURES_WRITE.test(channel) || MEMORY_UNLISTED.test(channel) || TURN_ASKS_UNLISTED.test(channel) || PERSONA_UNLISTED.test(channel) || MCP_STATE_ADMIN.test(channel) || CLAUDE_SESSIONS.test(channel) || REMOTE_CONTROL_ADMIN.test(channel)) return 'deny';
  if (CONTRACT_CHANNELS.has(channel) || MEMORY_CHANNELS.has(channel) || TURN_ASK_CHANNELS.has(channel) || PERSONA_CHANNELS.has(channel)) return 'allow';
  if (EXTERNAL_EFFECT.has(channel)) return 'external';
  return 'allow';
}

export function webRefusal(channel: string, allowExternal: boolean): string | null {
  const access = webAccess(channel);
  if (access === 'allow') return null;
  if (access === 'external' && allowExternal) return null;
  return access === 'external'
    ? t('main.web.externalBlocked')
    : t('main.web.appOnly');
}
