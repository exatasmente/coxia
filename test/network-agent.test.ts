import { type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import type { RunnerSandbox } from '../src/shared/config/types';
import { agentHosts, effectiveNetwork } from '../src/shared/network';
import { createSandboxService } from '../src/main/sandbox';
import type { ProxyDecision } from '../src/main/sandbox/proxy';

// The network of an agent's sandbox: the workspace's setting met by the agent's own list of hosts (rule 25 of the spec). The table is pure; the service tests build the
// sandbox with a fake program and look at what the proxy and the options of the sandbox are given. No test resolves a name or leaves the machine.

const ws = (network: RunnerSandbox['network'], registryHosts: string[] = []): Pick<RunnerSandbox, 'network' | 'registryHosts'> => ({ network, registryHosts });
const REGISTRY = ['registry.example.com'];

describe('the effective network', () => {
  it.each([
    // workspace, registry hosts, the agent's list, the result
    ['off', [], [], { mode: 'off', hosts: [] }],
    ['off', REGISTRY, [], { mode: 'off', hosts: [] }],
    ['off', [], ['app.example.com'], { mode: 'proxy', hosts: ['app.example.com'] }],
    ['off', REGISTRY, ['app.example.com'], { mode: 'proxy', hosts: ['app.example.com'] }],
    ['registry', REGISTRY, [], { mode: 'proxy', hosts: REGISTRY }],
    ['registry', [], [], { mode: 'proxy', hosts: [] }],
    ['registry', REGISTRY, ['app.example.com'], { mode: 'proxy', hosts: ['registry.example.com', 'app.example.com'] }],
    ['registry', [], ['app.example.com'], { mode: 'proxy', hosts: ['app.example.com'] }],
    ['open', REGISTRY, [], { mode: 'open', hosts: [] }],
    ['open', [], ['app.example.com'], { mode: 'proxy', hosts: ['app.example.com'] }],
    ['open', REGISTRY, ['app.example.com', 'docs.example.com'], { mode: 'proxy', hosts: ['app.example.com', 'docs.example.com'] }],
  ] as const)('workspace %s with registry hosts %j and an agent list %j gives %j', (network, registry, own, expected) => {
    expect(effectiveNetwork(ws(network, [...registry]), { allowedHosts: [...own] })).toEqual(expected);
  });

  it('is the workspace\'s setting alone for an agent with no list, an empty one, or none at all', () => {
    for (const agent of [undefined, {}, { allowedHosts: [] }]) {
      expect(effectiveNetwork(ws('off'), agent)).toEqual({ mode: 'off', hosts: [] });
      expect(effectiveNetwork(ws('registry', REGISTRY), agent)).toEqual({ mode: 'proxy', hosts: REGISTRY });
      expect(effectiveNetwork(ws('open'), agent)).toEqual({ mode: 'open', hosts: [] });
    }
  });

  it('lists a host once, lowercase, and never widens: what a host name cannot be is dropped', () => {
    expect(agentHosts({ allowedHosts: ['App.Example.com', 'app.example.com', ' docs.example.com '] })).toEqual(['app.example.com', 'docs.example.com']);
    expect(agentHosts({ allowedHosts: ['*.example.com', 'https://example.com', 'example.com:443', 'localhost', ''] })).toEqual([]);
    // A list made only of what is dropped is no list: the workspace's setting stands, and an open workspace is not narrowed to nothing by a typo.
    expect(effectiveNetwork(ws('open'), { allowedHosts: ['*.example.com'] })).toEqual({ mode: 'open', hosts: [] });
    expect(effectiveNetwork(ws('registry', ['Registry.Example.com']), { allowedHosts: ['registry.example.com'] })).toEqual({ mode: 'proxy', hosts: ['registry.example.com'] });
  });

  it('does not change the lists it is given', () => {
    const config = ws('registry', [...REGISTRY]);
    const agent = { allowedHosts: ['app.example.com'] };
    effectiveNetwork(config, agent);
    expect(config.registryHosts).toEqual(REGISTRY);
    expect(agent.allowedHosts).toEqual(['app.example.com']);
  });
});

// ---- the sandbox service, over a fake program ---------------------------------------------------------------------------------------------------

let root: string;
let worktree: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'coxia-netagent-')));
  worktree = join(root, 'wt');
  mkdirSync(worktree);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A program that is the supervisor for as long as the test needs: it says "ready" and keeps the options it was started with. */
function fakeProgram() {
  const argvs: string[][] = [];
  const spawn = (): ChildProcess => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const fd3 = new PassThrough();
    const child = new EventEmitter() as ChildProcess & EventEmitter;
    Object.assign(child, { stdin, stdout, stderr, stdio: [stdin, stdout, stderr, fd3], pid: undefined });
    let raw = '';
    fd3.on('data', (c: Buffer) => {
      raw += c.toString();
      argvs[argvs.length - 1] = raw.split('\0').filter(Boolean);
    });
    argvs.push([]);
    (child as { kill: () => boolean }).kill = () => {
      stdout.end();
      queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      return true;
    };
    stdin.on('data', () => undefined);
    setImmediate(() => stdout.write('ready\n'));
    return child;
  };
  return { spawn, argvs };
}

