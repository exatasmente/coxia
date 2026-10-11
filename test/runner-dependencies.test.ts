// A run's worktree has no node_modules of its own: it gets links to the ones the repository's clone has, so the commands the app runs and the tests a
// developer agent may run find their tools. Real git repositories in a temp folder; scripted agents; nothing reaches a model or the network.
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkPath } from '../src/main/engine/guard';
import { DEPENDENCY_NAMES, MAX_LINKS, cloneOf, dependencyFolders, linkDependencies } from '../src/main/runner/dependencies';
import { changedOutside, commitAll, createWorktree } from '../src/main/runner/git';
import type { CommandRunner } from '../src/main/runner/commands';
import { newAgent } from '../src/shared/config/team';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { messageText } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { type Boot, type Repo, boot, doc, makeRepo, work } from './helpers/runner';
import { git } from './helpers/conflictRepos';

vi.setConfig({ testTimeout: 30_000 });

const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const ID = { name: 'Runner Test', email: 'runner@example.test' };
const isLink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/** A repository whose .gitignore covers the dependency folders, with a package and a sidecar folder tracked, and a clone that has installed everything. */
function installedRepo(ignore = 'node_modules/\n.venv\n'): Repo {
  const repo = makeRepo();
  mkdirSync(join(repo.clone, 'packages/a'), { recursive: true });
  mkdirSync(join(repo.clone, 'sidecar'), { recursive: true });
  writeFileSync(join(repo.clone, 'packages/a/package.json'), '{"name":"a"}');
  writeFileSync(join(repo.clone, 'sidecar/main.py'), 'print(1)\n');
  if (ignore) writeFileSync(join(repo.clone, '.gitignore'), ignore);
  git(repo.clone, 'add', '-A');
  git(repo.clone, 'commit', '-q', '-m', 'ignore the dependencies');
  git(repo.clone, 'push', '-q', 'origin', 'main');
  for (const dir of ['node_modules/.bin', 'packages/a/node_modules/dep', 'sidecar/.venv/bin']) mkdirSync(join(repo.clone, dir), { recursive: true });
  writeFileSync(join(repo.clone, 'node_modules/.bin/vitest'), '#!/bin/sh\necho ok\n');
  writeFileSync(join(repo.clone, 'packages/a/node_modules/dep/index.js'), 'module.exports = 1;\n');
  return repo;
}

describe('linking the dependencies of the clone into a worktree', () => {
  it('links the root, the package and the nested folders the clone has and the worktree lacks, and the app never commits them', async () => {
    const repo = installedRepo();
    const dest = join(repo.worktrees, 'app', '1-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/1-x' });
    expect(await cloneOf(dest)).toBe(repo.clone);

    const result = await linkDependencies(repo.clone, dest);
    expect(result.linked.sort()).toEqual(['node_modules', 'packages/a/node_modules', 'sidecar/.venv']);
    expect(result.none).toBe(false);
    expect(readlinkSync(join(dest, 'node_modules'))).toBe(join(repo.clone, 'node_modules'));
    expect(existsSync(join(dest, 'node_modules/.bin/vitest'))).toBe(true);
    expect(existsSync(join(dest, 'packages/a/node_modules/dep/index.js'))).toBe(true);

    // a link is not a directory to git, so the pattern `node_modules/` does not cover it: the app's own commands leave it out by name
    expect(await changedOutside(dest, 'docs/cycles')).toBe(false);
    expect(await commitAll(dest, 'feat: nothing to commit #1', ID)).toBeNull();
    writeFileSync(join(dest, 'src/new.ts'), 'export const n = 1;\n');
    const sha = await commitAll(dest, 'feat: add a file #1', ID);
    expect(sha).toBeTruthy();
    expect(git(dest, 'show', '--name-only', '--format=', 'HEAD')).toBe('src/new.ts');
    expect(git(dest, 'ls-files').split('\n').filter((f) => /node_modules|\.venv/.test(f))).toEqual([]);
  });

  it('links nothing a second time, and never replaces what the worktree already has', async () => {
    const repo = installedRepo();
    const dest = join(repo.worktrees, 'app', '2-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/2-x' });
    mkdirSync(join(dest, 'node_modules/own'), { recursive: true });
    writeFileSync(join(dest, 'sidecar/.venv'), 'a file the repository put here');
    const first = await linkDependencies(repo.clone, dest);
    expect(first.linked).toEqual(['packages/a/node_modules']);
    expect(isLink(join(dest, 'node_modules'))).toBe(false);
    expect(existsSync(join(dest, 'node_modules/own'))).toBe(true);
    expect(isLink(join(dest, 'sidecar/.venv'))).toBe(false);
    expect((await linkDependencies(repo.clone, dest)).linked).toEqual([]);
  });

  it('links only what the repository ignores', async () => {
    const repo = installedRepo('');
    const dest = join(repo.worktrees, 'app', '3-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/3-x' });
    const result = await linkDependencies(repo.clone, dest);
    expect(result.linked).toEqual([]);
    expect(isLink(join(dest, 'node_modules'))).toBe(false);
    // the clone has them and the worktree could not take them: that is not "the clone has none"
    expect(result.none).toBe(false);
  });

  it('says there are none when neither the clone nor the worktree has a dependency folder', async () => {
    const repo = makeRepo();
    const dest = join(repo.worktrees, 'app', '4-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/4-x' });
    expect(await linkDependencies(repo.clone, dest)).toEqual({ linked: [], none: true });
  });

  it('caps the number of links and looks only at the root, one level down and under the workspace folders', () => {
    const repo = makeRepo();
    for (let i = 0; i < MAX_LINKS + 5; i++) mkdirSync(join(repo.clone, 'packages', `p${i}`, 'node_modules'), { recursive: true });
    mkdirSync(join(repo.clone, 'deep/er/node_modules'), { recursive: true });
    const found = dependencyFolders(repo.clone);
    expect(found).toHaveLength(MAX_LINKS);
    expect(found.every((f) => f.startsWith('packages/'))).toBe(true);
    expect(DEPENDENCY_NAMES).toContain('node_modules');
  });

  it('is not a way to write into the clone: the worktree guard refuses a path through the link', async () => {
    const repo = installedRepo();
    const dest = join(repo.worktrees, 'app', '5-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/5-x' });
    await linkDependencies(repo.clone, dest);
    for (const path of ['node_modules/pkg/evil.js', 'node_modules/.bin/vitest', 'sidecar/.venv/bin/evil', 'packages/a/node_modules/dep/index.js']) {
      expect(checkPath(dest, path), path).toEqual({ ok: false, code: 'outside' });
    }
    expect(checkPath(dest, 'src/ok.ts')).toMatchObject({ ok: true });
  });
});

