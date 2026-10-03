import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readArtifact, readFolder } from '../src/main/runner/cycleFolder';

// A command of a sandbox can leave a link in the worktree that points at a file of the person's: the app reads the cycle folder outside the sandbox, and must never
// follow it into a prompt or a screen.

let root: string;
let secret: string;
const FOLDER = 'docs/cycles/7-thing';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coxia-links-'));
  secret = join(mkdtempSync(join(tmpdir(), 'coxia-home-')), 'private-notes.md');
  writeFileSync(secret, 'the person\'s private notes\n');
  mkdirSync(join(root, FOLDER), { recursive: true });
  writeFileSync(join(root, FOLDER, '1_SPEC.md'), '# Spec\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the cycle folder read by the app', () => {
  it('reads regular files and skips a link, wherever it points', () => {
    symlinkSync(secret, join(root, FOLDER, '9_NOTES.md'));
    symlinkSync('1_SPEC.md', join(root, FOLDER, '8_ALIAS.md'));
    const files = readFolder(root, FOLDER);
    expect(files.map((f) => f.name)).toEqual(['1_SPEC.md']);
    expect(JSON.stringify(files)).not.toContain('private notes');
  });

  it('shows no document through a link either', () => {
    symlinkSync(secret, join(root, FOLDER, '9_NOTES.md'));
    expect(readArtifact(root, FOLDER, '9_NOTES.md')).toBeNull();
    expect(readArtifact(root, FOLDER, '1_SPEC.md')?.text).toContain('# Spec');
  });

  it('skips a file when the folder itself is a link out of the worktree', () => {
    rmSync(join(root, 'docs'), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), 'coxia-outside-'));
    mkdirSync(join(outside, 'cycles/7-thing'), { recursive: true });
    writeFileSync(join(outside, 'cycles/7-thing/1_SPEC.md'), 'not in the worktree');
    symlinkSync(outside, join(root, 'docs'));
    expect(readFolder(root, FOLDER)).toEqual([]);
  });
});
