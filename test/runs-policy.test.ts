import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, EXTERNAL_EFFECT, webAccess, webRefusal } from '../src/main/webPolicy';

const SRC = join(import.meta.dirname, '../src/main/runner');

// What a paired browser may do to a run: all of it. Reading, answering, and every move that starts a stage, decides a gate, retries, cancels, picks a squad, moves a run to the
// current flow, takes a comment back or switches an agent's autonomy. What a run may execute is still decided by the configuration, which a browser can only change in a scoped way.
const READS = ['runs:list', 'runs:get', 'runs:answer', 'runs:artifact'];
const MOVES = ['runs:start', 'runs:startStage', 'runs:accept', 'runs:return', 'runs:gate', 'runs:retry', 'runs:cancel', 'runs:skipWait', 'runs:migrateFlow', 'runs:undoPost', 'runs:setSquad', 'runs:removeSquad', 'runs:setSquadAutonomous', 'runs:setAutonomous'];
const OPEN = [...READS, ...MOVES];

const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
const source = (f: string) => readFileSync(join(SRC, f), 'utf8');

describe('web policy for the runs', () => {
  it('lets a paired browser read the runs, answer a question and make every move on a run', () => {
    for (const channel of OPEN) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(webRefusal(channel, false), channel).toBeNull();
      expect(DESKTOP_ONLY.has(channel), channel).toBe(false);
    }
  });

  it('lists no runs: channel as desktop-only', () => {
    expect([...DESKTOP_ONLY].filter((c) => c.startsWith('runs:'))).toEqual([]);
  });

  it('puts none of them behind the external-effects switch: nothing in a run reaches the code host', () => {
    for (const channel of OPEN) expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('keeps the approval of a proposal under the existing web setting', () => {
    expect(webAccess('actions:approve')).toBe('external');
    expect(webRefusal('actions:approve', false)).not.toBeNull();
    expect(webRefusal('actions:approve', true)).toBeNull();
  });

  it('are exactly the channels the module serves, each one classified here', () => {
    const served = [...source('module.ts').matchAll(/ctx\.handle\('(runs:[\w-]+)'/g)].map((m) => m[1]);
    expect(served.sort()).toEqual([...OPEN].sort());
  });
});

// What leaves the machine from a run goes through two files and nothing else: publish.ts decides what goes out (and plans each write with the provider),
// door.ts is where it leaves, through the proposals and the audit of Actions. Everything else in the runner still writes nothing and imports nothing that could.
const DOOR = 'door.ts';
const PUBLISHER = 'publish.ts';
const others = files.filter((f) => f !== DOOR);

describe('the runner writes to a code host through one door', () => {
  it('only the door imports the proposals of Actions or anything that runs a write; the publisher and the rest do not', () => {
    const importers = files.filter((f) => /from '\.\.\/actions'/.test(source(f)));
    expect(importers).toEqual([DOOR]);
    for (const f of others) {
      const text = source(f);
      expect(text, f).not.toMatch(/from '\.\.\/vcs\/(exec|runtime|validate)'/);
      expect(text, f).not.toMatch(/proposeVcsAction|proposeVcsGroup|proposeRunPush|runVcsAuto|approveAction|assertExternalWrite|externalRefusal/);
    }
    expect(source(DOOR)).not.toMatch(/from '\.\.\/vcs\/(exec|runtime|validate)'/);
    // the publisher gets the provider through the door and only knows its types
    expect(source(PUBLISHER)).not.toMatch(/from '\.\.\/vcs'/);
  });

  it('only the publisher plans a write, and only the door asks the workspace whether external writes are allowed', () => {
    expect(files.filter((f) => /\.planWrite\(|\bplanWrite\b/.test(source(f)))).toEqual([PUBLISHER]);
    expect(files.filter((f) => /externalRefusal|assertExternalWrite|isTestWorkspace/.test(source(f)))).toEqual([DOOR]);
  });

  it('has no git push anywhere: not a command it runs, and not a function it imports (the door proposes it, Actions runs it)', () => {
    for (const f of files) {
      const text = source(f);
      expect(text, f).not.toMatch(/'push'/);
      expect(text, f).not.toMatch(/pushBranch|assertPlainPush/);
    }
  });

  it('reads the code host through the provider only: the issue and its comments in the module, what the publisher needs and nothing that writes in the publisher', () => {
    const calls = (f: string) => new Set([...source(f).matchAll(/provider\.(\w+)\(/g)].map((m) => m[1]));
    expect(calls('module.ts')).toEqual(new Set(['getIssue', 'listIssueComments', 'listMyIssues']));
    expect(calls(PUBLISHER)).toEqual(new Set(['listIssueComments', 'listMrComments', 'listMrThreads', 'listMrChanges', 'getMr', 'getIssue', 'getRepo', 'linkedMrs', 'currentUser', 'planWrite', 'noteUrl']));
    for (const f of files.filter((x) => x !== 'module.ts' && x !== PUBLISHER)) expect(calls(f).size, f).toBe(0);
  });
});
