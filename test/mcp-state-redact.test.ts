// The mask split the answers follow (plan D10): a planted credential shape never crosses prose or board text unmasked, and a pinned version in
// board prose is not falsely masked.
import { describe, expect, it } from 'vitest';
import { redact, redactDoc } from '../src/main/errorlog-core';

const HOME = '/home/terminal-user';
const TOKEN = 'sk-or-v1-0123456789abcdef0123456789abcdef';
const HEADER = 'Authorization: Bearer bearerreading01';
const MAIL = 'agent@example.com';
const OPAQUE = 'Abcdef23ghijklmn23qrstuvwxy456789';

const masked = (text: string): boolean => !text.includes(TOKEN) && !text.includes('bearerreading01') && !text.includes(MAIL) && !text.includes(OPAQUE) && !text.includes(HOME);

describe('the mask of every prose surface (conversations, evidence, activities, runs, procedures)', () => {
  it('masks a token, a header line, an address, a long opaque string and the home folder', () => {
    const planted = `${HEADER} with ${TOKEN} for ${MAIL} of ${HOME}/notes and ${OPAQUE}`;
    expect(masked(redact(planted, HOME))).toBe(true);
  });
});

describe('the board and cycle texts (redactDoc)', () => {
  it('masks the same shapes and the home folder, and does not mask a pinned version', () => {
    const text = redactDoc(`bumping pkg@9.0.0 next to ${OPAQUE} after ${HEADER} of ${MAIL} in ${HOME}/notes`, HOME);
    expect(text).toContain('pkg@9.0.0');
    expect(masked(text)).toBe(true);
  });
});
