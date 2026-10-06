// The run that drafts the documentation of a repository. It goes through the docs flow against a real temporary repository and a fake host with a memory: the real
// provider, the real list of writes, the real door (proposals in Actions, the refusal of a test workspace), the real guard of the agent's files, and a scripted engine for
// the model. What the host received is checked, and so is what it never did: a documentation run has no issue, so nothing may be planned for issue number 0.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTemplate, docsFlow } from '../src/shared/cycles';
import { flowOfRun } from '../src/shared/runs/flow';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { git } from './helpers/conflictRepos';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Fake, fakeOpenAI, toolStep } from './helpers/fakeOpenAI';
import { type Boot, type FakeSandbox, type Repo, boot, doc, fakeSandbox, makeRepo, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests, vcsProvider } = await import('../src/main/vcs');
const { onRunnerActionDone } = await import('../src/main/runner/door');
const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { applyDocsFlow, startDocsRun } = await import('../src/main/harness/docsRun');
const { ensureRunIgnore, importCandidates } = await import('../src/main/runner/docs');
const { harnessSection } = await import('../src/main/harness/deliver');
const { obj, runAgent, str } = await import('../src/main/agents');
const { confinedHooks } = await import('../src/main/runner/hooks');
const { policyFromHooks } = await import('../src/main/engine/open/policy');
const { editTool, writeTool } = await import('../src/main/engine/open/tools/write');
const { newAgent } = await import('../src/shared/config/team');
const { HARNESS_OWN } = await import('../src/shared/harness/format');
const { newProvider } = await import('../src/shared/config/defaults');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

const clock = new Date('2026-10-06T12:00:00Z');
const BRANCH = 'cycle/docs-app-20261006';

let forge: Forge;
let stop: (() => void) | null = null;

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
  forge = makeForge({ pr: null, linked: false });
  setVcsRuntimeForTests(forge.runtime());
});

// ---- the repository and what the agent writes -----------------------------------------------------------------------------------

const header = (extra = '') => `---\nchecked-commit: 0000000\nchecked-date: 2000-01-01\n${extra}---\n`;
const README = `${header('summary: What the project is\n')}# App\n\nA tiny app.\n`;
const RULE = `${header('evidence: [src/app.ts:1]\nsummary: The app constant\n')}# The constant\n\nThe app constant is 1.\n`;
const NOTES = '# Import notes\n\n## Imported\n- how to build and test\n\n## Left out\n- "a subagent never pushes" (CLAUDE.md): a rule of a session of another tool, not a fact of the project\n';

const section = (heading: string, body: string) => ({ heading, body });
const PR = {
  title: 'Document the project',
  sections: [section('What this adds', 'The overview and one rule.'), section('What was imported from Claude Code', 'How to build and test.'), section('What the import left out', 'A rule of a session: who pushes.'), section('What to check', 'The evidence of the rule.')],
  technical: '',
};

/** A repository whose main branch carries the files of Claude Code a draft may import from. */
function repoWithClaude(): Repo {
  const repo = makeRepo();
  const seed = join(repo.root, 'seed');
  writeFileSync(join(seed, 'CLAUDE.md'), '# Notes for a session\n\nA subagent never pushes.\n');
  mkdirSync(join(seed, '.claude/rules'), { recursive: true });
  writeFileSync(join(seed, '.claude/rules/x.md'), 'x\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'claude files');
  git(seed, 'push', '-q', 'origin', 'main');
  return repo;
}

/** A repository whose main branch carries `.coxia` as a symbolic link to a folder outside it (what a hostile commit would do). */
function repoWithLinkedHarness(outside: string): Repo {
  const repo = makeRepo();
  const seed = join(repo.root, 'seed');
  symlinkSync(outside, join(seed, '.coxia'));
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'link the documentation folder');
  git(seed, 'push', '-q', 'origin', 'main');
  return repo;
}

type Config = Parameters<NonNullable<NonNullable<Parameters<typeof boot>[0]>['configure']>>[0];
const withDocs = (c: Config) => {
  c.language = 'en';
  const applied = applyTemplate(c, docsFlow);
  c.devCycle = applied.devCycle;
  c.agents = applied.agents;
};

async function bootDocs(o: { repo?: Repo; flow?: boolean; shell?: 'sandbox' | 'host'; sandbox?: FakeSandbox; edit?: (c: Config) => void } = {}): Promise<Boot> {
  const configure = (c: Config) => {
    withDocs(c);
    o.edit?.(c);
    // The agent of the docs flow is an ordinary one of the team: the person may set its shell.
    if (o.shell) (c.agents.team.find((a) => a.id === 'docs-writer') as { shell: string }).shell = o.shell;
  };
  const b = await boot({ dir: ATAS, publish: true, repo: o.repo ?? repoWithClaude(), now: () => clock, sandbox: o.sandbox, configure: o.flow === false ? (c) => (c.language = 'en') : configure });
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  return b;
}

