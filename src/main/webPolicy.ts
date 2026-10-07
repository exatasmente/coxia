import { t } from '../shared/i18n';
// What a browser session may call. The desktop window has no such limits (IPC does not go through here).
export type WebAccess = 'allow' | 'deny' | 'external';

// Acts on the desktop machine itself: terminal, clipboard, login items, local file deletion, native notifications,
// the shell commands that conflict resolutions run (a browser must not be able to set what Aplicar executes),
// the workspace test flag and deletion (a browser may create, rename and switch workspaces, not lower the guard),
// and the app update: it rebuilds or downloads and replaces the installed app, then quits it, so every update:* channel is listed
// (test/updates-policy.test.ts checks that no update channel is missing), and the VCS probe (it takes a token typed in the setup
// screen: a token never travels through the browser channel).
export const DESKTOP_ONLY = new Set(['claude:continue', 'clipboard:copy', 'autostart:set', 'retention:apply', 'jobs:notify', 'conflicts:verify-set', 'workspace:test', 'workspace:delete', 'update:info', 'update:run', 'update:seen', 'update:flushed', 'update:status', 'update:check', 'update:settings-save', 'update:install', 'update:busy', 'vcs:probe', 'sandbox:probe']);

// The voice setup installs software, deletes files and starts processes: only the window. voice:status is a read and stays open.
const VOICE_ADMIN = /^voice:(check|install|install-cancel|test|uninstall|enable)$/;

// Writes to GitLab or pushes branches. actions:approve is the only door: every proposal (gitlabQuick, feedback,
// the release sync) waits there, so refusing it refuses all of them. runs:command lets an agent set to `shell: host` run a command on this
// computer, outside any sandbox: allowing one from a phone is as far-reaching as approving a proposal, so it sits behind the same switch. runs:startRelease
// starts a run that ends in the repository's own scripts and merged code, run as the person: the same switch decides whether a phone may start one (each push
// of the release still waits for its own "yes" in actions:approve).
export const EXTERNAL_EFFECT = new Set(['actions:approve', 'runs:command', 'runs:startRelease']);

// forum:* (list, read, post, create, the four attachment channels — attachment-put, attachment-post, attachment-drop, attachment-get — and attachment-delete,
// which removes one message of the conversation and the files it carried) read and write the workspace's own thread files and its own attachment folder, and
// nothing else, so a paired browser may use them: the phone is where a person answers a question and attaches a screenshot. A mention calls on an agent that
// never writes to the run (its commands run over a copy, an issue it proposes waits in
// actions:approve), and a post is never mirrored to the code host by itself. An `@agent` calls that agent wherever a person may post, not only in a run's
// thread: that is the mention rule, and it changes no channel of this policy. test/forum-policy.test.ts pins that none of them is desktop-only or an external effect.

// runs:* are all open to a paired browser, except runs:startRelease and runs:command (above, behind the external-effects switch), the reads and the moves alike (start, startStage, accept, return, gate, answer, retry, cancel, skipWait, sendBack, migrateFlow,
// undoPost, setSquad, removeSquad, setSquadAutonomous, setAutonomous): the cycle is managed from the phone as much as from the window. None of them lets a
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
// templates, the runner's plain settings), which is allowed here and checks its own scope in configModule.ts (configScope.ts).
const CONFIG_ADMIN = /^(config:(save|secret|secrets|export|import)|cycle:(apply|template-save|template-remove|template-pick)|agents:(scan|apply|summarize))/;

// The setup wizard opens file dialogs, runs npm, tests keys and writes the configuration: it exists only in the desktop window. A browser
// that finds the setup unfinished is told to finish it on the computer (secrets are never entered from the PWA).
const WIZARD = /^wizard:/;

export function webAccess(channel: string): WebAccess {
  if (DESKTOP_ONLY.has(channel) || WEB_ADMIN.test(channel) || CONFIG_ADMIN.test(channel) || VOICE_ADMIN.test(channel) || WIZARD.test(channel)) return 'deny';
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
