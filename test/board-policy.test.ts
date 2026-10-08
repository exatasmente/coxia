import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const FILE = join(import.meta.dirname, '../src/main/board.ts');
const source = readFileSync(FILE, 'utf8');

// The board of a workspace with no code host: its six channels are the workspace's own file, so a paired browser may use them, and nothing in the
// file proposes, runs or approves a write to a code host. The guard that refuses a workspace of test lives in the handler, not in this policy.

const CHANNELS = ['board:list', 'board:create', 'board:update', 'board:comment', 'board:close', 'board:reopen'];

describe('web policy for the board', () => {
  it('gives a paired browser every channel of the board', () => {
    for (const channel of CHANNELS) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
  });

  it('are exactly the channels the module serves, each one classified here', () => {
    const served = [...source.matchAll(/ctx\.handle\('(board:[\w-]+)'/g)].map((m) => m[1]);
    expect(served.sort()).toEqual([...CHANNELS].sort());
  });
});

describe('the board writes nothing to a code host', () => {
  it('never proposes, runs or approves a host write, and every changing handler goes through the external-write guard', () => {
    expect(source).not.toMatch(/from '\.\/vcs\/(exec|runtime|validate)'/);
    expect(source).not.toMatch(/proposeVcsAction|proposeVcsGroup|proposeRunPush|runVcsAuto|approveAction|externalRefusal|isTestWorkspace/);
    // Opening, moving, commenting, prioritising, giving to a squad and closing a card all pass the same guard as the rest of the app.
    expect([...source.matchAll(/assertExternalWrite\(/g)]).toHaveLength(CHANNELS.length - 1);
  });
});
