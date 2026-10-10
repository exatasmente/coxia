import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveOutputPath } from '../src/main/evidence/paths';

// The output folder of a stage is the one its session declares: `<stageDir>/out` for a sandbox (`/coxia/out` is how it is named inside), the folder the
// session made on the host. A path that is not in it, walks with `..` or passes through a link is refused, never followed.

let stageDir: string;
let hostOut: string;
let outside: string;

beforeAll(() => {
  stageDir = mkdtempSync(join(tmpdir(), 'evidence-stage-'));
  hostOut = mkdtempSync(join(tmpdir(), 'evidence-host-out-'));
  outside = mkdtempSync(join(tmpdir(), 'evidence-outside-'));
  mkdirSync(join(stageDir, 'out', 'shots'), { recursive: true });
  writeFileSync(join(stageDir, 'out', 'shot.png'), 'x');
  writeFileSync(join(stageDir, 'out', 'shots', 'page.png'), 'x');
  writeFileSync(join(outside, 'secret.txt'), 'x');
  symlinkSync(join(outside, 'secret.txt'), join(stageDir, 'out', 'link.txt'));
});

/** The folder the sandbox declares for a stage. */
const outOf = (dir: string): string => join(dir, 'out');

describe('a path of the stage output folder', () => {
  it('resolves the path as the sandbox names it, and as a relative one', () => {
    expect(resolveOutputPath(outOf(stageDir), '/coxia/out/shot.png')).toMatchObject({ ok: true, rel: 'shot.png' });
    expect(resolveOutputPath(outOf(stageDir), 'shot.png')).toMatchObject({ ok: true, rel: 'shot.png' });
    expect(resolveOutputPath(outOf(stageDir), 'shots/page.png')).toMatchObject({ ok: true, rel: 'shots/page.png' });
    expect(resolveOutputPath(outOf(stageDir), join(stageDir, 'out', 'shot.png'))).toMatchObject({ ok: true, rel: 'shot.png' });
  });

  it('refuses a path outside the output folder', () => {
    expect(resolveOutputPath(outOf(stageDir), '/coxia/ctl/supervisor.sh').ok).toBe(false);
    expect(resolveOutputPath(outOf(stageDir), '/etc/passwd')).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(outOf(stageDir), join(outside, 'secret.txt'))).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(outOf(stageDir), '~/notes.txt')).toMatchObject({ ok: false, problem: 'outside' });
  });

  it('refuses a path that walks out with ..', () => {
    expect(resolveOutputPath(outOf(stageDir), '../secret.txt')).toMatchObject({ ok: false, problem: 'traversal' });
    expect(resolveOutputPath(outOf(stageDir), '/coxia/out/../../secret.txt')).toMatchObject({ ok: false, problem: 'traversal' });
  });

  it('refuses a path that passes through a link, and never follows it', () => {
    expect(resolveOutputPath(outOf(stageDir), 'link.txt')).toMatchObject({ ok: false, problem: 'link' });
    expect(resolveOutputPath(outOf(stageDir), '/coxia/out/link.txt')).toMatchObject({ ok: false, problem: 'link' });
  });

  it('refuses a common file that ends behind a link of a dependency inside the folder', () => {
    // The clone's dependency links live inside the output folder on the host, and the sandbox mounts it as it is: a `node_modules` link with a common file
    // behind it walks through no link in the written path and still leaves the folder.
    mkdirSync(join(stageDir, 'deps'), { recursive: true });
    writeFileSync(join(stageDir, 'deps', 'x.txt'), 'x');
    symlinkSync(join(stageDir, 'deps'), join(stageDir, 'out', 'node_modules'));
    expect(resolveOutputPath(outOf(stageDir), 'node_modules/x.txt')).toMatchObject({ ok: false, problem: 'link' });
    expect(resolveOutputPath(outOf(stageDir), '/coxia/out/node_modules/x.txt')).toMatchObject({ ok: false, problem: 'link' });
  });

  it('says when the file is not there, or is not a file', () => {
    expect(resolveOutputPath(outOf(stageDir), 'nope.png')).toMatchObject({ ok: false, problem: 'missing' });
    expect(resolveOutputPath(outOf(stageDir), 'shots')).toMatchObject({ ok: false, problem: 'not-file' });
    expect(resolveOutputPath(outOf(stageDir), '')).toMatchObject({ ok: false, problem: 'path' });
    expect(resolveOutputPath(outOf(stageDir), null)).toMatchObject({ ok: false, problem: 'path' });
  });
});

// A stage whose commands run on this computer declares its own output folder: the same rules hold against a root that is not `<stageDir>/out`.
describe('a path of the output folder a host session declared', () => {
  beforeAll(() => {
    writeFileSync(join(hostOut, 'shot.png'), 'x');
    symlinkSync(join(outside, 'secret.txt'), join(hostOut, 'link.txt'));
  });

  it('accepts a relative path and the real path under that folder, as the sandbox does with its own', () => {
    expect(resolveOutputPath(hostOut, 'shot.png')).toMatchObject({ ok: true, rel: 'shot.png' });
    expect(resolveOutputPath(hostOut, join(hostOut, 'shot.png'))).toMatchObject({ ok: true, rel: 'shot.png' });
  });

  it('refuses a path outside that folder, a walk with .. and a link, with the same problems', () => {
    expect(resolveOutputPath(hostOut, join(outside, 'secret.txt'))).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(hostOut, '/etc/passwd')).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(hostOut, '../secret.txt')).toMatchObject({ ok: false, problem: 'traversal' });
    expect(resolveOutputPath(hostOut, 'link.txt')).toMatchObject({ ok: false, problem: 'link' });
  });
});
