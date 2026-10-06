import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const text = (f: string): string => readFileSync(join(ROOT, f), 'utf8');
const hasJq = spawnSync('jq', ['--version']).status === 0;

// electron-builder creates the draft with tag_name = the tag, but GitHub answered with "untagged-<hash>" (and target_commitish main) on
// v0.5.0-beta.2, so the lookups of release.yml go by the release's name, and a step sets tag_name before the draft is checked.
const BETA_ASSETS = ['coxia-0.6.0-beta.1.AppImage', 'coxia_0.6.0-beta.1_amd64.deb', 'beta-linux.yml'].map((name) => ({ name }));
const RELEASES = [
  { id: 41, draft: true, prerelease: false, name: 'v0.6.0-beta.1', tag_name: 'untagged-3f2a9c', target_commitish: 'main', assets: BETA_ASSETS },
  { id: 40, draft: false, prerelease: true, name: 'v0.6.0-beta.1', tag_name: 'v0.6.0-beta.1', target_commitish: 'main', assets: [] },
  { id: 39, draft: true, prerelease: false, name: 'v0.5.0', tag_name: 'untagged-77b0de', target_commitish: 'main', assets: [] },
  { id: 38, draft: true, prerelease: true, name: 'a title that is not a version', tag_name: 'v0.6.0-beta.1', target_commitish: 'main', assets: [] },
];

// The run: block of a step of the linux job, as the runner sees it (no ${{ }} inside, everything comes through env).
const stepScript = (name: string): string => {
  const yml = text('.github/workflows/release.yml');
  const start = yml.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const next = yml.indexOf('\n      - name: ', start + 1);
  const step = yml.slice(start, next === -1 ? undefined : next);
  const run = step.match(/\n        run: \|\n((?:          .*\n|[ \t]*\n)+)/);
  expect(run).not.toBeNull();
  expect(run![1]).not.toContain('${{');
  return run![1].split('\n').map((l) => l.slice(10)).join('\n');
};

// A gh that answers `gh api` from a JSON list of releases, applies the -f/-F fields of a PATCH to the release it names, and logs each call.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$GH_LOG"
shift
path= prog=. edits=.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --method) shift ;;
    --paginate) ;;
    --jq) prog="$2"; shift ;;
    -f) args+=(--arg "\${2%%=*}" "\${2#*=}"); edits="$edits | .\${2%%=*} = \\$\${2%%=*}"; shift ;;
    -F) args+=(--argjson "\${2%%=*}" "\${2#*=}"); edits="$edits | .\${2%%=*} = \\$\${2%%=*}"; shift ;;
    *) path="$1" ;;
  esac
  shift
done
case "$path" in
  */releases) jq -r "$prog" "$GH_RELEASES" ;;
  */releases/*) jq "\${args[@]}" ".[] | select(.id == \${path##*/}) | $edits" "$GH_RELEASES" | jq -r "$prog" ;;
