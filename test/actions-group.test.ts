// A group of writes that are one thing to the person (one "sim" for a review round), the write an agent's autonomy lets go out, and what a module
// learns when a proposal is carried out. The door is the one of every write: the same validation, the same refusal in a test workspace, the same audit log.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { VcsCommand } from '../src/shared/types';
import { fakeGitlabRuntime } from './helpers/vcs';

const DATA = mkdtempSync(join(tmpdir(), 'cerimonias-actions-group-'));
process.env.CERIMONIAS_DATA_DIR = DATA;

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');

const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });
const note = (body: string): VcsCommand => ({ via: 'glab', method: 'POST', endpoint: 'projects/acme%2Fweb/issues/101/notes', fields: { body } });
const input = (key: string) => ({ key, issue: 101, issueTitle: 'Issue', summary: 'A review round', detail: 'Read this first.' });

let ran: string[];
let failAt: string | null;
let failUpload: string | null;

beforeEach(() => {
  rmSync(join(ATAS, 'acoes.json'), { force: true });
  rmSync(join(ATAS, 'auditoria.jsonl'), { force: true });
  asReal(false);
  ran = [];
  failAt = null;
  failUpload = null;
  setVcsRuntimeForTests(
    fakeGitlabRuntime(async () => ({}), undefined, async (command, meta) => {
      if (command.bodyFile) {
        if (failUpload) throw new Error(failUpload);
        // An upload of evidence answers where the host keeps the file; the runner embeds that address in the comment that cites it.
        if (meta) {
          meta.code = 201;
          meta.response = { url: 'https://example.test/uploads/ev-1.png' };
        }
        return 'uploaded';
      }
      const body = command.fields.body;
      if (failAt && body === failAt) throw new Error('boom');
      ran.push(body);
      if (meta) {
        meta.code = 201;
        meta.response = { id: ran.length, body };
      }
      return 'ok';
    }),
  );
});

afterAll(() => {
  rmSync(DATA, { recursive: true, force: true });
});

