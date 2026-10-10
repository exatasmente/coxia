import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readOnlyFolders } from '../src/main/sandbox';
import { BROWSER_DIR, ProfileError, browserRoot, clearSingletons, createProfileLocks, deleteAllProfiles, deleteProfile, ensureProfile, isInsideProfiles, openProfile, profileDenyGlobs, profileDirOf, sweepProfiles } from '../src/main/browser/profile';

// The logged-in browser of an agent, on disk: where it lives, how it is protected, who may hold it, and what deletes it. Everything under a temporary folder; nothing
// here starts a browser or reads the app's data.

let ws: string;
let real: string;
beforeEach(() => {
  ws = join(realpathSync(mkdtempSync(join(tmpdir(), 'coxia-profile-'))), 'workspace');
  mkdirSync(ws);
  real = realpathSync(ws);
});
afterEach(() => rmSync(join(ws, '..'), { recursive: true, force: true }));

const mode = (path: string): number => statSync(path).mode & 0o777;

describe('making a profile', () => {
  it('makes the folder of the profiles and the one of the agent, 0700, and returns the real path', () => {
    const dir = ensureProfile(ws, 'scout');
    expect(dir).toBe(join(real, BROWSER_DIR, 'scout'));
    expect(mode(browserRoot(ws))).toBe(0o700);
    expect(mode(dir)).toBe(0o700);
    expect(ensureProfile(ws, 'scout')).toBe(dir);
  });

  it('tightens a folder that was made wider, and leaves what is in it alone', () => {
    const dir = ensureProfile(ws, 'scout');
    writeFileSync(join(dir, 'Preferences'), '{}');
    chmodSync(dir, 0o755);
    chmodSync(browserRoot(ws), 0o755);
    ensureProfile(ws, 'scout');
    expect(mode(dir)).toBe(0o700);
    expect(mode(browserRoot(ws))).toBe(0o700);
    expect(existsSync(join(dir, 'Preferences'))).toBe(true);
  });

  it('refuses an id that is not a plain agent id: it is a folder name', () => {
    for (const id of ['', '..', '../x', 'a/b', 'Scout', 'a b', '.hidden', 'x'.repeat(60)]) {
      expect(() => ensureProfile(ws, id), id).toThrow(ProfileError);
      expect(() => profileDirOf(ws, id), id).toThrow(ProfileError);
    }
    expect(existsSync(browserRoot(ws))).toBe(false);
  });

  it('refuses a link where the folder of the profiles or the profile should be, and follows none', () => {
    const elsewhere = join(ws, '..', 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, browserRoot(ws));
    expect(() => ensureProfile(ws, 'scout')).toThrowError(expect.objectContaining({ code: 'link' }));
    expect(readdirSync(elsewhere)).toEqual([]);
    rmSync(browserRoot(ws));
    mkdirSync(browserRoot(ws));
    symlinkSync(elsewhere, join(browserRoot(ws), 'scout'));
    expect(() => ensureProfile(ws, 'scout')).toThrowError(expect.objectContaining({ code: 'link' }));
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses a profile where a file is', () => {
    mkdirSync(browserRoot(ws));
    writeFileSync(join(browserRoot(ws), 'scout'), 'not a folder');
    expect(() => ensureProfile(ws, 'scout')).toThrowError(expect.objectContaining({ code: 'link' }));
  });

  it('follows a link in the way to the workspace folder to its real place, and keeps the profile out of the folders it is told to avoid', () => {
    const linked = join(ws, '..', 'linked');
    symlinkSync(ws, linked);
    expect(ensureProfile(linked, 'scout')).toBe(join(real, BROWSER_DIR, 'scout'));
    expect(() => ensureProfile(ws, 'scout', { avoid: [real] })).toThrowError(expect.objectContaining({ code: 'inside' }));
    expect(() => ensureProfile(ws, 'scout', { avoid: [linked] })).toThrowError(expect.objectContaining({ code: 'inside' }));
    expect(() => ensureProfile(ws, 'scout', { avoid: [join(ws, '..', 'somewhere-else')] })).not.toThrow();
  });

  it('refuses a workspace folder that is not there, and makes nothing', () => {
    const gone = join(ws, '..', 'gone');
    expect(() => ensureProfile(gone, 'scout')).toThrowError(expect.objectContaining({ code: 'create' }));
    expect(existsSync(gone)).toBe(false);
  });
});

