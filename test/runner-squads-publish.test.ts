// What squads put on the code host: the label of the squad on the issue when a run starts in it, and the issue another squad's request turns into (by itself when
// the liaison runs by itself, a proposal otherwise, refused in a test workspace), with the runs of the two squads linked both ways and the asker waiting.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, issue, work } from './helpers/runner';
import { type SquadBoot, asking, bootSquads, receiving, requesting } from './helpers/squadRunner';
import { SQUADS_CHANNEL } from '../src/shared/forum';
import type { Run } from '../src/shared/runs';
import { withSquads } from './helpers/squads';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { onRunnerActionDone } = await import('../src/main/runner/door');

let forge: Forge;
let stop: (() => void) | null = null;
const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
});

async function started(configure: (c: WorkspaceConfig) => void = () => undefined, test = false): Promise<{ b: Boot; id: string }> {
  forge = makeForge();
  setVcsRuntimeForTests(forge.runtime());
  asReal(test);
  const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; withSquads(c); configure(c); } });
  b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
  b.engine.script('dev-a', () => work('Built.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101', 'app');
  await b.settle();
  return { b, id: run.id };
}

describe('the label of the squad', () => {
  it('goes onto the issue by itself when the liaison of the squad runs by itself, audited and said in the thread', async () => {
    const { b, id } = await started();
    expect(forge.labels).toEqual(['squad-a']);
    expect(b.thread(id).some((m) => m.code === 'runner.squad.set' && m.params.label === 'squad-a')).toBe(true);
    expect(listAudit().find((a) => a.target.includes('/issues/101/labels'))).toMatchObject({ ok: true, kind: 'github', issue: 101 });
    // the other squad's label is not on it
    expect(forge.writes.filter((w) => w.endpoint.endsWith('/issues/101/labels'))).toHaveLength(1);
  });

  it('waits for a "yes" when the squad is switched off, and goes on at the "yes"', async () => {
    const { b, id } = await started((c) => ((c.squads ?? [])[0].autonomy = false));
    expect(forge.labels).toEqual([]);
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'squad');
    expect(proposal).toMatchObject({ state: 'pending', summary: expect.stringContaining('squad-a') });
    expect(b.thread(id).some((m) => m.code === 'runner.squad.proposed')).toBe(true);
    await actions.approveAction(proposal!.id);
    expect(forge.labels).toEqual(['squad-a']);
  });

  it('is not written at all when the squad has none, and a test workspace refuses it', async () => {
    const none = await started((c) => ((c.squads ?? [])[0].label = null));
    expect(forge.writes).toEqual([]);
    expect(none.b.thread(none.id).some((m) => m.code?.startsWith('runner.squad.'))).toBe(false);
    const refused = await started(() => undefined, true);
    expect(forge.writes).toEqual([]);
    expect(refused.b.thread(refused.id).some((m) => m.code === 'runner.squad.refused')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- a request that becomes an issue

const built = () => work('Done.', { artifacts: [doc('3_IMPLEMENTATION.md')] });
const issueProposal = () => actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'request-issue');

/** Squad A's developer asks for a change in B's area; A's liaison makes the request and B's liaison turns it into an issue. */
async function requested(edit: (c: WorkspaceConfig) => void = () => undefined, test = false): Promise<SquadBoot & { id: string }> {
  forge = makeForge();
  setVcsRuntimeForTests(forge.runtime());
  asReal(test);
  const s = await bootSquads(edit, { dir: ATAS, publish: true });
  const { b } = s;
  // the issue the forge will make is the first it numbers: 200
  b.issues.add(issue(200, { title: 'Expose the totals', labels: ['squad-b'] }));
  b.engine.script('dev-a', asking('The web must expose the totals: can it?'), built);
  b.engine.script('lead-a', requesting('b', 'change', 'Expose the totals of an invoice in the web API.'));
  b.engine.script('lead-b', receiving({ verdict: 'issue', title: 'Expose the totals', text: 'The invoice endpoint must include the totals.' }));
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101', 'app');
  await b.settle();
  return { ...s, id: run.id };
}

describe('a request for a change in another squad\'s area', () => {
  it('becomes an issue of that squad on the tracker, with its label and where it came from, a run of that squad linked to the asker both ways, and the asker waits for it', async () => {
    const { b, id } = await requested();
    // the issue: created by itself (the liaison of B runs by itself), audited, born with the label of B
    expect(forge.issues.get(200)).toMatchObject({ title: 'Expose the totals', labels: ['squad-b'], state: 'open' });
    expect(forge.issues.get(200)?.body).toContain('The invoice endpoint must include the totals.');
    expect(forge.issues.get(200)?.body).toContain('Requested by the squad Squad A while working on app#101.');
    expect(listAudit().find((a) => a.target === 'POST repos/group/project/issues')).toMatchObject({ ok: true, kind: 'github', issue: 101 });
    // the run of B, in B, because of the request, and over by now (every agent of B runs by itself)
    const other = b.runner.list().find((r) => r.issue.iid === 200);
    expect(other).toMatchObject({ squad: 'b', routedBy: 'request', repo: 'web', status: 'done' });
    expect(other?.stages.map((x) => x.stage)).toEqual(['triage', 'implement', 'security', 'ready']);
    expect(other?.links).toEqual([expect.objectContaining({ role: 'origin', run: id, issue: 'app#101', squad: 'a', kind: 'change', status: 'open', title: 'Expose the totals' })]);
    expect(b.thread(other as Run).some((m) => m.code === 'run.link.origin' && m.params.issue === 'app#101')).toBe(true);
    // the run that asked: linked the other way, resumed when the other ended, and then did its work
    const asker = b.runner.get(id) as Run;
    expect(asker.links).toEqual([expect.objectContaining({ role: 'requested', run: other?.id, issue: 'app#200', squad: 'b', kind: 'change', status: 'done' })]);
    expect(asker).toMatchObject({ status: 'done', wait: null });
    expect(asker.history.filter((h) => h.type === 'wait-started' || h.type === 'wait-done').map((h) => [h.type, h.detail])).toEqual([['wait-started', 'linked-done'], ['wait-done', 'linked-done']]);
    expect(b.thread(asker).find((m) => m.code === 'runner.request.linked')).toMatchObject({ params: { issue: 'app#200', run: other?.id, squad: 'Squad B' } });
    // the developer was told the request was made, and then that the other squad's work is done
    expect(b.engine.calls.filter((c) => c.agent.id === 'dev-a')).toHaveLength(2);
    const second = b.engine.calls.filter((c) => c.agent.id === 'dev-a')[1].prompt;
    expect(second).toContain('The other squad\'s work is done: app#200.');
    // the squads channel read: the request, the answer that said it would become an issue, and the line that links the runs
    const channel = b.forum.read(SQUADS_CHANNEL, 0, 50)?.messages ?? [];
    expect(channel.map((m) => [m.kind, m.code ?? 'text'])).toEqual([['request', 'text'], ['answer', 'runner.request.willIssue'], ['system', 'runner.request.linkedChannel']]);
    expect(channel[1]).toMatchObject({ params: { title: 'Expose the totals' }, text: 'The invoice endpoint must include the totals.' });
  });

  it('keeps the asker waiting on linked-done until the other run ends, and resumes it the moment it does', async () => {
    // B's developer waits for the person: the run of B stays active
    const { b, id } = await requested((c) => ((c.agents.team.find((a) => a.id === 'dev-b') as { autonomous: boolean }).autonomous = false));
    const other = b.runner.list().find((r) => r.issue.iid === 200) as Run;
    expect(other).toMatchObject({ status: 'to-start', stage: 'implement' });
    expect(b.runner.get(id)).toMatchObject({ status: 'waiting', stage: 'implement', wait: { kind: 'linked-done', by: 'dev-a' } });
    expect(b.engine.calls.filter((c) => c.agent.id === 'dev-a')).toHaveLength(1);
    // a tick does not move it: the other run is not over
    expect(await b.runner.tick()).toEqual([]);
    expect(b.runner.get(id)?.status).toBe('waiting');
    // the person starts and accepts the other run's stages: its end resumes the asker at once
    b.runner.startStage(other.id);
    await b.settle();
    b.runner.accept(other.id);
    await b.settle();
    expect(b.runner.get(other.id)?.status).toBe('done');
    expect(b.runner.get(id)).toMatchObject({ status: 'done' });
    expect(b.runner.get(id)?.links?.[0].status).toBe('done');
  });

  it('resumes the asker when the issue is closed, though the other run is not over', async () => {
    const { b, id } = await requested((c) => ((c.agents.team.find((a) => a.id === 'dev-b') as { autonomous: boolean }).autonomous = false));
    expect(b.runner.get(id)?.status).toBe('waiting');
    // the issue is closed on the tracker (by a person, say) while the run of B is still at its stage
    (b.issues.items.get(200) as { issue: { state: string } }).issue.state = 'closed';
    const moved = await b.runner.tick();
    await b.settle();
    expect(moved.map((r) => r.id)).toEqual([id]);
    expect(b.runner.get(id)).toMatchObject({ status: 'done' });
    expect(b.runner.get(id)?.links?.[0]).toMatchObject({ status: 'done', issue: 'app#200' });
    expect(b.runner.list().find((r) => r.issue.iid === 200)?.status).toBe('to-start');
  });

  it('waits for a "yes" when the liaison that took the request does not run by itself, and the run of the other squad starts only when the issue exists', async () => {
    const { b, id } = await requested((c) => ((c.squads ?? [])[1].autonomy = false));
    expect(forge.issues.size).toBe(0);
    const proposal = issueProposal();
    expect(proposal).toMatchObject({ state: 'pending', summary: 'Create the issue "Expose the totals" for the squad Squad B', command: { method: 'POST', endpoint: 'repos/group/project/issues' } });
    expect(proposal?.unit).toMatchObject({ runId: id, purpose: 'request-issue', key: 'req-1' });
    // the asker waits, with the link as proposed; no run of B exists
    expect(b.runner.get(id)).toMatchObject({ status: 'waiting', wait: { kind: 'linked-done' } });
    expect(b.runner.get(id)?.links).toEqual([expect.objectContaining({ role: 'requested', status: 'proposed', run: null, issue: null })]);
    expect(b.runner.list()).toHaveLength(1);
    expect(b.thread(id).some((m) => m.code === 'runner.request.proposed')).toBe(true);
    expect(await b.runner.tick()).toEqual([]);

    await actions.approveAction(proposal!.id);
    await b.settle();
    expect(forge.issues.get(200)).toMatchObject({ title: 'Expose the totals', labels: ['squad-b'] });
    const other = b.runner.list().find((r) => r.issue.iid === 200);
    expect(other).toMatchObject({ squad: 'b', routedBy: 'request', status: 'to-start' });
    expect(b.runner.get(id)?.links?.[0]).toMatchObject({ status: 'open', run: other?.id, issue: 'app#200' });
    expect(listAudit().find((a) => a.target === 'POST repos/group/project/issues')).toMatchObject({ ok: true });
  });

  it('is refused in a test workspace: no issue, no run of the other squad, and the asker goes on knowing it', async () => {
    const { b, id } = await requested(() => undefined, true);
    expect(forge.writes).toEqual([]);
    expect(b.runner.list()).toHaveLength(1);
    const asker = b.runner.get(id) as Run;
    expect(asker.status).toBe('done');
    expect(asker.links).toEqual([expect.objectContaining({ role: 'requested', status: 'refused', run: null })]);
    expect(b.thread(id).some((m) => m.code === 'runner.request.refused')).toBe(true);
    expect(b.engine.calls.filter((c) => c.agent.id === 'dev-a')[1].prompt).toContain('was not created');
  });

  it('a run that cannot start on the new issue (its squad has no repository here) refuses the link and the asker goes on', async () => {
    const { b, id } = await requested((c) => ((c.squads ?? [])[1].scope.repos = []));
    // the issue was made, but no run of B could be started for it
    expect(forge.issues.has(200)).toBe(true);
    expect(b.runner.list()).toHaveLength(1);
    expect(b.runner.get(id)).toMatchObject({ status: 'done' });
    expect(b.runner.get(id)?.links?.[0]).toMatchObject({ status: 'refused', run: null });
  });
});
