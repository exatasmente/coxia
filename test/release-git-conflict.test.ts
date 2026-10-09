// The worktree conflict of a release step: the early refusal before anything runs, the freeing of the branch from the worktree that holds it (and its refusals),
// and the guidance appended to the release script's refusals. Everything runs in real temporary repositories (test/helpers/releaseWorld.ts); no network, no host.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freeBranchCheckout, runReleaseOp, scriptFailGuidance } from '../src/main/releaseGit';
import { setLanguage, t } from '../src/shared/i18n';
import { type ReleaseUnit } from '../src/shared/release';
import { AUTHOR, Checkout, ReleaseWorld, cleanWorlds } from './helpers/releaseWorld';

vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  setLanguage('en');
});
afterAll(() => {
  setLanguage('pt-BR');
  cleanWorlds();
});

const unit = (over: Partial<ReleaseUnit> & Pick<ReleaseUnit, 'op'>): ReleaseUnit => ({ version: '0.5.0', ...over });
const run = (w: ReleaseWorld) => (u: ReleaseUnit) => runReleaseOp(u, { clone: w.dir, worktree: w.stepsDir, identity: AUTHOR, env: w.scriptEnv() });

/**
 * A world whose release branch is checked out in a second worktree (`person`), and where the run's own worktree was never made: the branch was opened once, that
 * worktree was given the branch after being released, and the steps of a run have not started yet.
 */
async function heldElsewhere(): Promise<{ w: ReleaseWorld; person: string }> {
  const w = new ReleaseWorld();
  const aux = join(w.root, 'aux');
  await runReleaseOp(unit({ op: 'open' }), { clone: w.dir, worktree: aux, identity: AUTHOR, env: w.scriptEnv() });
  w.git('worktree', 'remove', '--force', aux);
  const person = join(w.root, 'person');
  w.git('worktree', 'add', person, 'release/0.5.0');
  return { w, person };
}

describe('the worktree conflict of a step', () => {
  it('stops a beta before anything runs when the branch is checked out in another worktree, naming the branch and the path, and the worktree of the run is not made', async () => {
    const { w, person } = await heldElsewhere();
    const argv = w.argv().length;
    await expect(run(w)(unit({ op: 'beta' }))).rejects.toThrow(new RegExp(`checked out in ${person.replace(/[-\\/,]/g, (c) => `\\${c}`)}`));
    expect(existsSync(w.stepsDir)).toBe(false);
    // with everything refused, nothing else was asked of the repository
    expect(w.argv()).toHaveLength(argv);
    expect(w.git('worktree', 'list', '--porcelain')).toContain('branch refs/heads/release/0.5.0');
  });

  it('passes the branch only when it is free: the run\'s own worktree may hold it between steps, and the beta cuts like today', async () => {
    const w = new ReleaseWorld();
    await run(w)(unit({ op: 'open' }));
    // the worktree of the steps holds the release branch now, and the next step is not refused for it
    expect(w.steps.branch).toBe('release/0.5.0');
    w.steps.change('Added', 'a thing');
    const r = await run(w)(unit({ op: 'beta' }));
    expect(r.tag).toBe('v0.5.0-beta.1');
  });

  it('does not reach, in an open, the conflict of a branch that exists elsewhere, and keeps the refusal the branch already got', async () => {
    const { w } = await heldElsewhere();
    await expect(run(w)(unit({ op: 'open' }))).rejects.toThrow(/release\/0\.5\.0 already exists/);
  });

  it('does not reach, in a stable, the conflict either: the stable merges the branch without checking it out anywhere', async () => {
    const { w } = await heldElsewhere();
    // the stable needs its beta first: free the branch, cut the beta, and hold the branch somewhere else again; the stable is not affected
    await freeBranchCheckout(w.dir, 'release/0.5.0');
    await run(w)(unit({ op: 'beta' }));
    w.steps.git('push', '-q', 'origin', 'release/0.5.0');
    w.steps.git('push', '-q', 'origin', 'v0.5.0-beta.1');
    w.steps.git('switch', '--quiet', '--detach');
    const held = join(w.root, 'person-again');
    w.git('worktree', 'add', held, 'release/0.5.0');
    const r = await run(w)(unit({ op: 'stable' }));
    expect(r.tag).toBe('v0.5.0');
    expect(w.steps.branch).not.toBe('release/0.5.0');
  });
});

