import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';

// Web Push without dependencies: VAPID (RFC 8292) and message encryption aes128gcm (RFC 8291 / RFC 8188).

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

function privateKeyObject(keys: VapidKeys) {
  const pub = fromB64u(keys.publicKey);
  return createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
}

/** ES256 JWT for the push service of `audience` (its origin). Signature in raw r||s form, as JWS wants. */
export function vapidJwt(keys: VapidKeys, audience: string, subject: string, expSec: number): string {
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: audience, exp: expSec, sub: subject })));
  const data = `${head}.${claims}`;
  const sig = sign('sha256', Buffer.from(data), { key: privateKeyObject(keys), dsaEncoding: 'ieee-p1363' });
  return `${data}.${b64u(sig)}`;
}

export const vapidAuthorization = (jwt: string, publicKey: string): string => `vapid t=${jwt}, k=${publicKey}`;

export interface PushKeys {
  p256dh: string;
  auth: string;
}

// One record: 4096 bytes minus the 16-byte tag and the delimiter octet.
export const MAX_PLAINTEXT = 4096 - 16 - 1;
const RECORD_SIZE = 4096;

export function validPushKeys(keys: PushKeys): boolean {
  try {
    const ua = fromB64u(keys.p256dh);
    if (ua.length !== 65 || ua[0] !== 0x04 || fromB64u(keys.auth).length !== 16) return false;
    // computeSecret throws when the point is not on the curve.
    const probe = createECDH('prime256v1');
    probe.generateKeys();
    probe.computeSecret(ua);
    return true;
  } catch {
    return false;
  }
}

export interface EncryptOptions {
  salt?: Buffer;
  // Injected only by tests that replay the RFC vector.
  senderPrivate?: Buffer;
}

/** Encrypts `plaintext` for one subscription into the aes128gcm body (header + single record). */
export function encryptPayload(plaintext: Buffer, keys: PushKeys, opts: EncryptOptions = {}): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('Payload grande demais para um registro.');
  const ua = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  const sender = createECDH('prime256v1');
  if (opts.senderPrivate) sender.setPrivateKey(opts.senderPrivate);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const secret = sender.computeSecret(ua);
  const salt = opts.salt ?? randomBytes(16);

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ciphertext]);
}
