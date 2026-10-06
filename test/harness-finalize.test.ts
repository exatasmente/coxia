import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redact } from '../src/main/errorlog-core';
import { STAMP_SUMMARY, finalizeHarness, stampHarness, stampText } from '../src/main/harness/finalize';
import { messageText } from '../src/shared/forum';
import { checkText, rewriteLocal } from '../src/shared/runs/comment';
import { git } from './helpers/conflictRepos';
import { boot, doc, fakeEngine, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

// The text check and the stamp of the documentation a pass wrote: pure pieces first, then a real run with the fake engine (never a model).
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];
const HASH = '0123456789abcdef0123456789abcdef01234567';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })));

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cerimonias-finalize-'));
  roots.push(dir);
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}
const put = (dir: string, rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const commitAll = (dir: string): void => {
  spawnSync('git', [...ID, 'add', '-A'], { cwd: dir });
  spawnSync('git', [...ID, 'commit', '-q', '--no-verify', '-m', 'x'], { cwd: dir });
};
const file = (header: string[], body: string): string => ['---', `checked-commit: ${HASH}`, 'checked-date: 2026-10-01', ...header, '---', '', body].join('\n');

describe('rewriteLocal, the part of checkText that only rewrites', () => {
  const o = { worktree: '/tmp/work/wt', redact: (t: string) => redact(t, '/home/nobody') };

  it('turns a path of the worktree into one of the repository, keeps the last name of any other, and masks a credential', () => {
    const r = rewriteLocal('See /tmp/work/wt/src/a.ts and /var/lib/other/file.txt, key sk-abcdefgh12345678.', o);
    expect(r.body).toBe('See src/a.ts and file.txt, key [key].');
    expect(r.paths).toBe(2);
    expect(r.secret).toBe(true);
  });

  it('says nothing was masked when nothing was, and leaves the words alone', () => {
    const r = rewriteLocal('We never say "I" in a comment, but a document may: Claude Code is named here.', o);
    expect(r).toEqual({ body: 'We never say "I" in a comment, but a document may: Claude Code is named here.', paths: 0, secret: false });
  });

  it('is what checkText does first: the same body and the same two counts', () => {
    const raw = 'Wrote /tmp/work/wt/src/a.ts and ~/notes/x.md with sk-abcdefgh12345678.';
    const text = checkText(raw, { ...o, agentIds: [] });
    const r = rewriteLocal(raw, o);
    expect(text.body).toBe(r.body);
    expect(text.rewrites).toEqual([
      { code: 'localPath', count: r.paths },
      { code: 'secret', count: 1 },
    ]);
  });
});

describe('the text check of the documentation', () => {
  const o = (dir: string) => ({ redact: (t: string) => redact(t, '/home/nobody'), worktree: dir });

  it('rewrites the body and never the header, and counts what it found', async () => {
    const dir = repo();
    const body = `Defined in ${dir}/src/a.ts. Key: sk-abcdefgh12345678. Elsewhere: /var/lib/x/y.log.`;
    put(dir, '.coxia/rules/r.md', file(['evidence: [src/a.ts:1-3]'], body));
    const done = await finalizeHarness(dir, o(dir));
    expect(done.paths).toBe(2);
    expect(done.secrets).toBe(1);
    expect(done.rewritten).toEqual([{ file: '.coxia/rules/r.md', paths: 2, secrets: 1 }]);
    const text = readFileSync(join(dir, '.coxia/rules/r.md'), 'utf8');
    expect(text).toContain('Defined in src/a.ts. Key: [key]. Elsewhere: y.log.');
    // the hash of the header has 40 hexadecimal characters, which the masking of opaque strings would take for a secret
    expect(text).toContain(`checked-commit: ${HASH}`);
    expect(text).toContain('evidence: [src/a.ts:1-3]');
    expect(done.stamp).toEqual(['.coxia/rules/r.md']);
  });

  it('does not touch a header with a local path in it: the file is reported as invalid and not stamped', async () => {
    const dir = repo();
    put(dir, '.coxia/rules/bad.md', file(['evidence: [/home/someone/app/src/a.ts]'], 'Body.'));
    const done = await finalizeHarness(dir, o(dir));
    expect(readFileSync(join(dir, '.coxia/rules/bad.md'), 'utf8')).toContain('evidence: [/home/someone/app/src/a.ts]');
    expect(done.invalid).toEqual([{ file: '.coxia/rules/bad.md', reason: 'bad-evidence' }]);
    expect(done.stamp).toEqual([]);
    expect(done.rewritten).toEqual([]);
  });

  it('reports a file with no header at all, and checks its text', async () => {
    const dir = repo();
    put(dir, '.coxia/README.md', `Overview kept in ${dir}/docs/x.md.\n`);
    const done = await finalizeHarness(dir, o(dir));
    expect(done.invalid).toEqual([{ file: '.coxia/README.md', reason: 'no-header' }]);
    expect(readFileSync(join(dir, '.coxia/README.md'), 'utf8')).toBe('Overview kept in docs/x.md.\n');
    expect(done.stamp).toEqual([]);
  });

  it('looks only at the layout files the pass changed: a file already committed, a file outside the layout and the folder of the run are left alone', async () => {
    const dir = repo();
    put(dir, '.coxia/rules/old.md', file(['evidence: [src/a.ts]'], 'Old /var/lib/x/y.log.'));
    commitAll(dir);
    put(dir, '.coxia/rules/new.md', file(['evidence: [src/a.ts]'], 'New.'));
    put(dir, '.coxia/notes.txt', 'Outside the layout /var/lib/x/y.log.');
    put(dir, '.coxia/.run/memory.md', 'Folder of the run /var/lib/x/y.log.');
    put(dir, '.coxia/rules/sub/deep.md', file([], 'Too deep /var/lib/x/y.log.'));
    const done = await finalizeHarness(dir, o(dir));
    expect(done.stamp).toEqual(['.coxia/rules/new.md']);
    expect(done.rewritten).toEqual([]);
    expect(readFileSync(join(dir, '.coxia/rules/old.md'), 'utf8')).toContain('/var/lib/x/y.log');
    expect(readFileSync(join(dir, '.coxia/notes.txt'), 'utf8')).toContain('/var/lib/x/y.log');
  });

  it('skips a file that is a symbolic link, reports it, and neither reads nor rewrites what it points to', async () => {
    const dir = repo();
    const elsewhere = mkdtempSync(join(tmpdir(), 'cerimonias-finalize-out-'));
    roots.push(elsewhere);
    const target = join(elsewhere, 'private.md');
    writeFileSync(target, file(['evidence: [src/a.ts]'], 'Private /var/lib/x/y.log and sk-abcdefgh12345678.'));
    mkdirSync(join(dir, '.coxia/rules'), { recursive: true });
    symlinkSync(target, join(dir, '.coxia/rules/linked.md'));
    put(dir, '.coxia/rules/real.md', file(['evidence: [src/a.ts]'], 'Real.'));
    const done = await finalizeHarness(dir, o(dir));
    expect(done.skipped).toEqual(['.coxia/rules/linked.md']);
    expect(done.stamp).toEqual(['.coxia/rules/real.md']);
    expect(done.rewritten).toEqual([]);
    expect(readFileSync(target, 'utf8')).toContain('/var/lib/x/y.log and sk-abcdefgh12345678');
  });

  it('finds nothing in a repository with no documentation folder', async () => {
    const dir = repo();
    put(dir, 'src/a.ts', 'x\n');
    expect(await finalizeHarness(dir, o(dir))).toEqual({ rewritten: [], paths: 0, secrets: 0, invalid: [], skipped: [], stamp: [] });
  });
});

describe('the stamp', () => {
  const A = 'a'.repeat(40);

  it('sets the commit and the date in the header and nothing else', () => {
    const text = file(['evidence: [src/a.ts]', 'summary: one line'], 'Body line.\n');
    const next = stampText(text, A, '2026-10-06') as string;
    expect(next).toBe(['---', `checked-commit: ${A}`, 'checked-date: 2026-10-06', 'evidence: [src/a.ts]', 'summary: one line', '---', '', 'Body line.', ''].join('\n'));
    expect(stampText('no header here', A, '2026-10-06')).toBeNull();
    expect(stampText('---\nchecked-commit: abc1234\n---\nbody', A, '2026-10-06')).toBeNull();
  });

  it('writes the stamp into the files it is given, and says which ones it changed', async () => {
    const dir = repo();
    put(dir, '.coxia/rules/r.md', file(['evidence: [src/a.ts]'], 'Body.'));
    put(dir, '.coxia/rules/plain.md', 'no header');
    const changed = await stampHarness(dir, ['.coxia/rules/r.md', '.coxia/rules/plain.md', '.coxia/rules/missing.md'], A, () => new Date('2026-10-06T23:59:00Z'));
    expect(changed).toEqual(['.coxia/rules/r.md']);
    expect(readFileSync(join(dir, '.coxia/rules/r.md'), 'utf8')).toContain(`checked-commit: ${A}\nchecked-date: 2026-10-06\n`);
    expect(readFileSync(join(dir, '.coxia/rules/plain.md'), 'utf8')).toBe('no header');
  });

  it('does not stamp through a symbolic link', async () => {
    const dir = repo();
    const elsewhere = mkdtempSync(join(tmpdir(), 'cerimonias-finalize-out-'));
    roots.push(elsewhere);
    const target = join(elsewhere, 'other.md');
    const original = file(['evidence: [src/a.ts]'], 'Not ours.');
    writeFileSync(target, original);
    mkdirSync(join(dir, '.coxia/rules'), { recursive: true });
    symlinkSync(target, join(dir, '.coxia/rules/linked.md'));
    expect(await stampHarness(dir, ['.coxia/rules/linked.md'], A, () => new Date('2026-10-06T00:00:00Z'))).toEqual([]);
    expect(readFileSync(target, 'utf8')).toBe(original);
  });
});

describe('in a run', () => {
  const today = (): string => new Date().toISOString().slice(0, 10);

  async function ran(body: (call: { write: (p: string, c: string) => Promise<string | null> }) => Promise<void>) {
    const b = await boot({ engine: fakeEngine() });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan it.' }));
    b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
    b.engine.script('developer', async (_c, tools) => {
      await tools.write('src/feature.ts', 'export const feature = 1;\n');
      await body(tools);
      return work('Done.', { commit: 'add the feature', artifacts: [doc('3_IMPLEMENTATION.md')] });
    });
    b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
    b.engine.script('qa', () => work('Passes.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [{ name: 's', result: 'pass', detail: '' }] }));
    let run = await b.runner.start('app#101');
    for (let i = 0; i < 20; i++) {
      await b.settle();
      run = b.runner.get(run.id)!;
      if (run.status === 'gate') b.runner.gate(run.id, 'approve');
      else if (run.stage === 'ready' && run.status !== 'working') break;
    }
    return { b, run };
  }

  it('rewrites the text before the commit, stamps what the pass changed in a second commit, and says what it rewrote', async () => {
    const before = today();
    const { b, run } = await ran(async (tools) => {
      await tools.write('.coxia/rules/feature.md', file(['evidence: [src/feature.ts]'], 'Lives in /var/lib/someone/app/src/feature.ts.'));
      await tools.write('.coxia/README.md', 'Overview with no header.');
    });
    expect(run.status).toBe('done');
    const log = git(run.worktree, 'log', '--format=%H%x09%an%x09%ae%x09%s').split('\n').map((l) => l.split('\t'));
    const stamp = log.find((l) => l[3].includes(STAMP_SUMMARY));
    const work = log.find((l) => l[3] === 'feat: add the feature #101');
    expect(stamp?.[3]).toBe(`feat: ${STAMP_SUMMARY} #101`);
    expect(stamp?.[2]).toBe('runner@example.test');
    // the stamp is the commit right after the one that holds the work
    expect(log[log.indexOf(stamp as string[]) + 1]).toEqual(work);
    expect(log.filter((l) => l[3].includes(STAMP_SUMMARY))).toHaveLength(1);

    // the commit of the work already has the text rewritten, with the header the agent wrote
    const atWork = git(run.worktree, 'show', `${work?.[0]}:.coxia/rules/feature.md`);
    expect(atWork).toContain('Lives in feature.ts.');
    expect(atWork).toContain(`checked-commit: ${HASH}`);
    // the stamp says it was checked against that commit, today
    const head = git(run.worktree, 'show', 'HEAD:.coxia/rules/feature.md');
    expect(head).toContain(`checked-commit: ${work?.[0]}`);
    expect(head).toMatch(/checked-date: (\d{4}-\d{2}-\d{2})/);
    expect([before, today()]).toContain(/checked-date: (\d{4}-\d{2}-\d{2})/.exec(head)?.[1]);
    expect(head).toContain('evidence: [src/feature.ts]');
    // a file with no header is not stamped
    expect(git(run.worktree, 'show', 'HEAD:.coxia/README.md')).toBe('Overview with no header.');
    expect(git(run.worktree, 'show', '--stat', '--format=', stamp?.[0] ?? '')).not.toContain('README');

    const lines = b.thread(run).filter((m) => m.code?.startsWith('runner.docs.'));
    expect(lines.map((m) => m.code)).toEqual(['runner.docs.checked', 'runner.docs.invalidHeader']);
    expect(lines[0].params).toMatchObject({ paths: 1, secrets: 0, files: '.coxia/rules/feature.md' });
    expect(messageText(lines[0])).toContain('1 caminho(s) local(is) reescrito(s)');
    expect(lines[1].params).toMatchObject({ file: '.coxia/README.md', reason: 'no-header' });
  });

  it('adds no commit and no line to a run that wrote no documentation', async () => {
    const { b, run } = await ran(async () => undefined);
    expect(run.status).toBe('done');
    expect(git(run.worktree, 'log', '--format=%s')).not.toContain(STAMP_SUMMARY);
    expect(b.thread(run).filter((m) => m.code?.startsWith('runner.docs.'))).toEqual([]);
  });

  it('says nothing when the text needed no rewriting, but still stamps the file', async () => {
    const { b, run } = await ran(async (tools) => {
      await tools.write('.coxia/rules/feature.md', file(['evidence: [src/feature.ts]'], 'Nothing local here.'));
    });
    expect(git(run.worktree, 'log', '--format=%s')).toContain(`feat: ${STAMP_SUMMARY} #101`);
    expect(b.thread(run).filter((m) => m.code === 'runner.docs.checked')).toEqual([]);
  });
});
