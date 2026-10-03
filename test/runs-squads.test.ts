// The moves of a run that has a squad: starting in one, starting with the squad undecided and deciding it (by the agent's proposal or the person's choice),
// leaving it, and the file format of what a run keeps about it.
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { squadView } from '../src/shared/config/squads';
import { answer, askSquad, flowOf, flowOfRun, leaveSquad, parseRun, routeSquad, startRun, type FlowStage, type Run } from '../src/shared/runs';
import { at, startInput } from './helpers/runs';
import { withSquads } from './helpers/squads';

const config = withSquads(neutralConfig());
const flowFor = (squad: string): FlowStage[] => {
  const view = squadView(config, squad);
  return flowOf(view, view.devCycle.stages);
};
const workspaceFlow = flowOf(config);
// A flow whose first stage no agent works: a wait for a label.
const intake = { id: 'intake', label: 'Intake', match: [], kind: 'backlog' as const, rank: 0, type: 'wait' as const, waitsFor: { kind: 'label' as const, label: 'ready' } };
const noFrontDoor = flowOf(config, [intake, ...config.devCycle.stages]);
const refuses = (fn: () => unknown, code: string): void => expect(fn).toThrow(expect.objectContaining({ code }));

describe('starting a run in a squad', () => {
  it('records the squad and how it was found, with the flow the caller resolved', () => {
    const { run, messages } = startRun(startInput({ squad: { id: 'b', name: 'Squad B', rule: 'repo' } }), flowFor('b'), at(0));
    expect([run.squad, run.routedBy, run.routing ?? null, run.status, run.stage]).toEqual(['b', 'repo', null, 'working', 'triage']);
    expect(run.flow?.stages.map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(messages.map((m) => m.code)).toEqual(['run.started', 'run.squad.routed.repo', 'run.stage.started']);
    expect(run.history.map((h) => [h.type, h.detail])).toContainEqual(['squad-routed', 'repo:b']);
  });

  it('with the squad undecided it starts at the front door of the workspace\'s flow, with its candidates', () => {
    const { run, messages } = startRun(startInput({ routing: { candidates: ['a', 'b'], why: 'several' } }), workspaceFlow, at(0));
    expect(run.squad ?? null).toBeNull();
    expect(run.routing).toEqual({ candidates: ['a', 'b'], why: 'several', proposal: null, result: null });
    expect(run).toMatchObject({ status: 'working', stage: 'triage' });
    expect(messages.map((m) => m.code)).toEqual(['run.started', 'run.squad.triage.several', 'run.stage.started']);
  });

  it('with nobody at the front door it asks the person at once', () => {
    const { run } = startRun(startInput({ routing: { candidates: ['a', 'b'], why: 'none' } }), noFrontDoor, at(0));
    expect(run).toMatchObject({ status: 'question', stage: 'intake', question: { kind: 'squad', by: 'app' } });
    expect(run.stages).toEqual([expect.objectContaining({ stage: 'intake', status: 'waiting', attempts: 0 })]);
  });
});

describe('deciding the squad', () => {
  const front = { by: 'support', summary: 'Triaged.', handoff: 'Go ahead.', artifacts: ['0_TRIAGE.md'] };
  const started = (): Run => startRun(startInput({ routing: { candidates: ['a', 'b'], why: 'several' } }), workspaceFlow, at(0)).run;

  it('asking the person holds what the front door produced, and the words of a person do not answer it', () => {
    const asked = askSquad(started(), { ...front, proposal: { squad: 'b', reason: 'The web.' } }, at(1));
    expect(asked.run).toMatchObject({ status: 'question', question: { kind: 'squad', by: 'support', holder: null } });
    expect(asked.run.routing).toMatchObject({ proposal: { squad: 'b', by: 'support', reason: 'The web.' }, result: { summary: 'Triaged.', artifacts: ['0_TRIAGE.md'] } });
    expect(asked.messages.map((m) => [m.kind, m.code ?? 'post', m.public])).toEqual([['post', 'post', true], ['question', 'run.squad.ask.proposal', true]]);
    refuses(() => answer(asked.run, workspaceFlow, 'b', at(2)), 'wrong-state');
    expect(askSquad(started(), { ...front, proposal: null }, at(1)).messages[1].code).toBe('run.squad.ask');
  });

  it('refuses to decide what is not undecided', () => {
    const plain = startRun(startInput(), workspaceFlow, at(0)).run;
    refuses(() => routeSquad(plain, { squad: 'a', name: 'A', flow: flowFor('a'), by: 'person', reason: '', how: 'person' }, at(1)), 'wrong-state');
    refuses(() => askSquad(plain, { ...front, proposal: null }, at(1)), 'wrong-state');
    const asked = askSquad(started(), { ...front, proposal: null }, at(1)).run;
    refuses(() => askSquad(asked, { ...front, proposal: null }, at(2)), 'wrong-state');
  });

  it('the choice enters the stage after the front door in the squad\'s flow, and what the front door said goes with it', () => {
    const asked = askSquad(started(), { ...front, proposal: null }, at(1)).run;
    const chosen = routeSquad(asked, { squad: 'b', name: 'Squad B', flow: flowFor('b'), by: 'person', reason: '', how: 'person' }, at(2));
    const run = chosen.run;
    expect([run.squad, run.routedBy, run.routing, run.question, run.stage, run.status]).toEqual(['b', 'person', null, null, 'implement', 'working']);
    expect(run.flow?.stages.map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(run.stages.find((s) => s.stage === 'triage')).toMatchObject({ status: 'done', artifacts: ['0_TRIAGE.md'] });
    expect(chosen.messages.map((m) => m.code ?? m.kind)).toEqual(['run.squad.chosen', 'handoff', 'run.stage.started']);
    expect(chosen.messages[1]).toMatchObject({ kind: 'handoff', to: 'dev-b', text: 'Go ahead.' });
    // the agents the run reads are the squad's, with the stages of its flow
    expect(flowOfRun(run, config).find((s) => s.id === 'implement')?.agent).toBe('dev-b');
    expect(flowOfRun(run, config).map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
  });

  it('the agent that runs by itself decides while its stage ends: the run goes on at once, with the post once', () => {
    const decided = routeSquad(started(), { squad: 'a', name: 'Squad A', flow: flowFor('a'), by: 'support', reason: 'The app.', how: 'agent', result: front }, at(1));
    expect([decided.run.squad, decided.run.routedBy, decided.run.stage, decided.run.status]).toEqual(['a', 'agent', 'implement', 'working']);
    expect(decided.messages.map((m) => m.code ?? m.kind)).toEqual(['run.squad.proposed', 'post', 'handoff', 'run.stage.started']);
  });

  it('a squad flow that ends at the front door ends the run; one that lacks it starts at its first stage; a front door that never ran is skipped', () => {
    const short = flowFor('a').map((s) => (s.id === 'triage' ? { ...s, next: null } : s));
    expect(routeSquad(started(), { squad: 'a', name: 'A', flow: short, by: 'support', reason: '', how: 'agent', result: front }, at(1)).run.status).toBe('done');
    const lacking = flowFor('a').filter((s) => s.id !== 'triage');
    expect(routeSquad(started(), { squad: 'a', name: 'A', flow: lacking, by: 'support', reason: '', how: 'agent', result: front }, at(1)).run.stage).toBe('implement');
    const gone = startRun(startInput({ routing: { candidates: ['a'], why: 'none' } }), noFrontDoor, at(0)).run;
    const out = routeSquad(gone, { squad: 'a', name: 'A', flow: flowFor('a'), by: 'person', reason: '', how: 'person' }, at(1)).run;
    expect(out.stages[0]).toMatchObject({ stage: 'intake', status: 'skipped' });
    expect(out.stages.map((s) => s.stage)).toEqual(['intake', 'triage']);
  });

  it('the person may go on with no squad: the run keeps the flow it has', () => {
    const asked = askSquad(started(), { ...front, proposal: null }, at(1)).run;
    const out = routeSquad(asked, { squad: null, name: 'none', flow: workspaceFlow, by: 'person', reason: '', how: 'person' }, at(2)).run;
    expect([out.squad, out.routedBy, out.stage]).toEqual([null, null, 'implement']);
  });

  it('leaving a squad clears it and keeps the flow the run follows', () => {
    const run = startRun(startInput({ squad: { id: 'b', name: 'Squad B', rule: 'repo' } }), flowFor('b'), at(0)).run;
    const left = leaveSquad(run, at(1));
    expect([left.run.squad, left.run.routedBy, left.run.flow?.stages.length]).toEqual([null, null, 4]);
    expect(left.messages[0]).toMatchObject({ code: 'run.squad.removed', params: { squad: 'b' } });
    expect(flowOfRun(left.run, config).map((s) => s.id)).toEqual(['triage', 'implement', 'security', 'ready']);
  });
});

describe('the file of a run in a squad', () => {
  const roundTrip = (run: Run) => parseRun(JSON.parse(JSON.stringify(run)));

  it('is read back with its squad and its routing, and a run with neither reads as before', () => {
    const asked = askSquad(startRun(startInput({ routing: { candidates: ['a', 'b'], why: 'several' } }), workspaceFlow, at(0)).run, { by: 'support', summary: 's', handoff: '', artifacts: [], proposal: { squad: 'a', reason: 'r' } }, at(1)).run;
    const back = roundTrip(asked);
    expect(back.ok && back.run.routing?.proposal).toEqual({ squad: 'a', by: 'support', reason: 'r' });
    const inSquad = roundTrip(startRun(startInput({ squad: { id: 'a', name: 'A', rule: 'label' } }), flowFor('a'), at(0)).run);
    expect(inSquad.ok && [inSquad.run.squad, inSquad.run.routedBy]).toEqual(['a', 'label']);
    const plain = roundTrip(startRun(startInput(), workspaceFlow, at(0)).run);
    expect(plain.ok && plain.run.squad).toBeUndefined();
  });

  it('refuses a squad that is not an id, and a route that is not one of the known', () => {
    const run = startRun(startInput({ squad: { id: 'a', name: 'A', rule: 'label' } }), flowFor('a'), at(0)).run;
    expect(roundTrip({ ...run, squad: 'Not An Id' }).ok).toBe(false);
    expect(roundTrip({ ...run, routedBy: 'magic' as never }).ok).toBe(false);
    expect(roundTrip({ ...run, routing: { candidates: ['a'], why: 'maybe' as never, proposal: null, result: null } }).ok).toBe(false);
  });
});
