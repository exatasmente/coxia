import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A software WebAuthn authenticator for tests: an ES256 (or RS256) key pair and the bytes a browser would hand over, built by hand. No platform API, nothing real.

const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();

type Item = number | Buffer | string | Item[] | Map<Item, Item>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function cbor(v: Item): Buffer {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') {
    const b = Buffer.from(v);
    return Buffer.concat([head(3, b.length), b]);
  }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

export const FLAGS = { up: 0x01, uv: 0x04, at: 0x40 };

export interface Authenticator {
  credentialId: string;
  privateKey: KeyObject;
  counter: number;
  create(o: { challenge: string; origin: string; rpId: string; flags?: number; type?: string; fmt?: string; credentialId?: Buffer }): { id: string; response: { clientDataJSON: string; attestationObject: string } };
  get(o: { challenge: string; origin: string; rpId: string; flags?: number; counter?: number; type?: string; tamper?: boolean }): { id: string; response: { clientDataJSON: string; authenticatorData: string; signature: string } };
}

export function fakeAuthenticator(alg: 'ES256' | 'RS256' = 'ES256'): Authenticator {
  const pair = alg === 'ES256' ? generateKeyPairSync('ec', { namedCurve: 'P-256' }) : generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = pair.publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const cose = alg === 'ES256'
    ? new Map<Item, Item>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
    : new Map<Item, Item>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]);
  const credentialId = randomBytes(32);
  const counterBytes = (n: number): Buffer => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  const self: Authenticator = {
    credentialId: credentialId.toString('base64url'),
    privateKey: pair.privateKey,
    counter: 0,
    create({ challenge, origin, rpId, flags = FLAGS.up | FLAGS.uv | FLAGS.at, type = 'webauthn.create', fmt = 'none', credentialId: override }) {
      const id = override ?? credentialId;
      const clientData = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const idLen = Buffer.alloc(2);
      idLen.writeUInt16BE(id.length);
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counterBytes(self.counter), Buffer.alloc(16), idLen, id, cbor(cose)]);
      const attestation = cbor(new Map<Item, Item>([['fmt', fmt], ['attStmt', new Map()], ['authData', authData]]));
      return { id: id.toString('base64url'), response: { clientDataJSON: clientData.toString('base64url'), attestationObject: attestation.toString('base64url') } };
    },
    get({ challenge, origin, rpId, flags = FLAGS.up | FLAGS.uv, counter, type = 'webauthn.get', tamper = false }) {
      self.counter = counter ?? self.counter + 1;
      const clientData = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counterBytes(self.counter)]);
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientData)]), pair.privateKey);
      if (tamper) signature[signature.length - 1] ^= 1;
      return { id: credentialId.toString('base64url'), response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') } };
    },
  };
  return self;
}
