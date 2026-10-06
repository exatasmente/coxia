import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, obj, secretPath, str } from '../src/main/agents';
import { checkPath, scrubbedEnv } from '../src/main/engine/guard';
import { ChatClient } from '../src/main/engine/open/client';
import { type OpenRunParams, runOpen } from '../src/main/engine/open/loop';
import { policyFromHooks } from '../src/main/engine/open/policy';
import { editTool, writeTool } from '../src/main/engine/open/tools/write';
import type { ToolContext } from '../src/main/engine/open/tools/types';
import { type Denial, confinedHooks, readConfinedHooks } from '../src/main/runner/hooks';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';

let base: string;
let root: string;
let outside: string;
let docs: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'guard-'));
  root = join(base, 'wt');
  outside = join(base, 'elsewhere');
  docs = join(base, 'docs');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.git/hooks'), { recursive: true });
  mkdirSync(join(root, 'sub/.git'), { recursive: true });
  mkdirSync(join(root, '.husky'));
  mkdirSync(outside);
  mkdirSync(docs);
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, '.env'), 'KEY=1\n');
  writeFileSync(join(outside, 'target.txt'), 'outside\n');
  writeFileSync(join(docs, 'guide.md'), '# guide\n');
  symlinkSync(join(outside, 'target.txt'), join(root, 'file-link'));
  symlinkSync(outside, join(root, 'dir-link'));
  symlinkSync(join(outside, 'nowhere.txt'), join(root, 'dangling'));
  symlinkSync(join(root, '.git'), join(root, 'git-alias'));
  symlinkSync(join(root, 'src/a.ts'), join(root, 'inside-link'));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const code = (input: unknown, opts = {}) => {
  const r = checkPath(root, input, { isSecret: (p) => secretPath(p, root), ...opts });
  return r.ok ? 'ok' : r.code;
};

describe('the path guard for a write', () => {
  it('lets an agent create and change files inside the worktree, whether the path is relative or absolute', () => {
    expect(code('src/a.ts')).toBe('ok');
    expect(code('src/new/deep/file.ts')).toBe('ok');
    expect(code(join(root, 'src/b.ts'))).toBe('ok');
    expect(code('./README.md')).toBe('ok');
  });

  it('refuses a path outside, absolute or with ..', () => {
    expect(code('/etc/passwd')).toBe('outside');
    expect(code(join(outside, 'x.txt'))).toBe('outside');
    expect(code(`${root}-sibling/x`)).toBe('outside');
    expect(code('../elsewhere/x.txt')).toBe('traversal');
    expect(code('src/../../elsewhere/x.txt')).toBe('traversal');
    expect(code('src/..\\..\\x')).toBe('traversal');
    expect(code('~/.bashrc')).toBe('outside');
    expect(code('~')).toBe('outside');
  });

  it('refuses the root itself and a path that is not one', () => {
    expect(code(root)).toBe('outside');
    expect(code('.')).toBe('outside');
    for (const bad of [undefined, null, 5, '', '  ', 'a\0b', {}, ['x']]) expect(code(bad)).toBe('no-path');
  });

  it('refuses a symbolic link that leads out, one that leads nowhere, and a new file under a linked folder', () => {
    expect(code('file-link')).toBe('outside');
    expect(code('dir-link/new.txt')).toBe('outside');
    expect(code('dir-link/sub/new.txt')).toBe('outside');
    expect(code('dangling')).toBe('dangling');
  });

  it('follows a link that stays inside', () => {
    const r = checkPath(root, 'inside-link');
    expect(r).toMatchObject({ ok: true, rel: 'src/a.ts' });
  });

  it('refuses .git in every spelling, a link to it, and the files that make git run things', () => {
    for (const p of ['.git/config', '.git/hooks/pre-commit', '.git/HEAD', '.GIT/config', 'sub/.git/config', 'sub/.git', 'git-alias/config', 'git-alias/hooks/x', '.git']) expect(code(p), p).toBe('git');
    expect(code('.husky/pre-commit')).toBe('hooks');
    expect(code('.githooks/pre-push')).toBe('hooks');
    expect(code('.gitattributes')).toBe('git');
    expect(code('pkg/.gitmodules')).toBe('git');
    expect(code(join(root, '.git/hooks/post-commit'))).toBe('git');
  });

  it('refuses a secret file, written or reached through a link', () => {
    expect(code('.env')).toBe('secret');
    expect(code('config/secrets.yml')).toBe('secret');
  });

  it('for a read: lets the agent look at the root and at hook folders, but never inside .git or outside', () => {
    expect(code('.', { read: true })).toBe('ok');
    expect(code('.husky/pre-commit', { read: true })).toBe('ok');
    expect(code('.git/config', { read: true })).toBe('git');
    expect(code('/etc/passwd', { read: true })).toBe('outside');
    expect(code('dir-link/target.txt', { read: true })).toBe('outside');
  });
});

