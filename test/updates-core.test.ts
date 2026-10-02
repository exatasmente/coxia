import { spawn } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGS } from '../src/shared/i18n';
import { DEFAULT_UPDATE_SETTINGS, type UpdateSettings } from '../src/shared/updates';
import { QUIT_FLAG } from '../src/main/update-core';
import {
  FOCUS_MIN_GAP_MS,
  RELAUNCH_SCRIPT,
  STARTUP_CHECK_DELAY_MS,
  applyUpdaterConfig,
  detectMode,
  feedProblem,
  focusCheckDue,
  isLoopbackHost,
  nextCheckDelay,
  normalizeSettings,
  parseAppUpdateYml,
  parseSourceRecord,
  relaunchArgs,
  releaseNotesText,
  settingsProblem,
  updaterConfig,
  type FeedConfig,
  type ModeInputs,
} from '../src/main/updates-core';

describe('update settings', () => {
  it('defaults to automatic checks every 6 hours on the stable channel, with the mode detected and no git fetch', () => {
    expect(normalizeSettings(undefined)).toEqual({ auto: true, channel: 'stable', intervalHours: 6, mode: 'auto', fetchSource: false });
    expect(normalizeSettings(null)).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(normalizeSettings('garbage')).toEqual(DEFAULT_UPDATE_SETTINGS);
  });

  it('keeps what is valid and replaces what is not, clamping the interval', () => {
    expect(normalizeSettings({ auto: false, channel: 'beta', intervalHours: 24, mode: 'source', fetchSource: true })).toEqual({ auto: false, channel: 'beta', intervalHours: 24, mode: 'source', fetchSource: true });
    expect(normalizeSettings({ channel: 'nightly', mode: 'both', auto: 'yes', fetchSource: 1 })).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(normalizeSettings({ intervalHours: 0 }).intervalHours).toBe(1);
    expect(normalizeSettings({ intervalHours: 100000 }).intervalHours).toBe(168);
    expect(normalizeSettings({ intervalHours: 'x' }).intervalHours).toBe(6);
  });

  it('refuses a save with a wrong value instead of falling back silently', () => {
    const ok: UpdateSettings = { auto: true, channel: 'beta', intervalHours: 12, mode: 'auto', fetchSource: false };
    expect(settingsProblem(ok)).toBeNull();
    expect(settingsProblem(null)).toBe('updates.error.settings');
    expect(settingsProblem({ ...ok, auto: 'yes' })).toBe('updates.error.settings');
    expect(settingsProblem({ ...ok, channel: 'nightly' })).toBe('updates.error.channel');
    expect(settingsProblem({ ...ok, mode: 'both' })).toBe('updates.error.mode');
    expect(settingsProblem({ ...ok, intervalHours: 0 })).toBe('updates.error.interval');
    expect(settingsProblem({ ...ok, intervalHours: 1.5 })).toBe('updates.error.interval');
    expect(settingsProblem({ ...ok, intervalHours: 169 })).toBe('updates.error.interval');
  });
});

describe('channel configuration of the updater', () => {
  it('stable follows latest*.yml and no pre-release; beta follows beta*.yml and pre-releases', () => {
    expect(updaterConfig('stable')).toEqual({ channel: 'latest', allowPrerelease: false, allowDowngrade: false, autoDownload: true, autoInstallOnAppQuit: true });
    expect(updaterConfig('beta')).toEqual({ channel: 'beta', allowPrerelease: true, allowDowngrade: false, autoDownload: true, autoInstallOnAppQuit: true });
  });

  it('never allows a downgrade unless it is asked for explicitly', () => {
    expect(updaterConfig('stable').allowDowngrade).toBe(false);
    expect(updaterConfig('beta').allowDowngrade).toBe(false);
    expect(updaterConfig('stable', true).allowDowngrade).toBe(true);
  });

  // electron-updater turns allowDowngrade on by itself when the channel is set: applying the config must undo that.
  class FakeUpdater {
    private _channel: string | null = null;
    allowPrerelease = false;
    allowDowngrade = false;
    autoDownload = false;
    autoInstallOnAppQuit = false;
    get channel(): string | null {
      return this._channel;
    }
    set channel(value: string | null) {
      this._channel = value;
      this.allowDowngrade = true;
    }
  }

  it('leaves allowDowngrade off even though setting a channel turns it on', () => {
    const u = new FakeUpdater();
    applyUpdaterConfig(u, updaterConfig('beta'));
    expect(u).toMatchObject({ channel: 'beta', allowPrerelease: true, allowDowngrade: false, autoDownload: true, autoInstallOnAppQuit: true });
    applyUpdaterConfig(u, updaterConfig('stable'));
    expect(u).toMatchObject({ channel: 'latest', allowPrerelease: false, allowDowngrade: false });
  });

  it('applies an explicit downgrade for one check and takes it back after', () => {
    const u = new FakeUpdater();
    applyUpdaterConfig(u, updaterConfig('stable', true));
    expect(u.allowDowngrade).toBe(true);
    applyUpdaterConfig(u, updaterConfig('stable'));
    expect(u.allowDowngrade).toBe(false);
  });
});

