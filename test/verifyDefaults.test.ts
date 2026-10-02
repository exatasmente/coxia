import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERIFY_SUGGESTION } from '../src/renderer/src/conflictVerifyDefaults';
import { validateVerify } from '../src/main/conflictVerify';

describe('verify suggestion', () => {
  it('passes the settings validation', () => {
    expect(() => validateVerify({ 'acme/web': VERIFY_SUGGESTION })).not.toThrow();
  });

  it('is the command documented in docs/verify-commands.md', () => {
    const doc = readFileSync(join(__dirname, '../docs/verify-commands.md'), 'utf8');
    expect(doc).toContain(VERIFY_SUGGESTION);
  });
});
