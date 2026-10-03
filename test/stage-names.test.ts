// The stage names of the agent cycle are catalog keys: each place that shows one, or sends one to a person or an agent, puts it in the workspace's language.
import { afterEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { matchStage } from '../src/shared/config/stages';
import { agentFlow, agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { createTranslator, setLanguage } from '../src/shared/i18n';
import { messageText } from '../src/shared/forum';
import { RunError, checkFlow, flowIssueText, flowOf, snapshotOf } from '../src/shared/runs';
import { stageLabelOf } from '../src/shared/runs/view';
import { commitFallback } from '../src/main/runner/git';
import { flowDiagram } from '../src/renderer/src/screens/team/flowDiagram';
import { commentTargets } from '../src/renderer/src/screens/team/commentEdit';
import { agentFlowConfig } from './helpers/runs';

afterEach(() => setLanguage('pt-BR'));

const engineering = () => applyTemplate(neutralConfig(), agentFlowEngineering);
const KEYS = ['cycle.agentFlow.stage.triage', 'cycle.agentFlow.stage.refine', 'cycle.agentFlow.stage.gate1', 'cycle.agentFlow.stage.plan', 'cycle.agentFlow.stage.gate2', 'cycle.agentFlow.stage.implement', 'cycle.agentFlow.stage.review', 'cycle.agentFlow.stage.qa', 'cycle.agentFlow.stage.ready', 'cycle.agentFlow.stage.communicate'];

describe('the stages of the agent cycle templates', () => {
  it('carry catalog keys that both languages define', () => {
    const labels = [...applyTemplate(neutralConfig(), agentFlow).devCycle.stages, ...engineering().devCycle.stages].map((s) => s.label);
    expect(new Set(labels)).toEqual(new Set(KEYS));
    for (const key of KEYS) {
      expect(createTranslator('pt-BR')(key), key).not.toBe(key);
      expect(createTranslator('en')(key), key).not.toBe(key);
    }
  });
});

describe('where a person reads a stage name', () => {
  const view = () => {
    const c = engineering();
    const flow = flowOf(c);
    return { c, flow, run: { stage: 'plan', flow: snapshotOf(flow) } };
  };

  it('the run views name the stage in the language in force', () => {
    setLanguage('pt-BR');
    expect(stageLabelOf(view().run)).toBe('Plano');
    setLanguage('en');
    expect(stageLabelOf(view().run)).toBe('Plan');
  });

  it('a message of the forum words its stage when it is shown, so a language change also translates old threads', () => {
    const message = { code: 'run.stage.started', params: { stage: 'cycle.agentFlow.stage.implement', agent: 'developer' } };
    setLanguage('pt-BR');
    expect(messageText(message)).toBe('Etapa Implementação: developer começou.');
    setLanguage('en');
    expect(messageText(message)).toBe('Stage Implement: developer started.');
  });

  it('a decision and an error of a run name it too', () => {
    setLanguage('pt-BR');
    expect(messageText({ code: 'gate.approved', params: { stage: 'cycle.agentFlow.stage.gate1' } })).toBe('Portão 1: aprovado.');
    expect(new RunError('no-agent', { stage: 'cycle.agentFlow.stage.review' }).message).toContain('Revisão');
  });

  it('the diagram of the flow draws the resolved names', () => {
    const { c } = view();
    const draw = () => flowDiagram(c.devCycle.stages, c.agents.team, (a) => a.id, { returns: 'returns' });
    setLanguage('pt-BR');
    expect(draw()).toContain('n1{{"Portão 1"}}');
    setLanguage('en');
    expect(draw()).toContain('n1{{"Gate 1"}}');
  });

  it('the checks of the flow and the targets of the comment editor name it too', () => {
    const c = engineering();
    c.devCycle.stages.find((s) => s.id === 'plan')!.agentId = undefined;
    c.agents.team = c.agents.team.filter((a) => a.id !== 'planner');
    const issue = checkFlow({ stages: c.devCycle.stages, team: c.agents.team }).find((i) => i.code === 'work-no-agent')!;
    expect(issue.params.stage).toBe('cycle.agentFlow.stage.plan');
    expect(flowIssueText(issue, createTranslator('pt-BR'))).toContain('Plano');
    expect(flowIssueText(issue, createTranslator('en'))).toContain('Plan ');
    setLanguage('pt-BR');
    expect(commentTargets(c.devCycle.stages, c.devCycle.comments).find((x) => x.key === 'refine')?.label).toBe('Refinamento');
  });
});

describe('a name a person typed', () => {
  it('stays as typed, in every language', () => {
    const c = agentFlowConfig();
    c.devCycle.stages.find((s) => s.id === 'plan')!.label = 'Architecture';
    const run = { stage: 'plan', flow: snapshotOf(flowOf(c)) };
    setLanguage('pt-BR');
    expect(stageLabelOf(run)).toBe('Architecture');
    expect(messageText({ code: 'run.stage.gate', params: { stage: 'Architecture' } })).toBe('Etapa Architecture: esperando você.');
    setLanguage('en');
    expect(stageLabelOf(run)).toBe('Architecture');
  });
});

describe('a card that carries the name it was shown with', () => {
  it('is still known by its stage, in either language', () => {
    const stages = engineering().devCycle.stages;
    for (const language of ['pt-BR', 'en'] as const) {
      for (const s of stages) expect(matchStage(stages, createTranslator(language)(s.label))?.id, `${language} ${s.id}`).toBe(s.id);
    }
  });
});

describe('the subject of a commit', () => {
  it('names the stage in English whatever the workspace speaks', () => {
    setLanguage('pt-BR');
    expect(commitFallback('cycle.agentFlow.stage.review', false)).toBe('add the review documents');
    expect(commitFallback('cycle.agentFlow.stage.implement', true)).toBe('apply the implement changes');
    expect(commitFallback('Architecture', false)).toBe('add the architecture documents');
  });
});
