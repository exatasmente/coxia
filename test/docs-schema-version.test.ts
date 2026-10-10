import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA_VERSION } from '../src/shared/config/types';

// The two opening lines of the configuration guide name the current schema; a new step of the chain must move them too.
describe('docs/configuration.md', () => {
  const doc = readFileSync(join(import.meta.dirname, '../docs/configuration.md'), 'utf8');

  it('names the current schema version in both languages', () => {
    expect(doc).toContain(`versão do esquema ${CONFIG_SCHEMA_VERSION})`);
    expect(doc).toContain(`schema version ${CONFIG_SCHEMA_VERSION})`);
  });
});
