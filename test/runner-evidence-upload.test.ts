import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { readOutput, recordCommentDraft, startRun } from '../src/shared/runs';
import { runThreadId } from '../src/shared/forum';
import { flowOf } from '../src/shared/runs/flow';
import type { FlowStage, Run } from '../src/shared/runs';
import type { VcsCommand, VcsComment, VcsProvider, VcsWriteOp } from '../src/main/vcs/types';
import type { ReleaseAction } from '../src/shared/types';
import { VcsError } from '../src/main/vcs/errors';
import { buildRuntime, type VcsSettings } from '../src/main/vcs/runtime';
import type { CliRun } from '../src/main/vcs/transport';
import type { ExecMeta } from '../src/main/vcs/types';

// The evidence a comment cites going to the code host: the upload is planned and run through the door, the address the host answers with is embedded under the
// text, and a host that cannot carry the file leaves the comment saying how many pieces there are. A fake provider and a recording door: no host, no network.

const PNG = (): Uint8Array => encodePng({ width: 2, height: 2, data: new Uint8Array(2 * 2 * 4).fill(120) });

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(String(dirs.pop()), { recursive: true, force: true });
});
const make = (): string => mkdtempSync(join(tmpdir(), 'cerimonias-evidence-upload-'));

/** A provider that answers the reads a comment needs and plans an upload, with a fixed address (or refuses to take the file). */
function fakeProvider(o: { upload?: boolean; planError?: Error } = {}): VcsProvider {
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
        // A host that refuses to plan the upload says why (a workspace on the CLI with no token), instead of planning nothing.
        if (o.planError) throw o.planError;
        return o.upload === false ? [] : [{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'uploads.github.com/?repository_id=group%2Fproject&name=ev-1.png&content_type=image%2Fpng', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: op.path }];
      }
      const body = op.op === 'commentIssue' || op.op === 'commentMr' || op.op === 'editIssueNote' || op.op === 'editMrNote' || op.op === 'createMr' ? op.body : '';
      if (op.op === 'createMr') return [{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/group/project/pulls', fields: {}, json: JSON.stringify({ title: op.title, body, base: op.targetBranch }) }];
      return [{ vcs: 'github', via: 'api', method: 'POST', endpoint: 'repos/group/project/issues/101/comments', fields: {}, json: JSON.stringify({ body }) }];
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

function doorOf(provider: VcsProvider, posted: VcsCommand[][], proposed: VcsCommand[][] = [], metas: Record<string, unknown>[] = [], o: { refusal?: string; postMetas?: Record<string, unknown>[]; noAddress?: boolean; failUpload?: Error } = {}): Door {
  return {
    provider: () => provider,
    refusal: () => o.refusal ?? null,
    post: async (meta: Record<string, unknown>, commands: VcsCommand[]) => {
      o.postMetas?.push(meta);
      // An upload the host refuses throws at its own command, as the real door does; the comment or the pull request is another call.
      if (o.failUpload && commands.some((c) => c.bodyFile)) throw o.failUpload;
      posted.push(commands);
      // One answer per command, in the order they ran: an upload answers where the file lives, a comment its note id.
      return commands.map((c) => {
        if (c.bodyFile && o.noAddress) return {};
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

  it('still counts the pieces no command carries when an autonomous comment uploads the others', async () => {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum, stage, agent } = world(dataDir);
    const posted: VcsCommand[][] = [];
    // Two pieces cited, one the host can take: the other is counted in the text, next to the image that went up.
    const oneOfTwo = (r: Run, ids: readonly string[]): { images: EvidenceUpload[]; total: number } => ({ images: uploads(r, ids.slice(0, 1)).images, total: ids.length });
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider(), posted),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: oneOfTwo,
    });
    const output = readOutput({ summary: 'Looked.', comment: { sections: [{ heading: 'What I saw', body: 'The field.' }], technical: '' }, evidence: ['ev-1', 'ev-2'] }, 'qa');
    const end = { stage, agent, kind: 'qa', output, autonomous: true } as StageEnd;
    await publisher.stageEnded(run.id, end);
    expect(commentBodyOf(posted)).toContain('![The screen](https://example.test/group/project/assets/ev-1.png)');
    expect(commentBodyOf(posted)).toContain('1 piece(s) of evidence stay in the app');
  });

  it('posts the comment without the images when the upload fails, and says why in the thread', async () => {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum, stage, agent } = world(dataDir);
    forum.ensureThread({ id: runThreadId(run.id), kind: 'run', runId: run.id, title: 'Add the thing' });
    const posted: VcsCommand[][] = [];
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider(), posted, [], [], { failUpload: new Error('the host said no') }),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: uploads,
    });
    const output = readOutput({ summary: 'Looked.', comment: { sections: [{ heading: 'What I saw', body: 'The field.' }], technical: '' }, evidence: ['ev-1'] }, 'qa');
    await publisher.stageEnded(run.id, { stage, agent, kind: 'qa', output, autonomous: true } as StageEnd);
    expect(commentBodyOf(posted)).toContain('1 piece(s) of evidence stay in the app');
    expect(commentBodyOf(posted)).not.toContain('![');
    const line = forum.read(runThreadId(run.id), 0, 100)?.messages.filter((m) => m.code === 'runner.evidence.notUploaded') ?? [];
    expect(line).toHaveLength(1);
    expect(line[0].params).toMatchObject({ count: 1, reason: 'the host said no' });
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

describe('the pull request an autonomous run opens', () => {
  const ADDRESS = 'https://example.test/group/project/assets/ev-1.png';

  /** A run at the point the push is done: its description is drafted (citing `ids`), and the pull request is next. */
  function opened(o: { pullRequest: boolean; ids?: string[]; door?: Parameters<typeof doorOf>[4]; upload?: boolean; planError?: Error; baseBranch?: string }) {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum } = world(dataDir);
    config.runner.autonomy = { ...config.runner.autonomy, cycle: true, pullRequest: o.pullRequest };
    if (o.baseBranch) runs.update(run.id, (r) => ({ run: { ...r, baseBranch: o.baseBranch }, messages: [] }));
    runs.update(run.id, (r) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: 'draft', body: 'Closes #101\n', headline: '', title: 'Add the thing', ...(o.ids ? { evidenceIds: o.ids } : {}) }, '2026-10-03T12:00:00Z'));
    // The run's conversation exists by the time its pull request is next.
    forum.ensureThread({ id: runThreadId(run.id), kind: 'run', runId: run.id, title: 'Add the thing' });
    const posted: VcsCommand[][] = [];
    const proposed: VcsCommand[][] = [];
    const metas: Record<string, unknown>[] = [];
    const postMetas: Record<string, unknown>[] = [];
    const publisher = createPublisher({
      runs,
      forum,
      config: () => config,
      env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }),
      door: doorOf(fakeProvider({ upload: o.upload, planError: o.planError }), posted, proposed, metas, { postMetas, ...(o.door ?? {}) }),
      now: () => new Date('2026-10-03T12:00:00Z'),
      evidenceUploads: uploads,
    });
    const go = () => publisher.actionDone({ kind: 'run-push', unit: { runId: run.id } } as unknown as ReleaseAction, []);
    const said = (code: string) => forum.read(runThreadId(run.id), 0, 100)?.messages.filter((m) => m.code === code) ?? [];
    return { run, runs, forum, posted, proposed, metas, postMetas, go, said, publisher };
  }

  const prBody = (posted: VcsCommand[][]): string => {
    const create = posted.flat().find((c) => c.endpoint === 'repos/group/project/pulls');
    return create?.json ? (JSON.parse(create.json) as { body: string }).body : '';
  };

  it('does not wait because it cites images: they go up first, by themselves, and the description embeds the address', async () => {
    const w = opened({ pullRequest: true, ids: ['ev-1'] });
    await w.go();
    expect(w.proposed).toEqual([]);
    // Two calls through the door, under the same key: the upload, then the pull request.
    expect(w.posted).toHaveLength(2);
    expect(w.posted[0].every((c) => c.bodyFile)).toBe(true);
    expect(w.posted[1].map((c) => c.endpoint)).toEqual(['repos/group/project/pulls']);
    expect(w.postMetas.map((m) => [m.key, m.by])).toEqual([['pr:r-101-abcd', 'app'], ['pr:r-101-abcd', 'app']]);
    expect(prBody(w.posted)).toContain(`![The screen](${ADDRESS})`);
    // The run records the description that went out, not the draft without the images.
    const rec = w.runs.get(w.run.id)!.comments.pr!;
    expect(rec).toMatchObject({ status: 'published', noteId: 9 });
    expect(rec.body).toContain(`![The screen](${ADDRESS})`);
    expect(w.forum.read(runThreadId(w.run.id), 0, 100)?.messages.some((m) => m.code === 'runner.pr.created')).toBe(true);
  });

  it('aims at the branch the run was cut from, and at the default branch for a run that did not record one', async () => {
    const base = (posted: VcsCommand[][]): string => (JSON.parse(posted.flat().find((c) => c.endpoint === 'repos/group/project/pulls')!.json!) as { base: string }).base;
    const cut = opened({ pullRequest: true, baseBranch: 'release/0.8.0' });
    await cut.go();
    expect(base(cut.posted)).toBe('release/0.8.0');
    const older = opened({ pullRequest: true });
    await older.go();
    expect(base(older.posted)).toBe('main');
  });

  it('counts an image the host gave no address for instead of losing it', async () => {
    const w = opened({ pullRequest: true, ids: ['ev-1'], door: { noAddress: true } });
    await w.go();
    expect(w.proposed).toEqual([]);
    expect(prBody(w.posted)).toContain('1 piece(s) of evidence stay in the app');
    expect(prBody(w.posted)).not.toContain('![');
    expect(w.runs.get(w.run.id)!.comments.pr!.body).toContain('1 piece(s) of evidence stay in the app');
  });

  it('opens by itself with no image to send, recording the description as it was', async () => {
    const w = opened({ pullRequest: true });
    await w.go();
    expect(w.proposed).toEqual([]);
    expect(w.posted).toHaveLength(1);
    expect(w.runs.get(w.run.id)!.comments.pr).toMatchObject({ status: 'published', noteId: 9, body: 'Closes #101\n' });
  });

  it('still proposes, with the uploads inside the proposal group, when the choice is off', async () => {
    const w = opened({ pullRequest: false, ids: ['ev-1'] });
    await w.go();
    expect(w.posted).toEqual([]);
    expect(w.proposed).toHaveLength(1);
    expect(w.proposed[0].findIndex((c) => c.bodyFile)).toBe(0);
    expect(w.proposed[0][1].endpoint).toBe('repos/group/project/pulls');
    expect(w.metas[0].evidence).toEqual({ titles: ['The screen'], positions: [0], bodyAt: 1 });
  });

  it('opens the pull request without the images when the host refuses the upload, and says how many stayed behind and why', async () => {
    const w = opened({ pullRequest: true, ids: ['ev-1'], door: { failUpload: new Error('the host said no') } });
    await w.go();
    expect(w.proposed).toEqual([]);
    // Only the pull request went out; the description counts the piece instead of embedding it.
    expect(w.posted.flat().map((c) => c.endpoint)).toEqual(['repos/group/project/pulls']);
    expect(prBody(w.posted)).toContain('1 piece(s) of evidence stay in the app');
    expect(prBody(w.posted)).not.toContain('![');
    expect(w.runs.get(w.run.id)!.comments.pr).toMatchObject({ status: 'published', noteId: 9 });
    const line = w.said('runner.evidence.notUploaded');
    expect(line).toHaveLength(1);
    expect(line[0].params).toMatchObject({ count: 1, reason: 'the host said no' });
    expect(w.said('runner.pr.created')).toHaveLength(1);
    expect(w.said('runner.pr.failed')).toHaveLength(0);
  });

  it('plans no image when the host says an upload is impossible, and the pull request opens listing the evidence', async () => {
    const err = new VcsError('upload_needs_api', { kind: 'GitHub' });
    const w = opened({ pullRequest: true, ids: ['ev-1'], planError: err });
    await w.go();
    expect(w.posted.flat().map((c) => c.endpoint)).toEqual(['repos/group/project/pulls']);
    expect(prBody(w.posted)).toContain('1 piece(s) of evidence stay in the app');
    expect(w.said('runner.evidence.notUploaded')[0].params).toMatchObject({ count: 1, reason: err.message });
    expect(err.message).toMatch(/CLI/);
    expect(w.said('runner.pr.created')).toHaveLength(1);
  });

  it('proposes the pull request with the evidence listed when the upload is impossible and the choice is off', async () => {
    const w = opened({ pullRequest: false, ids: ['ev-1'], planError: new VcsError('upload_needs_api', { kind: 'GitHub' }) });
    await w.go();
    expect(w.posted).toEqual([]);
    expect(w.proposed).toHaveLength(1);
    expect(w.proposed[0].some((c) => c.bodyFile)).toBe(false);
    expect(JSON.parse(w.proposed[0][0].json!).body).toContain('1 piece(s) of evidence stay in the app');
    expect(w.said('runner.evidence.notUploaded')).toHaveLength(1);
  });

  it('says what the "sim" could not upload when a group comes back with a failed image', async () => {
    const w = opened({ pullRequest: false, ids: ['ev-1'] });
    await w.go();
    const evidence = w.metas[0].evidence as { titles: string[]; positions: number[]; bodyAt: number };
    // The upload failed inside the approved group (the group went on without it): its slot holds the reason, the pull request's answer follows.
    await w.publisher.actionDone({ kind: 'vcs', unit: { runId: w.run.id, purpose: 'run-pr' }, evidence } as unknown as ReleaseAction, [{ uploadError: 'upload refused' }, { number: 7, html_url: 'https://example.test/group/project/pull/7' }]);
    expect(w.said('runner.evidence.notUploaded')[0].params).toMatchObject({ count: 1, reason: 'upload refused' });
    expect(w.runs.get(w.run.id)!.comments.pr).toMatchObject({ status: 'published', noteId: 7 });
    expect(w.runs.get(w.run.id)!.comments.pr!.body).toContain('1 piece(s) of evidence stay in the app');
  });

  it('is still refused in a test workspace: nothing goes up and nothing is proposed', async () => {
    const w = opened({ pullRequest: true, ids: ['ev-1'], door: { refusal: 'a test workspace writes nothing' } });
    await w.go();
    expect(w.posted).toEqual([]);
    expect(w.proposed).toEqual([]);
    expect(w.forum.read(runThreadId(w.run.id), 0, 100)?.messages.some((m) => m.code === 'runner.pr.refused')).toBe(true);
  });
});

