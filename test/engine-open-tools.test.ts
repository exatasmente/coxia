import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_GLOBS, agentHooks, secretPath } from '../src/main/agents';
import { policyFromHooks } from '../src/main/engine/open/policy';
import { bashTool, parseCommand, prefixAllows, splitArgs } from '../src/main/engine/open/tools/bash';
import { readTool } from '../src/main/engine/open/tools/read';
import { globTool, globToRegex, grepTool } from '../src/main/engine/open/tools/search';
import type { ToolContext, ToolImpl } from '../src/main/engine/open/tools/types';

let root: string;
let outside: string;
let ctx: ToolContext;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'open-tools-'));
  outside = mkdtempSync(join(tmpdir(), 'open-outside-'));
  mkdirSync(join(root, 'src/deep'), { recursive: true });
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
  writeFileSync(join(root, 'a.ts'), 'export const token = 1;\nconst needle = "find me";\nexport default needle;\n');
  writeFileSync(join(root, 'src/b.ts'), 'function needle() {}\n// NEEDLE in caps\n');
  writeFileSync(join(root, 'src/deep/c.js'), 'module.exports = "needle";\n');
  writeFileSync(join(root, 'notes.md'), '# Notes\nneedle here\n');
  writeFileSync(join(root, 'TokenService.php'), '<?php // needle in code named token\n');
  writeFileSync(join(root, '.env'), 'API_KEY=needle-secret\n');
  writeFileSync(join(root, 'config/secrets.yml'), 'password: needle-secret\n');
  writeFileSync(join(root, 'token.json'), '{"t":"needle-secret"}\n');
  writeFileSync(join(root, 'node_modules/pkg/index.js'), 'needle\n');
  writeFileSync(join(root, 'bin.dat'), Buffer.from([0x50, 0, 0x51, 0x6e]));
  writeFileSync(join(outside, 'x.txt'), 'outside needle\n');
  symlinkSync(join(root, '.env'), join(root, 'innocent.txt'));
  symlinkSync(outside, join(root, 'escape'));
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  writeFileSync(join(root, 'long.txt'), lines);
  utimesSync(join(root, 'a.ts'), new Date(2020, 1, 1), new Date(2020, 1, 1));
  utimesSync(join(root, 'src/b.ts'), new Date(2024, 1, 1), new Date(2024, 1, 1));
  ctx = {
    cwd: root,
    roots: [root],
    isSecret: (p) => secretPath(p, root),
    secretGlobs: SECRET_GLOBS,
    outputMax: 30_000,
    env: { PATH: process.env.PATH ?? '' },
    bashPrefixes: [],
    ripgrep: 'auto',
  };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

async function run(tool: ToolImpl, input: Record<string, unknown>, c: ToolContext = ctx): Promise<string> {
  const r = await tool.run(input, c);
  return r.render(r.response);
}

