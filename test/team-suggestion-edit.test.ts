// The "edit" path of a suggestion: the draft the Actions card sends must reach the agent editor in Settings › Team, and it must not be
// delivered twice. The section needs a browser to render, so the state a request produces is a pure function (`viewOfRequest`) and the
// section is checked for keeping the draft instead of cancelling it in the same pass.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentDraft } from '../src/renderer/src/screens/team/agentEdit';
import { openAgentDraft, openTeamSettings, takeTeamRequest, viewOfRequest } from '../src/renderer/src/screens/team/teamNav';

const SOURCE = join(import.meta.dirname, '../src/renderer/src/screens/team/TeamSettings.tsx');

const draft = (): AgentDraft => ({ id: 'reviewer', name: 'Reviewer', job: 'Reviews returns from review', instructions: 'You look at returns.', model: { role: 'deep', provider: '', model: '' }, permission: 'read', tracker: 'none', shell: 'none', allowedCommands: [], autonomous: false, squad: null, turnsTo: null, stages: ['review'] });

/** The state the section holds after applying one request, the way its effect does. */
function afterRequest(request: { tab: 'team'; draft: { draft: AgentDraft; suggestionId: string } }): ReturnType<typeof viewOfRequest> {
  return viewOfRequest(request as never);
}

beforeEach(() => {
  // Nothing waits between the cases.
  takeTeamRequest();
});

describe('the request the suggestion card sends to the editor', () => {
  it('carries the draft to the team tab, with the suggestion id it came from', () => {
    const sent = draft();
    openAgentDraft(sent, 's-1');

    const r = takeTeamRequest();
    expect(r).toMatchObject({ tab: 'team', draft: { suggestionId: 's-1' } });
    expect(r?.draft?.draft).toEqual(sent);

    const view = viewOfRequest(r!);
    expect(view.tab).toBe('team');
    // The draft survives the mapping: it reaches the state the section passes to the panel.
    expect(view.suggestion?.draft).toEqual(sent);
    expect(view.suggestion?.suggestionId).toBe('s-1');
  });

  it('keeps the draft the section is given, and no second value cancels it in the same pass', () => {
    const view = afterRequest({ tab: 'team', draft: { draft: draft(), suggestionId: 's-2' } });
    // One value, not an empty one written after it: the panel would otherwise never open filled in.
    expect(view.suggestion?.draft.name).toBe('Reviewer');
    expect(view.suggestion?.draft.stages).toEqual(['review']);
  });

  it('is spent once: a second read of the same request finds nothing', () => {
    openAgentDraft(draft(), 's-3');
    expect(takeTeamRequest()).not.toBeNull();
    expect(takeTeamRequest()).toBeNull();
  });

  it('leaves no draft for a request that only opens a tab', () => {
    openTeamSettings('flow', 'core');
    const r = takeTeamRequest();
    expect(r).toMatchObject({ tab: 'flow', squad: 'core' });
    expect(viewOfRequest(r!).suggestion).toBeUndefined();
  });

  it('writes the suggestion state once per request in the section', () => {
    // The regression was two writes in the same pass: `setSuggestion(draft)` followed by `setSuggestion(undefined)`. One write of the
    // view, taken from the request, is what the section does now.
    const source = readFileSync(SOURCE, 'utf8');
    const effect = /const take = \(\) => \{([\s\S]*?)\n    \};/.exec(source)?.[1] ?? '';
    expect(effect).not.toBe('');
    expect(effect.match(/setSuggestion\(/g) ?? []).toHaveLength(1);
    expect(effect).toContain('viewOfRequest');
  });
});
