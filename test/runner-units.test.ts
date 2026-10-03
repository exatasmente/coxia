import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { ForumMessage } from '../src/shared/forum';
import { CYCLES_DIR, cycleFolderOf, issueRecord, readFolder, slugOf, tidyArtifact, writeArtifact, writeIssueRecord } from '../src/main/runner/cycleFolder';
import { pendingAnswer, pendingHandoff } from '../src/main/runner/executor';
import { WorktreeError, branchDiff, branchStat, commitAll, commitIdentity, commitMessage, commitSummary, createWorktree, looksEnglish, declaredCommands, defaultBranch, headSha, repoIdentity } from '../src/main/runner/git';
import { fence, threadText } from '../src/main/runner/prompt';
import { MACHINE, git, withMachineIdentity } from './helpers/conflictRepos';
import { comment, issue, makeRepo } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

describe('names of branches and folders', () => {
  it('makes a slug of lowercase ASCII words from any title', () => {
    expect(slugOf('Add the Thing!')).toBe('add-the-thing');
    expect(slugOf('Corrigir exportação com acentos (urgente)')).toBe('corrigir-exportacao-com-acentos-urgente');
    expect(slugOf('  --  ')).toBe('issue');
    expect(slugOf('日本語')).toBe('issue');
    expect(slugOf('a'.repeat(100))).toHaveLength(40);
    expect(slugOf('x'.repeat(39) + ' y z')).toBe('x'.repeat(39));
    expect(slugOf('../../etc/passwd')).toBe('etc-passwd');
    expect(cycleFolderOf(101, 'Add the Thing')).toBe(`${CYCLES_DIR}/101-add-the-thing`);
  });
});

