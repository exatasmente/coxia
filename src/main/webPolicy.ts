import { t } from '../shared/i18n';
// What a browser session may call. The desktop window has no such limits (IPC does not go through here).
export type WebAccess = 'allow' | 'deny' | 'external';

// Acts on the desktop machine itself: terminal, clipboard, login items, local file deletion, native notifications,
// the shell commands that conflict resolutions run (a browser must not be able to set what Aplicar executes),
// the workspace test flag and deletion (a browser may create, rename and switch workspaces, not lower the guard),
// and the app update: it rebuilds or downloads and replaces the installed app, then quits it, so every update:* channel is listed
// (test/updates-policy.test.ts checks that no update channel is missing), and the VCS probe (it takes a token typed in the setup
// screen: a token never travels through the browser channel).
export const DESKTOP_ONLY = new Set(['claude:continue', 'clipboard:copy', 'autostart:set', 'retention:apply', 'jobs:notify', 'conflicts:verify-set', 'workspace:test', 'workspace:delete', 'update:info', 'update:run', 'update:seen', 'update:flushed', 'update:status', 'update:check', 'update:settings-save', 'update:install', 'update:busy', 'vcs:probe', 'runs:start', 'runs:startStage', 'runs:accept', 'runs:return', 'runs:gate', 'runs:retry', 'runs:cancel', 'runs:setAutonomous']);

// The voice setup installs software, deletes files and starts processes: only the window. voice:status is a read and stays open.
const VOICE_ADMIN = /^voice:(check|install|install-cancel|test|uninstall|enable)$/;

// Writes to GitLab or pushes branches. actions:approve is the only door: every proposal (gitlabQuick, feedback,
// the release sync) waits there, so refusing it refuses all of them.
export const EXTERNAL_EFFECT = new Set(['actions:approve']);

// forum:* (list, read, post, create) read and write the workspace's own thread files and nothing else, so a paired browser may use them: the
// phone is where a person answers a question. A mention only calls on an agent that reads (never one that writes), and a post is never mirrored to
// the code host by itself. test/forum-policy.test.ts pins that none of them is desktop-only or an external effect.

// runs:*: reading the runs (list, get) and answering a run's question (answer, and a forum post that answers it) are open to a paired browser: the phone is
// where a person answers, and an answer only lets the stage that asked go on, under the same confinement. Everything else starts work or changes a run
// (start, startStage, accept, return, gate, retry, cancel) or changes what an agent may do by itself (setAutonomous), and creates branches and worktrees on this
// machine: desktop only. test/runs-policy.test.ts pins the list.

// push:* channels are device-bound (rpc.handleDevice): only the HTTP RPC reaches them, with the session's device id.
// They take the same path as every other call: session cookie, X-Cerimonias header, this policy.

// Pairing and web access settings only exist in the desktop window.
const WEB_ADMIN = /^web:/;

// The configuration can name programs to run and folders to read, and the secrets store holds keys: reading the config and its schema is
// open to a paired browser; saving it, the secrets and export/import files are not. The same goes for applying or importing a cycle template
// and for scanning the machine's projects (it reads folders).
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
