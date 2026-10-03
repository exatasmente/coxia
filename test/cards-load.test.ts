import { beforeAll, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { ReportItem } from '../src/main/report';

const reportMock = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/main/report', async (orig) => ({
  ...(await orig<typeof import('../src/main/report')>()),
  readReport: async () => ({ generated_at: '2026-10-02T09:00:00Z', items: reportMock.items }),
}));

const issue = (iid: number, over: Partial<ReportItem> = {}): ReportItem => ({
  kind: 'issue', ref: `app#${iid}`, project: 'acme/app', iid, title: `Issue ${iid}`, stage: 'Doing', web_url: `https://git.example.test/acme/app/-/issues/${iid}`,
  blockers: [], pending: [], changes: [], manual_note: null, labels: [], milestone: null, updated_at: null, ...over,
});

let loadCards: typeof import('../src/main/cards').loadCards;
let prompts: typeof import('../src/main/cyclePrompts');

beforeAll(async () => {
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const config = neutralConfig();
  config.devCycle.priority.labels = ['^P0$', '^P1$'];
  saveConfig(config);
  ({ loadCards } = await import('../src/main/cards'));
  prompts = await import('../src/main/cyclePrompts');
});

describe('loadCards', () => {
  it('carries what the tracker says about each issue and derives its priority from the configured labels', async () => {
    reportMock.items = [issue(1, { labels: ['bug', 'P1'], milestone: 'v1.2', updated_at: '2026-10-01T09:00:00Z' }), issue(2, { labels: ['bug'] })];
    const { cards } = await loadCards(10);
    const one = cards.find((c) => c.ref === 'app#1');
    expect(one).toMatchObject({ labels: ['bug', 'P1'], milestone: 'v1.2', updatedAt: '2026-10-01T09:00:00Z', project: 'acme/app', priority: { rank: 1, label: 'P1' } });
    expect(cards.find((c) => c.ref === 'app#2')).toMatchObject({ labels: ['bug'], milestone: null, updatedAt: null, priority: null });
  });

  it('is fine with a card source that reports none of it', async () => {
    const bare = issue(3);
    delete bare.labels;
    delete bare.milestone;
    delete bare.updated_at;
    reportMock.items = [bare];
    expect((await loadCards(10)).cards[0]).toMatchObject({ labels: [], milestone: null, updatedAt: null, priority: null });
  });
});


describe('the order of the cards', () => {
  it('is blocked first, then priority, then the most recently updated, and the ref breaks no tie', async () => {
    reportMock.items = [
      issue(10, { updated_at: '2026-10-01T09:00:00Z' }),
      issue(9, { labels: ['P1'], updated_at: '2026-09-01T09:00:00Z' }),
      issue(8, { blockers: ['waiting for the API'], updated_at: '2026-08-01T09:00:00Z' }),
      issue(7, { labels: ['P0'], updated_at: '2026-09-01T09:00:00Z' }),
      issue(6, { updated_at: '2026-10-02T09:00:00Z' }),
      issue(5),
      issue(4),
    ];
    const { cards } = await loadCards(10);
    expect(cards.map((c) => c.iid)).toEqual(['8', '7', '9', '6', '10', '5', '4']);
  });
});

describe('the cards past the limit', () => {
  const many = () => {
    reportMock.items = [issue(1, { labels: ['P1'] }), issue(2, { blockers: ['x'] }), issue(3, { labels: ['P0'] }), issue(4), issue(5)];
  };

  it('are not dropped: the call gets the first ones, the total and the rest in the same order', async () => {
    many();
    const r = await loadCards(2);
    expect(r.cards.map((c) => c.iid)).toEqual(['2', '3']);
    expect(r.rest?.map((c) => c.iid)).toEqual(['1', '4', '5']);
    expect(r.total).toBe(5);
  });

  it('leave no rest when everything fits', async () => {
    many();
    const r = await loadCards(5);
    expect(r.rest).toBeUndefined();
    expect(r.cards).toHaveLength(5);
    expect(r.total).toBe(5);
  });
});

describe('what the turn agent reads', () => {
  const load = async (over: Partial<ReportItem>) => {
    reportMock.items = [issue(7, over)];
    return (await loadCards(10)).cards[0];
  };

  it('has the priority and the milestone in the card and a line that tells it when to mention them', async () => {
    const card = await load({ labels: ['P0'], milestone: 'v2.0' });
    expect(prompts.cardContext(card)).toContain('"milestone":"v2.0"');
    expect(prompts.cardContext(card)).toContain('"priority":{"rank":0,"label":"P0"}');
    expect(prompts.priorityLine(card)).toBe('No tracker, esta atividade tem prioridade "P0" e marco "v2.0". Cite isso na fala só se mudar o que importa agora (o próximo passo ou o bloqueio); não repita o que não mudou.');
  });

  it('never tells the agent which merge requests conflict', async () => {
    reportMock.items = [issue(7), { ...issue(70), kind: 'mr', ref: 'app!70', issue_refs: ['7'], has_conflicts: true, blockers: ['Conflicts with the target branch'] } as ReportItem];
    const card = (await loadCards(10)).cards.find((c) => c.ref === 'app#7')!;
    expect(card.mrConflicts).toEqual(['app!70']);
    expect(prompts.cardContext(card)).not.toContain('mrConflicts');
  });

  it('says nothing about a card with neither, so its prompt is the one it always was', async () => {
    const card = await load({ labels: ['bug'] });
    expect(prompts.cardContext(card)).not.toMatch(/priority|milestone/);
    expect(prompts.priorityLine(card)).toBe('');
  });

  it('names only the milestone when there is no priority, and respects the fields the cycle shares', async () => {
    const card = await load({ milestone: 'v2.0' });
    expect(prompts.priorityLine(card)).toContain('marco "v2.0"');
    expect(prompts.priorityLine(card)).not.toContain('prioridade');
    const { updateConfig } = await import('../src/main/workspaceConfig');
    updateConfig((c) => {
      c.devCycle.enrichment.cardFields = ['ref', 'title'];
      return c;
    });
    expect(prompts.cardContext(await load({ labels: ['P0'], milestone: 'v2.0' }))).not.toMatch(/priority|milestone/);
    expect(prompts.priorityLine(await load({ labels: ['P0'], milestone: 'v2.0' }))).toBe('');
  });
});
