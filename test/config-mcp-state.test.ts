// The migration that adds the state server opt-in: a schema-23 document migrates to enabled: false and keeps every other section; a document
// that already carries mcpState keeps it; the version a newer app wrote is refused.
import { describe, expect, it } from 'vitest';
import { migrateConfig } from '../src/shared/config/migrations';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';

const doc23 = { schemaVersion: 23, language: 'en', userName: 'Terminal', retention: { enabled: false, days: 30 } };
const ctx = { legacyInstall: false };

describe('the opt-in arrives off, and nothing else of the config moves', () => {
  it('adds mcpState enabled: false and keeps the other sections', () => {
    const r = migrateConfig(doc23, ctx);
    expect(r.config.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(r.config.mcpState).toEqual({ enabled: false });
    expect(r.config.language).toBe('en');
    expect(r.config.userName).toBe('Terminal');
    expect(r.config.retention).toEqual({ enabled: false, days: 30 });
  });

  it('keeps a choice the person already made (a later build carried it in)', () => {
    const r = migrateConfig({ ...doc23, mcpState: { enabled: true } }, ctx);
    expect(r.config.mcpState).toEqual({ enabled: true });
  });

  it('a document a newer app wrote is refused, never repaired', () => {
    expect(() => migrateConfig({ ...doc23, schemaVersion: 99 }, ctx)).toThrow(/newer app/);
  });

  it('a fresh workspace reads the neutral default (off)', () => {
    expect(migrateConfig(undefined, ctx).config.mcpState).toEqual({ enabled: false });
  });
});
