// What the desktop alone gives, with its runtime replaced by a stand-in: a fake keychain behind the encryption port, the runtime's folders behind
// the paths port, and the process it owns (version, exit, relaunch, file dialogs, the screen encoder) behind the host port. A desktop with no usable keychain refuses exactly as it always has, wording included.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { dataRoot } from '../src/main/env';
import { SECRETS_FILE } from '../src/main/secrets-core';
import { secrets } from '../src/main/secrets';
import { appPath, isPackaged, resourcesDir, setPathsPort, userDataDir, voiceVenvDir } from '../src/main/paths';
import { appVersion, exitProcess, pickPath, restartProcess, screenPort, setHostPort } from '../src/main/host';
import { installElectronPorts, keychain } from '../src/main/electronPorts';

const RESOURCES_BASE = '/opt/example/resources-base';
const USER_DATA = '/home/example/data';

const fake = vi.hoisted(() => ({ packaged: true, userData: '/home/example/data', backend: 'gnome_libsecret', available: true, throwOnCheck: false, calls: [] as string[] }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return fake.packaged;
    },
    getPath: (name: string) => (name === 'userData' ? fake.userData : join('/opt/example/runtime', name)),
    getAppPath: () => '/opt/example/app.asar',
    getVersion: () => '1.2.3-desktop',
    exit: (code: number) => fake.calls.push(`exit:${code}`),
    relaunch: () => fake.calls.push('relaunch'),
    quit: () => fake.calls.push('quit'),
  },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showSaveDialog: async (options: { defaultPath?: string }) => ({ canceled: false, filePath: join('/home/example', options.defaultPath ?? 'x') }),
    showOpenDialog: async (options: { properties: string[] }) => ({ canceled: false, filePaths: [`/home/example/${options.properties.join('+')}`] }),
  },
  nativeImage: { createFromBitmap: () => ({}) },
  ipcMain: { on: () => undefined, removeListener: () => undefined },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (fake.throwOnCheck) throw new Error('no keyring here');
      return fake.available;
    },
    getSelectedStorageBackend: () => fake.backend,
    encryptString: (text: string) => Buffer.from(`enc:${[...text].reverse().join('')}`),
    decryptString: (data: Buffer) => [...data.toString().slice(4)].reverse().join(''),
  },
}));

// The stand-in has no real resources folder of its own.
beforeAll(() => {
  setLanguage('en');
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES_BASE, configurable: true });
  installElectronPorts();
});
afterAll(() => {
  setPathsPort(null);
  setHostPort(null);
  setLanguage('pt-BR');
});

const VALUE = 'sk-this-is-a-test-value';

describe('the ports the desktop fills', () => {
  it('take the folders from the runtime as it starts', () => {
    expect(isPackaged()).toBe(true);
    expect(userDataDir()).toBe(USER_DATA);
    expect(voiceVenvDir()).toBe(join(USER_DATA, 'voice-venv'));
    expect(resourcesDir()).toBe(join(RESOURCES_BASE, 'resources'));
    expect(appPath()).toBe('/opt/example/app.asar');
  });

  it("take the version, the exit, the relaunch, the dialogs and the screen from the runtime", async () => {
    expect(appVersion()).toBe('1.2.3-desktop');
    exitProcess(2);
    restartProcess();
    expect(fake.calls).toEqual(['exit:2', 'relaunch', 'quit']);
    await expect(pickPath({ mode: 'save', title: 'Export', defaultPath: 'coxia.json' })).resolves.toBe('/home/example/coxia.json');
    await expect(pickPath({ mode: 'open-dir', title: 'Folder' })).resolves.toBe('/home/example/openDirectory+createDirectory');
    await expect(pickPath({ mode: 'open-file', title: 'Key', showHidden: true })).resolves.toBe('/home/example/openFile+showHiddenFiles');
    expect(screenPort()).not.toBeNull();
  });

  it('write and read a stored secret through the simulated keychain, keeping ciphertext on disk', () => {
    const s = secrets();
    s.set({ ref: 'llm.anthropic', source: 'stored', value: VALUE });
    expect(s.resolve('llm.anthropic')).toBe(VALUE);
    const raw = readFileSync(join(dataRoot(), SECRETS_FILE), 'utf8');
    expect(raw).toContain('"cipher"');
    expect(raw).not.toContain(VALUE);
    expect((statSync(join(dataRoot(), SECRETS_FILE)).mode & 0o777).toString(8)).toBe('600');
    expect(s.storage()).toMatchObject({ secure: true, backend: 'gnome_libsecret', canStore: true });
    expect(keychain.backend()).toBe('gnome_libsecret');
  });
});

describe('a desktop whose keychain is not usable', () => {
  beforeEach(() => {
    fake.backend = 'gnome_libsecret';
    fake.available = true;
  });

  it('still counts a plain-text fallback of the system as no keychain at all', () => {
    fake.backend = 'basic_text';
    expect(keychain.available()).toBe(false);
    expect(secrets().storage()).toMatchObject({ secure: false, backend: 'basic_text' });
  });

  it('keeps refusing a stored value until the insecure file is accepted, and says so in its own words', () => {
    fake.available = false;
    fake.throwOnCheck = true;
    expect(() => secrets().set({ ref: 'llm.openrouter', source: 'stored', value: VALUE })).toThrow(/no OS keychain is available/);
    expect(() => secrets().resolve('llm.anthropic')).toThrow(/keychain is not available/);
    expect(secrets().check('llm.anthropic')).toEqual({ ok: false, reason: expect.stringContaining('keychain') });
  });
});