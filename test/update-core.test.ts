import { describe, expect, it } from 'vitest';
import { stripDirty } from '../src/shared/update';
import { QUIT_FLAG, announcement, parseBehind, parseUpdatedMarker, readBuild, runInfo, stateDir, updateEnv, wantsQuitForUpdate } from '../src/main/update-core';

describe('wantsQuitForUpdate', () => {
  it('sees the flag anywhere in a second instance argv', () => {
    expect(wantsQuitForUpdate(['/opt/cerimonias', QUIT_FLAG])).toBe(true);
    expect(wantsQuitForUpdate(['/opt/cerimonias', '--user-data-dir=/x', QUIT_FLAG, '--hidden'])).toBe(true);
  });

  it('is not triggered by a normal second launch', () => {
    expect(wantsQuitForUpdate(['/opt/cerimonias'])).toBe(false);
    expect(wantsQuitForUpdate(['/opt/cerimonias', '--hidden'])).toBe(false);
    expect(wantsQuitForUpdate(['/opt/cerimonias', '--quit-for-updates'])).toBe(false);
  });
});

describe('readBuild', () => {
  it('keeps what the build embedded', () => {
    expect(readBuild('0.1.0', 'abc1234', '2026-10-02T12:00:00.000Z')).toEqual({ version: '0.1.0', commit: 'abc1234', builtAt: '2026-10-02T12:00:00.000Z' });
  });

  it('falls back to dev when nothing was embedded (tests, electron .)', () => {
    expect(readBuild('0.1.0')).toEqual({ version: '0.1.0', commit: 'dev', builtAt: '' });
  });
});

describe('parseBehind', () => {
  it('reads a count', () => {
    expect(parseBehind('3\n')).toBe(3);
    expect(parseBehind('0')).toBe(0);
  });

  it('is null for anything else', () => {
    expect(parseBehind('')).toBeNull();
    expect(parseBehind('fatal: bad revision')).toBeNull();
    expect(parseBehind('-1')).toBeNull();
  });
});

describe('stripDirty', () => {
  it('strips the dirty stamp', () => {
    expect(stripDirty('a0547e8+dirty')).toBe('a0547e8');
    expect(stripDirty('a0547e8')).toBe('a0547e8');
  });
});

describe('updateEnv', () => {
  const env = {
    HOME: '/home/u',
    APPIMAGE: '/home/u/.local/opt/cerimonias/cerimonias.AppImage',
    APPDIR: '/tmp/.mount_ceriXYZ',
    ARGV0: 'cerimonias',
    OWD: '/home/u',
    PATH: '/tmp/.mount_ceriXYZ/usr/bin:/usr/local/bin:/usr/bin',
    LD_LIBRARY_PATH: '/tmp/.mount_ceriXYZ/usr/lib',
    DISPLAY: ':0',
  };

  it('drops the AppImage variables and the paths inside the old mount', () => {
    const out = updateEnv(env);
    expect(out.APPIMAGE).toBeUndefined();
    expect(out.APPDIR).toBeUndefined();
    expect(out.ARGV0).toBeUndefined();
    expect(out.OWD).toBeUndefined();
    expect(out.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(out.LD_LIBRARY_PATH).toBeUndefined();
    expect(out.DISPLAY).toBe(':0');
    expect(out.HOME).toBe('/home/u');
  });

  it('leaves a plain environment alone and does not mutate its input', () => {
    const plain = { PATH: '/usr/bin', HOME: '/home/u' };
    expect(updateEnv(plain)).toEqual(plain);
    updateEnv(env);
    expect(env.APPDIR).toBe('/tmp/.mount_ceriXYZ');
  });
});

describe('stateDir', () => {
  it('follows XDG_STATE_HOME and defaults to ~/.local/state', () => {
    expect(stateDir({ XDG_STATE_HOME: '/scratch/state' }, '/home/u')).toBe('/scratch/state/cerimonias');
    expect(stateDir({}, '/home/u')).toBe('/home/u/.local/state/cerimonias');
  });
});

describe('update marker and run info', () => {
  it('reads the commit update.sh left behind', () => {
    expect(parseUpdatedMarker('{"commit":"a0547e8","at":"2026-10-02T12:00:00-03:00"}')).toEqual({ commit: 'a0547e8', version: null });
    expect(parseUpdatedMarker('{"version":"0.2.0"}')).toEqual({ commit: null, version: '0.2.0' });
    expect(parseUpdatedMarker('{}')).toEqual({ commit: null, version: null });
  });

  it('ignores a marker that is not JSON', () => {
    expect(parseUpdatedMarker('')).toBeNull();
    expect(parseUpdatedMarker('not json')).toBeNull();
  });

  it('writes one scalar per line so a shell can read it', () => {
    const info = runInfo(4321, readBuild('0.1.0', 'abc1234', '2026-10-02T12:00:00.000Z'), '2026-10-02T12:01:00.000Z');
    expect(info).toEqual({ pid: 4321, version: '0.1.0', commit: 'abc1234', builtAt: '2026-10-02T12:00:00.000Z', startedAt: '2026-10-02T12:01:00.000Z' });
    const lines = JSON.stringify(info, null, 1).split('\n');
    expect(lines).toContain(' "pid": 4321,');
    expect(lines).toContain(' "commit": "abc1234",');
  });

  it('announces the commit after a rebuild, and the version only once the app runs it', () => {
    const build = readBuild('0.2.0', 'a0547e8', '');
    expect(announcement({ commit: 'a0547e8', version: null }, build)).toBe('a0547e8');
    expect(announcement({ commit: null, version: '0.2.0' }, build)).toBe('0.2.0');
    expect(announcement({ commit: null, version: '0.3.0' }, build)).toBeNull();
    expect(announcement(null, build)).toBeNull();
  });
});
