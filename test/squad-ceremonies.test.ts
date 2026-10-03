// The ceremonies held for one squad (its runs and cards only) or for the whole workspace: which cards are a squad's, the cards of the day and the retro for
// one squad, and the minutes saying which. Data-level: the screen that picks the squad is the next phase.
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { newSquad } from '../src/shared/config/squads';
import { buildMinutes } from '../src/shared/minutes';
import { indexFile } from '../src/shared/minutesVersions';
import { flowOf, startRun } from '../src/shared/runs';
import { cardsOfSquad, refsOfSquad, squadsOfCard, type CardScopeContext } from '../src/shared/squadCards';
import type { Minutes, SavedCeremony } from '../src/shared/types';
import type { ReportItem } from '../src/main/report';
import { card, ceremony } from './helpers/ceremony';
import { startInput } from './helpers/runs';
import { withSquads } from './helpers/squads';

const reportMock = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../src/main/report', async (orig) => ({
  ...(await orig<typeof import('../src/main/report')>()),
  readReport: async () => ({ generated_at: '2026-10-02T09:00:00Z', items: reportMock.items }),
}));
const asked = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('../src/main/agents', async (orig) => ({
  ...(await orig<typeof import('../src/main/agents')>()),
  askAgent: async (_role: string, prompt: string) => {
    asked.prompts.push(prompt);
    return { data: { fala: 'Spoken.', numeros: [], funcionou: [], travou: [], retrabalho: [] }, sessionId: 's1', partial: false };
  },
}));

const issue = (iid: number, over: Partial<ReportItem> = {}): ReportItem => ({
  kind: 'issue', ref: `app#${iid}`, project: 'acme/app', iid, title: `Issue ${iid}`, stage: 'Doing', web_url: `https://git.example.test/acme/app/-/issues/${iid}`,
  blockers: [], pending: [], changes: [], manual_note: null, labels: [], milestone: null, updated_at: null, ...over,
});

const squads = [
  newSquad({ id: 'a', name: 'Squad A', scope: { repos: ['app'] }, label: 'squad-a', liaison: 'lead-a' }),
  newSquad({ id: 'b', name: 'Squad B', scope: { repos: ['web'], labels: ['mobile'] }, liaison: 'lead-b' }),
  newSquad({ id: 'rest', name: 'The rest', scope: { unclaimed: true } }),
];
const repos = [{ id: 'app', projectPath: 'acme/app' }, { id: 'web', projectPath: 'acme/web' }];
const run = (ref: string, squad: string | null, status = 'working', createdAt = '2026-10-02T09:00:00Z') => ({ issue: { ref }, squad, status, createdAt });
const ctx = (runs: CardScopeContext['runs'] = []): CardScopeContext => ({ runs, repos });
const c = (ref: string, over: { labels?: string[]; project?: string } = {}) => ({ ref, labels: over.labels ?? [], project: over.project ?? 'acme/app' });

describe('which cards are a squad\'s', () => {
  it('by the run that works the issue: the squad of the run, whatever the labels and the project say', () => {
    expect(squadsOfCard(c('app#1'), squads, ctx([run('app#1', 'b')]))).toEqual(['b']);
    // a run with no squad (or one the config lost) puts the card in none: it is not a squad's work
    expect(squadsOfCard(c('app#1'), squads, ctx([run('app#1', null)]))).toEqual([]);
    expect(squadsOfCard(c('app#1'), squads, ctx([run('app#1', 'gone')]))).toEqual([]);
    // the run that goes on wins over one that ended or was cancelled; among equals the newest
    expect(squadsOfCard(c('app#1'), squads, ctx([run('app#1', 'a', 'cancelled'), run('app#1', 'b', 'working')]))).toEqual(['b']);
    expect(squadsOfCard(c('app#1'), squads, ctx([run('app#1', 'a', 'done', '2026-10-01T09:00:00Z'), run('app#1', 'b', 'done', '2026-10-02T09:00:00Z')]))).toEqual(['b']);
  });

  it('with no run, by the labels of the scope and the label the squad puts on its issues, then by the project of a repository it owns, then by the squad that takes the rest', () => {
    expect(squadsOfCard(c('app#2', { labels: ['Mobile'], project: 'acme/app' }), squads, ctx())).toEqual(['a', 'b']);
    expect(squadsOfCard(c('app#3', { labels: ['squad-a'], project: 'acme/other' }), squads, ctx())).toEqual(['a']);
    expect(squadsOfCard(c('app#4', { project: 'acme/web' }), squads, ctx())).toEqual(['b']);
    expect(squadsOfCard(c('app#5', { project: 'acme/elsewhere' }), squads, ctx())).toEqual(['rest']);
    expect(squadsOfCard(c('app#6', { project: 'acme/elsewhere' }), squads.slice(0, 2), ctx())).toEqual([]);
  });

  it('picks the cards of one squad, in the order they came, and the refs its runs work', () => {
    const cards = [c('app#1'), c('app#2', { project: 'acme/web' }), c('app#3', { project: 'acme/elsewhere' }), c('app#4')];
    const runs = [run('app#4', 'b')];
    expect(cardsOfSquad(cards, squads, 'a', ctx(runs)).map((x) => x.ref)).toEqual(['app#1']);
    expect(cardsOfSquad(cards, squads, 'b', ctx(runs)).map((x) => x.ref)).toEqual(['app#2', 'app#4']);
    expect(cardsOfSquad(cards, squads, 'rest', ctx(runs)).map((x) => x.ref)).toEqual(['app#3']);
    expect([...refsOfSquad('b', ctx(runs))]).toEqual(['app#4']);
  });
});

