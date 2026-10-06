// Keeping the documentation true in the runs that change code. A run in a repository that has a `.coxia/` folder gives its code stage the rules for the files the plan
// names, tells it to keep them true in the same change, and its review is handed the rules the branch left behind. A repository without the folder is asked nothing.
// Real temporary repositories (git runs hermetic, test/setup.ts) and the scripted engine: no model, no host.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { git } from './helpers/conflictRepos';
import { type Boot, type Repo, boot, doc, makeRepo, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { ATAS } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { behindOf, clearHarnessCache } = await import('../src/main/harness/stale');
const { harnessSection } = await import('../src/main/harness/deliver');

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  clearHarnessCache();
});

// ---- behindOf, over repositories made by git ---------------------------------------------------------------------------------------

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

class Scratch {
  readonly dir = mkdtempSync(join(tmpdir(), 'cerimonias-behind-'));
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
    return this.head();
  }
  head = (): string => this.git('rev-parse', 'HEAD');
  doc(rel: string, commit: string, ...extra: string[]): void {
    this.write(`.coxia/${rel}`, ['---', `checked-commit: ${commit}`, 'checked-date: 2026-10-06', ...extra, '---', '', '# Rule', ''].join('\n'));
  }
}

/** Code at C1, a rule that cites it checked against C1, and the base a branch is cut from. */
function world(): { r: Scratch; c1: string; base: string } {
  const r = new Scratch();
  r.write('src/a.ts', 'one\n');
  r.write('src/b.ts', 'one\n');
  const c1 = r.commit('code');
  r.doc('rules/a.md', c1, 'evidence: [src/a.ts:1]');
  r.doc('rules/b.md', c1, 'evidence: [src/b.ts]');
  r.doc('README.md', c1);
  const base = r.commit('docs');
  return { r, c1, base };
}

describe('the rules a branch left behind', () => {
  it('are those that cite code the branch changed and that it did not bring up to date, with the code that moved', async () => {
    const { r, base } = world();
    r.write('src/a.ts', 'two\n');
    r.commit('change a');
    expect(await behindOf(r.dir, base)).toEqual([{ file: '.coxia/rules/a.md', changed: ['src/a.ts'] }]);
  });

  it('count what is not committed yet', async () => {
    const { r, base } = world();
    r.write('src/b.ts', 'two\n');
    expect(await behindOf(r.dir, base)).toEqual([{ file: '.coxia/rules/b.md', changed: ['src/b.ts'] }]);
  });

  it('leave out a rule the branch brought up to date: it was stamped with a commit that holds its change', async () => {
    const { r, base } = world();
    r.write('src/a.ts', 'two\n');
    r.write('.coxia/rules/a.md', '---\nchecked-commit: 0000000\nchecked-date: 2026-10-06\nevidence: [src/a.ts:1]\n---\n\n# Rule\n\nchanged\n');
    const work = r.commit('change a and its rule');
    r.doc('rules/a.md', work, 'evidence: [src/a.ts:1]');
    r.commit('update the documentation check');
    expect(await behindOf(r.dir, base)).toEqual([]);
  });

  it('bring back a rule the branch updated when the code changed again after it', async () => {
    const { r, base } = world();
    r.write('src/a.ts', 'two\n');
    const first = r.commit('change a');
    r.doc('rules/a.md', first, 'evidence: [src/a.ts:1]');
    r.commit('update the documentation check');
    expect(await behindOf(r.dir, base)).toEqual([]);
    r.write('src/a.ts', 'three\n');
    r.commit('change a again');
    expect(await behindOf(r.dir, base)).toEqual([{ file: '.coxia/rules/a.md', changed: ['src/a.ts'] }]);
  });

  it('do not charge the branch for a rule that was already out of date and cites nothing it touched', async () => {
    const r = new Scratch();
    r.write('src/a.ts', 'one\n');
    r.write('src/b.ts', 'one\n');
    const c1 = r.commit('code');
    r.doc('rules/a.md', c1, 'evidence: [src/a.ts:1]');
    r.commit('docs');
    r.write('src/a.ts', 'two\n');
    const base = r.commit('main moved on');
    r.write('src/b.ts', 'two\n');
    r.commit('the branch changes something else');
    expect(await behindOf(r.dir, base)).toEqual([]);
  });

  it('leave out the cycle folder of the run, which is not code the rules cite', async () => {
    const r = new Scratch();
    r.write('docs/x.md', 'one\n');
    const c1 = r.commit('code');
    r.doc('rules/d.md', c1, 'evidence: [docs/]');
    const base = r.commit('docs');
    r.write('docs/cycles/101-x/1_SPEC.md', 'spec\n');
    r.commit('the run writes its folder');
    expect(await behindOf(r.dir, base, 'docs/cycles/101-x')).toEqual([]);
    expect((await behindOf(r.dir, base)).map((b) => b.file)).toEqual(['.coxia/rules/d.md']);
  });

  it('are none without a base, without the folder, or when the branch changed only the documentation', async () => {
    const { r, base } = world();
    expect(await behindOf(r.dir, null)).toEqual([]);
    expect(await behindOf(mkdtempSync(join(tmpdir(), 'cerimonias-nodocs-')), base)).toEqual([]);
    r.write('.coxia/README.md', '---\nchecked-commit: abcdef1\nchecked-date: 2026-10-06\n---\n# New\n');
    r.commit('only the documentation');
    expect(await behindOf(r.dir, base)).toEqual([]);
  });

  it('never name a file with no evidence or a header that is not valid', async () => {
    const { r, base } = world();
    r.write('.coxia/skills/s.md', '# no header\n');
    r.write('src/a.ts', 'two\n');
    r.commit('change a');
    expect((await behindOf(r.dir, base)).map((b) => b.file)).toEqual(['.coxia/rules/a.md']);
  });
});

