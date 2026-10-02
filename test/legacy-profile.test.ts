import { describe, expect, it } from 'vitest';
import { parseLegacyProfile } from '../src/shared/config/legacy';
import { LEGACY_PROFILE_ENV, loadLegacyProfile } from '../src/main/legacy-profile';
import { mergeDeep, neutralConfig } from '../src/shared/config/defaults';
import { validateConfig } from '../src/shared/config/validate';
import { EXAMPLE_PROFILE_FILE, exampleProfile } from './helpers/config';

describe('parseLegacyProfile', () => {
  it('reads the example profile: a config patch, web settings, secret seeds and the models of the old settings', () => {
    const p = exampleProfile();
    expect(p.config.userName).toBe('Bruno');
    expect(p.web).toMatchObject({ host: '127.0.0.1', port: 4330 });
    expect(p.secrets).toEqual([{ ref: 'llm.openrouter', command: '~/.local/bin/llm-key', args: [] }]);
    expect(p.migratedModels).toEqual({ provider: 'openrouter', defaultModel: 'deepseek/deepseek-v4.1-flash' });
  });

  it('merged over the neutral defaults it is a valid config', () => {
    expect(validateConfig(mergeDeep(neutralConfig(), exampleProfile().config)).errors).toEqual([]);
  });

  it('refuses what is not a profile', () => {
    expect(parseLegacyProfile(null)).toBeNull();
    expect(parseLegacyProfile([])).toBeNull();
    expect(parseLegacyProfile({ config: 'x' })).toBeNull();
    expect(parseLegacyProfile({ config: {}, secrets: [{ ref: '', command: 'x' }, { ref: 'a' }, { ref: 'b', command: 'c', args: ['d', 4] }] })?.secrets).toEqual([{ ref: 'b', command: 'c', args: ['d'] }]);
  });
});

describe('loadLegacyProfile', () => {
  const notes: string[] = [];
  const log = (m: string) => notes.push(m);

  it('is null without the variable', () => {
    expect(loadLegacyProfile({}, log)).toBeNull();
    expect(loadLegacyProfile({ [LEGACY_PROFILE_ENV]: '  ' }, log)).toBeNull();
  });

  it('reads the file the variable names, with "~/" expanded', () => {
    const files: string[] = [];
    const p = loadLegacyProfile({ [LEGACY_PROFILE_ENV]: '~/private/profile.json' }, log, (f) => (files.push(f), '{"config":{"userName":"Ana"}}'), '/home/ana');
    expect(files).toEqual(['/home/ana/private/profile.json']);
    expect(p?.config.userName).toBe('Ana');
    expect(loadLegacyProfile({ [LEGACY_PROFILE_ENV]: EXAMPLE_PROFILE_FILE }, log)?.config.userName).toBe('Bruno');
  });

  it('says why a missing, broken or foreign file is ignored, and never throws', () => {
    notes.length = 0;
    expect(loadLegacyProfile({ [LEGACY_PROFILE_ENV]: '/nope/profile.json' }, log)).toBeNull();
    expect(loadLegacyProfile({ [LEGACY_PROFILE_ENV]: '/x.json' }, log, () => '{not json')).toBeNull();
    expect(loadLegacyProfile({ [LEGACY_PROFILE_ENV]: '/x.json' }, log, () => '{"hello":1}')).toBeNull();
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.startsWith(`${LEGACY_PROFILE_ENV}:`))).toBe(true);
  });
});
