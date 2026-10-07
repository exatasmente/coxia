// The comment templates of the cycle (schema 7, then 8): what the agent cycle brings, what the other cycles do not, validation and the migration.
import { describe, expect, it } from 'vitest';
import { migrateConfig, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { COMMENT_EVENT_KEYS, type CommentTemplate, type WorkspaceConfig } from '../src/shared/config/types';
import { BUILT_IN_TEMPLATES, applyTemplate, builtInTemplate, exportTemplateText, parseTemplate, templateFromConfig } from '../src/shared/cycles';
import { cycleText } from '../src/shared/cycles/text';
import { CATALOGS } from '../src/shared/i18n';

type Doc = Record<string, any>;
const agentFlow = (): WorkspaceConfig => applyTemplate(neutralConfig(), builtInTemplate('agent-flow')!);
const withComments = (comments: Record<string, Partial<CommentTemplate>>): WorkspaceConfig => {
  const c = agentFlow();
  c.devCycle.comments = comments as Record<string, CommentTemplate>;
  return c;
};

describe('the templates the agent cycle brings', () => {
  it('has one for each work stage and for the gate decision, the question and the pull request', () => {
    expect(Object.keys(agentFlow().devCycle.comments).sort()).toEqual(['communicate', 'gate', 'implement', 'plan', 'pr', 'qa', 'question', 'refine', 'review', 'triage']);
    for (const key of COMMENT_EVENT_KEYS) expect(agentFlow().devCycle.comments[key]).toBeTruthy();
  });

  it('follows the spec: sections of each stage, technical detail on the stages and the pull request, none on the decision and the question', () => {
    const c = agentFlow().devCycle.comments;
    const headings = (id: string) => c[id].sections.map((s) => cycleText(s.heading, 'en'));
    expect(headings('refine')).toEqual(['What is asked', 'What changes for the person using it', 'Acceptance', 'Out of scope', 'Open questions']);
    expect(headings('plan')).toEqual(['Approach', 'What changes, by area', 'Risks and how they are covered', 'How it will be tested']);
    expect(headings('implement')).toEqual(['What changed for the person using it', 'How to verify', 'Extra findings']);
    expect(headings('review')).toEqual(['Beyond the lines of the code', 'What was not reviewed']);
    expect(headings('qa')).toEqual(['Scenarios verified and their result', 'What was not verified']);
    expect(['refine', 'plan', 'implement', 'review', 'qa', 'pr'].map((id) => c[id].technicalDetail)).toEqual([true, true, true, true, true, true]);
    expect([c.gate.technicalDetail, c.question.technicalDetail, c.triage.technicalDetail, c.communicate.technicalDetail]).toEqual([false, false, false, false]);
    expect(headings('triage')).toEqual(['How it was understood', 'Can it be reproduced or understood', 'What is missing', 'Related issues']);
    expect(headings('communicate')).toEqual(['What changed', 'How to use it', 'Anything to know']);
    expect(cycleText(c.review.status, 'en', { result: 'changes requested', round: 1 })).toBe('Review: changes requested (round 1)');
    expect(cycleText(c.gate.status, 'en', { stage: 'Gate 1', decision: 'approved' })).toBe('Gate 1: approved');
  });

  it('writes every text in both languages, so the comments follow the workspace language', () => {
    for (const tpl of Object.values(agentFlow().devCycle.comments)) {
      for (const key of [tpl.title, tpl.status, ...tpl.sections.flatMap((s) => [s.heading, s.guidance])]) {
        for (const language of ['pt-BR', 'en'] as const) expect(CATALOGS[language][key], `${language} ${key}`).toBeTruthy();
      }
    }
    // the same placeholders in both languages
    for (const key of Object.keys(CATALOGS.en).filter((k) => k.startsWith('cycle.agentFlow.comment.'))) {
      const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(CATALOGS['pt-BR'][key]), key).toEqual(placeholders(CATALOGS.en[key]));
    }
  });

  it('are only in the two agent cycles, the release flow and the docs flow: the others post nothing', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const c = applyTemplate(neutralConfig(), t);
      expect(Object.keys(c.devCycle.comments).length > 0, t.id).toBe(t.id.startsWith('agent-flow') || t.id === 'release-flow' || t.id === 'docs-flow');
    }
  });

  it('is replaced by what the next template brings: switching to another cycle leaves none', () => {
    const switched = applyTemplate(agentFlow(), builtInTemplate('kanban')!);
    expect(switched.devCycle.comments).toEqual({});
  });

  it('travels in an exported template and is checked like the config when it is imported', () => {
    const t = templateFromConfig(withComments({ refine: { title: 'Spec', status: 'Spec ready', sections: [{ heading: 'Goal', guidance: 'The goal.' }], technicalDetail: true } }), { id: 'mine', name: 'Mine', description: '' });
    const back = parseTemplate(JSON.parse(exportTemplateText(t, new Date('2026-10-03T10:00:00Z'))));
    expect(back.ok).toBe(true);
    expect(applyTemplate(neutralConfig(), back.template!).devCycle.comments.refine.title).toBe('Spec');
    const bad = parseTemplate({ id: 'x', name: 'X', devCycle: { comments: { refine: { title: 'T' } } } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.path)).toContain('template.devCycle.comments.refine.status');
  });
});

