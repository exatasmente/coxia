import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { MAX_BODY, MAX_TITLE, noticeTarget, type PushPayload, type PushStatus, type PushTarget } from '../shared/push';
import type { AppEvent } from '../shared/types';
import { encryptPayload, generateVapidKeys, type PushKeys, validPushKeys, type VapidKeys, vapidAuthorization, vapidJwt } from './webPushCrypto';

export interface PushNotice {
  title: string;
  body: string;
  onClick: AppEvent;
}

export interface PushSubscription {
  endpoint: string;
  keys: PushKeys;
}

interface Stored extends PushSubscription {
  deviceId: string;
  createdAt: string;
}

export interface PushResponse {
  status: number;
  retryAfterSec?: number;
}

export type PushTransport = (url: URL, headers: Record<string, string>, body: Buffer) => Promise<PushResponse>;

export class PushError extends Error {}

// Outbound traffic goes to the browsers' push services only.
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com'];
const MAX_ENDPOINT = 1024;
const MAX_SUBSCRIPTIONS = 20;
const COALESCE_MS = 1500;
const BURST = 3;
const PER_HOUR = 40;
const TEST_EVERY_MS = 10_000;
const JWT_TTL_SEC = 12 * 3600;
const REQUEST_TIMEOUT_MS = 15_000;

/** Parses a subscription endpoint and returns it only when it is https on a push service (or a test origin). */
export function allowedEndpoint(endpoint: unknown, extraOrigins: string[] = []): URL | null {
  if (typeof endpoint !== 'string' || endpoint.length > MAX_ENDPOINT) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (extraOrigins.includes(url.origin)) return url;
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host.startsWith('[')) return null;
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url : null;
}

/** Test-only extra origin (CERIMONIAS_PUSH_TEST_ORIGIN): loopback only, never a real host. */
export function testOriginsFromEnv(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const u = new URL(value);
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname) ? [u.origin] : [];
  } catch {
    return [];
  }
}

