import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { addAgent, removeAgent } from '../src/shared/config/team';
import type { WorkspaceConfig } from '../src/shared/config/types';

// The module list pulls in every feature module, and the app's build info reads Electron at load: this file gives it what it needs before the list is read.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] } }));

// The profiles of the logged-in browsers follow the team: an agent that leaves the config (the editor, an import, a template) takes its profile with it, at once or as
// soon as the screen that holds it lets go, and an orphan found at the start is deleted.

const { ATAS } = await import('../src/main/env');
const { configLoadedCleanly, getConfig, reloadConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { browserModule, syncProfiles } = await import('../src/main/browser/module');
const { browserRoot, ensureProfile, openProfile, profileLocks } = await import('../src/main/browser/profile');
const { moduleList } = await import('../src/main/modules');

const noCtx = { handle: vi.fn(), notify: vi.fn(), emit: vi.fn(), job: vi.fn() };
let stop: (() => void)[] = [];

const withTeam = (...ids: string[]): WorkspaceConfig => ids.reduce((c, id) => addAgent(c, { id, name: id, screen: true, browserProfile: true }), neutralConfig());
const profile = (id: string): string => join(browserRoot(ATAS), id);
const made = (id: string): string => {
  const dir = ensureProfile(ATAS, id);
  writeFileSync(join(dir, 'Cookies'), 'a session');
  return dir;
};

beforeEach(() => {
  rmSync(browserRoot(ATAS), { recursive: true, force: true });
  saveConfig(withTeam('scout', 'writer'));
});
afterEach(() => {
  for (const fn of stop) fn();
  stop = [];
  rmSync(browserRoot(ATAS), { recursive: true, force: true });
  reloadConfig();
});

describe('the profiles and the team', () => {
  it('is among the modules the app registers', () => {
    expect(moduleList()).toContain(browserModule);
  });

  it('deletes at the start the profile of an agent that is not in the config, and keeps the ones that are', () => {
    made('scout');
    made('ghost');
    writeFileSync(join(browserRoot(ATAS), 'stray.txt'), 'x');
    browserModule(noCtx);
    expect(readdirSync(browserRoot(ATAS))).toEqual(['scout']);
  });

  it('deletes the profile when the config drops the agent, and a new agent with the same id starts with none', () => {
    browserModule(noCtx);
    made('scout');
    made('writer');
    saveConfig(removeAgent(getConfig(), 'scout'));
    expect(existsSync(profile('scout'))).toBe(false);
    expect(existsSync(profile('writer'))).toBe(true);
    saveConfig(addAgent(getConfig(), { id: 'scout', name: 'Scout' }));
    expect(readdirSync(ensureProfile(ATAS, 'scout'))).toEqual([]);
  });

  it('keeps the profile of an agent whose switch is turned off: only the agent leaving, Revoke or the profile\'s deletion take it away', () => {
    browserModule(noCtx);
    made('scout');
    const next = structuredClone(getConfig());
    const agent = next.agents.team.find((a) => a.id === 'scout')!;
    delete agent.browserProfile;
    delete agent.screen;
    saveConfig(next);
    expect(existsSync(join(profile('scout'), 'Cookies'))).toBe(true);
  });

  it('leaves a profile a screen holds while its agent is removed, and deletes it when the screen lets go', () => {
    browserModule(noCtx);
    made('scout');
    const opened = openProfile(ATAS, 'scout', 'run:r1');
    expect(opened.ok).toBe(true);
    saveConfig(removeAgent(getConfig(), 'scout'));
    expect(existsSync(profile('scout'))).toBe(true);
    if (opened.ok) opened.release();
    expect(existsSync(profile('scout'))).toBe(false);
    expect(profileLocks.holder(profile('scout'))).toBeNull();
  });

  it('leaves every profile alone when the config did not load as written, at the start and after', () => {
    made('scout');
    made('writer');
    made('ghost');
    // An unreadable file: the config in memory is the repair's, and its team is nobody's.
    writeFileSync(join(ATAS, 'config.json'), '{ not json');
    reloadConfig();
    expect(configLoadedCleanly()).toBe(false);
    browserModule(noCtx);
    expect(readdirSync(browserRoot(ATAS)).sort()).toEqual(['ghost', 'scout', 'writer']);
    expect(syncProfiles()).toEqual([]);
    expect(readdirSync(browserRoot(ATAS)).sort()).toEqual(['ghost', 'scout', 'writer']);
    // The person saves a config of their own: nothing was dropped by it, so nothing goes.
    saveConfig(withTeam('scout'));
    expect(configLoadedCleanly()).toBe(true);
    expect(readdirSync(browserRoot(ATAS)).sort()).toEqual(['ghost', 'scout', 'writer']);
    // A file that parses but does not pass the check is the same case.
    writeFileSync(join(ATAS, 'config.json'), JSON.stringify({ schemaVersion: 1, agents: 'wrong' }));
    reloadConfig();
    expect(syncProfiles()).toEqual([]);
    expect(readdirSync(browserRoot(ATAS)).sort()).toEqual(['ghost', 'scout', 'writer']);
  });

  it('deletes on a change only the profiles of the agents that left, not the ones the config never named', () => {
    browserModule(noCtx);
    made('scout');
    made('writer');
    made('ghost');
    saveConfig(removeAgent(getConfig(), 'writer'));
    expect(readdirSync(browserRoot(ATAS)).sort()).toEqual(['ghost', 'scout']);
  });

  it('syncs on demand for an import that replaced the team, and never throws', () => {
    made('scout');
    made('ghost');
    mkdirSync(join(ATAS, 'browser', 'x'), { recursive: true });
    expect(syncProfiles(withTeam('scout')).sort()).toEqual(['ghost', 'x']);
    expect(readdirSync(browserRoot(ATAS))).toEqual(['scout']);
    rmSync(browserRoot(ATAS), { recursive: true });
    expect(syncProfiles()).toEqual([]);
  });
});
