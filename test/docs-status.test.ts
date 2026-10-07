import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET_MAX } from '../src/shared/harness/select';
import { isClaudeSource } from '../src/shared/harness/status';
import { docsStatus } from '../src/main/harness/status';
import { clearHarnessCache } from '../src/main/harness/stale';
import type { Run } from '../src/shared/runs';

vi.setConfig({ testTimeout: 30_000 });

// What Settings › Documentation reads, per repository: real temporary repositories (hermetic git, test/setup.ts), no network, no model.
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const roots: string[] = [];
beforeEach(() => clearHarnessCache());
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'cerimonias-docs-status-'));
  constructor() {
    roots.push(this.dir);
    this.git('init', '-q', '-b', 'main');
  }
  git(...args: string[]): string {
    const r = spawnSync('git', [...ID, ...args], { cwd: this.dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
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
  doc(rel: string, commit: string, ...extra: string[]): void {
    this.write(`.coxia/${rel}`, ['---', `checked-commit: ${commit}`, 'checked-date: 2026-10-06', ...extra, '---', '', '# Text', ''].join('\n'));
  }
}

const run = (over: Partial<Run> & { status: Run['status'] }): Run => ({ id: 'run-1', issue: { ref: 'docs:app' }, docs: { mode: 'create' }, ...over }) as unknown as Run;
const status = (repos: { id: string; path: string }[], runs: Run[] = [], flow = true) => docsStatus({ repos, runs, flow });

/** Code at C1 and a documented repository whose files are checked against C1. */
function documented(): { r: Repo; c1: string } {
  const r = new Repo();
  r.write('src/a.ts', 'one\n');
  r.write('src/b.ts', 'one\n');
  const c1 = r.commit('code');
  r.doc('README.md', c1);
  r.doc('rules/a.md', c1, 'evidence: [src/a.ts:1]');
  r.doc('rules/b.md', c1, 'evidence: [src/b.ts:1]');
  r.doc('skills/ship.md', c1);
  r.doc('roles/reviewer.md', c1);
  r.commit('docs');
  return { r, c1 };
}

describe('the status of the documentation of a repository', () => {
  it('says there is none, and what the checkout is at, for a repository without .coxia', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('code');
    const sha = r.git('rev-parse', '--short', 'HEAD');
    const s = await status([{ id: 'app', path: r.dir }]);
    expect(s.repos).toHaveLength(1);
    expect(s.repos[0]).toMatchObject({ repo: 'app', exists: false, overview: false, rules: 0, skills: 0, roles: 0, unchecked: [], ignored: [], claude: false, run: null });
    expect(s.repos[0].head?.commit).toBe(sha);
    expect(s.repos[0].head?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('tells a repository that has the CLAUDE.md or the .claude folder of Claude Code, and reads neither', async () => {
    const a = new Repo();
    a.write('CLAUDE.md', 'a rule of a session\n');
    a.commit('notes');
    const b = new Repo();
    b.write('.claude/rules/x.md', 'a rule\n');
    b.commit('notes');
    const s = await status([{ id: 'a', path: a.dir }, { id: 'b', path: b.dir }]);
    expect(s.repos.map((x) => [x.repo, x.claude, x.exists])).toEqual([['a', true, false], ['b', true, false]]);
  });

  it('counts the overview, the rules, the skills and the roles, and lists nothing as not checked when the cited code did not move', async () => {
    const { r } = documented();
    const [d] = (await status([{ id: 'app', path: r.dir }])).repos;
    expect(d).toMatchObject({ exists: true, overview: true, rules: 2, skills: 1, roles: 1, unchecked: [], ignored: [] });
  });

  it('lists a rule whose cited file changed, with the commit and the day of its header and the files that moved', async () => {
    const { r, c1 } = documented();
    r.write('src/a.ts', 'two\n');
    r.commit('change a');
    const [d] = (await status([{ id: 'app', path: r.dir }])).repos;
    expect(d.unchecked).toEqual([{ path: 'rules/a.md', kind: 'rule', state: 'stale', reason: 'changed', changed: ['src/a.ts'], total: 1, commit: c1.slice(0, 7), date: '2026-10-06' }]);
  });

  it('lists a file with no valid header as invalid, counted by what it is, and a commit that is not in the history as unverified', async () => {
    const { r } = documented();
    r.write('.coxia/rules/c.md', 'just text, no header\n');
    r.commit('more');
    // not committed yet, so the history holds no commit that wrote that value into the file
    r.doc('rules/d.md', 'deadbeef', 'evidence: [src/a.ts]');
    const [d] = (await status([{ id: 'app', path: r.dir }])).repos;
    expect(d.rules).toBe(4);
    expect(d.unchecked.map((f) => [f.path, f.state, f.reason])).toEqual([['rules/c.md', 'invalid', 'no-header'], ['rules/d.md', 'unverified', 'outside-history']]);
    expect(d.unchecked[0]).toMatchObject({ commit: null, date: null });
    expect(d.unchecked[1]).toMatchObject({ commit: 'deadbee', date: '2026-10-06' });
  });

  it('lists the files the app does not read, and leaves the run folder and the ignore file out of the count', async () => {
    const { r } = documented();
    r.write('.coxia/notes.txt', 'x\n');
    r.write('.coxia/rules/deep/z.md', 'x\n');
    r.write('.coxia/.run/0_ISSUE.md', 'x\n');
    r.write('.coxia/.gitignore', '.run/\n');
    const [d] = (await status([{ id: 'app', path: r.dir }])).repos;
    expect(d.ignored.sort()).toEqual(['notes.txt', 'rules/deep/z.md']);
    expect(d.rules).toBe(2);
  });

  it('reports the documentation run that is going for the repository, not one that ended or one of another repository', async () => {
    const { r } = documented();
    const repos = [{ id: 'app', path: r.dir }];
    expect((await status(repos, [run({ status: 'gate' })])).repos[0].run).toEqual({ id: 'run-1' });
    expect((await status(repos, [run({ status: 'done' })])).repos[0].run).toBeNull();
    expect((await status(repos, [run({ status: 'cancelled' })])).repos[0].run).toBeNull();
    expect((await status(repos, [run({ status: 'working', issue: { ref: 'docs:other' } } as Partial<Run> & { status: Run['status'] })])).repos[0].run).toBeNull();
    // an issue run of the same name is not a documentation run
    expect((await status(repos, [run({ status: 'working', docs: undefined })])).repos[0].run).toBeNull();
  });

  it('reads every repository, keeps their order, and survives one whose folder is gone', async () => {
    const { r } = documented();
    const plain = new Repo();
    plain.write('x', '1\n');
    plain.commit('x');
    const s = await status([{ id: 'one', path: r.dir }, { id: 'gone', path: join(r.dir, 'nowhere') }, { id: 'two', path: plain.dir }]);
    expect(s.repos.map((x) => [x.repo, x.exists])).toEqual([['one', true], ['gone', false], ['two', false]]);
    expect(s.repos[1].head).toBeNull();
  });

  it('carries whether the workspace has the documentation flow and the budget of a call', async () => {
    const r = new Repo();
    r.write('x', '1\n');
    r.commit('x');
    expect(await status([{ id: 'app', path: r.dir }], [], false)).toMatchObject({ flow: false, budget: BUDGET_MAX });
    expect((await status([], [], true)).flow).toBe(true);
  });
});

describe('the sources the person listed that are Claude Code files', () => {
  it('marks a CLAUDE.md root, a path in a .claude folder and a CLAUDE.md file', () => {
    expect(isClaudeSource('claudeMdRoots', '~/work/app')).toBe(true);
    expect(isClaudeSource('skillsDirs', '~/work/app/.claude/skills')).toBe(true);
    expect(isClaudeSource('rulesDirs', '/home/ana/.claude/rules')).toBe(true);
    expect(isClaudeSource('knowledgeDirs', '~/work/CLAUDE.md')).toBe(true);
    expect(isClaudeSource('agentsDirs', '.claude')).toBe(true);
  });

  it('leaves alone a path that only looks like it, and the MCP files', () => {
    expect(isClaudeSource('skillsDirs', '~/work/claude-tools/skills')).toBe(false);
    expect(isClaudeSource('rulesDirs', '~/work/app/.claudette/rules')).toBe(false);
    expect(isClaudeSource('knowledgeDirs', '~/work/docs')).toBe(false);
    expect(isClaudeSource('mcpConfigFiles', '~/.claude.json')).toBe(false);
    expect(isClaudeSource('mcpConfigFiles', '~/work/app/.claude/.mcp.json')).toBe(false);
  });
});
