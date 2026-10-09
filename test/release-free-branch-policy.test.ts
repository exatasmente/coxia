import { describe, expect, it } from 'vitest';
import { DESKTOP_ONLY, webAccess } from '../src/main/webPolicy';

// Freeing a release branch switches another worktree's checkout on the computer: a paired browser cannot ask for it, with or without the external-effects switch.
describe('freeing a release branch', () => {
  it('is a desktop-only channel', () => {
    expect(DESKTOP_ONLY.has('actions:freeBranch')).toBe(true);
    expect(webAccess('actions:freeBranch')).toBe('deny');
  });
});
