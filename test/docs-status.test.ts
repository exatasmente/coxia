import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGENTS_FILE, AGENTS_FILE_MAX } from '../src/shared/harness/agentsMd';
import { BUDGET_MAX } from '../src/shared/harness/select';
import { isClaudeSource } from '../src/shared/harness/status';
import { docsStatus } from '../src/main/harness/status';
import type { Run } from '../src/shared/runs';

vi.setConfig({ testTimeout: 30_000 });

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'cerimonias-docs-status-'));
  constructor() {
    roots.push(this.dir);
    this.git('init', '-q', '-b', 'main');
  }
  git(...args: string[]): string {
    const result = spawnSync('git', [...ID, ...args], { cwd: this.dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  }
  write(rel: string, text: string): void {
    mkdirSync(dirname(join(this.dir, rel)), { recursive: true });
    writeFileSync(join(this.dir, rel), text);
  }
  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '--no-verify', '-m', message);
    return this.git('rev-parse', 'HEAD');
  }
}

const run = (over: Partial<Run> & { status: Run['status'] }): Run =>
  ({ id: 'run-1', issue: { ref: 'docs:app' }, docs: { mode: 'create' }, ...over }) as unknown as Run;
const status = (repos: { id: string; path: string }[], runs: Run[] = [], flow = true) => docsStatus({ repos, runs, flow });

describe('root AGENTS.md status', () => {
  it('reports no instructions and includes the current checkout', async () => {
    const repo = new Repo();
    repo.write('src/a.ts', 'one\n');
    repo.commit('code');
    const [result] = (await status([{ id: 'app', path: repo.dir }])).repos;
    expect(result).toMatchObject({ repo: 'app', exists: false, ready: false, ignored: [], claude: false, run: null });
    expect(result.head?.commit).toBe(repo.git('rev-parse', '--short', 'HEAD'));
    expect(result.head?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('recognizes plain Markdown and keeps Claude Code files separate', async () => {
    const repo = new Repo();
    repo.write(AGENTS_FILE, '# Project instructions\n');
    repo.write('CLAUDE.md', 'Claude session notes\n');
    repo.commit('notes');
    const [result] = (await status([{ id: 'app', path: repo.dir }])).repos;
    expect(result).toMatchObject({ exists: true, ready: true, claude: true });
  });

  it('marks symlinks, directories and oversized files as blocked without following or reading them', async () => {
    const repo = new Repo();
    const outside = join(repo.dir, 'outside.md');
    writeFileSync(outside, 'outside');
    symlinkSync(outside, join(repo.dir, AGENTS_FILE));
    expect((await status([{ id: 'app', path: repo.dir }])).repos[0]).toMatchObject({ exists: true, ready: false, ignored: [AGENTS_FILE] });

    rmSync(join(repo.dir, AGENTS_FILE));
    mkdirSync(join(repo.dir, AGENTS_FILE));
    expect((await status([{ id: 'app', path: repo.dir }])).repos[0].ready).toBe(false);

    rmSync(join(repo.dir, AGENTS_FILE), { recursive: true });
    writeFileSync(join(repo.dir, AGENTS_FILE), 'x'.repeat(AGENTS_FILE_MAX + 1));
    expect((await status([{ id: 'app', path: repo.dir }])).repos[0]).toMatchObject({ exists: true, ready: false, ignored: [AGENTS_FILE] });
  });

  it('reports only the active documentation run for the same repository', async () => {
    const repo = new Repo();
    const repos = [{ id: 'app', path: repo.dir }];
    expect((await status(repos, [run({ status: 'gate' })])).repos[0].run).toEqual({ id: 'run-1' });
    expect((await status(repos, [run({ status: 'done' })])).repos[0].run).toBeNull();
    expect((await status(repos, [run({ status: 'working', issue: { ref: 'docs:other' } } as Partial<Run> & { status: Run['status'] })])).repos[0].run).toBeNull();
    expect((await status(repos, [run({ status: 'working', docs: undefined })])).repos[0].run).toBeNull();
  });

  it('preserves repository order and status when a checkout is missing', async () => {
    const first = new Repo();
    first.write(AGENTS_FILE, '# First\n');
    first.commit('first');
    const second = new Repo();
    second.write('x', '1\n');
    second.commit('second');
    const result = await status([{ id: 'one', path: first.dir }, { id: 'gone', path: join(first.dir, 'missing') }, { id: 'two', path: second.dir }]);
    expect(result.repos.map((item) => [item.repo, item.exists, item.ready])).toEqual([['one', true, true], ['gone', false, false], ['two', false, false]]);
    expect(result.repos[1].head).toBeNull();
  });

  it('carries flow availability and the documentation budget', async () => {
    expect(await status([], [], false)).toMatchObject({ flow: false, budget: BUDGET_MAX });
    expect((await status([], [], true)).flow).toBe(true);
  });
});

describe('Claude Code source detection', () => {
  it('marks source lists that point at Claude Code files', () => {
    expect(isClaudeSource('claudeMdRoots', '~/work/app')).toBe(true);
    expect(isClaudeSource('skillsDirs', '~/work/app/.claude/skills')).toBe(true);
    expect(isClaudeSource('rulesDirs', '/home/nobody/.claude/rules')).toBe(true);
    expect(isClaudeSource('knowledgeDirs', '~/work/AGENTS.md')).toBe(false);
    expect(isClaudeSource('agentsDirs', '.claude')).toBe(true);
  });

  it('leaves unrelated paths and MCP files unmarked', () => {
    expect(isClaudeSource('skillsDirs', '~/work/claude-tools/skills')).toBe(false);
    expect(isClaudeSource('rulesDirs', '~/work/app/.claudette/rules')).toBe(false);
    expect(isClaudeSource('knowledgeDirs', '~/work/docs')).toBe(false);
    expect(isClaudeSource('mcpConfigFiles', '~/.claude.json')).toBe(false);
    expect(isClaudeSource('mcpConfigFiles', '~/work/app/.claude/.mcp.json')).toBe(false);
  });
});