describe('freeing the branch from the worktree that holds it', () => {
  it('detaches the other worktree on the commit it was on and leaves the branch free', async () => {
    const { w, person } = await heldElsewhere();
    const at = w.git('rev-parse', 'release/0.5.0');
    expect(await freeBranchCheckout(w.dir, 'release/0.5.0')).toBe(person);
    const listing = w.git('worktree', 'list', '--porcelain');
    expect(listing).not.toContain('branch refs/heads/release/0.5.0');
    const other = new Checkout(person, w.env);
    // on the same commit, detached: nothing of the other worktree was moved away
    expect(other.git('rev-parse', 'HEAD')).toBe(at);
    expect(other.git('status', '--porcelain')).toBe('');
    expect(other.gitOk('symbolic-ref', '--short', 'HEAD')).toBe(false);
  });

  it('is silent, null, when the branch is already free (the person freed it by hand)', async () => {
    const { w, person } = await heldElsewhere();
    w.git('worktree', 'remove', '--force', person);
    expect(await freeBranchCheckout(w.dir, 'release/0.5.0')).toBeNull();
  });

  it('refuses a worktree with changes that are not committed, and frees nothing', async () => {
    const { w, person } = await heldElsewhere();
    writeFileSync(join(person, 'hers.txt'), 'a change she never committed');
    await expect(freeBranchCheckout(w.dir, 'release/0.5.0')).rejects.toThrow(/changes that are not committed/);
    expect(w.git('worktree', 'list', '--porcelain')).toContain('branch refs/heads/release/0.5.0');
  });

  it('refuses a registration whose folder is gone, instead of pruning or taking it over', async () => {
    const { w, person } = await heldElsewhere();
    rmSync(person, { recursive: true, force: true });
    await expect(freeBranchCheckout(w.dir, 'release/0.5.0')).rejects.toThrow(/is gone/);
    expect(w.git('worktree', 'list', '--porcelain')).toContain('branch refs/heads/release/0.5.0');
  });

  it('refuses a worktree of another repository at the path: only a worktree of the same repository is touched', async () => {
    const { w, person } = await heldElsewhere();
    // the folder is there and holds a checkout of its own, of another repository (its own git directory): the listing still says the branch is held here
    rmSync(join(person, '.git'), { recursive: true, force: true });
    spawnSync('git', ['init', '-q'], { cwd: person, env: w.env });
    await expect(freeBranchCheckout(w.dir, 'release/0.5.0')).rejects.toThrow(/is not the worktree of this release/);
    expect(w.git('worktree', 'list', '--porcelain')).toContain('branch refs/heads/release/0.5.0');
  });

  it('leaves nothing half-freed: after the freeing the branch is held by no worktree of the repository any more', async () => {
    const { w, person } = await heldElsewhere();
    expect(await freeBranchCheckout(w.dir, 'release/0.5.0')).toBe(person);
    // a second call has nothing to free, and frees nothing again
    expect(await freeBranchCheckout(w.dir, 'release/0.5.0', person)).toBeNull();
    const other = new Checkout(person, w.env);
    expect(other.git('rev-parse', 'HEAD')).toBe(w.git('rev-parse', 'release/0.5.0'));
    expect(other.gitOk('symbolic-ref', '--short', 'HEAD')).toBe(false);
  });
});

describe('the guidance on the refusals of the release script', () => {
  it('says for a tag that already exists that the version is cut and the next step is the one that sends it', () => {
    const detail = 'release: tag v0.5.0 already exists: 0.5.0 is released';
    expect(scriptFailGuidance(detail)).toBe(t('main.release.tagExistsNext'));
  });

  it('says for an empty [Unreleased] that the changes are described first, written by nobody else', () => {
    const detail = 'CHANGELOG.md: [Unreleased] is empty and there is no [0.5.0] section (nor a beta section to fold); describe the changes first';
    expect(scriptFailGuidance(detail)).toBe(t('main.release.unreleasedEmptyNext'));
  });

  it('adds nothing to the refusals it does not know (a branch that exists is refused earlier by the app itself)', () => {
    expect(scriptFailGuidance('release/0.5.0 already exists')).toBeNull();
    expect(scriptFailGuidance('exit 1')).toBeNull();
  });
});