/** The writer drafts the overview and a rule, tries a file of the code, and hands over its notes; then it applies what the gate asked and describes the pull request. */
function script(b: Boot, seen: { denied: string | null } = { denied: null }): void {
  b.engine.script(
    'docs-writer',
    async (_c, tools) => {
      seen.denied = await tools.write('src/app.ts', 'export const app = 2;\n');
      expect(await tools.write('.coxia/README.md', README)).toBeNull();
      expect(await tools.write('.coxia/rules/x.md', RULE)).toBeNull();
      return work('Drafted.', { commit: 'add the project documentation', artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
    },
    async () => work('Applied.', { pr: PR }),
  );
}

/**
 * Watches what a run asks of the host about an issue. A documentation run has none (its number is 0), so nothing may be read for it, found under it or planned for it:
 * the provider would refuse the call, and the publisher would only say so in the thread, which is why the calls themselves are what is counted.
 */
function watchIssueZero() {
  const provider = vcsProvider();
  const spies = { planWrite: vi.spyOn(provider, 'planWrite'), listIssueComments: vi.spyOn(provider, 'listIssueComments'), getIssue: vi.spyOn(provider, 'getIssue'), linkedMrs: vi.spyOn(provider, 'linkedMrs') };
  return {
    ops: () => (spies.planWrite.mock.calls as unknown as [{ op: string }][]).map(([op]) => op.op),
    /** The calls that named the issue number 0, as `method(args)`. */
    zero: () =>
      Object.entries(spies).flatMap(([name, spy]) =>
        (spy.mock.calls as unknown as unknown[][])
          .filter((args) => args.some((a) => a === 0 || (typeof a === 'object' && a !== null && (a as { iid?: unknown }).iid === 0)))
          .map((args) => `${name}(${JSON.stringify(args)})`),
      ),
    done: () => Object.values(spies).forEach((spy) => spy.mockRestore()),
  };
}

const pending = () => actions.listActions().filter((a) => a.state === 'pending');
const writesOf = () => forge.writes.map((w) => `${w.method} ${w.endpoint.replace('repos/group/project/', '')}`);

/** Starts the run and lets it work until the gate over the draft. */
async function toGate(b: Boot): Promise<Run> {
  const run = await b.runner.startDocs('app', 'create');
  await b.settle();
  return b.runner.get(run.id) as Run;
}

/** Approves the gate and lets the second stage end: the run waits for the pull request to be merged. */
async function toWait(b: Boot, run: Run): Promise<Run> {
  b.runner.gate(run.id, 'approve', 'Looks right.');
  await b.settle();
  return b.runner.get(run.id) as Run;
}

// ---- starting -------------------------------------------------------------------------------------------------------------------

describe('starting a documentation run', () => {
  it('makes a run with no issue: its own reference and title, a branch with the day, its folder inside .coxia and ignored, and nothing read from the tracker', async () => {
    const b = await bootDocs();
    script(b);
    const run = await b.runner.startDocs('app', 'create');
    expect(run).toMatchObject({ docs: { mode: 'create' }, issue: { ref: 'docs:app', iid: 0, title: 'Documentation of app', url: null }, repo: 'app', branch: BRANCH, cycleFolder: '.coxia/.run', cycleId: 'docs-flow', stage: 'docs-draft' });
    expect(run.subject).toBeUndefined();
    expect(run.worktree).toBe(join(b.repo.worktrees, 'app', 'docs-20261006'));
    expect(b.issues.reads).toEqual([]);
    await b.settle();

    // the folder of the run is ignored by git: the first commit holds the ignore file and nothing else, and the record is on disk
    expect(readFileSync(join(run.worktree, '.coxia/.gitignore'), 'utf8')).toBe('.run/\n');
    expect(git(run.worktree, 'ls-files', '.coxia').split('\n')).toEqual(expect.arrayContaining(['.coxia/.gitignore']));
    expect(git(run.worktree, 'ls-files', '.coxia/.run')).toBe('');
    expect(git(run.worktree, 'status', '--porcelain')).toBe('');
    const first = git(run.worktree, 'log', '--reverse', '--format=%s', `${run.base}..HEAD`).split('\n')[0];
    expect(first).toBe('feat: ignore the folder of the documentation run');
    expect(git(run.worktree, 'diff', '--name-only', `${run.base}~0`, `${run.base}`)).toBe('');

    // the record the first stage reads: the task, what .coxia has, and the files of Claude Code to import from (not the code)
    const record = readFileSync(join(run.worktree, '.coxia/.run/0_ISSUE.md'), 'utf8');
    expect(record).toContain('# docs:app Documentation of app');
    expect(record).toContain('create the documentation of this repository');
    expect(record).toContain('The folder does not exist yet.');
    expect(record).toContain('- CLAUDE.md');
    expect(record).toContain('- .claude/rules/x.md');
    expect(record).not.toContain('src/app.ts');
  });

  it('refuses a second run for the same repository while one is going, a mode it does not know, a repository the workspace does not have and a workspace with no docs flow', async () => {
    const b = await bootDocs();
    script(b);
    const run = await b.runner.startDocs('app', 'create');
    await expect(b.runner.startDocs('app', 'update')).rejects.toThrow(/already/i);
    await expect(b.runner.startDocs('app', 'delete' as never)).rejects.toThrow(/is not a mode/);
    await expect(b.runner.startDocs('nowhere', 'create')).rejects.toThrow(/no local checkout/);
    await b.settle();
    // a run that was cancelled leaves the day's folder behind: the same day does not meet it again silently
    b.runner.cancel(run.id);
    await expect(b.runner.startDocs('app', 'create')).rejects.toThrow(/exists/i);

    const bare = await bootDocs({ flow: false });
    await expect(bare.runner.startDocs('app', 'create')).rejects.toThrow(/no documentation flow/);
    expect(existsSync(join(bare.repo.worktrees, 'app'))).toBe(false);
  });

  it('applies the docs flow on the first use only when the person said yes, and starts the run with it', async () => {
    const b = await bootDocs({ flow: false });
    script(b);
    const deps = { runner: b.runner, config: getConfig, applyFlow: applyDocsFlow };
    expect(getConfig().devCycle.flows?.docs).toBeUndefined();
    // without the yes nothing is changed and nothing is created
    await expect(startDocsRun(deps, 'app', 'create', false)).rejects.toThrow(/no documentation flow/);
    expect(getConfig().devCycle.flows?.docs).toBeUndefined();
    expect(getConfig().agents.team.some((a) => a.id === 'docs-writer')).toBe(false);
    expect(existsSync(join(b.repo.worktrees, 'app'))).toBe(false);
    // with it the template is applied next to the flow of the issues, and the run starts
    const before = structuredClone(getConfig().devCycle.stages);
    const run = await startDocsRun(deps, 'app', 'create', true);
    expect(run.docs).toEqual({ mode: 'create' });
    expect(getConfig().devCycle.flows?.docs?.map((s) => s.id)).toEqual(['docs-draft', 'docs-gate', 'docs-publish', 'docs-ready', 'docs-done']);
    expect(getConfig().devCycle.stages).toEqual(before);
    expect(getConfig().agents.team.find((a) => a.id === 'docs-writer')).toMatchObject({ permission: 'worktree', shell: 'none', tracker: 'none' });
    await b.settle();
    // once it is there the flag is not needed
    b.runner.cancel(run.id);
    expect(await startDocsRun(deps, 'app', 'update', false).catch((e: Error) => e.message)).toMatch(/exists/i);
  });

  it('refuses a repository whose .coxia is a link out of it: no worktree, no run, and nothing written where the link leads', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'docs-link-out-'));
    const b = await bootDocs({ repo: repoWithLinkedHarness(outside) });
    script(b);
    await expect(b.runner.startDocs('app', 'create')).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(b.repo.worktrees, 'app', 'docs-20261006'))).toBe(false);
    expect(b.engine.calls).toEqual([]);
  });

  it('refuses a repository whose .coxia/.run is a link too: the record of the run is not written through it', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'docs-run-out-'));
    const repo = makeRepo();
    const seed = join(repo.root, 'seed');
    mkdirSync(join(seed, '.coxia'));
    symlinkSync(outside, join(seed, '.coxia/.run'));
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'link the folder of the run');
    git(seed, 'push', '-q', 'origin', 'main');
    const b = await bootDocs({ repo });
    script(b);
    await expect(b.runner.startDocs('app', 'create')).rejects.toThrow(/symbolic link/);
    expect(readdirSync(outside)).toEqual([]);
    expect(existsSync(join(b.repo.worktrees, 'app', 'docs-20261006'))).toBe(false);
  });

  describe('the first click, which applies the docs template, changes nothing when the start itself cannot happen', () => {
    const untouched = () => {
      expect(getConfig().devCycle.flows?.docs).toBeUndefined();
      expect(getConfig().agents.team.some((a) => a.id === 'docs-writer')).toBe(false);
    };
    const depsOf = (b: Boot) => ({ runner: b.runner, config: getConfig, applyFlow: applyDocsFlow });

    it('a mode it does not know, a repository the workspace does not have', async () => {
      const b = await bootDocs({ flow: false });
      script(b);
      await expect(startDocsRun(depsOf(b), 'app', 'delete', true)).rejects.toThrow(/is not a mode/);
      untouched();
      await expect(startDocsRun(depsOf(b), 'nowhere', 'create', true)).rejects.toThrow(/no local checkout/);
      untouched();
    });

    it('a repository with no identity to commit with', async () => {
      const b = await bootDocs({ flow: false });
      script(b);
      updateConfig((c) => ({ ...c, runner: { ...c.runner, identity: { name: '', email: '' } } }));
      await expect(startDocsRun(depsOf(b), 'app', 'create', true)).rejects.toMatchObject({ code: 'no-identity' });
      untouched();
    });

    it('a run already going for the repository', async () => {
      const b = await bootDocs();
      script(b);
      await b.runner.startDocs('app', 'create');
      // the flow is taken away (an import of the configuration would do it), so the click would apply the template again
      updateConfig((c) => {
        delete c.devCycle.flows?.docs;
        c.agents.team = c.agents.team.filter((a) => a.id !== 'docs-writer');
        return c;
      });
      untouched();
      await expect(startDocsRun(depsOf(b), 'app', 'update', true)).rejects.toThrow(/already/i);
      untouched();
    });

    it('says, when the start fails after the template was applied, that the agent and the flow were added and stay', async () => {
      const b = await bootDocs({ flow: false });
      script(b);
      // the day's folder is already there: the one thing the check before the template does not see
      mkdirSync(join(b.repo.worktrees, 'app', 'docs-20261006'), { recursive: true });
      const failed = await startDocsRun(depsOf(b), 'app', 'create', true).catch((e: Error) => e);
      expect(failed).toBeInstanceOf(Error);
      expect((failed as Error).message).toMatch(/exists/i);
      expect((failed as Error).message).toContain('The "Documentation writer" agent and the documentation flow were added to the configuration and stay there');
      expect(getConfig().devCycle.flows?.docs).toBeDefined();
      expect(getConfig().agents.team.some((a) => a.id === 'docs-writer')).toBe(true);
      // a failure when nothing was added (the flow was there) gets no such sentence
      const again = await startDocsRun(depsOf(b), 'app', 'create', false).catch((e: Error) => e.message);
      expect(again).toMatch(/exists/i);
      expect(again).not.toContain('were added to the configuration');
    });

    it('and still applies it when the start can go on', async () => {
      const b = await bootDocs({ flow: false });
      script(b);
      const run = await startDocsRun(depsOf(b), 'app', 'create', true);
      expect(run.docs).toEqual({ mode: 'create' });
      expect(getConfig().devCycle.flows?.docs).toBeDefined();
      await b.settle();
    });
  });

  it('keeps what the repository already ignores in .coxia and is idempotent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-ignore-'));
    mkdirSync(join(dir, '.coxia'));
    writeFileSync(join(dir, '.coxia/.gitignore'), 'scratch');
    await ensureRunIgnore(dir);
    await ensureRunIgnore(dir);
    expect(readFileSync(join(dir, '.coxia/.gitignore'), 'utf8')).toBe('scratch\n.run/\n');
    const fresh = mkdtempSync(join(tmpdir(), 'docs-ignore-'));
    await ensureRunIgnore(fresh);
    expect(readFileSync(join(fresh, '.coxia/.gitignore'), 'utf8')).toBe('.run/\n');
  });

  it('writes no ignore file through a link: not when .coxia is one, not when .coxia/.gitignore is one', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'docs-ignore-out-'));
    const linked = mkdtempSync(join(tmpdir(), 'docs-ignore-'));
    symlinkSync(outside, join(linked, '.coxia'));
    expect(await ensureRunIgnore(linked)).toBe(false);
    expect(readdirSync(outside)).toEqual([]);

    const target = join(outside, 'elsewhere.txt');
    writeFileSync(target, 'keep\n');
    const file = mkdtempSync(join(tmpdir(), 'docs-ignore-'));
    mkdirSync(join(file, '.coxia'));
    symlinkSync(target, join(file, '.coxia/.gitignore'));
    expect(await ensureRunIgnore(file)).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('keep\n');
  });

  it('lists as candidates the CLAUDE.md anywhere and the .claude folder, nothing else', async () => {
    const repo = makeRepo();
    const seed = join(repo.root, 'seed');
    mkdirSync(join(seed, 'pkg'), { recursive: true });
    mkdirSync(join(seed, '.claude/skills'), { recursive: true });
    writeFileSync(join(seed, 'CLAUDE.md'), 'a\n');
    writeFileSync(join(seed, 'pkg/CLAUDE.md'), 'b\n');
    writeFileSync(join(seed, '.claude/skills/s.md'), 'c\n');
    writeFileSync(join(seed, 'pkg/NOT-CLAUDE.md'), 'd\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'files');
    expect(await importCandidates(seed)).toEqual(['.claude/skills/s.md', 'CLAUDE.md', 'pkg/CLAUDE.md']);
  });
});

