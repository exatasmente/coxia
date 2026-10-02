import { describe, expect, it } from 'vitest';
import { mergeDeep, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { BUILT_IN_TEMPLATES, applyTemplate, builtInTemplate, cycleOf, exportTemplateText, needsOf, parseTemplate, promptFamilies, sdd, templateFromConfig } from '../src/shared/cycles';
import { CEREMONY_IDS } from '../src/shared/config/types';
import { TEST_STAGES, exampleProfile } from './helpers/config';
import { CATALOGS } from '../src/shared/i18n';

const apply = (id: string) => applyTemplate(neutralConfig(), builtInTemplate(id)!);

describe('the shipped templates', () => {
  it('are the five the wizard lists, in order', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual(['sdd', 'scrum', 'kanban', 'github-flow', 'minimal']);
  });

  it.each(BUILT_IN_TEMPLATES.map((t) => [t.id]))('%s produces a valid workspace config', (id) => {
    const r = validateConfig(apply(id));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each(BUILT_IN_TEMPLATES.map((t) => [t.id]))('%s has a name and a description in both languages, and its texts exist in both catalogs', (id) => {
    const t = builtInTemplate(id)!;
    for (const language of ['pt-BR', 'en'] as const) {
      expect(CATALOGS[language][t.name], `${language} name`).toBeTruthy();
      expect(CATALOGS[language][t.description], `${language} description`).toBeTruthy();
    }
    const cycle = cycleOf(t);
    // Every text the cycle writes as a catalog key resolves in both languages.
    const keys = [
      cycle.ceremonyParams.preDaily.label,
      cycle.ceremonyParams.preDaily.summaryStyle,
      cycle.meanings.question.text,
      cycle.meanings.blocker.text,
      cycle.meanings.readyForQa.text,
      cycle.specLayout.decisionLog.heading,
      ...cycle.ceremonyParams.gate.questionKinds,
      ...cycle.specLayout.phaseFiles.map((p) => p.label),
      ...cycle.specLayout.gateFiles.flatMap((g) => g.files.map(([, label]) => label)),
    ].filter((k) => k.startsWith('cycle.'));
    for (const key of keys) {
      expect(CATALOGS['pt-BR'][key], `pt-BR ${key}`).toBeTruthy();
      expect(CATALOGS.en[key], `en ${key}`).toBeTruthy();
    }
  });

  it('every prompt family a template picks exists in the catalogs', () => {
    const families = promptFamilies('pt-BR');
    for (const t of BUILT_IN_TEMPLATES) for (const family of Object.values(cycleOf(t).prompts)) expect(families[family], `${t.id}: ${family}`).toBeTruthy();
  });

  it('switch on the ceremonies each process is made of', () => {
    const on = (id: string) => CEREMONY_IDS.filter((c) => apply(id).devCycle.ceremonies[c]);
    expect(on('sdd')).toEqual([...CEREMONY_IDS]);
    expect(on('scrum')).toEqual(['preDaily', 'unblock', 'retro']);
    expect(on('kanban')).toEqual(['preDaily', 'unblock', 'retro']);
    expect(on('github-flow')).toEqual(['preDaily', 'unblock']);
    expect(on('minimal')).toEqual(['preDaily', 'unblock']);
  });

  it('give the stage vocabulary of each process, from backlog to done', () => {
    const kinds = (id: string) => apply(id).devCycle.stages.map((s) => s.kind);
    expect(kinds('sdd')).toEqual(expect.arrayContaining(['backlog', 'development', 'review', 'reviewApproved', 'qa', 'qaApproved', 'returned', 'done', 'blocked']));
    for (const id of ['scrum', 'kanban', 'github-flow', 'minimal']) {
      const k = kinds(id);
      expect(k, id).toEqual(expect.arrayContaining(['backlog', 'development', 'done']));
      expect(k, id).not.toContain('qa-approved');
    }
    // No stage of a process without QA is a QA stage, except Scrum's testing column.
    expect(kinds('kanban')).not.toContain('qa');
    expect(kinds('github-flow')).not.toContain('qa');
    expect(kinds('minimal')).not.toContain('qa');
  });

  it('only the SDD template writes spec files and names its documents', () => {
    expect(apply('sdd').devCycle.specLayout.phaseFiles.length).toBeGreaterThan(0);
    expect(apply('sdd').devCycle.specLayout.gateFiles.length).toBeGreaterThan(0);
    for (const id of ['scrum', 'kanban', 'github-flow', 'minimal']) {
      const layout = apply(id).devCycle.specLayout;
      expect(layout.phaseFiles, id).toEqual([]);
      expect(layout.gateFiles, id).toEqual([]);
      expect(layout.decisionLog.heading, id).toBe('');
      expect(apply(id).devCycle.enrichment.specFolder, id).toBe(false);
    }
  });

  it('carry nothing of a company: no QA account, no host, no tool, no prefix, no playbook', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const text = JSON.stringify(t) + JSON.stringify(Object.fromEntries(Object.entries(CATALOGS['pt-BR']).filter(([k]) => k.startsWith('cycle.') || k.startsWith('prompt.'))));
      expect(text, t.id).not.toMatch(/qa\.acme|acme|cardtool|playbook|gateway|openrouter|glab api projects\/acme/i);
    }
    const sddCycle = cycleOf(sdd);
    expect(sddCycle.qa.user).toBeNull();
    expect(sddCycle.pipelineSkill).toBe('');
    expect(sddCycle.promptOverrides).toEqual({});
  });

  it('say what the person still has to provide', () => {
    expect(sdd.needs).toEqual(['specsDir', 'qaUser', 'issueProject', 'releaseSync']);
    expect(builtInTemplate('minimal')!.needs).toEqual([]);
    expect(needsOf(cycleOf(sdd))).toEqual(['specsDir', 'qaUser', 'releaseSync']);
    expect(needsOf(cycleOf(builtInTemplate('kanban')!))).toEqual([]);
  });
});

