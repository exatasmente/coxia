// The encryption a host without a desktop gives: a master key in a file it names. A stored secret round-trips with that key and is refused with a
// different one; a key file that is missing, open to others, a link, not a key, or inside the data root fails closed, and no message carries the key.
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { DATA_ROOT } from '../src/main/env';
import { masterKeyPort } from '../src/main/masterKey';
import { SECRETS_FILE, type SecretsStore, createSecretsStore } from '../src/main/secrets-core';

const VALUE = 'sk-this-is-a-test-value';

let root: string;
let keys: string;

const hexKey = (): string => randomBytes(32).toString('hex');

function writeKey(name: string, hex: string, mode = 0o600): string {
  const file = join(keys, name);
  writeFileSync(file, `${hex}\n`, { mode: 0o600 });
  chmodSync(file, mode);
  return file;
}

function store(keyFile: string): SecretsStore {
  return createSecretsStore({
    root,
    crypto: masterKeyPort(keyFile),
    env: {},
    home: '/home/example',
    now: () => new Date('2026-10-02T12:00:00Z'),
    run: () => '',
    exists: () => true,
  });
}

function refusedMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
}

/** A key file that fails a check: the state is unavailable and the refusal names the key file, never the key or what the file held. */
function expectClosed(keyFile: string, secretStuff: string[] = []): void {
  const port = masterKeyPort(keyFile);
  expect(port.available()).toBe(false);
  expect(store(keyFile).storage()).toMatchObject({ secure: false, canStore: false });
  const message = refusedMessage(() => store(keyFile).set({ ref: 'a', source: 'stored', value: VALUE }));
  expect(message).toMatch(/key file/);
  for (const stuff of secretStuff) expect(message).not.toContain(stuff);
}

// The assertions below read the English wording of the messages.
beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-masterkey-store-'));
  keys = mkdtempSync(join(tmpdir(), 'cerimonias-masterkey-'));
});

describe('a store on a master key', () => {
  it('round-trips a stored secret through the key file, keeping the secrets file as it always was', () => {
    const key = hexKey();
    const s = store(writeKey('key-a', key));
    s.set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    expect(s.resolve('llm.anthropic')).toBe(VALUE);
    const raw = readFileSync(join(root, SECRETS_FILE), 'utf8');
    expect(raw).toContain('"cipher"');
    expect(raw).not.toContain(VALUE);
    expect((statSync(join(root, SECRETS_FILE)).mode & 0o777).toString(8)).toBe('600');
  });

  it('refuses the same store file with a different key, and neither key appears in the message', () => {
    const key = hexKey();
    const other = hexKey();
    store(writeKey('key-a', key)).set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    const message = refusedMessage(() => store(writeKey('key-b', other)).resolve('llm.anthropic'));
    expect(message).toMatch(/key file/);
    expect(message).not.toContain(key);
    expect(message).not.toContain(other);
    expect(message).not.toContain(VALUE);
  });
});

describe('a key file that does not pass the checks', () => {
  it('is refused when it is missing', () => {
    expectClosed(join(keys, 'nothing-here'));
  });

  it('is refused when others can read it, and a stricter mode than 0600 is accepted', () => {
    const open = hexKey();
    expectClosed(writeKey('key-open', open, 0o644), [open]);
    const strict = hexKey();
    const s = store(writeKey('key-strict', strict, 0o400));
    s.set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    expect(s.resolve('llm.anthropic')).toBe(VALUE);
  });

  it('is refused when it is a link, even to a key file of its own', () => {
    const key = hexKey();
    writeKey('key-real', key);
    symlinkSync(join(keys, 'key-real'), join(keys, 'key-link'));
    expectClosed(join(keys, 'key-link'), [key]);
  });

  it('is refused when its content is not the key', () => {
    const garbage = 'not hex at all';
    const file = join(keys, 'key-garbage');
    writeFileSync(file, `${garbage}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    expectClosed(file, [garbage]);
    const short = hexKey().slice(0, 32);
    expectClosed(writeKey('key-short', short), [short]);
  });

  it('is refused inside the data root: the key must not travel with the data', () => {
    const key = hexKey();
    const file = join(DATA_ROOT, 'key.hex');
    writeFileSync(file, `${key}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    expectClosed(file, [key]);
  });
});