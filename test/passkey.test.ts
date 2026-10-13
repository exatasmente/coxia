// Passkeys (#210): the WebAuthn verification, the store and the single-use challenges, with a software authenticator. No platform API and no network.
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContractError } from '../src/shared/contract';
import { ASSERTION_TTL_MS, CHALLENGE_TTL_MS, createPasskeys } from '../src/main/passkey';
import { FLAGS, fakeAuthenticator } from './helpers/fakeAuthenticator';

const ORIGIN = 'https://coxia.example.com';
const RP = 'coxia.example.com';

function setup(origin = ORIGIN) {
  const file = join(mkdtempSync(join(tmpdir(), 'cxpk-')), 'passkeys.json');
  let clock = 1_000_000;
  const store = createPasskeys({ file, now: () => clock });
  return { file, store, tick: (ms: number) => void (clock += ms), origin };
}

type Setup = ReturnType<typeof setup>;
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof ContractError ? e.code : `other:${String(e)}`;
  }
  return 'none';
};

function enroll(s: Setup, device = 'dev1', alg: 'ES256' | 'RS256' = 'ES256') {
  const auth = fakeAuthenticator(alg);
  s.store.allowEnroll(device);
  const { challengeId, options } = s.store.registerOptions({ deviceId: device, origin: ORIGIN, name: 'Pixel', paired: true });
  const challenge = (options as { challenge: string }).challenge;
  const view = s.store.register({ deviceId: device, challengeId, credential: auth.create({ challenge, origin: ORIGIN, rpId: RP }) });
  return { auth, view };
}

function assertion(s: Setup, auth: ReturnType<typeof fakeAuthenticator>, kind: string, over: Parameters<typeof auth.get>[0] extends infer O ? Partial<O> : never = {}, device = 'dev1') {
  const { challengeId, options } = s.store.assertOptions({ deviceId: device, origin: ORIGIN, kind });
  const challenge = (options as { challenge: string }).challenge;
  return { challengeId, credential: auth.get({ challenge, origin: ORIGIN, rpId: RP, ...over }) };
}

