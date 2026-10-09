import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';
import { neutralConfig } from '../../src/shared/config';
import type { WorkspaceConfig } from '../../src/shared/config/types';
import { createScreenAsks } from '../../src/main/browser/asks';
import { screenGrants } from '../../src/main/browser/guard';
import { createHostsTally } from '../../src/main/browser/hosts';
import type { BrowserRuntime, BrowserStartOptions } from '../../src/main/browser/launch';
import { createProfileLocks, openProfile } from '../../src/main/browser/profile';
import { type ClosedScreen, type ScreenSessions, createScreenSessions } from '../../src/main/browser/sessions';
import { fakeServer } from './browserServer';

// The screen sessions of the app over a scripted browser: the real registry, caps, locks and closing order, with a fake server instead of a Playwright MCP and no sandbox. What a
// test of a stage or an answer needs to see is what the agent was offered, what the browser was started with, and the order in which things ended.

export interface FakeScreens {
  sessions: ScreenSessions;
  asks: ReturnType<typeof createScreenAsks>;
  server: ReturnType<typeof fakeServer>;
  /** What each browser was started with, in order. */
  starts: BrowserStartOptions[];
  /** The order of what happened: `start`, `close`, `recording:<key>`, `onClose`... */
  log: string[];
  /** The lines the sessions wrote in threads. */
  lines: { thread: string; stage: string; code: string; params: Record<string, string> }[];
  /** The screens that closed, with what was kept. */
  kept: ClosedScreen[];
  /** The key and thread of every screen opened on the hub. */
  hubOpened: unknown[];
  config: WorkspaceConfig;
  dispose(): void;
}

export function fakeScreens(o: { configure?: (c: WorkspaceConfig) => void; test?: boolean; browsers?: boolean; keep?: 'kept' | 'not'; ownDisplay?: string; startGate?: Promise<void>; watch?: boolean } = {}): FakeScreens {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'coxia-fake-screens-')));
  const config = neutralConfig();
  config.runner.sandbox.display = true;
  o.configure?.(config);
  const log: string[] = [];
  const starts: BrowserStartOptions[] = [];
  const lines: FakeScreens['lines'] = [];
  const kept: ClosedScreen[] = [];
  const hubOpened: unknown[] = [];
  const server = fakeServer();
  const locks = createProfileLocks();
  const asks = createScreenAsks({ changed: () => undefined, audit: () => undefined });
  const hub = {
    open: vi.fn(async (screen: unknown) => {
      hubOpened.push(screen);
      log.push('hub.open');
      return o.watch !== false;
    }),
    finish: vi.fn(async (key: string) => {
      log.push(`hub.finish:${key}`);
      return null;
    }),
    end: vi.fn((key: string) => void log.push(`hub.end:${key}`)),
    state: vi.fn(() => ({ stage: '', width: 1280, height: 800, since: '', control: false, recording: 'waiting' as const })),
  };
  const sessions = createScreenSessions({
    enabled: true,
    config: () => config,
    browsers: () => (o.browsers === false ? { ok: false, why: 'unset' } : { ok: true, browsers: '/b', chromium: '/b/chrome' }),
    sandboxReady: async () => true,
    dir: join(root, 'sandbox'),
    grants: (agent) => screenGrants(agent, o.test ?? false),
    openProfile: (agent, owner) => openProfile(root, agent, owner, { locks }),
    start: async (options) => {
      await o.startGate;
      starts.push(options);
      log.push('start');
      const runtime: BrowserRuntime = {
        client: Object.assign(server.client, { onClose: () => undefined }) as unknown as BrowserRuntime['client'],
        display: options.display ? { ...options.display, own: false } : { socket: o.ownDisplay ?? join(root, 'own/X77'), name: 'X77', own: true },
        network: options.network,
        hosts: createHostsTally(),
        profile: { dir: options.profile ?? join(root, 'throwaway'), fresh: options.profile === null },
        sessionDir: join(root, 'sandbox/s1'),
        close: async () => void log.push('close'),
      };
      return runtime;
    },
    asks,
    hub,
    say: (thread, stage, code, params) => void lines.push({ thread, stage, code, params }),
    keepRecording: async (screen) => {
      log.push(`recording:${screen.key}`);
      kept.push(screen);
      return o.keep ?? 'kept';
    },
  });
  return { sessions, asks, server, starts, log, lines, kept, hubOpened, config, dispose: () => rmSync(root, { recursive: true, force: true }) };
}
