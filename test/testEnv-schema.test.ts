import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { migrateConfig } from '../src/shared/config/migrations';
import { exportText } from '../src/main/config-transfer';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';
import { validateConfig } from '../src/shared/config/validate';

// The configuration surface of the test environment: validation, the migration that fills the section in, and the export that never carries a resolved value.

const v20 = (change: (c: Record<string, any>) => void = () => undefined): Record<string, any> => {
  const c = JSON.parse(JSON.stringify(neutralConfig())) as Record<string, any>;
  c.schemaVersion = 20;
  delete c.testEnvironment;
  change(c);
  return c;
};
const migrate = (doc: Record<string, unknown>) => migrateConfig(doc, { legacyInstall: false });

describe('the migration to schema 21', () => {
  it('fills the empty section in and raises no stage field: a stored template keeps left-out = no', () => {
    const r = migrate(v20((c) => {
      c.devCycle.stages = [{ id: 'qa', label: 'QA', kind: 'qa', match: [], artifacts: [], reads: null, agentId: null }];
    }));
    expect(r.config.testEnvironment).toEqual({ variables: [], secrets: [] });
    expect((r.config as any).devCycle.stages[0].testEnv).toBeUndefined();
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });

  it('keeps what the person had, and keeps a filled section as it was', () => {
    const r = migrate(v20((c) => {
      c.testEnvironment = { variables: [{ name: 'INTEGRATION_URL', value: 'https://staging.example.com' }], secrets: [] };
    }));
    expect(r.config.testEnvironment.variables).toEqual([{ name: 'INTEGRATION_URL', value: 'https://staging.example.com' }]);
  });
});

describe('the validation of the section', () => {
  const ok = (): any => ({
    ...neutralConfig(),
    testEnvironment: {
      variables: [{ name: 'INTEGRATION_URL', value: 'https://staging.example.com', hosts: ['staging.example.com'], privateHosts: [] }],
      secrets: [{ ref: 'test.integration', testOnly: true, hosts: ['staging.example.com'] }],
    },
  });

  it('accepts a well-formed section', () => {
    const r = validateConfig(ok());
    expect(r.ok).toBe(true);
  });

  it('holds names to ENV_NAME, refs to SECRET_REF plus the test. prefix, and testOnly to a real boolean', () => {
    const problems = (over: (e: any) => void): string[] => {
      const c = ok();
      over(c.testEnvironment);
      return validateConfig(c).errors.map((e) => e.path);
    };
    expect(problems((e) => { e.variables[0].name = 'missing'; })).toBe(['testEnvironment.variables[0]']);
    expect(problems((e) => { e.secrets[0].ref = 'api.key'; })).toBe(['testEnvironment.secrets[0]']);
    expect(problems((e) => { e.secrets[0].ref = 'other.thing'; })).toBe(['testEnvironment.secrets[0]']);
    expect(problems((e) => { delete e.secrets[0].testOnly; })).toBe(['testEnvironment.secrets[0]']);
  });

  it('requires the private hosts to be a subset of the hosts, and refuses duplicates', () => {
    const paths = (over: (e: any) => void): string[] => {
      const c = ok();
      over(c.testEnvironment);
      return validateConfig(c).errors.map((e) => e.path);
    };
    expect(paths((e) => { e.variables[0].privateHosts = ['internal.example.com']; })).toBe(['testEnvironment.variables[0].privateHosts[0]']);
    expect(paths((e) => { e.variables.push(e.variables[0]); })).toBe(['testEnvironment.variables']);
    expect(paths((e) => { e.secrets.push(e.secrets[0]); })).toBe(['testEnvironment.secrets']);
  });

  it('a duplicate host is a warning, not a refusal', () => {
    const c = ok();
    c.testEnvironment.variables[0].hosts = ['staging.example.com', 'staging.example.com'];
    expect(validateConfig(c).warnings.map((w) => w.path)).toContain('testEnvironment.variables[0].hosts');
  });
});

describe('the export of the configuration', () => {
  it('carries the variable values and the secret references, never a resolved value', () => {
    const config = neutralConfig();
    config.testEnvironment = {
      variables: [{ name: 'INTEGRATION_URL', value: 'https://staging.example.com', hosts: [], privateHosts: [] }],
      secrets: [{ ref: 'test.integration', testOnly: true, hosts: [], privateHosts: [] }],
    };
    const text = exportText(config, { workspaceName: 'Plano', appVersion: '0.0.0-test', now: new Date('2026-10-02T12:00:00Z'), workspaceId: 'id-123' });
    expect(text).toContain('https://staging.example.com');
    expect(text).toContain('test.integration');
    expect(text).not.toContain('resolved-never-4242');
    expect(text).not.toContain('approvals');
  });
});