describe('registration', () => {
  it('registers an ES256 passkey and keeps the public key only, in a file of mode 0600', () => {
    const s = setup();
    const { view } = enroll(s);
    expect(view).toMatchObject({ deviceId: 'dev1', name: 'Pixel' });
    expect(s.store.hasPasskey('dev1')).toBe(true);
    expect(statSync(s.file).mode & 0o777).toBe(0o600);
    const raw = readFileSync(s.file, 'utf8');
    expect(raw).not.toContain('PRIVATE');
    expect(JSON.parse(raw).passkeys[0]).toMatchObject({ alg: -7, signCount: 0 });
    expect(s.store.list('dev2')).toEqual([]);
    // What a client sees never carries the key.
    expect(JSON.stringify(s.store.list())).not.toContain('publicKey');
  });

  it('registers an RS256 passkey too', () => {
    const s = setup();
    enroll(s, 'dev1', 'RS256');
    const { auth } = enroll(s, 'dev2', 'RS256');
    const a = assertion(s, auth, 'secret', {}, 'dev2');
    expect(s.store.assert({ deviceId: 'dev2', ...a }).kind).toBe('secret');
  });

  it('refuses a paired browser the computer has not allowed, and the allowance is spent by the registration', () => {
    const s = setup();
    expect(code(() => s.store.registerOptions({ deviceId: 'dev1', origin: ORIGIN, paired: true }))).toBe('forbidden');
    // The window needs no allowance.
    expect(code(() => s.store.registerOptions({ deviceId: 'desktop', origin: ORIGIN, paired: false }))).toBe('none');
    enroll(s);
    expect(code(() => s.store.registerOptions({ deviceId: 'dev1', origin: ORIGIN, paired: true }))).toBe('forbidden');
  });

  const registerWith = (s: Setup, make: (challenge: string, auth: ReturnType<typeof fakeAuthenticator>) => unknown) => {
    const auth = fakeAuthenticator();
    const { challengeId, options } = s.store.registerOptions({ deviceId: 'desktop', origin: ORIGIN, paired: false });
    return code(() => s.store.register({ deviceId: 'desktop', challengeId, credential: make((options as { challenge: string }).challenge, auth) }));
  };

  it('refuses a wrong challenge, origin, rpId, type, a missing user verification and a missing presence', () => {
    const s = setup();
    expect(registerWith(s, (_c, a) => a.create({ challenge: 'AAAA', origin: ORIGIN, rpId: RP }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: 'https://evil.example.com', rpId: RP }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: 'evil.example.com' }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: RP, type: 'webauthn.get' }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: RP, flags: FLAGS.up | FLAGS.at }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: RP, flags: FLAGS.uv | FLAGS.at }))).toBe('forbidden');
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: RP, flags: FLAGS.up | FLAGS.uv }))).toBe('forbidden');
    expect(registerWith(s, () => ({ id: 'x', response: { clientDataJSON: '!!', attestationObject: '!!' } }))).toBe('forbidden');
    expect(registerWith(s, () => null)).toBe('invalid-input');
    // Whatever failed, nothing was stored.
    expect(s.store.list()).toEqual([]);
    expect(registerWith(s, (c, a) => a.create({ challenge: c, origin: ORIGIN, rpId: RP }))).toBe('none');
  });

  it('refuses a challenge used twice, an expired one and one that belongs to another device', () => {
    const s = setup();
    const auth = fakeAuthenticator();
    const open = () => s.store.registerOptions({ deviceId: 'desktop', origin: ORIGIN, paired: false });
    const first = open();
    const cred = auth.create({ challenge: (first.options as { challenge: string }).challenge, origin: ORIGIN, rpId: RP });
    s.store.register({ deviceId: 'desktop', challengeId: first.challengeId, credential: cred });
    expect(code(() => s.store.register({ deviceId: 'desktop', challengeId: first.challengeId, credential: cred }))).toBe('forbidden');

    const late = open();
    s.tick(CHALLENGE_TTL_MS + 1);
    expect(code(() => s.store.register({ deviceId: 'desktop', challengeId: late.challengeId, credential: auth.create({ challenge: (late.options as { challenge: string }).challenge, origin: ORIGIN, rpId: RP }) }))).toBe('forbidden');

    const mine = open();
    expect(code(() => s.store.register({ deviceId: 'other', challengeId: mine.challengeId, credential: auth.create({ challenge: (mine.options as { challenge: string }).challenge, origin: ORIGIN, rpId: RP }) }))).toBe('forbidden');
  });

  it('refuses an origin that is not the one served', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cxpk-')), 'p.json');
    const store = createPasskeys({ file, originAllowed: (o) => o === ORIGIN });
    expect(code(() => store.registerOptions({ deviceId: 'desktop', origin: 'https://evil.example.com', paired: false }))).toBe('invalid-input');
    expect(code(() => store.registerOptions({ deviceId: 'desktop', origin: undefined, paired: false }))).toBe('invalid-input');
    expect(code(() => store.registerOptions({ deviceId: 'desktop', origin: `${ORIGIN}/path`, paired: false }))).toBe('invalid-input');
  });

  it('refuses a credential id that is already registered', () => {
    const s = setup();
    const { auth } = enroll(s);
    s.store.allowEnroll('dev2');
    const { challengeId, options } = s.store.registerOptions({ deviceId: 'dev2', origin: ORIGIN, paired: true });
    expect(code(() => s.store.register({ deviceId: 'dev2', challengeId, credential: auth.create({ challenge: (options as { challenge: string }).challenge, origin: ORIGIN, rpId: RP }) }))).toBe('conflict');
  });
});

