import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { appPromptKind } from '../src/main/retention-core';
import { classify } from '../src/main/custo-core';
import { entryOf } from '../src/main/sessions-core';
import { webAccess } from '../src/main/webPolicy';
import { normalizeTemplates } from '../src/main/wizard-core';
import type { Captured } from './helpers/promptCapture';

let core: typeof import('../src/main/cycle-core');
let cfg: typeof import('../src/main/workspaceConfig');
let cycles: typeof import('../src/main/cycles');

beforeAll(async () => {
  core = await import('../src/main/cycle-core');
  cfg = await import('../src/main/workspaceConfig');
  cycles = await import('../src/main/cycles');
});

describe('which ceremonies the workspace offers', () => {
  it('starts with the ones a fresh workspace has: the daily preparation, the unblock conversation and the retro', () => {
    expect(['preDaily', 'unblock', 'gate', 'qaHandoff', 'retro', 'releaseConflicts'].filter((c) => core.cycleOn(c as never))).toEqual(['preDaily', 'unblock', 'retro']);
  });

  it('offers all of them for SDD, and only the ones it is made of for the others', () => {
    const on = () => ['preDaily', 'unblock', 'gate', 'qaHandoff', 'retro', 'releaseConflicts'].filter((c) => core.cycleOn(c as never));
    core.applyCycleTemplate('sdd');
    expect(on()).toEqual(['preDaily', 'unblock', 'gate', 'qaHandoff', 'retro', 'releaseConflicts']);
    core.applyCycleTemplate('scrum');
    expect(on()).toEqual(['preDaily', 'unblock', 'retro']);
    core.applyCycleTemplate('minimal');
    expect(on()).toEqual(['preDaily', 'unblock']);
    core.applyCycleTemplate('github-flow');
    expect(on()).toEqual(['preDaily', 'unblock']);
  });

  it('does not offer the gate or the QA hand-off without a specs folder, even when the cycle has them', () => {
    core.applyCycleTemplate('sdd');
    const specs = process.env.CERIMONIAS_SPECS_DIR;
    try {
      delete process.env.CERIMONIAS_SPECS_DIR;
      cfg.saveConfig(cfg.getConfig());
      expect(core.cycleOn('gate')).toBe(false);
      expect(core.cycleOn('qaHandoff')).toBe(false);
      expect(core.cycleOn('preDaily')).toBe(true);
      expect(core.cycleView().ceremonies.gate).toBe(false);
    } finally {
      process.env.CERIMONIAS_SPECS_DIR = specs;
      cfg.saveConfig(cfg.getConfig());
    }
    expect(core.cycleOn('gate')).toBe(true);
  });

  it('does not offer the gate when the cycle names no gate artifact', () => {
    core.applyCycleTemplate('sdd');
    cfg.updateConfig((c) => {
      c.devCycle.specLayout.gateFiles = [];
      return c;
    });
    expect(core.cycleOn('gate')).toBe(false);
    expect(core.cycleOn('qaHandoff')).toBe(true);
    core.applyCycleTemplate('sdd');
  });

  it('gives the screens the view of the cycle: what is offered, the stages, the label and how to greet', () => {
    cfg.updateConfig((c) => {
      c.userName = 'Ana';
      c.language = 'en';
      return c;
    });
    core.applyCycleTemplate('scrum');
    const v = core.cycleView();
    expect(v).toMatchObject({ templateId: 'scrum', templateName: 'Scrum', language: 'en', userName: 'Ana', preDailyLabel: 'daily scrum' });
    expect(v.ceremonies).toEqual({ preDaily: true, unblock: true, gate: false, qaHandoff: false, retro: true, releaseConflicts: false });
    expect(v.stages.map((s) => s.id)).toContain('in-progress');
    expect(v.destination).toEqual({ heading: '', noteTool: null, noteFallback: 'card note', minutes: 'ceremony minutes' });
    cfg.updateConfig((c) => {
      c.language = 'pt-BR';
      return c;
    });
    expect(core.cycleView()).toMatchObject({ templateName: 'Scrum', preDailyLabel: 'daily scrum', destination: expect.objectContaining({ noteFallback: 'nota do cartão' }) });
  });
});