describe('the feed', () => {
  const github: FeedConfig = { provider: 'github', owner: 'coxia-app', repo: 'coxia' };

  it('reads the flat app-update.yml electron-builder writes', () => {
    const yml = 'owner: coxia-app\nrepo: coxia\nprovider: github\nupdaterCacheDirName: cerimonias-updater\n';
    expect(parseAppUpdateYml(yml)).toEqual({ owner: 'coxia-app', repo: 'coxia', provider: 'github', updaterCacheDirName: 'cerimonias-updater' });
    expect(parseAppUpdateYml('provider: "generic"\nurl: \'https://updates.example.org/coxia/\'\n')).toEqual({ provider: 'generic', url: 'https://updates.example.org/coxia/' });
  });

  it('is nothing without a provider', () => {
    expect(parseAppUpdateYml('')).toBeNull();
    expect(parseAppUpdateYml('owner: x\n')).toBeNull();
  });

  it('accepts a configured GitHub feed and a generic HTTPS one', () => {
    expect(feedProblem(github)).toBeNull();
    expect(feedProblem({ provider: 'github', owner: 'a', repo: 'b', protocol: 'https' })).toBeNull();
    expect(feedProblem({ provider: 'generic', url: 'https://updates.example.org/coxia/' })).toBeNull();
  });

  it('refuses a feed that is missing or still has the placeholders of electron-builder.yml', () => {
    expect(feedProblem(null)).toBe('missing');
    expect(feedProblem({ provider: 'github', owner: 'OWNER', repo: 'REPO' })).toBe('placeholder');
    expect(feedProblem({ provider: 'github', owner: 'coxia-app', repo: 'REPO' })).toBe('placeholder');
    expect(feedProblem({ provider: 'github', owner: 'coxia-app' })).toBe('placeholder');
    expect(feedProblem({ provider: 'generic' })).toBe('missing');
  });

  it('refuses plain HTTP, except to this machine (the local end-to-end test)', () => {
    expect(feedProblem({ provider: 'generic', url: 'http://updates.example.org/coxia/' })).toBe('insecure');
    expect(feedProblem({ provider: 'generic', url: 'http://192.168.0.5:8080/' })).toBe('insecure');
    expect(feedProblem({ provider: 'generic', url: 'http://127.0.0.1:9325/' })).toBeNull();
    expect(feedProblem({ provider: 'generic', url: 'http://localhost:9325/' })).toBeNull();
    expect(feedProblem({ ...github, protocol: 'http' })).toBe('insecure');
    expect(feedProblem({ provider: 'generic', url: 'ftp://x.org/' })).toBe('insecure');
    expect(feedProblem({ provider: 'generic', url: 'not a url' })).toBe('unsupported');
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
  });

  it('only knows the github and generic providers', () => {
    expect(feedProblem({ provider: 's3', bucket: 'b' })).toBe('unsupported');
  });

  it('the placeholders in electron-builder.yml are caught', () => {
    const yml = readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8');
    const publish = /^publish:\n((?: {2}.*\n)+)/m.exec(yml)?.[1] ?? '';
    const feed = parseAppUpdateYml(publish.replace(/^ {2}/gm, ''));
    expect(feed?.provider).toBe('github');
    expect(feedProblem(feed)).toBe('placeholder');
  });
});

