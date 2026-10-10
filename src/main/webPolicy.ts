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

// The local state server's doors: the opt-in writes the workspace config, the write offer writes a project folder's .mcp.json (a path of this
// machine), and the view answers machine-local paths. Desktop-only in full; a paired browser never sees the panel.
const MCP_STATE_ADMIN = /^mcpstate:/;

export function webAccess(channel: string): WebAccess {
  if (DESKTOP_ONLY.has(channel) || WEB_ADMIN.test(channel) || CONFIG_ADMIN.test(channel) || VOICE_ADMIN.test(channel) || WIZARD.test(channel) || DOCS.test(channel) || AGENT_ASSIST.test(channel) || SCREEN_INPUT.test(channel) || PROCEDURES_WRITE.test(channel) || MCP_STATE_ADMIN.test(channel)) return 'deny';
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
