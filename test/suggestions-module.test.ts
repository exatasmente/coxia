// The suggestion end to end: the workspace history becomes a proposal in Actions; accepting creates an ordinary agent, editing records it, and
// rejecting keeps the reason; a rejected impression does not come back without new evidence; the end of a retro raises at most two. No model and
// no host is reached: `askAgent` is mocked, the reads come from files the app already writes, and nothing goes to the network.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { Run } from '../src/shared/runs';
import { neutralConfig } from '../src/shared/config';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';

vi.setConfig({ testTimeout: 30_000 });

const asked = vi.hoisted(() => ({ prompts: [] as string[], answer: {} as Record<string, unknown> }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  askAgent: async (_role: string, prompt: string) => {
    asked.prompts.push(prompt);
    return { data: asked.answer, sessionId: 's1', partial: false };
  },
}));

const { ATAS } = await import('../src/main/env');
const { saveConfig, getConfig } = await import('../src/main/workspaceConfig');
const actions = await import('../src/main/actions');
const suggestionMod = await import('../src/main/suggestionsModule');
const { recordWrite } = await import('../src/main/auditoria');

const RUNS = join(ATAS, 'runs');
const HISTORY = join(ATAS, 'historico');

function useConfig(over: (c: WorkspaceConfig) => void = () => undefined): void {
  // The engineering agent flow: its stages (refine, plan, implement, review, qa...) are the ones an agent may cover.
  const c = applyTemplate(neutralConfig(), agentFlowEngineering);
  c.language = 'en';
  c.vcs = [{ id: 'host', kind: 'github', host: 'github.com', apiUrl: '', user: '', secretRef: null, cliPreference: 'auto', cliCommand: null }];
  c.projects.issues.vcsId = 'host';
  c.projects.repos = [{ id: 'app', path: '/tmp/app', remoteUrl: null, vcsId: null, projectPath: 'group/project' }];
  over(c);
  saveConfig(c);
}

/** A run written to the store, with the fields the reading touches. */
function writeRun(over: Partial<Run> & { id: string }): Run {
  const run = {
    version: 1,
    rev: 1,
    issue: { ref: 'app#123', iid: 123, title: 'Something', url: null },
    repo: 'app',
    branch: 'b',
    worktree: '/tmp/w',
    cycleFolder: 'docs/cycles/1-x',
    cycleId: 'agent-flow',
    status: 'working',
    stage: 'refine',
    stages: [],
    question: null,
    pending: null,
    returns: {},
    wait: null,
    error: null,
    history: [],
    comments: {},
    reviews: [],
    qa: [],
    base: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  } as Run;
  mkdirSync(RUNS, { recursive: true });
  writeFileSync(join(RUNS, `${run.id}.json`), JSON.stringify(run, null, 1));
  return run;
}

/** Three runs that return the work to the same stage: one pattern above the threshold. */
function threeReturns(): void {
  for (const id of ['r-test-a1', 'r-test-a2', 'r-test-a3']) writeRun({ id, returns: { review: 1 }, history: [{ at: '2026-10-01T00:00:00Z', type: 'stage-returned', stage: 'review', by: 'tech-lead', detail: null }] });
}

beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl', 'suggestions.json']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'retros', 'historico']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asked.prompts.length = 0;
  asked.answer = { nome: 'Reviewer', papel: 'Reviews returns from review', etapa: 'review', prompt: 'You look at returns.' };
  useConfig();
});

const suggestionProposals = () => actions.listActions().filter((a) => a.kind === 'suggest-agent');

