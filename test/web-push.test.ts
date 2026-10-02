import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { noticeTarget, parseTarget, targetFromSearch, targetQuery, type PushPayload } from '../src/shared/push';
import { allowedEndpoint, createPush, loadVapid, testOriginsFromEnv, type PushResponse, type PushTransport } from '../src/main/webPush';
import { b64u, encryptPayload, fromB64u, generateVapidKeys, MAX_PLAINTEXT, validPushKeys, vapidAuthorization, vapidJwt } from '../src/main/webPushCrypto';

// RFC 8291 appendix A.
const RFC = {
  plaintext: Buffer.from('When I grow up, I want to be a watermelon'),
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// What a browser does with a push body: the receiver side of RFC 8291.
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const data = body.subarray(21 + idLen);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(uaPrivate);
  const secret = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  expect(plain[plain.length - 1]).toBe(0x02);
  return plain.subarray(0, plain.length - 1);
}

function receiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}

describe('web push crypto', () => {
  it('reproduces the RFC 8291 appendix A message byte for byte', () => {
    const body = encryptPayload(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: fromB64u(RFC.salt), senderPrivate: fromB64u(RFC.asPrivate) });
    expect(b64u(body)).toBe(RFC.body);
  });

  it('decrypts the RFC message with the receiver keys', () => {
    expect(decrypt(fromB64u(RFC.body), fromB64u(RFC.uaPrivate), fromB64u(RFC.uaPublic), fromB64u(RFC.auth)).toString()).toBe(RFC.plaintext.toString());
  });

  it('round-trips a random message with a fresh sender key and salt', () => {
    const r = receiver();
    const text = Buffer.from(JSON.stringify({ title: 'Olá', body: 'Atenção: ação' }));
    const a = encryptPayload(text, r.keys);
    const b = encryptPayload(text, r.keys);
    expect(a.equals(b)).toBe(false);
    expect(decrypt(a, fromB64u(b64u(r.ecdh.getPrivateKey())), r.ecdh.getPublicKey(), r.auth).toString()).toBe(text.toString());
  });

  it('refuses a payload that does not fit one record', () => {
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT + 1), receiver().keys)).toThrow();
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT), receiver().keys)).not.toThrow();
  });

  it('validates subscription keys', () => {
    expect(validPushKeys(receiver().keys)).toBe(true);
    expect(validPushKeys({ p256dh: RFC.uaPublic, auth: 'short' })).toBe(false);
    expect(validPushKeys({ p256dh: b64u(Buffer.alloc(65, 4)), auth: RFC.auth })).toBe(false);
    expect(validPushKeys({ p256dh: 'x', auth: RFC.auth })).toBe(false);
  });
});

describe('vapid', () => {
  it('signs an ES256 JWT with aud, exp and sub that verifies against the public key', () => {
    const keys = generateVapidKeys();
    expect(fromB64u(keys.publicKey)).toHaveLength(65);
    const jwt = vapidJwt(keys, 'https://fcm.googleapis.com', 'https://coxia.acme.test/cerimonias/', 1_900_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(fromB64u(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(fromB64u(c).toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_900_000_000, sub: 'https://coxia.acme.test/cerimonias/' });
    expect(fromB64u(s)).toHaveLength(64);
    const pub = fromB64u(keys.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(s))).toBe(true);
    expect(vapidAuthorization(jwt, keys.publicKey)).toBe(`vapid t=${jwt}, k=${keys.publicKey}`);
  });

  it('keeps the key pair in a 0600 file and reuses it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cer-vapid-')), 'sub', 'vapid.json');
    const a = loadVapid(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadVapid(file)).toEqual(a);
  });
});

describe('endpoint allowlist', () => {
  it('accepts https on the push services and their subdomains', () => {
    for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QXR', 'https://eu.push.apple.com/x']) {
      expect(allowedEndpoint(u)).not.toBeNull();
    }
  });

  it('refuses everything else', () => {
    for (const u of [
      'http://fcm.googleapis.com/x',
      'https://evil.example/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com.example/x',
      'https://notpush.apple.com.evil/x',
      'https://127.0.0.1/x',
      'https://[::1]/x',
      'https://169.254.169.254/latest',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'ftp://fcm.googleapis.com/x',
      'file:///etc/passwd',
      'not a url',
      `https://fcm.googleapis.com/${'a'.repeat(1100)}`,
      42,
      undefined,
    ]) {
      expect(allowedEndpoint(u as string)).toBeNull();
    }
  });

  it('allows a test origin only when it is loopback', () => {
    expect(testOriginsFromEnv('http://127.0.0.1:5555')).toEqual(['http://127.0.0.1:5555']);
    expect(testOriginsFromEnv('http://localhost:5555/x')).toEqual(['http://localhost:5555']);
    expect(testOriginsFromEnv('http://evil.example')).toEqual([]);
    expect(testOriginsFromEnv('http://203.0.113.6:80')).toEqual([]);
    expect(testOriginsFromEnv(undefined)).toEqual([]);
    expect(allowedEndpoint('http://127.0.0.1:5555/push/1', ['http://127.0.0.1:5555'])).not.toBeNull();
    expect(allowedEndpoint('http://127.0.0.1:6666/push/1', ['http://127.0.0.1:5555'])).toBeNull();
  });
});

