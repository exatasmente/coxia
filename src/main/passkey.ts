import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ContractError } from '../shared/contract';
import { t } from '../shared/i18n';
import { getSettings } from './config';
import { dataRoot } from './env';
import type { Module } from './module';
import { stepUpContext } from './passkeyContext';
import { isSensitiveKind, requireSensitive, setPasskeyHooks, type SensitiveKind } from './passkeyStepUp';
import { type Alg, PasskeyError, verifyAssertion, verifyRegistration } from './passkeyWebauthn';
import { setWebGate, viaOf } from './rpc';
import { STEP_UP } from './webPolicy';

// Passkeys of the admin devices (#210): the public keys per device, the single-use challenges and the short-lived assertions a sensitive call spends. The verification is in
// passkeyWebauthn.ts; the rule of who is asked is in passkeyStepUp.ts and webPolicy.ts. Docs: docs/passkeys.md.

export const CHALLENGE_TTL_MS = 2 * 60_000;
export const ASSERTION_TTL_MS = 60_000;
export const ENROLL_TTL_MS = 10 * 60_000;
const MAX_PER_DEVICE = 5;
const MAX_TOTAL = 50;
const MAX_PENDING = 100;
/** The device id of the window: it has no paired session, so its passkeys are kept under this name. */
export const DESKTOP_DEVICE = 'desktop';

export interface StoredPasskey {
  id: string;
  deviceId: string;
  name: string;
  alg: Alg;
  /** Public key only (SPKI DER, base64url). */
  publicKey: string;
  signCount: number;
  createdAt: string;
  lastUsedAt: string | null;
}

/** What a client may see of a passkey: never the key. */
export type PasskeyView = Pick<StoredPasskey, 'id' | 'deviceId' | 'name' | 'createdAt' | 'lastUsedAt'>;

const view = (p: StoredPasskey): PasskeyView => ({ id: p.id, deviceId: p.deviceId, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt });
const cleanName = (n: unknown): string => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '') || 'Passkey';
const bad = (code: ConstructorParameters<typeof ContractError>[0], key: Parameters<typeof t>[0]): ContractError => new ContractError(code, t(key));

interface Challenge {
  challenge: string;
  deviceId: string;
  purpose: 'register' | SensitiveKind;
  origin: string;
  expiresAt: number;
  name?: string;
}

export interface PasskeyDeps {
  file: string;
  now?: () => number;
  /** Refuses an origin the instance does not serve (the public URL when one is set). */
  originAllowed?: (origin: string) => boolean;
}

export interface Passkeys {
  hasPasskey(deviceId: string): boolean;
  list(deviceId?: string): PasskeyView[];
  allowEnroll(deviceId: string): { expiresAt: number };
  registerOptions(input: { deviceId: string; origin: string | undefined; name?: unknown; paired: boolean }): { challengeId: string; options: unknown };
  register(input: { deviceId: string; challengeId: unknown; credential: unknown }): PasskeyView;
  assertOptions(input: { deviceId: string; origin: string | undefined; kind: unknown }): { challengeId: string; options: unknown };
  assert(input: { deviceId: string; challengeId: unknown; credential: unknown }): { assertionId: string; expiresAt: number; kind: SensitiveKind };
  spend(deviceId: string, assertionId: string, kind: SensitiveKind): boolean;
  remove(id: string, deviceId?: string): boolean;
  removeDevice(deviceId: string): void;
}

const hostOf = (origin: string): string => new URL(origin).hostname;

function parseOrigin(origin: string | undefined, allowed: (o: string) => boolean): string {
  try {
    const u = new URL(origin ?? '');
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.origin !== origin || !allowed(u.origin)) throw new Error('origin');
    return u.origin;
  } catch {
    throw bad('invalid-input', 'main.passkey.badOrigin');
  }
}

