import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readArtifact } from '../src/main/runner/cycleFolder';

// The run screen reads the documents of a run's cycle folder, from the window and from a paired browser: only those, and only inside the folder.

function worktree() {
  const wt = mkdtempSync(join(tmpdir(), 'coxia-artifact-'));
  const folder = 'docs/cycles/101-add-the-thing';
  mkdirSync(join(wt, folder), { recursive: true });
  writeFileSync(join(wt, folder, '1_SPEC.md'), '# Spec\n\nWhat is asked.\n');
  return { wt, folder };
}

describe('reading a document of the cycle folder', () => {
  it('returns the text of a document the folder holds', () => {
    const { wt, folder } = worktree();
    expect(readArtifact(wt, folder, '1_SPEC.md')).toEqual({ text: '# Spec\n\nWhat is asked.\n', clipped: false });
  });

  it('masks what looks like a credential, as everything shown from a run is', () => {
    const { wt, folder } = worktree();
    writeFileSync(join(wt, folder, '2_PLAN.md'), 'Use the header Authorization: Bearer abcdefghijklmnop.qrstuvwxyz.0123456789 for the call.\n');
    const doc = readArtifact(wt, folder, '2_PLAN.md');
    expect(doc?.text).not.toContain('abcdefghijklmnop.qrstuvwxyz.0123456789');
  });

  it('cuts a very long document and says so', () => {
    const { wt, folder } = worktree();
    writeFileSync(join(wt, folder, '3_BIG.md'), 'x'.repeat(250_000));
    const doc = readArtifact(wt, folder, '3_BIG.md');
    expect(doc?.clipped).toBe(true);
    expect(doc?.text.length).toBeLessThanOrEqual(200_000);
  });

  it('is null for a document that is not there, and for a name that is not a document name', () => {
    const { wt, folder } = worktree();
    expect(readArtifact(wt, folder, 'nope.md')).toBeNull();
    for (const name of ['../1_SPEC.md', '../../etc/passwd', 'a/b.md', '.hidden', '', '/etc/passwd', 'x\0y']) expect(readArtifact(wt, folder, name), name).toBeNull();
    expect(readArtifact(join(wt, 'gone'), folder, '1_SPEC.md')).toBeNull();
  });

  it('does not follow a link that leads out of the worktree', () => {
    const { wt, folder } = worktree();
    const outside = mkdtempSync(join(tmpdir(), 'coxia-outside-'));
    writeFileSync(join(outside, 'secret.md'), 'not for the screen');
    symlinkSync(join(outside, 'secret.md'), join(wt, folder, '9_LINK.md'));
    expect(readArtifact(wt, folder, '9_LINK.md')).toBeNull();
  });

  it('does not read a folder as a document', () => {
    const { wt, folder } = worktree();
    mkdirSync(join(wt, folder, 'sub.d'));
    expect(readArtifact(wt, folder, 'sub.d')).toBeNull();
  });
});