describe('mode detection', () => {
  const feed: FeedConfig = { provider: 'github', owner: 'coxia-app', repo: 'coxia' };
  const APP = '/home/u/.local/opt/cerimonias/cerimonias.AppImage';
  const base: ModeInputs = { packaged: true, platform: 'linux', appImage: APP, feed, source: null, sourceUsable: false, override: 'auto' };
  const record = { source: '/home/u/src/coxia', appImage: APP };

  it('is development when the app is not packaged, whatever else is set', () => {
    expect(detectMode({ ...base, packaged: false, source: record, sourceUsable: true }).mode).toBe('dev');
    expect(detectMode({ ...base, packaged: false, override: 'release' }).mode).toBe('dev');
  });

  it('is a source install when install-local.sh recorded this AppImage and its tree still exists', () => {
    expect(detectMode({ ...base, source: record, sourceUsable: true })).toMatchObject({ mode: 'source', reason: 'source', selfUpdate: false });
  });

  it('a record for another AppImage does not make this one a source install', () => {
    expect(detectMode({ ...base, source: { ...record, appImage: '/elsewhere/other.AppImage' }, sourceUsable: true }).mode).toBe('release');
  });

  it('a record whose tree is gone falls back to the published-release rules', () => {
    expect(detectMode({ ...base, source: record, sourceUsable: false })).toMatchObject({ mode: 'release', selfUpdate: true });
  });

  it('a record without the AppImage path (CERIMONIAS_SOURCE_DIR) still counts', () => {
    expect(detectMode({ ...base, source: { source: record.source, appImage: null }, sourceUsable: true }).mode).toBe('source');
  });

  it('is a published release when there is a real feed and it runs from an AppImage', () => {
    expect(detectMode(base)).toEqual({ mode: 'release', reason: 'release', selfUpdate: true, requiresSigning: false });
  });

  it('a .deb install (packaged, no AppImage) is left to the package manager', () => {
    expect(detectMode({ ...base, appImage: undefined })).toEqual({ mode: 'package', reason: 'package', selfUpdate: false, requiresSigning: false });
    expect(detectMode({ ...base, appImage: undefined, override: 'release' }).mode).toBe('package');
  });

  it('does not update itself from a feed that is missing, a placeholder or insecure', () => {
    expect(detectMode({ ...base, feed: null })).toMatchObject({ mode: 'none', reason: 'feed-missing', selfUpdate: false });
    expect(detectMode({ ...base, feed: { provider: 'github', owner: 'OWNER', repo: 'REPO' } })).toMatchObject({ mode: 'none', reason: 'feed-placeholder' });
    expect(detectMode({ ...base, feed: { provider: 'generic', url: 'http://example.org/' } })).toMatchObject({ mode: 'none', reason: 'feed-insecure' });
  });

  it('Windows and macOS wire the same updater but say it needs signed builds', () => {
    for (const platform of ['win32', 'darwin'] as const) {
      expect(detectMode({ ...base, platform, appImage: undefined })).toEqual({ mode: 'release', reason: 'release', selfUpdate: true, requiresSigning: true });
    }
  });

  it('the override wins over the detection, and says why', () => {
    expect(detectMode({ ...base, override: 'release', source: record, sourceUsable: true })).toMatchObject({ mode: 'release', reason: 'forced-release' });
    expect(detectMode({ ...base, override: 'source', source: record, sourceUsable: true })).toMatchObject({ mode: 'source', reason: 'forced-source' });
  });

  it('forcing source without a usable tree is nothing, not a guess', () => {
    expect(detectMode({ ...base, override: 'source' })).toMatchObject({ mode: 'none', reason: 'source-unknown' });
    expect(detectMode({ ...base, override: 'source', source: record, sourceUsable: false })).toMatchObject({ mode: 'none', reason: 'source-missing' });
  });

  it('forcing release over a bad feed is still refused', () => {
    expect(detectMode({ ...base, override: 'release', feed: null }).mode).toBe('none');
  });
});

