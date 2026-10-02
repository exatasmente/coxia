import { describe, expect, it } from 'vitest';
import {
  hasUpdateBadge,
  initialReleaseState,
  initialSourceState,
  installDecision,
  isPrerelease,
  reduceRelease,
  type FoundRelease,
  type ReleaseEvent,
  type ReleaseState,
} from '../src/shared/updates';

const v2: FoundRelease = { version: '0.2.0', releaseName: 'Coxia 0.2.0', releaseDate: '2026-10-01T00:00:00Z', notes: 'Faster start' };
const v3: FoundRelease = { ...v2, version: '0.3.0', releaseName: 'Coxia 0.3.0' };
const progress = { percent: 40, transferred: 40, total: 100, bytesPerSecond: 10 };

const play = (events: ReleaseEvent[], from: ReleaseState = initialReleaseState()): ReleaseState => events.reduce(reduceRelease, from);
const downloaded = (): ReleaseState => play([{ type: 'check-start' }, { type: 'available', release: v2, at: 1 }, { type: 'progress', progress }, { type: 'downloaded', release: v2 }]);

describe('release update state machine', () => {
  it('starts idle with nothing known', () => {
    expect(initialReleaseState()).toMatchObject({ phase: 'idle', version: null, lastCheckAt: null, lastResult: null });
  });

  it('follows a successful update: check, available, download, downloaded', () => {
    let s = play([{ type: 'check-start' }]);
    expect(s.phase).toBe('checking');
    s = reduceRelease(s, { type: 'available', release: v2, at: 100 });
    expect(s).toMatchObject({ phase: 'available', version: '0.2.0', notes: 'Faster start', lastCheckAt: 100, lastResult: 'available' });
    s = reduceRelease(s, { type: 'progress', progress });
    expect(s).toMatchObject({ phase: 'downloading', progress });
    s = reduceRelease(s, { type: 'downloaded', release: v2 });
    expect(s).toMatchObject({ phase: 'downloaded', version: '0.2.0', progress: null });
  });

  it('goes back to idle, remembering when and what, when there is nothing new', () => {
    const s = play([{ type: 'check-start' }, { type: 'not-available', at: 200 }]);
    expect(s).toMatchObject({ phase: 'idle', lastCheckAt: 200, lastResult: 'up-to-date', error: null });
  });

  it('records a failed check as an error and recovers on the next one', () => {
    let s = play([{ type: 'check-start' }, { type: 'error', message: 'offline', at: 300 }]);
    expect(s).toMatchObject({ phase: 'error', error: 'offline', lastResult: 'error', lastCheckAt: 300 });
    s = play([{ type: 'check-start' }], s);
    expect(s).toMatchObject({ phase: 'checking', error: null });
    s = reduceRelease(s, { type: 'not-available', at: 400 });
    expect(s).toMatchObject({ phase: 'idle', lastResult: 'up-to-date' });
  });

  it('a failed download is an error, not a download that never ends', () => {
    const s = play([{ type: 'available', release: v2, at: 1 }, { type: 'progress', progress }, { type: 'error', message: 'sha512 checksum mismatch', at: 2 }]);
    expect(s).toMatchObject({ phase: 'error', error: 'sha512 checksum mismatch' });
  });

  it('a later check never throws away a downloaded update: not new, not failed', () => {
    const base = downloaded();
    expect(play([{ type: 'check-start' }], base).phase).toBe('downloaded');
    expect(play([{ type: 'not-available', at: 9 }], base)).toMatchObject({ phase: 'downloaded', version: '0.2.0' });
    expect(play([{ type: 'error', message: 'offline', at: 9 }], base)).toMatchObject({ phase: 'downloaded', version: '0.2.0', error: 'offline', lastResult: 'error' });
  });

  it('hearing about the same version again keeps what was downloaded', () => {
    expect(play([{ type: 'available', release: v2, at: 9 }], downloaded())).toMatchObject({ phase: 'downloaded', progress: null });
  });

  it('a newer version replaces a downloaded one', () => {
    expect(play([{ type: 'available', release: v3, at: 9 }], downloaded())).toMatchObject({ phase: 'available', version: '0.3.0', releaseName: 'Coxia 0.3.0' });
  });

  it('progress only counts while a download is expected', () => {
    expect(play([{ type: 'progress', progress }]).phase).toBe('idle');
    expect(play([{ type: 'progress', progress }], downloaded()).phase).toBe('downloaded');
  });

  it('installs only a downloaded update, and nothing replaces one that is installing', () => {
    expect(play([{ type: 'install-start' }]).phase).toBe('idle');
    const installing = play([{ type: 'install-start' }], downloaded());
    expect(installing.phase).toBe('installing');
    expect(play([{ type: 'available', release: v3, at: 9 }, { type: 'downloaded', release: v3 }, { type: 'check-start' }], installing)).toMatchObject({ phase: 'installing', version: '0.2.0' });
  });

  it('a failed install goes back to the downloaded update with the reason', () => {
    for (const failure of [{ type: 'install-failed', message: 'cannot replace' }, { type: 'error', message: 'cannot replace', at: 5 }] as ReleaseEvent[]) {
      expect(play([failure], play([{ type: 'install-start' }], downloaded()))).toMatchObject({ phase: 'downloaded', error: 'cannot replace', version: '0.2.0' });
    }
    expect(play([{ type: 'install-failed', message: 'x' }]).phase).toBe('idle');
  });

  it('does not mutate the state it was given', () => {
    const s = initialReleaseState();
    reduceRelease(s, { type: 'check-start' });
    expect(s.phase).toBe('idle');
  });
});