describe('the cards of the day for a squad', () => {
  let loadCards: typeof import('../src/main/cards').loadCards;
  let runStore: typeof import('../src/main/runs').runStore;

  beforeAll(async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    const config = withSquads(neutralConfig(), (x) => {
      x.projects.repos = [
        { id: 'app', path: '/tmp/squad-cards/app', remoteUrl: null, vcsId: null, projectPath: 'acme/app' },
        { id: 'web', path: '/tmp/squad-cards/web', remoteUrl: null, vcsId: null, projectPath: 'acme/web' },
      ];
      x.squads = squads;
    });
    saveConfig(config);
    ({ loadCards } = await import('../src/main/cards'));
    ({ runStore } = await import('../src/main/runs'));
    const flow = flowOf(config);
    // a run of squad B works the issue 3 of the project of A
    runStore().create(startRun(startInput({ id: 'r-abc-b001', issue: { ref: 'app#3', iid: 3, title: 'Issue 3', url: null }, squad: { id: 'b', name: 'Squad B', rule: 'repo' } }), flow, '2026-10-02T09:00:00Z').run);
  });

  it('are only the squad\'s: its runs\' issues and what its scope claims; without a squad, every card', async () => {
    reportMock.items = [issue(1), issue(2, { project: 'acme/web' }), issue(3), issue(4, { labels: ['mobile'] })];
    expect((await loadCards(10)).cards.map((x) => x.iid).sort()).toEqual(['1', '2', '3', '4']);
    expect((await loadCards(10, false, 'a')).cards.map((x) => x.iid).sort()).toEqual(['1', '4']);
    expect((await loadCards(10, false, 'b')).cards.map((x) => x.iid).sort()).toEqual(['2', '3', '4']);
    expect((await loadCards(10, false, null)).total).toBe(4);
  });

  it('counts only the squad\'s cards in the total and the rest, and refuses a squad the workspace does not have', async () => {
    reportMock.items = [issue(1), issue(5), issue(6), issue(2, { project: 'acme/web' })];
    const r = await loadCards(2, false, 'a');
    expect(r.total).toBe(3);
    expect(r.cards).toHaveLength(2);
    expect(r.rest).toHaveLength(1);
    await expect(loadCards(10, false, 'ghost')).rejects.toThrow('ghost');
  });
});

