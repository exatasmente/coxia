import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { PluginRequestDecl, PluginSetting } from '../../shared/plugins/declaration';
import { t } from '../../shared/i18n';
import { redact } from '../errorlog-core';
import { isPrivateAddress } from '../sandbox/proxy';

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
export type ResolvedRequest = { ok: true; decl: PluginRequestDecl; url: URL; method: string; body: string | undefined; contentType: string | undefined; fromSetting: boolean } | { ok: false; refused: string };

/** What came back: the response the plugin gets, or the reason there is none. */
export type PerformedRequest = { ok: true; status: number; contentType: string; body: string; truncated: boolean } | { ok: false; refused: string };

/** What came back from the wire, before the app reads it. */
export interface RawResponse {
  status: number;
  contentType: string;
  /** Reads at most `max` bytes of the body, and says whether it was cut. */
  read(max: number): Promise<{ text: string; truncated: boolean }>;
}

/**
 * Makes one HTTP call. `allowPrivate` is true only for an address the person set in a setting: an address the plugin declared never reaches a
 * private, loopback or link-local one, checked on the address the connection actually goes to.
 */
export type Transport = (url: URL, init: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number; allowPrivate: boolean }) => Promise<RawResponse>;

export interface RequestDeps {
  transport: Transport;
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
  const refuse = (key: string, params: Record<string, string> = {}): ResolvedRequest => ({ ok: false, refused: t(`main.plugins.request.${key}`, { id: String(call.id ?? '').slice(0, 40), ...params }) });
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
  // An address the plugin declared is a public host name; only the person's own setting may lead to a local or private one.
  if (!fromSetting && !publicHostName(base.hostname)) return refuse('privateAddress');

  const extra = call.path ?? '';
  if (typeof extra !== 'string' || (extra && !extra.startsWith('/')) || /[?#\\]|\/\/|%(2f|5c|00|25)/i.test(extra) || extra.split('/').some((s) => s === '..' || s === '.' || /%2e/i.test(s))) return refuse('badPath');
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
  return { ok: true, decl, url, method: decl.method, body, contentType, fromSetting: !!fromSetting };
}

/** A host name that is not an address and not a local name: what a declared request may go to. Its addresses are checked again when it connects. */
export function publicHostName(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(h) !== 0) return false;
  return h !== 'localhost' && !h.endsWith('.localhost') && !h.endsWith('.local') && !h.endsWith('.internal') && h.includes('.');
}

/**
 * The real transport: `http`/`https` with a lookup of its own, so the address checked is the one connected to (no second resolution an attacker's DNS
 * could answer differently). No redirect is followed; the body is read up to a cap; the whole call has a deadline.
 */
export const realTransport: Transport = (url, init) =>
  new Promise((resolve, reject) => {
    const guard = (address: string): Error | null => (!init.allowPrivate && isPrivateAddress(address) ? new Error(t('main.plugins.request.privateAddress', { id: url.hostname })) : null);
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(literal) !== 0) {
      const refused = guard(literal);
      if (refused) return reject(refused);
    }
    const lookup = (hostname: string, options: { all?: boolean }, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void => {
      dnsLookup(hostname, { all: true }, (err, addresses) => {
        if (err) return cb(err, '');
        const refused = addresses.map((a) => guard(a.address)).find(Boolean);
        if (refused) return cb(refused, '');
        if (options.all) return cb(null, addresses);
        cb(null, addresses[0].address, addresses[0].family);
      });
    };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: init.method, headers: init.headers, lookup: lookup as never });
    const timer = setTimeout(() => req.destroy(new Error(t('main.plugins.request.timeout', { id: url.hostname }))), init.timeoutMs);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.on('response', (res: IncomingMessage) => {
      resolve({
        status: res.statusCode ?? 0,
        contentType: String(res.headers['content-type'] ?? ''),
        read: (max) =>
          new Promise((done, fail) => {
            const chunks: Buffer[] = [];
            let size = 0;
            let truncated = false;
            res.on('data', (chunk: Buffer) => {
              if (truncated) return;
              if (size + chunk.length > max) {
                chunks.push(chunk.subarray(0, max - size));
                truncated = true;
                res.destroy();
                clearTimeout(timer);
                done({ text: Buffer.concat(chunks).toString('utf8'), truncated });
                return;
              }
              chunks.push(chunk);
              size += chunk.length;
            });
            res.on('end', () => {
              clearTimeout(timer);
              done({ text: Buffer.concat(chunks).toString('utf8'), truncated });
            });
            res.on('error', (e) => {
              clearTimeout(timer);
              if (!truncated) fail(e);
            });
          }),
      });
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });

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
  // The secret is taken out in every form it may come back in: raw, as the declaration wrote it, URL-encoded and JSON-escaped.
  const forms = secret ? [...new Set([resolved.decl.secret?.format.split('{secret}').join(secret) ?? '', secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)])].filter((f) => f.length >= 4).sort((a, b) => b.length - a.length) : [];
  const clean = (text: string): string => redact(forms.reduce((acc, f) => acc.split(f).join('[secret]'), text));
  try {
    const res = await deps.transport(url, { method: resolved.method, headers, body: resolved.body, timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS, allowPrivate: resolved.fromSetting });
    if (res.status >= 300 && res.status < 400) return { ok: false, refused: t('main.plugins.request.redirect', { id: resolved.decl.id }) };
    const { text, truncated } = await res.read(deps.maxBytes ?? RESPONSE_MAX_BYTES);
    return { ok: true, status: res.status, contentType: res.contentType, body: clean(text), truncated };
  } catch (e) {
    return { ok: false, refused: t('main.plugins.request.failed', { id: resolved.decl.id, reason: clean(e instanceof Error ? e.message : String(e)) }) };
  }
}
