import { describe, expect, it } from 'vitest';
import { ceremoniesListed, buildCycleView, hostFacts, showContinueInClaude, showIssueStatus, showQuickActions, visibleTools } from '../src/shared/cycles';
import type { QuickTransitionRule } from '../src/shared/config/types';
import { hostConfig } from './helpers/config';

// What a screen shows or hides is decided here, from the host, the tools, the engines and the cycle: no screen has a host `if` of its own.

const TRANSITION: QuickTransitionRule = { to: 'In review', id: 7, label: 'STAGE::Review', from: ['In progress'], removable: [] };
const view = (kind: 'gitlab' | 'github' | 'bitbucket' | null, template = 'sdd') => buildCycleView(hostConfig(kind, { template }), { specs: true, noteTool: null });
const card = (paths: number) => ({ mrPaths: Array.from({ length: paths }, (_, i) => ({ ref: `app#${i}`, project: 'acme/app', iid: i })) });

describe('the Quick actions screen', () => {
  it('has the issue status block only on a host with a status the cycle moves', () => {
    const gitlab = hostConfig('gitlab');
    expect(showIssueStatus(hostFacts(gitlab))).toBe(false);
    gitlab.devCycle.quickTransitions = [TRANSITION];
    expect(showIssueStatus(hostFacts(gitlab))).toBe(true);
    for (const kind of ['github', 'bitbucket'] as const) {
      const c = hostConfig(kind);
      c.devCycle.quickTransitions = [TRANSITION];
      expect(showIssueStatus(hostFacts(c)), kind).toBe(false);
    }
  });

  it('is reachable from an activity that has a change request, or a status to move, and from none without a host', () => {
    expect(showQuickActions(card(1), view('github').host)).toBe(true);
    expect(showQuickActions(card(0), view('github').host)).toBe(false);
    const gitlab = hostConfig('gitlab');
    gitlab.devCycle.quickTransitions = [TRANSITION];
    expect(showQuickActions(card(0), hostFacts(gitlab))).toBe(true);
    expect(showQuickActions(card(2), view(null).host)).toBe(false);
  });

  it('knows which hosts have manual jobs and replace reviewers', () => {
    expect(view('gitlab').host).toMatchObject({ manualJobs: true, reviewerReplaces: true });
    expect(view('github').host).toMatchObject({ manualJobs: false, reviewerReplaces: false });
    expect(view('bitbucket').host).toMatchObject({ manualJobs: false, reviewerReplaces: false });
  });
});

describe('the tool switches of Settings', () => {
  it('lists the agent read switch only with an integration, and the tracker MCP switch only with a server', () => {
    expect(visibleTools(view(null).host)).toEqual(['files', 'skills', 'subagents']);
    expect(visibleTools(view('github').host)).toEqual(['files', 'skills', 'glab', 'subagents']);
    const c = hostConfig('bitbucket');
    c.agents.tools.trackerMcpServer = 'tracker';
    expect(visibleTools(hostFacts(c))).toEqual(['files', 'skills', 'gitlabMcp', 'glab', 'subagents']);
  });

  it('says what the read switch governs: the CLI of the host, or the app tool when it has none', () => {
    expect(view('gitlab').host.cli).toBe('glab');
    expect(view('github').host.cli).toBe('gh');
    expect(view('bitbucket').host.cli).toBeNull();
    const api = hostConfig('github');
    api.vcs[0].cliPreference = 'api';
    expect(hostFacts(api).cli).toBeNull();
    expect(hostFacts(api).readSwitch).toBe(true);
  });
});

describe('Continue in Claude Code', () => {
  it('is offered for the sessions of the Claude engine and hidden for the open engine', () => {
    const c = hostConfig('github');
    c.llm.providers.push({ ...c.llm.providers[0], id: 'local', kind: 'openai-compatible', engine: 'open' });
    expect(showContinueInClaude(hostFacts(c), 'deep')).toBe(true);
    c.llm.roles.deep = { provider: 'local', model: 'm' };
    expect(showContinueInClaude(hostFacts(c), 'deep')).toBe(false);
    expect(showContinueInClaude(hostFacts(c), 'turn')).toBe(true);
    // the reply role answers a turn in the same session
    c.llm.roles.reply = { provider: 'local', model: 'm' };
    expect(showContinueInClaude(hostFacts(c), 'turn')).toBe(false);
  });
});

describe('the ceremonies the Help screen lists', () => {
  it('lists what the cycle has: Kanban has no gate, QA hand-off or return from testing', () => {
    const sdd = ceremoniesListed(view('github', 'sdd'));
    expect(sdd).toMatchObject({ preDaily: true, gate: true, qaHandoff: true, retro: true, qaReturn: true, host: true });
    const kanban = ceremoniesListed(view('github', 'kanban'));
    expect(kanban).toMatchObject({ gate: false, qaHandoff: false, qaReturn: false });
    expect(kanban.retro).toBe(true);
  });

  it('lists nothing that reads the host when there is no integration', () => {
    expect(ceremoniesListed(view(null)).host).toBe(false);
  });

  it('a cycle without a specs folder has no gate or QA hand-off to describe', () => {
    const noSpecs = buildCycleView(hostConfig('github'), { specs: false, noteTool: null });
    expect(ceremoniesListed(noSpecs)).toMatchObject({ gate: false, qaHandoff: false });
  });
});

describe('what the cards say they come from', () => {
  it('is the card source tool when there is one, else the host', () => {
    expect(buildCycleView(hostConfig('github'), { specs: true, noteTool: 'cards-tool' }).cardsFrom).toBe('cards-tool');
    expect(buildCycleView(hostConfig('github'), { specs: true, noteTool: null }).cardsFrom).toBe('GitHub');
  });
});