describe('a GitHub workspace that talks to the host through the CLI', () => {
  // The real GitHub provider and executor on a fake CLI and a fake fetch: the door runs each command through the executor, as the app's door does (minus the
  // audit log). Nothing here reaches a host.
  const TOKEN = 'TESTTOKEN-github-not-real-0003';
  const settings = (over: Partial<VcsSettings> = {}): VcsSettings => ({ id: 'gh', kind: 'github', host: 'github.com', apiUrl: '', user: '', secretRef: 'gh.token', cli: 'gh', preference: 'cli', repos: [], ...over });

  function world2(o: { token: boolean }) {
    const dataDir = make();
    dirs.push(dataDir);
    const { config, run, runs, forum } = world(dataDir);
    config.runner.autonomy = { ...config.runner.autonomy, cycle: true, pullRequest: true };
    runs.update(run.id, (r) => ({ run: { ...r, baseBranch: 'main' }, messages: [] }));
    runs.update(run.id, (r) => recordCommentDraft(r, 'pr', { target: 'mr', bodyHash: 'draft', body: 'Closes #101\n', headline: '', title: 'Add the thing', evidenceIds: ['ev-1'] }, '2026-10-03T12:00:00Z'));
    forum.ensureThread({ id: runThreadId(run.id), kind: 'run', runId: run.id, title: 'Add the thing' });
    const cliCalls: string[][] = [];
    const prBodies: string[] = [];
    const fetched: { url: string; auth: string | undefined }[] = [];
    const cliRun: CliRun = async (_file, args) => {
      cliCalls.push(args);
      // The runner's reads (looking for a pull request that already exists) find nothing; only the write carries a body.
      if (!args.includes('--method')) return '[]';
      const input = args[args.indexOf('--input') + 1];
      prBodies.push(input ? (JSON.parse(readFileSync(input, 'utf8')) as { body: string }).body : '');
      return JSON.stringify({ number: 12, html_url: 'https://example.test/group/project/pull/12' });
    };
    const fetchFn = (async (url: string, init: RequestInit) => {
      fetched.push({ url: String(url), auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify({ url: 'https://example.test/assets/ev-1.png' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rt = buildRuntime(settings({ secretRef: o.token ? 'gh.token' : null }), {
      token: () => {
        if (!o.token) throw new VcsError('no_token', { id: 'gh', ref: '' });
        return TOKEN;
      },
      env: () => ({}),
      run: cliRun,
      fetch: fetchFn,
    });
    const door = {
      provider: () => rt.provider,
      refusal: () => null,
      post: async (_meta: unknown, commands: VcsCommand[]) => {
        const out: unknown[] = [];
        for (const c of commands) {
          const meta: ExecMeta = {};
          await rt.exec.run(c, meta);
          out.push(meta.response);
        }
        return out;
      },
      propose: () => true,
      proposePush: () => true,
      proposeRelease: () => true,
      release: async () => 'ok',
    } as unknown as Door;
    const publisher = createPublisher({ runs, forum, config: () => config, env: () => ({ issueProject: 'group/project', repos: [{ id: 'app', projectPath: 'group/project' }] }), door, now: () => new Date('2026-10-03T12:00:00Z'), evidenceUploads: uploads });
    const go = () => publisher.actionDone({ kind: 'run-push', unit: { runId: run.id } } as unknown as ReleaseAction, []);
    const said = (code: string) => forum.read(runThreadId(run.id), 0, 100)?.messages.filter((m) => m.code === code) ?? [];
    return { run, runs, go, said, cliCalls, prBodies, fetched };
  }

  it('with a token set, uploads the image by the API and opens the pull request through the CLI with the image embedded', async () => {
    const w = world2({ token: true });
    await w.go();
    expect(w.fetched).toEqual([{ url: expect.stringMatching(/^https:\/\/uploads\.github\.com\//), auth: `Bearer ${TOKEN}` }]);
    expect(w.cliCalls.filter((a) => a.includes('--method'))).toHaveLength(1);
    expect(w.cliCalls.flat().join(' ')).not.toContain(TOKEN);
    expect(w.prBodies[0]).toContain('![The screen](https://example.test/assets/ev-1.png)');
    expect(w.said('runner.evidence.notUploaded')).toEqual([]);
    expect(w.runs.get(w.run.id)!.comments.pr).toMatchObject({ status: 'published', noteId: 12 });
  });

  it('with no token, opens the pull request with the evidence listed and says the real cause in the thread', async () => {
    const w = world2({ token: false });
    await w.go();
    expect(w.fetched).toEqual([]);
    expect(w.cliCalls.filter((a) => a.includes('--method'))).toHaveLength(1);
    expect(w.prBodies[0]).toContain('1 piece(s) of evidence stay in the app');
    expect(w.prBodies[0]).not.toContain('![');
    const [line] = w.said('runner.evidence.notUploaded');
    expect(line.params).toMatchObject({ count: 1 });
    expect(String(line.params?.reason)).toMatch(/CLI/);
    expect(String(line.params?.reason)).not.toMatch(/no GitHub integration|não tem uma integração/);
    expect(w.said('runner.pr.created')).toHaveLength(1);
    expect(w.said('runner.pr.failed')).toEqual([]);
    expect(w.runs.get(w.run.id)!.comments.pr).toMatchObject({ status: 'published', noteId: 12 });
  });
});
