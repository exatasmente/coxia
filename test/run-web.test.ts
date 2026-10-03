import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { webAccess } from '../src/main/webPolicy';
import { RUN_ACTIONS, type RunActionId, runActions } from '../src/shared/runs/view';
import { RUN_STATUSES } from '../src/shared/runs';

// The run screens in a paired browser: what the screen offers is what the web policy lets through, and every channel the screens call exists.

const CYCLE = join(import.meta.dirname, '../src/renderer/src/screens/cycle');
const source = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8');

/** The channel each button of the run screen calls (the gate's three buttons share one). */
const CHANNEL: Record<RunActionId, string> = {
  startStage: 'runs:startStage',
  accept: 'runs:accept',
  return: 'runs:return',
  approve: 'runs:gate',
  reject: 'runs:gate',
  skip: 'runs:gate',
  answer: 'runs:answer',
  chooseSquad: 'runs:setSquad',
  skipWait: 'runs:skipWait',
  sendBack: 'runs:sendBack',
  retry: 'runs:retry',
  cancel: 'runs:cancel',
};

describe('the run screen in a browser', () => {
  it('offers no button whose channel a paired browser is refused', () => {
    const question = { by: 'developer', holder: null, kind: 'agent' as const, text: 'x', askedAt: '', stage: 'plan' };
    const seen = new Set<RunActionId>();
    for (const status of RUN_STATUSES) {
      for (const question_ of [null, question, { ...question, kind: 'squad' as const }]) {
        for (const a of runActions({ status, question: question_ })) {
          seen.add(a.id);
          expect(webAccess(CHANNEL[a.id]), `${status}/${a.id}`).toBe('allow');
        }
      }
    }
    expect([...seen].sort()).toEqual([...RUN_ACTIONS].sort());
  });

  it('lets the browser read what the screens show: the runs, the documents, the thread, the configuration and the proposals', () => {
    for (const channel of ['runs:list', 'runs:get', 'runs:artifact', 'forum:list', 'forum:read', 'forum:post', 'forum:create', 'config:get', 'actions:list']) expect(webAccess(channel), channel).toBe('allow');
  });

  it('lets the switches of autonomy, the squad choice, the undo, the flow move and the start through', () => {
    for (const channel of ['runs:setAutonomous', 'runs:setSquadAutonomous', 'runs:setSquad', 'runs:removeSquad', 'runs:undoPost', 'runs:migrateFlow', 'runs:start', 'runs:startStage']) expect(webAccess(channel), channel).toBe('allow');
  });

  it('has no desktop-only branch left: no screen of the cycle reads the platform, and no text says the app on the computer must do it', () => {
    for (const f of readdirSync(CYCLE).filter((n) => /\.tsx?$/.test(n))) {
      const text = source(CYCLE, f);
      expect(text, f).not.toMatch(/isWeb\(|platform'|desktopOnly|\bweb[=:}]/);
    }
  });

  it('calls only channels that exist: each runs: and forum: channel in the screens is served by a module', () => {
    const served = new Set<string>();
    for (const [dir, file] of [['../src/main/runner', 'module.ts'], ['../src/main', 'forum.ts']]) for (const m of source(join(import.meta.dirname, dir), file).matchAll(/ctx\.handle\('((?:runs|forum):[\w-]+)'/g)) served.add(m[1]);
    const used = new Set<string>();
    for (const f of readdirSync(CYCLE).filter((n) => /\.tsx?$/.test(n))) for (const m of source(CYCLE, f).matchAll(/'((?:runs|forum):[\w-]+)'/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((c) => !served.has(c))).toEqual([]);
  });
});

describe('the team and cycle settings in a browser', () => {
  const TEAM = join(import.meta.dirname, '../src/renderer/src/screens/team');

  it('saves through the scoped channel in a browser and through config:save in the window, both of which the policy classifies as it should', () => {
    const text = source(TEAM, 'teamApi.ts');
    expect(text).toMatch(/isWeb\(\) \? 'config:cycle-save' : 'config:save'/);
    expect(webAccess('config:cycle-save')).toBe('allow');
    expect(webAccess('config:save')).toBe('deny');
  });

  it('shows the section in a browser too: no note in its place, and the runner tab keeps the commands, the folder and the identity read-only there', () => {
    expect(source(TEAM, 'TeamSettings.tsx')).not.toMatch(/isWeb|webNote/);
    const runner = source(TEAM, 'RunnerSection.tsx');
    expect(runner).toMatch(/isWeb\(\)/);
    expect(runner).toMatch(/runnerOfWeb\(draft, config\.runner\)/);
    expect(runner).toMatch(/!web && \(/);
  });
});