describe('assertion', () => {
  it('verifies an assertion and hands out an assertion id bound to its kind, spent once', () => {
    const s = setup();
    const { auth } = enroll(s);
    const a = assertion(s, auth, 'secret');
    const done = s.store.assert({ deviceId: 'dev1', ...a });
    expect(done.kind).toBe('secret');
    expect(s.store.list('dev1')[0].lastUsedAt).not.toBeNull();
    expect(s.store.spend('dev1', done.assertionId, 'secret')).toBe(true);
    expect(s.store.spend('dev1', done.assertionId, 'secret')).toBe(false);
  });

  it('does not let an assertion serve another kind, another device or a later minute', () => {
    const s = setup();
    const { auth } = enroll(s);
    const make = () => s.store.assert({ deviceId: 'dev1', ...assertion(s, auth, 'secret') });
    const one = make();
    expect(s.store.spend('dev1', one.assertionId, 'budget')).toBe(false);
    // A wrong try does not burn it: it is the kind and the device that decide.
    expect(s.store.spend('dev2', one.assertionId, 'secret')).toBe(false);
    expect(s.store.spend('dev1', one.assertionId, 'secret')).toBe(true);
    const two = make();
    s.tick(ASSERTION_TTL_MS + 1);
    expect(s.store.spend('dev1', two.assertionId, 'secret')).toBe(false);
  });

  const refusedWith = (over: Record<string, unknown>, mutate?: (s: Setup, auth: ReturnType<typeof fakeAuthenticator>) => void): string => {
    const s = setup();
    const { auth } = enroll(s);
    mutate?.(s, auth);
    const a = assertion(s, auth, 'secret', over as never);
    return code(() => s.store.assert({ deviceId: 'dev1', ...a }));
  };

  it('refuses a wrong challenge, origin, rpId, type, signature and a missing user verification or presence', () => {
    expect(refusedWith({ challenge: 'AAAA' })).toBe('forbidden');
    expect(refusedWith({ origin: 'https://evil.example.com' })).toBe('forbidden');
    expect(refusedWith({ rpId: 'evil.example.com' })).toBe('forbidden');
    expect(refusedWith({ type: 'webauthn.create' })).toBe('forbidden');
    expect(refusedWith({ tamper: true })).toBe('forbidden');
    expect(refusedWith({ flags: FLAGS.up })).toBe('forbidden');
    expect(refusedWith({ flags: FLAGS.uv })).toBe('forbidden');
    expect(refusedWith({})).toBe('none');
  });

  it('refuses a counter that did not move forward, and accepts an authenticator that never counts', () => {
    const s = setup();
    const { auth } = enroll(s);
    s.store.assert({ deviceId: 'dev1', ...assertion(s, auth, 'secret', { counter: 5 }) });
    expect(code(() => s.store.assert({ deviceId: 'dev1', ...assertion(s, auth, 'secret', { counter: 5 }) }))).toBe('forbidden');
    expect(code(() => s.store.assert({ deviceId: 'dev1', ...assertion(s, auth, 'secret', { counter: 3 }) }))).toBe('forbidden');
    expect(code(() => s.store.assert({ deviceId: 'dev1', ...assertion(s, auth, 'secret', { counter: 6 }) }))).toBe('none');
    const z = setup();
    const zero = enroll(z);
    expect(code(() => z.store.assert({ deviceId: 'dev1', ...assertion(z, zero.auth, 'secret', { counter: 0 }) }))).toBe('none');
    expect(code(() => z.store.assert({ deviceId: 'dev1', ...assertion(z, zero.auth, 'secret', { counter: 0 }) }))).toBe('none');
  });

  it('refuses a key that is not this device\'s, and a challenge used twice', () => {
    const s = setup();
    const { auth } = enroll(s);
    const other = enroll(s, 'dev2');
    const a = assertion(s, other.auth, 'secret');
    expect(code(() => s.store.assert({ deviceId: 'dev1', ...a }))).toBe('forbidden');
    const b = assertion(s, auth, 'secret');
    s.store.assert({ deviceId: 'dev1', ...b });
    expect(code(() => s.store.assert({ deviceId: 'dev1', ...b }))).toBe('forbidden');
  });

  it('answers a registration challenge as no assertion, and refuses a device with no passkey and an unknown kind', () => {
    const s = setup();
    const { auth } = enroll(s);
    s.store.allowEnroll('dev2');
    const reg = s.store.registerOptions({ deviceId: 'dev2', origin: ORIGIN, paired: true });
    expect(code(() => s.store.assert({ deviceId: 'dev2', challengeId: reg.challengeId, credential: auth.get({ challenge: (reg.options as { challenge: string }).challenge, origin: ORIGIN, rpId: RP }) }))).toBe('forbidden');
    expect(code(() => s.store.assertOptions({ deviceId: 'dev3', origin: ORIGIN, kind: 'secret' }))).toBe('not-found');
    expect(code(() => s.store.assertOptions({ deviceId: 'dev1', origin: ORIGIN, kind: 'everything' }))).toBe('invalid-input');
  });

  it('forgets a device\'s passkeys when it goes, and removes one by id', () => {
    const s = setup();
    const { view } = enroll(s);
    enroll(s, 'dev2');
    expect(s.store.remove(view.id, 'dev2')).toBe(false);
    s.store.removeDevice('dev2');
    expect(s.store.hasPasskey('dev2')).toBe(false);
    expect(s.store.remove(view.id, 'dev1')).toBe(true);
    expect(s.store.hasPasskey('dev1')).toBe(false);
    // What is on disk follows.
    expect(JSON.parse(readFileSync(s.file, 'utf8')).passkeys).toEqual([]);
  });
});