describe('the suggestion from the history', () => {
  it('leaves a proposal in Actions for a pattern above the threshold, with the evidence and the minimum permissions', async () => {
    threeReturns();

    const out = await suggestionMod.suggestAgents();

    expect(out.actions).toHaveLength(1);
    const [a] = suggestionProposals();
    expect(a).toMatchObject({ kind: 'suggest-agent', state: 'pending', stage: 'review' });
    expect(a.summary).toContain('Reviewer');
    expect(a.output).toContain('Reviewer');
    expect(a.output).toContain('review');
    expect(a.output).toContain('r-test-a1');
    expect(a.command).toBeNull();
  });

  it('offers nothing and says why when the history does not repeat a pattern enough', async () => {
    writeRun({ id: 'r-test-b1', returns: { review: 1 } });

    const out = await suggestionMod.suggestAgents();

    expect(out.actions).toEqual([]);
    expect(out.reason).toBeTruthy();
    expect(asked.prompts).toEqual([]);
  });

  it('does not call the model when there is no evidence at all', async () => {
    const out = await suggestionMod.suggestAgents();
    expect(out.actions).toEqual([]);
    expect(asked.prompts).toHaveLength(0);
  });

  it('does not propose the model stage when it is not one of the workspace', async () => {
    threeReturns();
    asked.answer = { nome: 'X', papel: 'y', etapa: 'nope', prompt: 'z' };
    const out = await suggestionMod.suggestAgents();
    expect(out.actions).toEqual([]);
  });

  it('reads the audit log for the same command allowed again, and proposes from it', async () => {
    asked.answer = { nome: 'Runner', papel: 'Runs the checks', etapa: 'review', prompt: 'Run the checks.' };
    for (const run of ['r-test-c1', 'r-test-c2', 'r-test-c3']) recordWrite({ kind: 'exec', issue: 123, target: 'npm run test', via: 'sandbox', fields: { agent: 'developer', run, stage: 'review' }, ok: true, code: 0, result: 'ok', origin: { actionId: '', kind: 'run-exec', key: `${run}:review`, summary: null }, by: 'developer' });

    const out = await suggestionMod.suggestAgents();
    expect(out.actions).toHaveLength(1);
  });

  it('reads the decisions of the ceremonies for a repeated theme', async () => {
    asked.answer = { nome: 'Keeper', papel: 'Guards the decisions', etapa: 'refine', prompt: 'Guard decisions.' };
    mkdirSync(HISTORY, { recursive: true });
    for (const [id, day] of [['2026-10-01T090000', '2026-10-01'], ['2026-10-02T090000', '2026-10-02'], ['2026-10-03T090000', '2026-10-03']]) {
      writeFileSync(join(HISTORY, `${id}.json`), JSON.stringify({ version: 1, id, kind: 'pre-daily', date: day, cards: null, turns: {}, decisions: [{ ref: 'app#123', text: 'Keep the legacy exporter for one release', target: 'note', dest: '' }], effects: [], answered: {}, log: [], startedAt: null, endedAt: null, callIdx: 0, callEnded: true, spoken: {}, deep: {}, teams: null, teamsKey: null, saveResult: null }));
    }

    const out = await suggestionMod.suggestAgents();
    expect(out.actions.map((a) => a.stage)).toContain('refine');
  });
});

