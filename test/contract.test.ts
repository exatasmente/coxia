// The contract every client speaks (#207): one list of channels that the instance's registrations must match, one closed list of error codes that every failure leaving a channel
// falls into, and a version both sides compare before they talk.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_CHANNELS } from '../src/shared/apiChannels';
import { CHANNELS, CONTRACT_VERSION, DESKTOP_CHANNELS, DOMAIN_CODES, ERROR_CODES, HELLO_CHANNEL, TYPED_CHANNELS, errorCodeOf, wireErrorOf } from '../src/shared/contract';
import type { EngineError } from '../src/main/engine/open/errors';
import type { VcsErrorCode } from '../src/main/vcs/errors';
import { webAccess } from '../src/main/webPolicy';

vi.setConfig({ testTimeout: 60_000 });

// Every code a class can carry must be in the closed list: a code added to a class and not here fails the compilation.
type Missing<Class, Listed> = Exclude<Class, Listed> extends never ? true : Exclude<Class, Listed>;
const covered: [Missing<VcsErrorCode, (typeof DOMAIN_CODES.vcs)[number]>, Missing<EngineError['kind'], (typeof DOMAIN_CODES.engine)[number]>] = [true, true];

// Each test loads the modules afresh, so the class it checks with is the one the module under test threw.
beforeEach(() => vi.resetModules());

describe('the list of channels', () => {
  it('holds exactly the channels the core and the desktop register', async () => {
    const { createCoxia } = await import('../src/main/core');
    const rpc = await import('../src/main/rpc');
    const core = createCoxia({ dataDir: mkdtempSync(join(tmpdir(), 'cerimonias-contract-')) });
    await core.start();
    try {
      // The desktop shell registers its own two (it needs the window's machine); the test reads them from its source because it cannot start Electron.
      const index = readFileSync(join(import.meta.dirname, '../src/main/index.ts'), 'utf8');
      for (const channel of DESKTOP_CHANNELS) expect(index, channel).toContain(`handle('${channel}'`);
      const registered = [...rpc.channels(), ...rpc.deviceChannels(), ...DESKTOP_CHANNELS];
      expect(registered.length).toBeGreaterThan(300);
      expect(registered.filter((c) => !(CHANNELS as readonly string[]).includes(c)), 'registered but not in the contract').toEqual([]);
      expect(CHANNELS.filter((c) => !registered.includes(c)), 'in the contract but registered by nobody').toEqual([]);
    } finally {
      await core.stop({ deadlineMs: 1_000 });
    }
  });

  it('has no duplicate', () => {
    expect(new Set(CHANNELS).size).toBe(CHANNELS.length);
  });

  it('names every channel of the typed API methods and types them', () => {
    for (const channel of Object.values(API_CHANNELS)) {
      expect(CHANNELS as readonly string[], channel).toContain(channel);
      expect(TYPED_CHANNELS, channel).toContain(channel);
    }
    expect(TYPED_CHANNELS).toContain(HELLO_CHANNEL);
    // The core registers it by its literal name (the persona door's table test reads the sources for literals).
    expect(HELLO_CHANNEL).toBe('contract:hello');
    expect(TYPED_CHANNELS.every((c) => (CHANNELS as readonly string[]).includes(c))).toBe(true);
  });
});