export function createPasskeys(deps: PasskeyDeps): Passkeys {
  const now = deps.now ?? Date.now;
  const originAllowed = deps.originAllowed ?? (() => true);
  let stored: StoredPasskey[] = [];
  try {
    if (existsSync(deps.file)) stored = (JSON.parse(readFileSync(deps.file, 'utf8')) as { passkeys?: StoredPasskey[] }).passkeys ?? [];
  } catch {
    stored = [];
  }
  const challenges = new Map<string, Challenge>();
  const assertions = new Map<string, { deviceId: string; kind: SensitiveKind; expiresAt: number }>();
  const enrolling = new Map<string, number>();

  const flush = (): void => {
    mkdirSync(dirname(deps.file), { recursive: true });
    writeFileSync(`${deps.file}.tmp`, JSON.stringify({ passkeys: stored }, null, 2), { mode: 0o600 });
    renameSync(`${deps.file}.tmp`, deps.file);
  };
  const sweep = (): void => {
    for (const [k, c] of challenges) if (c.expiresAt <= now()) challenges.delete(k);
    for (const [k, a] of assertions) if (a.expiresAt <= now()) assertions.delete(k);
    for (const [k, e] of enrolling) if (e <= now()) enrolling.delete(k);
  };
  const open = (c: Omit<Challenge, 'challenge' | 'expiresAt'>): { challengeId: string; challenge: string } => {
    sweep();
    if (challenges.size >= MAX_PENDING) throw bad('rate-limited', 'main.passkey.tooMany');
    const challengeId = randomBytes(16).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    challenges.set(challengeId, { ...c, challenge, expiresAt: now() + CHALLENGE_TTL_MS });
    return { challengeId, challenge };
  };
  // Single use: the challenge is gone whether the answer verifies or not, so a failed try needs a new one.
  const take = (challengeId: unknown, deviceId: string, purpose: Challenge['purpose'] | 'any-assertion'): Challenge => {
    sweep();
    const c = typeof challengeId === 'string' ? challenges.get(challengeId) : undefined;
    if (typeof challengeId === 'string') challenges.delete(challengeId);
    if (!c || c.deviceId !== deviceId || (purpose === 'any-assertion' ? c.purpose === 'register' : c.purpose !== purpose)) throw bad('forbidden', 'main.passkey.badChallenge');
    return c;
  };
  const credentialOf = (credential: unknown): { id: string; response: Record<string, unknown> } => {
    const c = credential as { id?: unknown; response?: unknown } | null;
    if (!c || typeof c.id !== 'string' || !c.response || typeof c.response !== 'object') throw bad('invalid-input', 'main.passkey.badCredential');
    return { id: c.id, response: c.response as Record<string, unknown> };
  };
  const refused = (e: unknown): never => {
    if (e instanceof ContractError) throw e;
    // The reason word is for the log; the person reads one sentence.
    if (e instanceof PasskeyError) throw bad('forbidden', 'main.passkey.refused');
    throw bad('invalid-input', 'main.passkey.badCredential');
  };

  return {
    hasPasskey: (deviceId) => stored.some((p) => p.deviceId === deviceId),
    list: (deviceId) => stored.filter((p) => !deviceId || p.deviceId === deviceId).map(view),

    allowEnroll(deviceId) {
      sweep();
      const expiresAt = now() + ENROLL_TTL_MS;
      enrolling.set(deviceId, expiresAt);
      return { expiresAt };
    },

    registerOptions({ deviceId, origin, name, paired }) {
      sweep();
      // A paired browser enrolls only while the computer allows it: the pairing code alone must not make an admin.
      if (paired && !enrolling.has(deviceId)) throw bad('forbidden', 'main.passkey.enrollNotAllowed');
      const o = parseOrigin(origin, originAllowed);
      if (stored.length >= MAX_TOTAL || stored.filter((p) => p.deviceId === deviceId).length >= MAX_PER_DEVICE) throw bad('conflict', 'main.passkey.tooMany');
      const label = cleanName(name);
      const { challengeId, challenge } = open({ deviceId, purpose: 'register', origin: o, name: label });
      return {
        challengeId,
        options: {
          challenge,
          rp: { id: hostOf(o), name: 'Coxia' },
          user: { id: createHash('sha256').update(deviceId).digest().toString('base64url'), name: label, displayName: label },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
          attestation: 'none',
          excludeCredentials: stored.filter((p) => p.deviceId === deviceId).map((p) => ({ type: 'public-key', id: p.id })),
          timeout: CHALLENGE_TTL_MS,
        },
      };
    },

    register({ deviceId, challengeId, credential }) {
      const c = take(challengeId, deviceId, 'register');
      const { response } = credentialOf(credential);
      let done;
      try {
        done = verifyRegistration(response as never, { challenge: c.challenge, origin: c.origin, rpId: hostOf(c.origin) });
      } catch (e) {
        return refused(e);
      }
      if (stored.some((p) => p.id === done.credentialId)) throw bad('conflict', 'main.passkey.duplicate');
      const entry: StoredPasskey = { id: done.credentialId, deviceId, name: c.name ?? 'Passkey', alg: done.alg, publicKey: done.publicKey, signCount: done.signCount, createdAt: new Date(now()).toISOString(), lastUsedAt: null };
      stored = [...stored, entry];
      enrolling.delete(deviceId);
      flush();
      return view(entry);
    },

    assertOptions({ deviceId, origin, kind }) {
      if (!isSensitiveKind(kind)) throw bad('invalid-input', 'main.passkey.badKind');
      const mine = stored.filter((p) => p.deviceId === deviceId);
      if (!mine.length) throw bad('not-found', 'main.passkey.none');
      const o = parseOrigin(origin, originAllowed);
      const { challengeId, challenge } = open({ deviceId, purpose: kind, origin: o });
      return { challengeId, options: { challenge, rpId: hostOf(o), allowCredentials: mine.map((p) => ({ type: 'public-key', id: p.id })), userVerification: 'required', timeout: CHALLENGE_TTL_MS } };
    },

    assert({ deviceId, challengeId, credential }) {
      const c = take(challengeId, deviceId, 'any-assertion');
      const { id, response } = credentialOf(credential);
      const key = stored.find((p) => p.id === id && p.deviceId === deviceId);
      if (!key) throw bad('forbidden', 'main.passkey.refused');
      let result;
      try {
        result = verifyAssertion(response as never, { challenge: c.challenge, origin: c.origin, rpId: hostOf(c.origin) }, key);
      } catch (e) {
        return refused(e);
      }
      key.signCount = result.signCount;
      key.lastUsedAt = new Date(now()).toISOString();
      flush();
      const kind = c.purpose as SensitiveKind;
      const assertionId = randomBytes(24).toString('base64url');
      const expiresAt = now() + ASSERTION_TTL_MS;
      assertions.set(assertionId, { deviceId, kind, expiresAt });
      return { assertionId, expiresAt, kind };
    },

    // Bound to the device and the kind, single use, and gone after its minute.
    spend(deviceId, assertionId, kind) {
      sweep();
      const a = assertions.get(assertionId);
      if (!a) return false;
      if (a.deviceId !== deviceId || a.kind !== kind) return false;
      assertions.delete(assertionId);
      return true;
    },

    remove(id, deviceId) {
      const before = stored.length;
      stored = stored.filter((p) => !(p.id === id && (!deviceId || p.deviceId === deviceId)));
      if (stored.length === before) return false;
      flush();
      return true;
    },

    removeDevice(deviceId) {
      const before = stored.length;
      stored = stored.filter((p) => p.deviceId !== deviceId);
      enrolling.delete(deviceId);
      if (stored.length !== before) flush();
    },
  };
}