describe('the path guard of a reading agent of a run', () => {
  const denials: Denial[] = [];
  const hooks = (roots: string[] = []) => readConfinedHooks({ root, roots, onDenied: (d) => denials.push(d) });
  beforeEach(() => (denials.length = 0));
  const pre = (tool: string, input: Record<string, unknown>, roots: string[] = []) => policyFromHooks(hooks(roots), 's1').pre(tool, input, root);

  it('lets a reader look inside the worktree and refuses every way out, naming the reason to the agent and telling the runner', async () => {
    expect(await pre('Read', { file_path: 'src/a.ts' })).toBeNull();
    expect(await pre('Read', { file_path: '.' })).toBeNull();
    expect(await pre('Glob', { pattern: 'src/**/*.ts' })).toBeNull();
    expect(await pre('Grep', { pattern: 'a', path: 'src' })).toBeNull();
    expect(await pre('Read', { file_path: '/etc/passwd' })).toMatch(/fora da pasta|outside/i);
    expect(await pre('Read', { file_path: '../elsewhere/target.txt' })).toMatch(/\.\./);
    expect(await pre('Read', { file_path: '~/.bashrc' })).toMatch(/fora da pasta|outside/i);
    expect(await pre('Read', { file_path: 'file-link' })).toMatch(/fora da pasta|outside/i);
    expect(await pre('Read', { file_path: '.git/config' })).toMatch(/\.git/);
    // a secret name is refused by the ceremony filter that runs in front of the guard, so the guard records no denial of its own for it
    expect(await pre('Read', { file_path: '.env' })).toMatch(/segredo|secret/i);
    expect(denials.map((d) => d.code)).toEqual(['outside', 'traversal', 'outside', 'outside', 'git']);
    expect(denials.every((d) => d.tool.startsWith('Read'))).toBe(true);
    expect(denials[4].target).toBe('.git/config');
  });

  it('refuses nothing of the ceremony policy a reader already had: a secret name, a broad search, an over-wide result', async () => {
    // the secret filter of the ceremonies still refuses before the guard
    expect(await pre('Grep', { pattern: 'x', path: '.env' })).not.toBeNull();
    // and the guard composes with it instead of replacing it: a secret reached from inside is refused by name, not by path
    expect(await pre('Read', { file_path: 'config/secrets.yml' })).toMatch(/segredo|secret/i);
  });

  it('lets a reader reach the documentation folders it was given, and no other folder outside the worktree', async () => {
    expect(await pre('Read', { file_path: join(docs, 'guide.md') }, [docs])).toBeNull();
    expect(await pre('Read', { file_path: join(docs, 'guide.md') })).not.toBeNull();
    expect(await pre('Read', { file_path: join(outside, 'target.txt') }, [docs])).not.toBeNull();
    // a folder that does not exist is not a root
    expect(await pre('Read', { file_path: join(base, 'ghost', 'x.md') }, [join(base, 'ghost')])).not.toBeNull();
  });

  it('through the loop of the open engine, the model reads the refusal of a reading agent with the path and the folders', async () => {
    const fake = await fakeOpenAI((req) =>
      req.n === 1 ? toolStep([{ id: 'r1', name: 'Read', args: { file_path: join(outside, 'target.txt') } }]) : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'ok' } }]),
    );
    try {
      const collected: Denial[] = [];
      const hooksForReader = readConfinedHooks({ root, roots: [docs], onDenied: (d) => collected.push(d) });
      const r = await runOpen<{ fala: string }>({
        role: 'dev',
        prompt: 'read',
        schema: obj({ fala: str }),
        client: new ChatClient({ baseUrl: fake.url, model: 'fake-model', retryDelayMs: 0 }),
        cwd: root,
        allowedTools: ['Read'],
        hooks: hooksForReader,
        isSecret: (q) => secretPath(q, root),
        secretGlobs: SECRET_GLOBS,
        docs: {},
        maxTurns: 3,
        sessionsDir: null,
        ripgrep: 'off',
      });
      expect(r.data.fala).toBe('ok');
      const second = fake.chats()[1].body as { messages: { role: string; content: string }[] };
      const content = second.messages.filter((m) => m.role === 'tool').map((m) => m.content).join('\n');
      // the model reads the path it tried, so it can correct itself
      expect(content).toMatch(/target\.txt/);
      expect(collected.map((d) => d.code)).toEqual(['outside']);
    } finally {
      await fake.close();
    }
  });
});

