import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LegacySecretSeed } from '../shared/config/legacy';
import { t } from '../shared/i18n';
import { DATA_ROOT } from './env';
import { SecretError, type CryptoPort, type SecretsStore, createSecretsStore } from './secrets-core';
import { type TestEnvLedger, createTestEnvLedger } from './testEnv';

// The host's encryption, read at every use and never kept: the desktop fills it with the OS keychain (electronPorts.ts), a headless host with a
// master key file (masterKey.ts). Without a port nothing encrypts: stored values are refused outright instead of falling back to a plain file.
let cryptoPort: CryptoPort | null = null;

/** Fills the encryption the host gives. Null goes back to the closed default: no encryption, no storage of values. */
export function setCryptoPort(port: CryptoPort | null): void {
  cryptoPort = port;
}

const withoutPort: CryptoPort = {
  available: () => false,
  encrypt: () => {
    throw new SecretError('unavailable', t('main.secrets.noKeychainDecrypt'));
  },
  decrypt: () => {
    throw new SecretError('unavailable', t('main.secrets.noKeychainDecrypt'));
  },
  backend: () => null,
};

// A fixed forwarder, so the host may fill the port after the first call of secrets() without the store being rebuilt. unavailableReason is empty
// when the port has none of its own: the store then keeps its own wording (the desktop's messages are what they have always been).
const cryptoForwarder: CryptoPort = {
  available: () => (cryptoPort ?? withoutPort).available(),
  encrypt: (text) => (cryptoPort ?? withoutPort).encrypt(text),
  decrypt: (data) => (cryptoPort ?? withoutPort).decrypt(data),
  backend: () => (cryptoPort ?? withoutPort).backend(),
  unavailableReason: () => cryptoPort?.unavailableReason?.() ?? '',
};

let store: SecretsStore | null = null;
let ledger: TestEnvLedger | null = null;

export function secrets(): SecretsStore {
  store ??= createSecretsStore({
    root: DATA_ROOT,
    crypto: cryptoForwarder,
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