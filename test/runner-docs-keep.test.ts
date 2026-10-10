import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { Run } from '../src/shared/runs';
import { git } from './helpers/conflictRepos';
import { type Boot, type Repo, boot, doc, makeRepo, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { ATAS } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { harnessSection } = await import('../src/main/harness/deliver');

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const dir of ['runs', 'forum']) rmSync(join(ATAS, dir), { recursive: true, force: true });
});

const CONTENT = '# Project instructions\n\nUse the shared theme tokens.\n';

function documentedRepo(): Repo {
  const repo = makeRepo();
  const seed = join(repo.root, 'seed');
  writeFileSync(join(seed, 'AGENTS.md'), CONTENT);
  mkdirSync(join(seed, 'src'), { recursive: true });
  writeFileSync(join(seed, 'src/other.ts'), 'export const other = 1;\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'add universal instructions');
  git(seed, 'push', '-q', 'origin', 'main');
  return repo;
}

interface Seen {
  developer: { system: string; section: string; docs: { paths: string[]; stage: { id: string; kind: string } | null; repos: string[] } | undefined }[];
  reviewer: { system: string; prompt: string }[];
  qa: string[];
}

function script(b: Boot, develop?: (tools: { write(path: string, content: string): Promise<string | null> }) => Promise<void>): Seen {
  const seen: Seen = { developer: [], reviewer: [], qa: [] };
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md', '# Spec\n\nChange src/app.ts.\n'), doc('REQUIREMENTS.md')] }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md', '# Plan\n\nRun tests.\n'), doc('PROTOTYPE.md')] }));
  b.engine.script('developer', async (call, tools) => {
    const section = call.docs ? await harnessSection(call.docs, call.agent, { cwd: call.cwd }) : '';
    seen.developer.push({ system: call.system, section, docs: call.docs });
    if (develop) await develop(tools);
    else await tools.write('src/app.ts', 'export const app = 2;\n');
    return work('Built.', { commit: 'change the constant', artifacts: [doc('3_IMPLEMENTATION.md')] });
  });
  b.engine.script('reviewer', (call) => {
    seen.reviewer.push({ system: call.system, prompt: call.prompt });
    return work('Reviewed.', { artifacts: [doc('4_REVIEW.md')] });
  });
  b.engine.script('qa', (call) => {
    seen.qa.push(call.prompt);
    return work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')] });
  });
  return seen;
}

async function through(b: Boot, run: Run): Promise<Run> {
  for (let i = 0; i < 8; i++) {
    await b.settle();
    const current = b.runner.get(run.id) as Run;
    if (current.status !== 'gate') return current;
    b.runner.gate(run.id, 'approve', i === 0 ? 'Looks right.' : '');
  }
  return b.runner.get(run.id) as Run;
}

async function runIn(repo: Repo): Promise<{ run: Run; seen: Seen }> {
  const b = await boot({ dir: ATAS, repo, configure: (config) => (config.language = 'en') });
  const seen = script(b);
  const started = await b.runner.start('app#101');
  return { run: await through(b, started), seen };
}

describe('project instructions in code runs', () => {
  it('hands the root AGENTS.md to the implementation stage and asks it to keep those instructions true', async () => {
    const { run, seen } = await runIn(documentedRepo());
    expect(run.status).toBe('done');
    const first = seen.developer[0];
    expect(first.docs).toMatchObject({ stage: { id: 'implement', kind: 'development' } });
    expect(first.section).toContain('Project instructions (AGENTS.md)');
    expect(first.section).toContain('Use the shared theme tokens.');
    expect(first.system).toContain('This repository keeps universal project instructions in AGENTS.md.');
    expect(first.system).toContain('update AGENTS.md in the same change');
    expect(seen.reviewer[0].prompt).not.toContain('left behind');
  });

  it('adds no documentation section or maintenance instruction when AGENTS.md is absent', async () => {
    const { run, seen } = await runIn(makeRepo());
    expect(run.status).toBe('done');
    expect(seen.developer[0].section).toBe('');
    expect(seen.developer[0].system).not.toContain('keeps universal project instructions');
    expect(seen.reviewer[0].prompt).not.toContain('left behind');
  });
});

describe('AGENTS.md during a mention', () => {
  it('hands the same universal instructions to an agent called in a run', async () => {
    const b = await boot({ dir: ATAS, repo: documentedRepo(), configure: (config) => (config.language = 'en') });
    script(b);
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.runner.get(run.id)).toMatchObject({ status: 'gate', stage: 'gate1' });
    b.engine.script('developer', () => ({ text: 'The guidance is in AGENTS.md.' }));
    const [message] = b.forum.append(`run-${run.id}`, { kind: 'post', author: { type: 'person' }, text: '@developer where are the instructions?', mentions: ['developer'] });
    b.runner.onMessage(message);
    await b.settle();
    const call = b.engine.calls.filter((item) => item.agent.id === 'developer' && !item.confine && item.prompt.includes('called on you')).at(-1);
    if (!call?.docs) throw new Error('The mentioned agent did not receive repository instructions.');
    expect(call?.docs).toMatchObject({ repos: [run.worktree] });
    const section = await harnessSection(call.docs, { id: 'developer' }, { cwd: run.worktree });
    expect(section).toContain('Use the shared theme tokens.');
  });
});
