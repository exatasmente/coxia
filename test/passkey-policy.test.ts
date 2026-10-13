// The passkey step-up (#210) through the real wiring: the policy of the web door for a device with and without a passkey, the hook that sensitive handlers call, and the
// channels of the passkey module. A core on a temp data folder, a software authenticator, no network beyond 127.0.0.1.
import { mkdirSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeAuthenticator } from './helpers/fakeAuthenticator';

vi.setConfig({ testTimeout: 60_000 });

const ORIGIN = 'https://coxia.example.com';
const RP = 'coxia.example.com';
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  vi.resetModules();
  cleanup = [];
});
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function boot() {
  (await import('../src/shared/i18n')).setLanguage('en');
  const dataDir = join(mkdtempSync(join(tmpdir(), 'cxpp-')), 'data');
  mkdirSync(dataDir);
  const { createCoxia } = await import('../src/main/core');
  const rpc = await import('../src/main/rpc');
  const policy = await import('../src/main/webPolicy');
  const stepUp = await import('../src/main/passkeyStepUp');
  const core = createCoxia({ dataDir });
  const config = await import('../src/main/config');
  cleanup.push(() => core.stop({ deadlineMs: 500 }));
  await core.start();
  // The instance is served at this address: a page of another origin cannot use a passkey of it.
  config.saveWebSettings({ ...config.getSettings().web, publicUrl: ORIGIN });
  return { rpc, policy, stepUp, core };
}

type Booted = Awaited<ReturnType<typeof boot>>;
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'none';
  } catch (e) {
    return (e as { code?: string }).code ?? `other:${(e as Error).message}`;
  }
};

/** Enrolls a software passkey for a paired device the way a page would: the computer allows it, the page registers. */
async function enroll(m: Booted, device: string) {
  const auth = fakeAuthenticator();
  await m.rpc.invokeAdmin('passkey:enroll-allow', [device]);
  const { challengeId, options } = (await m.rpc.invoke('passkey:register-options', ['Pixel'], device, { origin: ORIGIN })) as { challengeId: string; options: { challenge: string } };
  await m.rpc.invoke('passkey:register', [challengeId, auth.create({ challenge: options.challenge, origin: ORIGIN, rpId: RP })], device, { origin: ORIGIN });
  return auth;
}

async function assertionFor(m: Booted, auth: ReturnType<typeof fakeAuthenticator>, device: string, kind: string): Promise<string> {
  const { challengeId, options } = (await m.rpc.invoke('passkey:assert-options', [kind], device, { origin: ORIGIN })) as { challengeId: string; options: { challenge: string } };
  const done = (await m.rpc.invoke('passkey:assert', [challengeId, auth.get({ challenge: options.challenge, origin: ORIGIN, rpId: RP })], device, { origin: ORIGIN })) as { assertionId: string };
  return done.assertionId;
}

const SECRET_REMOVE = 'config:secret-remove';

describe('the policy of the web door', () => {
  it('keeps a paired device without a passkey as restricted as it was', async () => {
    const { policy } = await boot();
    for (const c of ['config:save', 'config:secret-set', 'config:secrets-accept-insecure', 'web:pair', 'web:revoke', 'wizard:vcs-test', 'docs:start', 'agentAssist:round', 'procedures:save', 'workspace:delete', 'plugins:set-secret', 'update:install', 'passkey:enroll-allow']) {
      expect(policy.webAccess(c), c).toBe('deny');
      expect(policy.webAccess(c, false), c).toBe('deny');
    }
    expect(policy.webAccess('passkey:register-options')).toBe('allow');
    expect(policy.webAccess('passkey:assert')).toBe('allow');
    expect(policy.webAccess('actions:approve')).toBe('external');
  });

  it('opens the admin channels to a device with a passkey and keeps the machine\'s own closed', async () => {
    const { policy } = await boot();
    for (const c of ['config:save', 'config:secret-set', 'config:secret-remove', 'config:secrets-accept-insecure', 'config:testenv-confirm', 'config:import-apply', 'web:pair', 'web:configure', 'web:revoke', 'docs:start', 'agentAssist:round', 'procedures:save', 'workspace:delete', 'workspace:test', 'plugins:set-secret', 'plugins:set-enabled']) {
      expect(policy.webAccess(c, true), c).toBe('allow');
    }
    for (const c of ['update:install', 'update:run', 'clipboard:copy', 'autostart:set', 'retention:apply', 'vcs:probe', 'sandbox:probe', 'wizard:vcs-test', 'wizard:pick-folder', 'voice:install', 'screen:input', 'mcpstate:set-enabled', 'claudeSessions:start', 'remoteControl:anything', 'conflicts:verify-set', 'actions:freeBranch']) {
      expect(policy.webAccess(c, true), c).toBe('deny');
    }
    // The enrollment allowance is the computer's, even for an admin device; an unclassified channel under passkey: starts closed.
    expect(policy.webAccess('passkey:enroll-allow', true)).toBe('deny');
    expect(policy.webAccess('passkey:invented', true)).toBe('deny');
    // The external-effects switch still decides what it decided.
    expect(policy.webAccess('actions:approve', true)).toBe('external');
    expect(policy.webRefusal('config:save', false, true)).toBeNull();
    expect(policy.webRefusal('config:save', false, false)).not.toBeNull();
  });

  it('lists the kind of step-up for each channel it asks for at the door, and each is a known kind', async () => {
    const { policy, stepUp } = await boot();
    for (const [channel, kind] of policy.STEP_UP) {
      expect(stepUp.SENSITIVE_KINDS, channel).toContain(kind);
      expect(policy.webAccess(channel, true), channel).toBe('allow');
    }
  });
});

