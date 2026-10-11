// voice.enabled = false means no sidecar: the process is never spawned, nothing is synthesized or transcribed, and turning the switch off stops it.
// child_process.spawn is mocked, so no test here starts a process.
import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (original) => ({ ...(await original<typeof import('node:child_process')>()), spawn: spawnMock }));
vi.mock('../src/main/errorlog', () => ({ logError: logErrorMock }));
vi.mock('../src/main/paths', () => {
  const user = () => `${process.env.CERIMONIAS_DATA_DIR}/userData`;
  return {
    isPackaged: () => false,
    resourcesDir: () => '',
    claudeBin: () => undefined,
    sidecarDir: () => `${process.cwd()}/sidecar`,
    voiceVenvDir: () => `${user()}/voice-venv`,
    voiceModelsDir: () => `${user()}/voice-models`,
    voiceToolsDir: () => `${user()}/voice-tools`,
    legacyVenvDir: () => null,
    setPathsPort: () => undefined,
  };
});

const DATA = process.env.CERIMONIAS_DATA_DIR as string;
process.env.CERIMONIAS_AUDIO_DIR = join(DATA, 'audio');
const VENV = join(DATA, 'userData', 'voice-venv');

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: { write: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn(() => {
    child.emit('exit', null, 'SIGTERM');
    return true;
  });
  return child;
}

const children: ReturnType<typeof fakeChild>[] = [];
spawnMock.mockImplementation(() => {
  const child = fakeChild();
  children.push(child);
  return child;
});

function installFakeVenv() {
  mkdirSync(join(VENV, 'bin'), { recursive: true });
  writeFileSync(join(VENV, 'bin/python'), '#!/bin/sh\n');
  writeFileSync(join(VENV, '.cerimonias-ready'), new Date().toISOString());
}

let cfg: typeof import('../src/main/workspaceConfig');
let voice: typeof import('../src/main/voice');
let mod: typeof import('../src/main/voiceModule');
const SEGMENT = { text: 'oi', engine: 'edge', voice: 'v', rate: '+0%', pitch: '+0Hz', speed: 1, pauseMs: 0 } as const;

beforeAll(async () => {
  cfg = await import('../src/main/workspaceConfig');
  voice = await import('../src/main/voice');
  mod = await import('../src/main/voiceModule');
});