describe('the closed list of error codes', () => {
  it('has no duplicate and agrees with the lists the error classes keep', async () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    expect(covered).toEqual([true, true]);
    const { SANDBOX_ERROR_CODES } = await import('../src/main/sandbox/errors');
    const { RUNNER_ERROR_CODES } = await import('../src/main/runner/service');
    const { RUN_ERROR_CODES } = await import('../src/shared/runs/transitions');
    const { FORUM_ERROR_CODES } = await import('../src/main/forum-core');
    expect([...DOMAIN_CODES.sandbox]).toEqual([...SANDBOX_ERROR_CODES]);
    expect([...DOMAIN_CODES.runner]).toEqual([...RUNNER_ERROR_CODES]);
    expect([...DOMAIN_CODES.run]).toEqual([...RUN_ERROR_CODES]);
    expect([...DOMAIN_CODES.forum]).toEqual([...FORUM_ERROR_CODES]);
  });

  it('keeps the code an error class carries, and turns anything else into internal', async () => {
    const { SandboxError } = await import('../src/main/sandbox/errors');
    const { RunnerError } = await import('../src/main/runner/service');
    const { RunError } = await import('../src/shared/runs/transitions');
    const { ForumError } = await import('../src/main/forum-core');
    const { VcsError } = await import('../src/main/vcs/errors');
    const { ScheduleError } = await import('../src/main/schedules/core');
    const { SecretError } = await import('../src/main/secrets-core');
    const { WorktreeError } = await import('../src/main/runner/git');
    const { EngineError } = await import('../src/main/engine/open/errors');
    const { HostUnavailableError } = await import('../src/main/host');
    const { VoiceOffError } = await import('../src/main/voice');
    for (const code of DOMAIN_CODES.sandbox) expect(errorCodeOf(new SandboxError(code))).toBe(`sandbox:${code}`);
    for (const code of DOMAIN_CODES.runner) expect(errorCodeOf(new RunnerError(code))).toBe(`runner:${code}`);
    for (const code of DOMAIN_CODES.run) expect(errorCodeOf(new RunError(code))).toBe(`run:${code}`);
    for (const code of DOMAIN_CODES.forum) expect(errorCodeOf(new ForumError(code))).toBe(`forum:${code}`);
    for (const code of DOMAIN_CODES.vcs) expect(errorCodeOf(new VcsError(code))).toBe(`vcs:${code}`);
    for (const code of DOMAIN_CODES.schedule) expect(errorCodeOf(new ScheduleError(code as never))).toBe(`schedule:${code}`);
    for (const code of DOMAIN_CODES.secret) expect(errorCodeOf(new SecretError(code, 'x'))).toBe(`secret:${code}`);
    for (const code of DOMAIN_CODES.worktree) expect(errorCodeOf(new WorktreeError(code, 'x'))).toBe(`worktree:${code}`);
    for (const kind of DOMAIN_CODES.engine) expect(errorCodeOf(new EngineError('x', kind))).toBe(`engine:${kind}`);
    expect(errorCodeOf(new HostUnavailableError('restart'))).toBe('host-unavailable');
    expect(errorCodeOf(new VoiceOffError())).toBe('voice-off');
    expect(errorCodeOf(new Error('plain'))).toBe('internal');
    expect(errorCodeOf(Object.assign(new Error('fs'), { code: 'ENOENT' }))).toBe('internal');
    // A class that borrows a word of the list is not trusted for it: only the classes named for a domain are.
    expect(errorCodeOf(Object.assign(new Error('x'), { code: 'unavailable' }))).toBe('internal');
    expect(errorCodeOf('text')).toBe('internal');
    expect(wireErrorOf('text')).toEqual({ code: 'internal', message: 'text' });
  });
});