// ---- the draft, the gate and what leaves the machine ---------------------------------------------------------------------------

describe('the draft', () => {
  it('writes only in .coxia: a file of the code is refused and told, the draft is committed with its header stamped, the run folder is not, and the run stops at the gate', async () => {
    const b = await bootDocs();
    const seen: { denied: string | null } = { denied: null };
    script(b, seen);
    const run = await toGate(b);
    expect(run).toMatchObject({ status: 'gate', stage: 'docs-gate' });

    // the call: the agent is confined to .coxia for writes and runs nothing
    const call = b.engine.calls[0];
    expect(call.agent.id).toBe('docs-writer');
    expect(call.confine).toMatchObject({ root: run.worktree, writeRoot: join(run.worktree, '.coxia') });
    expect(call.cwd).toBe(run.worktree);
    expect(seen.denied).toMatch(/outside/i);
    expect(readFileSync(join(run.worktree, 'src/app.ts'), 'utf8')).toBe('export const app = 1;\n');
    expect(b.thread(run).some((m) => m.code === 'runner.denied' && JSON.stringify(m).includes('src/app.ts'))).toBe(true);

    // what the branch holds: the documentation and the ignore file, not the run's own folder
    expect(git(run.worktree, 'diff', '--name-only', run.base as string, 'HEAD').split('\n')).toEqual(['.coxia/.gitignore', '.coxia/README.md', '.coxia/rules/x.md']);
    expect(git(run.worktree, 'ls-files', '.coxia/.run')).toBe('');
    expect(git(run.worktree, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(run.worktree, '.coxia/.run/IMPORT_NOTES.md'))).toBe(true);
    // the app stamped what the pass wrote: the commit of the work and the day, in a commit of its own
    const [stamp, made] = git(run.worktree, 'log', '-2', '--format=%H %s').split('\n');
    const work = made.split(' ')[0];
    expect(stamp).toContain('update the documentation check');
    expect(readFileSync(join(run.worktree, '.coxia/README.md'), 'utf8')).toContain(`checked-commit: ${work}`);
    expect(readFileSync(join(run.worktree, '.coxia/rules/x.md'), 'utf8')).toMatch(/checked-date: (?!2000-01-01)\d{4}-\d{2}-\d{2}\n/);
    expect(made).toContain('add the project documentation');
    // the gate comes before any push: nothing is proposed, nothing was sent
    expect(pending()).toEqual([]);
    expect(forge.writes).toEqual([]);
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(BRANCH);
  });

  it('fails the stage, with a message and without calling the agent, when .coxia has become a link out of the worktree', async () => {
    const b = await bootDocs();
    script(b);
    const run = await toGate(b);
    const outside = mkdtempSync(join(tmpdir(), 'docs-stage-out-'));
    rmSync(join(run.worktree, '.coxia'), { recursive: true, force: true });
    symlinkSync(outside, join(run.worktree, '.coxia'));
    b.runner.gate(run.id, 'reject', 'Again.');
    await b.settle();
    const failed = b.runner.get(run.id) as Run;
    expect(failed.status).toBe('failed');
    expect(failed.error?.detail).toMatch(/symbolic link/);
    expect(b.engine.calls).toHaveLength(1);
    expect(readdirSync(outside)).toEqual([]);
  });

  it.each(['sandbox', 'host'] as const)('opens no session and gives the agent no command door when its shell is %s: the shell tool is not behind the guard of .coxia', async (shell) => {
    const sandbox = fakeSandbox();
    const b = await bootDocs({ shell, sandbox });
    script(b);
    const run = await toGate(b);
    expect(run).toMatchObject({ status: 'gate', stage: 'docs-gate' });
    expect(b.engine.calls[0].agent).toMatchObject({ id: 'docs-writer', shell });
    expect(b.engine.calls[0].exec).toBeUndefined();
    expect(sandbox.opened).toEqual([]);
  });

  it('refuses the agent that writes the ignore file or the run folder: the line that keeps the run out of the pull request stays', async () => {
    const b = await bootDocs();
    const seen: (string | null)[] = [];
    b.engine.script('docs-writer', async (_c, tools) => {
      seen.push(await tools.write('.coxia/.gitignore', 'nothing\n'), await tools.write('.coxia/.run/memory.md', 'mine\n'));
      await tools.write('.coxia/README.md', README);
      return work('Drafted.', { commit: 'add the project documentation', artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
    });
    const run = await toGate(b);
    expect(seen.map((s) => /keeps this file|kept by the app/.test(s ?? ''))).toEqual([true, true]);
    expect(readFileSync(join(run.worktree, '.coxia/.gitignore'), 'utf8')).toBe('.run/\n');
    expect(git(run.worktree, 'ls-files', '.coxia/.run')).toBe('');
    expect(b.thread(run).filter((m) => m.code === 'runner.denied')).toHaveLength(2);
  });

  it('goes back to the draft when the gate is rejected, with the reason for the agent, and stops at the gate again', async () => {
    const b = await bootDocs();
    b.engine.script(
      'docs-writer',
      async (_c, tools) => {
        await tools.write('.coxia/README.md', README);
        return work('Drafted.', { commit: 'add the project documentation', artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
      },
      async (call, tools) => {
        expect(call.prompt).toContain('Say what the runner does.');
        await tools.write('.coxia/rules/x.md', RULE);
        return work('Redone.', { commit: 'say what the runner does', artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
      },
    );
    const run = await toGate(b);
    expect(pending()).toEqual([]);
    b.runner.gate(run.id, 'reject', 'Say what the runner does.');
    await b.settle();
    const again = b.runner.get(run.id) as Run;
    expect(again).toMatchObject({ status: 'gate', stage: 'docs-gate' });
    expect(b.engine.calls.map((c) => c.agent.id)).toEqual(['docs-writer', 'docs-writer']);
    expect(existsSync(join(run.worktree, '.coxia/rules/x.md'))).toBe(true);
    // still no push: the gate was not approved
    expect(pending()).toEqual([]);
    expect(forge.writes).toEqual([]);
  });

  it('a question of the agent goes to the person and never to a tracker', async () => {
    const b = await bootDocs();
    b.engine.script(
      'docs-writer',
      () => work('', { question: 'Which folder holds the rules?' }),
      async (_c, tools) => {
        await tools.write('.coxia/README.md', README);
        return work('Drafted.', { artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
      },
    );
    const run = await b.runner.startDocs('app', 'create');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'question', question: { text: 'Which folder holds the rules?' } });
    b.runner.answer(run.id, 'rules/');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'docs-gate' });
    expect(forge.writes).toEqual([]);
  });
});

describe('the push and the pull request', () => {
  it('are proposed only after the gate, wait for the "sim", leave the run folder and the line that closes an issue out, and say what was left out of the import', async () => {
    const b = await bootDocs();
    script(b);
    const watch = watchIssueZero();
    const run = await toGate(b);
    expect(pending()).toEqual([]);

    const waiting = await toWait(b, run);
    expect(waiting).toMatchObject({ status: 'waiting', stage: 'docs-ready', wait: { kind: 'pr-merged' } });
    // the push is proposed now, once, for the run's branch
    expect(pending().map((a) => a.kind)).toEqual(['run-push']);
    expect(pending()[0].output).toContain(`push origin HEAD:refs/heads/${BRANCH}`);
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(BRANCH);

    // the "sim" pushes the branch: it holds the documentation and the ignore file, and nothing of the run's folder
    const pushed = await actions.approveAction(pending()[0].id);
    expect(pushed.state).toBe('done');
    await b.settle();
    expect(git(b.repo.origin, 'ls-tree', '-r', '--name-only', BRANCH).split('\n').filter((p) => p.startsWith('.coxia'))).toEqual(['.coxia/.gitignore', '.coxia/README.md', '.coxia/rules/x.md']);

    // the pull request is proposed with the description of the docs template: no "Closes", the section of what was left out, the marker
    const proposal = pending()[0];
    expect(proposal.command).toMatchObject({ method: 'POST', endpoint: 'repos/group/project/pulls' });
    const body = JSON.parse(proposal.command?.json as string) as { title: string; head: string; base: string; body: string };
    expect(body).toMatchObject({ title: 'Document the project', head: BRANCH, base: 'main' });
    expect(body.body.startsWith('**Documentation ready for review**')).toBe(true);
    expect(body.body).toContain('### What the import left out');
    expect(body.body).toContain('A rule of a session: who pushes.');
    expect(body.body).not.toMatch(/closes/i);
    expect(body.body).not.toMatch(/#0\b/);
    expect(body.body).toContain(`<!-- coxia:run=${run.id} stage=pr -->`);
    expect(forge.pr).toBeNull();

    await actions.approveAction(proposal.id);
    await b.settle();
    expect(b.runner.get(run.id)?.comments.pr).toMatchObject({ status: 'published', noteId: 7 });

    // the run waits for the merge, and ends when the host says so
    expect(b.runner.get(run.id)?.status).toBe('waiting');
    expect(await b.runner.tick()).toEqual([]);
    forge.pr!.merged = true;
    await b.runner.tick();
    await b.settle();
    const end = b.runner.get(run.id) as Run;
    expect(end).toMatchObject({ status: 'done', wait: null });
    expect(end.stages.map((s) => [s.stage, s.status])).toEqual([['docs-draft', 'done'], ['docs-gate', 'done'], ['docs-publish', 'done'], ['docs-ready', 'done'], ['docs-done', 'done']]);

    // nothing was ever asked of the host for an issue: the only write is the pull request, no call names the issue number 0, and the thread tells of no publication that failed
    expect(writesOf()).toEqual(['POST pulls']);
    expect([...new Set(watch.ops())]).toEqual(['createMr']);
    expect(watch.zero()).toEqual([]);
    expect(b.thread(end).filter((m) => /^runner\.(publish|comment|review)\./.test(m.code ?? ''))).toEqual([]);
    watch.done();
  });

  it('are refused in a test workspace: they are proposed, approving them fails, and nothing leaves the machine', async () => {
    asReal(true);
    const b = await bootDocs();
    script(b);
    const run = await toGate(b);
    await toWait(b, run);
    const push = pending().find((a) => a.kind === 'run-push')!;
    const refused = await actions.approveAction(push.id).catch((e: Error) => e);
    expect(String(refused instanceof Error ? refused.message : refused.output)).toMatch(/test workspace|Workspace de testes/i);
    expect(git(b.repo.clone, 'branch', '-r')).not.toContain(BRANCH);
    expect(forge.writes).toEqual([]);
  });

  it('never looks for a pull request under the issue number 0: one the host links to it is not the run\'s, whatever its branch', async () => {
    forge = makeForge({ pr: { branch: BRANCH, merged: true }, linked: true });
    setVcsRuntimeForTests(forge.runtime());
    const b = await bootDocs();
    script(b);
    const linked = vi.spyOn(vcsProvider(), 'linkedMrs');
    const run = await toGate(b);
    await toWait(b, run);
    expect(b.runner.get(run.id)).toMatchObject({ status: 'waiting', stage: 'docs-ready' });
    expect(await b.runner.tick()).toEqual([]);
    expect(b.runner.get(run.id)?.status).toBe('waiting');
    expect(linked).not.toHaveBeenCalled();
    linked.mockRestore();
  });

  describe('a docs flow edited to carry what an issue flow carries', () => {
    // The flow is the person's to edit (an import of the configuration can bring one): a status label on its stages and a wait for a label must not reach the host, which has no
    // issue to put them on.
    const edited = (c: Config) => {
      const flow = c.devCycle.flows?.docs as { id: string; trackerStatus?: string; waitsFor?: { kind: string; label?: string } }[];
      flow.find((s) => s.id === 'docs-draft')!.trackerStatus = 'Drafting';
      flow.find((s) => s.id === 'docs-publish')!.trackerStatus = 'Publishing';
      flow.find((s) => s.id === 'docs-ready')!.waitsFor = { kind: 'label', label: 'merged-by-hand' };
    };

    it('plans nothing for the issue 0 over a whole run, and its wait for a label is never over by itself', async () => {
      const b = await bootDocs({ edit: edited });
      script(b);
      const watch = watchIssueZero();
      const run = await toGate(b);
      const waiting = await toWait(b, run);
      expect(waiting).toMatchObject({ status: 'waiting', stage: 'docs-ready', wait: { kind: 'label' } });
      expect(await b.runner.tick()).toEqual([]);
      expect(b.runner.get(run.id)?.status).toBe('waiting');
      expect(watch.zero()).toEqual([]);
      expect(watch.ops()).not.toContain('setIssueLabels');
      expect(pending().filter((a) => a.kind !== 'run-push')).toEqual([]);
      expect(b.thread(run).filter((m) => /^runner\.status\./.test(m.code ?? ''))).toEqual([]);
      watch.done();
    });

    it('the publisher does not act on the issue of a documentation run, whatever it is asked: status, priority, squad label, request for another squad', async () => {
      // the draft stage is the one that owns the priority of the flow (the last work stage of the backlog kind), so a level it returns would be proposed
      const b = await bootDocs({ edit: (c) => ((c.devCycle.flows?.docs as { id: string; kind: string }[]).find((s) => s.id === 'docs-draft')!.kind = 'backlog') });
      script(b);
      const run = await toGate(b);
      const publisher = b.deps.publisher as NonNullable<typeof b.deps.publisher>;
      const stages = flowOfRun(run, getConfig());
      const draft = { ...stages.find((s) => s.id === 'docs-draft')!, trackerStatus: 'Drafting' };
      const gate = stages.find((s) => s.id === 'docs-gate')!;
      const watch = watchIssueZero();
      const agent = getConfig().agents.team.find((a) => a.id === 'docs-writer')!;
      await publisher.stageEntered(run.id, { stage: draft, previous: null, autonomous: true });
      await publisher.stageEntered(run.id, { stage: gate, previous: draft, autonomous: false });
      await publisher.stageEnded(run.id, { stage: draft, agent, kind: 'work', output: { priority: 'High', milestone: '', summary: 'x', artifacts: [], handoff: null, question: null, commit: '' } as never, autonomous: true });
      await publisher.squadRouted(run.id, { squad: 'any', label: 'squad-any', by: 'docs-writer', autonomous: true });
      await publisher.squadRouted(run.id, { squad: 'any', label: 'squad-any', by: 'docs-writer', autonomous: false });
      const made = await publisher.requestIssue(run.id, { key: 'k', squad: 'any', title: 'Needs a thing', body: 'b', label: 'squad-any', by: 'docs-writer', autonomous: true });
      expect(made.status).toBe('no-host');
      expect(watch.ops()).toEqual([]);
      expect(watch.zero()).toEqual([]);
      expect(pending()).toEqual([]);
      expect(forge.writes).toEqual([]);
      expect(b.thread(run).filter((m) => /^runner\.(status|priority|squad|request)\./.test(m.code ?? ''))).toEqual([]);
      watch.done();
    });
  });

  it('the detector of a call for the issue 0 does catch one, of each kind', async () => {
    const watch = watchIssueZero();
    // the provider itself refuses such calls, but the call is what must never be made
    await vcsProvider().planWrite({ op: 'commentIssue', project: 'group/project', iid: 0, body: 'x' }).catch(() => undefined);
    await vcsProvider().listIssueComments('group/project', 0).catch(() => undefined);
    await vcsProvider().linkedMrs('group/project', 0).catch(() => undefined);
    await vcsProvider().getIssue('group/project', 0).catch(() => undefined);
    expect(watch.zero()).toHaveLength(4);
    watch.done();
  });
});

// ---- bringing it up to date --------------------------------------------------------------------------------------------------------

describe('updating', () => {
  /** A repository whose rule cites a file that changed after the rule was checked. */
  function repoWithStaleRule(): Repo {
    const repo = makeRepo();
    const seed = join(repo.root, 'seed');
    const checked = git(seed, 'rev-parse', 'HEAD');
    mkdirSync(join(seed, '.coxia/rules'), { recursive: true });
    writeFileSync(join(seed, '.coxia/README.md'), `---\nchecked-commit: ${checked}\nchecked-date: 2026-09-01\nsummary: The project\n---\n# App\n`);
    writeFileSync(join(seed, '.coxia/rules/x.md'), `---\nchecked-commit: ${checked}\nchecked-date: 2026-09-01\nevidence: [src/app.ts:1]\n---\n# The constant\n\nThe app constant is 1.\n`);
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', 'add the documentation');
    writeFileSync(join(seed, 'src/app.ts'), 'export const app = 3;\n');
    git(seed, 'commit', '-qam', 'change the constant');
    git(seed, 'push', '-q', 'origin', 'main');
    return repo;
  }

  it('tells the draft which files are not checked and why, hands it the documentation with the mark, and stamps only what it changed', async () => {
    const b = await bootDocs({ repo: repoWithStaleRule() });
    // what the agent is handed is the section `runAgent` adds to the system text, from the ask the stage made: read it as the call is made, before the pass changes the files
    let section = '';
    b.engine.script('docs-writer', async (c, tools) => {
      section = await harnessSection(c.docs as NonNullable<typeof c.docs>, c.agent, { cwd: c.cwd });
      await tools.write('.coxia/rules/x.md', `${header('evidence: [src/app.ts:1]\n')}# The constant\n\nThe app constant is 3.\n`);
      return work('Corrected.', { commit: 'correct the constant', artifacts: [doc('IMPORT_NOTES.md', NOTES)] });
    });
    const run = await b.runner.startDocs('app', 'update');
    await b.settle();
    expect(run.docs).toEqual({ mode: 'update' });
    const record = readFileSync(join(run.worktree, '.coxia/.run/0_ISSUE.md'), 'utf8');
    expect(record).toContain('bring the documentation of this repository up to date');
    expect(record).toMatch(/\.coxia\/rules\/x\.md: not checked: 1 file\(s\) it cites changed since [0-9a-f]{7} \(src\/app\.ts\)/);
    expect(record).toMatch(/\.coxia\/README\.md: checked/);
    // the agent is handed what exists, with the mark on the rule that is out of date
    expect(section).toContain('Documentation file .coxia/rules/x.md [not checked: 1 file(s) it cites changed since');
    expect(section).toContain('Overview of the project (.coxia/README.md)');
    // the rule it changed is stamped with the commit that holds it; the overview it did not touch keeps its header
    const stamped = readFileSync(join(run.worktree, '.coxia/rules/x.md'), 'utf8');
    const [, made] = git(run.worktree, 'log', '-2', '--format=%H').split('\n');
    expect(stamped).toContain(`checked-commit: ${made}`);
    expect(readFileSync(join(run.worktree, '.coxia/README.md'), 'utf8')).toContain('checked-date: 2026-09-01');
  });
});

// ---- the guard of the agent's files, on both engines ------------------------------------------------------------------------------

describe('what a documentation agent may write, on both engines', () => {
  let root: string;
  let outside: string;
  const writeRoot = () => join(root, '.coxia');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'docs-confine-'));
    outside = mkdtempSync(join(tmpdir(), 'docs-confine-out-'));
    mkdirSync(join(root, '.coxia/rules'), { recursive: true });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/app.ts'), 'export const app = 1;\n');
    symlinkSync('..', join(root, '.coxia/up'));
  });

  type Hook = (input: object, id: undefined, o: { signal: AbortSignal }) => Promise<{ hookSpecificOutput?: { permissionDecision?: string } }>;
  /** What the Claude SDK does with the confinement: every PreToolUse callback whose matcher names the tool, in order; the first refusal is the answer. */
  async function sdk(hooks: ReturnType<typeof confinedHooks>, tool: string, input: Record<string, unknown>): Promise<'allow' | 'deny'> {
    for (const entry of hooks.PreToolUse ?? []) {
      if (!new RegExp(`^(?:${entry.matcher})$`).test(tool)) continue;
      for (const hook of entry.hooks as unknown as Hook[]) {
        const out = await hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, undefined, { signal: new AbortController().signal });
        if (out.hookSpecificOutput?.permissionDecision === 'deny') return 'deny';
      }
    }
    return 'allow';
  }

  it('the hooks of the SDK allow .coxia, refuse any other path (relative, absolute, "..", through a link) and keep reading the whole worktree', async () => {
    const hooks = confinedHooks({ root, writeRoot: writeRoot(), commands: [] });
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      const w = (file_path: string) => sdk(hooks, tool, { file_path, content: 'x', old_string: 'a', new_string: 'b' });
      expect(await w('.coxia/rules/a.md'), `${tool} in .coxia`).toBe('allow');
      expect(await w(join(root, '.coxia/rules/a.md')), `${tool} absolute in .coxia`).toBe('allow');
      expect(await w('src/app.ts'), `${tool} the code`).toBe('deny');
      expect(await w('rules/a.md'), `${tool} relative to the worktree, not to .coxia`).toBe('deny');
      expect(await w(join(root, 'src/app.ts')), `${tool} absolute, outside`).toBe('deny');
      expect(await w('.coxia/../src/app.ts'), `${tool} with ..`).toBe('deny');
      expect(await w(join(outside, 'x.md')), `${tool} elsewhere`).toBe('deny');
      expect(await w('.coxia/up/src/app.ts'), `${tool} through a link that leaves .coxia`).toBe('deny');
      expect(await w('.coxia'), `${tool} the folder itself`).toBe('deny');
    }
    // reads are the worktree's, as an agent that writes has always had them; the shell and the network stay shut
    expect(await sdk(hooks, 'Read', { file_path: 'src/app.ts' })).toBe('allow');
    expect(await sdk(hooks, 'Read', { file_path: join(outside, 'x.md') })).toBe('deny');
    expect(await sdk(hooks, 'Bash', { command: 'npm test' })).toBe('deny');
    expect(await sdk(hooks, 'WebFetch', { url: 'https://example.com' })).toBe('deny');
  });

  describe('what the app keeps in .coxia (its ignore file and the folder of the run)', () => {
    const reserved = HARNESS_OWN;
    const ctx = () => ({ cwd: root, roots: [root], isSecret: () => false, secretGlobs: [], outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, writeRoot: writeRoot(), writeReserved: reserved });

    it('the hooks of the SDK refuse them, in any spelling of the case, and still allow the documentation', async () => {
      const hooks = confinedHooks({ root, writeRoot: writeRoot(), writeReserved: reserved, commands: [] });
      for (const tool of ['Write', 'Edit', 'MultiEdit']) {
        const w = (file_path: string) => sdk(hooks, tool, { file_path, content: 'x', old_string: 'a', new_string: 'b' });
        expect(await w('.coxia/.gitignore'), `${tool} the ignore file`).toBe('deny');
        expect(await w(join(root, '.coxia/.gitignore')), `${tool} the ignore file, absolute`).toBe('deny');
        expect(await w('.coxia/.GITIGNORE'), `${tool} the ignore file, in capitals`).toBe('deny');
        expect(await w('.coxia/.run/memory.md'), `${tool} in the run folder`).toBe('deny');
        expect(await w('.coxia/.run'), `${tool} the run folder`).toBe('deny');
        expect(await w('.coxia/rules/.gitignore'), `${tool} a file of that name deeper is the agent's`).toBe('allow');
        expect(await w('.coxia/README.md'), `${tool} the documentation`).toBe('allow');
      }
    });

    it('the Write and Edit tools of the open engine refuse them too, whatever the hooks said', async () => {
      await expect(writeTool.run({ file_path: '.coxia/.gitignore', content: 'x' }, ctx())).rejects.toThrow(/keeps this file/);
      await expect(writeTool.run({ file_path: '.coxia/.run/memory.md', content: 'x' }, ctx())).rejects.toThrow(/keeps this file/);
      await expect(editTool.run({ file_path: '.coxia/.gitignore', old_string: 'a', new_string: 'b' }, ctx())).rejects.toThrow(/keeps this file/);
      expect(existsSync(join(root, '.coxia/.gitignore'))).toBe(false);
      expect(existsSync(join(root, '.coxia/.run'))).toBe(false);
      await writeTool.run({ file_path: '.coxia/rules/ok.md', content: 'ok\n' }, ctx());
      const policy = policyFromHooks(confinedHooks({ root, writeRoot: writeRoot(), writeReserved: reserved, commands: [] }), 'fake');
      expect(await policy.pre('Write', { file_path: '.coxia/.gitignore', content: 'x' }, root)).toBeTruthy();
    });
  });

  describe('when .coxia is not a real folder of the worktree', () => {
    let linked: string;
    let into: string;
    beforeAll(() => {
      linked = mkdtempSync(join(tmpdir(), 'docs-linked-'));
      into = join(linked, 'inside');
      mkdirSync(into);
      mkdirSync(join(linked, 'src'));
      symlinkSync(outside, join(linked, '.coxia'));
    });
    const ctxOf = (cwd: string) => ({ cwd, roots: [cwd], isSecret: () => false, secretGlobs: [], outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, writeRoot: join(cwd, '.coxia') });

    it('the hooks of the SDK refuse a write through .coxia as a link, relative or absolute, and one through a link to a folder of the worktree', async () => {
      const hooks = confinedHooks({ root: linked, writeRoot: join(linked, '.coxia'), commands: [] });
      for (const tool of ['Write', 'Edit', 'MultiEdit']) {
        expect(await sdk(hooks, tool, { file_path: '.coxia/x.md', content: 'x' }), `${tool} relative`).toBe('deny');
        expect(await sdk(hooks, tool, { file_path: join(linked, '.coxia/x.md'), content: 'x' }), `${tool} absolute`).toBe('deny');
      }
      rmSync(join(linked, '.coxia'));
      symlinkSync(into, join(linked, '.coxia'));
      expect(await sdk(hooks, 'Write', { file_path: '.coxia/x.md', content: 'x' }), 'a link that stays inside the worktree').toBe('deny');
      rmSync(join(linked, '.coxia'));
      symlinkSync(outside, join(linked, '.coxia'));
      expect(existsSync(join(outside, 'x.md'))).toBe(false);
    });

    it('the Write and Edit tools of the open engine refuse it too, and the policy built from the hooks does before them', async () => {
      const ctx = ctxOf(linked);
      writeFileSync(join(outside, 'present.md'), 'old\n');
      await expect(writeTool.run({ file_path: '.coxia/x.md', content: 'x' }, ctx)).rejects.toThrow();
      await expect(writeTool.run({ file_path: join(linked, '.coxia/x.md'), content: 'x' }, ctx)).rejects.toThrow();
      await expect(editTool.run({ file_path: '.coxia/present.md', old_string: 'old', new_string: 'new' }, ctx)).rejects.toThrow();
      expect(existsSync(join(outside, 'x.md'))).toBe(false);
      expect(readFileSync(join(outside, 'present.md'), 'utf8')).toBe('old\n');
      const policy = policyFromHooks(confinedHooks({ root: linked, writeRoot: join(linked, '.coxia'), commands: [] }), 'fake');
      expect(await policy.pre('Write', { file_path: '.coxia/x.md', content: 'x' }, linked)).toBeTruthy();
    });
  });

  it('an agent with no writeRoot (an issue run) writes in the whole worktree, as before', async () => {
    const hooks = confinedHooks({ root, commands: [] });
    expect(await sdk(hooks, 'Write', { file_path: 'src/app.ts', content: 'x' })).toBe('allow');
    expect(await sdk(hooks, 'Write', { file_path: '../x.ts', content: 'x' })).toBe('deny');
  });

  it('the Write tool of the open engine stays inside .coxia too, with the path read from the working directory', async () => {
    const ctx = { cwd: root, roots: [root], isSecret: () => false, secretGlobs: [], outputMax: 30_000, env: {}, bashPrefixes: [], ripgrep: 'off' as const, writeRoot: writeRoot() };
    // a path inside .coxia lands there (not in .coxia/.coxia), and any other is refused by the tool itself, whatever the hooks said
    await writeTool.run({ file_path: '.coxia/rules/b.md', content: 'b\n' }, ctx);
    expect(readFileSync(join(root, '.coxia/rules/b.md'), 'utf8')).toBe('b\n');
    expect(existsSync(join(root, '.coxia/.coxia'))).toBe(false);
    await expect(writeTool.run({ file_path: 'src/app.ts', content: 'x' }, ctx)).rejects.toThrow();
    await expect(writeTool.run({ file_path: 'rules/b.md', content: 'x' }, ctx)).rejects.toThrow();
    await expect(writeTool.run({ file_path: join(outside, 'x.md'), content: 'x' }, ctx)).rejects.toThrow();
    expect(readFileSync(join(root, 'src/app.ts'), 'utf8')).toBe('export const app = 1;\n');
    // and the same policy the engine builds from the hooks refuses the code before the tool runs
    const policy = policyFromHooks(confinedHooks({ root, writeRoot: writeRoot(), commands: [] }), 'fake');
    expect(await policy.pre('Write', { file_path: 'src/app.ts', content: 'x' }, root)).toBeTruthy();
    expect(await policy.pre('Write', { file_path: '.coxia/rules/c.md', content: 'x' }, root)).toBeNull();
  });

  describe('through runAgent on the open engine', () => {
    let fake: Fake;
    beforeAll(async () => {
      fake = await fakeOpenAI((req) =>
        req.n === 1
          ? toolStep([
              { id: 'w1', name: 'Write', args: { file_path: '.coxia/rules/open.md', content: 'open\n' } },
              { id: 'w2', name: 'Write', args: { file_path: 'src/feature.ts', content: 'export const x = 1;\n' } },
              { id: 'w3', name: 'Write', args: { file_path: 'rules/relative.md', content: 'x' } },
              { id: 'r1', name: 'Read', args: { file_path: 'src/app.ts' } },
            ])
          : toolStep([{ id: 'f', name: 'final_answer', args: { fala: 'done' } }]),
      );
    });
    afterAll(async () => {
      await fake.close();
    });

    it('writes .coxia/rules, refuses the code and a path that is not under .coxia, and reads the code', async () => {
      updateConfig((c) => {
        c.llm.providers.push(newProvider({ id: 'localdocs', kind: 'openai-compatible', baseUrl: fake.url, structured: 'tool' }));
        return c;
      });
      const agent = newAgent({ id: 'docs-writer', permission: 'worktree', shell: 'none', model: { role: null, provider: 'localdocs', model: 'qwen3:8b' } });
      const denials: string[] = [];
      const r = await runAgent<{ fala: string }>(
        { agent, prompt: 'p', schema: obj({ fala: str }), system: 'sys', cwd: root, label: 'docs-writer', maxTurns: 6, confine: { root, writeRoot: writeRoot(), hooks: confinedHooks({ root, writeRoot: writeRoot(), commands: [], onDenied: (d) => denials.push(`${d.code}:${d.target}`) }) } },
        [],
      );
      expect(r.data).toEqual({ fala: 'done' });
      expect(readFileSync(join(root, '.coxia/rules/open.md'), 'utf8')).toBe('open\n');
      expect(existsSync(join(root, 'src/feature.ts'))).toBe(false);
      expect(existsSync(join(root, 'rules/relative.md'))).toBe(false);
      expect(denials).toEqual(['outside:src/feature.ts', 'outside:rules/relative.md']);
      // the read of the code went through: the second request carries what the file holds
      expect(JSON.stringify(fake.chats()[1].body?.messages)).toContain('export const app = 1;');
    });
  });
});
