// What a browser session may call. The desktop window has no such limits (IPC does not go through here).
export type WebAccess = 'allow' | 'deny' | 'external';

// Acts on the desktop machine itself: terminal, clipboard, login items, local file deletion.
export const DESKTOP_ONLY = new Set(['claude:continue', 'clipboard:copy', 'autostart:set', 'retention:apply']);

// Writes to GitLab or pushes branches. actions:approve is the only door: every proposal (gitlabQuick, feedback,
// post-release-sync) waits there, so refusing it refuses all of them.
export const EXTERNAL_EFFECT = new Set(['actions:approve']);

// push:* channels are device-bound (rpc.handleDevice): only the HTTP RPC reaches them, with the session's device id.
// They take the same path as every other call: session cookie, X-Cerimonias header, this policy.

// Pairing and web access settings only exist in the desktop window.
const WEB_ADMIN = /^web:/;

export function webAccess(channel: string): WebAccess {
  if (DESKTOP_ONLY.has(channel) || WEB_ADMIN.test(channel)) return 'deny';
  if (EXTERNAL_EFFECT.has(channel)) return 'external';
  return 'allow';
}

export function webRefusal(channel: string, allowExternal: boolean): string | null {
  const access = webAccess(channel);
  if (access === 'allow') return null;
  if (access === 'external' && allowExternal) return null;
  return access === 'external'
    ? 'Ação com efeito externo bloqueada pelo navegador. Aprove na janela do app ou habilite em Configurações › Acesso pelo navegador.'
    : 'Este comando só funciona na janela do app, não pelo navegador.';
}