// ---- a run in a documented repository ----------------------------------------------------------------------------------------------

const header = (commit: string, extra = '') => `---\nchecked-commit: ${commit}\nchecked-date: 2026-10-01\n${extra}---\n`;

/** A repository with a `.coxia/`: a rule for `src/app.ts`, one for `src/other.ts`, and one that was already out of date before any branch (`lib/old.ts` changed after it). */
function documentedRepo(): Repo {
  const repo = makeRepo();
  const seed = join(repo.root, 'seed');
  mkdirSync(join(seed, 'lib'), { recursive: true });
  writeFileSync(join(seed, 'src/other.ts'), 'export const other = 1;\n');
  writeFileSync(join(seed, 'lib/old.ts'), 'export const old = 1;\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'more code');
  const checked = git(seed, 'rev-parse', 'HEAD');
  mkdirSync(join(seed, '.coxia/rules'), { recursive: true });
  writeFileSync(join(seed, '.coxia/README.md'), `${header(checked, 'summary: The project\n')}# App\n\nA tiny app.\n`);
  writeFileSync(join(seed, '.coxia/rules/app.md'), `${header(checked, 'evidence: [src/app.ts:1]\nsummary: The app constant\n')}# The app constant\n\nThe constant is 1.\n`);
  writeFileSync(join(seed, '.coxia/rules/other.md'), `${header(checked, 'evidence: [src/other.ts]\nsummary: The other constant\n')}# The other constant\n\nIt is 1.\n`);
  writeFileSync(join(seed, '.coxia/rules/old.md'), `${header(checked, 'evidence: [lib/old.ts]\nsummary: The old constant\n')}# The old constant\n\nIt is 1.\n`);
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'add the documentation');
  writeFileSync(join(seed, 'lib/old.ts'), 'export const old = 2;\n');
  git(seed, 'commit', '-qam', 'change the old constant');
  git(seed, 'push', '-q', 'origin', 'main');
  return repo;
}

const SPEC = '# Spec\n\nThe constant in src/app.ts must be 2.\n';
const PLAN = '# Plan\n\nEdit src/app.ts and run the tests.\n';
const RULE_FIXED = (n: number) => `---\nchecked-commit: 0000000\nchecked-date: 2000-01-01\nevidence: [src/app.ts:1]\nsummary: The app constant\n---\n# The app constant\n\nThe constant is ${n}.\n`;
const finding = { path: 'src/app.ts', line: 1, endLine: null, side: 'new', severity: 'blocking', body: 'The constant must be 3.', suggestion: null };