describe('applying and managing templates', () => {
  it('lists the built-in templates in the language of the workspace', () => {
    const pt = core.listTemplates('pt-BR');
    expect(pt.map((t) => t.id)).toEqual(['sdd', 'scrum', 'kanban', 'github-flow', 'minimal']);
    expect(pt[0]).toMatchObject({ name: 'SDD (spec-driven, gates e QA)', builtIn: true });
    expect(pt[0].ceremonies).toHaveLength(6);
    expect(core.listTemplates('en')[4].name).toBe('Minimal (only the daily prep and unblocking)');
  });

  it('refuses a template nobody knows', () => {
    expect(() => core.applyCycleTemplate('nothing')).toThrow(/desconhecido/);
  });

  it('validates what it saves: a template that would make an invalid config is refused with the problem named', () => {
    const bad = { id: 'broken', name: 'Broken', devCycle: { stageMapping: [{ provider: 'any', source: 'state', pattern: 'x', stage: 'ghost' }] } };
    expect(core.checkTemplateText(JSON.stringify(bad)).errors.map((e) => e.path)).toContain('template.devCycle.stageMapping[0].stage');
    expect(() => core.saveTemplateText(JSON.stringify(bad))).toThrow(/stageMapping\[0\]\.stage/);
    expect(core.checkTemplateText('not json').errors[0].message).toMatch(/not valid JSON|não é um JSON válido/);
  });

  it('exports the current cycle, imports it back as a template of its own, applies it and removes it', () => {
    core.applyCycleTemplate('kanban');
    cfg.updateConfig((c) => {
      c.devCycle.ceremonyParams.retro.windowDays = 21;
      return c;
    });
    const { text, filename } = core.exportCurrentCycle({ id: 'my-flow', name: 'My flow', description: 'Kanban with a three week retro' });
    expect(filename).toBe('coxia-cycle-my-flow.json');
    const saved = core.saveTemplateText(text);
    expect(saved).toMatchObject({ id: 'my-flow', name: 'My flow', builtIn: false });
    expect(core.listTemplates().map((t) => t.id)).toContain('my-flow');
    core.applyCycleTemplate('minimal');
    expect(cfg.getConfig().devCycle.ceremonyParams.retro.windowDays).toBe(7);
    core.applyCycleTemplate('my-flow');
    expect(cfg.getConfig().devCycle.templateId).toBe('my-flow');
    expect(cfg.getConfig().devCycle.ceremonyParams.retro.windowDays).toBe(21);
    expect(cfg.getConfig().devCycle.stages.map((s) => s.id)).toContain('review');
    core.removeTemplate('my-flow');
    expect(core.listTemplates().map((t) => t.id)).not.toContain('my-flow');
  });

  it('does not let a file take the id of a built-in template, nor remove one', () => {
    const { text } = core.exportCurrentCycle({ id: 'scrum', name: 'Mine', description: '' });
    expect(() => core.saveTemplateText(text)).toThrow(/já vem com o app/);
    expect(() => core.removeTemplate('scrum')).toThrow(/não podem ser removidos/);
    expect(() => core.removeTemplate('../x')).toThrow(/inválido/);
  });

  it('keeps the QA account of the workspace across templates', () => {
    cfg.updateConfig((c) => {
      c.devCycle.qa.user = 'qa.team';
      return c;
    });
    core.applyCycleTemplate('sdd');
    expect(cfg.getConfig().devCycle.qa.user).toBe('qa.team');
    core.applyCycleTemplate('scrum', { keepQaUser: false });
    expect(cfg.getConfig().devCycle.qa.user).toBeNull();
  });
});

