import { beforeAll, describe, expect, it } from 'vitest';
import type { Card } from '../src/shared/types';
import { installLegacyConfig } from './helpers/config';

// The watchers and the card loader read the stage vocabulary from the cycle instead of from regexes.

let watchers: typeof import('../src/main/watchers');
let cards: typeof import('../src/main/cards');
let core: typeof import('../src/main/cycle-core');

const card = (stage: string | null, over: Partial<Card> = {}): Card => ({ ref: 'web#1', iid: '1', title: 'T', stage, spec: null, mrs: [], mrPaths: [], blockers: [], pending: [], changes: [], note: null, url: '', ...over });
const change = (at: string, to: string) => ({ at, ref: 'web#1', type: 'change', field: 'stage', from: null, to });

beforeAll(async () => {
  await installLegacyConfig();
  watchers = await import('../src/main/watchers');
  cards = await import('../src/main/cards');
  core = await import('../src/main/cycle-core');
});

describe('two rejections at the same point (the migrated profile)', () => {
  it('alerts when a card comes back from QA the second time, counting the stage it shows now even if the history has not seen it', () => {
    const history = [change('2026-09-01T10:00:00Z', 'Test Fail'), change('2026-09-02T10:00:00Z', 'Ready To Test')];
    const alerts = watchers.rejectionAlerts([card('Test Fail')], history);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: 'rejections', message: '#1 reprovada 2 vezes no QA' });
  });

  it('counts a scoped label as the same stage, and does not alert at the first return', () => {
    expect(watchers.rejectionAlerts([card('STAGE:: Test Fail')], [change('2026-09-01T10:00:00Z', 'STAGE:: Test Fail')])).toHaveLength(0);
    expect(watchers.rejectionAlerts([card('STAGE:: Test Fail')], [change('2026-09-01T10:00:00Z', 'STAGE:: Test Fail'), change('2026-09-02T10:00:00Z', 'Doing')])).toHaveLength(1);
  });

  it('does not alert once the card has passed QA, and does not count a rejection in review as a return from QA', () => {
    const twice = [change('2026-09-01T10:00:00Z', 'Test Fail'), change('2026-09-02T10:00:00Z', 'Test Fail')];
    expect(watchers.rejectionAlerts([card('Test OK')], twice)).toHaveLength(0);
    const rejected = [change('2026-09-01T10:00:00Z', 'Rejected'), change('2026-09-02T10:00:00Z', 'Rejected')];
    expect(watchers.rejectionAlerts([card('Doing')], rejected)).toHaveLength(0);
  });

  it('alerts again for a different card and a different count, with a stable id', () => {
    const history = [change('2026-09-01T10:00:00Z', 'Test Fail'), change('2026-09-02T10:00:00Z', 'Doing'), change('2026-09-03T10:00:00Z', 'Test Fail')];
    expect(watchers.rejectionAlerts([card('Test Fail')], history)[0].id).toBe('rej:web#1:qa:2');
  });
});

describe('a card in a blocked stage', () => {
  it('is blocked even when the source reports no reason, in a cycle that has such a stage', async () => {
    core.applyCycleTemplate('kanban');
    const { cycle } = await import('../src/main/cyclePrompts');
    expect(cycle().stages.map((s) => s.kind)).toContain('blocked');
    expect(cards.withStageBlocker('Blocked', [])).toHaveLength(1);
    expect(cards.withStageBlocker('Blocked', [])[0]).toContain('Blocked');
    expect(cards.withStageBlocker('Blocked', ['MR com conflitos'])).toEqual(['MR com conflitos']);
    expect(cards.withStageBlocker('In Progress', [])).toEqual([]);
    expect(cards.withStageBlocker(null, [])).toEqual([]);
  });

  it('is not something the migrated profile knows: it has no such stage', async () => {
    await installLegacyConfig();
    expect(cards.withStageBlocker('Blocked', [])).toEqual([]);
  });
});
