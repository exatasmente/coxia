import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const text = (f: string): string => readFileSync(join(ROOT, f), 'utf8');
const hasJq = spawnSync('jq', ['--version']).status === 0;

// The draft of a pre-release is created by electron-builder as "untagged-<hash>": GitHub links the tag only when it is published, so the
// lookups of release.yml go by the release's name.
const RELEASES = [
  { id: 41, draft: true, prerelease: true, name: 'v0.6.0-beta.1', tag_name: 'untagged-3f2a9c' },
  { id: 40, draft: false, prerelease: true, name: 'v0.6.0-beta.1', tag_name: 'v0.6.0-beta.1' },
  { id: 39, draft: true, prerelease: false, name: 'v0.5.0', tag_name: 'untagged-77b0de' },
  { id: 38, draft: true, prerelease: true, name: 'a title that is not a version', tag_name: 'v0.6.0-beta.1' },
];

describe('release.yml finds the draft of a pre-release', () => {
  const programs = [...text('.github/workflows/release.yml').matchAll(/--jq '(\.\[\] \| select\(\.draft[^']*)'/g)].map((m) => m[1]);

  it('looks it up in both steps by name or tag, and not by an interpolated tag', () => {
    expect(programs).toHaveLength(2);
    expect(programs[0]).toBe(programs[1]);
    expect(text('.github/workflows/release.yml')).not.toMatch(/select\(\.draft and \.tag_name == /);
  });

  it.skipIf(!hasJq)('picks the untagged draft named after the version, and a draft whose tag is linked, but not a published release or another version', () => {
    const out = spawnSync('jq', ['-r', programs[0]], { input: JSON.stringify(RELEASES), env: { PATH: process.env.PATH, TAG: 'v0.6.0-beta.1' }, encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['41', '38']);
    const none = spawnSync('jq', ['-r', programs[0]], { input: JSON.stringify(RELEASES), env: { PATH: process.env.PATH, TAG: 'v0.7.0' }, encoding: 'utf8' });
    expect(none.stdout.trim()).toBe('');
  });

  it('asserts the feed of the channel, and no feed of another', () => {
    const yml = text('.github/workflows/release.yml');
    expect(yml).toContain('feed="$CHANNEL-linux.yml"');
    expect(yml).toContain("grep -E -- '-linux\\.yml$' | grep -vxF \"$feed\"");
  });
});

describe('ci.yml', () => {
  it('runs for pushes and pull requests to main and to the release branches', () => {
    const yml = text('.github/workflows/ci.yml');
    expect(yml).toMatch(/push:\n\s+branches: \[main, 'release\/\*\*'\]/);
    expect(yml).toMatch(/pull_request:\n\s+branches: \[main, 'release\/\*\*'\]/);
  });
});

describe('verify-release-files.sh: the feed of a pre-release', () => {
  const build = (version: string, feeds: string[]): { dir: string; run: () => { code: number; err: string; out: string } } => {
    const dir = mkdtempSync(join(tmpdir(), 'coxia-verify-'));
    const appimage = Buffer.from(`image of ${version}`);
    writeFileSync(join(dir, `coxia-${version}.AppImage`), appimage);
    writeFileSync(join(dir, `coxia_${version}_amd64.deb`), 'deb');
    const feed = `version: ${version}\nfiles:\n  - url: coxia-${version}.AppImage\npath: coxia-${version}.AppImage\nsha512: ${createHash('sha512').update(appimage).digest('base64')}\n`;
    for (const f of feeds) writeFileSync(join(dir, f), feed);
    return {
      dir,
      run: () => {
        const r = spawnSync('bash', [join(ROOT, 'scripts', 'verify-release-files.sh'), version, dir], { encoding: 'utf8' });
        return { code: r.status ?? -1, err: r.stderr, out: r.stdout };
      },
    };
  };

  it('accepts a beta that publishes beta-linux.yml alone', () => {
    const w = build('0.6.0-beta.1', ['beta-linux.yml']);
    try {
      const r = w.run();
      expect(r.code).toBe(0);
      expect(r.out).toContain('beta-linux.yml');
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });

  it('refuses a beta that also produced latest-linux.yml, and a beta without its own feed', () => {
    const both = build('0.6.0-beta.1', ['beta-linux.yml', 'latest-linux.yml']);
    const wrong = build('0.6.0-beta.1', ['latest-linux.yml']);
    try {
      expect(both.run().err).toContain('must not produce latest-linux.yml');
      expect(wrong.run().err).toContain('missing beta-linux.yml');
    } finally {
      rmSync(both.dir, { recursive: true, force: true });
      rmSync(wrong.dir, { recursive: true, force: true });
    }
  });

  it('wants latest-linux.yml for a final version', () => {
    const w = build('0.6.0', ['latest-linux.yml']);
    try {
      expect(w.run().code).toBe(0);
    } finally {
      rmSync(w.dir, { recursive: true, force: true });
    }
  });
});
