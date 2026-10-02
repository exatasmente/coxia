import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERIFY_DEFAULTS } from '../src/renderer/src/conflictVerifyDefaults';
import { validateVerify } from '../src/main/conflictVerify';

describe('verify defaults', () => {
  it('pass the settings validation', () => {
    expect(() => validateVerify(VERIFY_DEFAULTS)).not.toThrow();
  });

  it('are the commands documented in docs/verify-commands.md', () => {
    const doc = readFileSync(join(__dirname, '../docs/verify-commands.md'), 'utf8');
    for (const [project, command] of Object.entries(VERIFY_DEFAULTS)) {
      expect(doc).toContain(`## ${project}`);
      expect(doc).toContain(command);
    }
  });
});
