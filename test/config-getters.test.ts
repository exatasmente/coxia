// The bound getters modules call (workspaceConfig.ts) on the real module chain: a fresh data dir first, then the same workspace after it
// takes the profile of an install that predates the configuration.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cfg = await import('../src/main/workspaceConfig');
const { getSettings, saveSettings } = await import('../src/main/config');
const { ATAS, HOME } = await import('../src/main/env');
const { specInfo, phasePluginDocuments } = await import('../src/main/cards');
const { stageWeight } = await import('../src/main/radar');
const { installLegacyConfig } = await import('./helpers/config');
const { CONFIG_SCHEMA_VERSION } = await import('../src/shared/config/types');

describe('a fresh install', () => {
  it('starts with the neutral defaults and the wizard flag off', () => {
    expect(cfg.getConfig().setupComplete).toBe(false);
    expect(cfg.getConfig().projects.repos).toEqual([]);
    expect(cfg.getConfig().vcs).toEqual([]);
  });

  it('has no host, no issue project, no QA marker: every call that needs one says what is missing', () => {
    expect(cfg.rc().vcsHost).toBeNull();
    expect(cfg.vcsCliEnv().GITLAB_HOST).toBeUndefined();
    expect(() => cfg.requireVcsHost()).toThrow(/integração/);
    expect(() => cfg.issueProjectRef()).toThrow(/projeto de issues/);
    expect(cfg.issueWebUrl(1)).toBeNull();
    expect(cfg.qaNoteMarker()).toBeNull();
    expect(cfg.isIssueRef('101')).toBe(false);
  });

  it('finds no spec folder and ranks no stage', () => {
    expect(specInfo('101')).toBeNull();
    expect(stageWeight('STAGE:: Code Review OK')).toBe(0);
  });

  it('the Settings view works on the neutral config and does not leak a company model list', () => {
    const s = getSettings();
    expect(s.models.turn).toBe('haiku');
    expect(s.modelOptions).toEqual(['haiku', 'sonnet', 'opus']);
    expect(s.language).toBe('pt-BR');
    expect(s.web.host).toBe('127.0.0.1');
  });

  it('a Settings save lands in the workspace config, validated', () => {
    const saved = saveSettings({ ...getSettings(), notifications: false, language: 'en', models: { ...getSettings().models, deep: 'opus' } });
    expect(saved.notifications).toBe(false);
    expect(cfg.getConfig().language).toBe('en');
    expect(cfg.getConfig().llm.roles.deep).toEqual({ provider: 'anthropic', model: 'opus' });
    expect(() => saveSettings({ ...getSettings(), models: { ...getSettings().models, turn: 'has space' } })).toThrow(/invalid model/);
    expect(() => cfg.saveConfig({ ...cfg.getConfig(), language: 'fr' })).toThrow(/invalid configuration: language/);
  });
});

describe('after the previous app profile is applied', () => {
  it('returns the constants env.ts used to hold', async () => {
    await installLegacyConfig();
    expect(cfg.rc().vcsHost).toBe('git.acme.test');
    expect(cfg.vcsCliEnv().GITLAB_HOST).toBe('git.acme.test');
    expect(cfg.requireVcsHost()).toBe('git.acme.test');
    expect(cfg.issueProjectRef()).toBe('1');
    expect(cfg.issueProjectPath()).toBe('acme%2Fweb');
    expect(cfg.issueWebUrl(101)).toBe('https://git.acme.test/acme/web/-/work_items/101');
    expect(cfg.qaNoteMarker()?.test('@qa.acme\nBranch de release')).toBe(true);
    expect(cfg.qaNoteMarker()?.test('@qaXinterno')).toBe(false);
    expect(cfg.qaUser()).toBe('qa.acme');
    expect(cfg.isIssueRef('web#101')).toBe(true);
    expect(cfg.isIssueRef('web!101')).toBe(false);
    expect(cfg.rc().projectsRoot).toBe(join(HOME, 'projects'));
    expect(cfg.rc().cardSource?.command).toBe(join(HOME, '.local/bin/cardtool'));
    expect(stageWeight('STAGE:: Code Review OK')).toBe(5);
    expect(stageWeight('Test Fail')).toBe(6);
  });

  it('finds the spec folder and the phase of an issue through the configured layout', () => {
    const specs = cfg.rc().specsDir as string;
    mkdirSync(join(specs, '#101-filtro/bug'), { recursive: true });
    writeFileSync(join(specs, '#101-filtro/bug/1_INVESTIGATION.md'), '#');
    writeFileSync(join(specs, '#101-filtro/bug/2_PLAN.md'), '#');
    const info = specInfo('101');
    expect(info?.phase).toBe('Plan escrito');
    expect(info?.planFile).toBe(join(specs, '#101-filtro/bug/2_PLAN.md'));
    expect(specInfo('99999')).toBeNull();
  });

  it('counts a document of the flow in the phase, at its anchor, and keeps the cycle documents above it', () => {
    const specs = cfg.rc().specsDir as string;
    const before = phasePluginDocuments.files;
    try {
      phasePluginDocuments.files = () => [
        { name: 'REQUIREMENTS.md', label: 'Requisitos escritos', flow: { gate: 1, phase: { label: 'Requisitos escritos', before: '1_INVESTIGATION.md' } } },
        { name: 'PROTOTYPE.md', label: 'Protótipo escrito', flow: { gate: 2, phase: { label: 'Protótipo escrito', before: '2_PLAN.md' } } },
      ];
      mkdirSync(join(specs, '#202-requisitos'), { recursive: true });
      writeFileSync(join(specs, '#202-requisitos/REQUIREMENTS.md'), '#');
      expect(specInfo('202')?.phase).toBe('Requisitos escritos');
      // The plan is above the requirements: a folder holding both shows the phase of the most advanced document.
      writeFileSync(join(specs, '#202-requisitos/2_PLAN.md'), '#');
      expect(specInfo('202')?.phase).toBe('Plan escrito');
      // The prototype sits above the plan (more advanced than it): a folder holding both shows the prototype's phase.
      mkdirSync(join(specs, '#203-prototipo'), { recursive: true });
      writeFileSync(join(specs, '#203-prototipo/PROTOTYPE.md'), '#');
      writeFileSync(join(specs, '#203-prototipo/2_PLAN.md'), '#');
      expect(specInfo('203')?.phase).toBe('Protótipo escrito');
    } finally {
      phasePluginDocuments.files = before;
    }
  });

  it('reads the phase exactly as today when a document anchors to a file the layout does not have', () => {
    const specs = cfg.rc().specsDir as string;
    const before = phasePluginDocuments.files;
    try {
      phasePluginDocuments.files = () => [{ name: 'REQUIREMENTS.md', label: 'Requisitos escritos', flow: { gate: 1, phase: { label: 'Requisitos escritos', before: 'GONE.md' } } }];
      mkdirSync(join(specs, '#204-ancora'), { recursive: true });
      writeFileSync(join(specs, '#204-ancora/REQUIREMENTS.md'), '#');
      mkdirSync(join(specs, '#205-vazio'), { recursive: true });
      writeFileSync(join(specs, '#205-vazio/9_OTHER.md'), '#');
      expect(specInfo('204')?.phase).toBe(specInfo('205')?.phase);
    } finally {
      phasePluginDocuments.files = before;
    }
  });

  it('the config file of the workspace is at the current schema on disk', async () => {
    const { readConfigFile } = await import('../src/main/config-bootstrap');
    expect((readConfigFile(ATAS) as { schemaVersion: number }).schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
  });
});