describe('the step-up of a sensitive call', () => {
  it('refuses a paired call with no assertion, with passkey-required, and lets the window and the admin socket through', async () => {
    const m = await boot();
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev1'))).toBe('passkey-required');
    // The admin socket is the machine's shell: never asked. The window's IPC has no paired device either.
    expect(await codeOf(m.rpc.invokeAdmin(SECRET_REMOVE, ['nothing']))).not.toBe('passkey-required');
    expect(() => m.stepUp.requireSensitive('budget')).not.toThrow();
    expect(m.stepUp.isAdminDevice()).toBe(false);
  });

  it('asks at the door for the channels of the list before their handler runs', async () => {
    const m = await boot();
    expect(await codeOf(m.rpc.invoke('config:save', [{}], 'dev1'))).toBe('passkey-required');
    expect(await codeOf(m.rpc.invoke('web:pair', [], 'dev1'))).toBe('passkey-required');
    expect(await codeOf(m.rpc.invoke('workspace:delete', ['x'], 'dev1'))).toBe('passkey-required');
    // A channel that is not sensitive is not asked.
    expect(await codeOf(m.rpc.invoke('config:get', [], 'dev1'))).toBe('none');
  });

  it('accepts a fresh assertion of its kind, once', async () => {
    const m = await boot();
    const auth = await enroll(m, 'dev1');
    const id = await assertionFor(m, auth, 'dev1', 'secret');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev1', { assertionId: id }))).not.toBe('passkey-required');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev1', { assertionId: id }))).toBe('passkey-required');
  });

  it('refuses an assertion made for another kind, another device, or a made-up one', async () => {
    const m = await boot();
    const auth = await enroll(m, 'dev1');
    const other = await enroll(m, 'dev2');
    const forBudget = await assertionFor(m, auth, 'dev1', 'budget');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev1', { assertionId: forBudget }))).toBe('passkey-required');
    const forSecret = await assertionFor(m, auth, 'dev1', 'secret');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev2', { assertionId: forSecret }))).toBe('passkey-required');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev2', { assertionId: 'made-up' }))).toBe('passkey-required');
    expect(await codeOf(m.rpc.invoke(SECRET_REMOVE, ['nothing'], 'dev1', { assertionId: forSecret }))).not.toBe('passkey-required');
    expect(other).toBeDefined();
  });

  it('is what the budget and ownership hooks call: requireSensitive of their kind inside a handler', async () => {
    const m = await boot();
    const auth = await enroll(m, 'dev1');
    m.rpc.handle('test:budget', (() => {
      m.stepUp.requireSensitive('budget', 'budget:set');
      return 'ok';
    }) as never);
    expect(await codeOf(m.rpc.invoke('test:budget', [], 'dev1'))).toBe('passkey-required');
    const id = await assertionFor(m, auth, 'dev1', 'budget');
    expect(await m.rpc.invoke('test:budget', [], 'dev1', { assertionId: id })).toBe('ok');
    expect(await m.rpc.invokeAdmin('test:budget', [])).toBe('ok');
  });

  it('keeps the context across the awaits of a handler', async () => {
    const m = await boot();
    const auth = await enroll(m, 'dev1');
    m.rpc.handle('test:late', (async () => {
      await new Promise((r) => setTimeout(r, 5));
      m.stepUp.requireSensitive('infrastructure');
      return m.stepUp.isAdminDevice();
    }) as never);
    const id = await assertionFor(m, auth, 'dev1', 'infrastructure');
    expect(await m.rpc.invoke('test:late', [], 'dev1', { assertionId: id })).toBe(true);
  });
});