async function fails(tool: ToolImpl, input: Record<string, unknown>, c: ToolContext = ctx): Promise<string> {
  try {
    await run(tool, input, c);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected a refusal');
}

describe('Read', () => {
  it('numbers the lines and pages with offset and limit', async () => {
    const all = await run(readTool, { file_path: 'a.ts' });
    expect(all.split('\n')[0]).toBe('1\texport const token = 1;');
    const page = await run(readTool, { file_path: join(root, 'long.txt'), offset: 5, limit: 3 });
    expect(page).toContain('5\tline 5');
    expect(page).toContain('7\tline 7');
    expect(page).not.toContain('8\tline 8');
    expect(page).toContain('use offset 8');
  });

  it('refuses paths outside the allowed folders, including through a symlink and ..', async () => {
    expect(await fails(readTool, { file_path: join(outside, 'x.txt') })).toContain('fora das pastas');
    expect(await fails(readTool, { file_path: 'escape/x.txt' })).toContain('fora das pastas');
    expect(await fails(readTool, { file_path: '../../../etc/passwd' })).toContain('fora das pastas');
    expect(await fails(readTool, { file_path: '/etc/hostname' })).toContain('fora das pastas');
  });

  it('allows an extra root', async () => {
    const text = await run(readTool, { file_path: join(outside, 'x.txt') }, { ...ctx, roots: [root, outside] });
    expect(text).toContain('outside needle');
  });

  it('refuses secret files, also through a symlink with an innocent name', async () => {
    for (const f of ['.env', 'config/secrets.yml', 'token.json', 'innocent.txt']) {
      expect(await fails(readTool, { file_path: f }), f).toContain('segredo');
    }
  });

  it('reads source code that only has a secret-looking name', async () => {
    expect(await run(readTool, { file_path: 'TokenService.php' })).toContain('needle in code');
  });

  it('refuses binaries, directories and missing files with a message the model can act on', async () => {
    expect(await fails(readTool, { file_path: 'bin.dat' })).toContain('binário');
    expect(await fails(readTool, { file_path: 'src' })).toContain('diretório');
    expect(await fails(readTool, { file_path: 'nope.txt' })).toContain('does not exist');
  });
});

describe('Grep', () => {
  const offCtx = (): ToolContext => ({ ...ctx, ripgrep: 'off' });

  it('lists matching files and never a secret one, with ripgrep and without', async () => {
    for (const c of [ctx, offCtx()]) {
      const out = await run(grepTool, { pattern: 'needle' }, c);
      const files = out.split('\n').sort();
      expect(files).toContain(join(root, 'a.ts'));
      expect(files).toContain(join(root, 'src/b.ts'));
      expect(files).toContain(join(root, 'TokenService.php'));
      expect(out).not.toContain('.env');
      expect(out).not.toContain('secrets.yml');
      expect(out).not.toContain('token.json');
      expect(out).not.toContain('innocent.txt');
      expect(out).not.toContain('needle-secret');
    }
  });

  it('gives the same file set from ripgrep and from the JS fallback (minus ignored folders)', async () => {
    const norm = (s: string) => s.split('\n').filter((f) => !f.includes('node_modules') && !f.includes('bin.dat')).sort();
    const a = norm(await run(grepTool, { pattern: 'needle' }, ctx));
    const b = norm(await run(grepTool, { pattern: 'needle' }, offCtx()));
    expect(a).toEqual(b);
  });

  it('content mode returns path:line:text and honours -i, glob and context', async () => {
    for (const c of [ctx, offCtx()]) {
      const out = await run(grepTool, { pattern: 'needle', output_mode: 'content', glob: '*.ts', '-i': true }, c);
      expect(out).toContain(`${join(root, 'src/b.ts')}:1:function needle() {}`);
      expect(out).toContain(`${join(root, 'src/b.ts')}:2:// NEEDLE in caps`);
      expect(out).not.toContain('notes.md');
      const withCtx = await run(grepTool, { pattern: 'find me', output_mode: 'content', '-B': 1, path: 'a.ts' }, c);
      expect(withCtx).toContain('a.ts-1-export const token = 1;');
      expect(withCtx).toContain('a.ts:2:const needle = "find me";');
    }
  });

  it('count mode and head_limit', async () => {
    const count = await run(grepTool, { pattern: 'needle', output_mode: 'count', path: 'src' }, offCtx());
    expect(count).toContain(`${join(root, 'src/b.ts')}:1`);
    const limited = await run(grepTool, { pattern: 'needle', head_limit: 1 }, offCtx());
    expect(limited.split('\n')[0]).toBeTruthy();
    expect(limited).toContain('limitado a 1');
  });

  it('a search that targets a secret file directly finds nothing', async () => {
    for (const c of [ctx, offCtx()]) {
      expect(await run(grepTool, { pattern: 'needle', path: '.env', output_mode: 'content' }, c)).toBe('Nenhuma ocorrência.');
    }
  });

  it('refuses a path outside the roots and reports a bad regex', async () => {
    expect(await fails(grepTool, { pattern: 'x', path: outside })).toContain('fora das pastas');
    expect(await fails(grepTool, { pattern: '(' }, offCtx())).toContain('Expressão regular inválida');
  });

  it('says so when nothing matches', async () => {
    expect(await run(grepTool, { pattern: 'zzz-not-there' })).toBe('Nenhuma ocorrência.');
  });
});

describe('Glob', () => {
  it('matches patterns, newest first, never secrets or node_modules', async () => {
    const ts = (await run(globTool, { pattern: '**/*.ts' })).split('\n');
    expect(ts).toEqual([join(root, 'src/b.ts'), join(root, 'a.ts')]);
    expect(await run(globTool, { pattern: '*.js' })).toBe(join(root, 'src/deep/c.js'));
    const braces = (await run(globTool, { pattern: 'src/**/*.{ts,js}' })).split('\n').sort();
    expect(braces).toEqual([join(root, 'src/b.ts'), join(root, 'src/deep/c.js')].sort());
    const all = await run(globTool, { pattern: '**/*' });
    expect(all).not.toContain('.env');
    expect(all).not.toContain('secrets.yml');
    expect(all).not.toContain('token.json');
    expect(all).not.toContain('node_modules');
    expect(all).toContain('TokenService.php');
  });

  it('refuses a directory outside the roots', async () => {
    expect(await fails(globTool, { pattern: '*', path: outside })).toContain('fora das pastas');
  });

  it('translates globs', () => {
    expect(globToRegex('**/*.ts').test('a/b/c.ts')).toBe(true);
    expect(globToRegex('**/*.ts').test('c.ts')).toBe(true);
    expect(globToRegex('*.ts').test('a/c.ts')).toBe(false);
    expect(globToRegex('a?.ts').test('ab.ts')).toBe(true);
    expect(globToRegex('{a,b}.ts').test('b.ts')).toBe(true);
    expect(globToRegex('f[0-9].ts').test('f3.ts')).toBe(true);
    expect(globToRegex('a.b').test('axb')).toBe(false);
  });
});

describe('Bash', () => {
  it('splits arguments like a shell, without running one', () => {
    expect(splitArgs('glab api "projects/a%2Fb/issues/1" --paginate')).toEqual(['glab', 'api', 'projects/a%2Fb/issues/1', '--paginate']);
    expect(splitArgs("echo 'a b' c\\ d")).toEqual(['echo', 'a b', 'c d']);
    expect(() => splitArgs('echo "open')).toThrow('Aspas');
  });

  it('peels the two allowed decorations off the command', () => {
    expect(parseCommand('glab api x 2>&1 | head -n 20')).toEqual({ argv: ['glab', 'api', 'x'], mergeStderr: true, head: { unit: 'n', count: 20 } });
    expect(parseCommand('glab api x | head -c 5')).toEqual({ argv: ['glab', 'api', 'x'], mergeStderr: false, head: { unit: 'c', count: 5 } });
  });

  it('checks Bash(prefix:*) rules', () => {
    expect(prefixAllows(['glab api', 'glab mr view'], 'glab api projects/x')).toBe(true);
    expect(prefixAllows(['glab api'], 'glab apix')).toBe(false);
    expect(prefixAllows(['git -C'], 'git -C /x log')).toBe(true);
    expect(prefixAllows(['glab api'], 'git status')).toBe(false);
    expect(prefixAllows([], 'anything')).toBe(true);
  });

  it('runs the program directly: operators and variables stay literal', async () => {
    expect(await run(bashTool, { command: 'echo hi; echo bye' })).toBe('hi; echo bye');
    expect(await run(bashTool, { command: 'echo $HOME' })).toBe('$HOME');
    expect(await run(bashTool, { command: 'echo "a b" | head -c 3' })).toBe('a b');
    expect(await run(bashTool, { command: 'node -e "console.error(7)" 2>&1' })).toBe('7');
  });

  it('reports a missing program and a failing exit code', async () => {
    expect(await run(bashTool, { command: 'definitely-not-a-program-xyz' })).toContain('comando não encontrado');
    expect(await run(bashTool, { command: 'node -e "process.exit(3)"' })).toContain('código de saída 3');
  });

  it('enforces the allowed prefixes inside the tool as well', async () => {
    expect(await fails(bashTool, { command: 'echo hi' }, { ...ctx, bashPrefixes: ['glab api'] })).toContain('fora do que a cerimônia pode rodar');
  });
});

describe('the shared policy, same refusals as the Claude path', () => {
  const policy = policyFromHooks(agentHooks(), 'sess');
  const pre = (tool: string, input: Record<string, unknown>) => policy.pre(tool, input, root);

  it('denies secret files through the same noSecrets hook', async () => {
    for (const f of ['.env', join(root, '.env'), 'config/secrets.yml', 'token.json', 'innocent.txt', '~/.ssh/id_rsa', 'server.pem', '.mcp.json']) {
      expect(await pre('Read', { file_path: f }), f).toContain('segredo');
    }
    expect(await pre('Read', { file_path: 'TokenService.php' })).toBeNull();
    expect(await pre('Grep', { pattern: 'x', path: '.env' })).toContain('segredo');
    expect(await pre('Grep', { pattern: 'x', glob: '**/.env*' })).toContain('segredo');
    expect(await pre('Glob', { pattern: '**/.env*' })).toContain('segredo');
  });

  it('denies every shell command the Claude allowlist denies and allows the ones it allows', async () => {
    const denied = [
      'ls -la',
      'cat /etc/passwd',
      'glab api projects/acme%2Fweb/issues/1/notes; rm -rf /',
      'glab api projects/acme%2Fweb/issues/1/notes && echo hi',
      'glab api projects/acme%2Fweb/issues/1/notes | sh',
      'glab api -X POST projects/acme%2Fweb/issues/1/notes',
      'glab mr create',
      'git status',
      'git -C /home/u/.cache/release-sync/web.git merge-tree --output=/tmp/x a b',
      'curl http://evil.example',
    ];
    for (const command of denied) expect(await pre('Bash', { command }), command).toContain('só lê');
    const allowed = [
      'glab api projects/acme%2Fweb/merge_requests/303/discussions',
      'glab api projects/acme%2Fweb/issues/101/notes 2>&1 | head -n 20',
      'glab mr view 303 -R acme/web --comments',
    ];
    for (const command of allowed) expect(await pre('Bash', { command }), command).toBeNull();
  });

  it('allows the git mirror reads only when the call opts in', async () => {
    const git = policyFromHooks(agentHooks([/^git -C \/home\/[\w-]+\/\.cache\/release-sync\/[\w./-]+\.git merge-base( [\w./:^~-]+)+$/]), 's');
    expect(await git.pre('Bash', { command: 'git -C /home/u/.cache/release-sync/web.git merge-base aaa bbb' }, root)).toBeNull();
    expect(await policy.pre('Bash', { command: 'git -C /home/u/.cache/release-sync/web.git merge-base aaa bbb' }, root)).toContain('só lê');
  });

  it('redacts secret file names that leak into Grep and Glob results', async () => {
    const out = await policy.post('Grep', { pattern: 'x' }, { mode: 'content', content: `${join(root, 'a.ts')}:1:ok\n${join(root, '.env')}:1:API_KEY=1`, numFiles: 0 }, root);
    expect(JSON.stringify(out)).not.toContain('.env');
    expect(JSON.stringify(out)).toContain('a.ts');
    const files = await policy.post('Glob', { pattern: '*' }, { filenames: [join(root, 'a.ts'), join(root, 'token.json')], numFiles: 2 }, root);
    expect(files).toMatchObject({ filenames: [join(root, 'a.ts')], numFiles: 1 });
    expect(await policy.post('Grep', { pattern: 'x' }, { mode: 'content', content: `${join(root, 'a.ts')}:1:ok`, numFiles: 0 }, root)).toBeNull();
  });
});
