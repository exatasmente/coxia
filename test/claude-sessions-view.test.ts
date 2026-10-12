// What the Claude Code sessions screen says (#280): the three groups, the lines of the open session, the controls (Stop for the app's turn, End only for a process the app
// started, the note of a copy), the pending permission requests of the session, the refusals in words, and the navigation row only when the feature is on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../src/shared/i18n';
import type { ActivityEntry } from '../src/shared/activity';
import type { ClaudeSessionsList } from '../src/shared/claudeSessions';
import { applyLines, asksFor, refusalText, sessionControls, sessionGroups } from '../src/renderer/src/claudeSessionsView';
import { navGroups } from '../src/renderer/src/home';

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));

const list = (over: Partial<ClaudeSessionsList> = {}): ClaudeSessionsList => ({
  cli: 'ok',
  reason: '',
  transcripts: [{ sessionId: 's-1', title: 'Fix the build', firstPrompt: 'fix it', cwd: '/work/app', branch: 'main', lastModified: 1 }],
  running: [{ pid: 1, sessionId: 's-2', cwd: '/work/app', kind: 'interactive', status: 'busy', updatedAt: 2 }],
  background: [{ pid: 2, sessionId: 's-3', cwd: '/work/site', kind: 'background', status: 'idle', updatedAt: 3 }],
  owned: [],
  ...over,
});
const entry = (seq: number, label: string): ActivityEntry => ({ seq, runId: 's-1', jobId: 'claude:s-1', role: 'claude', at: 0, kind: 'answer', label });

describe('the list', () => {
  it('groups transcripts, running and background sessions with their details', () => {
    const g = sessionGroups(list(), t, (ms) => `t${ms}`);
    expect(g.transcripts).toEqual([{ id: 's-1', title: 'Fix the build', meta: '/work/app · main · t1' }]);
    expect(g.running).toEqual([{ id: 's-2', title: '/work/app', meta: 'Working · t2' }]);
    expect(g.background).toEqual([{ id: 's-3', title: '/work/site', meta: 'Idle · t3' }]);
  });
});

describe('the open session', () => {
  it('replaces or appends the lines of the open session only', () => {
    const one = applyLines([], { of: 's-1', mode: 'replace', entries: [entry(1, 'a')] }, 's-1');
    const two = applyLines(one, { of: 's-1', mode: 'append', entries: [entry(2, 'b')] }, 's-1');
    expect(two.map((e) => e.label)).toEqual(['a', 'b']);
    expect(applyLines(two, { of: 's-9', mode: 'replace', entries: [] }, 's-1')).toEqual(two);
  });

  it('offers Stop while the app\'s turn runs, End only for a process the app started, and says when messages go to a copy', () => {
    expect(sessionControls(list(), 's-2')).toEqual({ canStop: false, canEnd: false, copy: false });
    const owned = list({ owned: [{ sessionId: 'copy-1', cwd: '/work/app', busy: true, forked: true, of: 's-1' }] });
    expect(sessionControls(owned, 's-1')).toEqual({ canStop: true, canEnd: true, copy: true });
  });

  it('shows the permission requests of the session and of its copy', () => {
    const owned = list({ owned: [{ sessionId: 'copy-1', cwd: '/w', busy: true, forked: true, of: 's-1' }] });
    const asks = [
      { id: 'p1', sessionId: 'copy-1', tool: 'Bash', input: '{}', since: '' },
      { id: 'p2', sessionId: 's-9', tool: 'Edit', input: '{}', since: '' },
    ];
    expect(asksFor(asks, owned, 's-1').map((a) => a.id)).toEqual(['p1']);
  });

  it('says a refusal in words, and nothing for a call that went through', () => {
    expect(refusalText({ ok: true, sessionId: 's', forked: false }, t)).toBeNull();
    expect(refusalText({ ok: false, reason: 'test-workspace' }, t)).toBe('This is a test workspace: sending and starting are refused.');
    expect(refusalText({ ok: false, reason: 'failed', message: 'no login' }, t)).toBe('Claude Code refused: no login');
  });
});

describe('the navigation', () => {
  const rows = (claude?: boolean) => navGroups(undefined, false, claude).flatMap((g) => g.rows.map((r) => r.id));

  it('has no row for the sessions while the feature is off, the default', () => {
    expect(rows()).not.toContain('claudeSessions');
    expect(rows(false)).not.toContain('claudeSessions');
  });

  it('lists the sessions among the app\'s screens when it is on', () => {
    expect(rows(true)).toContain('claudeSessions');
  });
});