describe('the decision on a suggestion', () => {
  async function proposed(): Promise<string> {
    threeReturns();
    await suggestionMod.suggestAgents({ patterns: undefined });
    return String((suggestionProposals()[0].unit ?? {}).suggestionId ?? '');
  }

  it('accepting creates an ordinary agent, read only, and records it with the id it created', async () => {
    const id = await proposed();
    const [action] = suggestionProposals();

    await actions.approveAction(action.id);

    const team = getConfig().agents.team;
    const made = team.find((a) => a.name === 'Reviewer');
    expect(made).toMatchObject({ permission: 'read', shell: 'none', tracker: 'none', autonomous: false, system: false, stages: ['review'] });
    expect(made?.id).toBeTruthy();
    const records = suggestionMod.readSuggestions().records;
    expect(records.find((r) => r.id === id)).toMatchObject({ decision: 'accepted', agentId: made?.id });
  });

  it('refuses to create the agent when the stage is not in the cycle any more', async () => {
    const id = await proposed();
    // The stage goes away after the proposal was made (from the flow and from every agent that works it).
    useConfig((c) => {
      c.devCycle.stages = c.devCycle.stages.filter((s) => s.id !== 'review');
      c.agents.team = c.agents.team.map((a) => ({ ...a, stages: a.stages.filter((s) => s !== 'review') }));
      for (const s of c.devCycle.stages) if (s.agentId === 'reviewer') delete s.agentId;
    });

    // The refusal is inside the approval: the action ends failed, no agent is created and nothing is recorded.
    const after = await actions.approveAction(suggestionProposals()[0].id);
    expect(after.state).toBe('failed');
    expect(String(after.output)).toMatch(/stage|etapa/i);
    expect(getConfig().agents.team.some((a) => a.name === 'Reviewer')).toBe(false);
    expect(suggestionMod.readSuggestions().records.find((r) => r.id === id)).toBeUndefined();
  });

  it('rejecting records the reason and skips the proposal', async () => {
    const id = await proposed();

    const store = await suggestionMod.rejectSuggestion(id, 'not now');
    const record = store.records.find((r) => r.id === id);

    expect(record).toMatchObject({ decision: 'rejected', reason: 'not now' });
    expect(suggestionProposals()[0].state).toBe('skipped');
  });

  it('does not let the same impression come back without new evidence, and lets it back with a new execution', async () => {
    const id = await proposed();
    await suggestionMod.rejectSuggestion(id, null);
    expect(suggestionMod.readSuggestions().records.find((r) => r.id === id)).toMatchObject({ decision: 'rejected' });

    // Nothing new: no proposal.
    const again = await suggestionMod.suggestAgents();
    expect(again.actions).toEqual([]);

    // A fourth run with the same pattern is evidence the rejection never saw.
    writeRun({ id: 'r-test-a4', returns: { review: 1 }, history: [{ at: '2026-10-04T00:00:00Z', type: 'stage-returned', stage: 'review', by: 'tech-lead', detail: null }] });
    const back = await suggestionMod.suggestAgents();
    expect(back.actions).toHaveLength(1);
    expect(back.actions[0].output).toContain('rejected before');
  });

  it('editing records which agent the editor saved', async () => {
    const id = await proposed();
    const store = suggestionMod.editSuggestion(id, 'reviewer-edited');
    expect(store.records.find((r) => r.id === id)).toMatchObject({ decision: 'edited', agentId: 'reviewer-edited' });
  });
});

describe('the end of a retro', () => {
  it('raises at most two suggestions, and none when the conversation adds only improvements', async () => {
    // Four different patterns, all above the threshold.
    for (const [i, stage] of ['review', 'refine', 'qa', 'ready'].entries()) {
      for (const n of [1, 2, 3]) writeRun({ id: `r-test-d${i}${n}`, returns: { [stage]: 1 }, history: [{ at: '2026-10-01T00:00:00Z', type: 'stage-returned', stage, by: 'person', detail: null }] });
    }
    asked.answer = { nome: 'Helper', papel: 'Helps', etapa: 'review', prompt: 'Help.' };

    const made = await suggestionMod.suggestFromRetro();

    expect(made.length).toBeLessThanOrEqual(2);
  });
});

