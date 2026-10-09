import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { TestEnvironment, WorkspaceConfig } from '../src/shared/config/types';
import { createTestEnvLedger, resolveStageTestEnv, stageAllowsTestEnv, type ResolveStageTestEnvDeps } from '../src/main/testEnv';
import { createSecretsStore, type CryptoPort, SecretError, type SecretsStore } from '../src/main/secrets-core';

// The resolver of a stage's test environment: what the launcher gets once per launch, with every refusal named and never a thrown error.

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const keychain: CryptoPort = {
  available: () => true,
  encrypt: (text) => Buffer.from(text),
  decrypt: (data) => data.toString(),
  backend: () => 'test',
};

const theText = (): ResolveStageTestEnvDeps => ({
  confirmed: () => false,
  text: (key, params) => `${key}:${JSON.stringify(params ?? {})}`,
});

const env = (over: Partial<TestEnvironment> = {}): TestEnvironment => ({
  variables: [{ name: 'INTEGRATION_URL', value: 'https://staging.example.com' }],
  secrets: [],
  ...over,
});

let store: SecretsStore;
beforeAll(() => {
  store = createSecretsStore({
    root: mkdtempSync(join(tmpdir(), 'cerimonias-tenv-')),
    crypto: keychain,
    env: {},
    home: '/home/ana',
    now: () => new Date('2026-10-02T12:00:00Z'),
    run: () => {
      throw new Error('never run');
    },
    exists: () => false,
  });
  store.set({ ref: 'test.integration', source: 'stored', value: 'stored-integration-9999' });
});

const qa = { kind: 'qa' as const };

describe('when the stage receives the environment', () => {
  it('a declared field wins: on or off', () => {
    expect(stageAllowsTestEnv({ kind: 'work', testEnv: true })).toBe(true);
    expect(stageAllowsTestEnv({ kind: 'qa', testEnv: false })).toBe(false);
  });

  it('left out reads as a QA stage only', () => {
    expect(stageAllowsTestEnv({ kind: 'qa' })).toBe(true);
    expect(stageAllowsTestEnv({ kind: 'work' })).toBe(false);
  });

  it('a workspace without the section, or with an empty one, resolves nothing', () => {
    expect(resolveStageTestEnv(qa, undefined, store, theText())).toBeNull();
    expect(resolveStageTestEnv(qa, { variables: [], secrets: [] }, store, theText())).toMatchObject({ vars: {}, entries: [], values: [], refusals: [] });
  });

  it('variables go straight into the delivery map', () => {
    const r = resolveStageTestEnv(qa, env(), store, theText())!;
    expect(r.vars).toEqual({ INTEGRATION_URL: 'https://staging.example.com' });
    expect(r.values).toBe([]);
  });

  it('secrets are injected under the TEST_ name of their ref, and their values feed the masker', () => {
    const r = resolveStageTestEnv(qa, env({ secrets: [{ ref: 'test.integration', testOnly: true, hosts: ['staging.example.com'], privateHosts: [] }] }), store, theText())!;
    expect(r.vars).toBe({ TEST_INTEGRATION: 'stored-integration-9999' });
    expect(r.values).toEqual(['stored-integration-9999']);
    expect(r.hosts).toEqual(['staging.example.com']);
  });

  it('a reference the store cannot resolve is dropped with a named refusal, never a crash', () => {
    const r = resolveStageTestEnv(qa, { variables: [], secrets: [{ ref: 'test.missing', testOnly: true }] }, store, theText())!;
    expect(r.vars).toStrictEqual({});
    expect(r.refusals[0]).toMatchObject({ name: 'test.missing' });
  });

  it('a secret not confirmed yet is dropped with a refusal, and confirmed it no', () => {
    const r = resolveStageTestEnv(qa, { variables: [], secrets: [{ ref: 'test.integration', testOnly: false }] }, store, theText())!;
    expect(r.refusals[0]).toMatchObject({ name: 'test.integration' });
  });

  it('a confirmed non-test-only secret is delivered', () => {
    const r = resolveStageTestEnv(qa, { variables: [], secrets: [{ ref: 'test.integration', testOnly: false }] }, store, { ...theText(), confirmed: () => true })!;
    expect(Object.values(r.vars)).toEqual(['stored-integration-9999']);
  });

  it('a stage that does not allow the environment resolves nothing', () => {
    expect(resolveStageTestEnv({ kind: 'work' }, env(), store, theText())).toBeNull();
  });
});

describe('the confirmation ledger', () => {
  it('records a confirmation once, with mode 0600, and revokes it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'cerimonias-ledger-')), 'approvals.json');
    const ledger = createTestEnvLedger(file);
    expect(ledger.approved('test.integration')).toBe(false);
    ledger.confirm('test.integration', 'person');
    expect(ledger.approved('test.integration')).toBe(true);
    expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
    expect(existsSync(`${file}.tmp-${process.pid}`)).toBe(false);
    expect(ledger.list()).toEqual([{ ref: 'test.integration', confirmedAt: expect.any(String), by: 'person' }]);
    ledger.revoke('test.integration');
    expect(ledger.approved('test.integration')).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toBe({});
  });
});
  });
});
 'utf8'))).toBe({});
  });
});
  });
});
