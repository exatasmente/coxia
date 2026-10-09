import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { TestEnvironment, TestEnvVariable } from '../shared/config/types';
import { TEST_ENV_REF_PREFIX } from '../shared/config/types';
import type { SecretsStore } from './secrets-core';

// The test environment of a stage: what the launcher resolves once per launch and hands the sandbox or the host shell. The values of the secrets exist only
// in the memory of this process, at the moment a stage launches; every refusal is named, and no resolution failure ever crashes a stage.

export interface TestEnvEntry {
  name: string;
  kind: 'variable' | 'secret';
  hosts: string[];
  privateHosts: string[];
  testOnly: boolean;
}

export interface TestEnvRefusal {
  name: string;
  reason: string;
}

export interface StageTestEnv {
  /** The variables the stage's commands start with, test secrets included (name after the `test.` prefix, uppercased). */
  vars: Record<string, string>;
  /** Every declared host of every entry, deduplicated (the registry allow-list union). */
  hosts: string[];
  privateHosts: string[];
  entries: TestEnvEntry[];
  /** The values that were resolved, for the exact-value masker of this stage. Never logged. */
  values: string[];
  refusals: TestEnvRefusal[];
}

/** Whether the stage receives the environment: only what it declares, or (left out) only a QA stage of this version's editor. */
export function stageAllowsTestEnv(stage: { kind?: string; testEnv?: boolean }): boolean {
  if (stage.testEnv !== undefined) return stage.testEnv === true;
  return stage.kind === 'qa';
}

const varNameOf = (ref: string): string => `TEST_${ref.slice(TEST_ENV_REF_PREFIX.length).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;

export interface ResolveStageTestEnvDeps {
  /** Asked before a non-test-only secret enters a launch: whether the person already confirmed it. */
  confirmed(ref: string): boolean;
  /** The shared catalog translator, to name the refusals in words; never throws. */
  text(key: string, params?: Record<string, string | number | undefined>): string;
}

/**
 * Resolves everything the stage receives. A value the store cannot resolve becomes a named refusal and the entry is dropped; a secret the person must
 * confirm first is also dropped, with its refusal, and the launcher raises the confirmation for the next attempt. An entry-less environment returns the
 * refusals alone: the shells are started exactly as a stage without entries. A not-allowed or absent environment returns null — today's behavior.
 */
export function resolveStageTestEnv(stage: { kind?: string; testEnv?: boolean }, env: TestEnvironment | undefined | null, secrets: SecretsStore, deps: ResolveStageTestEnvDeps): StageTestEnv | null {
  if (!stageAllowsTestEnv(stage) || !env) return null;
  const entries: TestEnvEntry[] = [];
  const vars: Record<string, string> = {};
  const values: string[] = [];
  const refusals: TestEnvRefusal[] = [];
  const hosts = new Set<string>();
  const privateHosts = new Set<string>();

  const takeHosts = (e: { hosts?: string[]; privateHosts?: string[] }): { hosts: string[]; privateHosts: string[] } => {
    const hs = [...new Set((e.hosts ?? []).map((h) => h.toLowerCase()))];
    const phs = [...new Set((e.privateHosts ?? []).map((h) => h.toLowerCase()))];
    for (const h of hs) hosts.add(h);
    for (const h of phs) privateHosts.add(h);
    return { hosts: hs, privateHosts: phs };
  };

  for (const variable of env.variables as TestEnvVariable[]) {
    if (!variable.value) continue;
    entries.push({ name: variable.name, kind: 'variable', ...takeHosts(variable), testOnly: true });
    vars[variable.name] = variable.value;
  }
  for (const secret of env.secrets) {
    if (!deps.confirmed(secret.ref)) {
      refusals.push({ name: secret.ref, reason: deps.text('main.testEnv.refusal.unconfirmed', { ref: secret.ref }) });
      continue;
    }
    try {
      const value = secrets.resolve(secret.ref);
      if (!value) throw new Error(deps.text('main.testEnv.refusal.empty', { ref: secret.ref }));
      const name = varNameOf(secret.ref);
      entries.push({ name, kind: 'secret', ...takeHosts(secret), testOnly: secret.testOnly });
      vars[name] = value;
      values.push(value);
    } catch (e) {
      refusals.push({ name: secret.ref, reason: e instanceof Error && e.message ? e.message : String(e) });
    }
  }
  return { vars, hosts: [...hosts], privateHosts: [...privateHosts], entries, values, refusals };
}

// ---- the confirmation ledger (the person's once-per-entry approval, in this computer's data, never in the configuration or an export) --------------------

export interface TestEnvLedger {
  approved(ref: string): boolean;
  confirm(ref: string, by: string): void;
  revoke(ref: string): void;
  list(): { ref: string; confirmedAt: string; by: string }[];
}

export function createTestEnvLedger(file: string): TestEnvLedger {
  const read = (): Record<string, { confirmedAt: string; by: string }> => {
    try {
      if (!existsSync(file)) return {};
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, { confirmedAt: string; by: string }>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, { confirmedAt: string; by: string }>): void => {
    mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  };
  return {
    approved: (ref) => ref in read(),
    confirm: (ref) => {
      const data = read();
      data[ref] = { confirmedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), by: 'person' };
      write(data);
    },
    revoke: (ref) => {
      const data = read();
      delete data[ref];
      write(data);
    },
    list: () => Object.entries(read()).map(([ref, e]) => ({ ref, confirmedAt: e.confirmedAt, by: e.by })).sort((a, b) => a.ref.localeCompare(b.ref)),
  };
}