describe('a group of writes', () => {
  it('is one pending proposal that holds every command, shown in order, and nothing runs', () => {
    const a = actions.proposeVcsGroup({ ...input('review:1'), unit: { runId: 'r-1' } }, [note('one'), note('two'), note('three')]);
    expect(a).toMatchObject({ kind: 'gitlab', state: 'pending', done: 0, unit: { runId: 'r-1' }, command: note('one') });
    expect(a?.commands).toEqual([note('one'), note('two'), note('three')]);
    expect(a?.output).toContain('Read this first.');
    expect(a?.output).toContain('1/3');
    expect(a?.output).toContain('3/3');
    expect(ran).toEqual([]);
    expect(actions.listActions()).toHaveLength(1);
    expect(actions.proposeVcsGroup(input('review:1'), [note('one'), note('two')])).toBeNull();
  });

  it('is an ordinary proposal when it holds one command, and nothing when it holds none', () => {
    const a = actions.proposeVcsGroup(input('one'), [note('only')]);
    expect(a?.commands).toBeUndefined();
    expect(a?.command).toEqual(note('only'));
    expect(actions.proposeVcsGroup(input('none'), [])).toBeNull();
  });

  it('is refused whole, before anything is stored, when one command is not one the host may be sent', () => {
    expect(() => actions.proposeVcsGroup(input('bad'), [note('fine'), { via: 'glab', method: 'POST', endpoint: 'user', fields: {} }])).toThrow(/endpoint inválido/);
    expect(actions.listActions()).toEqual([]);
  });

  it('runs in order under one "sim", each write audited under the proposal, and tells the module what the host answered to each', async () => {
    const told: { id: string; responses: unknown[] }[] = [];
    const stop = actions.onActionDone((a, responses) => told.push({ id: a.id, responses }));
    const a = actions.proposeVcsGroup(input('review:2'), [note('one'), note('two'), note('three')]) as { id: string };
    const done = await actions.approveAction(a.id);
    stop();
    expect(done).toMatchObject({ state: 'done', done: 3 });
    expect(ran).toEqual(['one', 'two', 'three']);
    const audit = listAudit().reverse();
    expect(audit.map((l) => l.fields.body)).toEqual(['one', 'two', 'three']);
    expect(audit.every((l) => l.origin.actionId === a.id && l.ok && l.code === 201)).toBe(true);
    expect(told).toEqual([{ id: a.id, responses: [{ id: 1, body: 'one' }, { id: 2, body: 'two' }, { id: 3, body: 'three' }] }]);
  });

  it('stops at the first write that fails, and approving again goes on from there instead of posting the first ones twice', async () => {
    const a = actions.proposeVcsGroup(input('review:3'), [note('one'), note('two'), note('three')]) as { id: string };
    failAt = 'two';
    const failed = await actions.approveAction(a.id);
    expect(failed).toMatchObject({ state: 'failed', done: 1 });
    expect(failed.output).toContain('boom');
    expect(ran).toEqual(['one']);
    expect(listAudit().map((l) => [l.fields.body, l.ok])).toEqual([['two', false], ['one', true]]);
    failAt = null;
    const again = await actions.approveAction(a.id);
    expect(again).toMatchObject({ state: 'done', done: 3 });
    expect(ran).toEqual(['one', 'two', 'three']);
  });

  it('is refused in a test workspace and runs nothing', async () => {
    const a = actions.proposeVcsGroup(input('review:4'), [note('one'), note('two')]) as { id: string };
    asReal(true);
    await expect(actions.approveAction(a.id)).rejects.toThrow(/Workspace de testes/);
    expect(ran).toEqual([]);
    expect(listAudit()).toEqual([]);
  });

  it('survives a listener that throws', async () => {
    const stop = actions.onActionDone(() => {
      throw new Error('listener');
    });
    const a = actions.proposeVcsAction({ ...input('single'), command: note('x') }) as { id: string };
    expect((await actions.approveAction(a.id)).state).toBe('done');
    stop();
  });

  it('appends the address of an upload of evidence to the comment that cites it, in the order the group runs', async () => {
    const file = join(DATA, 'ev-1.png');
    const upload: VcsCommand = { vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fweb/uploads', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: file };
    const a = actions.proposeVcsGroup({ ...input('evidence'), evidence: { titles: ['The screen'], positions: [0], bodyAt: 1 } }, [upload, note('What I saw')]) as { id: string };
    const told: unknown[][] = [];
    const stop = actions.onActionDone((_a, responses) => told.push(responses));
    await actions.approveAction(a.id);
    stop();
    // The upload ran first (a command of its own, with the file as its body) and answered where the file lives; the comment follows with the image embedded
    // under its text, inside the same "sim". The proposal stored the body without a URL: only what the host answered put it there.
    const bodies = listAudit().map((l) => l.fields.body).filter(Boolean);
    expect(bodies).toEqual(['What I saw\n\n![The screen](https://example.test/uploads/ev-1.png)']);
    expect(ran).toEqual(bodies);
    expect(told).toHaveLength(1);
  });
});

describe('an image that cannot go up', () => {
  it('does not stop the comment that cites it: the group goes on, the failure is audited and the answer holds the reason', async () => {
    failUpload = 'the host refused the file';
    const file = join(DATA, 'ev-2.png');
    const upload: VcsCommand = { vcs: 'gitlab', via: 'api', method: 'POST', endpoint: 'projects/acme%2Fweb/uploads', fields: {}, headers: { 'Content-Type': 'image/png' }, bodyFile: file };
    const a = actions.proposeVcsGroup({ ...input('evidence-fails'), evidence: { titles: ['The screen'], positions: [0], bodyAt: 1 } }, [upload, note('What I saw')]) as { id: string };
    const told: unknown[][] = [];
    const stop = actions.onActionDone((_a, responses) => told.push(responses));
    const done = await actions.approveAction(a.id);
    stop();
    expect(done.state).toBe('done');
    // The comment went out as it was written, with no image embedded.
    expect(ran).toEqual(['What I saw']);
    expect(told[0][0]).toEqual({ uploadError: 'the host refused the file' });
    expect(listAudit().map((l) => [l.ok, l.result])).toEqual(expect.arrayContaining([[false, 'the host refused the file'], [true, 'ok']]));
    expect(listAudit()).toHaveLength(2);
  });

  it('still stops the group when a command that is not an image fails', async () => {
    failAt = 'second';
    const a = actions.proposeVcsGroup(input('plain-fails'), [note('first'), note('second')]) as { id: string };
    expect((await actions.approveAction(a.id)).state).toBe('failed');
  });
});

describe('a newer proposal of the same thing', () => {
  it('replaces the one that still waits for the same run, key and purpose, and leaves the others', () => {
    const unit = (over: Record<string, unknown> = {}) => ({ runId: 'r-a-0001', key: 'plan', purpose: 'comment', ...over });
    const first = actions.proposeVcsAction({ ...input('c:1'), command: note('v1'), unit: unit() }) as { id: string };
    const other = actions.proposeVcsAction({ ...input('c:2'), command: note('other'), unit: unit({ key: 'refine' }) }) as { id: string };
    const elsewhere = actions.proposeVcsAction({ ...input('c:3'), command: note('run b'), unit: unit({ runId: 'r-b-0001' }) }) as { id: string };
    const second = actions.proposeVcsGroup({ ...input('c:4'), unit: unit() }, [note('v2'), note('v2 again')]) as { id: string };
    const state = (id: string) => actions.listActions().find((a) => a.id === id);
    expect([state(first.id)?.state, state(other.id)?.state, state(elsewhere.id)?.state, state(second.id)?.state]).toEqual(['skipped', 'pending', 'pending', 'pending']);
    expect(state(first.id)?.output).toMatch(/Substituída|Replaced/);
  });
});

describe('a write an agent\'s autonomy lets go out', () => {
  const meta = { issue: 101, key: 'comment:r-1:refine', summary: 'Refinement', by: 'refiner', bodyHash: 'abc123' };

  it('goes through the same door and the same log: the agent is who, the hash says which text, and the answer comes back', async () => {
    const response = await actions.runVcsAuto(meta, note('hello'));
    expect(response).toEqual({ id: 1, body: 'hello' });
    expect(ran).toEqual(['hello']);
    expect(listAudit()).toEqual([expect.objectContaining({ kind: 'gitlab', target: 'POST projects/acme%2Fweb/issues/101/notes', by: 'refiner', bodyHash: 'abc123', ok: true, code: 201, issue: 101, origin: { actionId: 'auto:comment:r-1:refine', kind: 'auto', key: 'comment:r-1:refine', summary: 'Refinement' } })]);
    expect(actions.listActions()).toEqual([]);
  });

  it('is refused in a test workspace, with nothing sent and nothing logged', async () => {
    asReal(true);
    await expect(actions.runVcsAuto(meta, note('hello'))).rejects.toThrow(/Workspace de testes/);
    expect(ran).toEqual([]);
    expect(listAudit()).toEqual([]);
  });

  it('judges the command like any other: one the list does not have is never sent', async () => {
    await expect(actions.runVcsAuto(meta, { via: 'glab', method: 'PUT', endpoint: 'user', fields: {} })).rejects.toThrow(/endpoint inválido/);
    expect(ran).toEqual([]);
  });

  it('writes the failure with the status the host gave, and says it to the caller', async () => {
    failAt = 'hello';
    await expect(actions.runVcsAuto(meta, note('hello'))).rejects.toThrow('boom');
    expect(listAudit()[0]).toMatchObject({ ok: false, by: 'refiner', result: 'boom' });
  });
});

describe('the push of a run', () => {
  it('replaces a push of the same run that still waits, and keeps the one of another run', () => {
    const one = actions.proposeRunPush({ key: 'push:r-a-0001:1', issue: 101, summary: 'Push', runId: 'r-a-0001', branch: 'cycle/1-a' }) as { id: string };
    const other = actions.proposeRunPush({ key: 'push:r-b-0001:1', issue: 102, summary: 'Push', runId: 'r-b-0001', branch: 'cycle/2-b' }) as { id: string };
    const two = actions.proposeRunPush({ key: 'push:r-a-0001:2', issue: 101, summary: 'Push', runId: 'r-a-0001', branch: 'cycle/1-a' }) as { id: string };
    const state = (id: string) => actions.listActions().find((a) => a.id === id)?.state;
    expect([state(one.id), state(other.id), state(two.id)]).toEqual(['skipped', 'pending', 'pending']);
    expect(actions.proposeRunPush({ key: 'push:r-a-0001:2', issue: 101, summary: 'Push', runId: 'r-a-0001', branch: 'cycle/1-a' })).toBeNull();
    expect(actions.listActions().find((a) => a.id === two.id)).toMatchObject({ kind: 'run-push', unit: { runId: 'r-a-0001', branch: 'cycle/1-a' } });
  });
});
