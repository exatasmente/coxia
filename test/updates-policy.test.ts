import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, webAccess, webRefusal } from '../src/main/webPolicy';

const ROOT = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

// An update replaces the installed app and quits it: from a paired browser it must never be reachable.
describe('updates are desktop only', () => {
  const handled = new Set<string>();
  for (const file of readdirSync(join(ROOT, 'src/main'))) {
    if (!file.endsWith('.ts')) continue;
    for (const m of read(`src/main/${file}`).matchAll(/handle\(\s*'(update:[\w-]+)'/g)) handled.add(m[1]);
  }

  it('finds the update channels the main process serves', () => {
    expect([...handled].sort()).toEqual(['update:busy', 'update:check', 'update:flushed', 'update:info', 'update:install', 'update:run', 'update:seen', 'update:settings-save', 'update:status']);
  });

  it('refuses every one of them to a browser, with no way around it by setting', () => {
    for (const channel of handled) {
      expect(DESKTOP_ONLY.has(channel), channel).toBe(true);
      expect(webAccess(channel), channel).toBe('deny');
      expect(webRefusal(channel, true), channel).not.toBeNull();
    }
  });

  it('lists no update channel that nothing serves', () => {
    for (const channel of DESKTOP_ONLY) if (channel.startsWith('update:')) expect(handled.has(channel), channel).toBe(true);
  });

  it('the renderer only reaches them through the desktop wrapper, never from the browser build', () => {
    const api = read('src/renderer/src/updateApi.ts');
    for (const name of ['useUpdatesStatus', 'useReportUpdateBusy']) {
      const body = api.slice(api.indexOf(`function ${name}`));
      expect(body.slice(0, 400), name).toContain('isWeb()');
    }
  });
});

describe('the updater is set up safely', () => {
  const main = read('src/main/updates.ts');

  it('refuses web installers (they skip part of the checksum verification)', () => {
    expect(main).toContain('disableWebInstaller = true');
  });

  it('keeps differential downloads, whose every block is checked against the sha512 of latest*.yml', () => {
    expect(main).toContain('disableDifferentialDownload = false');
  });

  it('only loads electron-updater when a published build can update itself', () => {
    expect(main).not.toMatch(/^import (?!type)[^\n]*from 'electron-updater'/m);
    expect(main).toContain("requireModule('electron-updater')");
    // the one place that loads it is behind the mode check
    expect(main).toMatch(/currentMode\(\)\.mode !== 'release'\) return;\s+const u = getUpdater\(\)/);
  });

  it('never installs by itself: the restart is behind installRelease, which asks installDecision first', () => {
    expect(main.match(/quitAndInstall\(/g)).toHaveLength(1);
    expect(main).toMatch(/installDecision\(release, busy, force\)[\s\S]*quitAndInstall\(/);
  });

  it('a normal quit installs the downloaded update only when nothing is running', () => {
    expect(main).toContain('updater.autoInstallOnAppQuit = !busy');
  });
});