interface Seen {
  developer: { system: string; section: string; docs: { paths: string[]; stage: { id: string; kind: string } | null; repos: string[] } | undefined }[];
  reviewer: { system: string; prompt: string }[];
  qa: string[];
}

/** Every agent answers at once; the developer's passes are the ones a test is about. */
function script(b: Boot, develop: ((n: number, tools: { write(path: string, content: string): Promise<string | null> }) => Promise<void>) | null, verdicts: ('approved' | 'changes')[] = ['approved']): Seen {
  const seen: Seen = { developer: [], reviewer: [], qa: [] };
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md', SPEC)] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md', PLAN)] }));
  let pass = 0;
  b.engine.script('developer', async (c, tools) => {
    pass += 1;
    // read as the call is made, before the pass touches anything: what the agent starts from
    const section = c.docs ? await harnessSection(c.docs, c.agent, { cwd: c.cwd }) : '';
    seen.developer.push({ system: c.system, section, docs: c.docs });
    if (develop) await develop(pass, tools);
    else await tools.write('src/app.ts', `export const app = ${pass + 1};\n`);
    return work('Built.', { commit: 'change the constant', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  let round = 0;
  b.engine.script('reviewer', (c) => {
    seen.reviewer.push({ system: c.system, prompt: c.prompt });
    const verdict = verdicts[Math.min(round++, verdicts.length - 1)];
    return work('Reviewed.', { artifacts: [doc('4_REVIEW.md')], verdict, findings: verdict === 'changes' ? [finding] : [] });
  });
  b.engine.script('qa', (c) => {
    seen.qa.push(c.prompt);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] });
  });
  return seen;
}

/** Approves the gates until the run is at its end or at something else. */
async function through(b: Boot, run: Run): Promise<Run> {
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const now = b.runner.get(run.id) as Run;
    if (now.status !== 'gate') return now;
    b.runner.gate(run.id, 'approve', i === 0 ? 'Looks right.' : '');
  }
  return b.runner.get(run.id) as Run;
}

async function runIn(repo: Repo, develop: Parameters<typeof script>[1], verdicts?: ('approved' | 'changes')[]): Promise<{ b: Boot; run: Run; seen: Seen }> {
  const b = await boot({ dir: ATAS, repo, configure: (c) => (c.language = 'en') });
  const seen = script(b, develop, verdicts);
  const started = await b.runner.start('app#101');
  const run = await through(b, started);
  return { b, run, seen };
}

describe('the stage that changes code', () => {
  it('is given the rule for the files the plan names before it touched anything, is told to keep the documentation true, and is not given the rules that do not concern it', async () => {
    const { run, seen } = await runIn(documentedRepo(), null);
    expect(run.status).toBe('done');
    const first = seen.developer[0];
    // the paths the work touches are the ones the spec and the plan name: the rule that cites one is handed over whole, the others are only in the index
    expect(first.docs?.paths).toEqual(expect.arrayContaining(['src/app.ts']));
    expect(first.docs).toMatchObject({ stage: { id: 'implement', kind: 'development' } });
    expect(first.section).toContain('Documentation file .coxia/rules/app.md:');
    expect(first.section).toContain('The constant is 1.');
    expect(first.section).toContain('Overview of the project (.coxia/README.md)');
    expect(first.section).not.toContain('Documentation file .coxia/rules/other.md');
    expect(first.section).toMatch(/Other files of the documentation[\s\S]*\.coxia\/rules\/other\.md: The other constant/);
    // and the instruction: correct the rule in the same change, never the stamp
    expect(first.system).toContain('This repository keeps its documentation in the .coxia folder');
    expect(first.system).toContain('Do not write checked-commit or checked-date');
  });

  it('is not given that instruction in a repository without .coxia, which is asked nothing at all', async () => {
    const { run, seen } = await runIn(makeRepo(), null);
    expect(run.status).toBe('done');
    // The base sentence now names the folder; what a repository without it must not get is the instruction to keep it true.
    expect(seen.developer[0].system).not.toContain('keeps its documentation');
    expect(seen.developer[0].section).toBe('');
    expect(seen.reviewer[0].system).not.toContain('keeps its documentation');
    expect(seen.reviewer[0].prompt).not.toContain('project documentation');
    expect(seen.reviewer[0].prompt).not.toContain('left behind');
  });

  it('a mention in the thread of the run is given the same selection as the stage', async () => {
    const b = await boot({ dir: ATAS, repo: documentedRepo(), configure: (c) => (c.language = 'en') });
    script(b, null);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    b.engine.script('developer', () => ({ text: 'It is in src/app.ts.' }));
    const [m] = b.forum.append(`run-${run.id}`, { kind: 'post', author: { type: 'person' }, text: '@developer where is the constant?', mentions: ['developer'] });
    b.runner.onMessage(m);
    await b.settle();
    const call = b.engine.calls.filter((c) => c.agent.id === 'developer' && !c.confine && c.prompt.includes('called on you')).at(-1)!;
    expect(call.docs).toMatchObject({ repos: [run.worktree], stage: { id: 'gate1', kind: 'backlog' } });
    expect(call.docs?.paths).toEqual(expect.arrayContaining(['src/app.ts']));
    const section = await harnessSection(call.docs as NonNullable<typeof call.docs>, call.agent, { cwd: run.worktree });
    expect(section).toContain('Documentation file .coxia/rules/app.md:');
    expect(section).not.toContain('Documentation file .coxia/rules/other.md');
    // a mention only answers: it is not asked to keep the documentation true
    expect(call.system).not.toContain('keeps its documentation');
  });
});

