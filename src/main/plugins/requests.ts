import type { PluginRequestDecl, PluginSetting } from '../../shared/plugins/declaration';
import { t } from '../../shared/i18n';
import { redact } from '../errorlog-core';

// The requests a JavaScript plugin asks the app to make. The plugin describes one by the id it declared; the app checks it against the declaration and
// the settings the person filled in, puts the secret where the declaration says (the plugin never sees it), makes the call from the main process — not
// from the sandbox, so a local address the person set is reachable — and hands back a masked response with the secret taken out.
//
// Nothing here decides permission: the service asks the person before a plugin runs (reads) or before a write goes out. Nothing here writes the audit
// log either: the caller records each call (reads directly, writes through the door of Actions).

/** What the plugin asked: the declared request, an optional path under the declared one, query parameters and a body. */
export interface PluginRequestCall {
  id: string;
  path?: string;
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/** The plugin as far as its requests go. */
export interface RequestingPlugin {
  id: string;
  settings: PluginSetting[];
  values: Record<string, string>;
  requests: PluginRequestDecl[];
}

/** A call ready to be made, or why it is refused. */
export type ResolvedRequest = { ok: true; decl: PluginRequestDecl; url: URL; method: string; body: string | undefined; contentType: string | undefined } | { ok: false; refused: string };

/** What came back: the response the plugin gets, or the reason there is none. */
export type PerformedRequest = { ok: true; status: number; contentType: string; body: string; truncated: boolean } | { ok: false; refused: string };

export interface RequestDeps {
  fetch: typeof fetch;
  /** The value of a secret by reference, or null when it is not filled in. Only called while the request is being made. */
  secret(ref: string): string | null;
  timeoutMs?: number;
  maxBytes?: number;
}

export const REQUEST_TIMEOUT_MS = 15_000;
export const RESPONSE_MAX_BYTES = 200 * 1024;
const BODY_MAX_BYTES = 100 * 1024;
const CONTENT_TYPES = ['application/json', 'text/plain', 'application/x-www-form-urlencoded'];

/** The secrets-store reference of a plugin's secret setting. */
export const pluginSecretRef = (plugin: string, key: string): string => `plugin.${plugin}.${key}`;

/**
 * Builds the call from the declaration, the person's settings and what the plugin asked. Pure: no network, no secret. Refused, with the reason, when the
 * id is not declared, a setting it needs is empty, the address does not parse, the path tries to leave the declared one, or the body is not allowed.
 */
export function resolvePluginRequest(plugin: RequestingPlugin, call: PluginRequestCall): ResolvedRequest {
  const refuse = (key: string, params: Record<string, string> = {}): ResolvedRequest => ({ ok: false, refused: t(`main.plugins.request.${key}`, { id: String(call.id ?? ''), ...params }) });
  const decl = plugin.requests.find((r) => r.id === call.id);
  if (!decl) return refuse('notDeclared');

  let base: URL;
  const fromSetting = /^\{settings\.([A-Za-z][A-Za-z0-9_]{0,39})\}(.*)$/.exec(decl.url);
  try {
    if (fromSetting) {
      const value = (plugin.values[fromSetting[1]] ?? '').trim().replace(/\/+$/, '');
      if (!value) return refuse('settingEmpty', { setting: fromSetting[1] });
      base = new URL(`${value}${fromSetting[2]}`);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') return refuse('badAddress');
    } else base = new URL(decl.url);
  } catch {
    return refuse('badAddress');
  }
  if (base.username || base.password) return refuse('badAddress');

  const extra = call.path ?? '';
  if (typeof extra !== 'string' || (extra && !extra.startsWith('/')) || /[?#\\]|\/\//.test(extra) || extra.split('/').some((s) => s === '..' || s === '.' || /%2e/i.test(s))) return refuse('badPath');
  const url = new URL(base.href);
  url.pathname = `${base.pathname.replace(/\/+$/, '')}${extra}` || '/';
  if (url.origin !== base.origin) return refuse('badPath');
  for (const [k, v] of Object.entries(call.query ?? {})) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9_.\-[\]]{1,64}$/.test(k)) return refuse('badQuery');
    if (decl.secret?.in === 'query' && k === decl.secret.name) return refuse('badQuery');
    url.searchParams.append(k, v);
  }

  let body: string | undefined;
  let contentType: string | undefined;
  if (call.body !== undefined && call.body !== null) {
    if (decl.method === 'GET' || typeof call.body !== 'string' || Buffer.byteLength(call.body) > BODY_MAX_BYTES) return refuse('badBody');
    body = call.body;
    contentType = call.contentType ?? 'application/json';
    if (!CONTENT_TYPES.includes(contentType)) return refuse('badBody');
  }
  return { ok: true, decl, url, method: decl.method, body, contentType };
}

/** Where a resolved call goes, for the audit log and the request card: method, origin and path, never the query (it may carry what was searched). */
export const requestTarget = (r: { method: string; url: URL }): string => `${r.method} ${r.url.origin}${r.url.pathname}`;

/**
 * Makes a call that `resolvePluginRequest` built. The secret is read here and only put in the call; a redirect is refused (it would take the call
 * somewhere the declaration did not name); the response is cut at the size limit, the secret's value is taken out of it, and it is masked.
 */
export async function performPluginRequest(deps: RequestDeps, plugin: RequestingPlugin, resolved: Extract<ResolvedRequest, { ok: true }>): Promise<PerformedRequest> {
  const headers: Record<string, string> = { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' };
  if (resolved.contentType) headers['content-type'] = resolved.contentType;
  const url = new URL(resolved.url.href);
  let secret: string | null = null;
  if (resolved.decl.secret) {
    secret = deps.secret(pluginSecretRef(plugin.id, resolved.decl.secret.setting));
    if (!secret) return { ok: false, refused: t('main.plugins.request.secretEmpty', { id: resolved.decl.id, setting: resolved.decl.secret.setting }) };
    const value = resolved.decl.secret.format.split('{secret}').join(secret);
    if (resolved.decl.secret.in === 'header') headers[resolved.decl.secret.name] = value;
    else url.searchParams.set(resolved.decl.secret.name, value);
  }
  const clean = (text: string): string => redact(secret ? text.split(secret).join('[secret]') : text);
  try {
    const res = await deps.fetch(url, { method: resolved.method, headers, body: resolved.body, redirect: 'manual', signal: AbortSignal.timeout(deps.timeoutMs ?? REQUEST_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) return { ok: false, refused: t('main.plugins.request.redirect', { id: resolved.decl.id }) };
    const { text, truncated } = await readCapped(res, deps.maxBytes ?? RESPONSE_MAX_BYTES);
    return { ok: true, status: res.status, contentType: res.headers.get('content-type') ?? '', body: clean(text), truncated };
  } catch (e) {
    return { ok: false, refused: t('main.plugins.request.failed', { id: resolved.decl.id, reason: clean(e instanceof Error ? e.message : String(e)) }) };
  }
}

/** Reads at most `max` bytes of a response body, and says whether it was cut. */
async function readCapped(res: Response, max: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      chunks.push(value.subarray(0, max - size));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated };
}