describe('applying a template', () => {
  it('replaces only the development cycle', () => {
    const base = neutralConfig();
    base.language = 'en';
    base.projects.roots = ['~/work'];
    const next = applyTemplate(base, builtInTemplate('scrum')!);
    expect({ ...next, devCycle: null }).toEqual({ ...base, devCycle: null });
    expect(next.devCycle.templateId).toBe('scrum');
    expect(next.devCycle.stages.map((s) => s.id)).toContain('in-progress');
  });

  it('forgets the previous template: nothing of the old stages, mapping or overrides survives', () => {
    const legacy = mergeDeep(neutralConfig(), exampleProfile().config);
    const next = applyTemplate(legacy, builtInTemplate('kanban')!);
    expect(next.devCycle.stages.map((s) => s.id)).not.toContain('test-ok');
    expect(next.devCycle.promptOverrides).toEqual({});
    expect(next.devCycle.pipelineSkill).toBe('');
    expect(next.devCycle.releaseLabelPattern).not.toContain('web');
  });

  it('keeps the QA account the team already has, unless told not to', () => {
    const legacy = mergeDeep(neutralConfig(), exampleProfile().config);
    expect(applyTemplate(legacy, sdd).devCycle.qa.user).toBe('qa.acme');
    expect(applyTemplate(legacy, sdd, { keepQaUser: false }).devCycle.qa.user).toBeNull();
    expect(applyTemplate(legacy, sdd, { keepReleaseLabelPattern: true }).devCycle.releaseLabelPattern).toBe('^web-(\\d+\\.\\d+\\.\\d+)$');
  });

  it('is idempotent', () => {
    const once = apply('sdd');
    expect(applyTemplate(once, sdd)).toEqual(once);
  });

  it('does not change the config it was given', () => {
    const base = neutralConfig();
    const before = structuredClone(base);
    applyTemplate(base, sdd);
    expect(base).toEqual(before);
  });
});

