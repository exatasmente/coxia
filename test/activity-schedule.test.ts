// A schedule's firing in the activity tree (#250): its node names the schedule, a direct action shows done, failed, skipped or waiting for approval, a skipped firing is over,
// and the tree draws it under its own words.
import { beforeEach, describe, expect, it } from 'vitest';
import { mentionJob, runActive } from '../src/shared/activity';
import { setLanguage } from '../src/shared/i18n';
import { createActivityLog } from '../src/main/activity';
import { buildTree, hasWork, nodeTitle } from '../src/renderer/src/activityTreeModel';

beforeEach(() => setLanguage('en'));

describe('a schedule firing in the activity', () => {
  it('keeps the schedule on every line of its node and shows each outcome', () => {
    const log = createActivityLog();
    const done = log.begin('me', { jobId: mentionJob('agent-me'), node: { type: 'schedule', label: 'Start a run for 12', schedule: 's-1' } });
    done.status('started');
    done.status('finished');
    const failed = log.begin('me', { jobId: mentionJob('agent-me'), node: { type: 'schedule', label: 'Run the retro', schedule: 's-2' } });
    failed.status('started');
    failed.status('failed', 'The ceremony is off.');
    const skipped = log.begin('me', { jobId: mentionJob('agent-me'), node: { type: 'schedule', label: 'Start a run for 12', schedule: 's-3' } });
    skipped.status('skipped');
    const waiting = log.begin('me', { jobId: mentionJob('agent-me'), node: { type: 'schedule', label: 'Start a run for 12', schedule: 's-4' } });
    waiting.status('started');
    waiting.awaitingApproval();

    expect(log.get(done.id).every((e) => e.node?.schedule === 's-1' && e.node.type === 'schedule')).toBe(true);
    expect(log.get(skipped.id)[0]).toMatchObject({ state: 'skipped', label: 'Skipped: a missed time' });
    expect(log.get(waiting.id).at(-1)).toMatchObject({ state: 'waiting', label: 'Waiting for your approval in Actions' });
    expect(runActive(log.get(skipped.id), skipped.id)).toBe(false);
    expect(runActive(log.get(waiting.id), waiting.id)).toBe(true);

    const tree = buildTree([...log.get(done.id), ...log.get(failed.id), ...log.get(skipped.id), ...log.get(waiting.id)]);
    expect(tree.map((n) => [n.schedule, n.state])).toEqual([['s-1', 'finished'], ['s-2', 'failed'], ['s-3', 'skipped'], ['s-4', 'waiting']]);
    expect(hasWork(tree[2])).toBe(false);
    expect(hasWork(tree[3])).toBe(true);
    expect(nodeTitle(tree[0], () => 'Me')).toBe('Start a run for 12');
  });

  it('marks the call of the persona a schedule woke with the schedule', () => {
    const log = createActivityLog();
    const call = log.begin('me', { jobId: mentionJob('agent-me'), call: { agent: 'me', thread: 'agent-me', message: 3 }, node: { type: 'call', label: 'Summarise the board.', schedule: 's-1' } });
    call.status('started');
    expect(log.get(call.id)[0].node).toEqual({ type: 'call', label: 'Summarise the board.', schedule: 's-1' });
    expect(buildTree(log.get(call.id))[0].schedule).toBe('s-1');
  });
});
