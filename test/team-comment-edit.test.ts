import { describe, expect, it } from 'vitest';
import { neutralConfig, validateConfig } from '../src/shared/config';
import type { CommentTemplate, StageDef } from '../src/shared/config/types';
import { agentFlow, agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { addSection, commentTargets, moveSection, patchSection, patchTemplate, removeSection, renderSample, starterTemplate, templateProblems } from '../src/renderer/src/screens/team/commentEdit';

const words = { body: (n: number) => `Sample text ${n}.`, technical: 'Files: a.ts', result: 'approved', decision: 'approved', fallback: 'x' };
const tpl = (over: Partial<CommentTemplate> = {}): CommentTemplate => ({ title: 'Plan', status: '{stage}: ready (round {round})', sections: [{ heading: 'Approach', guidance: 'One paragraph.' }, { heading: 'Risks', guidance: '' }], technicalDetail: true, ...over });

describe('which templates a cycle can have', () => {
  const c = applyTemplate(neutralConfig(), agentFlowEngineering);

  it('lists the comment of each work stage, then the three events', () => {
    const t = commentTargets(c.devCycle.stages, c.devCycle.comments);
    expect(t.map((x) => `${x.kind}:${x.key}`)).toEqual(['stage:refine', 'stage:plan', 'stage:implement', 'stage:review', 'stage:qa', 'stage:ready', 'event:gate', 'event:question', 'event:pr']);
    expect(t.find((x) => x.key === 'refine')).toMatchObject({ has: true, label: 'Refine' });
    expect(t.find((x) => x.key === 'ready')?.has).toBe(false);
  });

  it('follows the key a stage names, skips a stage with no comment, and keeps the keys nothing uses', () => {
    const stages: StageDef[] = c.devCycle.stages.map((s) => (s.id === 'plan' ? { ...s, comment: 'shared' } : s.id === 'qa' ? { ...s, comment: null } : s));
    const t = commentTargets(stages, { ...c.devCycle.comments, orphan: tpl() });
    const keys = t.map((x) => x.key);
    expect(keys).toContain('shared');
    // qa posts nothing now, but its template is still in the config: it stays listed, as one nothing uses
    expect(t.find((x) => x.key === 'qa')?.kind).toBe('other');
    expect(keys.at(-1)).toBe('orphan');
    expect(t.at(-1)?.kind).toBe('other');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('starts a template from the agent cycle\'s own, or from a status and one section', () => {
    expect(starterTemplate('plan', { title: 't', status: 's', heading: 'h' }).sections).toHaveLength(4);
    expect(starterTemplate('mine', { title: 't', status: 's', heading: 'h' })).toEqual({ title: 't', status: 's', sections: [{ heading: 'h', guidance: '' }], technicalDetail: false });
  });
});

describe('editing a template', () => {
  it('adds, removes, reorders and edits sections without touching the others', () => {
    let t = tpl();
    t = addSection(t, { heading: 'Tests', guidance: '' });
    expect(t.sections.map((s) => s.heading)).toEqual(['Approach', 'Risks', 'Tests']);
    t = moveSection(t, 2, -1);
    expect(t.sections.map((s) => s.heading)).toEqual(['Approach', 'Tests', 'Risks']);
    expect(moveSection(t, 0, -1)).toBe(t);
    expect(moveSection(t, 2, 1)).toBe(t);
    t = patchSection(t, 1, { heading: 'How it is tested' });
    t = removeSection(t, 0);
    expect(t.sections.map((s) => s.heading)).toEqual(['How it is tested', 'Risks']);
    expect(patchTemplate(t, { technicalDetail: false }).technicalDetail).toBe(false);
  });

  it('what it produces validates in the config', () => {
    const c = applyTemplate(neutralConfig(), agentFlowEngineering);
    c.devCycle.comments.plan = removeSection(addSection(tpl(), { heading: 'Tests', guidance: 'g' }), 0);
    expect(validateConfig(c).errors).toEqual([]);
  });
});

describe('the problems of a template', () => {
  it('is quiet for a good one', () => {
    expect(templateProblems(tpl(), 'en')).toEqual([]);
  });

  it('refuses an empty title, status or heading, and text over the limits', () => {
    expect(templateProblems(tpl({ title: ' ', status: '' }), 'en').map((p) => p.key)).toEqual(['ui.comments.err.title', 'ui.comments.err.status']);
    expect(templateProblems(tpl({ sections: [{ heading: '', guidance: '' }] }), 'en')[0]).toMatchObject({ key: 'ui.comments.err.heading', params: { n: '1' } });
    expect(templateProblems(tpl({ status: 'x'.repeat(401) }), 'en').map((p) => p.key)).toEqual(['ui.comments.err.long']);
    expect(templateProblems(tpl({ sections: [{ heading: 'a', guidance: 'x'.repeat(2001) }] }), 'en')[0].key).toBe('ui.comments.err.guidance');
  });

  it('warns about a placeholder a status does not have and about two sections with one heading', () => {
    const p = templateProblems(tpl({ status: '{stage} {nope}', sections: [{ heading: 'Risks', guidance: '' }, { heading: ' risks ', guidance: '' }] }), 'en');
    expect(p.map((x) => `${x.severity}:${x.key}`)).toEqual(['warning:ui.comments.warn.placeholder', 'warning:ui.comments.warn.twice']);
  });

  it('agrees with the config validator about what is an error', () => {
    for (const bad of [tpl({ title: '' }), tpl({ status: '' }), tpl({ sections: [{ heading: '', guidance: '' }] })]) {
      const c = applyTemplate(neutralConfig(), agentFlowEngineering);
      c.devCycle.comments.plan = bad;
      expect(validateConfig(c).ok).toBe(false);
      expect(templateProblems(bad, 'en').some((p) => p.severity === 'error')).toBe(true);
    }
  });
});

describe('the sample comment', () => {
  it('opens with the status, holds the sections in order and ends with the collapsed technical detail', () => {
    const body = renderSample(tpl(), 'en', 'Plan', words);
    const lines = body.split('\n');
    expect(lines[0]).toBe('**Plan: ready (round 1)**');
    expect(body.indexOf('### Approach')).toBeLessThan(body.indexOf('### Risks'));
    expect(body).toContain('Sample text 2.');
    expect(body).toMatch(/<details>[\s\S]*Files: a\.ts[\s\S]*<\/details>$/);
  });

  it('has no technical detail when the template does not ask for it, and follows the language of the workspace', () => {
    expect(renderSample(tpl({ technicalDetail: false }), 'en', 'Plan', words)).not.toContain('<details>');
    const c = applyTemplate(neutralConfig(), agentFlow);
    const t = c.devCycle.comments.refine;
    expect(renderSample(t, 'en', 'Refine', words)).not.toBe(renderSample(t, 'pt-BR', 'Refine', words));
    expect(renderSample(t, 'en', 'Refine', words).split('\n')[0]).toMatch(/^\*\*/);
  });
});
