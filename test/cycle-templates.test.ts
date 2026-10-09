import { describe, expect, it } from 'vitest';
import { mergeDeep, migrateConfig, neutralConfig, validateConfig, withConfigDefaults } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { BUILT_IN_TEMPLATES, DOCS_FLOW_STAGES, RELEASE_FLOW_STAGES, applyTemplate, mergeTemplateTeam, builtInTemplate, cycleOf, exportTemplateText, needsOf, parseTemplate, promptFamilies, sdd, templateFromConfig } from '../src/shared/cycles';
import { CEREMONY_IDS } from '../src/shared/config/types';
import { RECOMMENDED, removeAgent } from '../src/shared/config/team';
import { checkFlow, flowOf, isFlowCycle, pushStagesOf } from '../src/shared/runs';
import { TEST_STAGES, exampleProfile } from './helpers/config';
import { CATALOGS } from '../src/shared/i18n';

const apply = (id: string) => applyTemplate(neutralConfig(), builtInTemplate(id)!);

describe('the shipped templates', () => {
  it('are the ones the wizard lists, in order', () => {
    expect(BUILT_IN_TEMPLATES.map((t) => t.id)).toEqual(['sdd', 'scrum', 'kanban', 'github-flow', 'minimal', 'agent-flow', 'agent-flow-engineering', 'release-flow', 'docs-flow']);
  });

  it.each(BUILT_IN_TEMPLATES.map((t) => [t.id]))('%s has a flow with nothing to say about it', (id) => {
    const c = apply(id);
    expect(checkFlow({ stages: c.devCycle.stages, team: c.agents.team })).toEqual([]);
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

describe.each([['agent-flow'], ['agent-flow-engineering']])('the template %s', (id) => {
  const flow = builtInTemplate(id)!;
  const applied = () => applyTemplate(neutralConfig(), flow);
  const business = id === 'agent-flow';

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

  it('is a flow with no problem: nothing to say about it, no loop of who turns to whom', () => {
    const c = applied();
    expect(validateConfig(c).errors).toEqual([]);
    expect(validateConfig(c).warnings).toEqual([]);
    expect(checkFlow({ stages: c.devCycle.stages, team: c.agents.team })).toEqual([]);
  });

  it('is idempotent', () => {
    const once = applied();
    expect(applyTemplate(once, flow)).toEqual(once);
  });

  it('never hands a workspace the objects of the template itself', () => {
    const c = applied();
    c.devCycle.stages[0].label = 'Changed';
    expect(flow.devCycle.stages?.[0]?.label).not.toBe('Changed');
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
    expect(template.team?.map((a) => a.id)).toEqual(flow.team!.map((a) => a.id));
    const check = parseTemplate(JSON.parse(exportTemplateText(template, new Date('2026-10-02T12:00:00Z'))));
    expect(check.errors).toEqual([]);
    expect(applyTemplate(neutralConfig(), check.template!)).toEqual({ ...source, devCycle: { ...source.devCycle, templateId: 'mine' } });
    expect(templateFromConfig(neutralConfig(), { id: 'plain', name: 'Plain', description: '' }).team).toBeUndefined();
  });

  it('never brings a screen, hosts or a logged-in browser: not when applied, not when exported, and the file is told so', () => {
    const withPowers = [...flow.team!.map((a) => ({ ...a })), { id: 'scout', name: 'Scout', job: '', model: { role: 'deep' as const, provider: '', model: '' }, stages: [], permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const, autonomous: false, turnsTo: null, instructions: '', system: false, screen: true, allowedHosts: ['example.com'], browserProfile: true }];
    const merged = mergeTemplateTeam(neutralConfig().agents.team, withPowers, cycleOf(flow));
    const scout = merged.find((a) => a.id === 'scout')!;
    expect(scout.screen).toBeUndefined();
    expect(scout.allowedHosts).toBeUndefined();
    expect(scout.browserProfile).toBeUndefined();
    expect(scout.name).toBe('Scout');
    const checked = parseTemplate({ id: 'mine', name: 'Mine', devCycle: {}, team: withPowers });
    expect(checked.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['template.team[scout].screen', 'template.team[scout].allowedHosts', 'template.team[scout].browserProfile']));
    const source = applied();
    source.agents.team.push(newAgent({ id: 'scout', name: 'Scout', screen: true, allowedHosts: ['example.com'], browserProfile: true }));
    const exported = templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' });
    const out = exported.team!.find((a) => a.id === 'scout')!;
    expect(out).toMatchObject({ id: 'scout', name: 'Scout' });
    expect('screen' in out || 'allowedHosts' in out || 'browserProfile' in out).toBe(false);
    expect(JSON.stringify(applyTemplate(neutralConfig(), exported).agents.team)).not.toMatch(/example\.com|browserProfile|"screen"/);
  });

  it('never brings the fallback models of an agent: they point at providers of one workspace', () => {
    const pool = { fallbacks: [{ provider: 'anthropic', model: 'haiku' }], activities: { edit: [{ provider: 'gone', model: 'model-a' }] }, images: true, contextWindow: 64_000, echoReasoning: true };
    const withPool = [{ id: 'scout', name: 'Scout', job: '', model: { role: null, provider: 'anthropic', model: 'sonnet', ...pool }, stages: [], permission: 'read' as const, tracker: 'none' as const, shell: 'none' as const, autonomous: false, turnsTo: null, instructions: '', system: false }];
    const merged = mergeTemplateTeam(neutralConfig().agents.team, withPool, cycleOf(flow));
    expect(merged.find((a) => a.id === 'scout')!.model).toEqual({ role: null, provider: 'anthropic', model: 'sonnet' });
    const checked = parseTemplate({ id: 'mine', name: 'Mine', devCycle: {}, team: withPool });
    expect(checked.errors).toEqual([]);
    expect(checked.warnings.map((w) => w.path)).toContain('template.team[scout].model');
    expect(checked.template?.team?.find((a) => a.id === 'scout')?.model).toEqual({ role: null, provider: 'anthropic', model: 'sonnet' });
    const source = applied();
    source.agents.team.push(newAgent({ id: 'scout', name: 'Scout', model: { role: null, provider: 'anthropic', model: 'sonnet', ...pool } }));
    const exported = templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' });
    expect(exported.team!.find((a) => a.id === 'scout')!.model).toEqual({ role: null, provider: 'anthropic', model: 'sonnet' });
    expect(JSON.stringify(applyTemplate(neutralConfig(), exported).agents.team)).not.toMatch(/fallbacks|activities|contextWindow/);
  });

  it('carries the pool mode of an agent and of a stage, and still never the pool', () => {
    const source = applied();
    source.agents.team.push(newAgent({ id: 'scout', name: 'Scout', poolMode: 'switch', model: { role: null, provider: 'anthropic', model: 'sonnet', fallbacks: [{ provider: 'anthropic', model: 'haiku' }] } }));
    const work = source.devCycle.stages.find((s) => (s.type ?? 'work') === 'work')!;
    work.poolMode = 'fallback';
    const exported = templateFromConfig(source, { id: 'mine', name: 'Mine', description: '' });
    expect(exported.team!.find((a) => a.id === 'scout')!.poolMode).toBe('switch');
    expect(exported.team!.find((a) => a.id === 'scout')!.model).toEqual({ role: null, provider: 'anthropic', model: 'sonnet' });
    const check = parseTemplate(JSON.parse(exportTemplateText(exported, new Date('2026-10-02T12:00:00Z'))));
    expect(check.errors).toEqual([]);
    const back = applyTemplate(neutralConfig(), check.template!);
    expect(back.agents.team.find((a) => a.id === 'scout')!.poolMode).toBe('switch');
    expect(back.devCycle.stages.find((s) => s.id === work.id)!.poolMode).toBe('fallback');
    // The workspace default is the workspace's, not the template's.
    expect(JSON.stringify(exported)).not.toMatch(/"llm"/);
  });

  it('lists in the setup wizard with its team', async () => {
    const { listCycleTemplates } = await import('../src/main/cycles');
    const entry = listCycleTemplates('en').find((t) => t.id === id)!;
    expect(entry).toMatchObject({ builtIn: true, needs: ['issueProject'] });
    expect(entry.team.map((a) => a.id)).toEqual(flow.team!.map((a) => a.id));
    expect(entry.stages.map((s) => s.id)).toContain('gate1');
  });

  it('merges into a team by id for the wizard too: the person\'s agents stay, the stages the cycle lacks are dropped', () => {
    const own = neutralConfig().agents.team.concat([{ id: 'developer', name: 'Dev', job: '', model: { role: 'deep', provider: '', model: '' }, stages: ['gone', 'implement'], permission: 'read', tracker: 'none', shell: 'none', autonomous: false, turnsTo: null, instructions: '', system: false }]);
    const merged = mergeTemplateTeam(own, flow.team!, cycleOf(flow));
    expect(merged.find((a) => a.id === 'developer')).toMatchObject({ name: 'Dev', permission: 'read', stages: ['implement'] });
    expect(merged.map((a) => a.id).filter((x) => x === 'developer')).toHaveLength(1);
    expect(merged.map((a) => a.id)).toContain('qa');
  });

  it('keeps the agents the person already has, adds the missing ones, and never touches a system agent', () => {
    const own = neutralConfig();
    own.agents.team.push({ id: 'developer', name: 'Dev', job: 'mine', model: { role: null, provider: 'anthropic', model: 'sonnet' }, stages: [], permission: 'read', tracker: 'none', shell: 'none', autonomous: false, turnsTo: null, instructions: 'careful', system: false });
    own.agents.team.find((a) => a.id === 'turn')!.instructions = 'short';
    const next = applyTemplate(own, flow);
    expect(next.agents.team.find((a) => a.id === 'developer')).toEqual(own.agents.team.find((a) => a.id === 'developer'));
    expect(next.agents.team.map((a) => a.id)).toEqual(expect.arrayContaining(flow.team!.map((a) => a.id)));
    expect(next.agents.team.filter((a) => a.id === 'developer')).toHaveLength(1);
    expect(next.agents.team.find((a) => a.id === 'turn')?.instructions).toBe('short');
    // The stage names the agent, so the person's developer still works "implement" even though it does not list it.
    expect(validateConfig(next).errors).toEqual([]);
    expect(validateConfig(next).warnings.map((w) => w.path)).toContain(`devCycle.stages[${next.devCycle.stages.findIndex((st) => st.id === 'implement')}].agentId`);
  });

  it('runs by itself by default: the agents are autonomous, the built-in ones are not', () => {
    const team = applied().agents.team;
    expect(team.filter((a) => !a.system).map((a) => a.autonomous)).toEqual(flow.team!.map(() => true));
    expect(team.filter((a) => a.system).map((a) => a.autonomous)).toEqual([false, false, false, false, false]);
  });

  it('has the comment templates of its stages and events, and the stage fields of a flow', () => {
    const c = applied();
    expect(Object.keys(c.devCycle.comments).sort()).toEqual(business ? ['communicate', 'gate', 'implement', 'plan', 'pr', 'qa', 'question', 'refine', 'review', 'triage'] : ['gate', 'implement', 'plan', 'pr', 'qa', 'question', 'refine', 'review']);
    expect(isFlowCycle(c.devCycle.stages)).toBe(true);
    // every stage that leaves a comment has its template
    for (const st of flowOf(c)) if (st.type === 'work' && st.agent && st.comment) expect(c.devCycle.comments[st.comment], st.id).toBeTruthy();
  });
});

describe('the agent cycle template: the business team', () => {
  const flow = builtInTemplate('agent-flow')!;
  const applied = () => applyTemplate(neutralConfig(), flow);

  it('goes from triage to the note for the reporter, with the person at the two gates and the run waiting for the pull request to be merged', () => {
    const c = applied();
    expect(c.devCycle.templateId).toBe('agent-flow');
    expect(c.devCycle.stages.map((s) => [s.id, s.type])).toEqual([['triage', 'work'], ['refine', 'work'], ['gate1', 'gate'], ['plan', 'work'], ['gate2', 'gate'], ['implement', 'work'], ['review', 'work'], ['qa', 'work'], ['ready', 'wait'], ['communicate', 'work']]);
    expect(c.devCycle.stages.find((s) => s.id === 'ready')).toMatchObject({ waitsFor: { kind: 'pr-merged' }, kind: 'reviewApproved' });
    expect(c.devCycle.stages.filter((s) => s.agentId).map((s) => [s.id, s.agentId])).toEqual([['triage', 'support'], ['refine', 'product-owner'], ['plan', 'tech-lead'], ['implement', 'developer'], ['review', 'tech-lead'], ['qa', 'qa'], ['communicate', 'customer-success']]);
    expect(c.devCycle.stages.flatMap((s) => s.produces ?? [])).toEqual(['0_TRIAGE.md', '1_SPEC.md', '2_PLAN.md', '3_IMPLEMENTATION.md', '4_REVIEW.md', '5_TEST_PLAN.md', '6_RELEASE_NOTE.md']);
    expect(c.devCycle.stages.filter((s) => s.returnsTo).map((s) => [s.id, s.returnsTo, s.roundLimit])).toEqual([['review', 'implement', 2], ['qa', 'implement', 2]]);
  });

  it('has the team of a product: only the developer writes, and each turns to the one it needs before it asks the person', () => {
    const team = applied().agents.team.filter((a) => !a.system);
    expect(team.map((a) => [a.id, a.permission, a.stages, a.turnsTo])).toEqual([
      ['support', 'read', ['triage'], 'product-owner'],
      ['product-owner', 'read', ['refine'], null],
      ['tech-lead', 'read', ['plan', 'review'], 'product-owner'],
      ['developer', 'worktree', ['implement'], 'tech-lead'],
      ['qa', 'read', ['qa'], 'tech-lead'],
      ['customer-success', 'read', ['communicate'], 'product-owner'],
    ]);
  });

  it('lays the cycle folder out for the new files: the release note and the triage are phases too', () => {
    const layout = applied().devCycle.specLayout;
    expect(layout.phaseFiles.map((p) => p.file)).toEqual(['6_RELEASE_NOTE.md', '5_TEST_PLAN.md', '4_REVIEW.md', '3_IMPLEMENTATION.md', '2_PLAN.md', '1_SPEC.md', '0_TRIAGE.md']);
    expect(layout.gateFiles.map((g) => [g.sub, g.gate, g.files[0][0]])).toEqual([['', 1, '1_SPEC.md'], ['', 2, '2_PLAN.md']]);
    expect(CEREMONY_IDS.filter((c) => applied().devCycle.ceremonies[c])).toEqual(['preDaily', 'unblock', 'gate', 'retro']);
  });

  it('with no customer success agent, communicate has no agent: the flow check warns and the run ends there without it', () => {
    const c = applied();
    const without = removeAgent(c, 'customer-success');
    expect(without.devCycle.stages.find((s) => s.id === 'communicate')?.agentId).toBeUndefined();
    const issues = checkFlow({ stages: without.devCycle.stages, team: without.agents.team });
    expect(issues.map((i) => [i.severity, i.code, i.stage])).toEqual([['warning', 'end-no-agent', 'communicate']]);
    expect(validateConfig(without).errors).toEqual([]);
  });

  it('refuses a loop of turnsTo in the team', () => {
    const c = applied();
    c.agents.team.find((a) => a.id === 'product-owner')!.turnsTo = 'support';
    expect(validateConfig(c).errors.map((e) => e.message)).toContain('Agents turn to each other in a circle (support → product-owner → support): a question would never reach the person.');
  });

  it('the engineering template is what the agent cycle was: no business roles, ending at ready', () => {
    const c = applyTemplate(neutralConfig(), builtInTemplate('agent-flow-engineering')!);
    expect(c.devCycle.stages.map((s) => s.id)).toEqual(['refine', 'gate1', 'plan', 'gate2', 'implement', 'review', 'qa', 'ready']);
    expect(c.agents.team.filter((a) => !a.system).map((a) => [a.id, a.turnsTo])).toEqual([['refiner', null], ['planner', null], ['developer', null], ['reviewer', null], ['qa', null]]);
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
});

describe('the release-flow template', () => {
  const flow = builtInTemplate('release-flow')!;
  const issueFlow = applyTemplate(neutralConfig(), builtInTemplate('agent-flow')!);
  const applied = () => applyTemplate(issueFlow, flow);

  it('is a template of a kind of run: it adds its flow next to the workspace\'s own and changes nothing else of the cycle', () => {
    const c = applied();
    expect(flow.runKind).toBe('release');
    expect(c.devCycle.flows?.release?.map((s) => s.id)).toEqual(RELEASE_FLOW_STAGES.map((s) => s.id));
    expect(c.devCycle.stages).toEqual(issueFlow.devCycle.stages);
    expect(c.devCycle.templateId).toBe('agent-flow');
    expect({ ...c.devCycle, flows: null, comments: null }).toEqual({ ...issueFlow.devCycle, flows: null, comments: null });
    expect(c.agents.team.map((a) => a.id)).toContain('release-manager');
    expect(c.agents.team.filter((a) => a.id !== 'release-manager')).toEqual(issueFlow.agents.team);
  });

  it('validates with nothing to say about it: the flow of the release has no problem and the agent works its stages', () => {
    const c = applied();
    const checked = validateConfig(c);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings).toEqual([]);
    expect(checkFlow({ stages: c.devCycle.flows!.release, team: c.agents.team }, { asFlow: true })).toEqual([]);
    const own = apply('release-flow');
    expect(validateConfig(own).errors).toEqual([]);
    expect(validateConfig(own).warnings).toEqual([]);
  });

  it('goes plan, gate, assemble, merges in, beta, beta on the host, feedback, gate, stable, stable on the host, published, and every stage is reachable', () => {
    const stages = flowOf({ agents: { team: applied().agents.team }, devCycle: { stages: applied().devCycle.flows!.release } });
    expect(stages.map((s) => [s.id, s.type, s.agent])).toEqual([
      ['release-plan', 'work', 'release-manager'],
      ['release-plan-gate', 'gate', null],
      ['release-assemble', 'work', 'release-manager'],
      ['release-merged', 'wait', null],
      ['release-beta', 'work', 'release-manager'],
      ['release-beta-out', 'wait', null],
      ['release-feedback', 'wait', null],
      ['release-stable-gate', 'gate', null],
      ['release-stable', 'work', 'release-manager'],
      ['release-stable-out', 'wait', null],
      ['release-published', 'work', null],
    ]);
    expect(stages.find((s) => s.id === 'release-plan')?.artifacts).toEqual(['RELEASE_PLAN.md']);
    expect(stages.find((s) => s.id === 'release-merged')?.waitsFor).toEqual({ kind: 'release-approved' });
    expect(stages.find((s) => s.id === 'release-feedback')?.waitsFor).toEqual({ kind: 'beta-age', minutes: 1440, label: 'beta-blocker' });
    // the run goes on from a cut only when the host has it, and is published only when the host has the stable
    expect(stages.find((s) => s.id === 'release-beta-out')?.waitsFor).toEqual({ kind: 'beta-out' });
    expect(stages.find((s) => s.id === 'release-stable-out')?.waitsFor).toEqual({ kind: 'stable-out' });
    // a rejected gate goes back to the work stage it judged
    expect(stages.find((s) => s.id === 'release-plan-gate')?.returnsTo).toBe('release-plan');
    expect(stages.find((s) => s.id === 'release-stable-gate')?.returnsTo).toBe('release-beta');
    expect(stages.at(-1)?.next).toBeNull();
  });

  it('shares no stage id with the flows for issues, so an agent that lists stages cannot mix the two', () => {
    const ids = new Set(RELEASE_FLOW_STAGES.map((s) => s.id));
    for (const id of ['agent-flow', 'agent-flow-engineering', 'sdd', 'scrum', 'kanban', 'github-flow', 'minimal']) for (const s of cycleOf(builtInTemplate(id)!).stages) expect(ids.has(s.id), `${id}: ${s.id}`).toBe(false);
  });

  it('brings a Release manager that reads the host and runs nothing: tracker read, no shell, no files', () => {
    const agent = flow.team!.find((a) => a.id === 'release-manager')!;
    expect(agent).toMatchObject({ permission: 'read', tracker: 'read', shell: 'none', autonomous: true, system: false, turnsTo: null });
    expect(agent.stages.sort()).toEqual(['release-assemble', 'release-beta', 'release-plan', 'release-stable']);
    expect(RECOMMENDED['release-manager']).toEqual({ tracker: 'read', shell: 'none' });
  });

  it('has every text in both catalogs: the template, the stages, the agent and each comment', () => {
    const cycle = cycleOf(flow);
    const keys = [
      flow.name,
      flow.description,
      ...cycle.stages.map((s) => s.label),
      ...flow.team!.flatMap((a) => [a.name, a.job, a.instructions]),
      ...Object.values(cycle.comments).flatMap((c) => [c.title, c.status, ...c.sections.flatMap((s) => [s.heading, s.guidance])]),
    ];
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) for (const l of ['pt-BR', 'en'] as const) expect(CATALOGS[l][key], `${l} ${key}`).toBeTruthy();
  });

  it('has a comment for each work stage and for what the app writes on the tracking issue, and reuses the gate and the question of the agent cycle', () => {
    const comments = cycleOf(flow).comments;
    for (const s of RELEASE_FLOW_STAGES.filter((x) => x.agentId)) expect(comments[s.id], s.id).toBeTruthy();
    for (const k of ['activities', 'beta-published', 'stable-published', 'gate', 'question']) expect(comments[k], k).toBeTruthy();
    expect(comments.gate).toEqual(cycleOf(builtInTemplate('agent-flow')!).comments.gate);
  });

  it('is idempotent, keeps a comment the person edited, and does not touch the config it was given', () => {
    const once = applied();
    expect(applyTemplate(once, flow)).toEqual(once);
    const edited = structuredClone(once);
    edited.devCycle.comments['release-plan'].title = 'My own title';
    expect(applyTemplate(edited, flow).devCycle.comments['release-plan'].title).toBe('My own title');
    const before = structuredClone(issueFlow);
    applyTemplate(issueFlow, flow);
    expect(issueFlow).toEqual(before);
  });

  it('keeps the flow when another template replaces the cycle of the workspace', () => {
    const c = applyTemplate(applied(), builtInTemplate('scrum')!);
    expect(c.devCycle.flows?.release).toBeTruthy();
    expect(validateConfig(c).errors).toEqual([]);
    expect(c.agents.team.find((a) => a.id === 'release-manager')?.stages.length).toBeGreaterThan(0);
  });

  it('refuses a squad called release: its id is the key of this flow', () => {
    const c = applied();
    c.squads = [{ id: 'release', name: 'Release', mission: '', scope: { repos: [], labels: [], paths: [], unclaimed: false }, liaison: null, autonomy: true, label: null }];
    expect(validateConfig(c).errors.map((e) => e.path)).toContain('squads[0].id');
  });

  it('a flow of a release that is broken is reported with its path', () => {
    const c = applied();
    c.devCycle.flows!.release[3] = { ...c.devCycle.flows!.release[3], waitsFor: { kind: 'beta-age' } };
    const r = validateConfig(c);
    expect(r.errors.map((e) => e.path)).toContain('devCycle.flows.release[3].waitsFor');
  });

  it('is not part of the template file a workspace exports: the file is valid and the Release manager lists no stage of a flow it does not carry', () => {
    const template = templateFromConfig(applied(), { id: 'mine', name: 'Mine', description: '' });
    expect(template.devCycle.flows).toBeUndefined();
    expect(template.team?.find((a) => a.id === 'release-manager')?.stages).toEqual([]);
    expect(parseTemplate(JSON.parse(exportTemplateText(template, new Date('2026-10-03T12:00:00Z')))).errors).toEqual([]);
  });

  it('travels in a template file with its kind', () => {
    const check = parseTemplate(JSON.parse(exportTemplateText(flow, new Date('2026-10-03T12:00:00Z'))));
    expect(check.errors).toEqual([]);
    expect(check.template?.runKind).toBe('release');
    expect(applyTemplate(issueFlow, check.template!).devCycle.flows?.release).toEqual(applied().devCycle.flows?.release);
  });
});

describe('the docs-flow template', () => {
  const flow = builtInTemplate('docs-flow')!;
  const release = builtInTemplate('release-flow')!;
  const issueFlow = applyTemplate(neutralConfig(), builtInTemplate('agent-flow')!);
  const applied = () => applyTemplate(issueFlow, flow);

  it('is a template of a kind of run: it adds its flow next to the workspace\'s own and changes nothing else of the cycle', () => {
    const c = applied();
    expect(flow.runKind).toBe('docs');
    expect(c.devCycle.flows?.docs?.map((s) => s.id)).toEqual(DOCS_FLOW_STAGES.map((s) => s.id));
    expect(c.devCycle.stages).toEqual(issueFlow.devCycle.stages);
    expect(c.devCycle.templateId).toBe('agent-flow');
    expect({ ...c.devCycle, flows: null, comments: null }).toEqual({ ...issueFlow.devCycle, flows: null, comments: null });
    expect(c.agents.team.map((a) => a.id)).toContain('docs-writer');
    expect(c.agents.team.filter((a) => a.id !== 'docs-writer')).toEqual(issueFlow.agents.team);
  });

  it('is applied next to the release flow, in either order, without touching it', () => {
    const both = applyTemplate(applyTemplate(issueFlow, release), flow);
    const other = applyTemplate(applyTemplate(issueFlow, flow), release);
    expect(Object.keys(both.devCycle.flows ?? {}).sort()).toEqual(['docs', 'release']);
    expect(both.devCycle.flows?.release).toEqual(applyTemplate(issueFlow, release).devCycle.flows?.release);
    expect(other.devCycle.flows).toEqual(both.devCycle.flows);
    expect(validateConfig(both).errors).toEqual([]);
    expect(validateConfig(both).warnings).toEqual([]);
  });

  it('validates with nothing to say about it: the flow has no problem and the agent works its stages', () => {
    const c = applied();
    const checked = validateConfig(c);
    expect(checked.errors).toEqual([]);
    expect(checked.warnings).toEqual([]);
    expect(checkFlow({ stages: c.devCycle.flows!.docs, team: c.agents.team }, { asFlow: true })).toEqual([]);
    const own = apply('docs-flow');
    expect(validateConfig(own).errors).toEqual([]);
    expect(validateConfig(own).warnings).toEqual([]);
  });

  it('goes draft, gate, apply, ready, documented, the gate goes back to the draft, and the push is proposed only after the gate', () => {
    const c = applied();
    const stages = flowOf({ agents: { team: c.agents.team }, devCycle: { stages: c.devCycle.flows!.docs } });
    expect(stages.map((s) => [s.id, s.type, s.agent])).toEqual([
      ['docs-draft', 'work', 'docs-writer'],
      ['docs-gate', 'gate', null],
      ['docs-publish', 'work', 'docs-writer'],
      ['docs-ready', 'wait', null],
      ['docs-done', 'work', null],
    ]);
    expect(stages.find((s) => s.id === 'docs-draft')?.artifacts).toEqual(['IMPORT_NOTES.md']);
    expect(stages.find((s) => s.id === 'docs-gate')?.returnsTo).toBe('docs-draft');
    expect(stages.find((s) => s.id === 'docs-ready')?.waitsFor).toEqual({ kind: 'pr-merged' });
    expect(stages.at(-1)?.next).toBeNull();
    // the app proposes the push at the end of the last stage that writes: it must be the one after the gate
    expect(pushStagesOf(c, stages).map((s) => s.id)).toEqual(['docs-publish']);
    // no stage comments on a tracker: a documentation run has no issue
    expect(stages.filter((s) => s.type === 'work').map((s) => s.comment)).toEqual([null, null, null]);
  });

  it('shares no stage id with the flows for issues or the release flow', () => {
    const ids = new Set(DOCS_FLOW_STAGES.map((s) => s.id));
    for (const id of ['agent-flow', 'agent-flow-engineering', 'sdd', 'scrum', 'kanban', 'github-flow', 'minimal', 'release-flow']) for (const s of cycleOf(builtInTemplate(id)!).stages) expect(ids.has(s.id), `${id}: ${s.id}`).toBe(false);
  });

  it('brings a Documentation writer that changes files, runs nothing and reads no tracker, and a flow that is not offered by the wizard', async () => {
    const agent = flow.team!.find((a) => a.id === 'docs-writer')!;
    expect(agent).toMatchObject({ permission: 'worktree', shell: 'none', tracker: 'none', autonomous: true, system: false, turnsTo: null, model: { role: 'deep' } });
    expect(agent.stages.sort()).toEqual(['docs-draft', 'docs-publish']);
    expect(RECOMMENDED['docs-writer']).toEqual({ tracker: 'none', shell: 'none' });
    const { listCycleTemplates } = await import('../src/main/cycles');
    expect(listCycleTemplates('en').map((t) => t.id)).not.toContain('docs-flow');
  });

  it('has every text in both catalogs: the template, the stages, the agent and the description of the pull request', () => {
    const cycle = cycleOf(flow);
    const keys = [flow.name, flow.description, ...cycle.stages.map((s) => s.label), ...flow.team!.flatMap((a) => [a.name, a.job, a.instructions]), ...Object.values(cycle.comments).flatMap((c) => [c.title, c.status, ...c.sections.flatMap((s) => [s.heading, s.guidance])])];
    expect(keys.length).toBe(20);
    for (const key of keys) for (const l of ['pt-BR', 'en'] as const) expect(CATALOGS[l][key], `${l} ${key}`).toBeTruthy();
  });

  it('brings the description of the pull request as its own comment, with no section that closes an issue, and nothing of the issue flow\'s comments', () => {
    const comments = cycleOf(flow).comments;
    expect(Object.keys(comments)).toEqual(['docs-pr']);
    const text = [comments['docs-pr'].title, comments['docs-pr'].status, ...comments['docs-pr'].sections.flatMap((s) => [s.heading, s.guidance])].map((k) => CATALOGS.en[k]).join('\n');
    expect(text).not.toMatch(/closes/i);
    expect(comments['docs-pr'].sections).toHaveLength(4);
  });

  it('is idempotent, keeps a comment the person edited, and does not touch the config it was given', () => {
    const once = applied();
    expect(applyTemplate(once, flow)).toEqual(once);
    const edited = structuredClone(once);
    edited.devCycle.comments['docs-pr'].title = 'My own title';
    expect(applyTemplate(edited, flow).devCycle.comments['docs-pr'].title).toBe('My own title');
    const before = structuredClone(issueFlow);
    applyTemplate(issueFlow, flow);
    expect(issueFlow).toEqual(before);
  });

  it('keeps the person\'s own agent when the workspace already has one called docs-writer: the flow points at it', () => {
    const own = structuredClone(issueFlow);
    own.agents.team.push({ ...structuredClone(flow.team![0]), name: 'Mine', permission: 'read', stages: [] });
    const c = applyTemplate(own, flow);
    expect(c.agents.team.filter((a) => a.id === 'docs-writer')).toHaveLength(1);
    expect(c.agents.team.find((a) => a.id === 'docs-writer')).toMatchObject({ name: 'Mine', permission: 'read' });
    expect(c.devCycle.flows?.docs).toBeTruthy();
  });

  it('keeps the flow when another template replaces the cycle of the workspace', () => {
    const c = applyTemplate(applied(), builtInTemplate('scrum')!);
    expect(c.devCycle.flows?.docs).toBeTruthy();
    expect(validateConfig(c).errors).toEqual([]);
    expect(c.agents.team.find((a) => a.id === 'docs-writer')?.stages.length).toBeGreaterThan(0);
  });

  it('refuses a squad called docs: its id is the key of this flow', () => {
    const c = applied();
    c.squads = [{ id: 'docs', name: 'Docs', mission: '', scope: { repos: [], labels: [], paths: [], unclaimed: false }, liaison: null, autonomy: true, label: null }];
    const errors = validateConfig(c).errors;
    expect(errors.map((e) => e.path)).toContain('squads[0].id');
    expect(errors.find((e) => e.path === 'squads[0].id')?.message).toMatch(/documentation run/);
  });

  it('a flow that is broken is reported with its path', () => {
    const c = applied();
    c.devCycle.flows!.docs[3] = { ...c.devCycle.flows!.docs[3], waitsFor: undefined };
    expect(validateConfig(c).errors.map((e) => e.path)).toContain('devCycle.flows.docs[3].waitsFor');
  });

  it('a comment for docs-pr is used only while the workspace has the flow', () => {
    const c = applied();
    delete c.devCycle.flows!.docs;
    expect(validateConfig(c).warnings.map((w) => w.path)).toContain('devCycle.comments.docs-pr');
  });

  it('is not part of the template file a workspace exports: the file is valid and the writer lists no stage of a flow it does not carry', () => {
    const template = templateFromConfig(applied(), { id: 'mine', name: 'Mine', description: '' });
    expect(template.devCycle.flows).toBeUndefined();
    expect(template.team?.find((a) => a.id === 'docs-writer')?.stages).toEqual([]);
    expect(parseTemplate(JSON.parse(exportTemplateText(template, new Date('2026-10-06T12:00:00Z')))).errors).toEqual([]);
  });

  it('travels in a template file with its kind', () => {
    const check = parseTemplate(JSON.parse(exportTemplateText(flow, new Date('2026-10-06T12:00:00Z'))));
    expect(check.errors).toEqual([]);
    expect(check.template?.runKind).toBe('docs');
    expect(applyTemplate(issueFlow, check.template!).devCycle.flows?.docs).toEqual(applied().devCycle.flows?.docs);
  });
});
