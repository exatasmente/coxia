import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPublisher, type StageEnd } from '../src/main/runner/publish';
import { createForumStore } from '../src/main/forum-core';
import { createRunStore } from '../src/main/runs-core';
import { encodePng } from '../src/main/evidence/png';
import { neutralConfig } from '../src/shared/config';
import { runnerConfig } from './helpers/runner';
import type { AgentDef, WorkspaceConfig } from '../src/shared/config/types';
import type { EvidenceUpload } from '../src/shared/evidence';
import { readOutput, startRun } from '../src/shared/runs';
import { flowOf } from '../src/shared/runs/flow';
import type { FlowStage, Run } from '../src/shared/runs';
import type { VcsCommand, VcsComment, VcsProvider, VcsWriteOp } from '../src/main/vcs/types';

// The evidence a comment cites going to the code host: the upload is planned and run through the door, the address the host answers with is embedded under the
// text, and a host that cannot carry the file leaves the comment saying how many pieces there are. A fake provider and a recording door: no host, no network.

const PNG = (): Uint8Array => encodePng({ width: 2, height: 2, data: new Uint8Array(2 * 2 * 4).fill(120) });

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(String(dirs.pop()), { recursive: true, force: true });
});
const make = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-evidence-upload-'));

/** A provider that answers the reads a comment needs and plans an upload, with a fixed address (or refuses to take the file). */
function fakeProvider(o: { upload?: boolean } = {}): VcsProvider {
  return {
    kind: 'github',
    id: 'gh',
    host: 'example.test',
    transport: 'api',
    caps: {},
    async listIssueComments(): Promise<VcsComment[]> {
      return [];
    },
    async listMrComments(): Promise<VcsComment[]> {
      return [];
    },
    async linkedMrs() {
      return [];
    },
    async getRepo() {
      return { project: 'group/project', defaultBranch: 'main', webUrl: 'https://example.test/group/project' };
    },
    async currentUser() {
      return { id: 1, username: 'bot', name: 'Bot', webUrl: null };
    },
    async planWrite(op: VcsWriteOp): Promise<VcsCommand[]> {
      if (op.op === 'uploadAttachment') {
        return o.upload === false ? [] : [{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'uploads.github.com/?repository_id=group%2Fproject&name=ev-1.png&content_type=image%2Fpng', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: op.path }];
      }
      const body = op.op === 'commentIssue' || op.op === 'commentMr' || op.op === 'editIssueNote' || op.op === 'editMrNote' ? op.body : '';
      return [{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/group/project/issues/101/comments', fields: {}, json: JSON.stringify({ body }) }];
    },
    async uploadToken() {
      return 'TESTTOKEN-not-real-0001';
    },
    validateCommand() {},
    issueUrl: () => '',
    mrUrl: () => '',
    noteUrl: () => '',
  } as unknown as VcsProvider;
}

const IDENTITY = { name: 'Runner Test', email: 'runner@example.test' };

interface World {
  config: WorkspaceConfig;
  run: Run;
  runs: ReturnType<typeof createRunStore>;
  forum: ReturnType<typeof createForumStore>;
  stage: FlowStage;
  agent: AgentDef;
}

function world(dataDir: string): World {
  const runs = createRunStore(join(dataDir, 'runs'));
  const forum = createForumStore(join(dataDir, 'forum'));
  // The same configuration the runner helpers boot with: the engineering flow with its team.
  const config = runnerConfig(neutralConfig(), { root: dataDir, origin: '', clone: dataDir, worktrees: join(dataDir, 'worktrees') }, (c) => {
    c.runner = { ...c.runner, worktreesDir: join(dataDir, 'worktrees'), identity: IDENTITY };
  });
  const allFlow = flowOf(config) as FlowStage[];
  const stage = allFlow.find((s) => s.id === 'qa') as FlowStage;
  const agent = config.agents.team.find((a) => a.id === stage.agent) as AgentDef;
  // A flow of the one stage this test drives: `startRun` only needs the stage it starts on to have its agent.
  const flow = [{ ...stage }];
  const run: Run = startRun({ id: 'r-101-abcd', issue: { iid: 101, ref: 'app#101', title: 'Add the thing', url: null }, repo: 'app', branch: 'cycle/101', worktree: dataDir, cycleFolder: 'docs/cycles/101-x', cycleId: '101-x' }, flow, '2026-10-01T00:00:00Z').run;
  runs.create(run);
  return { config, run, runs, forum, stage, agent };
}

type Door = Parameters<typeof createPublisher>[0]['door'];

function doorOf(provider: VcsProvider, posted: VcsCommand[][], proposed: VcsCommand[][] = [], metas: Record<string, unknown>[] = []): Door {
  return {
    provider: () => provider,
    refusal: () => null,
    post: async (_meta: unknown, commands: VcsCommand[]) => {
      posted.push(commands);
      // One answer per command, in the order they ran: an upload answers where the file lives, a comment its note id.
      return commands.map((c) => {
        if (c.bodyFile) return { url: `https://example.test/group/project/assets/${new URLSearchParams(c.endpoint.split('?')[1] ?? '').get('name') ?? 'file'}` };
        return { id: 9, html_url: 'https://example.test/group/project/issues/101#issuecomment-9' };
      });
    },
    propose: (meta: Record<string, unknown>, commands: VcsCommand[]) => {
      metas.push(meta);
      proposed.push(commands);
      return true;
    },
    proposePush: () => true,
    proposeRelease: () => true,
    release: async () => 'ok',
  } as unknown as Door;
}

const uploads = (_run: Run, ids: readonly string[]): { images: EvidenceUpload[]; total: number } => ({ images: ids.map((id) => ({ id, name: `${id}.png`, media: 'image/png', bytes: PNG(), title: 'The screen' })), total: ids.length });

/** The body of the comment the run posted: every command that is not the upload of a file. */
const commentBodyOf = (posted: VcsCommand[][]): string => posted.flat().filter((c) => !c.bodyFile).map((c) => (c.json ? (JSON.parse(c.json) as { body?: string }).body ?? '' : '')).join('\n');

describe('evidence and the code host', () => {
  it('uploads the cited evidence and embeds the address the host answers with', async () => {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum, stage, agent } = world(dataDir);
    const posted: VcsCommand[][] = [];
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider(), posted),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: uploads,
    });
    const output = readOutput({ summary: 'Looked.', comment: { sections: [{ heading: 'What I saw', body: 'The field.' }], technical: '' }, scenarios: [{ name: 'See the app', result: 'fail', severity: 'blocking', detail: 'Crashes', evidenceIds: ['ev-1'] }] }, 'qa');
    const end = { stage, agent, kind: 'qa', output, autonomous: true } as StageEnd;
    await publisher.stageEnded(run.id, end);
    expect(commentBodyOf(posted)).toContain('![The screen](https://example.test/group/project/assets/ev-1.png)');
    // The upload of the file went through the door as a command of its own, before the comment.
    expect(posted.some((g) => g.some((c) => c.bodyFile))).toBe(true);
  });

  it('says how many pieces there are when the host cannot take the file', async () => {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum, stage, agent } = world(dataDir);
    const posted: VcsCommand[][] = [];
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider({ upload: false }), posted),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: uploads,
    });
    const output = readOutput({ summary: 'Looked.', comment: { sections: [{ heading: 'What I saw', body: 'The field.' }], technical: '' }, evidence: ['ev-1'] }, 'qa');
    const end = { stage, agent, kind: 'qa', output, autonomous: true } as StageEnd;
    await publisher.stageEnded(run.id, end);
    // The host planned no upload for the file: the comment goes up without the image, saying the piece stays in the app.
    expect(commentBodyOf(posted)).toContain('1 piece(s) of evidence stay in the app');
    expect(posted.flat().some((c) => c.bodyFile)).toBe(false);
  });

  it('sends no image before the "sim" of an agent that waits', async () => {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum, stage, agent } = world(dataDir);
    const posted: VcsCommand[][] = [];
    const proposed: VcsCommand[][] = [];
    const metas: Record<string, unknown>[] = [];
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider(), posted, proposed, metas),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: uploads,
    });
    const output = readOutput({ summary: 'Looked.', comment: { sections: [{ heading: 'What I saw', body: 'The field.' }], technical: '' }, scenarios: [{ name: 'See the app', result: 'fail', severity: 'blocking', detail: 'Crashes', evidenceIds: ['ev-1'] }] }, 'qa');
    const end = { stage, agent, kind: 'qa', output, autonomous: false } as StageEnd;
    await publisher.stageEnded(run.id, end);
    // An agent that waits sends nothing: the upload and the comment wait in one proposal, so the person sees the image before a "yes".
    expect(posted.flat()).toHaveLength(0);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].some((c) => c.bodyFile)).toBe(true);
    // The upload is the first command of the group and the comment owns the body the address goes into once the group runs.
    expect(proposed[0].findIndex((c) => c.bodyFile)).toBe(0);
    expect(metas[0].evidence).toEqual({ titles: ['The screen'], positions: [0], bodyAt: 1 });
  });
});