describe('the environment of the commands of an agent that writes', () => {
  it('drops what looks like a credential and keeps what a test run needs', () => {
    const env = scrubbedEnv({ PATH: '/bin', HOME: '/h', LANG: 'C', GITHUB_TOKEN: 'x', MY_API_KEY: 'y', AWS_PROFILE: 'z', SSH_AUTH_SOCK: '/s', ANTHROPIC_BASE_URL: 'u', NPM_CONFIG_USERCONFIG: 'q', DB_PASSWORD: 'p' });
    expect(Object.keys(env).sort()).toEqual(['GIT_TERMINAL_PROMPT', 'HOME', 'LANG', 'PATH']);
  });
});

describe('the hooks of the confinement', () => {
  const denials: Denial[] = [];
  const hooks = () => confinedHooks({ root, commands: ['npm test', 'npm run typecheck'], onDenied: (d) => denials.push(d) });
  beforeEach(() => (denials.length = 0));

  const policy = () => policyFromHooks(hooks(), 's1');
  const pre = (tool: string, input: Record<string, unknown>) => policy().pre(tool, input, root);

  it('allow a write inside and refuse one outside, naming the reason to the agent and telling the runner', async () => {
    expect(await pre('Write', { file_path: 'src/new.ts', content: 'x' })).toBeNull();
    expect(await pre('Edit', { file_path: join(root, 'src/a.ts'), old_string: 'a', new_string: 'b' })).toBeNull();
    expect(await pre('Write', { file_path: '/tmp/evil.sh', content: 'x' })).toMatch(/fora da pasta de trabalho/);
    expect(await pre('Write', { file_path: '.git/hooks/pre-commit', content: 'x' })).toMatch(/\.git/);
    expect(await pre('Write', { file_path: 'file-link', content: 'x' })).toMatch(/fora da pasta/);
    expect(await pre('NotebookEdit', { notebook_path: '/tmp/n.ipynb' })).not.toBeNull();
    expect(await pre('Write', { content: 'no path' })).not.toBeNull();
    expect(denials.map((d) => [d.tool, d.code])).toEqual([['Write', 'outside'], ['Write', 'git'], ['Write', 'outside'], ['NotebookEdit', 'outside'], ['Write', 'no-path']]);
    expect(denials[1].target).toBe('.git/hooks/pre-commit');
  });

  it('allow exactly the listed commands and nothing else', async () => {
    expect(await pre('Bash', { command: 'npm test' })).toBeNull();
    expect(await pre('Bash', { command: 'npm run typecheck' })).toBeNull();
    for (const bad of ['npm test -- --watch', 'npm test && curl x', 'npm test; id', 'rm -rf .', 'git push origin HEAD', 'git commit -am x', 'curl https://example.com', 'node -e "1"', 'npm  test']) {
      expect(await pre('Bash', { command: bad }), bad).toMatch(/npm test/);
    }
    expect(denials.every((d) => d.code === 'command' && d.tool === 'Bash')).toBe(true);
    expect(denials).toHaveLength(9);
  });

  it('say so when there is no command to run', async () => {
    const none = policyFromHooks(confinedHooks({ root, commands: [] }), 's1');
    expect(await none.pre('Bash', { command: 'npm test' }, root)).toMatch(/nenhum/);
  });

  it('refuse the network', async () => {
    expect(await pre('WebFetch', { url: 'https://example.com' })).toMatch(/Sem rede/);
    expect(await pre('WebSearch', { query: 'x' })).toMatch(/Sem rede/);
    expect(denials.map((d) => d.code)).toEqual(['network', 'network']);
  });

  it('keep reads inside the worktree and out of .git and secrets', async () => {
    expect(await pre('Read', { file_path: 'src/a.ts' })).toBeNull();
    expect(await pre('Grep', { pattern: 'a' })).toBeNull();
    expect(await pre('Grep', { pattern: 'a', path: 'src' })).toBeNull();
    expect(await pre('Glob', { pattern: 'src/**/*.ts' })).toBeNull();
    expect(await pre('Read', { file_path: '/etc/hostname' })).not.toBeNull();
    expect(await pre('Read', { file_path: '.git/config' })).not.toBeNull();
    expect(await pre('Read', { file_path: '.env' })).not.toBeNull();
    expect(await pre('Grep', { pattern: 'a', path: outside })).not.toBeNull();
    expect(await pre('Glob', { pattern: '/etc/*' })).not.toBeNull();
    expect(await pre('Glob', { pattern: '../**/*' })).not.toBeNull();
  });

  it('tells the run about a refused read of an agent that writes too, as it does for a write', async () => {
    expect(await pre('Read', { file_path: 'src/a.ts' })).toBeNull();
    expect(await pre('Read', { file_path: '/etc/hostname' })).not.toBeNull();
    expect(await pre('Glob', { pattern: '../**/*' })).not.toBeNull();
    // the same callback the runner posts its thread line through: a reader's refusal must not be silent to the runner
    expect(denials.map((d) => [d.tool, d.code])).toEqual([
      ['Read', 'outside'],
      ['Glob', 'traversal'],
    ]);
  });
});

