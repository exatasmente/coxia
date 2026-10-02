import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { API_CHANNELS } from '../src/shared/apiChannels';
import { assertPlainPush, findClone, remoteMatches } from '../src/main/conflictGit';
import { validateVerify } from '../src/main/conflictVerify';
import { EXTERNAL_EFFECT, DESKTOP_ONLY, webAccess, webRefusal } from '../src/main/webPolicy';
import { IDENTITY, makeFixture } from './helpers/conflictRepos';

const LOCAL_STEPS = ['conflict:prepare', 'conflict:propose', 'conflict:choose', 'conflict:apply', 'conflict:commit', 'conflict:reopen', 'conflict:discard'];

describe('web policy for conflict resolution', () => {
  it('prepare, propose, review, apply, commit and discard are local and open to the browser', () => {
    for (const channel of LOCAL_STEPS) {
      expect(webAccess(channel)).toBe('allow');
      expect(webRefusal(channel, false)).toBeNull();
    }
    expect(Object.values(API_CHANNELS)).toEqual(expect.arrayContaining(LOCAL_STEPS));
  });

  it('the push is only reachable through actions:approve, which the browser may not call unless external effects are allowed', () => {
    expect(EXTERNAL_EFFECT.has('actions:approve')).toBe(true);
    expect(webAccess('actions:approve')).toBe('external');
    expect(webRefusal('actions:approve', false)).toContain('efeito externo');
    expect(webRefusal('actions:approve', true)).toBeNull();
    // No conflict channel pushes: none of them is an alternative door around the external-effects rule.
    for (const channel of LOCAL_STEPS) expect(EXTERNAL_EFFECT.has(channel)).toBe(false);
  });

  it('the commands that Aplicar runs can only be set from the desktop window', () => {
    expect(DESKTOP_ONLY.has('conflicts:verify-set')).toBe(true);
    expect(webAccess('conflicts:verify-set')).toBe('deny');
    expect(webRefusal('conflicts:verify-set', true)).toContain('janela do app');
    expect(webAccess('conflicts:verify-get')).toBe('allow');
  });
});

describe('push guard', () => {
  it('only takes a plain push of one ref', () => {
    expect(() => assertPlainPush(['origin', 'HEAD:refs/heads/release/bugfix/1'])).not.toThrow();
    expect(() => assertPlainPush(['--no-verify', 'origin', 'HEAD:refs/heads/x'])).not.toThrow();
    for (const bad of [['-f'], ['--force'], ['--force-with-lease'], ['--force-with-lease=x:y'], ['--delete'], ['--mirror'], ['-d'], ['+HEAD:refs/heads/x'], [':refs/heads/x'], ['--all']]) {
      expect(() => assertPlainPush(['origin', ...bad]), bad.join(' ')).toThrow();
    }
  });
});

describe('remote matching and clone discovery', () => {
  it('matches https, ssh and scp-like URLs of the project, and rejects other hosts and projects', () => {
    const host = 'git.acme.test';
    expect(remoteMatches('https://git.acme.test/acme/gateway.git', 'acme/gateway', host)).toBe(true);
    expect(remoteMatches('git@git.acme.test:acme/gateway.git', 'acme/gateway', host)).toBe(true);
    expect(remoteMatches('ssh://git@git.acme.test/acme/web', 'acme/web', host)).toBe(true);
    expect(remoteMatches('https://github.com/acme/gateway.git', 'acme/gateway', host)).toBe(false);
    expect(remoteMatches('https://git.acme.test/acme/web-frontend.git', 'acme/web', host)).toBe(false);
    expect(remoteMatches('https://git.acme.test/other/acme/web.git', 'acme/web', host)).toBe(false);
    expect(remoteMatches('/tmp/x/grp/proj.git', 'grp/proj', host)).toBe(true);
  });

  const made: string[] = [];
  afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('finds the regular clone whose origin is the project, ignoring worktrees and other projects', async () => {
    Object.assign(process.env, IDENTITY);
    const f = makeFixture();
    made.push(f.root);
    expect(await findClone(f.project, f.cloneRoots, 'git.acme.test')).toBe(f.clone);
    expect(await findClone('grp/other', f.cloneRoots, 'git.acme.test')).toBeNull();
    const empty = join(f.root, 'none');
    mkdirSync(empty);
    expect(await findClone(f.project, [empty, join(f.root, 'missing')], 'git.acme.test')).toBeNull();
  });
});

describe('verification settings', () => {
  it('accepts group/project keys, trims commands and drops empty ones', () => {
    expect(validateVerify({ 'acme/gateway': '  npx jest  ', 'acme/web': '   ' })).toEqual({ 'acme/gateway': 'npx jest' });
  });

  it('rejects odd project names and oversized commands', () => {
    expect(() => validateVerify({ '../x': 'true' })).toThrow();
    expect(() => validateVerify({ web: 'true' })).toThrow();
    expect(() => validateVerify({ 'acme/web': 'x'.repeat(2001) })).toThrow();
    expect(() => validateVerify({ 'acme/web': 'a\0b' })).toThrow();
  });
});
