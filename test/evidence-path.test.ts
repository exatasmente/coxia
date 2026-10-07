import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveOutputPath } from '../src/main/evidence/paths';

// The output folder of a stage is `<stageDir>/out` on this computer; `/coxia/out` is how it is named inside the sandbox. A path that is not in it, walks with
// `..` or passes through a link is refused, never followed.

let stageDir: string;
let outside: string;

beforeAll(() => {
  stageDir = mkdtempSync(join(tmpdir(), 'evidence-stage-'));
  outside = mkdtempSync(join(tmpdir(), 'evidence-outside-'));
  mkdirSync(join(stageDir, 'out', 'shots'), { recursive: true });
  writeFileSync(join(stageDir, 'out', 'shot.png'), 'x');
  writeFileSync(join(stageDir, 'out', 'shots', 'page.png'), 'x');
  writeFileSync(join(outside, 'secret.txt'), 'x');
  symlinkSync(join(outside, 'secret.txt'), join(stageDir, 'out', 'link.txt'));
});

describe('a path of the stage output folder', () => {
  it('resolves the path as the sandbox names it, and as a relative one', () => {
    expect(resolveOutputPath(stageDir, '/coxia/out/shot.png')).toMatchObject({ ok: true, rel: 'shot.png' });
    expect(resolveOutputPath(stageDir, 'shot.png')).toMatchObject({ ok: true, rel: 'shot.png' });
    expect(resolveOutputPath(stageDir, 'shots/page.png')).toMatchObject({ ok: true, rel: 'shots/page.png' });
    expect(resolveOutputPath(stageDir, join(stageDir, 'out', 'shot.png'))).toMatchObject({ ok: true, rel: 'shot.png' });
  });

  it('refuses a path outside the output folder', () => {
    expect(resolveOutputPath(stageDir, '/coxia/ctl/supervisor.sh').ok).toBe(false);
    expect(resolveOutputPath(stageDir, '/etc/passwd')).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(stageDir, join(outside, 'secret.txt'))).toMatchObject({ ok: false, problem: 'outside' });
    expect(resolveOutputPath(stageDir, '~/notes.txt')).toMatchObject({ ok: false, problem: 'outside' });
  });

  it('refuses a path that walks out with ..', () => {
    expect(resolveOutputPath(stageDir, '../secret.txt')).toMatchObject({ ok: false, problem: 'traversal' });
    expect(resolveOutputPath(stageDir, '/coxia/out/../../secret.txt')).toMatchObject({ ok: false, problem: 'traversal' });
  });

  it('refuses a path that passes through a link, and never follows it', () => {
    expect(resolveOutputPath(stageDir, 'link.txt')).toMatchObject({ ok: false, problem: 'link' });
    expect(resolveOutputPath(stageDir, '/coxia/out/link.txt')).toMatchObject({ ok: false, problem: 'link' });
  });

  it('says when the file is not there, or is not a file', () => {
    expect(resolveOutputPath(stageDir, 'nope.png')).toMatchObject({ ok: false, problem: 'missing' });
    expect(resolveOutputPath(stageDir, 'shots')).toMatchObject({ ok: false, problem: 'not-file' });
    expect(resolveOutputPath(stageDir, '')).toMatchObject({ ok: false, problem: 'path' });
    expect(resolveOutputPath(stageDir, null)).toMatchObject({ ok: false, problem: 'path' });
  });
});
