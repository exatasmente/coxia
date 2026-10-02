import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  GIT_MIRROR_READ,
  SECRET_GLOBS,
  SECRET_PATH,
  SECRET_READ_DENY,
  agentHooks,
  noSecrets,
  redactSecretResults,
  secretPath,
  shellAllowlist,
  withoutSecretFiles,
} from '../src/main/agents';

type Hook = (input: unknown, id: undefined, opts: { signal: AbortController['signal'] }) => Promise<Record<string, unknown>>;

const call = (hook: unknown, input: Record<string, unknown>) =>
  (hook as Hook)(input, undefined, { signal: new AbortController().signal });

async function decide(hook: unknown, input: Record<string, unknown>): Promise<'allow' | 'deny'> {
  const out = await call(hook, { hook_event_name: 'PreToolUse', ...input });
  return (out.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision === 'deny' ? 'deny' : 'allow';
}

const dir = mkdtempSync(join(tmpdir(), 'cerimonias-fixture-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
mkdirSync(join(dir, 'src'));
mkdirSync(join(dir, 'app', 'Token'), { recursive: true });
mkdirSync(join(dir, 'app', 'secrets'), { recursive: true });
writeFileSync(join(dir, '.env'), 'X=1\n');
writeFileSync(join(dir, 'src', 'app.php'), '<?php\n');
writeFileSync(join(dir, 'app', 'Token', 'TokenService.php'), '<?php\n');
symlinkSync(join(dir, '.env'), join(dir, 'src', 'notes.txt'));
symlinkSync(join(dir, '.env'), join(dir, 'src', 'TokenService.php'));
symlinkSync(join(dir, 'src', 'app.php'), join(dir, 'src', 'alias.php'));
symlinkSync(join(dir, 'src', 'app.php'), join(dir, 'src', 'token.json'));

// The subset of gitignore syntax the deny globs use, case-insensitive like the --iglob the SDK builds from them.
function globRegex(glob: string): RegExp {
  const body = glob
    .replace(/[.+^$(){}|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\/\*\*$/, '(/.*)?')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(.*/)?');
  return new RegExp(`^${body}$`, 'i');
}
function deniedByGlobs(path: string): boolean {
  const parts = path.split('/');
  const regexes = SECRET_GLOBS.filter((g) => !g.startsWith('~/')).map(globRegex);
  return parts.some((_, i) => regexes.some((re) => re.test(parts.slice(0, i + 1).join('/'))));
}

describe('secret globs (the Read deny rules that reach Grep and Glob)', () => {
  it('turns every glob into a Read rule', () => {
    expect(SECRET_READ_DENY).toEqual(SECRET_GLOBS.map((g) => `Read(${g})`));
    expect(SECRET_READ_DENY).toContain('Read(**/.env*)');
    expect(SECRET_READ_DENY).toContain('Read(**/*credential*.json)');
    expect(SECRET_READ_DENY).toContain('Read(**/*token*.txt)');
    expect(SECRET_READ_DENY).toContain('Read(~/.ssh/**)');
  });

  it('uses no character the SDK drops or escapes in a deny pattern', () => {
    for (const g of SECRET_GLOBS) expect(g).not.toMatch(/[[\]{}\\]/);
  });

  const secret = [
    'sz4/.env',
    'sz4/.env.local',
    'sz4/.envrc',
    'app/prod.env',
    'config/credentials.json',
    'config/credentials.prod.json',
    'config/Secrets.yml',
    'config/secrets.yaml',
    'config/secrets.ini',
    'config/secret.cfg',
    'config/secrets.conf',
    'config/secrets.txt',
    'token.json',
    'deploy/api_token.txt',
    'certs/server.pem',
    'certs/server.key',
    'certs/client.p12',
    'certs/client.pfx',
    'repo/.npmrc',
    'repo/.pypirc',
    'repo/id_rsa',
    'repo/id_ed25519.pub',
    'repo/.git-credentials',
    'certs/id_key',
    'keys/key',
    'home/.ssh/id_rsa',
    'home/.config/glab-cli/config.yml',
    'home/.aws/credentials',
    'home/.docker/config.json',
    'home/.netrc',
    'projects/.mcp.json',
    'home/.claude.json',
  ];
  it.each(secret)('keeps the globs and SECRET_PATH in step on %s', (path) => {
    expect(SECRET_PATH.test(path)).toBe(true);
    expect(deniedByGlobs(path)).toBe(true);
  });

  // Only the hook and the result filter see the directory, and they judge the file in it.
  it.each(['tokens/a.txt', 'secrets/prod.yml', 'config/credentials', 'app/token', 'docs/token.md', 'app/Http/secret.php.bak'])('holds back %s through SECRET_PATH, not through the globs', (path) => {
    expect(SECRET_PATH.test(path)).toBe(true);
    expect(deniedByGlobs(path)).toBe(false);
  });

  it.each([
    'sz4/app/Services/Agent/AgentService.php',
    'sz4/README.md',
    'sz4/config/database.php',
    'sz4/.gitignore',
    'sz-playbook/.claude/rules/session.md',
    'sz4/app/Services/Auth/TokenService.php',
    'sz4/app/Http/Controllers/SecretsController.php',
    'front/src/auth/secret.service.ts',
    'front/src/auth/token.service.spec.ts',
    'front/src/components/TokenInput.tsx',
    'front/src/components/TokenInput.vue',
    'api/credentials.go',
    'tools/token_refresh.py',
    'app/Token/Token.java',
    'lib/credentials_helper.dart',
    'lib/secret_box.rb',
    'src/Credentials.cs',
    'sz4/app/Token/Handler.php',
    'sz4/app/tokens/Handler.php',
    'sz4/app/secrets/Vault.ts',
  ])(
    'leaves %s readable',
    (path) => {
      expect(SECRET_PATH.test(path)).toBe(false);
      expect(deniedByGlobs(path)).toBe(false);
    },
  );
});

describe('secretPath', () => {
  it('sees a symlink to a secret file as the secret file', () => {
    expect(secretPath(join(dir, 'src', 'notes.txt'))).toBe(true);
    expect(secretPath(join(dir, 'src', 'alias.php'))).toBe(false);
  });

  it('sees through a symlink that wears a source-code name', () => {
    expect(secretPath(join(dir, 'src', 'TokenService.php'))).toBe(true);
    expect(secretPath('src/TokenService.php', dir)).toBe(true);
  });

  it('judges a link by its own name too', () => {
    expect(secretPath(join(dir, 'src', 'token.json'))).toBe(true);
  });

  it('lets source files with a secret word in the name through', () => {
    expect(secretPath('app/Services/TokenService.php', dir)).toBe(false);
    expect(secretPath('app/Token/TokenService.php', dir)).toBe(false);
    expect(secretPath('auth/secret.service.ts', dir)).toBe(false);
    expect(secretPath('/home/luiz/projects/sz4/app/Services/Auth/TokenService.php')).toBe(false);
  });

  it('holds back the config and data files with a secret word in the name', () => {
    for (const f of ['.env', 'prod.env', 'workstation.env', 'config/secrets.yml', 'token.json', 'credentials.json', '.npmrc', '.pypirc', '.netrc', '.mcp.json', 'id_rsa', 'certs/a.pem', 'certs/a.p12']) {
      expect(secretPath(f, dir), f).toBe(true);
    }
  });

  it('searches a directory with a secret word in its name and leaves the verdict to each file', () => {
    expect(secretPath('app/Token', dir)).toBe(false);
    expect(secretPath(join(dir, 'app', 'secrets'), dir)).toBe(false);
    expect(secretPath('app/Token/TokenService.php', dir)).toBe(false);
    expect(secretPath('app/Token/token.json', dir)).toBe(true);
  });

  it('resolves relative paths against the given cwd', () => {
    expect(secretPath('src/notes.txt', dir)).toBe(true);
    expect(secretPath('src/app.php', dir)).toBe(false);
    expect(secretPath('.env', dir)).toBe(true);
  });

  it('expands ~', () => {
    expect(secretPath('~/.ssh/id_rsa')).toBe(true);
    expect(secretPath('~/.claude.json')).toBe(true);
    expect(secretPath('~/projects/sz4/README.md')).toBe(false);
  });

  it('covers the Claude Code state in the home but not the playbook .claude', () => {
    const home = homedir();
    expect(secretPath(`${home}/.claude/openrouter.settings.json`)).toBe(true);
    expect(secretPath(`${home}/.claude/settings.json`)).toBe(true);
    expect(secretPath(`${home}/.claude/projects/-home-x/abc.jsonl`)).toBe(true);
    expect(secretPath(`${home}/.claude/skills/x/SKILL.md`)).toBe(false);
    expect(secretPath(`${home}/projects/sz-playbook/.claude/skills/x/SKILL.md`)).toBe(false);
  });

  it('treats .envrc as a secret', () => {
    expect(secretPath('/home/luiz/projects/sz4/.envrc')).toBe(true);
    expect(secretPath('/home/luiz/projects/sz4/.environment.md')).toBe(false);
  });
});

describe('noSecrets with a symlink or a relative path', () => {
  it('denies Grep and Read aimed at a link to a secret file', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', cwd: dir, tool_input: { pattern: 'x', path: 'src/notes.txt' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Read', cwd: dir, tool_input: { file_path: join(dir, 'src', 'notes.txt') } })).toBe('deny');
  });

  it('allows the same call on a regular file', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', cwd: dir, tool_input: { pattern: 'x', path: 'src/app.php' } })).toBe('allow');
  });

  it('allows Read, Grep and Glob on source files named after a secret, and on the directory that holds them', async () => {
    expect(await decide(noSecrets, { tool_name: 'Read', cwd: dir, tool_input: { file_path: 'app/Token/TokenService.php' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Read', cwd: dir, tool_input: { file_path: '/p/auth/secret.service.ts' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Grep', cwd: dir, tool_input: { pattern: 'x', path: 'app/Token' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Grep', cwd: dir, tool_input: { pattern: 'x', glob: '**/*Token*.php' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Glob', cwd: dir, tool_input: { pattern: '**/*Token*.php' } })).toBe('allow');
  });

  it.each(['.env', 'prod.env', 'config/secrets.yml', 'token.json', 'credentials.json', '.npmrc', 'src/TokenService.php'])('denies Read of %s', async (file_path) => {
    expect(await decide(noSecrets, { tool_name: 'Read', cwd: dir, tool_input: { file_path } })).toBe('deny');
  });

  it('denies a Glob or Grep glob aimed at data files named after a secret', async () => {
    expect(await decide(noSecrets, { tool_name: 'Glob', cwd: dir, tool_input: { pattern: '**/*token*.json' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Grep', cwd: dir, tool_input: { pattern: 'x', glob: '**/*secret*.yml' } })).toBe('deny');
  });
});

describe('withoutSecretFiles', () => {
  it('drops match lines from secret files and keeps the rest', () => {
    const out = withoutSecretFiles({
      mode: 'content',
      numFiles: 2,
      filenames: [],
      content: ['src/app.php:1:// the canary', 'config/credentials.json:1:{"k":"canary"}', 'deploy/.env.local:3:K=canary', 'src/b.php:7:echo "canary";'].join('\n'),
    }) as { content: string };
    expect(out.content).toBe(['src/app.php:1:// the canary', 'src/b.php:7:echo "canary";'].join('\n'));
  });

  it('drops context lines too', () => {
    const out = withoutSecretFiles({ mode: 'content', filenames: [], content: 'config/secrets.yml-4-  password: canary\nsrc/a.php-5-ok' }) as { content: string };
    expect(out.content).toBe('src/a.php-5-ok');
  });

  it('reads a path that holds dashes and digits', () => {
    const out = withoutSecretFiles({ mode: 'content', filenames: [], content: 'config/prod-1.env:5:K=canary\nsrc/a-1-b.php:2:ok' }) as { content: string };
    expect(out.content).toBe('src/a-1-b.php:2:ok');
  });

  it('keeps matches from source files named after a secret and drops the data files', () => {
    const out = withoutSecretFiles({
      mode: 'content',
      filenames: [],
      content: ['app/Services/TokenService.php:3:$t = 1;', 'src/auth/secret.service.ts-7-ctx', 'config/token.json:1:{}', 'config/secrets.yml:2:a: b', '.npmrc:1:x', 'src/b.php:7:ok'].join('\n'),
    }) as { content: string };
    expect(out.content).toBe(['app/Services/TokenService.php:3:$t = 1;', 'src/auth/secret.service.ts-7-ctx', 'src/b.php:7:ok'].join('\n'));
    expect(withoutSecretFiles({ mode: 'content', filenames: [], content: 'app/Services/TokenService.php:3:x' })).toBeNull();
  });

  it('keeps a line whose text mentions a secret word', () => {
    expect(withoutSecretFiles({ mode: 'content', filenames: [], content: 'src/a.php:3:$token = refresh();' })).toBeNull();
  });

  it('filters file name lists (files_with_matches, count, Glob) and fixes the count', () => {
    const out = withoutSecretFiles({ mode: 'files_with_matches', numFiles: 3, filenames: ['src/a.php', 'sz4/.env', 'config/credentials.json'] }) as {
      filenames: string[];
      numFiles: number;
    };
    expect(out.filenames).toEqual(['src/a.php']);
    expect(out.numFiles).toBe(1);
  });

  it('leaves a clean result and unknown shapes alone', () => {
    expect(withoutSecretFiles({ mode: 'content', numFiles: 1, filenames: ['src/a.php'], content: 'src/a.php:1:x' })).toBeNull();
    expect(withoutSecretFiles({ mode: 'content', numFiles: 0, filenames: [], content: '' })).toBeNull();
    expect(withoutSecretFiles('No matches found')).toBeNull();
    expect(withoutSecretFiles(null)).toBeNull();
    expect(withoutSecretFiles({ something: 'else' })).toBeNull();
  });
});

describe('redactSecretResults', () => {
  const post = (tool_name: string, tool_response: unknown, hook_event_name = 'PostToolUse') => call(redactSecretResults, { hook_event_name, tool_name, tool_input: {}, tool_response });

  it('replaces the output of a Grep that reached a secret file', async () => {
    const out = (await post('Grep', { mode: 'content', filenames: [], content: 'config/credentials.json:1:canary\nsrc/a.php:2:canary' })) as {
      hookSpecificOutput: { hookEventName: string; updatedToolOutput: { content: string } };
    };
    expect(out.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(out.hookSpecificOutput.updatedToolOutput.content).toBe('src/a.php:2:canary');
  });

  it('replaces the output of a Glob that listed a secret file', async () => {
    const out = (await post('Glob', { durationMs: 1, numFiles: 2, filenames: ['a/.env', 'a/b.php'], truncated: false })) as {
      hookSpecificOutput: { updatedToolOutput: { filenames: string[] } };
    };
    expect(out.hookSpecificOutput.updatedToolOutput.filenames).toEqual(['a/b.php']);
  });

  it('does nothing for a clean result, another tool or another event', async () => {
    expect(await post('Grep', { mode: 'content', filenames: [], content: 'src/a.php:1:x' })).toEqual({});
    expect(await post('Read', { filenames: ['a/.env'] })).toEqual({});
    expect(await post('Grep', { filenames: ['a/.env'] }, 'PreToolUse')).toEqual({});
  });
});

describe('shell allowlist with git and secret files', () => {
  const hook = shellAllowlist([...GIT_MIRROR_READ]);
  const MIRROR = '/home/luiz/.cache/post-release-sync/sz4.git';
  const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });

  it.each([
    `git -C ${MIRROR} show a1b2c3d:.env`,
    `git -C ${MIRROR} show a1b2c3d:config/.env.local`,
    `git -C ${MIRROR} show a1b2c3d:config/credentials.json`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- .env`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- config/secrets.yml`,
    `git -C ${MIRROR} show a1b2c3d:token.json`,
    `git -C ${MIRROR} show a1b2c3d:.npmrc`,
    `git -C ${MIRROR} show a1b2c3d:certs/server.pem`,
  ])('refuses %s', async (command) => {
    expect(await decide(hook, bash(command))).toBe('deny');
  });

  it.each([
    `git -C ${MIRROR} show a1b2c3d:app/Services/Foo.php`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- app/Foo.php`,
    `git -C ${MIRROR} show a1b2c3d:app/Services/TokenService.php`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- app/secrets.php`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- src/auth/secret.service.ts`,
  ])('still allows %s', async (command) => {
    expect(await decide(hook, bash(command))).toBe('allow');
  });
});

describe('agentHooks', () => {
  it('wires the path check before Read, Grep and Glob and the result check after Grep and Glob', () => {
    const hooks = agentHooks();
    expect(hooks.PreToolUse?.map((h) => h.matcher)).toEqual(['Bash', 'Read|Grep|Glob', 'Grep|Glob']);
    expect(hooks.PreToolUse?.[1].hooks).toEqual([noSecrets]);
    expect(hooks.PostToolUse?.map((h) => h.matcher)).toEqual(['Grep|Glob']);
    expect(hooks.PostToolUse?.[0].hooks).toEqual([redactSecretResults]);
  });

  it('adds the extra shell patterns to the Bash hook', async () => {
    const MIRROR = '/home/luiz/.cache/post-release-sync/sz4.git';
    const command = `git -C ${MIRROR} merge-base a1b2c3d e4f5a6b`;
    const input = { tool_name: 'Bash', tool_input: { command } };
    expect(await decide(agentHooks().PreToolUse?.[0].hooks[0], input)).toBe('deny');
    expect(await decide(agentHooks(GIT_MIRROR_READ).PreToolUse?.[0].hooks[0], input)).toBe('allow');
  });
});
