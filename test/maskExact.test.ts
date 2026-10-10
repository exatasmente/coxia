import { setLanguage } from '../src/shared/i18n';
import { beforeAll, describe, expect, it } from 'vitest';
import { afterAll } from 'vitest';
import { maskerFor, maskerFromResolved, secretForms, stageMasker } from '../src/main/maskExact';
import { createSecretsStore, type CryptoPort, type SecretsStore } from '../src/main/secrets-core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The exact-value mask of a stage: every form of every resolved value — as it is, URL-encoded, JSON-escaped — is replaced before the pattern-based redaction runs.

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const VALUE = 'sk-ant-abc123def456ghij789';

describe('the forms of one value', () => {
  it('gives the value itself, its URL-encoded and its JSON-escaped form, longest first', () => {
    const forms = secretForms(VALUE);
    expect(forms).toContain(VALUE);
    expect(forms).toContain(encodeURIComponent(VALUE));
    expect(forms).toContain(JSON.stringify(VALUE).slice(1, -1));
    for (let i = 1; i < forms.length; i++) expect(forms[i - 1].length).toBeGreaterThanOrEqual(forms[i].length);
  });

  it('filters a value too short to mask and deduplicates when two forms are the same', () => {
    expect(secretForms('ab')).toStrictEqual([]);
  });

  it('keeps at least two different forms for a value that carries a space and special characters', () => {
    const forms = secretForms('my$ke.y a');
    expect(new Set(forms).size).toBeGreaterThanOrEqual(2);
  });
});

describe('the stage masker', () => {
  it('masks a raw occurrence with the same token the plugin requests use', () => {
    const mask = stageMasker(secretForms(VALUE));
    expect(mask(`echo ${VALUE}`)).toBe('echo [secret]');
    expect(mask('')).toBe('');
  });

  it('masks the URL-encoded form inside a URL', () => {
    const mask = stageMasker(secretForms(myValue()));
    expect(mask(`https://example.com/api?token=${encodeURIComponent(myValue())}`)).not.toContain(encodeURIComponent(myValue()));
  });

  it('masks the JSON-escaped form inside a JSON body', () => {
    const mask = stageMasker(secretForms(myValue()));
    const body = JSON.stringify({ key: myValue() });
    expect(mask(body)).not.toContain(JSON.stringify(myValue()).slice(1, -1));
  });

  it('masks every form in one text that carries them combined, longest first', () => {
    const mask = stageMasker(secretForms(myValue()));
    const text = [myValue(), encodeURIComponent(myValue()), JSON.stringify(myValue()).slice(1, -1)].join('|');
    const masked = mask(text);
    expect(masked).not.toContain(myValue());
    expect(masked.split('[secret]').length - 1).toBe(3);
  });

  const myValue = (): string => 'tok-super-secret-9999';
});

describe('the masker built from resolved values', () => {
  it('masks every value it was handed, in every form', () => {
    const mask = maskerFromResolved(myValues());
    const text = `${myValues()[0]} ${encodeURIComponent(myValues()[0])} ${JSON.stringify(myValues()[1]).slice(1, -1)}`;
    expect(mask(text)).not.toContain(myValues()[0]);
    expect(mask(text)).not.toContain(myValues()[1]);
  });

  it('runs the pattern-based redaction after the exact-value mask', () => {
    // A long opaque string with no known prefix: only the redact layer could take it.
    const opaque = 'a'.repeat(50) + '-789chk';
    const mask = maskerFromResolved([opaque]);
    expect(mask(`x ${opaque}`)).not.toContain(opaque);
  });

  const myValues = (): string[] => ['one-real-value-0001', 'other-real-value-002'];
});

describe('the masker built from references', () => {
  const keychain: CryptoPort = {
    available: () => true,
    encrypt: (text) => Buffer.from(text),
    decrypt: (data) => data.toString(),
    backend: () => 'test',
  };
  let secrets: SecretsStore;
  beforeAll(() => {
    secrets = createSecretsStore({
      root: mkdtempSync(join(tmpdir(), 'cerimonias-maske-')),
      crypto: keychain,
      env: {},
      home: '/home/ana',
      now: () => new Date('2026-10-02T12:00:00Z'),
      run: () => {
        throw new Error('never run');
      },
      exists: () => false,
    });
    secrets.set({ ref: 'test.thing', source: 'stored', value: 'stored-value-4242' });
  });

  it('masks what resolved and says which values it got', () => {
    const { masker, done } = maskerFor(['test.thing'], secrets);
    expect(done).toEqual(['stored-value-4242']);
    expect(masker(`got ${done[0]}`)).toBe('got [secret]');
  });
});
