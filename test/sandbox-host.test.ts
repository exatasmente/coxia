import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type HostSessionOptions, openHostSession } from '../src/main/sandbox/host';
import { TEST_ENV_DATA_VARS } from '../src/main/sandbox';

// The host session with the launcher's test environment: merged over the scrub, and — when the launcher named the data-folder variables — fresh empty folders
// inside the session's own throwaway folder, gone when the session closes. Every command is ended by a fake program that answers at once.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coxia-hostsession-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface Seen {
  command: string;
  env: NodeJS.ProcessEnv;
}

const fakeDeps = () => {
  const seen: Seen[] = [];
  const children: ChildProcess[] = [];
  const spawn = (file: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
    seen.push({ command: args[args.length - 1], env: opts.env });
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), pid: 4242 });
    child.kill = () => true;
    children.push(child);
    queueMicrotask(() => child.emit('exit', 0, null));
    return child;
  };
  return { spawn, seen };
};

const options = (over: Partial<HostSessionOptions> = {}): HostSessionOptions => ({
  cwd: dir,
  limits: { commandMs: 60_000, stageMs: 10 * 60_000 },
  env: async () => ({ HOME: '/home/person', CERIMONIAS_DATA_DIR: '/real/data', SECRET_TOKEN: 'sk-real-000' }),
  ...over,
});

describe('the host session and the test environment', () => {
  it('merges the test variables over the scrubbed environment: a real credential-looking name is scrubbed, a test name survives', async () => {
    const { spawn, seen } = fakeDeps();
    const s = openHostSession(options({ testEnv: { vars: { TEST_MODEL_KEY: 'test-key-42' } } }), { spawn });
    const r = await s.exec('true');
    expect(r.exitCode).toBe(0);
    expect(seen[0]).toBeDefined();
    // The scrub drops what looks like a credential first; the merge runs after, so no test name is lost to the scrub and nothing real rides under one.
    expect(seen[0].env).toHaveProperty('HOME', '/home/person');
    expect(seen[0].env).not.toHaveProperty('SECRET_TOKEN');
    expect(seen[0].env).toHaveProperty('TEST_MODEL_KEY', 'test-key-42');
    await s.close();
  });

  it('starts the app under development against fresh empty data folders, wiping any inherited value first', async () => {
    const { spawn, seen } = fakeDeps();
    const s = openHostSession(options({ testEnv: { vars: { ANY: '1' }, emptyDataDirs: TEST_ENV_DATA_VARS } }), { spawn });
    await s.exec('true');
    for (const name of TEST_ENV_DATA_VARS) {
      const value = seen[0].env[name];
      expect(typeof value).toBe('string');
      // The point of the fresh folders: a value the person's environment carries (here /real/data) can never be where the tested app stores.
      expect(value).not.toBe('/real/data');
      expect(existsSync(value ?? '')).toBe(true);
    }
    // The folders come out of the session's throwaway folder, not anywhere real.
    for (const name of TEST_ENV_DATA_VARS) expect(seen[0].env[name]!.startsWith(tmpdir())).toBe(true);
    await s.close();
  });

  it('removes the throwaway folder with the fresh data folders on close', async () => {
    const { spawn, seen } = fakeDeps();
    const s = openHostSession(options({ testEnv: { vars: { ANY: '1' }, emptyDataDirs: TEST_ENV_DATA_VARS } }), { spawn });
    await s.exec('true');
    const data = seen[0].env.CERIMONIAS_DATA_DIR!;
    expect(existsSync(data)).toBe(true);
    await s.close();
    expect(existsSync(data)).toBe(false);
  });

  it('ships nothing when the stage carries no test environment: no test variable, and today\'s environment as it is', async () => {
    const { spawn, seen } = fakeDeps();
    const s = openHostSession(options(), { spawn });
    await s.exec('true');
    expect(seen[0].env).not.toHaveProperty('TEST_ANY');
    // Today's behavior, untouched: whatever the environment already carried is not rewritten.
    expect(seen[0].env).toHaveProperty('CERIMONIAS_DATA_DIR', '/real/data');
    await s.close();
  });
});