describe('push targets', () => {
  it('maps what a desktop notification does on click to a small target', () => {
    expect(noticeTarget({ type: 'navigate', to: 'call' })).toEqual({ to: 'call' });
    expect(noticeTarget({ type: 'deep', card: { ref: 'web#123' } as never })).toEqual({ to: 'deep', ref: 'web#123' });
    expect(noticeTarget({ type: 'conflict', id: 'abc' })).toEqual({ to: 'conflict', id: 'abc' });
    expect(noticeTarget({ type: 'open', screen: { name: 'qa', ref: 'web#9' } })).toEqual({ to: 'qa', ref: 'web#9' });
    expect(noticeTarget({ type: 'open', screen: { name: 'qa' } })).toEqual({ to: 'today' });
    expect(noticeTarget({ type: 'open', screen: { name: 'nope' } })).toEqual({ to: 'today' });
    expect(noticeTarget({ type: 'module', name: 'x', payload: 1 })).toEqual({ to: 'today' });
  });

  it('round-trips through the URL query and rejects hostile values', () => {
    const t = { to: 'discussions', ref: 'web#77', mr: '!12' };
    expect(targetFromSearch(`?${targetQuery(t)}`)).toBeNull();
    const ok = { to: 'discussions', ref: 'web#77', mr: 'mr-12' };
    expect(targetFromSearch(`?${targetQuery(ok)}`)).toEqual(ok);
    expect(targetFromSearch('?open=deep&ref=<script>')).toBeNull();
    expect(targetFromSearch('?open=javascript:alert(1)')).toBeNull();
    expect(targetFromSearch('')).toBeNull();
    expect(parseTarget({ to: 'deep' })).toBeNull();
  });
});

