import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_TTL_MS,
  FAILS_GLOBAL,
  FAILS_PER_CODE,
  FAILS_PER_IP,
  FAIL_WINDOW_MS,
  SESSION_TTL_MS,
  createAuth,
  normalizeCode,
} from '../src/main/webAuth';

let clock = 0;
let file = '';
const now = () => clock;

beforeEach(() => {
  clock = 1_700_000_000_000;
  file = join(mkdtempSync(join(tmpdir(), 'cer-auth-')), 'web-sessions.json');
});

function status(fn: () => unknown): number | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AuthError ? e.status : -1;
  }
}

describe('pairing code', () => {
  it('has at least 10 characters from an unambiguous alphabet', () => {
    const { code } = createAuth(file, now).newPairingCode();
    const raw = normalizeCode(code);
    expect(raw.length).toBe(CODE_LENGTH);
    expect(CODE_LENGTH).toBeGreaterThanOrEqual(10);
    for (const c of raw) expect(CODE_ALPHABET).toContain(c);
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it('is single use', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    expect(auth.login(code, 'Pixel', '1.1.1.1').token).toBeTruthy();
    expect(status(() => auth.login(code, 'Outro', '1.1.1.1'))).toBe(401);
  });

  it('expires after 10 minutes', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    clock += CODE_TTL_MS + 1;
    expect(status(() => auth.login(code, 'Pixel', '1.1.1.1'))).toBe(401);
  });

  it('accepts what a person types: lowercase, dashes, spaces', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    expect(auth.login(` ${code.toLowerCase().replace(/-/g, ' ')} `, 'Pixel', '1.1.1.1').device.name).toBe('Pixel');
  });

  it('a new code replaces the previous one', () => {
    const auth = createAuth(file, now);
    const first = auth.newPairingCode().code;
    const second = auth.newPairingCode().code;
    expect(status(() => auth.login(first, 'x', '1.1.1.1'))).toBe(401);
    expect(auth.login(second, 'x', '1.1.1.1').token).toBeTruthy();
  });

  it('is locked after repeated failures, even for the right code', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    for (let i = 0; i < FAILS_PER_CODE; i++) expect(status(() => auth.login('WRONGCODE123', 'x', `9.9.${i}.1`))).toBe(401);
    expect(status(() => auth.login(code, 'x', '2.2.2.2'))).toBe(401);
    expect(auth.pairingPending()).toBeNull();
  });
});

describe('sessions', () => {
  it('stores only a SHA-256 hash of the token, in a private file', () => {
    const auth = createAuth(file, now);
    const { token } = auth.login(auth.newPairingCode().code, 'Pixel', '1.1.1.1');
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain(token);
    expect(JSON.parse(text).sessions[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(Buffer.from(token, 'base64url').length).toBe(32);
  });

  it('verifies the token and slides the 30 day expiry', () => {
    const auth = createAuth(file, now);
    const { token } = auth.login(auth.newPairingCode().code, 'Pixel', '1.1.1.1');
    clock += SESSION_TTL_MS - 1000;
    expect(auth.verify(token)?.name).toBe('Pixel');
    clock += SESSION_TTL_MS - 1000;
    expect(auth.verify(token)?.name).toBe('Pixel');
    clock += SESSION_TTL_MS + 1000;
    expect(auth.verify(token)).toBeNull();
  });

  it('rejects unknown, empty and oversized tokens', () => {
    const auth = createAuth(file, now);
    auth.login(auth.newPairingCode().code, 'Pixel', '1.1.1.1');
    expect(auth.verify('nope')).toBeNull();
    expect(auth.verify(undefined)).toBeNull();
    expect(auth.verify('x'.repeat(500))).toBeNull();
  });

  it('survives a restart and honors revocation', () => {
    const a = createAuth(file, now);
    const { token, device } = a.login(a.newPairingCode().code, 'Pixel', '1.1.1.1');
    const b = createAuth(file, now);
    expect(b.verify(token)?.id).toBe(device.id);
    expect(b.revoke(device.id)).toBe(true);
    expect(b.verify(token)).toBeNull();
    expect(createAuth(file, now).verify(token)).toBeNull();
  });

  it('lists devices without the hash', () => {
    const auth = createAuth(file, now);
    auth.login(auth.newPairingCode().code, '  Pixel\u0007  ', '1.1.1.1');
    const [device] = auth.list();
    expect(device.name).toBe('Pixel');
    expect(Object.keys(device).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'name']);
  });
});

describe('pairing and device upkeep', () => {
  it('cancelPairing invalidates the code on display', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    expect(auth.pairingPending()).not.toBeNull();
    auth.cancelPairing();
    expect(auth.pairingPending()).toBeNull();
    expect(status(() => auth.login(code, 'x', '1.1.1.1'))).toBe(401);
  });

  it('renames a device with a cleaned name and keeps it across restarts', () => {
    const auth = createAuth(file, now);
    const { device } = auth.login(auth.newPairingCode().code, 'Chrome em Android', '1.1.1.1');
    expect(auth.rename(device.id, '  Celular do Luiz\u0007 ')).toBe(true);
    expect(auth.rename('nope', 'x')).toBe(false);
    expect(createAuth(file, now).list()[0].name).toBe('Celular do Luiz');
  });
});

describe('rate limit', () => {
  it('blocks an IP after 5 failures in 15 minutes, and releases it after', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    for (let i = 0; i < FAILS_PER_IP; i++) expect(status(() => auth.login('AAAAAAAAAAAA', 'x', '3.3.3.3'))).toBe(401);
    expect(status(() => auth.login('AAAAAAAAAAAA', 'x', '3.3.3.3'))).toBe(429);
    expect(status(() => auth.login(code, 'x', '3.3.3.3'))).toBe(429);
    clock += FAIL_WINDOW_MS + 1;
    expect(auth.login(auth.newPairingCode().code, 'x', '3.3.3.3').token).toBeTruthy();
  });

  it('does not block other IPs for one IP failing', () => {
    const auth = createAuth(file, now);
    const { code } = auth.newPairingCode();
    for (let i = 0; i < FAILS_PER_IP; i++) status(() => auth.login('AAAAAAAAAAAA', 'x', '3.3.3.3'));
    expect(auth.login(code, 'x', '4.4.4.4').token).toBeTruthy();
  });

  it('has a global cap across IPs', () => {
    const auth = createAuth(file, now);
    for (let i = 0; i < FAILS_GLOBAL; i++) {
      auth.newPairingCode();
      status(() => auth.login('AAAAAAAAAAAA', 'x', `10.0.${i}.1`));
    }
    const { code } = auth.newPairingCode();
    expect(status(() => auth.login(code, 'x', '10.9.9.9'))).toBe(429);
  });
});
