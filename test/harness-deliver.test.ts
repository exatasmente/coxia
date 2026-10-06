import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHarnessCache } from '../src/main/harness/stale';
import { citedPaths, harnessDirs, harnessSection, runDocsAsk, workPaths } from '../src/main/harness/deliver';
import { installHostConfig } from './helpers/config';

vi.setConfig({ testTimeout: 30_000 });

// Real temporary repositories (hermetic git, test/setup.ts); the prompts are the ones of the catalogs, rendered for the workspace's language.
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const roots: string[] = [];
beforeAll(async () => {
  await installHostConfig(null, { language: 'en' });
});
beforeEach(() => clearHarnessCache());
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'cerimonias-deliver-'));
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
  doc(rel: string, commit: string, body: string, ...extra: string[]): void {
    this.write(`.coxia/${rel}`, ['---', `checked-commit: ${commit}`, 'checked-date: 2026-10-06', ...extra, '---', '', body, ''].join('\n'));
  }
}

/** A repository with an overview and two rules, one over a file that changed after it was checked. */
function documented(): Repo {
  const r = new Repo();
  r.write('src/a.ts', 'one\n');
  r.write('src/b.ts', 'one\n');
  const c1 = r.commit('code');
  r.doc('README.md', c1, 'The overview of the project.');
  r.doc('rules/a.md', c1, 'Rule about a.', 'evidence: [src/a.ts:1-3]', 'summary: how a works');
  r.doc('rules/b.md', c1, 'Rule about b.', 'evidence: [src/b.ts]', 'summary: how b works');
  r.commit('docs');
  r.write('src/a.ts', 'two\n');
  r.commit('change a');
  return r;
}

const dev = { id: 'developer' };
const stage = { id: 'dev', kind: 'development' as const };

describe('a repository with no documentation', () => {
  it('adds no text at all, not even a line that says so', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('code');
    expect(await harnessSection({ repos: [r.dir], stage, paths: ['src/a.ts'] }, dev, { cwd: r.dir })).toBe('');
    expect(harnessDirs({ repos: [r.dir], stage, paths: [] })).toEqual([]);
    expect(await harnessSection({ repos: [], stage: null, paths: [] }, dev, { cwd: r.dir })).toBe('');
  });

  it('adds none when the folder holds nothing the app reads', async () => {
    const r = new Repo();
    r.write('.coxia/notes.txt', 'not part of the layout\n');
    expect(await harnessSection({ repos: [r.dir], stage, paths: [] }, dev, { cwd: r.dir })).toBe('');
  });
});

