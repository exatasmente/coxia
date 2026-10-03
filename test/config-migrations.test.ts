import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateConfig } from '../src/shared/config/migrations';
import { neutralConfig } from '../src/shared/config/defaults';
import { validateConfig } from '../src/shared/config/validate';
import { MARKER_FILE, V1_BACKUP_FILE, bootstrapConfigs, detectExistingInstall, readConfigFile } from '../src/main/config-bootstrap';
import { ensureWorkspaces, setTestFlag, workspaceDir, createWorkspace } from '../src/main/workspaces-core';
import { V1_SETTINGS, exampleProfile } from './helpers/config';

const quiet = { log: () => undefined, now: () => new Date('2026-10-02T12:00:00Z') };
let root: string;

function put(rel: string, content: string): void {
  const file = join(root, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

// The flat layout of the app before workspaces, with the real file names and the real settings shape.
function flatLayout(): void {
  put('config.json', JSON.stringify({ ...V1_SETTINGS, web: { enabled: true, host: '198.51.100.1', port: 4330, basePath: '/cerimonias/', publicUrl: 'https://coxia.acme.test/cerimonias/', trustedProxy: '198.51.100.0/24', allowExternalEffects: false } }));
  put('acoes.json', '{"releaseSeen":null,"actions":[]}');
  put('custo.json', '{"version":1}');
  put('falas.json', '{"version":1,"turns":{},"reuses":[]}');
  put('2026-10-02-pre-daily.md', '# ata');
  put('historico/2026-10-02T093000.json', '{"version":1}');
  put('gates/g1.json', '{"g":1}');
  put('glossario.json', '[]');
  put('web-sessions.json', '{"sessions":[]}');
}

// What the app does at startup, in the same order as env.ts + workspaceConfig.ts.
function startUp(profile: ReturnType<typeof exampleProfile> | null = exampleProfile()) {
  const existing = detectExistingInstall(root);
  const resolved = ensureWorkspaces(root, quiet);
  const boot = bootstrapConfigs({ root, existingInstall: existing, profile, ...quiet });
  return { resolved, boot, existing };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cerimonias-cfg-'));
});

describe('migrateConfig', () => {
  it('turns a v1 settings file into a current config with the legacy profile, keeping every value the user had', () => {
    const r = migrateConfig({ ...V1_SETTINGS, models: { turn: 'a/b', reply: 'c/d', deep: 'e/f', teams: 'g/h' }, schedule: { ...V1_SETTINGS.schedule, preDaily: '10:15' }, notifications: false }, { legacyInstall: false, profile: exampleProfile() });
    expect(r.fromVersion).toBe(1);
    expect(r.changed).toBe(true);
    const c = r.config;
    expect(c.schemaVersion).toBe(8);
    expect(c.setupComplete).toBe(true);
    expect(c.llm.roles).toEqual({ turn: { provider: 'openrouter', model: 'a/b' }, reply: { provider: 'openrouter', model: 'c/d' }, deep: { provider: 'openrouter', model: 'e/f' }, teams: { provider: 'openrouter', model: 'g/h' }, fix: { provider: 'openrouter', model: 'c/d' } });
    expect(c.schedule.preDaily).toBe('10:15');
    expect(c.notifications).toBe(false);
    expect(c.agents.tools).toMatchObject({ files: true, trackerMcp: true, vcsCli: true, trackerMcpServer: 'tracker-issues' });
    expect(validateConfig(c).ok).toBe(true);
  });

  it('without a legacy profile a v1 file keeps its settings over the neutral defaults and the setup assistant runs', () => {
    const r = migrateConfig({ ...V1_SETTINGS, schedule: { ...V1_SETTINGS.schedule, preDaily: '10:15' }, notifications: false }, { legacyInstall: true });
    const c = r.config;
    expect(c.setupComplete).toBe(false);
    expect(c.schedule.preDaily).toBe('10:15');
    expect(c.notifications).toBe(false);
    expect(c.vcs).toEqual([]);
    expect(c.llm.providers.map((p) => p.id)).toEqual(neutralConfig().llm.providers.map((p) => p.id));
    expect(c.llm.roles).toEqual(neutralConfig().llm.roles);
    expect(c.externalTools).toEqual(neutralConfig().externalTools);
    expect(validateConfig(c).ok).toBe(true);
  });

  it('a workspace with no config file on an existing install is neutral without a profile', () => {
    const r = migrateConfig(undefined, { legacyInstall: true });
    expect(r.config).toEqual(neutralConfig());
    expect(r.config.setupComplete).toBe(false);
  });

  it('marks the previous OpenRouter route as the legacy custom endpoint of the Claude SDK engine', () => {
    const [p] = migrateConfig(V1_SETTINGS, { legacyInstall: true, profile: exampleProfile() }).config.llm.providers;
    expect(p).toMatchObject({ id: 'openrouter', kind: 'anthropic', engine: 'claude-sdk', baseUrl: 'https://openrouter.ai/api', secretRef: 'llm.openrouter', legacyCustomEndpoint: true });
    expect(migrateConfig(V1_SETTINGS, { legacyInstall: true, profile: exampleProfile() }).config.claudeSdk).toEqual({ installed: true, version: null, path: null });
  });

  it('rebuilds a missing file on an existing install from the profile, and from the neutral defaults on a fresh one', () => {
    const legacy = migrateConfig(undefined, { legacyInstall: true, profile: exampleProfile() });
    expect(legacy.config.vcs[0].host).toBe('git.acme.test');
    expect(legacy.config.setupComplete).toBe(true);
    const fresh = migrateConfig(undefined, { legacyInstall: false });
    expect(fresh.config).toEqual(neutralConfig());
    expect(fresh.config.setupComplete).toBe(false);
    expect(fresh.changed).toBe(false);
  });

  it('resets a field that fails validation instead of locking the workspace out', () => {
    const r = migrateConfig({ ...V1_SETTINGS, schedule: { ...V1_SETTINGS.schedule, preDaily: '99:99' }, notifications: 'sim' }, { legacyInstall: true, profile: exampleProfile() });
    expect(r.config.schedule.preDaily).toBe('09:40');
    expect(r.config.notifications).toBe(true);
    expect(r.notes.some((n) => n.startsWith('reset schedule.preDaily'))).toBe(true);
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('a schema 2 file gets the priority section and the two card fields the agents read, keeping what the person chose', () => {
    const v2 = { ...neutralConfig(), schemaVersion: 2 } as Record<string, any>;
    delete v2.devCycle.priority;
    v2.devCycle.enrichment.cardFields = ['ref', 'title', 'blockers'];
    const r = migrateConfig(v2, { legacyInstall: false });
    expect(r.fromVersion).toBe(2);
    expect(r.changed).toBe(true);
    expect(r.config.schemaVersion).toBe(8);
    expect(r.config.devCycle.priority).toEqual({ labels: [] });
    expect(r.config.devCycle.enrichment.cardFields).toEqual(['ref', 'title', 'blockers', 'priority', 'milestone']);
    expect(r.notes.join(' ')).toContain('priority, milestone');
    expect(validateConfig(r.config).ok).toBe(true);
  });

  it('keeps a priority list already written, does not repeat a field, and leaves a file with no cycle to the defaults', () => {
    const v2 = { ...neutralConfig(), schemaVersion: 2 } as Record<string, any>;
    v2.devCycle.priority = { labels: ['^P0$', '^P1$'] };
    v2.devCycle.enrichment.cardFields = ['ref', 'milestone'];
    const r = migrateConfig(v2, { legacyInstall: false });
    expect(r.config.devCycle.priority.labels).toEqual(['^P0$', '^P1$']);
    expect(r.config.devCycle.enrichment.cardFields).toEqual(['ref', 'milestone', 'priority']);
    const bare = migrateConfig({ schemaVersion: 2, language: 'en' }, { legacyInstall: false });
    expect(bare.config.language).toBe('en');
    expect(bare.config.devCycle.priority).toEqual({ labels: [] });
    expect(bare.config.devCycle.enrichment.cardFields).toEqual(neutralConfig().devCycle.enrichment.cardFields);
  });

  it('a v1 file ends at the current schema with the new fields in place', () => {
    const r = migrateConfig(V1_SETTINGS, { legacyInstall: true, profile: exampleProfile() });
    expect(r.config.schemaVersion).toBe(8);
    expect(r.config.devCycle.priority).toEqual({ labels: [] });
    expect(r.config.devCycle.enrichment.cardFields).toEqual(expect.arrayContaining(['priority', 'milestone']));
  });

  describe('schema 7 to 8: the stage timeout becomes an idle limit and a cap', () => {
    const v7 = (runner: Record<string, unknown> | undefined): Record<string, any> => {
      const c = { ...neutralConfig(), schemaVersion: 7 } as Record<string, any>;
      if (runner === undefined) delete c.runner;
      else c.runner = { ...c.runner, ...runner };
      delete c.runner?.stageIdleMs;
      delete c.runner?.stageMaxMs;
      return c;
    };

    it('turns the old default into the two new defaults and drops the old field', () => {
      const r = migrateConfig(v7({ stageTimeoutMs: 1_800_000 }), { legacyInstall: false });
      expect(r.fromVersion).toBe(7);
      expect(r.changed).toBe(true);
      expect(r.config.schemaVersion).toBe(8);
      expect(r.config.runner).toMatchObject({ stageIdleMs: 600_000, stageMaxMs: 7_200_000 });
      expect(r.config.runner).not.toHaveProperty('stageTimeoutMs');
      expect(r.notes.join(' ')).toContain('became two limits');
      expect(validateConfig(r.config).ok).toBe(true);
    });

    it('keeps a limit the person set as the cap on a stage, and as the idle limit too when it is shorter than the default one', () => {
      const long = migrateConfig(v7({ stageTimeoutMs: 45 * 60_000 }), { legacyInstall: false });
      expect(long.config.runner).toMatchObject({ stageIdleMs: 600_000, stageMaxMs: 2_700_000 });
      expect(long.notes.join(' ')).toContain('is now runner.stageMaxMs');
      const short = migrateConfig(v7({ stageTimeoutMs: 5 * 60_000 }), { legacyInstall: false });
      expect(short.config.runner).toMatchObject({ stageIdleMs: 300_000, stageMaxMs: 300_000 });
      expect(validateConfig(short.config).ok).toBe(true);
    });

    it('touches nothing else, and a file with no runner section gets the defaults', () => {
      const r = migrateConfig(v7({ stageTimeoutMs: 1_800_000, enabled: true, triggerLabel: 'agents', maxConcurrentRuns: 3 }), { legacyInstall: false });
      expect(r.config.runner).toMatchObject({ enabled: true, triggerLabel: 'agents', maxConcurrentRuns: 3 });
      const bare = migrateConfig(v7(undefined), { legacyInstall: false });
      expect(bare.config.runner).toEqual(neutralConfig().runner);
    });
  });

  it('leaves a current document alone and refuses a newer one', () => {
    const c = neutralConfig();
    c.language = 'en';
    const r = migrateConfig(c, { legacyInstall: true });
    expect(r.changed).toBe(false);
    expect(r.config.language).toBe('en');
    expect(() => migrateConfig({ schemaVersion: 9 }, { legacyInstall: false })).toThrow(/newer app/);
  });
});

describe('startup on the real current layout', () => {
  it('flat data dir: becomes the "Testes" workspace with a current config that has the profile and the old settings; the v1 file is kept', () => {
    flatLayout();
    const { resolved, existing, boot } = startUp();
    expect(existing).toBe(true);
    expect(resolved.registry.current).toBe('testes');
    expect(boot.migrated).toEqual(['testes']);
    const dir = workspaceDir(root, 'testes');
    const config = readConfigFile(dir) as Record<string, unknown>;
    expect(config.schemaVersion).toBe(8);
    expect(validateConfig(config).ok).toBe(true);
    const v = validateConfig(config).config;
    expect(v?.vcs[0].host).toBe('git.acme.test');
    expect(v?.projects.issues).toMatchObject({ project: 'acme/web', projectId: 1, refPrefix: 'web#' });
    expect(v?.devCycle.qa.user).toBe('qa.acme');
    expect(v?.llm.roles.deep.model).toBe('deepseek/deepseek-v4-pro-0813');
    expect(JSON.parse(readFileSync(join(dir, V1_BACKUP_FILE), 'utf8')).models.turn).toBe('deepseek/deepseek-v4.1-flash');
    expect(JSON.parse(readFileSync(join(root, 'web.json'), 'utf8')).publicUrl).toBe(exampleProfile().web?.publicUrl);
    expect(existsSync(join(root, MARKER_FILE))).toBe(true);
  });

  it('a second start changes nothing', () => {
    flatLayout();
    startUp();
    const file = join(workspaceDir(root, 'testes'), 'config.json');
    const before = readFileSync(file, 'utf8');
    const second = startUp();
    expect(second.existing).toBe(false);
    expect(second.boot.migrated).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('every workspace of an existing install is migrated, including one that never had a config file ("Acme - Sustentação" created without copying settings)', () => {
    flatLayout();
    // The registry the previous version would have left: two workspaces, the second one with data but no config.json.
    mkdirSync(join(root, 'workspaces/acme-support/historico'), { recursive: true });
    writeFileSync(join(root, 'workspaces/acme-support/historico/2026-10-01T090000.json'), '{"version":1}');
    ensureWorkspaces(root, quiet);
    // Simulate the previous app: the registry exists, the second workspace is listed, and no config marker yet.
    const reg = JSON.parse(readFileSync(join(root, 'workspaces.json'), 'utf8'));
    reg.list.push({ id: 'acme-support', name: 'Acme - Sustentação', createdAt: '2026-09-20T00:00:00Z', test: false });
    writeFileSync(join(root, 'workspaces.json'), JSON.stringify(reg));
    const existing = detectExistingInstall(root);
    expect(existing).toBe(true);
    const boot = bootstrapConfigs({ root, existingInstall: existing, profile: exampleProfile(), ...quiet });
    expect(boot.migrated.sort()).toEqual(['acme-support', 'testes']);
    const second = validateConfig(readConfigFile(workspaceDir(root, 'acme-support'))).config;
    expect(second?.vcs[0].host).toBe('git.acme.test');
    expect(second?.setupComplete).toBe(true);
    expect(existsSync(join(workspaceDir(root, 'acme-support'), V1_BACKUP_FILE))).toBe(false);
  });

  it('a workspace created after the update gets the neutral defaults and setupComplete false', () => {
    flatLayout();
    startUp();
    createWorkspace(root, { name: 'Open source', copySettings: false }, quiet);
    const second = startUp();
    expect(second.boot.migrated).toEqual(['open-source']);
    const c = validateConfig(readConfigFile(workspaceDir(root, 'open-source'))).config;
    expect(c).toEqual(neutralConfig());
    expect(c?.setupComplete).toBe(false);
  });

  it('a workspace created with copied settings carries the whole v2 config', () => {
    flatLayout();
    startUp();
    createWorkspace(root, { name: 'Copia', copySettings: true }, quiet);
    const copied = validateConfig(readConfigFile(workspaceDir(root, 'copia'))).config;
    expect(copied?.vcs[0].host).toBe('git.acme.test');
  });

  it('empty data dir: a fresh install, neutral config, setupComplete false, no company values anywhere', () => {
    const { resolved, existing, boot } = startUp();
    expect(existing).toBe(false);
    expect(resolved.registry.current).toBe('principal');
    expect(boot.marker.existingInstall).toBe(false);
    const c = validateConfig(readConfigFile(workspaceDir(root, 'principal'))).config;
    expect(c).toEqual(neutralConfig());
    expect(c?.setupComplete).toBe(false);
    expect(existsSync(join(root, 'web.json'))).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/acme|playbook|qa\.acme|openrouter|cardtool|claude-alt|gnome-terminal|\/\.local\/bin/);
  });

  it('keeps the test flag the old registry had', () => {
    flatLayout();
    startUp();
    setTestFlag(root, 'testes', false);
    startUp();
    expect(JSON.parse(readFileSync(join(root, 'workspaces.json'), 'utf8')).list[0].test).toBe(false);
  });
});