let instance: Passkeys | null = null;

/** The process's passkeys, opened on first use under the data root (nothing is read at import). */
export const passkeys = (): Passkeys =>
  (instance ??= createPasskeys({
    file: join(dataRoot(), 'passkeys.json'),
    originAllowed: (origin) => {
      const url = getSettings().web.publicUrl;
      try {
        return !url || new URL(url).origin === origin;
      } catch {
        return true;
      }
    },
  }));

/** For tests that open a data folder of their own. */
export const resetPasskeys = (): void => {
  instance = null;
};

export const passkeyModule: Module = (ctx) => {
  // The device the call belongs to: a paired browser's session, or the window.
  const who = () => {
    const step = stepUpContext.getStore();
    return { deviceId: step?.deviceId ?? DESKTOP_DEVICE, origin: step?.origin, paired: viaOf() === 'paired' };
  };
  setPasskeyHooks({ spend: (d, a, k) => passkeys().spend(d, a, k), hasPasskey: (d) => passkeys().hasPasskey(d) });
  setWebGate((channel) => {
    const kind = STEP_UP.get(channel);
    if (kind) requireSensitive(kind, channel);
  });

  ctx.handle('passkey:register-options', (name?: unknown) => passkeys().registerOptions({ ...who(), name }));
  ctx.handle('passkey:register', (challengeId: unknown, credential: unknown) => passkeys().register({ deviceId: who().deviceId, challengeId, credential }));
  ctx.handle('passkey:assert-options', (kind: unknown) => passkeys().assertOptions({ ...who(), kind }));
  ctx.handle('passkey:assert', (challengeId: unknown, credential: unknown) => passkeys().assert({ deviceId: who().deviceId, challengeId, credential }));
  // A paired browser lists its own device's passkeys; the window and the admin socket list all.
  ctx.handle('passkey:list', () => passkeys().list(who().paired ? who().deviceId : undefined));
  ctx.handle('passkey:remove', (id: unknown) => {
    const { paired, deviceId } = who();
    if (typeof id !== 'string') throw bad('invalid-input', 'main.passkey.badCredential');
    return passkeys().remove(id, paired ? deviceId : undefined);
  });
  // The computer lets a paired device register its first passkey; a browser never reaches it (webPolicy.ts).
  ctx.handle('passkey:enroll-allow', (deviceId: unknown) => {
    if (typeof deviceId !== 'string' || !deviceId) throw bad('invalid-input', 'main.passkey.badCredential');
    return passkeys().allowEnroll(deviceId);
  });
};
