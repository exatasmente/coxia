import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from 'node:crypto';

// WebAuthn verification with node:crypto alone (no dependency). Only what a passkey step-up needs: the registration of an ES256 or RS256 key and the
// assertion made with it. The attestation statement is not checked: a passkey here proves "the same authenticator as at registration", it does not
// vouch for the authenticator model, so there is no certificate chain to trust.

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;
export type Alg = typeof ALG_ES256 | typeof ALG_RS256;

/** A verification failure: `reason` is a stable word for tests and the audit, never shown as is. */
export class PasskeyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'PasskeyError';
  }
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();
const fromB64 = (s: unknown, what: string): Buffer => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new PasskeyError(`malformed:${what}`);
  return Buffer.from(s, 'base64url');
};
const same = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

type Cbor = number | bigint | Buffer | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;

// A small CBOR reader: the attestation object and the COSE key use maps, arrays, byte and text strings and integers, nothing else.
function readCbor(buf: Buffer, at: number, depth = 0): [Cbor, number] {
  if (depth > 8 || at >= buf.length) throw new PasskeyError('malformed:cbor');
  const initial = buf[at++];
  const major = initial >> 5;
  const info = initial & 31;
  let len: number;
  if (info < 24) len = info;
  else if (info === 24) { len = buf[at]; at += 1; }
  else if (info === 25) { len = buf.readUInt16BE(at); at += 2; }
  else if (info === 26) { len = buf.readUInt32BE(at); at += 4; }
  else if (major === 7) len = 0;
  else throw new PasskeyError('malformed:cbor');
  if (Number.isNaN(len)) throw new PasskeyError('malformed:cbor');
  switch (major) {
    case 0: return [len, at];
    case 1: return [-1 - len, at];
    case 2:
    case 3: {
      if (at + len > buf.length) throw new PasskeyError('malformed:cbor');
      const bytes = buf.subarray(at, at + len);
      return [major === 2 ? Buffer.from(bytes) : bytes.toString('utf8'), at + len];
    }
    case 4: {
      const out: Cbor[] = [];
      for (let i = 0; i < len; i++) { const [v, n] = readCbor(buf, at, depth + 1); out.push(v); at = n; }
      return [out, at];
    }
    case 5: {
      const out = new Map<Cbor, Cbor>();
      for (let i = 0; i < len; i++) {
        const [k, n1] = readCbor(buf, at, depth + 1);
        const [v, n2] = readCbor(buf, n1, depth + 1);
        out.set(k, v);
        at = n2;
      }
      return [out, at];
    }
    case 7: return [info === 20 ? false : info === 21 ? true : null, at];
    default: throw new PasskeyError('malformed:cbor');
  }
}

interface AuthData {
  rpIdHash: Buffer;
  flags: number;
  signCount: number;
  attested?: { credentialId: Buffer; cose: Map<Cbor, Cbor> };
}

function parseAuthData(data: Buffer, withCredential: boolean): AuthData {
  if (data.length < 37) throw new PasskeyError('malformed:authData');
  const out: AuthData = { rpIdHash: data.subarray(0, 32), flags: data[32], signCount: data.readUInt32BE(33) };
  if (withCredential) {
    if (!(out.flags & FLAG_AT) || data.length < 55) throw new PasskeyError('no-credential-data');
    const idLen = data.readUInt16BE(53);
    if (idLen === 0 || idLen > 1023 || data.length < 55 + idLen) throw new PasskeyError('malformed:authData');
    const [cose] = readCbor(data, 55 + idLen);
    if (!(cose instanceof Map)) throw new PasskeyError('malformed:key');
    out.attested = { credentialId: Buffer.from(data.subarray(55, 55 + idLen)), cose };
  }
  return out;
}

function checkClientData(raw: Buffer, type: string, challenge: string, origin: string): void {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new PasskeyError('malformed:clientData');
  }
  if (data.type !== type) throw new PasskeyError('wrong-type');
  if (typeof data.challenge !== 'string' || !same(Buffer.from(data.challenge), Buffer.from(challenge))) throw new PasskeyError('wrong-challenge');
  if (data.origin !== origin) throw new PasskeyError('wrong-origin');
  if (data.crossOrigin === true) throw new PasskeyError('cross-origin');
}

