import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Device } from '../shared/webAccess';

// No 0/O, 1/I/L: the code is read from a screen and typed on a phone.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 12;
export const CODE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const FAIL_WINDOW_MS = 15 * 60_000;
export const FAILS_PER_IP = 5;
export const FAILS_GLOBAL = 30;
export const FAILS_PER_CODE = 10;
const MAX_DEVICES = 20;
const FLUSH_EVERY_MS = 60_000;

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

interface StoredSession extends Device {
  tokenHash: string;
  expiresAt: number;
}

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest();

function same(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export function cleanDeviceName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return text || 'Navegador';
}

export interface Auth {
  newPairingCode(): { code: string; expiresAt: number };
  pairingPending(): { expiresAt: number } | null;
  cancelPairing(): void;
  rename(id: string, name: unknown): boolean;
  login(code: unknown, name: unknown, ip: string): { token: string; device: Device };
  verify(token: string | undefined): Device | null;
  list(): Device[];
  revoke(id: string): boolean;
  flush(): void;
}

export function createAuth(file: string, now: () => number = Date.now): Auth {
  let sessions: StoredSession[] = [];
  let pairing: { hash: Buffer; expiresAt: number; fails: number } | null = null;
  const fails = new Map<string, number[]>();
  let globalFails: number[] = [];
  let dirty = false;
  let flushedAt = 0;

  try {
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: StoredSession[] };
      sessions = (data.sessions ?? []).filter((s) => s.expiresAt > now());
    }
  } catch {
    sessions = [];
  }

  function flush(): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify({ sessions }, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    dirty = false;
    flushedAt = now();
  }

  const recent = (list: number[]): number[] => list.filter((t) => now() - t < FAIL_WINDOW_MS);

  function limit(ip: string): void {
    const own = recent(fails.get(ip) ?? []);
    globalFails = recent(globalFails);
    if (own.length >= FAILS_PER_IP || globalFails.length >= FAILS_GLOBAL) {
      const oldest = own.length >= FAILS_PER_IP ? own[0] : globalFails[0];
      throw new AuthError(429, 'Muitas tentativas. Aguarde alguns minutos.', Math.max(1, Math.ceil((oldest + FAIL_WINDOW_MS - now()) / 1000)));
    }
  }

  function fail(ip: string): never {
    fails.set(ip, [...recent(fails.get(ip) ?? []), now()]);
    if (fails.size > 1000) for (const [k, list] of fails) if (!recent(list).length) fails.delete(k);
    globalFails.push(now());
    if (pairing && ++pairing.fails >= FAILS_PER_CODE) pairing = null;
    throw new AuthError(401, 'Código inválido ou expirado.');
  }

  return {
    newPairingCode() {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      pairing = { hash: sha256(code), expiresAt: now() + CODE_TTL_MS, fails: 0 };
      return { code: formatCode(code), expiresAt: pairing.expiresAt };
    },

    pairingPending() {
      return pairing && pairing.expiresAt > now() ? { expiresAt: pairing.expiresAt } : null;
    },

    cancelPairing() {
      pairing = null;
    },

    rename(id, name) {
      const found = sessions.find((s) => s.id === id);
      if (!found) return false;
      found.name = cleanDeviceName(name);
      flush();
      return true;
    },

    login(code, name, ip) {
      limit(ip);
      const given = sha256(typeof code === 'string' ? normalizeCode(code) : '');
      const live = pairing && pairing.expiresAt > now() ? pairing : null;
      // Compared even with no live code, so the answer takes the same path either way.
      const ok = same(given, live?.hash ?? sha256(randomBytes(8).toString('hex')));
      if (!live || !ok) return fail(ip);
      pairing = null;
      const token = randomBytes(32).toString('base64url');
      const stamp = new Date(now()).toISOString();
      const session: StoredSession = {
        id: randomBytes(6).toString('hex'),
        name: cleanDeviceName(name),
        createdAt: stamp,
        lastSeenAt: stamp,
        tokenHash: sha256(token).toString('hex'),
        expiresAt: now() + SESSION_TTL_MS,
      };
      sessions = [...sessions, session].slice(-MAX_DEVICES);
      flush();
      return { token, device: toDevice(session) };
    },

    verify(token) {
      if (!token || token.length > 128) return null;
      const given = sha256(token);
      let found: StoredSession | null = null;
      for (const s of sessions) if (same(given, Buffer.from(s.tokenHash, 'hex'))) found = s;
      if (!found) return null;
      if (found.expiresAt <= now()) {
        sessions = sessions.filter((s) => s !== found);
        flush();
        return null;
      }
      found.expiresAt = now() + SESSION_TTL_MS;
      found.lastSeenAt = new Date(now()).toISOString();
      dirty = true;
      if (now() - flushedAt >= FLUSH_EVERY_MS) flush();
      return toDevice(found);
    },

    list() {
      return sessions.filter((s) => s.expiresAt > now()).map(toDevice);
    },

    revoke(id) {
      const before = sessions.length;
      sessions = sessions.filter((s) => s.id !== id);
      if (sessions.length === before) return false;
      flush();
      return true;
    },

    flush() {
      if (dirty) flush();
    },
  };
}

function toDevice(s: StoredSession): Device {
  return { id: s.id, name: s.name, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt };
}