describe('the example profile is the SDD template with the team specifics', () => {
  const legacy = mergeDeep(neutralConfig(), exampleProfile().config).devCycle;
  const generic = cycleOf(sdd);

  it('names itself sdd, which the registry reads as the SDD template', () => {
    expect(legacy.templateId).toBe('sdd');
    expect(builtInTemplate('sdd')).toBe(sdd);
  });

  it('switches on the same ceremonies and files as the SDD template', () => {
    expect(legacy.ceremonies).toEqual(generic.ceremonies);
    expect(legacy.specLayout.phaseFiles.map((p) => p.file)).toEqual(generic.specLayout.phaseFiles.map((p) => p.file));
    expect(legacy.specLayout.gateFiles.map((g) => [g.sub, g.gate, g.files.map(([f]) => f)])).toEqual(generic.specLayout.gateFiles.map((g) => [g.sub, g.gate, g.files.map(([f]) => f)]));
    expect(legacy.specLayout.planFiles).toEqual(generic.specLayout.planFiles);
    expect(legacy.ceremonyParams.gate.maxQuestions).toBe(generic.ceremonyParams.gate.maxQuestions);
    expect(legacy.meanings.readyForQa.stageKinds).toEqual(generic.meanings.readyForQa.stageKinds);
  });

  it('keeps the original stage list, and only the specifics are its own', () => {
    expect(legacy.stages).toEqual(TEST_STAGES);
    expect(legacy.qa.user).toBe('qa.acme');
    expect(legacy.pipelineSkill).toBe('team-pipeline');
    expect(legacy.ceremonyParams.preDaily.summaryTarget).toBe('team chat');
    expect(Object.keys(legacy.promptOverrides).length).toBeGreaterThan(5);
  });

  it('is not what a v2 file written before the templates is completed with: the blanks of that file are the neutral ones', () => {
    // The file of an install that ran phase 0: it has the old cycle fields and none of the newer ones.
    const old = {
      schemaVersion: 2,
      devCycle: {
        templateId: 'sdd',
        ceremonies: { preDaily: true, unblock: true, gate: true, qaHandoff: true, retro: true, releaseConflicts: true },
        stages: TEST_STAGES,
        releaseLabelPattern: '^web-(\\d+\\.\\d+\\.\\d+)$',
        specLayout: { folderPrefix: '#{iid}-', phaseFiles: [], planFiles: ['2_PLAN.md'], gateFiles: [], documents: { gateQuiz: 'GATE_QUIZ.md', completion: 'ISSUE_COMPLETION.md', qaChecklist: 'QA_CHECKLIST.md' } },
        qa: { user: 'qa.acme' },
      },
    };
    const r = validateConfig(old);
    expect(r.errors).toEqual([]);
    const c = r.config!;
    expect([c.userName, c.userArticle]).toEqual(['', '']);
    expect(c.devCycle.specLayout.decisionLog.heading).toBe('');
    expect(c.devCycle.ceremonyParams.preDaily.summaryTarget).toBe('');
    expect(c.devCycle.promptOverrides).toEqual({});
    // What the file did say wins over the completion.
    expect(c.devCycle.specLayout.planFiles).toEqual(['2_PLAN.md']);
    expect(c.devCycle.qa.user).toBe('qa.acme');
  });

  it('a config of another template is completed with the neutral cycle instead', () => {
    const c = withConfigDefaults({ devCycle: { templateId: 'scrum' } });
    expect(c.userName).toBe('');
    expect(c.devCycle.promptOverrides).toEqual({});
  });
});

describe('template files', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('round-trip: the cycle of a workspace exported as a template and applied elsewhere gives the same cycle', () => {
    const source = apply('scrum');
    source.devCycle.ceremonyParams.retro.windowDays = 10;
    source.devCycle.stages.push({ id: 'qa-wait', label: 'QA wait', match: ['QA wait'], kind: 'qa', rank: 5 });
    const template = templateFromConfig(source, { id: 'my-team', name: 'My team', description: 'Scrum with a QA wait' });
    const text = exportTemplateText(template, now);
    const check = parseTemplate(JSON.parse(text));
    expect(check.errors).toEqual([]);
    const target = applyTemplate(neutralConfig(), check.template!);
    expect(target.devCycle).toEqual({ ...source.devCycle, templateId: 'my-team' });
  });

  it('leave the QA account out of the file', () => {
    const source = mergeDeep(neutralConfig(), exampleProfile().config);
    const text = exportTemplateText(templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' }), now);
    expect(text).not.toContain('qa.acme');
    expect(JSON.parse(text).format).toBe('coxia-cycle-template');
  });

  it('are checked like a config: the paths of the problems point into the file', () => {
    const bad = {
      id: 'Bad Id',
      name: '',
      devCycle: { stages: [{ id: 'a', label: 'A', match: ['('], kind: 'review', rank: 1 }], stageMapping: [{ provider: 'github', source: 'field', name: 'Status', pattern: 'x', stage: 'ghost' }] },
    };
    const r = parseTemplate(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['template.id', 'template.name']));
    const second = parseTemplate({ id: 'ok-id', name: 'Ok', devCycle: bad.devCycle });
    expect(second.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['template.devCycle.stages[0].match[0]', 'template.devCycle.stageMapping[0].stage']));
  });

  it('refuse a file of another format or of a newer app, and anything that is not an object', () => {
    expect(parseTemplate(null).ok).toBe(false);
    expect(parseTemplate({ format: 'something-else' }).errors[0].path).toBe('format');
    expect(parseTemplate({ format: 'coxia-cycle-template', formatVersion: 9, template: {} }).errors[0].message).toMatch(/newer app/);
  });

  it('accept a bare template with no wrapper', () => {
    expect(parseTemplate({ id: 'plain', name: 'Plain', devCycle: { templateId: 'plain', ceremonies: { preDaily: true, unblock: false, gate: false, qaHandoff: false, retro: false, releaseConflicts: false } } }).ok).toBe(true);
  });

  it('reject a field the cycle does not have, like a config would', () => {
    const r = parseTemplate({ id: 'x', name: 'X', devCycle: { ceremony: true } });
    expect(r.ok).toBe(false);
    expect(r.errors[0].path).toBe('template.devCycle.ceremony');
  });
});
