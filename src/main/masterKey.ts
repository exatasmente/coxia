import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { t } from '../shared/i18n';
import { SecretError, type CryptoPort } from './secrets-core';
import { DATA_ROOT } from './env';

// The encryption a host without a desktop gives: one master key, 32 bytes written as 64 hex digits and a newline in a file the host names.
// The file is checked on every operation and the key is never kept between them: whatever goes wrong goes wrong closed, and no message
// carries the key or what the file held. GCM is what makes a wrong key fail the open instead of returning something unreadable.

const GCM_IV = 12;
const GCM_TAG = 16;
const KEY_BYTES = 32;
const HEX_KEY = /^[0-9a-fA-F]{64}\n?$/;

/** The key when the file passes every check, null when it does not. */
function readMasterKey(keyFile: string): Buffer | null {
  try {
    const path = resolve(keyFile);
    const root = resolve(DATA_ROOT);
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

/** The crypto port backed by the master key in `keyFile`. Nothing here creates that file: a missing file is a closed refusal. */
export function masterKeyPort(keyFile: string): CryptoPort {
  const key = (): Buffer => readMasterKey(keyFile) ?? refused();
  return {
    available: () => readMasterKey(keyFile) !== null,
    encrypt(text) {
      const k = key();
      const iv = randomBytes(GCM_IV);
      const cipher = createCipheriv('aes-256-gcm', k, iv);
      const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decrypt(data) {
      const k = key();
      if (data.length < GCM_IV + GCM_TAG) return refused();
      try {
        const decipher = createDecipheriv('aes-256-gcm', k, data.subarray(0, GCM_IV));
        decipher.setAuthTag(data.subarray(GCM_IV, GCM_IV + GCM_TAG));
        return Buffer.concat([decipher.update(data.subarray(GCM_IV + GCM_TAG)), decipher.final()]).toString('utf8');
      } catch {
        // A key that does not match the one that encrypted the value fails the GCM check; a tampered value does too.
        return refused();
      }
    },
    backend: () => null,
    unavailableReason: () => t('main.secrets.keyFile'),
  };
}
