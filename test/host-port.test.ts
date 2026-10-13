// What only the owner of the process does, through the host port: the desktop gives it all, a host without a desktop gives the version and the
// exit, and a feature it lacks answers with a stable code instead of breaking.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { HostUnavailableError, appVersion, exitProcess, pickPath, requireHost, restartProcess, screenPort, setHostPort } from '../src/main/host';
import { appPath } from '../src/main/paths';

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
afterEach(() => setHostPort(null));

describe('the host port without a desktop', () => {
  it("reads the version from the app's own package.json", () => {
    const pkg = JSON.parse(readFileSync(join(appPath(), 'package.json'), 'utf8')) as { version: string };
    expect(appVersion()).toBe(pkg.version);
  });

  it('refuses a restart, a file dialog and the screen with a stable code and a message per feature', async () => {
    const restart = (() => {
      try {
        restartProcess();
      } catch (e) {
        return e;
      }
    })();
    expect(restart).toBeInstanceOf(HostUnavailableError);
    expect(restart).toMatchObject({ code: 'host-unavailable', feature: 'restart' });
    expect((restart as Error).message).toContain('change workspace');
    await expect(pickPath({ mode: 'open-file', title: 'x' })).rejects.toMatchObject({ code: 'host-unavailable', feature: 'pick' });
    expect(() => requireHost('screen')).toThrow(HostUnavailableError);
    expect(screenPort()).toBeNull();
  });
});

describe('the host port the desktop fills', () => {
  it('takes every feature from the host, read at the time of use', async () => {
    const exit = vi.fn();
    const restart = vi.fn();
    const pick = vi.fn(async () => '/home/example/coxia.json');
    setHostPort({ version: () => '9.9.9-test', exit, restart, pick });
    expect(appVersion()).toBe('9.9.9-test');
    exitProcess(3);
    expect(exit).toHaveBeenCalledWith(3);
    expect(() => requireHost('restart')).not.toThrow();
    restartProcess();
    expect(restart).toHaveBeenCalledOnce();
    await expect(pickPath({ mode: 'save', title: 'Export' })).resolves.toBe('/home/example/coxia.json');
    expect(pick).toHaveBeenCalledWith({ mode: 'save', title: 'Export' });
  });
});
