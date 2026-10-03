import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import { addSquad, newSquad, setAgentSquad } from '../src/shared/config/squads';
import { addAgent } from '../src/shared/config/team';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { createTranslator } from '../src/shared/i18n';
import { flowIssueText } from '../src/shared/runs';
import {
  applyFlows, chainRename, checkFlows, draftOfFlows, dropOwnFlow, duplicateStage, giveOwnFlow, insertStage, moveBy, moveStage, newStageId, ownsFlow, patchStage, removeStage, renameStage,
  stageFieldProblems, stagesOfTarget, withStages,
} from '../src/renderer/src/screens/team/flowEdit';

const ids = (stages: StageDef[]) => stages.map((s) => s.id);
const config = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlowEngineering);
const stage = (c: WorkspaceConfig, id: string) => c.devCycle.stages.find((s) => s.id === id)!;

describe('reordering the list', () => {
  const stages = () => config().devCycle.stages;

  it('moves a stage to a position and numbers the ranks again', () => {
    const next = moveStage(stages(), 4, 1);
    expect(ids(next)).toEqual(['refine', 'implement', 'gate1', 'plan', 'gate2', 'review', 'qa', 'ready']);
    expect(next.map((s) => s.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('moves one step up or down, and stops at the ends', () => {
    expect(ids(moveBy(stages(), 'plan', -1)).slice(0, 3)).toEqual(['refine', 'plan', 'gate1']);
    expect(ids(moveBy(stages(), 'plan', 1)).slice(0, 4)).toEqual(['refine', 'gate1', 'gate2', 'plan']);
    expect(moveBy(stages(), 'refine', -1)).toEqual(stages());
    expect(moveBy(stages(), 'ready', 1)).toEqual(stages());
    expect(moveBy(stages(), 'nope', 1)).toEqual(stages());
  });

  it('a reorder moves what the list decides: the next stage and the stage to return to follow the order', () => {
    const c = config();
    c.devCycle.stages = moveStage(c.devCycle.stages, 6, 5); // qa before review
    const checks = checkFlows(c, draftOfFlows(c), null);
    expect(checks.errors).toBe(0);
    expect(ids(c.devCycle.stages).slice(5, 7)).toEqual(['qa', 'review']);
  });
});

describe('adding, duplicating and removing', () => {
  it('adds a stage between two, with an id that is free and the meaning of the one before', () => {
    const { stages, id } = insertStage(config().devCycle.stages, 4, 'work', 'Security review');
    expect(id).toBe('work');
    expect(ids(stages).slice(4, 7)).toEqual(['implement', 'work', 'review']);
    expect(stages[5]).toMatchObject({ label: 'Security review', type: 'work', kind: 'development', rank: 6 });
    expect(insertStage(stages, 5, 'work', 'Again').id).toBe('work-2');
  });

  it('a gate and a wait get what they need: a wait waits for the merge until told otherwise', () => {
    const base = config().devCycle.stages;
    expect(insertStage(base, 0, 'gate', 'G').stages[1]).toMatchObject({ type: 'gate' });
    expect(insertStage(base, 0, 'wait', 'W').stages[1]).toMatchObject({ type: 'wait', waitsFor: { kind: 'pr-merged' } });
  });

  it('a stage added at the start comes first, and one after a review does not become a review', () => {
    const base = config().devCycle.stages;
    expect(ids(insertStage(base, -1, 'work', 'First').stages)[0]).toBe('work');
    expect(insertStage(base, 5, 'work', 'After review').stages[6].kind).toBe('development');
  });

  it('keeps the flow connected when the stage before named where it goes next', () => {
    const base = patchStage(config().devCycle.stages, 'implement', { next: 'review' });
    const { stages, id } = insertStage(base, 4, 'work', 'Extra');
    expect(stages.find((s) => s.id === 'implement')?.next).toBe(id);
    expect(stages.find((s) => s.id === id)?.next).toBe('review');
  });

  it('duplicates right after the stage, without what it produces or where it goes next', () => {
    const base = patchStage(config().devCycle.stages, 'review', { next: 'qa' });
    const { stages, id } = duplicateStage(base, 'review', 'Review (copy)');
    expect(id).toBe('review-copy');
    expect(ids(stages).slice(5, 8)).toEqual(['review', 'review-copy', 'qa']);
    const copy = stages[6];
    expect(copy).toMatchObject({ label: 'Review (copy)', agentId: 'reviewer', returnsTo: 'implement' });
    expect(copy.produces).toBeUndefined();
    expect(copy.next).toBeUndefined();
    expect(duplicateStage(stages, 'review', 'x').id).toBe('review-copy-2');
  });

  it('removes a stage and leaves what pointed at it pointing, for the check to say', () => {
    const c = config();
    c.devCycle.stages = patchStage(removeStage(c.devCycle.stages, 'implement'), 'review', { returnsTo: 'implement' });
    const rows = checkFlows(c, draftOfFlows(c), null).rows;
    expect(rows.map((i) => `${i.code}:${i.stage}`)).toContain('returns-nowhere:review');
    expect(checkFlows(c, draftOfFlows(c), null).errors).toBeGreaterThan(0);
  });

  it('finds a free id', () => {
    expect(newStageId(config().devCycle.stages, 'qa')).toBe('qa-2');
    expect(newStageId(config().devCycle.stages, 'fresh')).toBe('fresh');
  });
});

describe('changing a stage', () => {
  it('sets a field and removes it when the value is undefined', () => {
    let s = patchStage(config().devCycle.stages, 'review', { roundLimit: 5 });
    expect(s.find((x) => x.id === 'review')?.roundLimit).toBe(5);
    s = patchStage(s, 'review', { roundLimit: undefined });
    expect('roundLimit' in s.find((x) => x.id === 'review')!).toBe(false);
  });

  it('renames an id with every next and returnsTo that named it', () => {
    const s = renameStage(patchStage(config().devCycle.stages, 'refine', { next: 'plan' }), 'plan', 'planning');
    expect(ids(s)).toContain('planning');
    expect(s.find((x) => x.id === 'refine')?.next).toBe('planning');
    expect(renameStage(s, 'implement', 'build').find((x) => x.id === 'review')?.returnsTo).toBe('build');
  });

  it('chains renames and drops one that goes back to where it began', () => {
    expect(chainRename({}, 'a', 'b')).toEqual({ a: 'b' });
    expect(chainRename({ a: 'b' }, 'b', 'c')).toEqual({ a: 'c' });
    expect(chainRename({ a: 'b' }, 'b', 'a')).toEqual({});
    expect(chainRename({ a: 'b' }, 'x', 'y')).toEqual({ a: 'b', x: 'y' });
  });
});

describe('the fields of a stage on their own', () => {
  const s = (over: Partial<StageDef>): StageDef => ({ id: 'x', label: 'X', match: [], kind: 'development', rank: 1, type: 'work', ...over });
  const keys = (over: Partial<StageDef>, list: StageDef[] = []) => stageFieldProblems([s(over), ...list], s(over)).map((p) => `${p.field}:${p.key.split('.').pop()}`);

  it('is quiet for a good stage', () => {
    expect(keys({ produces: ['1_SPEC.md'], roundLimit: 2, comment: 'refine', trackerStatus: 'in-flow' })).toEqual([]);
  });

  it('flags the id, the file names, the limits and the comment key', () => {
    expect(keys({ id: 'Bad Id' })).toEqual(['id:idShape']);
    expect(keys({}, [s({})])).toEqual(['id:idTaken']);
    expect(keys({ produces: ['.hidden', 'a/b.md'] })).toEqual(['produces:file', 'produces:file']);
    expect(keys({ reads: ['a.md', 'a.md'] })).toEqual(['reads:fileTwice']);
    expect(keys({ roundLimit: 0 })).toEqual(['roundLimit:roundLimit']);
    expect(keys({ roundLimit: 21 })).toEqual(['roundLimit:roundLimit']);
    expect(keys({ type: 'wait', waitsFor: { kind: 'time', minutes: 0 } })).toEqual(['waitsFor:minutes']);
    expect(keys({ comment: 'Not A Key' })).toEqual(['comment:commentKey']);
    expect(keys({ trackerStatus: 'x'.repeat(201) })).toEqual(['trackerStatus:trackerStatus']);
  });

  it('agrees with the schema about what a file name is', () => {
    for (const file of ['1_SPEC.md', 'a.b-c_d.txt', '.hidden', 'a/b', '-a', 'a b', 'ü.md']) {
      const c = config();
      c.devCycle.stages = patchStage(c.devCycle.stages, 'refine', { produces: [file] });
      const schemaOk = validateConfig(c).errors.every((e) => !e.path.includes('produces'));
      expect(stageFieldProblems(c.devCycle.stages, stage(c, 'refine')).length === 0, file).toBe(schemaOk);
    }
  });
});

describe('one flow per squad', () => {
  const withSquad = (): WorkspaceConfig => {
    let c = config();
    c = addSquad(c, newSquad({ id: 'core', name: 'Core' }));
    return setAgentSquad(setAgentSquad(c, 'developer', 'core'), 'qa', 'core');
  };

  it('a squad follows the workspace flow until it is given one of its own, and goes back when it drops it', () => {
    const c = withSquad();
    let d = draftOfFlows(c);
    expect(ownsFlow(d, 'core')).toBe(false);
    expect(stagesOfTarget(d, 'core')).toBe(d.workspace);
    d = giveOwnFlow(d, 'core');
    expect(ownsFlow(d, 'core')).toBe(true);
    expect(stagesOfTarget(d, 'core')).toEqual(d.workspace);
    expect(stagesOfTarget(d, 'core')).not.toBe(d.workspace);
    d = withStages(d, 'core', removeStage(stagesOfTarget(d, 'core'), 'gate2'));
    expect(ids(applyFlows(c, d).devCycle.flows!.core)).not.toContain('gate2');
    expect(ids(applyFlows(c, d).devCycle.stages)).toContain('gate2');
    expect(applyFlows(c, dropOwnFlow(d, 'core')).devCycle.flows).toBeUndefined();
  });

  it('a flow of a squad the config no longer has is not written', () => {
    const c = config();
    const d = withStages(draftOfFlows(c), 'ghost', c.devCycle.stages);
    expect(applyFlows(c, d).devCycle.flows).toBeUndefined();
  });
});

describe('the config a draft makes', () => {
  it('keeps agents and what refers to a stage in step: a rename follows, a removal drops', () => {
    const c = config();
    c.devCycle.comments = { implement: { title: 't', status: 's', sections: [], technicalDetail: false } };
    c.devCycle.stageMapping = [{ provider: 'github', source: 'label', name: '', pattern: 'x', stage: 'implement' }];
    let d = draftOfFlows(c);
    d = { ...d, workspace: renameStage(d.workspace, 'implement', 'build'), renames: chainRename(d.renames, 'implement', 'build') };
    d = { ...d, workspace: patchStage(d.workspace, 'build', { agentId: 'developer' }) };
    const next = applyFlows(c, d);
    expect(next.agents.team.find((a) => a.id === 'developer')?.stages).toEqual(['build']);
    expect(Object.keys(next.devCycle.comments)).toEqual(['build']);
    expect(next.devCycle.stageMapping[0].stage).toBe('build');
    const gone = applyFlows(c, { ...draftOfFlows(c), workspace: removeStage(c.devCycle.stages, 'implement') });
    expect(gone.devCycle.stageMapping).toEqual([]);
    expect(gone.agents.team.find((a) => a.id === 'developer')?.stages).toEqual([]);
  });

  it('an agent made on the way joins the team and lists the stages that name it', () => {
    const c = config();
    const d = { ...draftOfFlows(c), newAgents: [{ ...addAgent(c, { id: 'security', name: 'Security' }).agents.team.at(-1)! }] };
    d.workspace = patchStage(insertStage(d.workspace, 5, 'work', 'Security review').stages, 'work', { agentId: 'security', produces: ['4b_SECURITY.md'], returnsTo: 'implement' });
    const next = applyFlows(c, d);
    expect(next.agents.team.find((a) => a.id === 'security')).toMatchObject({ system: false, stages: ['work'] });
    expect(validateConfig(next).errors).toEqual([]);
  });

  it('what the draft makes validates, whatever order the stages were put in', () => {
    const c = config();
    const d = draftOfFlows(c);
    d.workspace = moveStage(moveStage(d.workspace, 1, 4), 0, 2);
    const checks = checkFlows(c, d, null);
    const result = validateConfig(applyFlows(c, d));
    expect(result.ok).toBe(checks.errors === 0);
  });
});

describe('the checks while editing', () => {
  const text = createTranslator('en');

  it('the flow as it is has none', () => {
    const c = config();
    expect(checkFlows(c, draftOfFlows(c), null)).toEqual({ rows: [], general: [], errors: 0 });
  });

  it('a work stage with no agent is an error on its row, in words', () => {
    const c = config();
    const d = draftOfFlows(c);
    d.workspace = patchStage(d.workspace, 'plan', { agentId: undefined });
    for (const a of c.agents.team) a.stages = a.stages.filter((s) => s !== 'plan');
    const checks = checkFlows(c, d, null);
    expect(checks.rows.map((i) => `${i.severity}:${i.code}:${i.stage}:${i.field}`)).toContain('error:work-no-agent:plan:agentId');
    expect(flowIssueText(checks.rows[0], text)).toMatch(/Plan/);
    expect(checks.errors).toBeGreaterThan(0);
  });

  it('a first gate, a stage nothing reaches and a flow with no end are found', () => {
    const c = config();
    const first = draftOfFlows(c);
    first.workspace = moveStage(first.workspace, 1, 0);
    expect(checkFlows(c, first, null).rows.map((i) => i.code)).toContain('gate-first');
    const dead = draftOfFlows(c);
    dead.workspace = patchStage(dead.workspace, 'refine', { next: 'plan' });
    expect(checkFlows(c, dead, null).rows.map((i) => `${i.code}:${i.stage}`)).toContain('unreachable:gate1');
    const loop = draftOfFlows(c);
    loop.workspace = patchStage(loop.workspace, 'ready', { next: 'refine' });
    expect(checkFlows(c, loop, null).rows.map((i) => i.code)).toContain('no-end');
  });

  it('a wait with no event, an artifact nobody makes and one made twice are found', () => {
    const c = config();
    let d = draftOfFlows(c);
    d.workspace = patchStage(insertStage(d.workspace, 4, 'wait', 'Wait').stages, 'wait', { waitsFor: { kind: 'label' } });
    expect(checkFlows(c, d, null).rows.map((i) => i.code)).toContain('wait-no-event');
    d = draftOfFlows(c);
    d.workspace = patchStage(d.workspace, 'plan', { reads: ['9_NOPE.md'], produces: ['1_SPEC.md'] });
    const codes = checkFlows(c, d, null).rows.map((i) => i.code);
    expect(codes).toContain('artifact-unproduced');
    expect(codes).toContain('artifact-duplicate');
  });

  it('warnings are listed and do not stop the save', () => {
    const c = config();
    const d = draftOfFlows(c);
    d.workspace = d.workspace.filter((s) => s.id !== 'ready');
    d.workspace = [...d.workspace, { id: 'last-gate', label: 'Last gate', match: [], kind: 'qa', rank: 8, type: 'gate' }];
    const checks = checkFlows(c, d, null);
    expect(checks.rows.some((i) => i.severity === 'warning' && i.code === 'gate-last')).toBe(true);
  });

  it('the flow of a squad is checked with its own team, row by row, and the workspace flow is not touched', () => {
    let c = config();
    c = addSquad(c, newSquad({ id: 'core', name: 'Core', liaison: 'developer' }));
    c = setAgentSquad(setAgentSquad(c, 'developer', 'core'), 'qa', 'core');
    c = { ...c, squads: c.squads!.map((s) => ({ ...s, liaison: 'developer' })) };
    let d = giveOwnFlow(draftOfFlows(c), 'core');
    d = withStages(d, 'core', patchStage(stagesOfTarget(d, 'core'), 'review', { agentId: 'nobody' }));
    const checks = checkFlows(c, d, 'core');
    expect(checks.rows.map((i) => `${i.code}:${i.stage}`)).toContain('agent-unknown:review');
    expect(checkFlows(c, d, null).rows).toEqual([]);
    expect(checkFlows(c, d, null).errors).toBe(checks.errors);
  });

  it('an error in the team stops the save and is listed apart from the rows', () => {
    const c = config();
    c.agents.team = c.agents.team.map((a) => (a.id === 'developer' ? { ...a, turnsTo: 'developer' } : a));
    const checks = checkFlows(c, draftOfFlows(c), null);
    expect(checks.rows).toEqual([]);
    expect(checks.general.map((g) => g.issue.code)).toEqual(['turns-self']);
    expect(checks.errors).toBe(1);
  });
});

describe('the agent cycle', () => {
  it('has no problem as shipped, so the editor opens it clean', () => {
    const c = applyTemplate(neutralConfig(), agentFlow);
    expect(checkFlows(c, draftOfFlows(c), null).errors).toBe(0);
  });
});