describe('push service', () => {
  interface Sent {
    url: string;
    headers: Record<string, string>;
    body: Buffer;
  }

  function setup(opts: { status?: number | (() => number); notificationsOn?: () => boolean } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'cer-push-'));
    const sent: Sent[] = [];
    const devices = ['dev1', 'dev2'];
    const transport: PushTransport = async (url, headers, body) => {
      sent.push({ url: url.href, headers, body });
      const status = typeof opts.status === 'function' ? opts.status() : (opts.status ?? 201);
      return { status } satisfies PushResponse;
    };
    const push = createPush({ dir, subject: 'https://coxia.acme.test/cerimonias/', deviceIds: () => devices, notificationsOn: opts.notificationsOn ?? (() => true), transport, retryDelayMs: 0 });
    return { dir, sent, devices, push };
  }

  const sub = (n: number, r = receiver()) => ({ r, sub: { endpoint: `https://fcm.googleapis.com/fcm/send/dev${n}`, keys: r.keys } });

  const open = (sent: Sent, r: ReturnType<typeof receiver>): PushPayload =>
    JSON.parse(decrypt(sent.body, fromB64u(b64u(r.ecdh.getPrivateKey())), r.ecdh.getPublicKey(), r.auth).toString()) as PushPayload;

  it('sends a notice encrypted with the subscriber keys, with VAPID, TTL, urgency and topic', async () => {
    const { push, sent, dir } = setup();
    const a = sub(1);
    push.subscribe('dev1', a.sub);
    expect(statSync(join(dir, 'web-push.json')).mode & 0o777).toBe(0o600);
    push.notify({ title: 'Bloqueio novo na #12', body: 'Falta revisão', onClick: { type: 'deep', card: { ref: 'web#12' } as never } });
    await push.flush();
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.url).toBe(a.sub.endpoint);
    expect(m.headers['Content-Encoding']).toBe('aes128gcm');
    expect(m.headers.Urgency).toBe('high');
    expect(Number(m.headers.TTL)).toBeGreaterThan(0);
    expect(m.headers.Topic.length).toBeLessThanOrEqual(32);
    expect(m.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(m.headers.Authorization.endsWith(`k=${push.publicKey()}`)).toBe(true);
    const payload = open(m, a.r);
    expect(payload).toMatchObject({ v: 1, title: 'Bloqueio novo na #12', body: 'Falta revisão', target: { to: 'deep', ref: 'web#12' } });
    expect(JSON.stringify(payload).length).toBeLessThan(600);
  });

  it('does nothing when the notifications setting is off, but the test still goes out', async () => {
    const { push, sent } = setup({ notificationsOn: () => false });
    push.subscribe('dev1', sub(1).sub);
    push.notify({ title: 'x', body: 'y', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(sent).toHaveLength(0);
    await push.test('dev1');
    expect(sent).toHaveLength(1);
    await expect(push.test('dev1')).rejects.toThrow(/Espere/);
  });

  it('coalesces a burst into one summary and keeps small batches separate', async () => {
    const { push, sent } = setup();
    const a = sub(1);
    push.subscribe('dev1', a.sub);
    for (let i = 0; i < 2; i++) push.notify({ title: `n${i}`, body: 'b', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(sent).toHaveLength(2);
    sent.length = 0;
    for (let i = 0; i < 6; i++) push.notify({ title: `n${i}`, body: 'b', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(sent).toHaveLength(1);
    expect(open(sent[0], a.r)).toMatchObject({ title: '6 notificações novas', target: { to: 'today' } });
  });

  it('caps the pushes per device per hour', async () => {
    const { push, sent } = setup();
    push.subscribe('dev1', sub(1).sub);
    for (let i = 0; i < 60; i++) {
      push.notify({ title: `n${i}`, body: 'b', onClick: { type: 'navigate', to: 'today' } });
      await push.flush();
    }
    expect(sent).toHaveLength(40);
  });

  it('drops a subscription when the push service answers 404 or 410', async () => {
    for (const code of [404, 410]) {
      const { push, dir } = setup({ status: code });
      push.subscribe('dev1', sub(1).sub);
      push.notify({ title: 'x', body: 'y', onClick: { type: 'navigate', to: 'today' } });
      await push.flush();
      expect(push.status('dev1').subscribed).toBe(false);
      expect(createPush({ dir, subject: 's', deviceIds: () => ['dev1'], notificationsOn: () => true }).status('dev1').subscribed).toBe(false);
    }
  });

  it('retries once on a 5xx and then gives up without dropping the subscription', async () => {
    let calls = 0;
    const { push } = setup({ status: () => (++calls === 1 ? 503 : 201) });
    push.subscribe('dev1', sub(1).sub);
    push.notify({ title: 'x', body: 'y', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(calls).toBe(2);
    expect(push.status('dev1').subscribed).toBe(true);
  });

  it('reports a failed test instead of pretending', async () => {
    const { push } = setup({ status: 403 });
    push.subscribe('dev1', sub(1).sub);
    await expect(push.test('dev1')).rejects.toThrow(/não aceitou/);
    expect(push.status('dev1').subscribed).toBe(true);
  });

  it('ties a subscription to its device: one per device, gone with the device or when its session disappears', async () => {
    const { push, devices, sent, dir } = setup();
    const a = sub(1);
    const b = sub(2);
    push.subscribe('dev1', a.sub);
    push.subscribe('dev2', b.sub);
    push.subscribe('dev1', sub(3).sub, a.sub.endpoint);
    expect(push.status('dev1', 'https://fcm.googleapis.com/fcm/send/dev3').subscribed).toBe(true);
    expect(push.status('dev1', a.sub.endpoint).subscribed).toBe(false);
    push.removeDevice('dev2');
    expect(push.status('dev2').subscribed).toBe(false);
    devices.splice(0, devices.length);
    push.notify({ title: 'x', body: 'y', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(sent).toHaveLength(0);
    expect(createPush({ dir, subject: 's', deviceIds: () => ['dev1'], notificationsOn: () => true }).status('dev1').subscribed).toBe(false);
  });

  it('refuses endpoints outside the allowlist and malformed keys, and never calls out', async () => {
    const { push, sent } = setup();
    const r = receiver();
    expect(() => push.subscribe('dev1', { endpoint: 'https://evil.example/x', keys: r.keys })).toThrow(/não aceita/);
    expect(() => push.subscribe('dev1', { endpoint: 'http://127.0.0.1:9/x', keys: r.keys })).toThrow();
    expect(() => push.subscribe('dev1', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'AAAA', auth: r.keys.auth } })).toThrow(/inválida/);
    expect(() => push.subscribe('dev1', null)).toThrow();
    push.notify({ title: 'x', body: 'y', onClick: { type: 'navigate', to: 'today' } });
    await push.flush();
    expect(sent).toHaveLength(0);
  });
});