describe('installDecision', () => {
  it('only a downloaded update can be installed', () => {
    for (const phase of ['idle', 'checking', 'available', 'downloading', 'installing', 'error'] as const) {
      expect(installDecision({ ...initialReleaseState(), phase }, false, true)).toBe('not-ready');
    }
  });

  it('never restarts while a ceremony, a call or a job runs, unless the person confirmed', () => {
    expect(installDecision(downloaded(), true, false)).toBe('busy');
    expect(installDecision(downloaded(), true, true)).toBe('install');
    expect(installDecision(downloaded(), false, false)).toBe('install');
  });
});

describe('update badge', () => {
  const src = (ahead: number | null) => ({ ...initialSourceState('/x'), ahead });

  it('shows for a published build that has something to apply, not while idle, checking or failed', () => {
    const phases = { idle: false, checking: false, error: false, available: true, downloading: true, downloaded: true, installing: true } as const;
    for (const [phase, shown] of Object.entries(phases)) expect(hasUpdateBadge('release', { ...initialReleaseState(), phase: phase as ReleaseState['phase'] }, src(0)), phase).toBe(shown);
  });

  it('shows for a source install only when main is ahead of the installed build', () => {
    expect(hasUpdateBadge('source', initialReleaseState(), src(3))).toBe(true);
    expect(hasUpdateBadge('source', initialReleaseState(), src(0))).toBe(false);
    expect(hasUpdateBadge('source', initialReleaseState(), src(null))).toBe(false);
  });

  it('never shows where nothing can update', () => {
    for (const mode of ['package', 'dev', 'none'] as const) expect(hasUpdateBadge(mode, { ...initialReleaseState(), phase: 'downloaded' }, src(5))).toBe(false);
  });

  it('does not take the other mode\'s state into account', () => {
    expect(hasUpdateBadge('source', { ...initialReleaseState(), phase: 'downloaded' }, src(0))).toBe(false);
    expect(hasUpdateBadge('release', initialReleaseState(), src(9))).toBe(false);
  });
});

describe('isPrerelease', () => {
  it('knows a pre-release version', () => {
    expect(isPrerelease('0.3.0-beta.2')).toBe(true);
    expect(isPrerelease('1.0.0-rc.1')).toBe(true);
    expect(isPrerelease('0.3.0')).toBe(false);
    expect(isPrerelease('')).toBe(false);
  });
});
