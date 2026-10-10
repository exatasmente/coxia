import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { createSecretsStore, type CryptoPort } from '../src/main/secrets-core';
import { maskerFor } from '../src/main/maskExact';
import { formsOfValues, registerTestEnvForms, testEnvScanActive, testEnvTextProblem } from '../src/main/testEnv';
import { assertNoTestEnvLeak } from '../src/main/actions';

// The Actions door: while a test environment is live, no write going out (a commit, a pull-request body) carries one of its exact forms, and the reason
// names what was found without the value; every shape passes when no test environment is live.

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const VALUE = 'a real token value 7777';
const command = (body: string) => ({ via: 'gh' as const, method: 'POST' as const, endpoint: '/projects/group/project/merge_requests', fields: { body } });

it('nothing is under the scan when no stage is live', () => {
  expect(testEnvScanActive()).toBe(false);
  expect(testEnvTextProblem(`x ${VALUE}`)).toBeNull();
  expect(() => assertNoTestEnvLeak(command(`x ${VALUE}`))).not.toThrow();
});

describe('while a stage carries the environment', () => {
  it('registers, refuses an exact hit with a reason that never echoes the value, and unregisters at the end', () => {
    const stop = registerTestEnvForms(formsOfValues([VALUE]));
    expect(testEnvScanActive()).toBe(true);
    expect(() => assertNoTestEnvLeak(command(`harmless text`))).not.toThrow();
    expect(() => assertNoTestEnvLeak(command(`this one ${VALUE} leaks`))).toThrow(/raw form/);
    expect(testEnvTextProblem(`header ${encodeURIComponent(VALUE)}`)).toMatch(/URL-encoded/);
    const JSONY = 'tok"en\\7777';
    const stopJson = registerTestEnvForms(formsOfValues([JSONY]));
    expect(testEnvTextProblem(JSON.stringify({ key: JSONY }))).toMatch(/JSON-escaped/);
    stopJson();
    stop();
    expect(testEnvScanActive()).toBe(false);
    expect(() => assertNoTestEnvLeak(command(`x ${VALUE}`))).not.toThrow();
  });

  it('ignores forms too short to be recognized on purpose', () => {
    const stop = registerTestEnvForms(formsOfValues(['ab']));
    expect(testEnvScanActive()).toBe(false);
    stop();
  });
});

describe('the masker and the scan come from the same resolution', () => {
  const keychain: CryptoPort = {
    available: () => true,
    encrypt: (text) => Buffer.from(text),
    decrypt: (data) => data.toString(),
    backend: () => 'test',
  };

  it('a value that did not resolve was never handed out, so it cannot leak', () => {
    const secrets = createSecretsStore({
      root: mkdtempSync(join(tmpdir(), 'cerimonias-door-')),
      crypto: keychain,
      env: {},
      home: '/home/ana',
      now: () => new Date('2026-10-02T12:00:00Z'),
      run: () => {
        throw new Error('never run');
      },
      exists: () => false,
    });
    secrets.set({ ref: 'test.thing', source: 'stored', value: VALUE });
    const { masker, done } = maskerFor(['test.thing'], secrets);
    expect(done).toEqual([VALUE]);
    expect(masker(`got ${done[0]}`)).toBe('got [secret]');
  });
});
