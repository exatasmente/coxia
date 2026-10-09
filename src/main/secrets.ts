import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import type { LegacySecretSeed } from '../shared/config/legacy';
import { DATA_ROOT } from './env';
import { type CryptoPort, type SecretsStore, createSecretsStore } from './secrets-core';
import { type TestEnvLedger, createTestEnvLedger } from './testEnv';

// Electron's safeStorage encrypts with the OS keychain (libsecret / kwallet on Linux, Keychain on macOS, DPAPI on Windows).
// On Linux without a keyring it silently falls back to a hard-coded key ("basic_text"): that is not protection, so it counts as unavailable.
export const keychain: CryptoPort = {
  available: () => {
    try {
      if (!safeStorage?.isEncryptionAvailable()) return false;
      const backend = safeStorage.getSelectedStorageBackend?.();
      return backend !== 'basic_text' && backend !== 'unknown';
    } catch {
      return false;
    }
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data),
  backend: () => {
    try {
      return safeStorage.getSelectedStorageBackend?.() ?? null;
    } catch {
      return null;
    }
  },
};

let store: SecretsStore | null = null;
let ledger: TestEnvLedger | null = null;

export function secrets(): SecretsStore {
  store ??= createSecretsStore({
    root: DATA_ROOT,
    crypto: keychain,
    env: process.env,
    home: homedir(),
    now: () => new Date(),
    run: (command, args) => execFileSync(command, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }),
    exists: existsSync,
  });
  return store;
}

/** The person's once-per-entry confirmations of the test environment, in this computer's data folder (never in the configuration or an export). */
export function testEnvLedger(): TestEnvLedger {
  ledger ??= createTestEnvLedger(join(DATA_ROOT, 'test-env-approvals.json'));
  return ledger;
}

/** An install that already ran a key script keeps using it: the command of the legacy profile becomes the source of that secret. */
export function seedLegacySecrets(seeds: LegacySecretSeed[]): void {
  for (const s of seeds) if (!secrets().has(s.ref)) secrets().set({ ref: s.ref, source: 'command', command: s.command, args: s.args });
}
