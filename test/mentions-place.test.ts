// Where a mention is answered: a run's thread resolved through the run store, a squad channel with its mission and scope repositories, the squads channel, or a
// general conversation. Pure: the caller passes the thread, the run store and the config.
import { describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newSquad } from '../src/shared/config/squads';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { ThreadSummary } from '../src/shared/forum';
import type { Run } from '../src/shared/runs';
import { placeOfThread } from '../src/main/mentions/place';

const summary = (over: Partial<ThreadSummary> & { id: string }): ThreadSummary => ({
  kind: 'general',
  runId: null,
  title: over.id,
  createdAt: '2026-10-01T00:00:00Z',
  count: 0,
  lastAt: null,
  lastKind: null,
  openQuestion: false,
  ...over,
});

const config = (): WorkspaceConfig => {
  const c = neutralConfig();
  c.projects.repos = [
    { id: 'api', path: '/tmp/api', remoteUrl: null, vcsId: null, projectPath: 'group/api' },
    { id: 'web', path: '/tmp/web', remoteUrl: null, vcsId: null, projectPath: 'group/web' },
  ];
  c.squads = [newSquad({ id: 'core', name: 'Core', mission: 'Keep the engine sound.', scope: { repos: ['api'] } })];
  return c;
};

const run = (id: string): Run => ({ id, repo: 'api' } as Run);

describe('the place of a thread', () => {
  it('is a run through the run store, and null when the run is gone', () => {
    const place = placeOfThread(summary({ id: 'run-r1', kind: 'run', runId: 'r1' }), (id) => (id === 'r1' ? run('r1') : null), config());
    expect(place).toMatchObject({ kind: 'run', thread: 'run-r1', run: { id: 'r1' } });
    expect(placeOfThread(summary({ id: 'run-r2', kind: 'run', runId: 'r2' }), () => null, config())).toBeNull();
  });

  it('is a squad channel with its mission and the repositories of its scope', () => {
    const place = placeOfThread(summary({ id: 'squad-core', kind: 'channel', squad: 'core' }), () => null, config());
    expect(place).toMatchObject({ kind: 'channel', thread: 'squad-core', squad: { id: 'core' } });
    expect(place?.repos.map((r) => r.id)).toEqual(['api']);
  });

  it('is the squads channel with no squad and the workspace repositories', () => {
    const place = placeOfThread(summary({ id: 'squads', kind: 'channel' }), () => null, config());
    expect(place).toMatchObject({ kind: 'channel', thread: 'squads', squad: null });
    expect(place?.repos.map((r) => r.id)).toEqual(['api', 'web']);
  });

  it('is a general conversation, the whole workspace to read', () => {
    const place = placeOfThread(summary({ id: 'general' }), () => null, config());
    expect(place).toMatchObject({ kind: 'general', thread: 'general' });
    expect(place?.repos.map((r) => r.id)).toEqual(['api', 'web']);
  });

  it('is a channel of a squad the config lost, with no scope narrowed', () => {
    const place = placeOfThread(summary({ id: 'squad-gone', kind: 'channel' }), () => null, config());
    expect(place).toMatchObject({ kind: 'channel', squad: null });
    expect(place?.repos.map((r) => r.id)).toEqual(['api', 'web']);
  });

  it('is a squad channel with the repositories its paths are in, when its scope names no repository', () => {
    const c = config();
    c.squads = [newSquad({ id: 'ui', name: 'UI', scope: { repos: [], paths: [{ repo: 'web', prefix: 'src/renderer' }] } })];
    expect(placeOfThread(summary({ id: 'squad-ui', kind: 'channel', squad: 'ui' }), () => null, c)?.repos.map((r) => r.id)).toEqual(['web']);
  });

  it('is a squad channel with every repository, when the squad goes by labels only', () => {
    const c = config();
    c.squads = [newSquad({ id: 'ops', name: 'Ops', scope: { repos: [], labels: ['area:ops'], paths: [] } })];
    expect(placeOfThread(summary({ id: 'squad-ops', kind: 'channel', squad: 'ops' }), () => null, c)?.repos.map((r) => r.id)).toEqual(['api', 'web']);
  });

  it('expands a repository path kept as ~/ with the home it is given, so it can be found on disk', () => {
    const c = config();
    c.projects.repos[0].path = '~/code/api';
    expect(placeOfThread(summary({ id: 'general' }), () => null, c, '/home/someone')?.repos[0].path).toBe('/home/someone/code/api');
  });

  it('is null for a thread that does not exist', () => {
    expect(placeOfThread(null, () => null, config())).toBeNull();
  });
});