describe('validation', () => {
  const issues = (c: WorkspaceConfig) => validateConfig(c);

  it('accepts the default templates without a single complaint', () => {
    const r = issues(agentFlow());
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.path.startsWith('devCycle.comments'))).toEqual([]);
  });

  it('fills what a template leaves out: no sections, no technical detail', () => {
    const r = validateConfig({ ...agentFlow(), devCycle: { ...agentFlow().devCycle, comments: { qa: { title: 'QA', status: 'QA done' } } } });
    expect(r.ok).toBe(true);
    expect(r.config?.devCycle.comments.qa).toEqual({ title: 'QA', status: 'QA done', sections: [], technicalDetail: false });
    expect(withConfigDefaults({ devCycle: { comments: { qa: { title: 'QA', status: 'x' } } } }).devCycle.comments.qa.sections).toEqual([]);
  });

  it('refuses a key that is not an id and a template with no title or status', () => {
    const bad = issues(withComments({ 'Not An Id': { title: 'T', status: 'S', sections: [], technicalDetail: false } }));
    expect(bad.errors.map((e) => e.path)).toContain('devCycle.comments.Not An Id');
    const empty = issues(withComments({ qa: { title: '', status: 'S' } }));
    expect(empty.errors.map((e) => e.path)).toContain('devCycle.comments.qa.title');
    const sections = issues(withComments({ qa: { title: 'T', status: 'S', sections: [{ heading: '', guidance: '' }] } }));
    expect(sections.errors.map((e) => e.path)).toContain('devCycle.comments.qa.sections[0].heading');
  });

  it('warns about a template nothing will use, a gate, a stage called like an event and an unknown placeholder', () => {
    const c = withComments({
      nowhere: { title: 'T', status: 'S', sections: [], technicalDetail: false },
      gate1: { title: 'T', status: 'S', sections: [], technicalDetail: false },
      question: { title: 'T', status: 'S', sections: [], technicalDetail: false },
      qa: { title: 'T', status: 'Done {nope}', sections: [{ heading: 'A', guidance: '' }, { heading: 'a', guidance: '' }], technicalDetail: false },
    });
    c.devCycle.stages.push({ id: 'question', label: 'Q', match: [], kind: 'backlog', rank: 9 });
    const messages = issues(c).warnings.map((w) => `${w.path}: ${w.message}`).join('\n');
    expect(messages).toContain('devCycle.comments.nowhere');
    expect(messages).toContain('"gate1" is a gate');
    expect(messages).toContain('is both a stage and an event');
    expect(messages).toContain('{nope} is not a placeholder');
    expect(messages).toContain('two sections are headed "a"');
  });
});

describe('the migration to schema 7', () => {
  const v6 = (change: (c: Doc) => void = () => undefined): Doc => {
    const c = JSON.parse(JSON.stringify(neutralConfig())) as Doc;
    c.schemaVersion = 6;
    delete c.devCycle.comments;
    change(c);
    return c;
  };

  it('gives a workspace on the agent cycle that cycle\'s templates, and says so', () => {
    const r = migrateConfig(v6((c) => (c.devCycle.templateId = 'agent-flow')), { legacyInstall: false });
    expect(r.fromVersion).toBe(6);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(18);
    expect(r.config.devCycle.comments).toEqual(agentFlow().devCycle.comments);
    expect(r.notes.join(' ')).toContain('comment templates');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('gives any other cycle none, so nothing is ever posted for it', () => {
    for (const templateId of ['sdd', 'none', 'kanban', 'mine']) {
      const r = migrateConfig(v6((c) => (c.devCycle.templateId = templateId)), { legacyInstall: false });
      expect(r.config.devCycle.comments, templateId).toEqual({});
    }
  });

  it('keeps templates a file already carries and touches nothing else', () => {
    const own = { qa: { title: 'T', status: 'S', sections: [], technicalDetail: false } };
    const r = migrateConfig(v6((c) => { c.devCycle.comments = own; c.language = 'en'; c.devCycle.templateId = 'agent-flow'; }), { legacyInstall: false });
    expect(r.config.devCycle.comments).toEqual(own);
    expect(r.config.language).toBe('en');
  });

  it('carries an old file all the way, and does not open one from a newer app', () => {
    const r = migrateConfig({ schemaVersion: 3, language: 'en', devCycle: { templateId: 'agent-flow' } }, { legacyInstall: false });
    expect(r.config.schemaVersion).toBe(18);
    expect(Object.keys(r.config.devCycle.comments)).toContain('review');
    expect(() => migrateConfig({ schemaVersion: 18 }, { legacyInstall: false })).toThrow(/newer app/);
  });
});