describe('the review', () => {
  it('is handed the rule the branch left behind, and not the ones that are fine or were out of date before the branch, and may raise it as a finding', async () => {
    const { run, seen } = await runIn(documentedRepo(), null);
    expect(run.status).toBe('done');
    const prompt = seen.reviewer[0].prompt;
    expect(prompt).toContain('These rules of the project documentation (.coxia) cite code that this branch changed after they were last checked');
    expect(prompt).toContain('- .coxia/rules/app.md: src/app.ts');
    expect(prompt).not.toContain('.coxia/rules/other.md');
    expect(prompt).not.toContain('.coxia/rules/old.md');
    // the output instruction: one finding each, not blocking by default, the reviewer may raise it
    expect(prompt).toContain('For each rule listed under the project documentation that the branch left behind, add one finding');
    expect(prompt).toContain('severity suggestion (not blocking)');
    // the review reads: it is not told to edit documentation, and the stages around it are not given the list
    expect(seen.reviewer[0].system).not.toContain('keeps its documentation');
    expect(seen.qa[0]).not.toContain('left behind');
    expect(seen.developer.every((d) => !d.system.includes('left behind'))).toBe(true);
  });

  it('is not handed a rule the branch brought up to date in the same change', async () => {
    const { run, seen, b } = await runIn(documentedRepo(), async (_n, tools) => {
      await tools.write('src/app.ts', 'export const app = 2;\n');
      await tools.write('.coxia/rules/app.md', RULE_FIXED(2));
    });
    expect(run.status).toBe('done');
    expect(seen.reviewer[0].prompt).not.toContain('left behind');
    expect(seen.reviewer[0].prompt).not.toContain('cite code that this branch changed');
    // the app stamped the rule with the commit that holds the change, in a commit of its own, and the agent's placeholder is gone
    const log = git(run.worktree, 'log', '--format=%s', `${run.base}..HEAD`);
    expect(log).toContain('update the documentation check');
    const rule = git(run.worktree, 'show', 'HEAD:.coxia/rules/app.md');
    expect(rule).not.toContain('checked-commit: 0000000');
    expect(b.thread(run).some((m) => m.code === 'runner.docs.invalidHeader')).toBe(false);
  });

  it('is handed the rule again when the code changed after the branch updated it', async () => {
    const { run, seen } = await runIn(
      documentedRepo(),
      async (n, tools) => {
        await tools.write('src/app.ts', `export const app = ${n + 1};\n`);
        // the first pass updates the rule; the second changes the code again and leaves the rule as it was
        if (n === 1) await tools.write('.coxia/rules/app.md', RULE_FIXED(2));
      },
      ['changes', 'approved'],
    );
    expect(run.status).toBe('done');
    expect(seen.developer).toHaveLength(2);
    expect(seen.reviewer).toHaveLength(2);
    expect(seen.reviewer[0].prompt).not.toContain('left behind');
    expect(seen.reviewer[1].prompt).toContain('- .coxia/rules/app.md: src/app.ts');
  });
});
