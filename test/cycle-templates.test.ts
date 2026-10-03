import { describe, expect, it } from 'vitest';
import { mergeDeep, migrateConfig, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { BUILT_IN_TEMPLATES, applyTemplate, mergeTemplateTeam, builtInTemplate, cycleOf, exportTemplateText, needsOf, parseTemplate, promptFamilies, sdd, templateFromConfig } from '../src/shared/cycles';
import { CEREMONY_IDS } from '../src/shared/config/types';
import { TEST_STAGES, exampleProfile } from './helpers/config';
import { CATALOGS } from '../src/shared/i18n';

const apply = (id: string) => applyTemplate(neutralConfig(), builtInTemplate(id)!);

describe('the shipped templates', () => {
  it('are the five the wizard lists, in order', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual(['sdd', 'scrum', 'kanban', 'github-flow', 'minimal', 'agent-flow']);
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

  it('keeps the priority labels of the workspace when the template names none, and takes the template\'s when it does', () => {
    const own = neutralConfig();
    own.devCycle.priority.labels = ['^P0$', '^P1$'];
    expect(applyTemplate(own, sdd).devCycle.priority.labels).toEqual(['^P0$', '^P1$']);
    const withLabels = { ...sdd, devCycle: { ...sdd.devCycle, priority: { labels: ['^high$'] } } };
    expect(applyTemplate(own, withLabels).devCycle.priority.labels).toEqual(['^high$']);
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
    const r = migrateConfig(old, { legacyInstall: false });
    expect(r.fromVersion).toBe(2);
    expect(validateConfig(r.config).errors).toEqual([]);
    const c = r.config;
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

  it('leave the priority labels out of the file: they are the tracker conventions of the team', () => {
    const source = neutralConfig();
    source.devCycle.priority.labels = ['^P0$', '^P1$'];
    const text = exportTemplateText(templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' }), now);
    expect(text).not.toContain('^P0$');
    expect(source.devCycle.priority.labels).toEqual(['^P0$', '^P1$']);
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

describe('the agent cycle template', () => {
  const flow = builtInTemplate('agent-flow')!;
  const applied = () => applyTemplate(neutralConfig(), flow);

  it('produces a valid config whose stages run from refine to ready, with the person at the two gates', () => {
    const c = applied();
    expect(validateConfig(c).errors).toEqual([]);
    expect(c.devCycle.templateId).toBe('agent-flow');
    const stages = [...c.devCycle.stages].sort((a, b) => a.rank - b.rank);
    expect(stages.map((s) => s.id)).toEqual(['refine', 'gate1', 'plan', 'gate2', 'implement', 'review', 'qa', 'ready']);
    expect(stages.filter((s) => s.type === 'gate').map((s) => s.id)).toEqual(['gate1', 'gate2']);
    expect(stages.filter((s) => s.agentId).map((s) => [s.id, s.agentId])).toEqual([['refine', 'refiner'], ['plan', 'planner'], ['implement', 'developer'], ['review', 'reviewer'], ['qa', 'qa']]);
    expect(stages.find((s) => s.id === 'ready')).toMatchObject({ kind: 'reviewApproved' });
    expect(stages.flatMap((s) => s.produces ?? [])).toEqual(['1_SPEC.md', '2_PLAN.md', '3_IMPLEMENTATION.md', '4_REVIEW.md', '5_TEST_PLAN.md']);
  });

  it('brings the default team: only the developer writes, and each agent works its own stage', () => {
    const team = applied().agents.team.filter((a) => !a.system);
    expect(team.map((a) => [a.id, a.permission, a.stages])).toEqual([
      ['refiner', 'read', ['refine']],
      ['planner', 'read', ['plan']],
      ['developer', 'worktree', ['implement']],
      ['reviewer', 'read', ['review']],
      ['qa', 'read', ['qa']],
    ]);
    expect(applied().agents.team.filter((a) => a.system)).toHaveLength(5);
  });

  it('runs by itself by default: the five agents are autonomous, the built-in ones are not', () => {
    const team = applied().agents.team;
    expect(team.filter((a) => !a.system).map((a) => a.autonomous)).toEqual([true, true, true, true, true]);
    expect(team.filter((a) => a.system).map((a) => a.autonomous)).toEqual([false, false, false, false, false]);
    expect(validateConfig(applied()).warnings).toEqual([]);
  });

  it('lays the cycle folder out as the artifacts say: the gates read the spec and the plan, the phase is the latest file', () => {
    const layout = applied().devCycle.specLayout;
    expect(layout.gateFiles.map((g) => [g.sub, g.gate, g.files[0][0]])).toEqual([['', 1, '1_SPEC.md'], ['', 2, '2_PLAN.md']]);
    expect(layout.phaseFiles.map((p) => p.file)).toEqual(['5_TEST_PLAN.md', '4_REVIEW.md', '3_IMPLEMENTATION.md', '2_PLAN.md', '1_SPEC.md']);
    expect(layout.planFiles).toEqual(['2_PLAN.md']);
    expect(CEREMONY_IDS.filter((c) => applied().devCycle.ceremonies[c])).toEqual(['preDaily', 'unblock', 'gate', 'retro']);
  });

  it('has every text in both catalogs, the agents\' too', () => {
    const keys = [
      ...flow.team!.flatMap((a) => [a.name, a.job, a.instructions]),
      cycleOf(flow).meanings.blocker.text,
      cycleOf(flow).specLayout.decisionLog.heading,
      ...cycleOf(flow).specLayout.phaseFiles.map((p) => p.label),
      ...cycleOf(flow).specLayout.gateFiles.flatMap((g) => g.files.map(([, l]) => l)),
    ];
    for (const key of keys) for (const l of ['pt-BR', 'en'] as const) expect(CATALOGS[l][key], `${l} ${key}`).toBeTruthy();
  });

  it('keeps the agents the person already has, adds the missing ones, and never touches a system agent', () => {
    const own = neutralConfig();
    own.agents.team.push({ id: 'developer', name: 'Dev', job: 'mine', model: { role: null, provider: 'anthropic', model: 'sonnet' }, stages: [], permission: 'read', autonomous: false, instructions: 'careful', system: false });
    own.agents.team.find((a) => a.id === 'turn')!.instructions = 'short';
    const next = applyTemplate(own, flow);
    expect(next.agents.team.find((a) => a.id === 'developer')).toEqual(own.agents.team.find((a) => a.id === 'developer'));
    expect(next.agents.team.map((a) => a.id)).toEqual(expect.arrayContaining(['refiner', 'planner', 'reviewer', 'qa']));
    expect(next.agents.team.filter((a) => a.id === 'developer')).toHaveLength(1);
    expect(next.agents.team.find((a) => a.id === 'turn')?.instructions).toBe('short');
    // The stage names the agent, so the person's developer still works "implement" even though it does not list it.
    expect(validateConfig(next).errors).toEqual([]);
    expect(validateConfig(next).warnings.map((w) => w.path)).toContain('devCycle.stages[4].agentId');
  });

  it('is idempotent', () => {
    const once = applied();
    expect(applyTemplate(once, flow)).toEqual(once);
  });

  it('keeps the agents when another template replaces the cycle, dropping the stages they worked', () => {
    const c = applyTemplate(applied(), builtInTemplate('scrum')!);
    expect(validateConfig(c).errors).toEqual([]);
    const developer = c.agents.team.find((a) => a.id === 'developer')!;
    expect(developer.permission).toBe('worktree');
    expect(developer.stages).toEqual([]);
    expect(c.devCycle.stages.some((s) => s.agentId)).toBe(false);
  });

  it('travels in a template file: the agents of a workspace are exported and read back, the system ones left out', () => {
    const source = applied();
    const template = templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' });
    expect(template.team?.map((a) => a.id)).toEqual(['refiner', 'planner', 'developer', 'reviewer', 'qa']);
    const check = parseTemplate(JSON.parse(exportTemplateText(template, new Date('2026-10-02T12:00:00Z'))));
    expect(check.errors).toEqual([]);
    expect(applyTemplate(neutralConfig(), check.template!)).toEqual({ ...source, devCycle: { ...source.devCycle, templateId: 'mine' } });
    expect(templateFromConfig(neutralConfig(), { id: 'plain', name: 'Plain', description: '' }).team).toBeUndefined();
  });

  it('refuses a file whose team is not coherent: a built-in agent, an unknown stage, a stage that names a missing agent', () => {
    const base = { id: 'x', name: 'X', devCycle: { stages: [{ id: 'a', label: 'A', match: [], kind: 'development', rank: 1 }] } };
    expect(parseTemplate({ ...base, team: [{ id: 'turn', name: 'T', system: true }] }).ok).toBe(false);
    expect(parseTemplate({ ...base, team: 'nobody' }).ok).toBe(false);
    const unknownStage = parseTemplate({ ...base, team: [{ id: 'w', name: 'W', stages: ['ghost'] }] });
    expect(unknownStage.errors.map((e) => e.path)).toEqual(['template.team[5].stages[0]']);
    const missingAgent = parseTemplate({ ...base, devCycle: { stages: [{ id: 'a', label: 'A', match: [], kind: 'development', rank: 1, agentId: 'ghost' }] } });
    expect(missingAgent.errors.map((e) => e.path)).toEqual(['template.devCycle.stages[0].agentId']);
    expect(parseTemplate({ ...base, team: [{ id: 'w', name: 'W', stages: ['a'] }] }).ok).toBe(true);
  });

  it('lists in the setup wizard with its team', async () => {
    const { listCycleTemplates } = await import('../src/main/cycles');
    const entry = listCycleTemplates('en').find((t) => t.id === 'agent-flow')!;
    expect(entry).toMatchObject({ name: 'Agent cycle', builtIn: true, needs: ['issueProject'] });
    expect(entry.team.map((a) => a.id)).toEqual(['refiner', 'planner', 'developer', 'reviewer', 'qa']);
    expect(entry.stages.map((s) => s.id)).toContain('gate1');
  });

  it('merges into a team by id for the wizard too: the person\'s agents stay, the stages the cycle lacks are dropped', () => {
    const own = neutralConfig().agents.team.concat([{ id: 'developer', name: 'Dev', job: '', model: { role: 'deep', provider: '', model: '' }, stages: ['gone', 'implement'], permission: 'read', autonomous: false, instructions: '', system: false }]);
    const merged = mergeTemplateTeam(own, flow.team!, cycleOf(flow));
    expect(merged.find((a) => a.id === 'developer')).toMatchObject({ name: 'Dev', permission: 'read', stages: ['implement'] });
    expect(merged.map((a) => a.id).filter((id) => id === 'developer')).toHaveLength(1);
    expect(merged.map((a) => a.id)).toContain('qa');
  });
});
