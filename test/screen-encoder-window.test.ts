// The real window behind the encoder host, with Electron replaced by an object that records what it was asked: the settings that keep a hidden window that runs a page
// harmless (sandboxed, isolated, its own in-memory partition, nothing to navigate to, every permission refused), the channel it speaks on and the check of who spoke.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCREEN_ENCODER_COMMAND, SCREEN_ENCODER_EVENT } from '../src/shared/screen';

const made = vi.hoisted(() => ({ windows: [] as unknown[], listeners: new Map<string, (e: { sender: { id: number } }, raw: unknown) => void>() }));

vi.mock('electron', () => {
  class FakeWindow {
    options: Record<string, any>;
    destroyed = false;
    sent: unknown[][] = [];
    handlers = new Map<string, (...a: any[]) => void>();
    loaded: string | null = null;
    permissions: { request: ((...a: any[]) => void) | null; check: (() => boolean) | null } = { request: null, check: null };
    openHandler: (() => { action: string }) | null = null;
    webContents = {
      id: 42,
      setWindowOpenHandler: (h: () => { action: string }) => void (this.openHandler = h),
      on: (event: string, h: (...a: any[]) => void) => void this.handlers.set(`wc:${event}`, h),
      session: { setPermissionRequestHandler: (h: (...a: any[]) => void) => void (this.permissions.request = h), setPermissionCheckHandler: (h: () => boolean) => void (this.permissions.check = h) },
      send: (...a: unknown[]) => void this.sent.push(a),
    };
    constructor(options: Record<string, any>) {
      this.options = options;
      made.windows.push(this);
    }
    on(event: string, h: (...a: any[]) => void): void {
      this.handlers.set(`w:${event}`, h);
    }
    loadFile(path: string): Promise<void> {
      this.loaded = path;
      return Promise.resolve();
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return {
    BrowserWindow: FakeWindow,
    app: { isPackaged: false },
    ipcMain: {
      on: (channel: string, h: (e: { sender: { id: number } }, raw: unknown) => void) => void made.listeners.set(channel, h),
      removeListener: (channel: string) => void made.listeners.delete(channel),
    },
  };
});

type Fake = {
  options: { show: boolean; webPreferences: Record<string, unknown> };
  destroyed: boolean;
  sent: unknown[][];
  handlers: Map<string, (...a: any[]) => void>;
  loaded: string | null;
  permissions: { request: (...a: any[]) => void; check: () => boolean };
  openHandler: () => { action: string };
};

beforeEach(() => {
  made.windows.length = 0;
  made.listeners.clear();
});

async function make(gone = vi.fn()) {
  const { realEncoderEnv } = await import('../src/main/screen/encoderWindow');
  const env = realEncoderEnv();
  const win = env.create(gone);
  return { env, win, fake: made.windows[0] as Fake, gone };
}

describe('the encoder window', () => {
  it('is hidden, sandboxed and isolated, with a bridge of its own and a partition that is not kept', async () => {
    const { fake } = await make();
    expect(fake.options.show).toBe(false);
    expect(fake.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false });
    // A partition without `persist:` lives in memory only.
    expect(String(fake.options.webPreferences.partition)).not.toMatch(/^persist:/);
    expect(fake.options.webPreferences.partition).toBeTruthy();
    expect(String(fake.options.webPreferences.preload)).toMatch(/preload[\\/]encoder\.cjs$/);
  });

  it('loads the page that ships with the app, and nothing it can navigate to or open', async () => {
    const { fake } = await make();
    expect(fake.loaded).toMatch(/resources[\\/]encoder\.html$/);
    expect(fake.openHandler()).toEqual({ action: 'deny' });
    const prevented = vi.fn();
    fake.handlers.get('wc:will-navigate')?.({ preventDefault: prevented });
    fake.handlers.get('wc:will-attach-webview')?.({ preventDefault: prevented });
    expect(prevented).toHaveBeenCalledTimes(2);
  });

  it('refuses every permission it is asked for or asked about', async () => {
    const { fake } = await make();
    const answer = vi.fn();
    fake.permissions.request({}, 'media', answer);
    expect(answer).toHaveBeenCalledWith(false);
    expect(fake.permissions.check()).toBe(false);
  });

  it('is told apart by its id, and what it is sent goes on the encoder\'s channel only', async () => {
    const { win, fake } = await make();
    expect(win.id).toBe(42);
    win.send({ op: 'close', rec: 1 });
    expect(fake.sent).toEqual([[SCREEN_ENCODER_COMMAND, { op: 'close', rec: 1 }]]);
    win.destroy();
    win.destroy();
    expect(fake.destroyed).toBe(true);
    win.send({ op: 'close', rec: 2 });
    expect(fake.sent).toHaveLength(1);
  });

  it('is reported gone when its process dies or it is closed', async () => {
    const gone = vi.fn();
    const { fake } = await make(gone);
    fake.handlers.get('wc:render-process-gone')?.();
    fake.handlers.get('w:closed')?.();
    expect(gone).toHaveBeenCalledTimes(2);
  });

  it('hears the page on its own channel and passes the id of the window that spoke, so the host can check it', async () => {
    const { env } = await make();
    const heard: [number, unknown][] = [];
    const stop = env.listen((id, raw) => heard.push([id, raw]));
    made.listeners.get(SCREEN_ENCODER_EVENT)?.({ sender: { id: 9 } }, { ev: 'ready' });
    expect(heard).toEqual([[9, { ev: 'ready' }]]);
    stop();
    expect(made.listeners.has(SCREEN_ENCODER_EVENT)).toBe(false);
  });
});

describe('what the page and the bridge are', () => {
  const root = join(import.meta.dirname, '..');
  const page = readFileSync(join(root, 'resources', 'encoder.html'), 'utf8');
  const bridge = readFileSync(join(root, 'src', 'preload', 'encoder.ts'), 'utf8');

  it('is a page that loads nothing and may run only its own script', () => {
    expect(page).toContain(`content="default-src 'none'; script-src 'unsafe-inline'"`);
    expect(page).not.toMatch(/\b(src|href)\s*=/i);
    expect(page).not.toMatch(/\b(fetch|XMLHttpRequest|WebSocket|importScripts|eval)\s*\(/);
  });

  it('is bridged to exactly two functions on the two channels, and nothing else of the app', () => {
    expect(bridge).toContain("exposeInMainWorld('enc'");
    expect(bridge).toContain('SCREEN_ENCODER_COMMAND');
    expect(bridge).toContain('SCREEN_ENCODER_EVENT');
    expect([...bridge.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])).toEqual(['onCommand', 'send']);
    expect(bridge).not.toMatch(/ipcRenderer\.invoke|require\(/);
  });

  it('is not a channel of the app\'s modules, which is all a paired browser or the main window can call', () => {
    const modules = readFileSync(join(root, 'src', 'main', 'modules.ts'), 'utf8');
    expect(modules).not.toContain('screen-encoder');
    for (const file of ['encoderHost.ts', 'encoderWindow.ts']) expect(readFileSync(join(root, 'src', 'main', 'screen', file), 'utf8')).not.toMatch(/ctx\.handle\(/);
  });
});