describe('what leaves a channel', () => {
  it('carries a code of the closed list and the text the person already read, on the IPC and the HTTP paths', async () => {
    const { handle, invoke, bindIpc, settle } = await import('../src/main/rpc');
    const { ContractError, isErrorCode } = await import('../src/shared/contract');
    const { SandboxError } = await import('../src/main/sandbox/errors');
    const { VoiceOffError } = await import('../src/main/voice');
    const ipc = new Map<string, (...args: unknown[]) => unknown>();
    bindIpc((channel, fn) => ipc.set(channel, fn as (...args: unknown[]) => unknown));
    const failures: Record<string, () => never> = {
      'c:plain': () => {
        throw new Error('plain failure');
      },
      'c:sandbox': () => {
        throw new SandboxError('unavailable');
      },
      'c:voice': () => {
        throw new VoiceOffError();
      },
      'c:text': () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'just text';
      },
    };
    for (const [channel, fn] of Object.entries(failures)) handle(channel, fn);
    const expected: Record<string, string> = { 'c:plain': 'internal', 'c:sandbox': 'sandbox:unavailable', 'c:voice': 'voice-off', 'c:text': 'internal' };
    for (const channel of Object.keys(failures)) {
      const web = await invoke(channel, [], 'dev').catch((e: unknown) => e);
      expect(web).toBeInstanceOf(ContractError);
      expect((web as InstanceType<typeof ContractError>).code, channel).toBe(expected[channel]);
      expect(isErrorCode((web as InstanceType<typeof ContractError>).code)).toBe(true);
      const ipcError = await Promise.resolve().then(() => ipc.get(channel)?.()).catch((e: unknown) => e);
      expect((ipcError as InstanceType<typeof ContractError>).code).toBe(expected[channel]);
      // The text is the original's, so nothing the person reads changes.
      const settled = await settle(() => ipc.get(channel)?.());
      expect(settled).toEqual({ ok: false, error: { code: expected[channel], message: (web as Error).message } });
    }
    const sandboxText = new SandboxError('unavailable').message;
    expect(((await invoke('c:sandbox', []).catch((e: unknown) => e)) as Error).message).toBe(sandboxText);
    expect(await settle(() => 'fine')).toEqual({ ok: true, value: 'fine' });
  });

  it('names an unknown channel and a device channel called from the window', async () => {
    const { handleDevice, invoke } = await import('../src/main/rpc');
    const { ContractError } = await import('../src/shared/contract');
    handleDevice('d:only', () => 1);
    expect(((await invoke('nothing:here', []).catch((e: unknown) => e)) as InstanceType<typeof ContractError>).code).toBe('unknown-channel');
    expect(((await invoke('d:only', []).catch((e: unknown) => e)) as InstanceType<typeof ContractError>).code).toBe('browser-only');
  });
});

describe('the handshake', () => {
  it('answers the version of the instance to a client of the same version', async () => {
    const { hello } = await import('../src/main/rpc');
    expect(hello(CONTRACT_VERSION)).toEqual({ version: CONTRACT_VERSION });
  });

  it('refuses an older and a newer client, with both versions in the message', async () => {
    const { hello } = await import('../src/main/rpc');
    const { ContractError } = await import('../src/shared/contract');
    for (const client of [CONTRACT_VERSION - 1, CONTRACT_VERSION + 1, 'x', undefined]) {
      let refusal: unknown;
      try {
        hello(client);
      } catch (e) {
        refusal = e;
      }
      expect(refusal, String(client)).toBeInstanceOf(ContractError);
      expect((refusal as InstanceType<typeof ContractError>).code).toBe('contract-mismatch');
      expect((refusal as InstanceType<typeof ContractError>).message).toContain(String(client));
      expect((refusal as InstanceType<typeof ContractError>).message).toContain(String(CONTRACT_VERSION));
    }
  });

  it('is a channel any paired browser may call, and the instance still decides the rest', () => {
    expect(webAccess(HELLO_CHANNEL)).toBe('allow');
    expect(webAccess('web:view')).toBe('deny');
    expect(webAccess('actions:approve')).toBe('external');
  });
});

describe('the clients send their version', () => {
  const read = (p: string): string => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

  it('has the browser adapter send the header and the window say hello at start', () => {
    expect(read('src/renderer/src/webApi.ts')).toContain('CONTRACT_HEADER');
    expect(read('src/renderer/src/api.ts')).toContain('invoke(HELLO_CHANNEL, CONTRACT_VERSION)');
    expect(read('src/renderer/src/WebGate.tsx')).toContain('contractHello()');
  });

  it('has the desktop settle every call so the code crosses the bridge', () => {
    expect(read('src/main/index.ts')).toContain('settle(');
    expect(read('src/preload/index.ts')).toContain('exposeInMainWorld');
  });
});