describe('one session at a time', () => {
  it('gives the profile to the first and says who holds it to the second, until it is let go', () => {
    const locks = createProfileLocks();
    const dir = profileDirOf(ws, 'scout');
    const first = locks.acquire(dir, 'run:r1');
    expect(first.ok).toBe(true);
    expect(locks.holder(dir)).toBe('run:r1');
    expect(locks.acquire(dir, 'call:t1:scout')).toEqual({ ok: false, owner: 'run:r1' });
    if (first.ok) {
      first.lock.release();
      first.lock.release();
    }
    expect(locks.holder(dir)).toBeNull();
    expect(locks.acquire(dir, 'call:t1:scout').ok).toBe(true);
  });

  it('keeps the profile of one agent apart from another\'s, and tells the listeners once when one is let go', () => {
    const locks = createProfileLocks();
    const seen: string[] = [];
    const stop = locks.onRelease((d) => seen.push(d));
    const a = locks.acquire(profileDirOf(ws, 'scout'), 'k1');
    const b = locks.acquire(profileDirOf(ws, 'other'), 'k2');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok) {
      a.lock.release();
      a.lock.release();
    }
    expect(seen).toEqual([profileDirOf(ws, 'scout')]);
    stop();
    if (b.ok) b.lock.release();
    expect(seen).toHaveLength(1);
  });

  it('opens a profile: the lock, the folder and the marks of a dead browser taken off; busy for the second screen', () => {
    const locks = createProfileLocks();
    const dir = ensureProfile(ws, 'scout');
    symlinkSync('host-1234', join(dir, 'SingletonLock'));
    symlinkSync('/tmp/does-not-exist/SingletonSocket', join(dir, 'SingletonSocket'));
    symlinkSync('4567', join(dir, 'SingletonCookie'));
    writeFileSync(join(dir, 'Preferences'), '{}');
    const first = openProfile(ws, 'scout', 'run:r1', { locks });
    expect(first).toMatchObject({ ok: true, dir });
    expect(readdirSync(dir)).toEqual(['Preferences']);
    expect(openProfile(ws, 'scout', 'call:t1:scout', { locks })).toEqual({ ok: false, busy: true, owner: 'run:r1' });
    if (first.ok) first.release();
    // A crashed browser leaves its marks again; the lock was only in memory, so the next screen finds the profile free and clean.
    symlinkSync('host-9999', join(dir, 'SingletonLock'));
    const second = openProfile(ws, 'scout', 'call:t1:scout', { locks });
    expect(second.ok).toBe(true);
    expect(readdirSync(dir)).toEqual(['Preferences']);
  });

  it('lets the lock go when the profile cannot be made', () => {
    const locks = createProfileLocks();
    mkdirSync(browserRoot(ws));
    writeFileSync(join(browserRoot(ws), 'scout'), 'file');
    expect(() => openProfile(ws, 'scout', 'k1', { locks })).toThrow(ProfileError);
    expect(locks.holder(profileDirOf(ws, 'scout'))).toBeNull();
    expect(() => openProfile(ws, '../x', 'k1', { locks })).toThrow(ProfileError);
  });

  it('takes off only the three marks of a browser, never what they point at', () => {
    const dir = ensureProfile(ws, 'scout');
    const target = join(ws, '..', 'target-file');
    writeFileSync(target, 'keep me');
    symlinkSync(target, join(dir, 'SingletonLock'));
    writeFileSync(join(dir, 'SingletonLockNot'), 'x');
    expect(clearSingletons(dir)).toBe(1);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(dir, 'SingletonLockNot'))).toBe(true);
    expect(clearSingletons(join(ws, 'nope'))).toBe(0);
  });
});