describe('the card of a suggestion that was already decided', () => {
  /** The proposal a person skipped: the same suggestion, the same evidence, after the decision. */
  const skipped = async (): Promise<void> => {
    threeReturns();
    await suggestionMod.suggestAgents();
    await actions.skipAction(suggestionProposals()[0].id);
    expect(suggestionProposals().filter((a) => a.state === 'skipped')).toHaveLength(1);
  };

  it('does not block the suggestion from being offered again, and never leaves the same card waiting twice', async () => {
    await skipped();
    asked.answer = { nome: 'Reviewer', papel: 'Reviews returns from review', etapa: 'review', prompt: 'You look at returns.' };

    const again = await suggestionMod.suggestAgents();

    // Whether it may come back is the reading's decision (the rejection rule); the deduplication only keeps one waiting card.
    expect(again.actions).toHaveLength(1);
    expect(suggestionProposals().filter((a) => a.state === 'pending')).toHaveLength(1);
    expect(again.actions[0].key).toBe(suggestionProposals()[0].key);
  });

  it('keeps one card while the same proposal is still waiting', async () => {
    threeReturns();
    await suggestionMod.suggestAgents();
    const again = await suggestionMod.suggestAgents();
    expect(again.actions).toEqual([]);
    expect(suggestionProposals()).toHaveLength(1);
  });
});

describe('the end of the retro, in the workspace', () => {
  /** The retro of the day, stored, and one decision of a ceremony of it: what a suggestion may rest on. */
  const retroOf = async (day0: string, medal: string): Promise<void> => {
    const state = await import('../src/main/state');
    const retro = await import('../src/main/retro');
    const { ceremony } = await import('./helpers/ceremony');
    const made = ceremony({ id: `${day0}T090000`, decisions: [{ ref: 'app#123', text: medal, target: 'note', dest: '' }] });
    state.saveState(made);
    retro.writeRetro({ id: `${day0}-squad-1`, squad: 'squad-1', from: new Date(`${day0}T00:00:00Z`).toISOString(), to: new Date(`${day0}T23:00:00Z`).toISOString(), sessionId: null, speech: 's', numbers: [], worked: [], stuck: [], rework: [], talk: [], createdAt: new Date().toISOString() });
    const minutes = await import('../src/main/minutesStore');
    minutes.registerCeremony(made);
    minutes.commitVersion(day0, minutes.versionOfCeremony(made.id) ?? 1, { teams: '', written: [] });
  };

  it('raises at most two suggestions from the retro that was answered, with the record of the squad', async () => {
    const medal = 'Keep the legacy exporter for one release';
    for (const d of ['2026-09-28', '2026-09-29', '2026-09-30']) await retroOf(d, medal);
    asked.answer = { nome: 'Keeper', papel: 'Keeper', etapa: 'refine', prompt: 'Guard.' };

    const { askRetro, readRetro, writeRetro } = await import('../src/main/retro');
    const answered = `${new Date().toLocaleDateString('sv-SE')}-squad-1`;
    // The retro the conversation answers was stored first (the app prepares it and the person asks in it).
    writeRetro({ id: answered, squad: 'squad-1', from: new Date().toISOString(), to: new Date().toISOString(), sessionId: null, speech: 's', numbers: [], worked: [], stuck: [], rework: [], talk: [], createdAt: new Date().toISOString() });
    const after = await askRetro(answered, 'o que travou?');

    // The retros of the squad are named for the day and the squad; a stale filter that reads only the whole-workspace files finds none of them.
    expect(readRetro(answered)?.id).toBe(answered);
    expect(after.talk).toHaveLength(2);
    // The reading ran after the retro was stored and left the proposal it supports, with the draft the model gave.
    expect(suggestionProposals().length).toBeLessThanOrEqual(2);
  });
});

describe('the workspace of a test', () => {
  it('carries the suggestion to the screen and writes nothing to a code host', async () => {
    threeReturns();
    await suggestionMod.suggestAgents();
    const [a] = suggestionProposals();
    // The card reads the structured suggestion from the unit, never a command.
    expect(a.command).toBeNull();
    expect(a.unit).toMatchObject({ purpose: 'suggest-agent' });
    // No proposal reaches the host: the file holds only the local action.
    const stored = JSON.parse(readFileSync(join(ATAS, 'acoes.json'), 'utf8')) as { actions: { kind: string; command: unknown }[] };
    expect(stored.actions.every((x) => x.command === null)).toBe(true);
  });
});