describe('the source record', () => {
  it('reads what install-local.sh writes', () => {
    expect(parseSourceRecord('{"source":"/home/u/src/coxia","appImage":"/home/u/.local/opt/cerimonias/cerimonias.AppImage"}')).toEqual({
      source: '/home/u/src/coxia',
      appImage: '/home/u/.local/opt/cerimonias/cerimonias.AppImage',
    });
    expect(parseSourceRecord('{"source":"/x"}')).toEqual({ source: '/x', appImage: null });
  });

  it('refuses anything else, including a relative path', () => {
    expect(parseSourceRecord('')).toBeNull();
    expect(parseSourceRecord('{"source":"relative/path"}')).toBeNull();
    expect(parseSourceRecord('{"source":3}')).toBeNull();
    expect(parseSourceRecord('nope')).toBeNull();
  });
});

describe('release notes', () => {
  it('passes plain text and markdown through', () => {
    expect(releaseNotesText('- faster start\n- fixes')).toBe('- faster start\n- fixes');
  });

  it('turns the HTML GitHub gives into text and drops scripts', () => {
    const html = '<h2>What\'s new</h2><ul><li>Faster &amp; smaller</li><li>Fix <b>crash</b></li></ul><script>alert(1)</script><p>Thanks</p>';
    const text = releaseNotesText(html) ?? '';
    expect(text).toContain('- Faster & smaller');
    expect(text).toContain('- Fix crash');
    expect(text).toContain('Thanks');
    expect(text).not.toMatch(/[<>]|alert/);
  });

  it('joins a list of notes (full changelog)', () => {
    expect(releaseNotesText([{ version: '0.3.0', note: 'three' }, { version: '0.2.0', note: null }])).toBe('0.3.0\nthree\n\n0.2.0');
  });

  it('is null when there is nothing to show, and caps what is too long', () => {
    expect(releaseNotesText(null)).toBeNull();
    expect(releaseNotesText(undefined)).toBeNull();
    expect(releaseNotesText('  <p> </p> ')).toBeNull();
    const long = releaseNotesText('x'.repeat(10_000)) ?? '';
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('schedule', () => {
  const HOUR = 3_600_000;

  it('checks shortly after the start when it has never checked', () => {
    expect(nextCheckDelay(null, 1_000_000, 6)).toBe(STARTUP_CHECK_DELAY_MS);
  });

  it('waits out the rest of the interval since the last check, but never less than the startup delay', () => {
    const now = 100 * HOUR;
    expect(nextCheckDelay(now - 2 * HOUR, now, 6)).toBe(4 * HOUR);
    expect(nextCheckDelay(now - 6 * HOUR, now, 6)).toBe(STARTUP_CHECK_DELAY_MS);
    expect(nextCheckDelay(now - 50 * HOUR, now, 6)).toBe(STARTUP_CHECK_DELAY_MS);
    expect(nextCheckDelay(now, now, 1)).toBe(HOUR);
  });

  it('a window focus checks again only after a quiet minute', () => {
    expect(focusCheckDue(null, 5)).toBe(true);
    expect(focusCheckDue(1000, 1000 + FOCUS_MIN_GAP_MS - 1)).toBe(false);
    expect(focusCheckDue(1000, 1000 + FOCUS_MIN_GAP_MS)).toBe(true);
  });
});

describe('relaunch', () => {
  it('keeps the arguments of this instance, shown instead of in the tray, without the quit flag', () => {
    expect(relaunchArgs(['/tmp/.mount_x/cerimonias', '--no-sandbox', '--hidden', '--remote-debugging-port=9325', QUIT_FLAG])).toEqual(['--no-sandbox', '--remote-debugging-port=9325']);
    expect(relaunchArgs(['/tmp/.mount_x/cerimonias'])).toEqual([]);
  });

  // The helper script is real shell: it waits for the pid to go away, then starts the app with the arguments.
  it('waits for the old instance to exit before it starts the new one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerimonias-relaunch-'));
    const app = join(dir, 'app.sh');
    const out = join(dir, 'started');
    writeFileSync(app, `#!/usr/bin/env bash\necho "$@" > "${out}"\n`);
    chmodSync(app, 0o755);
    const old = spawn('sleep', ['2'], { stdio: 'ignore' });
    const helper = spawn('bash', ['-c', RELAUNCH_SCRIPT, 'relaunch', String(old.pid), app, '--a', '--b=1'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
    expect(existsSync(out)).toBe(false);
    await new Promise((r) => old.on('exit', r));
    for (let i = 0; i < 40 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(out, 'utf8').trim()).toBe('--a --b=1');
    helper.kill();
  }, 20_000);

  // The app's own open files (inside the AppImage mount) and its debugging socket must not reach the new instance.
  it('does not pass on the descriptors it inherited', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cerimonias-relaunch-'));
    const app = join(dir, 'app.sh');
    const out = join(dir, 'fds');
    writeFileSync(app, `#!/usr/bin/env bash\nls /proc/$$/fd | tr '\\n' ' ' > "${out}"\n`);
    chmodSync(app, 0o755);
    const leaked = openSync(join(dir, 'leaked'), 'w');
    const old = spawn('sleep', ['0.3'], { stdio: 'ignore' });
    const helper = spawn('bash', ['-c', RELAUNCH_SCRIPT, 'relaunch', String(old.pid), app], { stdio: ['ignore', 'ignore', 'ignore', leaked, leaked] });
    for (let i = 0; i < 60 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
    const open = readFileSync(out, 'utf8').trim().split(/\s+/);
    expect(open.filter((fd) => !['0', '1', '2', '255'].includes(fd))).toEqual([]);
    helper.kill();
    closeSync(leaked);
  }, 20_000);
});

describe('catalog', () => {
  const keys = (language: 'pt-BR' | 'en'): string[] => Object.keys(CATALOGS[language]).filter((k) => k.startsWith('updates.'));

  it('has every update string in both languages', () => {
    expect(keys('en').sort()).toEqual(keys('pt-BR').sort());
    expect(keys('en').length).toBeGreaterThan(60);
  });

  it('has a string for every reason, mode, channel and source error the code can produce', () => {
    const pt = CATALOGS['pt-BR'];
    const reasons = ['release', 'source', 'forced-release', 'forced-source', 'package', 'dev', 'feed-missing', 'feed-placeholder', 'feed-insecure', 'feed-unsupported', 'source-missing', 'source-unknown'];
    for (const r of reasons) expect(pt[`updates.reason.${r}`], r).toBeTruthy();
    for (const m of ['release', 'source', 'package', 'dev', 'none']) expect(pt[`updates.mode.${m}`], m).toBeTruthy();
    for (const m of ['auto', 'release', 'source']) expect(pt[`updates.mode.setting.${m}`], m).toBeTruthy();
    for (const c of ['stable', 'beta']) expect(pt[`updates.channel.${c}`] && pt[`updates.channel.${c}.hint`], c).toBeTruthy();
    for (const e of ['no-dir', 'not-a-repo', 'no-main', 'commit-unknown', 'git-failed']) expect(pt[`updates.source.error.${e}`], e).toBeTruthy();
    for (const r of ['up-to-date', 'available', 'error']) expect(pt[`updates.result.${r}`], r).toBeTruthy();
    for (const e of ['settings', 'channel', 'mode', 'interval']) expect(pt[`updates.error.${e}`], e).toBeTruthy();
  });

  it('the reasons detectMode returns are the ones in the catalog', () => {
    const feeds: (FeedConfig | null)[] = [null, { provider: 'github', owner: 'OWNER', repo: 'REPO' }, { provider: 'generic', url: 'http://x.org/' }, { provider: 's3' }, { provider: 'github', owner: 'a', repo: 'b' }];
    for (const feed of feeds) {
      for (const override of ['auto', 'release', 'source'] as const) {
        for (const appImage of [undefined, '/a.AppImage']) {
          const r = detectMode({ packaged: true, platform: 'linux', appImage, feed, source: null, sourceUsable: false, override });
          expect(CATALOGS['pt-BR'][`updates.reason.${r.reason}`], `${r.reason}`).toBeTruthy();
        }
      }
    }
  });
});