esac
`;

const runStep = (name: string, releases: unknown[], env: Record<string, string>): { code: number; out: string; calls: string[] } => {
  const dir = mkdtempSync(join(tmpdir(), 'coxia-gh-'));
  try {
    writeFileSync(join(dir, 'gh'), GH_STUB);
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(join(dir, 'releases.json'), JSON.stringify(releases));
    writeFileSync(join(dir, 'calls.log'), '');
    const r = spawnSync('bash', ['-c', stepScript(name)], {
      env: { PATH: `${dir}:${process.env.PATH}`, GH_RELEASES: join(dir, 'releases.json'), GH_LOG: join(dir, 'calls.log'), REPOSITORY: 'group/project', ...env },
      encoding: 'utf8',
    });
    const calls = readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n');
    return { code: r.status ?? -1, out: r.stdout + r.stderr, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const LINK = 'Link the draft to its tag, and keep it a pre-release when the version has a suffix';
const CHECK = 'Check what the draft release holds';

describe('release.yml finds the draft of a pre-release', () => {
  const programs = [...text('.github/workflows/release.yml').matchAll(/--jq '(\.\[\] \| select\(\.draft[^']*)'/g)].map((m) => m[1]);

  it('looks it up in every step by name or tag, and not by an interpolated tag', () => {
    // The link and the check of the Linux job, and the check of the Windows job.
    expect(programs).toHaveLength(3);
    for (const p of programs) expect(p).toBe(programs[0]);
    expect(text('.github/workflows/release.yml')).not.toMatch(/select\(\.draft and \.tag_name == /);
  });

  it.skipIf(!hasJq)('picks the untagged draft named after the version, and a draft whose tag is linked, but not a published release or another version', () => {
    const out = spawnSync('jq', ['-r', programs[0]], { input: JSON.stringify(RELEASES), env: { PATH: process.env.PATH, TAG: 'v0.6.0-beta.1' }, encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual(['41', '38']);
    const none = spawnSync('jq', ['-r', programs[0]], { input: JSON.stringify(RELEASES), env: { PATH: process.env.PATH, TAG: 'v0.7.0' }, encoding: 'utf8' });
    expect(none.stdout.trim()).toBe('');
  });

  it('checks, over a full checkout, that the tag commit is on its branch before building anything', () => {
    const yml = text('.github/workflows/release.yml');
    expect(yml).toMatch(/fetch-depth: 0/);
    expect(yml).toContain('scripts/verify-release-origin.sh "$VERSION" "$GITHUB_SHA"');
    expect(yml.indexOf('verify-release-origin.sh')).toBeLessThan(yml.indexOf('linux:\n    name: Linux'));
  });

  it('asserts the feed of the channel, and no feed of another', () => {
    const yml = text('.github/workflows/release.yml');
    expect(yml).toContain('feed="$CHANNEL-linux.yml"');
    expect(yml).toContain("grep -E -- '-linux\\.yml$' | grep -vxF \"$feed\"");
  });
});

describe('release.yml links the draft to its tag', () => {
  it('runs the link for every real release, a stable included, and before the draft is checked', () => {
    const yml = text('.github/workflows/release.yml');
    const link = yml.indexOf(`      - name: ${LINK}\n`);
    expect(yml.slice(link).split('\n')[1]).toBe("        if: needs.prepare.outputs.dry_run != 'true'");
    expect(link).toBeLessThan(yml.indexOf(`      - name: ${CHECK}\n`));
  });

  it.skipIf(!hasJq)('sets tag_name to the tag on the untagged draft of a beta, and keeps it a pre-release', () => {
    const r = runStep(LINK, RELEASES, { TAG: 'v0.6.0-beta.1', PRERELEASE: 'true' });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toBe('api --method PATCH repos/group/project/releases/41 -f tag_name=v0.6.0-beta.1 -F prerelease=true --jq "tag_name=\\(.tag_name) draft=\\(.draft) prerelease=\\(.prerelease)"');
    expect(r.out).toContain('tag_name=v0.6.0-beta.1 draft=true prerelease=true');
  });

  it.skipIf(!hasJq)('sets tag_name on the draft of a stable too, and leaves it a full release', () => {
    const r = runStep(LINK, RELEASES, { TAG: 'v0.5.0', PRERELEASE: 'false' });
    expect(r.code).toBe(0);
    expect(r.calls[1]).toContain('PATCH repos/group/project/releases/39 -f tag_name=v0.5.0 -F prerelease=false');
    expect(r.out).toContain('tag_name=v0.5.0 draft=true prerelease=false');
  });

  it.skipIf(!hasJq)('fails when there is no draft to link', () => {
    const r = runStep(LINK, RELEASES, { TAG: 'v0.7.0', PRERELEASE: 'false' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('::error::no draft release for v0.7.0');
    expect(r.calls.some((c) => c.includes('PATCH'))).toBe(false);
  });

  it.skipIf(!hasJq)('refuses a draft still untagged: publishing it would create a tag named untagged-<hash>', () => {
    const r = runStep(CHECK, RELEASES, { TAG: 'v0.6.0-beta.1', VERSION: '0.6.0-beta.1', CHANNEL: 'beta' });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('::error::the draft release is linked to the tag untagged-3f2a9c, not v0.6.0-beta.1');
  });

  it.skipIf(!hasJq)('accepts the draft once its tag_name is the tag and it holds its files', () => {
    const linked = RELEASES.map((r) => (r.id === 41 ? { ...r, tag_name: 'v0.6.0-beta.1' } : r));
    const r = runStep(CHECK, linked, { TAG: 'v0.6.0-beta.1', VERSION: '0.6.0-beta.1', CHANNEL: 'beta' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('beta-linux.yml');
  });
});

const WINDOWS_CHECK = 'Check the Windows files in the draft release';
const WINDOWS_BETA = ['coxia-setup-0.6.0-beta.1.exe', 'coxia-setup-0.6.0-beta.1.exe.blockmap', 'beta.yml'].map((name) => ({ name }));
// The beta's draft once the Linux job linked it, with no leftover draft of the same version around.
const linkedBeta = (assets: { name: string }[]): unknown[] => [{ ...RELEASES[0], tag_name: 'v0.6.0-beta.1', assets: [...BETA_ASSETS, ...assets] }, RELEASES[1], RELEASES[2]];
const BETA_ENV = { TAG: 'v0.6.0-beta.1', VERSION: '0.6.0-beta.1', CHANNEL: 'beta' };

describe('release.yml builds Windows for every tag', () => {
  const windowsJob = (): string => {
    const yml = text('.github/workflows/release.yml');
    return yml.slice(yml.indexOf('  windows:\n'), yml.indexOf('  macos:\n'));
  };

  it('runs the Windows job on every run, after the Linux job made the draft, and keeps macOS behind the switch', () => {
    const job = windowsJob();
    expect(job).toMatch(/needs: \[prepare, linux\]/);
    expect(job).not.toMatch(/^    if:/m);
    const yml = text('.github/workflows/release.yml');
    expect(yml.slice(yml.indexOf('  macos:\n'))).toMatch(/^    if: inputs\.experimental_platforms == true$/m);
  });

  it('uploads into the draft named after the tag, with the feed of the channel', () => {
    const job = windowsJob();
    expect(job).toContain('-c.publish.channel="$CHANNEL"');
    expect(job).toContain('-c.releaseInfo.releaseName="$TAG"');
  });

  it('names the installer the way the check looks for it', () => {
    expect(text('electron-builder.yml')).toMatch(/^nsis:\n  artifactName: coxia-setup-\$\{version\}\.\$\{ext\}$/m);
  });

  it.skipIf(!hasJq)('accepts the draft that holds the installer, its block map and the feed of the channel', () => {
    const r = runStep(WINDOWS_CHECK, linkedBeta(WINDOWS_BETA), BETA_ENV);
    expect(r.code).toBe(0);
    expect(r.out).toContain('coxia-setup-0.6.0-beta.1.exe');
  });

  it.skipIf(!hasJq)('refuses a beta that carries latest.yml: it would move the Windows installs on the stable channel', () => {
    const r = runStep(WINDOWS_CHECK, linkedBeta([...WINDOWS_BETA, { name: 'latest.yml' }]), BETA_ENV);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('::error::the draft release carries a Windows feed of another channel: latest.yml');
  });

  it.skipIf(!hasJq)('refuses a draft without the installer', () => {
    const r = runStep(WINDOWS_CHECK, linkedBeta([{ name: 'beta.yml' }]), BETA_ENV);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('::error::the draft release is missing coxia-setup-0.6.0-beta.1.exe');
  });

  it.skipIf(!hasJq)('refuses when a second draft of the version exists: the files may have gone to the other one', () => {
    const r = runStep(WINDOWS_CHECK, [...linkedBeta(WINDOWS_BETA), RELEASES[3]], BETA_ENV);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('::error::expected one draft release named v0.6.0-beta.1');
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