describe('what the setup wizard is given', () => {
  it('a list of templates in the shape its normaliser reads: each one carries the cycle it sets and what the person still provides', () => {
    const listed = cycles.listCycleTemplates('en');
    const info = normalizeTemplates(listed);
    expect(info.map((t) => t.id)).toEqual(['sdd', 'scrum', 'kanban', 'github-flow', 'minimal']);
    const scrum = info.find((t) => t.id === 'scrum')!;
    expect(scrum).toMatchObject({ name: 'Scrum', available: true, ceremonies: { preDaily: true, gate: false, retro: true }, needs: ['issueProject'] });
    expect(scrum.stages.map((s) => s.id)).toContain('in-progress');
    const patch = scrum.patch as { devCycle: { templateId: string; ceremonies: Record<string, boolean> } };
    expect(patch.devCycle.templateId).toBe('scrum');
    expect(patch.devCycle.ceremonies.gate).toBe(false);
    expect(info.find((t) => t.id === 'sdd')!.needs).toContain('specsDir');
  });

  it('a scan of the projects of a config, as the docs it proposes, the notes and one summary per project', () => {
    const c = cfg.getConfig();
    const result = cycles.prepareAgents({ ...c, projects: { ...c.projects, roots: [join(import.meta.dirname, '..', 'test', 'helpers')], autoDiscover: false } }, { home: '/nonexistent-home' });
    expect(Object.keys(result.docs).sort()).toEqual(['agentsDirs', 'claudeMdRoots', 'knowledgeDirs', 'mcpConfigFiles', 'rulesDirs', 'skillsDirs', 'specsDir']);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(Array.isArray(result.projects)).toBe(true);
  });
});

describe('the web policy of the cycle channels', () => {
  it('lets a paired browser read the cycle and the template list, and nothing that writes or reads the machine', () => {
    for (const channel of ['cycle:view', 'cycle:templates', 'cycle:template-export', 'cycle:template-check', 'agents:propose', 'agents:can-summarize']) expect(webAccess(channel), channel).toBe('allow');
    for (const channel of ['cycle:apply', 'cycle:template-save', 'cycle:template-remove', 'cycle:template-pick', 'agents:scan', 'agents:apply', 'agents:summarize']) expect(webAccess(channel), channel).toBe('deny');
  });
});

describe('recognising the prompts the app sends', () => {
  const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'golden', 'legacy-prompts.json'), 'utf8')) as { prompts: Record<string, Captured> };
  const first = (name: string) => golden.prompts[name].prompt;

  it('classifies for the cost screen exactly what it classified before the prompts moved to the catalogs', () => {
    expect(classify(first('turn'))).toBe('turn');
    expect(classify(first('deep'))).toBe('deep');
    expect(classify(first('gate-start'))).toBe('gate');
    expect(classify(first('qa-prepare'))).toBe('qa');
    expect(classify(first('retro'))).toBe('retro');
    expect(classify(first('teams'))).toBe('teams');
    expect(classify(first('release-comment'))).toBe('release');
    expect(classify(first('conflict-ask'))).toBe('release');
    expect(classify(first('conflict-propose'))).toBe('release');
    expect(classify('Explique o que este arquivo faz')).toBeNull();
  });

  it('labels every prompt of the app for the retention screen, and leaves the person own sessions alone', () => {
    const kinds: [string, string][] = [
      ['turn', 'fala do agente'],
      ['deep', 'desbloqueio'],
      ['deep-options', 'desbloqueio'],
      ['gate-start', 'gate'],
      ['gate-answer-free', 'gate'],
      ['gate-explain', 'gate'],
      ['gate-visual', 'gate'],
      ['gate-round', 'gate'],
      ['qa-prepare', 'passagem para o QA'],
      ['qa-ask', 'passagem para o QA'],
      ['retro', 'retro'],
      ['retro-ask', 'retro'],
      ['teams', 'texto do resumo'],
      ['release-comment', 'sincronização com a release'],
      ['conflict-ask', 'sincronização com a release'],
      ['reentry', 'reentrada'],
      ['discussion', 'revisão de MR'],
    ];
    for (const [name, kind] of kinds) expect(appPromptKind(first(name)), name).toBe(kind);
    expect(appPromptKind('Escreva um teste para esta função')).toBeNull();
    expect(appPromptKind(null)).toBeNull();
  });

  it('ties a session to its card by the ref in the first line, in either language', () => {
    expect(entryOf('s1', 'turn', first('turn')).ref).toBe('web#101');
    expect(entryOf('s2', 'deep', first('gate-start')).ref).toBe('web#101');
    expect(entryOf('s3', 'deep', first('reentry')).ref).toBe('web#101');
    expect(entryOf('s4', 'turn', 'You are the agent of activity api#7 in the voice standup.')).toMatchObject({ kind: 'turn', ref: 'api#7' });
    expect(entryOf('s5', 'deep', first('retro')).ref).toBeNull();
  });
});