const at = (c: WorkspaceConfig, id: string): StageDef => c.devCycle.stages.find((s) => s.id === id) as StageDef;

const withWait = (c: WorkspaceConfig): void => {
  c.language = 'en';
  at(c, 'ready').type = 'wait';
  at(c, 'ready').waitsFor = { kind: 'pr-merged' };
  c.devCycle.stages.push({ id: 'communicate', label: 'communicate', match: [], kind: 'development', rank: 0, type: 'work', agentId: 'writer', produces: ['6_NOTE.md'] });
  c.agents.team.push(newAgent({ id: 'writer', name: 'writer', stages: ['communicate'], autonomous: true, model: { role: 'deep' } }));
};

function script(b: Boot, seen: { developer: boolean[]; denied: (string | null)[] } = { developer: [], denied: [] }): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md'), doc('PROTOTYPE.md')] }));
  b.engine.script('developer', async (call, tools, n) => {
    seen.developer.push(isLink(join(call.cwd, 'node_modules')));
    if (n === 1) seen.denied.push(await tools.write('node_modules/pkg/evil.js', 'x'));
    await tools.write('src/feature.ts', `export const feature = ${n};\n`);
    return work(`Done ${n}.`, { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', () => work('Approved.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [] }));
  b.engine.script('writer', () => work('Written.', { artifacts: [doc('6_NOTE.md')] }));
}

async function toTheWait(b: Boot): Promise<Run> {
  const run = await b.runner.start('app#101');
  for (let i = 0; i < 8; i++) {
    await b.settle();
    if (b.runner.get(run.id)!.status !== 'gate') break;
    b.runner.gate(run.id, 'approve');
  }
  return b.runner.get(run.id)!;
}

/** A command runner that records whether the tool the commands need was in the worktree when they ran. */
const toolCheck = (seen: boolean[]): CommandRunner => async (cwd, command) => {
  seen.push(existsSync(join(cwd, 'node_modules/.bin/vitest')));
  return { command, exitCode: 0, timedOut: false, output: 'ok', ms: 1 };
};

