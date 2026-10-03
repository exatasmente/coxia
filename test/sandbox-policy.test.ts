import { describe, expect, it } from 'vitest';
import { neutralSandbox } from '../src/shared/config/defaults';
import { SANDBOX_LIMIT_RANGES, isRegistryHost, readOnlyPathProblem } from '../src/shared/sandboxPaths';
import { sanitizeGitConfig, withoutUserinfo } from '../src/main/sandbox/gitView';
import { SUPERVISOR_SH, type SandboxSpec, bwrapArgs, sandboxEnv } from '../src/main/sandbox/policy';
import { isPrivateAddress } from '../src/main/sandbox/proxy';
import { systemLayout } from '../src/main/sandbox/system';

const spec = (over: Partial<SandboxSpec> = {}): SandboxSpec => ({
  worktree: '/data/worktrees/app/7-thing',
  tree: null,
  stageDir: '/data/sandbox/abc',
  system: { roDirs: ['/usr', '/etc'], links: [['/bin', 'usr/bin'], ['/lib64', 'usr/lib64']] },
  roBinds: [],
  pathDirs: [],
  network: 'off',
  limits: neutralSandbox().limits,
  tmpMb: 512,
  ...over,
});

const pairs = (args: string[], flag: string): string[][] => args.flatMap((a, i) => (a === flag ? [[args[i + 1], args[i + 2]]] : []));