describe('when the agent goes away', () => {
  it('sweeps the profiles of agents that are not in the config, and what is not a profile', () => {
    ensureProfile(ws, 'scout');
    ensureProfile(ws, 'gone');
    writeFileSync(join(ensureProfile(ws, 'gone'), 'Cookies'), 'a session');
    writeFileSync(join(browserRoot(ws), 'stray.txt'), 'x');
    const elsewhere = join(ws, '..', 'elsewhere');
    mkdirSync(elsewhere);
    writeFileSync(join(elsewhere, 'keep'), 'x');
    symlinkSync(elsewhere, join(browserRoot(ws), 'linked'));
    const out = sweepProfiles(ws, ['scout', 'linked'], createProfileLocks());
    expect(out.removed.sort()).toEqual(['gone', 'linked', 'stray.txt']);
    expect(readdirSync(browserRoot(ws))).toEqual(['scout']);
    expect(existsSync(join(elsewhere, 'keep'))).toBe(true);
  });

  it('leaves a profile a screen holds, says so, and takes it once it is let go', () => {
    const locks = createProfileLocks();
    const opened = openProfile(ws, 'gone', 'run:r1', { locks });
    expect(sweepProfiles(ws, [], locks)).toEqual({ removed: [], held: ['gone'] });
    expect(existsSync(profileDirOf(ws, 'gone'))).toBe(true);
    if (opened.ok) opened.release();
    expect(sweepProfiles(ws, [], locks)).toEqual({ removed: ['gone'], held: [] });
  });

  it('is nothing when there are no profiles', () => {
    expect(sweepProfiles(ws, ['scout'], createProfileLocks())).toEqual({ removed: [], held: [] });
  });

  it('deletes one profile whatever it holds, and says whether a screen had it; a new agent with the same id starts empty', () => {
    const locks = createProfileLocks();
    const dir = ensureProfile(ws, 'scout');
    mkdirSync(join(dir, 'Default', 'Local Storage'), { recursive: true });
    writeFileSync(join(dir, 'Default', 'Cookies'), 'a session');
    // A read-only folder in the profile (a cache) does not stop the deletion.
    chmodSync(join(dir, 'Default', 'Local Storage'), 0o500);
    expect(deleteProfile(ws, 'scout', locks)).toEqual({ removed: true, held: false });
    expect(existsSync(dir)).toBe(false);
    expect(readdirSync(ensureProfile(ws, 'scout'))).toEqual([]);
    const opened = openProfile(ws, 'scout', 'k', { locks });
    expect(deleteProfile(ws, 'scout', locks)).toEqual({ removed: true, held: true });
    if (opened.ok) opened.release();
    expect(deleteProfile(ws, 'Not An Id', locks)).toEqual({ removed: false, held: false });
  });

  it('deletes every profile of a workspace', () => {
    ensureProfile(ws, 'scout');
    ensureProfile(ws, 'other');
    expect(deleteAllProfiles(ws)).toBe(true);
    expect(existsSync(browserRoot(ws))).toBe(false);
    expect(deleteAllProfiles(ws)).toBe(true);
  });
});

describe('the agent\'s sandbox', () => {
  it('cannot be given the profile as a folder: the app\'s data is refused as a bind, whole or in part', () => {
    const dir = ensureProfile(ws, 'scout');
    const data = join(ws, '..');
    for (const folder of [dir, browserRoot(ws), ws]) expect(() => readOnlyFolders([folder], join(data, 'home'), [data]), folder).toThrow();
  });
});

describe('what is inside the profiles', () => {
  it('knows the folder, what is under it and what leads there, and nothing near it', () => {
    const dir = ensureProfile(ws, 'scout');
    writeFileSync(join(dir, 'Cookies'), 'x');
    const inside = [browserRoot(ws), join(browserRoot(ws), 'scout'), join(dir, 'Cookies'), join(browserRoot(ws), 'not-made-yet', 'Default', 'Cookies'), join(dir, '..', 'scout', 'Cookies')];
    for (const p of inside) expect(isInsideProfiles(ws, p), p).toBe(true);
    const outside = [ws, join(ws, 'browser-notes'), join(ws, 'browserx', 'a'), join(ws, 'memory', 'browser'), join(ws, '..', 'browser')];
    for (const p of outside) expect(isInsideProfiles(ws, p), p).toBe(false);
    // A link to a profile file is that file.
    mkdirSync(join(ws, 'notes'));
    symlinkSync(join(dir, 'Cookies'), join(ws, 'notes', 'innocent.txt'));
    symlinkSync(dir, join(ws, 'notes', 'folder'));
    expect(isInsideProfiles(ws, join(ws, 'notes', 'innocent.txt'))).toBe(true);
    expect(isInsideProfiles(ws, join(ws, 'notes', 'folder', 'Cookies'))).toBe(true);
    expect(lstatSync(join(ws, 'notes', 'innocent.txt')).isSymbolicLink()).toBe(true);
  });

  it('knows it by the name of the workspace folder behind a link as well', () => {
    const linked = join(ws, '..', 'linked');
    symlinkSync(ws, linked);
    const dir = ensureProfile(linked, 'scout');
    expect(isInsideProfiles(linked, join(dir, 'Cookies'))).toBe(true);
    expect(isInsideProfiles(linked, join(linked, 'browser', 'scout', 'Cookies'))).toBe(true);
    expect(profileDenyGlobs(linked).sort()).toEqual([`/${join(real, BROWSER_DIR)}/**`, `/${join(linked, BROWSER_DIR)}/**`].sort());
  });

  it('gives the deny rule in the SDK\'s syntax for an absolute path: two slashes', () => {
    ensureProfile(ws, 'scout');
    expect(profileDenyGlobs(ws)).toContain(`//${join(real, BROWSER_DIR).slice(1)}/**`);
  });
});