const defaultTransport: PushTransport = (url, headers, body) =>
  new Promise((ok, fail) => {
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const req = send(url, { method: 'POST', headers: { ...headers, 'Content-Length': String(body.length) }, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      res.resume();
      res.on('end', () => {
        const retry = Number(res.headers['retry-after']);
        ok({ status: res.statusCode ?? 0, retryAfterSec: Number.isFinite(retry) ? retry : undefined });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.end(body);
  });

function writeSecret(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(`${file}.tmp`, 0o600);
  renameSync(`${file}.tmp`, file);
}

export function loadVapid(file: string): VapidKeys {
  try {
    if (existsSync(file)) {
      const k = JSON.parse(readFileSync(file, 'utf8')) as Partial<VapidKeys>;
      if (typeof k.publicKey === 'string' && typeof k.privateKey === 'string') {
        chmodSync(file, 0o600);
        return { publicKey: k.publicKey, privateKey: k.privateKey };
      }
    }
  } catch {}
  const keys = generateVapidKeys();
  writeSecret(file, keys);
  return keys;
}

export interface PushDeps {
  dir: string;
  subject: string;
  deviceIds(): string[];
  notificationsOn(): boolean;
  transport?: PushTransport;
  extraOrigins?: string[];
  now?: () => number;
  retryDelayMs?: number;
}

export interface PushService {
  publicKey(): string;
  subscribe(deviceId: string, sub: unknown, oldEndpoint?: unknown): void;
  unsubscribe(deviceId: string): void;
  removeDevice(deviceId: string): void;
  status(deviceId: string, endpoint?: unknown): PushStatus;
  test(deviceId: string): Promise<void>;
  notify(n: PushNotice): void;
  flush(): Promise<void>;
  close(): void;
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function createPush(deps: PushDeps): PushService {
  const vapidFile = join(deps.dir, 'web-push-vapid.json');
  const subsFile = join(deps.dir, 'web-push.json');
  const now = deps.now ?? Date.now;
  const transport = deps.transport ?? defaultTransport;
  const extra = deps.extraOrigins ?? [];
  const keys = loadVapid(vapidFile);
  const jwts = new Map<string, { jwt: string; exp: number }>();
  const sentLog = new Map<string, number[]>();
  const lastTest = new Map<string, number>();
  let pending: PushNotice[] = [];
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> = Promise.resolve();

  let subs: Stored[] = [];
  try {
    if (existsSync(subsFile)) subs = (JSON.parse(readFileSync(subsFile, 'utf8')) as { subs?: Stored[] }).subs ?? [];
  } catch {
    subs = [];
  }
  subs = subs.filter((s) => allowedEndpoint(s.endpoint, extra) && validPushKeys(s.keys));

  const save = (): void => writeSecret(subsFile, { subs });

  function prune(): void {
    const live = new Set(deps.deviceIds());
    const kept = subs.filter((s) => live.has(s.deviceId));
    if (kept.length !== subs.length) {
      subs = kept;
      save();
    }
  }
  prune();

  function authorization(url: URL): string {
    const aud = url.origin;
    const cached = jwts.get(aud);
    const nowSec = Math.floor(now() / 1000);
    if (cached && cached.exp - nowSec > 3600) return vapidAuthorization(cached.jwt, keys.publicKey);
    const exp = nowSec + JWT_TTL_SEC;
    const jwt = vapidJwt(keys, aud, deps.subject, exp);
    jwts.set(aud, { jwt, exp });
    return vapidAuthorization(jwt, keys.publicKey);
  }

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function deliver(sub: Stored, payload: PushPayload, ttl: number, urgency: string): Promise<boolean> {
    const url = allowedEndpoint(sub.endpoint, extra);
    if (!url) {
      removeEndpoint(sub.endpoint);
      return false;
    }
    const body = encryptPayload(Buffer.from(JSON.stringify(payload)), sub.keys);
    const headers: Record<string, string> = {
      Authorization: authorization(url),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
      Topic: payload.tag.slice(0, 32),
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: PushResponse | null = null;
      try {
        res = await transport(url, headers, body);
      } catch {}
      if (res && res.status >= 200 && res.status < 300) return true;
      if (res && (res.status === 404 || res.status === 410)) {
        removeEndpoint(sub.endpoint);
        return false;
      }
      const retryable = !res || res.status === 429 || res.status >= 500;
      if (!retryable || attempt === 1) {
        console.error('[push] entrega recusada:', res ? res.status : 'sem resposta');
        return false;
      }
      await sleep(deps.retryDelayMs ?? Math.min(5000, (res?.retryAfterSec ?? 2) * 1000));
    }
    return false;
  }

  function removeEndpoint(endpoint: string): void {
    const before = subs.length;
    subs = subs.filter((s) => s.endpoint !== endpoint);
    if (subs.length !== before) save();
  }

  function removeDevice(deviceId: string): void {
    const before = subs.length;
    subs = subs.filter((s) => s.deviceId !== deviceId);
    if (subs.length !== before) save();
  }

  function underCap(deviceId: string): boolean {
    const recent = (sentLog.get(deviceId) ?? []).filter((t) => now() - t < 3600_000);
    if (recent.length >= PER_HOUR) {
      sentLog.set(deviceId, recent);
      return false;
    }
    sentLog.set(deviceId, [...recent, now()]);
    return true;
  }

  function payloadFor(title: string, body: string, target: PushTarget): PushPayload {
    const t = clip(title, MAX_TITLE);
    const tag = `n-${createHash('sha1').update(`${t}|${target.to}|${target.ref ?? target.id ?? ''}`).digest('hex').slice(0, 12)}`;
    return { v: 1, title: t, body: clip(body, MAX_BODY), tag, target, ts: now() };
  }

  const urgencyOf = (t: PushTarget): 'high' | 'normal' => (['deep', 'conflict', 'call'].includes(t.to) ? 'high' : 'normal');

  async function fanOut(payload: PushPayload, urgency: 'high' | 'normal', ttl: number, only?: string): Promise<number> {
    prune();
    const targets = subs.filter((s) => (only ? s.deviceId === only : true) && (only || underCap(s.deviceId)));
    const results = await Promise.all(targets.map((s) => deliver(s, payload, ttl, urgency)));
    return results.filter(Boolean).length;
  }

  function flushNow(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = pending;
    pending = [];
    if (!batch.length || !subs.length) return inflight;
    const jobs: Array<() => Promise<number>> = [];
    if (batch.length > BURST) {
      const names = batch.map((n) => n.title).join(' · ');
      jobs.push(() => fanOut(payloadFor(`${batch.length} notificações novas`, names, { to: 'today' }), 'normal', 3600));
    } else {
      for (const n of batch) {
        const target = noticeTarget(n.onClick);
        const urgency = urgencyOf(target);
        jobs.push(() => fanOut(payloadFor(n.title, n.body, target), urgency, urgency === 'high' ? 1800 : 3600));
      }
    }
    inflight = inflight.then(async () => {
      for (const job of jobs) await job().catch((e) => console.error('[push]', e instanceof Error ? e.message : e));
    });
    return inflight;
  }

  return {
    publicKey: () => keys.publicKey,

    subscribe(deviceId, sub, oldEndpoint) {
      const s = sub as Partial<PushSubscription> | null;
      const url = allowedEndpoint(s?.endpoint, extra);
      if (!s || !url) throw new PushError('Este navegador usa um serviço de push que o app não aceita.');
      const k = s.keys as PushKeys | undefined;
      if (!k || typeof k.p256dh !== 'string' || typeof k.auth !== 'string' || !validPushKeys(k)) throw new PushError('Assinatura de push inválida.');
      subs = subs.filter((x) => x.deviceId !== deviceId && x.endpoint !== s.endpoint && x.endpoint !== oldEndpoint);
      subs.push({ deviceId, endpoint: url.href, keys: { p256dh: k.p256dh, auth: k.auth }, createdAt: new Date(now()).toISOString() });
      subs = subs.slice(-MAX_SUBSCRIPTIONS);
      save();
    },

    unsubscribe: removeDevice,
    removeDevice,

    status(deviceId, endpoint) {
      const mine = subs.find((s) => s.deviceId === deviceId);
      return { subscribed: !!mine && (typeof endpoint !== 'string' || mine.endpoint === endpoint), notificationsOn: deps.notificationsOn() };
    },

    async test(deviceId) {
      const mine = subs.find((s) => s.deviceId === deviceId);
      if (!mine) throw new PushError('Este aparelho ainda não está inscrito.');
      if (now() - (lastTest.get(deviceId) ?? 0) < TEST_EVERY_MS) throw new PushError('Espere alguns segundos antes de testar de novo.');
      lastTest.set(deviceId, now());
      const payload = payloadFor('Cerimônias: teste', 'Se você está lendo isto, as notificações deste aparelho funcionam.', { to: 'settings' });
      const sent = await fanOut({ ...payload, tag: 'n-test' }, 'high', 60, deviceId);
      if (!sent) throw new PushError('O serviço de push não aceitou a notificação de teste. Tente ativar de novo.');
    },

    notify(n) {
      if (!subs.length || !deps.notificationsOn()) return;
      pending.push(n);
      if (!timer) timer = setTimeout(() => void flushNow(), COALESCE_MS);
    },

    flush: flushNow,

    close() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = [];
    },
  };
}