function checkAuthData(a: AuthData, rpId: string): void {
  if (!same(a.rpIdHash, sha256(Buffer.from(rpId)))) throw new PasskeyError('wrong-rp');
  if (!(a.flags & FLAG_UP)) throw new PasskeyError('no-presence');
  // The biometric or PIN is the point of the step-up: a key touch without verification is refused.
  if (!(a.flags & FLAG_UV)) throw new PasskeyError('no-user-verification');
}

function keyFromCose(cose: Map<Cbor, Cbor>): { alg: Alg; key: KeyObject } {
  const num = (k: number): Cbor | undefined => cose.get(k);
  const buf = (k: number): Buffer => {
    const v = num(k);
    if (!(v instanceof Buffer)) throw new PasskeyError('malformed:key');
    return v;
  };
  try {
    if (num(3) === ALG_ES256 && num(1) === 2 && num(-1) === 1) {
      const x = buf(-2);
      const y = buf(-3);
      if (x.length !== 32 || y.length !== 32) throw new PasskeyError('malformed:key');
      return { alg: ALG_ES256, key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') }, format: 'jwk' }) };
    }
    if (num(3) === ALG_RS256 && num(1) === 3) {
      const n = buf(-1);
      if (n.length < 256) throw new PasskeyError('weak-key');
      return { alg: ALG_RS256, key: createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: buf(-2).toString('base64url') }, format: 'jwk' }) };
    }
  } catch (e) {
    throw e instanceof PasskeyError ? e : new PasskeyError('malformed:key');
  }
  throw new PasskeyError('unsupported-algorithm');
}

export interface Expected {
  challenge: string;
  origin: string;
  rpId: string;
}

export interface Registered {
  credentialId: string;
  alg: Alg;
  /** SPKI DER, base64url: public material only. */
  publicKey: string;
  signCount: number;
}

export function verifyRegistration(response: { clientDataJSON: unknown; attestationObject: unknown }, expected: Expected): Registered {
  checkClientData(fromB64(response.clientDataJSON, 'clientData'), 'webauthn.create', expected.challenge, expected.origin);
  const [att] = readCbor(fromB64(response.attestationObject, 'attestation'), 0);
  const authData = att instanceof Map ? att.get('authData') : null;
  if (!(authData instanceof Buffer)) throw new PasskeyError('malformed:attestation');
  const parsed = parseAuthData(authData, true);
  checkAuthData(parsed, expected.rpId);
  const { alg, key } = keyFromCose(parsed.attested!.cose);
  return { credentialId: parsed.attested!.credentialId.toString('base64url'), alg, publicKey: (key.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64url'), signCount: parsed.signCount };
}

export interface KnownCredential {
  alg: Alg;
  publicKey: string;
  signCount: number;
}

/** Verifies an assertion against a stored credential and returns the new counter. */
export function verifyAssertion(response: { clientDataJSON: unknown; authenticatorData: unknown; signature: unknown }, expected: Expected, known: KnownCredential): { signCount: number } {
  const clientData = fromB64(response.clientDataJSON, 'clientData');
  checkClientData(clientData, 'webauthn.get', expected.challenge, expected.origin);
  const authData = fromB64(response.authenticatorData, 'authData');
  const parsed = parseAuthData(authData, false);
  checkAuthData(parsed, expected.rpId);
  const key = createPublicKey({ key: Buffer.from(known.publicKey, 'base64url'), format: 'der', type: 'spki' });
  const signed = Buffer.concat([authData, sha256(clientData)]);
  let ok = false;
  try {
    ok = verify('sha256', signed, key, fromB64(response.signature, 'signature'));
  } catch {
    ok = false;
  }
  if (!ok) throw new PasskeyError('bad-signature');
  // A counter that did not move forward means a cloned authenticator; both zero is an authenticator that does not count.
  if ((parsed.signCount !== 0 || known.signCount !== 0) && parsed.signCount <= known.signCount) throw new PasskeyError('counter-regressed');
  return { signCount: parsed.signCount };
}