describe('the argument list of the sandbox', () => {
  it('unshares everything, never shares the network, and clears the environment', () => {
    const a = bwrapArgs(spec());
    for (const f of ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-net', '--unshare-uts', '--disable-userns', '--die-with-parent', '--new-session', '--clearenv']) expect(a).toContain(f);
    expect(a).not.toContain('--share-net');
    expect(a).not.toContain('--unshare-all');
  });

  it('builds the root from an allow-list: the system read-only, no home, no run, no var', () => {
    const a = bwrapArgs(spec());
    expect(pairs(a, '--ro-bind')).toEqual(expect.arrayContaining([['/usr', '/usr'], ['/etc', '/etc']]));
    expect(pairs(a, '--symlink')).toEqual([['usr/bin', '/bin'], ['usr/lib64', '/lib64']]);
    const text = a.join('\n');
    for (const gone of ['/home\n', '/root', '/run', '/var', '/mnt', '/media']) expect(text).not.toContain(`\n${gone}`);
  });

  it('puts the worktree read-write, the stage folder in its own places and the pointer to git read-only over itself, after the worktree', () => {
    const wt = '/data/worktrees/app/7-thing';
    const a = bwrapArgs(spec({ roBinds: [[`${wt}/.git`, `${wt}/.git`], ['/clones/app/.git', '/clones/app/.git'], ['/data/sandbox/abc/git/config', '/clones/app/.git/config']] }));
    expect(pairs(a, '--bind')).toEqual([['/data/sandbox/abc/home', '/home/sandbox'], ['/data/sandbox/abc/out', '/coxia/out'], [wt, wt]]);
    const at = (src: string) => a.findIndex((x, i) => x === '--ro-bind' && a[i + 1] === src);
    expect(at('/data/sandbox/abc/ctl')).toBeGreaterThan(-1);
    expect(at(`${wt}/.git`)).toBeGreaterThan(a.indexOf('--bind', a.indexOf(wt) - 2));
    // The repository's own directory goes in before the worktree is bound, the pointer after it.
    expect(at('/clones/app/.git')).toBeLessThan(a.findIndex((x, i) => x === '--bind' && a[i + 1] === wt));
  });

  it('mounts a copy over the worktree path for an agent that only reads, and names the folders the workspace listed', () => {
    const a = bwrapArgs(spec({ tree: '/data/sandbox/abc/tree', roBinds: [['/home/u/.nvm/v20', '/home/u/.nvm/v20']] }));
    expect(pairs(a, '--bind')).toContainEqual(['/data/sandbox/abc/tree', '/data/worktrees/app/7-thing']);
    expect(pairs(a, '--ro-bind')).toContainEqual(['/home/u/.nvm/v20', '/home/u/.nvm/v20']);
  });

  it('keeps host paths and the command out of the environment it builds, and builds it from nothing', () => {
    const env = sandboxEnv(spec({ pathDirs: ['/home/u/.nvm/v20/bin'] }));
    expect(env.HOME).toBe('/home/sandbox');
    expect(env.PATH.startsWith('/home/u/.nvm/v20/bin:')).toBe(true);
    expect(Object.keys(env).filter((k) => /token|secret|pass|auth|api/i.test(k))).toEqual([]);
    expect(env.COXIA_DATA).toBe(String(2048 * 1024 * 1024));
    expect(env.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(env.HTTPS_PROXY).toBeUndefined();
  });

  it('adds the proxy to the environment in registry mode, and only there', () => {
    const env = sandboxEnv(spec({ network: 'proxy' }));
    expect(env).toMatchObject({ HTTPS_PROXY: 'http://127.0.0.1:3128', npm_config_https_proxy: 'http://127.0.0.1:3128', COXIA_PROXY: '1' });
    expect(bwrapArgs(spec({ network: 'proxy' }))).toContain('--unshare-net');
  });

  it('limits each command by program, with a hard limit', () => {
    expect(SUPERVISOR_SH).toContain('prlimit --data=');
    expect(SUPERVISOR_SH).toContain('timeout -k 3');
  });
});

describe('the folders and hosts a workspace may list', () => {
  it('refuses what looks like a place for secrets, the home, the root and anything relative', () => {
    for (const p of ['~/.ssh', '/home/u/.aws/creds', '~/.config/gh', '/home/u/.gnupg', '/srv/secrets', '/opt/my-token-store', '/home/u/.env', '/home/u/.npmrc', '~/.claude']) expect(readOnlyPathProblem(p), p).toBe('secret');
    expect(readOnlyPathProblem('~')).toBe('home');
    expect(readOnlyPathProblem('/')).toBe('root');
    expect(readOnlyPathProblem('tools/node')).toBe('relative');
    expect(readOnlyPathProblem('/a/../b')).toBe('dots');
    expect(readOnlyPathProblem('')).toBe('empty');
  });

  it('accepts a toolchain folder', () => {
    for (const p of ['~/.nvm/versions/node/v20.11.0', '/opt/node-v20', '~/.local/share/fnm/node-versions/v20']) expect(readOnlyPathProblem(p), p).toBeNull();
  });

  it('takes plain host names only', () => {
    expect(isRegistryHost('registry.npmjs.org')).toBe(true);
    for (const h of ['https://registry.npmjs.org', 'registry.npmjs.org:443', '*.npmjs.org', 'localhost', 'a b.com', 'x.com/path', '']) expect(isRegistryHost(h), h).toBe(false);
  });

  it('has a range for every limit', () => {
    expect(Object.keys(SANDBOX_LIMIT_RANGES).sort()).toEqual(Object.keys(neutralSandbox().limits).sort());
  });
});

describe('the configuration of the repository inside the sandbox', () => {
  const config = [
    '[core]', '\trepositoryformatversion = 0', '\tfilemode = true', '\tfsmonitor = /usr/bin/evil', '\thooksPath = /tmp/hooks', '\tsshCommand = ssh -i /home/u/.ssh/id_rsa', '\tpager = less',
    '[remote "origin"]', '\turl = https://user:s3cr3t@example.com/group/project.git', '\tfetch = +refs/heads/*:refs/remotes/origin/*', '\tpushurl = https://x:y@example.com/p.git',
    '[http "https://example.com/"]', '\textraheader = AUTHORIZATION: bearer abc', '[credential]', '\thelper = store', '[alias]', '\tx = !evil', '[url "https://t:k@example.com/"]', '\tinsteadOf = a:',
    '[include]', '\tpath = /home/u/.gitconfig-secret', '[branch "main"]', '\tremote = origin', '\tmerge = refs/heads/main', '[filter "lfs"]', '\tclean = evil %f',
  ].join('\n');

  it('keeps what git needs to read the repository and nothing that carries a credential or runs a program', () => {
    const out = sanitizeGitConfig(config);
    expect(out).toContain('repositoryformatversion = 0');
    expect(out).toContain('url = https://example.com/group/project.git');
    expect(out).toContain('fetch = +refs/heads/*:refs/remotes/origin/*');
    expect(out).toContain('[branch "main"]');
    for (const gone of ['s3cr3t', 'fsmonitor', 'hookspath', 'sshcommand', 'pager', 'pushurl', 'extraheader', 'credential', 'helper', 'alias', 'insteadof', 'include', 'filter', 'evil', 'bearer']) expect(out.toLowerCase(), gone).not.toContain(gone);
  });

  it('strips the user and password from an address and leaves the rest', () => {
    expect(withoutUserinfo('https://user:pw@host.example/a/b.git')).toBe('https://host.example/a/b.git');
    expect(withoutUserinfo('git@host.example:a/b.git')).toBe('git@host.example:a/b.git');
    expect(withoutUserinfo('/local/path')).toBe('/local/path');
  });
});

describe('the top of the file system', () => {
  it('makes a link of what is a link on the host and binds what is a folder', () => {
    const l = systemLayout((p) => (p === '/bin' ? { link: 'usr/bin', dir: true } : p === '/lib' ? { link: null, dir: true } : null));
    expect(l.roDirs).toEqual(['/usr', '/etc', '/lib']);
    expect(l.links).toEqual([['/bin', 'usr/bin']]);
  });
});

describe('the addresses a sandbox is never sent to', () => {
  it('refuses this machine, private networks, link-local and metadata addresses, and non-unicast', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-address']) expect(isPrivateAddress(a), a).toBe(true);
  });

  it('lets public addresses through', () => {
    for (const a of ['104.16.1.1', '172.15.0.1', '172.32.0.1', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) expect(isPrivateAddress(a), a).toBe(false);
  });
});