describe('dependencies in a run', () => {
  it('links them when the run starts, before the stages that run commands, and says which in the thread once', async () => {
    const repo = installedRepo();
    const ran: boolean[] = [];
    const b = await boot({ repo, configure: withWait, commandRunner: toolCheck(ran) });
    const seen = { developer: [] as boolean[], denied: [] as (string | null)[] };
    script(b, seen);
    const run = await toTheWait(b);
    expect(run).toMatchObject({ status: 'waiting', stage: 'ready' });

    expect(isLink(join(run.worktree, 'node_modules'))).toBe(true);
    const said = b.thread(run).filter((m) => m.code === 'runner.deps.linked');
    expect(said).toHaveLength(1);
    expect(said[0].params).toEqual({ list: 'node_modules, packages/a/node_modules, sidecar/.venv' });
    expect(messageText(said[0])).toContain('The app linked from the clone: node_modules, packages/a/node_modules, sidecar/.venv.');
    expect(b.thread(run).filter((m) => m.code === 'runner.deps.none')).toEqual([]);

    expect(seen.developer).toEqual([true]);
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.every(Boolean)).toBe(true);
    // the agent cannot write through the link; the file is not in the clone
    expect(seen.denied[0]).toBeTruthy();
    expect(existsSync(join(repo.clone, 'node_modules/pkg/evil.js'))).toBe(false);
    // and the branch holds no dependency
    expect(git(run.worktree, 'ls-files').split('\n').filter((f) => /node_modules|\.venv/.test(f))).toEqual([]);
    expect(git(run.worktree, 'log', '--format=%s').split('\n').length).toBeGreaterThan(2);
  });

  it('gives a worktree made earlier without links its links when the run is sent back and the developer stage starts', async () => {
    const repo = installedRepo();
    const ran: boolean[] = [];
    const b = await boot({ repo, configure: withWait, commandRunner: toolCheck(ran) });
    const seen = { developer: [] as boolean[], denied: [] as (string | null)[] };
    script(b, seen);
    const run = await toTheWait(b);
    // the worktree of a run that started before the app linked anything
    for (const rel of ['node_modules', 'packages/a/node_modules', 'sidecar/.venv']) rmSync(join(run.worktree, rel));
    expect(existsSync(join(run.worktree, 'node_modules'))).toBe(false);

    b.runner.sendBack(run.id, '', 'Run the tests again.');
    await b.settle();
    expect(seen.developer).toEqual([true, true]);
    expect(isLink(join(run.worktree, 'node_modules'))).toBe(true);
    const said = b.thread(run).filter((m) => m.code === 'runner.deps.linked');
    expect(said).toHaveLength(2);
    expect(said[1].stage).toBe('implement');
    expect(ran.length).toBeGreaterThan(2);
    expect(ran.every(Boolean)).toBe(true);
  });

  it('links before QA when the stage before it did not need them', async () => {
    const repo = installedRepo();
    const ran: boolean[] = [];
    const b = await boot({ repo, configure: withWait, commandRunner: toolCheck(ran) });
    script(b);
    const run = await toTheWait(b);
    rmSync(join(run.worktree, 'node_modules'));
    // QA again, with no developer pass in between
    b.runner.sendBack(run.id, 'qa', 'Check once more.');
    await b.settle();
    expect(ran.at(-1)).toBe(true);
    expect(isLink(join(run.worktree, 'node_modules'))).toBe(true);
  });

  it('does nothing when the setting is off', async () => {
    const repo = installedRepo();
    const b = await boot({ repo, configure: (c) => { withWait(c); c.runner.linkDependencies = false; } });
    script(b);
    const run = await toTheWait(b);
    // (the scripted developer writes into node_modules, which then is a plain folder of the worktree)
    expect(isLink(join(run.worktree, 'node_modules'))).toBe(false);
    expect(existsSync(join(run.worktree, 'node_modules/.bin'))).toBe(false);
    expect(b.thread(run).filter((m) => (m.code ?? '').startsWith('runner.deps.'))).toEqual([]);
  });

  it('says once that the clone has no dependencies, and links them when they appear later', async () => {
    const repo = makeRepo();
    const b = await boot({ repo, configure: withWait });
    script(b);
    b.engine.script('developer', async (_c, tools, n) => {
      await tools.write('src/feature.ts', `export const feature = ${n};\n`);
      return work(`Done ${n}.`, { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    const run = await toTheWait(b);
    const none = b.thread(run).filter((m) => m.code === 'runner.deps.none');
    expect(none).toHaveLength(1);
    expect(messageText(none[0])).toContain('QA may not be able to run the tests');

    b.runner.sendBack(run.id, '', 'Again.');
    await b.settle();
    expect(b.thread(run).filter((m) => m.code === 'runner.deps.none')).toHaveLength(1);

    // the person installs in the clone; the next stage that runs commands gets the link
    mkdirSync(join(repo.clone, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(repo.clone, '.git/info/exclude'), 'node_modules/\n');
    b.runner.sendBack(run.id, '', 'Once more.');
    await b.settle();
    // the exclude file of the clone is shared by its worktrees, so the folder is ignored in the worktree too
    expect(isLink(join(run.worktree, 'node_modules'))).toBe(true);
    expect(b.thread(run).filter((m) => m.code === 'runner.deps.linked')).toHaveLength(1);
  });
});