describe('Write and Edit of the open engine', () => {
  const ctx = (writeRoot: string | null): ToolContext => ({ cwd: root, roots: [root], isSecret: (p) => secretPath(p, root), secretGlobs: SECRET_GLOBS, outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off', writeRoot });
  const run = async (tool: typeof writeTool, input: Record<string, unknown>, c = ctx(root)) => {
    const r = await tool.run(input, c);
    return r.render(r.response);
  };
  const fails = async (tool: typeof writeTool, input: Record<string, unknown>, c = ctx(root)) => {
    try {
      await run(tool, input, c);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('expected a refusal');
  };

  afterEach(() => rmSync(join(root, 'made'), { recursive: true, force: true }));

  it('write creates folders and files inside the worktree', async () => {
    await run(writeTool, { file_path: 'made/deep/x.txt', content: 'hello\n' });
    expect(readFileSync(join(root, 'made/deep/x.txt'), 'utf8')).toBe('hello\n');
  });

  it('write and edit refuse by themselves what the guard refuses, even with no hook in front of them', async () => {
    expect(await fails(writeTool, { file_path: '/tmp/x', content: 'x' })).toMatch(/outside|fora/i);
    expect(await fails(writeTool, { file_path: 'dir-link/x.txt', content: 'x' })).toMatch(/outside|fora/i);
    expect(await fails(writeTool, { file_path: '.git/hooks/pre-commit', content: 'x' })).toMatch(/\.git/);
    expect(await fails(editTool, { file_path: 'file-link', old_string: 'outside', new_string: 'x' })).toMatch(/outside|fora/i);
    expect(existsSync(join(outside, 'x.txt'))).toBe(false);
    expect(readFileSync(join(outside, 'target.txt'), 'utf8')).toBe('outside\n');
  });

  it('refuse everything when the call has no write root', async () => {
    expect(await fails(writeTool, { file_path: 'made/x.txt', content: 'x' }, ctx(null))).toMatch(/cannot change files|não pode alterar/i);
    expect(existsSync(join(root, 'made'))).toBe(false);
  });

  it('edit replaces one occurrence, asks for more context when there are several, and needs the text to exist', async () => {
    await run(writeTool, { file_path: 'made/e.txt', content: 'one two one\n' });
    expect(await fails(editTool, { file_path: 'made/e.txt', old_string: 'one', new_string: 'x' })).toMatch(/2/);
    await run(editTool, { file_path: 'made/e.txt', old_string: 'two', new_string: 'three' });
    await run(editTool, { file_path: 'made/e.txt', old_string: 'one', new_string: 'zero', replace_all: true });
    expect(readFileSync(join(root, 'made/e.txt'), 'utf8')).toBe('zero three zero\n');
    expect(await fails(editTool, { file_path: 'made/e.txt', old_string: 'missing', new_string: 'x' })).toBeTruthy();
    expect(await fails(editTool, { file_path: 'made/e.txt', old_string: 'zero', new_string: 'zero' })).toBeTruthy();
  });
});

describe('through the loop of the open engine', () => {
  let fake: Fake | null = null;
  let sessions: string;
  afterEach(async () => {
    await fake?.close();
    fake = null;
    rmSync(join(root, 'made'), { recursive: true, force: true });
  });

  it('writes inside, is refused outside, and the model reads the reason', async () => {
    sessions = join(base, 'sessions');
    const schema = obj({ fala: str });
    fake = await fakeOpenAI((req) =>
      req.n === 1
        ? toolStep([
            { id: 'w1', name: 'Write', args: { file_path: 'made/ok.txt', content: 'fine\n' } },
            { id: 'w2', name: 'Write', args: { file_path: '/tmp/coxia-guard-must-not-exist.txt', content: 'bad\n' } },
            { id: 'w3', name: 'Write', args: { file_path: '.git/hooks/pre-commit', content: 'bad\n' } },
            { id: 'b1', name: 'Bash', args: { command: 'curl https://example.com' } },
          ])
        : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'ok' } }]),
    );
    const denials: Denial[] = [];
    const p: OpenRunParams = {
      role: 'dev',
      prompt: 'write',
      schema,
      client: new ChatClient({ baseUrl: fake.url, model: 'fake-model', retryDelayMs: 0 }),
      cwd: root,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash(npm test)'],
      writeRoot: root,
      hooks: confinedHooks({ root, commands: ['npm test'], onDenied: (d) => denials.push(d) }),
      isSecret: (q) => secretPath(q, root),
      secretGlobs: SECRET_GLOBS,
      docs: {},
      maxTurns: 4,
      sessionsDir: sessions,
      ripgrep: 'off',
    };
    const r = await runOpen<{ fala: string }>(p);
    expect(r.data.fala).toBe('ok');
    expect(readFileSync(join(root, 'made/ok.txt'), 'utf8')).toBe('fine\n');
    expect(existsSync('/tmp/coxia-guard-must-not-exist.txt')).toBe(false);
    expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false);
    const second = fake.chats()[1].body as { messages: { role: string; content: string }[] };
    const results = second.messages.filter((m) => m.role === 'tool').map((m) => m.content);
    expect(results[0]).toMatch(/fine|ok\.txt/);
    expect(results[1]).toMatch(/fora da pasta/);
    expect(results[2]).toMatch(/\.git/);
    expect(results[3]).toMatch(/npm test/);
    expect(denials.map((d) => d.code)).toEqual(['outside', 'git', 'command']);
  });

  it('does not offer Write and Edit to a call that has no write root', async () => {
    const schema = obj({ fala: str });
    fake = await fakeOpenAI([toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'ok' } }])]);
    await runOpen({
      role: 'dev',
      prompt: 'x',
      schema,
      client: new ChatClient({ baseUrl: fake.url, model: 'fake-model', retryDelayMs: 0 }),
      cwd: root,
      allowedTools: ['Read', 'Write', 'Edit'],
      docs: {},
      maxTurns: 2,
      sessionsDir: null,
      ripgrep: 'off',
    });
    const tools = ((fake.chats()[0].body as { tools: { function: { name: string } }[] }).tools ?? []).map((t) => t.function.name);
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });
});