describe('the minutes of a ceremony for a squad', () => {
  let ATAS: string;
  let saver: typeof import('../src/main/store');
  let state: typeof import('../src/main/state');
  const DAY = '2026-10-02';
  const minutes = (over: Partial<Minutes> = {}): Minutes => ({ startedAt: new Date(`${DAY}T09:40:00`).toISOString(), endedAt: new Date(`${DAY}T09:50:00`).toISOString(), decisions: [], effects: [], unanswered: [], transcript: [], ...over });

  beforeAll(async () => {
    ATAS = (await import('../src/main/env')).ATAS;
    saver = await import('../src/main/store');
    state = await import('../src/main/state');
  });
  beforeEach(() => {
    for (const name of readdirSync(ATAS)) if (name !== 'config.json' && name !== 'secrets.json') rmSync(join(ATAS, name), { recursive: true, force: true });
  });

  it('carries the squad from the ceremony, and says nothing for the whole workspace', () => {
    const base = ceremony({ id: '2026-10-02T094000', cards: [card('app#1')] });
    expect(buildMinutes({ ...base, squad: 'a' }).squad).toBe('a');
    expect('squad' in buildMinutes(base)).toBe(false);
    expect('squad' in buildMinutes({ ...base, squad: null })).toBe(false);
  });

  it('writes which squad the ceremony was held for, or the whole workspace, in the document and in the index of the day', async () => {
    const one = await saver.saveMinutes(minutes({ squad: 'a' }), '', [], '2026-10-02T094000');
    const two = await saver.saveMinutes(minutes({ startedAt: new Date(`${DAY}T14:10:00`).toISOString(), endedAt: new Date(`${DAY}T14:20:00`).toISOString() }), '', [], '2026-10-02T141000');
    const body = (path: string) => readFileSync(path, 'utf8');
    expect(body(one.ataPath)).toMatch(/Scope: squad Squad A|Escopo: squad Squad A/);
    expect(body(two.ataPath)).toMatch(/Scope: the whole workspace|Escopo: o workspace inteiro/);
    expect(body(one.ataPath)).not.toMatch(/whole workspace|workspace inteiro/);
    const index = JSON.parse(readFileSync(join(ATAS, indexFile(DAY)), 'utf8')) as { versions: { n: number; squad?: string }[] };
    expect(index.versions.map((v) => [v.n, v.squad ?? null])).toEqual([[1, 'a'], [2, null]]);
  });

  it('a workspace with no squads writes its minutes as it always did', async () => {
    const { saveConfig } = await import('../src/main/workspaceConfig');
    saveConfig(neutralConfig());
    const saved = await saver.saveMinutes(minutes(), '', [], '2026-10-02T094000');
    expect(readFileSync(saved.ataPath, 'utf8')).not.toMatch(/squad|whole workspace|workspace inteiro/i);
    // and the squad is restored for the tests below
    const { saveConfig: save } = await import('../src/main/workspaceConfig');
    save(withSquads(neutralConfig()));
  });

  it('lists the ceremonies with the squad they were held for', () => {
    state.saveState({ ...ceremony({ id: '2026-10-02T094000', cards: [card('app#1')] }), squad: 'a' } as SavedCeremony);
    state.saveState(ceremony({ id: '2026-10-02T141000', cards: [card('app#2')] }));
    const entries = state.listHistory();
    expect(entries.find((e) => e.id === '2026-10-02T094000')).toMatchObject({ squad: 'a' });
    expect('squad' in (entries.find((e) => e.id === '2026-10-02T141000') as object)).toBe(false);
  });
});

describe('the retro for a squad', () => {
  let prepareRetro: typeof import('../src/main/retro').prepareRetro;
  let latestRetro: typeof import('../src/main/retro').latestRetro;
  let state: typeof import('../src/main/state');
  let ATAS: string;

  beforeAll(async () => {
    ({ prepareRetro, latestRetro } = await import('../src/main/retro'));
    state = await import('../src/main/state');
    ATAS = (await import('../src/main/env')).ATAS;
    const { saveConfig } = await import('../src/main/workspaceConfig');
    saveConfig(withSquads(neutralConfig()));
  });

  const today = new Date().toLocaleDateString('sv-SE');
  const at = (hhmmss: string) => `${today}T${hhmmss}`;

  it('looks only at the ceremonies held for the squad, is kept apart from the retro of the day, and says which squad it is for', async () => {
    rmSync(join(ATAS, 'retros'), { recursive: true, force: true });
    const held = (id: string, ref: string, squad: string | null) => state.saveState({ ...ceremony({ id, startedAt: Date.now() - 60_000, cards: [card(ref)], decisions: [{ ref, text: `Decision about ${ref}`, dest: 'ata', target: 'ata' } as never] }), ...(squad ? { squad } : {}) });
    held(at('090000'), 'app#1', 'a');
    held(at('100000'), 'app#2', 'b');
    held(at('110000'), 'app#3', null);
    asked.prompts.length = 0;

    const forA = await prepareRetro('a');
    expect(forA).toMatchObject({ id: `${today}-a`, squad: 'a' });
    expect(asked.prompts[0]).toContain('Decision about app#1');
    expect(asked.prompts[0]).not.toContain('Decision about app#2');
    expect(asked.prompts[0]).not.toContain('Decision about app#3');
    expect(asked.prompts[0]).toContain('Squad A');

    // the whole workspace's retro of the same day does not take its place, and looks at everything
    const whole = await prepareRetro();
    expect(whole.id).toBe(today);
    expect('squad' in whole).toBe(false);
    for (const ref of ['app#1', 'app#2', 'app#3']) expect(asked.prompts[1]).toContain(`Decision about ${ref}`);
    expect(existsSync(join(ATAS, 'retros', `${today}-a.json`))).toBe(true);
    expect(existsSync(join(ATAS, 'retros', `${today}.json`))).toBe(true);
    expect(latestRetro('a')?.id).toBe(`${today}-a`);
    expect(latestRetro()?.id).toBe(today);
    expect(latestRetro('b')).toBeNull();
    await expect(prepareRetro('ghost')).rejects.toThrow('ghost');
  });
});
