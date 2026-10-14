import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { t } from '../shared/i18n';
import { SecretError, type CryptoPort } from './secrets-core';
import { dataRoot } from './env';

// The encryption a host without a desktop gives: one master key, 32 bytes written as 64 hex digits and a newline in a file the host names.
// The file is checked on every operation and the key is never kept between them: whatever goes wrong goes wrong closed, and no message
// carries the key or what the file held. GCM is what makes a wrong key fail the open instead of returning something unreadable.

const GCM_IV = 12;
const GCM_TAG = 16;
const KEY_BYTES = 32;
const HEX_KEY = /^[0-9a-fA-F]{64}\n?$/;

/** The key when the file passes every check, null when it does not. `root` is the data folder it must stay out of: the process's own unless a one-shot tool (the import of a move) names it. */
export function readMasterKey(keyFile: string, dataFolder?: string): Buffer | null {
  try {
    const path = resolve(keyFile);
    const root = resolve(dataFolder ?? dataRoot());
    // The key travels outside the data root on purpose: the root is copied and moved between machines, and the key must not go with it.
    if (path === root || path.startsWith(root + sep)) return null;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    if ((stat.mode & 0o077) !== 0) return null;
    const raw = readFileSync(path, 'utf8');
    if (!HEX_KEY.test(raw)) return null;
    return Buffer.from(raw.trim(), 'hex');
  } catch {
    return null;
  }
}

const refused = (): never => {
  throw new SecretError('unavailable', t('main.secrets.keyFile'));
};

/** Encrypts under a key given as bytes, in the layout the port writes: IV, tag, ciphertext. A move re-encrypts stored secrets for another machine's key with it. */
export function gcmEncrypt(key: Buffer, text: string): Buffer {
  if (key.length !== KEY_BYTES) throw new SecretError('invalid', t('main.secrets.keyFile'));
  const iv = randomBytes(GCM_IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** The reverse of `gcmEncrypt`; null when the data is short or the key does not match the one that encrypted it (the GCM check fails, as for a tampered value). */
export function gcmDecrypt(key: Buffer, data: Buffer): string | null {
  if (data.length < GCM_IV + GCM_TAG) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, GCM_IV));
    decipher.setAuthTag(data.subarray(GCM_IV, GCM_IV + GCM_TAG));
    return Buffer.concat([decipher.update(data.subarray(GCM_IV + GCM_TAG)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** The crypto port backed by the master key in `keyFile`. Nothing here creates that file: a missing file is a closed refusal. */
export function masterKeyPort(keyFile: string): CryptoPort {
  const key = (): Buffer => readMasterKey(keyFile) ?? refused();
  return {
    available: () => readMasterKey(keyFile) !== null,
    encrypt: (text) => gcmEncrypt(key(), text),
    decrypt: (data) => gcmDecrypt(key(), data) ?? refused(),
    backend: () => null,
    unavailableReason: () => t('main.secrets.keyFile'),
  };
}