describe('the issue as a document', () => {
  it('has the facts, the description and the human comments, and masks what looks like a credential', () => {
    setLanguage('en');
    const text = issueRecord(issue(7, { body: 'Use the token: ghp_abcdefghijklmnopqrstuvwxyz0123456789 to log in.', labels: ['bug', 'coxia'] }), [comment('ana', 'Seen on staging.'), comment('bot', 'label changed', true)], 'app#7');
    expect(text).toMatch(/^# app#7 Add the thing 7\n/);
    expect(text).toContain('- Labels: bug, coxia');
    expect(text).toContain('## Description');
    expect(text).toContain('### ana, 2026-10-01T10:00:00Z');
    expect(text).toContain('Seen on staging.');
    expect(text).not.toContain('label changed');
    expect(text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(issueRecord(issue(8, { body: null }), [], 'app#8')).toContain('(no description)');
    expect(issueRecord(issue(8, { body: null }), [], 'app#8')).toContain('(no comments)');
    setLanguage('pt-BR');
  });
});

describe('the cycle folder', () => {
  const wt = () => mkdtempSync(join(tmpdir(), 'cycle-folder-'));

  it('writes documents with a final newline, reads the issue first and the documents in name order', () => {
    const dir = wt();
    writeIssueRecord(dir, 'docs/cycles/1-x', '# issue');
    writeArtifact(dir, 'docs/cycles/1-x', '2_PLAN.md', 'plan');
    writeArtifact(dir, 'docs/cycles/1-x', '1_SPEC.md', 'spec\n');
    expect(readFileSync(join(dir, 'docs/cycles/1-x/2_PLAN.md'), 'utf8')).toBe('plan\n');
    expect(readFolder(dir, 'docs/cycles/1-x').map((f) => f.name)).toEqual(['0_ISSUE.md', '1_SPEC.md', '2_PLAN.md']);
    expect(readFolder(dir, 'docs/cycles/missing')).toEqual([]);
  });

  it('refuses a name that is a path, and writing through a link that leaves the worktree', () => {
    const dir = wt();
    const out = mkdtempSync(join(tmpdir(), 'cycle-out-'));
    for (const name of ['../x.md', 'a/b.md', '.hidden', '', 'x'.repeat(101)]) expect(() => writeArtifact(dir, 'docs/cycles/1-x', name, 'x'), name).toThrow();
    mkdirSync(join(dir, 'docs/cycles'), { recursive: true });
    symlinkSync(out, join(dir, 'docs/cycles/1-x'));
    expect(() => writeArtifact(dir, 'docs/cycles/1-x', '1_SPEC.md', 'x')).toThrow(/refused/);
    expect(existsSync(join(out, '1_SPEC.md'))).toBe(false);
  });

  it('cuts a long file and says it was cut, and stops reading when the folder is large', () => {
    const dir = wt();
    mkdirSync(join(dir, 'f'));
    for (const n of ['1_A.md', '2_B.md', '3_C.md', '4_D.md', '5_E.md']) writeFileSync(join(dir, 'f', n), 'x'.repeat(50_000));
    const files = readFolder(dir, 'f');
    expect(files[0]).toMatchObject({ name: '1_A.md', clipped: true });
    expect(files[0].text).toHaveLength(30_000);
    expect(files.length).toBe(4);
  });
});

describe('git, as the runner uses it', () => {
  it('finds the default branch, makes a worktree on a new branch from it, and records where it started', async () => {
    const repo = makeRepo();
    expect(await defaultBranch(repo.clone)).toBe('main');
    const made = await createWorktree({ clone: repo.clone, dest: join(repo.worktrees, 'app', '1-x'), branch: 'cycle/1-x' });
    expect(made.baseSha).toBe(git(repo.clone, 'rev-parse', 'main'));
    expect(git(join(repo.worktrees, 'app', '1-x'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('cycle/1-x');
    expect(git(repo.clone, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('refuses a branch or a folder that exists, in a way the service can say', async () => {
    const repo = makeRepo();
    git(repo.clone, 'branch', 'cycle/2-y');
    await expect(createWorktree({ clone: repo.clone, dest: join(repo.worktrees, 'a'), branch: 'cycle/2-y' })).rejects.toMatchObject({ code: 'branch-exists' });
    mkdirSync(join(repo.worktrees, 'b'), { recursive: true });
    await expect(createWorktree({ clone: repo.clone, dest: join(repo.worktrees, 'b'), branch: 'cycle/3-z' })).rejects.toBeInstanceOf(WorktreeError);
    await expect(createWorktree({ clone: repo.clone, dest: join(repo.worktrees, 'c'), branch: 'bad..ref' })).rejects.toThrow(/invalid ref/);
    await expect(createWorktree({ clone: repo.origin, dest: join(repo.worktrees, 'd'), branch: 'cycle/4-w' })).rejects.toMatchObject({ code: 'not-worktree' });
  });

  it('commits as the identity it is given, with the hooks of the repository switched off', async () => {
    const repo = makeRepo();
    const dest = join(repo.worktrees, 'app', '1-x');
    await createWorktree({ clone: repo.clone, dest, branch: 'cycle/1-x' });
    // a hook of the repository (a tracked or an edited one would be the same): it must not run on the app's commit
    const hook = join(repo.clone, '.git/hooks/pre-commit');
    writeFileSync(hook, `#!/bin/sh\ntouch "${join(repo.root, 'hook-ran')}"\nexit 1\n`);
    chmodSync(hook, 0o755);
    writeFileSync(join(dest, 'src/new.ts'), 'export {};\n');
    const sha = await commitAll(dest, 'feat: add a file #1', { name: 'Runner', email: 'runner@example.test' });
    expect(sha).toBe(git(dest, 'rev-parse', 'HEAD'));
    expect(existsSync(join(repo.root, 'hook-ran'))).toBe(false);
    expect(git(dest, 'log', '-1', '--format=%an|%ae|%cn|%ce|%s')).toBe('Runner|runner@example.test|Runner|runner@example.test|feat: add a file #1');
    expect(await commitAll(dest, 'feat: nothing #1', { name: 'Runner', email: 'runner@example.test' })).toBeNull();
    // and nothing was written to a git config
    expect(readFileSync(join(repo.clone, '.git/config'), 'utf8')).not.toContain('Runner');
  });

  it('reads the identity a repository has, and nothing when it has none', async () => {
    const repo = makeRepo();
    expect(await repoIdentity(repo.clone)).toBeNull();
    writeFileSync(join(repo.clone, '.git/config'), `${readFileSync(join(repo.clone, '.git/config'), 'utf8')}[user]\n\tname = Owner\n\temail = owner@example.test\n`);
    expect(await repoIdentity(repo.clone)).toEqual({ name: 'Owner', email: 'owner@example.test' });
  });

  it('commits as the runner\'s identity, else the repository\'s own, and never as the one the machine has', async () => {
    const repo = makeRepo();
    const none = { name: '', email: '' };
    await withMachineIdentity(async () => {
      // the global config and the environment name someone: that is not an identity of the repository, and the app does not commit as it
      expect(await repoIdentity(repo.clone)).toBeNull();
      expect(await commitIdentity(none, repo.clone)).toBeNull();
      expect(await commitIdentity({ name: ' Runner ', email: ' runner@example.test ' }, repo.clone)).toEqual({ name: 'Runner', email: 'runner@example.test' });
      writeFileSync(join(repo.clone, '.git/config'), `${readFileSync(join(repo.clone, '.git/config'), 'utf8')}[user]\n\tname = Owner\n\temail = owner@example.test\n`);
      expect(await commitIdentity(none, repo.clone)).toEqual({ name: 'Owner', email: 'owner@example.test' });
      expect(await commitIdentity({ name: 'Runner', email: 'runner@example.test' }, repo.clone)).toEqual({ name: 'Runner', email: 'runner@example.test' });

      const dest = join(repo.worktrees, 'app', '1-x');
      await createWorktree({ clone: repo.clone, dest, branch: 'cycle/1-x' });
      writeFileSync(join(dest, 'src/new.ts'), 'export {};\n');
      await commitAll(dest, 'feat: add a file #1', { name: 'Runner', email: 'runner@example.test' });
      expect(git(dest, 'log', '-1', '--format=%an|%ae|%cn|%ce')).toBe('Runner|runner@example.test|Runner|runner@example.test');
      writeFileSync(join(dest, 'src/other.ts'), 'export {};\n');
      await expect(commitAll(dest, 'feat: add another #1', none)).rejects.toThrow(/name and an email/);
      expect(git(dest, 'log', '--format=%ae|%ce')).not.toContain(MACHINE.email);
    });
  });

  it('gives the branch\'s diff without the cycle folder, and its summary', async () => {
    const repo = makeRepo();
    const dest = join(repo.worktrees, 'app', '1-x');
    const made = await createWorktree({ clone: repo.clone, dest, branch: 'cycle/1-x' });
    mkdirSync(join(dest, 'docs/cycles/1-x'), { recursive: true });
    writeFileSync(join(dest, 'docs/cycles/1-x/1_SPEC.md'), 'spec\n');
    writeFileSync(join(dest, 'src/app.ts'), 'export const app = 2;\n');
    await commitAll(dest, 'feat: work #1', { name: 'R', email: 'r@example.test' });
    const diff = await branchDiff(dest, made.baseSha, 'docs/cycles/1-x');
    expect(diff).toContain('+export const app = 2;');
    expect(diff).not.toContain('1_SPEC');
    expect(await branchStat(dest, made.baseSha, 'docs/cycles/1-x')).toContain('src/app.ts');
    expect(await branchDiff(dest, null, 'docs')).toBe('');
    expect(await headSha(dest)).toBe(git(dest, 'rev-parse', 'HEAD'));
  });

  it('does not run a diff program or a text conversion the repository configures', async () => {
    const repo = makeRepo();
    const dest = join(repo.worktrees, 'app', '1-x');
    const made = await createWorktree({ clone: repo.clone, dest, branch: 'cycle/1-x' });
    const marker = join(repo.root, 'textconv-ran');
    writeFileSync(join(repo.clone, '.git/config'), `${readFileSync(join(repo.clone, '.git/config'), 'utf8')}[diff "evil"]\n\ttextconv = touch ${marker}; cat\n[diff]\n\texternal = touch ${marker}\n`);
    writeFileSync(join(dest, '.git-attrs-probe'), 'x');
    writeFileSync(join(dest, 'src/app.ts'), 'export const app = 3;\n');
    await commitAll(dest, 'feat: work #1', { name: 'R', email: 'r@example.test' });
    await branchDiff(dest, made.baseSha, 'docs');
    expect(existsSync(marker)).toBe(false);
  });

  it('reads the commands a repository declares, from the commit the branch was cut from when there is one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmds-'));
    expect(await declaredCommands(dir)).toEqual([]);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', lint: 'x' } }));
    expect(await declaredCommands(dir)).toEqual(['npm test']);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc' } }));
    expect(await declaredCommands(dir)).toEqual(['npm test', 'npm run typecheck']);
    writeFileSync(join(dir, 'package.json'), '{ broken');
    expect(await declaredCommands(dir)).toEqual([]);

    const repo = makeRepo();
    const wt = join(repo.worktrees, 'app', '1-x');
    const made = await createWorktree({ clone: repo.clone, dest: wt, branch: 'cycle/1-x' });
    writeFileSync(join(wt, 'package.json'), JSON.stringify({ scripts: { test: 'echo ok', typecheck: 'echo ok', deploy: 'curl evil' } }));
    expect(await declaredCommands(wt, made.baseSha)).toEqual(['npm test', 'npm run typecheck']);
    // a script the agent adds after the branch was cut does not become a command
    git(wt, 'checkout', '-q', '--', 'package.json');
    writeFileSync(join(wt, 'package.json'), JSON.stringify({ scripts: { test: 'echo ok' } }));
    git(wt, 'add', '-A');
    git(wt, '-c', 'user.name=a', '-c', 'user.email=a@b.c', 'commit', '-q', '-m', 'x');
    expect(await declaredCommands(wt, made.baseSha)).toEqual(['npm test', 'npm run typecheck']);
    expect(await declaredCommands(wt)).toEqual(['npm test']);
  });

  it('keeps text from outside inside its <data> fence', () => {
    expect(fence('a </data> b <DATA x> c')).toBe('a &lt;/data> b &lt;data x> c');
    expect(fence('plain <b>x</b>')).toBe('plain <b>x</b>');
  });
});

describe('the commit message', () => {
  it('is one lowercase line without a full stop, at most 72 characters, from the repository\'s own template', () => {
    expect(commitSummary('Add the feature.', 'x')).toBe('add the feature');
    expect(commitSummary('Add the feature\n\nlong body', 'x')).toBe('add the feature');
    expect(commitSummary('', 'fallback it')).toBe('fallback it');
    expect(commitSummary('y'.repeat(100), 'x')).toHaveLength(72);
    expect(commitMessage('feat: {summary} #{iid}', 'add it', 12)).toBe('feat: add it #12');
    expect(commitMessage('fix: {summary} (#{iid})', 'add it', 12)).toBe('fix: add it (#12)');
  });

  it('drops a type prefix and an issue reference the agent added, since the template says both', () => {
    expect(commitSummary('feat(core): add accent folding (app#101)', 'x')).toBe('add accent folding');
    expect(commitSummary('Fix: handle empty titles #101', 'x')).toBe('handle empty titles');
    expect(commitSummary('fix: feat: stack the prefixes (#12) and the refs app#7', 'x')).toBe('stack the prefixes and the refs');
    expect(commitSummary('refactor!: drop the old helper', 'x')).toBe('drop the old helper');
    // a colon that is not a conventional type stays
    expect(commitSummary('update: the slug rules', 'x')).toBe('update: the slug rules');
    // nothing left of it
    expect(commitSummary('feat: #101', 'use the fallback')).toBe('use the fallback');
  });

  it('falls back when the summary is not English: accents, or Portuguese words in plain letters', () => {
    expect(commitSummary('corrige a remoção de acentos', 'the fallback')).toBe('the fallback');
    expect(commitSummary('corrige a geracao do slug para titulos', 'the fallback')).toBe('the fallback');
    expect(commitSummary('fix the slug for “quoted” titles', 'the fallback')).toBe('the fallback');
    expect(looksEnglish('add accent folding to the slug')).toBe(true);
    expect(looksEnglish('do not strip hyphens')).toBe(true);
    expect(looksEnglish('###')).toBe(false);
  });

  it('never carries the attribution of a tool, whatever the agent wrote', () => {
    for (const bad of ['Co-Authored-By: Someone', 'add it, generated with a tool', 'fix by Claude', 'AI-generated change', 'ask anthropic']) expect(commitSummary(bad, 'safe summary')).toBe('safe summary');
  });
});

const msg = (seq: number, m: Partial<ForumMessage>): ForumMessage => ({ v: 1, type: 'message', seq, thread: 'run-x', at: '2026-10-03T10:00:00Z', kind: 'post', author: { type: 'person' }, text: '', code: null, params: {}, mentions: [], refs: [], stage: null, to: null, replyTo: null, public: false, published: null, ...m });
const agent = (id: string) => ({ type: 'agent', id }) as const;

describe('what an agent is given from the thread', () => {
  it('reads the thread as lines, leaving the bookkeeping of the app out', () => {
    setLanguage('en');
    const text = threadText([msg(1, { kind: 'system', author: { type: 'app' }, code: 'run.started' }), msg(2, { kind: 'post', author: agent('refiner'), text: 'Spec written.' }), msg(3, { kind: 'question', author: agent('planner'), text: 'Which?' }), msg(4, { kind: 'answer', text: 'This one.' })]);
    expect(text).toBe('#2 refiner (post): Spec written.\n#3 planner (question): Which?\n#4 person (answer): This one.');
    expect(threadText([msg(1, { text: 'x'.repeat(5000) })]).length).toBeLessThan(1600);
    setLanguage('pt-BR');
  });

  it('finds the last note left for the agent that it has not reported on since', () => {
    const thread = [msg(1, { kind: 'handoff', author: agent('refiner'), to: 'planner', text: 'old note' }), msg(2, { kind: 'post', author: agent('planner'), text: 'planned' }), msg(3, { kind: 'handoff', author: { type: 'person' }, to: 'planner', text: 'redo it' })];
    expect(pendingHandoff(thread, 'planner')).toEqual({ from: 'person', text: 'redo it' });
    expect(pendingHandoff(thread.slice(0, 2), 'planner')).toBeNull();
    expect(pendingHandoff(thread, 'developer')).toBeNull();
  });

  it('finds the answer to the agent\'s last question in the stage, until the agent reports', () => {
    const asked = msg(1, { kind: 'question', author: agent('planner'), text: 'Which?', stage: 'plan' });
    expect(pendingAnswer([asked], 'planner', 'plan')).toBeNull();
    const answered = [asked, msg(2, { kind: 'answer', text: 'This one.', stage: 'plan' })];
    expect(pendingAnswer(answered, 'planner', 'plan')).toEqual({ question: 'Which?', text: 'This one.', by: expect.any(String) });
    expect(pendingAnswer(answered, 'planner', 'refine')).toBeNull();
    expect(pendingAnswer([...answered, msg(3, { kind: 'post', author: agent('planner'), text: 'ok' })], 'planner', 'plan')).toBeNull();
  });
});

describe('a document of a stage, tidied', () => {
  const issue_ = { ref: 'app#101', title: 'slugify does not strip accents' };

  it('loses the reference and the title of the issue in its heading, and the facts the issue record already has under it', () => {
    const doc = ['# Functional specification — app#101 slugify does not strip accents', '', '- Address: https://example.com/group/project/issues/101', '- Author: ana', '- Labels: bug', '- Type: bug', '- Proposed priority: P1', '', '## What is asked', '', 'Strip them.'].join('\n');
    expect(tidyArtifact(doc, issue_)).toBe(['# Functional specification', '', '- Type: bug', '- Proposed priority: P1', '', '## What is asked', '', 'Strip them.'].join('\n'));
    // the same in the other language of the app
    const pt = ['# Especificação funcional — app#101 slugify does not strip accents', '', '- Endereço: https://example.com/group/project/issues/101', '- Estado: open', '- Autor: ana', '', '## O que se pede', '', 'x'].join('\n');
    expect(tidyArtifact(pt, issue_)).toBe(['# Especificação funcional', '', '## O que se pede', '', 'x'].join('\n'));
  });

  it('takes the internal reference out of a title that says something of its own, keeping the rest', () => {
    expect(tidyArtifact('# Release note — app#101: addresses made from the title\n\nBody.', issue_)).toBe('# Release note — addresses made from the title\n\nBody.');
    expect(tidyArtifact('# Note (app#101) addresses\n\nBody.', issue_)).toBe('# Note addresses\n\nBody.');
    expect(tidyArtifact('# app#101\n\nBody.', issue_)).toBe('# app#101\n\nBody.');
  });

  it('leaves a document alone when it has none of that: a title of its own, a list that is something else, text with no heading', () => {
    const plain = '# Test plan\n\n- Scenario one\n- Scenario two\n\nSee app#101 for the origin.';
    expect(tidyArtifact(plain, issue_)).toBe(plain);
    expect(tidyArtifact('no heading, app#101\n- Author: ana', issue_)).toBe('no heading, app#101\n- Author: ana');
    expect(tidyArtifact('', issue_)).toBe('');
    // an author in the body, after other text, is the document's own
    expect(tidyArtifact('# Review\n\nText first.\n\n- Author: ana', issue_)).toBe('# Review\n\nText first.\n\n- Author: ana');
  });
});