/** What the proxy of the sandbox decides about `CONNECT host:443`, through the socket in the stage folder (the name is never looked up: it resolves to nothing). */
async function connectThrough(sandboxDir: string, host: string): Promise<string> {
  const stage = readdirSync(sandboxDir)[0];
  return new Promise((resolve) => {
    const s = connect(join(sandboxDir, stage, 'ctl', 'proxy.sock'));
    let got = '';
    s.on('connect', () => s.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`));
    s.on('data', (d) => (got += d));
    s.on('error', () => undefined);
    s.on('close', () => resolve(got));
    setTimeout(() => (s.destroy(), resolve(got)), 2000);
  });
}

describe('the sandbox of an agent with hosts of its own', () => {
  const service = (program: ReturnType<typeof fakeProgram>) =>
    createSandboxService({ dir: join(root, 'sandbox'), home: root, protect: [], status: async () => ({ available: true, backend: 'bwrap', version: '0.9.0', reason: null, detail: '' }), deps: { spawn: program.spawn }, proxyDeps: { resolve: async () => [] } });
  const open = async (config: RunnerSandbox, agent: { allowedHosts?: string[] } | undefined, decisions: ProxyDecision[] = []) => {
    const program = fakeProgram();
    const session = await service(program).open({ worktree, reader: false, config, onProxy: (d) => decisions.push(d), ...(agent ? { agent } : {}) });
    return { session, argv: program.argvs[0] ?? [] };
  };

  it('keeps a workspace with no network and an agent with no list as it was: no network, no proxy', async () => {
    const { session, argv } = await open(neutralSandbox(), { allowedHosts: [] });
    try {
      expect(argv).toContain('--unshare-net');
      expect(argv.join(' ')).not.toContain('HTTPS_PROXY');
      expect(readdirSync(join(root, 'sandbox', readdirSync(join(root, 'sandbox'))[0], 'ctl'))).not.toContain('proxy.sock');
    } finally {
      await session.close();
    }
  });

  it('gives an agent in a workspace with no network the proxy, and lets only its hosts through', async () => {
    const decisions: ProxyDecision[] = [];
    const { session, argv } = await open(neutralSandbox(), { allowedHosts: ['app.example.com'] }, decisions);
    try {
      expect(argv).toContain('--unshare-net');
      expect(argv.join(' ')).toContain('HTTPS_PROXY');
      await connectThrough(join(root, 'sandbox'), 'app.example.com');
      await connectThrough(join(root, 'sandbox'), 'other.example.com');
      // The listed name got as far as being looked up; the other was refused for not being listed.
      expect(decisions).toEqual([{ host: 'app.example.com', port: 443, allowed: false, why: 'address' }, { host: 'other.example.com', port: 443, allowed: false, why: 'host' }]);
    } finally {
      await session.close();
    }
  });

  it('adds the agent\'s hosts to the registry hosts for that agent only', async () => {
    const config = { ...neutralSandbox(), network: 'registry' as const, registryHosts: REGISTRY };
    const decisions: ProxyDecision[] = [];
    const { session } = await open(config, { allowedHosts: ['app.example.com'] }, decisions);
    try {
      await connectThrough(join(root, 'sandbox'), 'registry.example.com');
      await connectThrough(join(root, 'sandbox'), 'app.example.com');
      await connectThrough(join(root, 'sandbox'), 'other.example.com');
      expect(decisions.map((d) => [d.host, d.allowed === false ? d.why : 'ok'])).toEqual([['registry.example.com', 'address'], ['app.example.com', 'address'], ['other.example.com', 'host']]);
    } finally {
      await session.close();
    }
    const alone = await open(config, undefined);
    try {
      expect(alone.argv.join(' ')).toContain('HTTPS_PROXY');
    } finally {
      await alone.session.close();
    }
  });

  it('narrows an open workspace to the agent\'s hosts: the network is no longer shared', async () => {
    const config = { ...neutralSandbox(), network: 'open' as const };
    const narrowed = await open(config, { allowedHosts: ['app.example.com'] });
    try {
      expect(narrowed.argv).toContain('--unshare-net');
      expect(narrowed.argv.join(' ')).toContain('HTTPS_PROXY');
    } finally {
      await narrowed.session.close();
    }
    const whole = await open(config, { allowedHosts: [] });
    try {
      expect(whole.argv).not.toContain('--unshare-net');
      expect(whole.argv.join(' ')).not.toContain('HTTPS_PROXY');
    } finally {
      await whole.session.close();
    }
  });

  it('removes the proxy socket with the session', async () => {
    const { session } = await open(neutralSandbox(), { allowedHosts: ['app.example.com'] });
    await session.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(readdirSync(join(root, 'sandbox'))).toEqual([]);
  });
});