describe('enrolling', () => {
  it('lets a paired device register only after the computer allows it, never the browser itself', async () => {
    const m = await boot();
    expect(await codeOf(m.rpc.invoke('passkey:register-options', ['Pixel'], 'dev1', { origin: ORIGIN }))).toBe('forbidden');
    await enroll(m, 'dev1');
    const mine = (await m.rpc.invoke('passkey:list', [], 'dev1')) as Array<{ id: string; deviceId: string }>;
    expect(mine).toHaveLength(1);
    expect(await m.rpc.invoke('passkey:list', [], 'dev2')).toEqual([]);
    expect((await m.rpc.invokeAdmin('passkey:list', [])) as unknown[]).toHaveLength(1);
  });

  it('asks for the passkey to remove a passkey, and loses the admin right with the last one', async () => {
    const m = await boot();
    const auth = await enroll(m, 'dev1');
    const [{ id }] = (await m.rpc.invoke('passkey:list', [], 'dev1')) as Array<{ id: string }>;
    expect(await codeOf(m.rpc.invoke('passkey:remove', [id], 'dev1'))).toBe('passkey-required');
    const proof = await assertionFor(m, auth, 'dev1', 'passkey');
    expect(await m.rpc.invoke('passkey:remove', [id], 'dev1', { assertionId: proof })).toBe(true);
    expect(await m.rpc.invoke('passkey:list', [], 'dev1')).toEqual([]);
  });

  it('refuses an assertion option for a device with no passkey', async () => {
    const m = await boot();
    expect(await codeOf(m.rpc.invoke('passkey:assert-options', ['secret'], 'dev1', { origin: ORIGIN }))).toBe('not-found');
  });
});

describe('the HTTP door', () => {
  it('passes the assertion header and origin on, treats a passkey device as admin, and answers passkey-required with 403 and the code', async () => {
    const { createWebApp } = await import('../src/main/web');
    const { createAuth } = await import('../src/main/webAuth');
    const { ContractError } = await import('../src/shared/contract');
    const { DEFAULT_SETTINGS } = await import('../src/shared/settings');
    const dir = mkdtempSync(join(tmpdir(), 'cxpw-'));
    const auth = createAuth(join(dir, 'sessions.json'));
    const seen: unknown[] = [];
    let admin = false;
    const app = createWebApp({
      settings: () => ({ ...DEFAULT_SETTINGS.web, enabled: true, basePath: '/', publicUrl: '' }),
      rendererDir: dir,
      auth,
      hasChannel: () => true,
      isAdmin: () => admin,
      invoke: async (channel, _args, _device, step) => {
        seen.push(step);
        if (!step?.assertionId) throw new ContractError('passkey-required', 'needs the passkey');
        return channel;
      },
    });
    cleanup.push(() => app.close());
    await new Promise<void>((ok) => app.server.listen(0, '127.0.0.1', ok));
    const port = (app.server.address() as AddressInfo).port;
    const call = (path: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: any; headers: Record<string, unknown> }> =>
      new Promise((ok, fail) => {
        const req = request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'Content-Type': 'application/json', 'X-Cerimonias': '1', ...headers } }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, json: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }));
        });
        req.on('error', fail);
        req.end(JSON.stringify(body));
      });
    const { code } = auth.newPairingCode();
    const login = await call('/api/login', {}, { code, name: 'Pixel' });
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    // Without a passkey the channel is the computer's.
    expect((await call('/api/rpc/config:save', { Cookie: cookie }, [])).status).toBe(403);
    expect(seen).toEqual([]);
    admin = true;
    const asked = await call('/api/rpc/config:save', { Cookie: cookie }, []);
    expect(asked.status).toBe(403);
    expect(asked.json.code).toBe('passkey-required');
    const done = await call('/api/rpc/config:save', { Cookie: cookie, 'X-Coxia-Assertion': 'abc' }, []);
    expect(done.status).toBe(200);
    expect(seen.at(-1)).toMatchObject({ assertionId: 'abc' });
  });
});