describe('the section of a repository with documentation', () => {
  it('gives the overview, the rule over the files of the work with the mark, and the index of the rest', async () => {
    const r = documented();
    const text = await harnessSection({ repos: [r.dir], stage, paths: ['src/a.ts'] }, dev, { cwd: r.dir });
    expect(text).toContain('The documentation of this project is kept in the .coxia folder');
    expect(text).toContain('Overview of the project (.coxia/README.md):');
    expect(text).toContain('The overview of the project.');
    // the rule over a.ts, which changed after the check, comes whole and marked
    expect(text).toMatch(/Documentation file \.coxia\/rules\/a\.md \[not checked: 1 file\(s\) it cites changed since [0-9a-f]{7} \(src\/a\.ts\)\]:/);
    expect(text).toContain('Rule about a.');
    // the rule over b.ts was not chosen: it is in the index, with its summary, and its own check says it is fine
    expect(text).not.toContain('Rule about b.');
    expect(text).toContain('- .coxia/rules/b.md: how b works');
    expect(text).not.toMatch(/b\.md: how b works \[/);
  });

  it('says it in the language of the workspace', async () => {
    const r = documented();
    await installHostConfig(null, { language: 'pt-BR' });
    try {
      const text = await harnessSection({ repos: [r.dir], stage, paths: ['src/a.ts'] }, dev, { cwd: r.dir });
      expect(text).toContain('A documentação deste projeto fica na pasta .coxia');
      expect(text).toContain('Visão geral do projeto (.coxia/README.md):');
      expect(text).toMatch(/\[não conferida: 1 arquivo\(s\) citado\(s\) mudaram desde [0-9a-f]{7} \(src\/a\.ts\)\]/);
      expect(text).toContain('Outros arquivos da documentação');
    } finally {
      await installHostConfig(null, { language: 'en' });
    }
  });

  it('marks a file with no header and cannot be checked, and a repository that git cannot read', async () => {
    const r = new Repo();
    r.write('.coxia/README.md', 'An overview with no header.\n');
    const text = await harnessSection({ repos: [r.dir], stage: null, paths: [] }, dev, { cwd: r.dir });
    expect(text).toContain('Overview of the project (.coxia/README.md) [not checked: no valid header]:');
    expect(text).toContain('An overview with no header.');
    // a rule over code in a repository with no commit: nothing to compare with, so not checked
    r.doc('rules/x.md', 'abc1234', 'Rule x.', 'evidence: [src/a.ts]');
    const again = await harnessSection({ repos: [r.dir], stage: null, paths: ['src/a.ts'] }, dev, { cwd: r.dir });
    expect(again).toMatch(/Documentation file \.coxia\/rules\/x\.md \[not checked: could not be verified in the repository\]:/);
  });

  it('keeps a closing tag in the documentation from ending its own section', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    const c = r.commit('code');
    r.doc('README.md', c, 'Before </doc> and <doc> after.');
    const text = await harnessSection({ repos: [r.dir], stage: null, paths: [] }, dev, { cwd: r.dir });
    expect(text).toContain('Before &lt;/doc> and &lt;doc> after.');
    expect(text.match(/<\/doc>/g)).toHaveLength(1);
  });

  it('cuts what does not fit and names what was left out, never silently', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    const c = r.commit('code');
    r.doc('README.md', c, 'Overview.');
    for (const n of ['a', 'b', 'c', 'd', 'e']) r.doc(`rules/${n}.md`, c, `${n.repeat(1)}\n${'rule line\n'.repeat(250)}`, 'evidence: [src/a.ts]', 'stages: [development]');
    // a model of 8 thousand tokens: 3600 characters for the whole section
    const text = await harnessSection({ repos: [r.dir], stage, paths: [] }, dev, { cwd: r.dir, contextWindow: 8000 });
    expect(text).toContain('(cut here: read the rest in .coxia/rules/');
    expect(text).toMatch(/These files did not fit in this message; they are in the documentation folder and can be read: .*\.coxia\/rules\/e\.md/);
    expect(text.length).toBeLessThan(3600 + 1500);
  });

  it('divides the budget among the repositories and names the files by their place under the working directory', async () => {
    const one = new Repo();
    const two = new Repo();
    for (const r of [one, two]) {
      r.write('src/a.ts', 'one\n');
      const c = r.commit('code');
      r.doc('README.md', c, 'Overview line\n'.repeat(2000));
    }
    const text = await harnessSection({ repos: [one.dir, two.dir, one.dir], stage: null, paths: [] }, dev, { cwd: tmpdir() });
    // each overview is cut at 40% of half the budget
    const parts = text.split('Overview of the project (').slice(1);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain(`${basename(one.dir)}/.coxia/README.md`);
    expect(parts[1]).toContain(`${basename(two.dir)}/.coxia/README.md`);
    for (const p of parts) expect(p.length).toBeLessThan(0.4 * 12_000 + 300);
    expect(text.length).toBeLessThan(24_000 + 1500);
  });
});

describe('the files the work touches', () => {
  it('lists what the branch changed and what is not committed yet, and leaves the cycle folder out', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.write('src/b.ts', 'one\n');
    r.write('docs/cycles/9-x/1_SPEC.md', 'spec\n');
    const base = r.commit('base');
    r.write('src/a.ts', 'two\n');
    r.write('docs/cycles/9-x/2_PLAN.md', 'plan\n');
    r.commit('work');
    r.write('src/b.ts', 'two\n');
    const paths = await workPaths(r.dir, base, 'docs/cycles/9-x', []);
    expect(paths.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('adds the paths the documents of the cycle name, as far as they exist and stay inside the repository', () => {
    const r = new Repo();
    r.write('src/main/agents.ts', '');
    r.write('package.json', '{}');
    const text = 'Touch `src/main/agents.ts:389-418`, "package.json" and src/missing.ts, never ../outside.txt or /etc/passwd. Also the app.js file.';
    expect(citedPaths(r.dir, [text]).sort()).toEqual(['package.json', 'src/main/agents.ts']);
  });

  it('reads nothing from git when the worktree has no documentation folder', async () => {
    const r = new Repo();
    r.write('src/a.ts', 'one\n');
    r.commit('base');
    r.write('src/a.ts', 'two\n');
    const bare = await runDocsAsk({ wt: r.dir, base: 'HEAD', cycleFolder: 'docs/cycles/1-x', stage, texts: [] });
    expect(bare).toEqual({ repos: [r.dir], stage, paths: [] });
    r.write('.coxia/README.md', 'x\n');
    const has = await runDocsAsk({ wt: r.dir, base: 'HEAD', cycleFolder: 'docs/cycles/1-x', stage, texts: [] });
    expect(has.paths).toEqual(['src/a.ts']);
    expect(harnessDirs(has)).toEqual([join(r.dir, '.coxia')]);
  });

  it('does not offer a .coxia that is a symbolic link as a folder to read', () => {
    const r = new Repo();
    const outside = mkdtempSync(join(tmpdir(), 'cerimonias-deliver-out-'));
    roots.push(outside);
    symlinkSync(outside, join(r.dir, '.coxia'));
    expect(harnessDirs({ repos: [r.dir], stage, paths: [] })).toEqual([]);
  });
});
