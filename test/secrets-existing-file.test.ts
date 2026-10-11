// A secrets file written before this change opens with no migration: same format, same 0600 mode, and reads never rewrite it. Also the registry
// behind secrets(): the host may fill the encryption port after the store is first used, and no port at all is a closed refusal.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { DATA_ROOT } from '../src/main/env';
import { SECRETS_FILE, type CryptoPort } from '../src/main/secrets-core';
import { secrets, setCryptoPort } from '../src/main/secrets';

const VALUE = 'sk-this-is-a-test-value';
const file = join(DATA_ROOT, SECRETS_FILE);

// The same stand-in the store's own tests use: "encrypts" by reversing and tagging, so a test can tell ciphertext from plain text.
const fakePort = (): CryptoPort => ({
  available: () => true,
  encrypt: (text) => Buffer.from(`enc:${[...text].reverse().join('')}`),
  decrypt: (data) => {
    const raw = data.toString();
    if (!raw.startsWith('enc:')) throw new Error('not ciphertext');
    return [...raw.slice(4)].reverse().join('');
  },
  backend: () => 'gnome_libsecret',
});

const cipherOf = (value: string): string => Buffer.from(`enc:${[...value].reverse().join('')}`).toString('base64');

/** A secrets file exactly in the shape the app writes today. */
function writeLegacyFile(): void {
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        warning: 'A copy of a secrets file as an existing install has it.',
        insecure: { accepted: false, acceptedAt: null },
        entries: { 'llm.anthropic': { source: { type: 'stored' }, cipher: cipherOf(VALUE), updatedAt: '2026-09-30T10:00:00.000Z' } },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

// The assertions below read the English wording of the messages.
beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => setCryptoPort(fakePort()));

describe('a secrets file of the existing format', () => {
  it('opens and resolves with no migration, and reads leave the file byte for byte alone', () => {
    writeLegacyFile();
    expect(secrets().resolve('llm.anthropic')).toBe(VALUE);
    const before = readFileSync(file);
    expect(secrets().list()).toHaveLength(1);
    expect(secrets().has('llm.anthropic')).toBe(true);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it('keeps its format and its mode through a write, and the entries of before still resolve', () => {
    writeLegacyFile();
    secrets().set({ ref: 'llm.openrouter', source: 'stored', value: 'second-value' });
    const data = JSON.parse(readFileSync(file, 'utf8')) as { version: number; warning: string; insecure: { accepted: boolean }; entries: Record<string, unknown> };
    expect(data.version).toBe(1);
    expect(typeof data.warning).toBe('string');
    expect(data.insecure.accepted).toBe(false);
    expect(data.entries['llm.anthropic']).toMatchObject({ source: { type: 'stored' } });
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
    expect(secrets().resolve('llm.anthropic')).toBe(VALUE);
    expect(secrets().resolve('llm.openrouter')).toBe('second-value');
  });
});

describe('the port registry behind the store', () => {
  it('honours a port that arrives after the store was first used', () => {
    setCryptoPort(null);
    expect(secrets().storage().secure).toBe(false);
    setCryptoPort(fakePort());
    secrets().set({ ref: 'late.port', source: 'stored', value: VALUE });
    expect(secrets().resolve('late.port')).toBe(VALUE);
    expect(secrets().storage()).toMatchObject({ secure: true, canStore: true });
  });

  it('is closed with no port: no encryption, no stored value, and no value in the refusal', () => {
    secrets().set({ ref: 'closed.case', source: 'stored', value: VALUE });
    setCryptoPort(null);
    expect(secrets().storage()).toMatchObject({ secure: false, insecureAccepted: false, canStore: false });
    expect(() => secrets().set({ ref: 'closed.case', source: 'stored', value: 'again' })).toThrow(expect.objectContaining({ code: 'insecure-refused' }));
    expect(() => secrets().resolve('closed.case')).toThrow(/keychain is not available/);
    expect(secrets().check('closed.case')).toEqual({ ok: false, reason: expect.stringContaining('keychain') });
  });
});