describe('voice off (the default of a fresh install)', () => {
  it('is off in the neutral config', () => {
    expect(cfg.getConfig().voice.enabled).toBe(false);
  });

  it('never spawns the sidecar: not at start, not on a request, not for a status check', async () => {
    voice.startVoice();
    await expect(voice.speakSegment('t', { ...SEGMENT })).rejects.toThrow(/voz está desligada/);
    await expect(voice.transcribe(new ArrayBuffer(8), [])).rejects.toBeInstanceOf(voice.VoiceOffError);
    expect(await voice.voiceStatus()).toEqual({ alive: false, ready: false, pingMs: null });
    expect(voice.planSpeech('Olá, tudo bem?', voice.MODERATOR, 'edge', { prosody: true, glossary: [] })).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('keeps off even when the dependencies are there', async () => {
    installFakeVenv();
    voice.startVoice();
    voice.syncVoice();
    await new Promise((r) => setTimeout(r, 30));
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe('voice on', () => {
  it('without the dependencies says so and spawns nothing (nothing is installed behind the back)', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(VENV, { recursive: true, force: true });
    cfg.updateConfig((c) => {
      c.voice.enabled = true;
      return c;
    });
    voice.startVoice();
    await vi.waitFor(() => expect(logErrorMock).toHaveBeenCalled());
    expect(String((logErrorMock.mock.calls[0][1] as Error).message)).toMatch(/não está instalada/);
    expect(spawnMock).not.toHaveBeenCalled();
    logErrorMock.mockClear();
  });

  it('spawns the sidecar of the installed environment with the model of the config', async () => {
    installFakeVenv();
    cfg.updateConfig((c) => {
      c.voice.enabled = true;
      c.voice.sttModel = 'tiny';
      return c;
    });
    voice.startVoice();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    const [python, args, options] = spawnMock.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(python).toBe(join(VENV, 'bin/python'));
    expect(args[0]).toMatch(/voice_sidecar\.py$/);
    expect(options.env.CERIMONIAS_WHISPER_MODEL).toBe('tiny');
    expect(voice.sidecarRunning().running).toBe(true);
    // a second start does not spawn a second one
    voice.startVoice();
    voice.syncVoice();
    await new Promise((r) => setTimeout(r, 30));
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('turning the switch off stops the sidecar without logging a failure, and nothing starts it again', async () => {
    const child = children[0];
    cfg.updateConfig((c) => {
      c.voice.enabled = false;
      return c;
    });
    voice.syncVoice();
    expect(child.kill).toHaveBeenCalled();
    expect(voice.sidecarRunning().running).toBe(false);
    expect(logErrorMock).not.toHaveBeenCalled();
    voice.startVoice();
    await expect(voice.transcribe(new ArrayBuffer(8), [])).rejects.toBeInstanceOf(voice.VoiceOffError);
    expect(children).toHaveLength(1);
  });
});

describe('the voice:* channels', () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const emitted: unknown[] = [];

  beforeAll(() => {
    mod.voiceModule({ handle: (channel, fn) => void handlers.set(channel, fn), emit: (ev) => void emitted.push(ev), notify: () => undefined, job: () => undefined });
  });

  const call = <T>(channel: string, ...args: unknown[]) => (handlers.get(channel) as (...a: unknown[]) => T)(...args);

  it('registers the setup channels', () => {
    for (const channel of ['voice:status', 'voice:check', 'voice:install', 'voice:install-cancel', 'voice:test', 'voice:uninstall', 'voice:enable']) expect(handlers.has(channel), channel).toBe(true);
  });

  it('enabling without the dependencies changes nothing and asks for the install', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(VENV, { recursive: true, force: true });
    expect(call('voice:enable', true)).toEqual({ enabled: false, needsInstall: true });
    expect(cfg.getConfig().voice.enabled).toBe(false);
  });

  it('enabling with them turns the switch on, starts the sidecar and tells the screens', async () => {
    installFakeVenv();
    const before = spawnMock.mock.calls.length;
    expect(call('voice:enable', true)).toEqual({ enabled: true, needsInstall: false });
    expect(cfg.getConfig().voice.enabled).toBe(true);
    expect(cfg.getConfig().voice.depsInstalled).toBe(true);
    await vi.waitFor(() => expect(spawnMock.mock.calls.length).toBe(before + 1));
    expect(emitted.some((e) => (e as { type: string; settings?: { voice: { enabled: boolean } } }).type === 'settings' && (e as { settings: { voice: { enabled: boolean } } }).settings.voice.enabled)).toBe(true);
    expect(call<{ enabled: boolean; running: boolean }>('voice:status')).toMatchObject({ enabled: true, running: true });
  });

  it('disabling stops the sidecar', () => {
    const child = children[children.length - 1];
    expect(call('voice:enable', false)).toEqual({ enabled: false, needsInstall: false });
    expect(child.kill).toHaveBeenCalled();
    expect(call<{ running: boolean }>('voice:status').running).toBe(false);
  });

  it('answers the wizard step: check takes its options object, every result carries a sentence in the app language', async () => {
    const check = await call<{ message: string; installed: { models: Record<string, boolean> } }>('voice:check', { engine: 'edge', sttModel: 'tiny' });
    expect(check.message.length).toBeGreaterThan(10);
    expect(check.installed.models).toHaveProperty('tiny');
    const refused = call<Promise<{ ok: boolean; code: string; message: string; detail: string }>>('voice:install', { engine: 'edge', sttModel: 'tiny' });
    await expect(refused).resolves.toMatchObject({ ok: false, code: 'edge-not-acknowledged', message: expect.stringContaining('Microsoft') });
    const unknown = await call<Promise<{ ok: boolean; code: string }>>('voice:install', { engine: 'edge', sttModel: 'medium', acknowledgeEdge: true });
    expect(unknown).toMatchObject({ ok: false, code: 'failed' });
    expect(call<boolean>('voice:install-cancel')).toBe(false);
  });

  it('the setup channels stay out of reach of a paired browser, the status does not', async () => {
    const { webAccess } = await import('../src/main/webPolicy');
    for (const channel of ['voice:check', 'voice:install', 'voice:install-cancel', 'voice:test', 'voice:uninstall', 'voice:enable']) expect(webAccess(channel), channel).toBe('deny');
    expect(webAccess('voice:status')).toBe('allow');
    expect(webAccess('voice:transcribe')).toBe('allow');
  });
});

describe('a migrated install', () => {
  it('keeps voice on with the dependencies it already had, and the author profile finds its Kokoro folder', async () => {
    const { installLegacyConfig } = await import('./helpers/config');
    const config = await installLegacyConfig();
    expect(config.voice.enabled).toBe(true);
    expect(config.voice.depsInstalled).toBe(true);
    expect(config.voice.sttModel).toBe('small');
    expect(config.voice.kokoroDir).toBe('~/models/kokoro');
    const { getSettings } = await import('../src/main/config');
    expect(getSettings().voice).toMatchObject({ enabled: true, depsInstalled: true, engine: 'edge', speak: true, bargeIn: true });
    const { tv } = await import('../src/shared/i18n');
    expect(tv('call.enter')).toBe('Entrar na call');
  });

  it('is not turned off by a Settings save from a screen that held the old copy', async () => {
    const { getSettings, saveSettings } = await import('../src/main/config');
    const s = getSettings();
    saveSettings({ ...s, voice: { ...s.voice, enabled: false, depsInstalled: false, speak: false } });
    expect(cfg.getConfig().voice.enabled).toBe(true);
    expect(cfg.getConfig().voice.depsInstalled).toBe(true);
    expect(cfg.getConfig().voice.speak).toBe(false);
  });
});
