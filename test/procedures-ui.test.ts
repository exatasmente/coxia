// The Procedures view as a static render shows it: the summary, a line of the list, one record in full and the comparison of what it cost to find with what it cost to use.
// Opening, filtering and the controls in motion are for the manual plan; the filters and the sort are pure and tested in procedures-channels.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import { statsOf, summarize } from '../src/shared/proceduresView';
import { bottomNavActive } from '../src/renderer/src/dashboard';
import type { ProcedureRecord } from '../src/shared/procedures';
import type { StageUsage } from '../src/shared/runs/types';
import { procedureRecord } from './helpers/procedures';

// src/renderer/src/api.ts reads window.api when it loads, and the view asks document whether it runs in a paired browser; the node environment has neither.
const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: () => new Promise(() => undefined), onEvent: () => () => undefined } };
  (globalThis as unknown as { document: unknown }).document = { documentElement };
  return { documentElement };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The team's names come from the config the runs screens share; it is read through a store that a static render cannot subscribe to.
vi.mock('../src/renderer/src/screens/cycle/runsApi', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/screens/cycle/runsApi')>()), useRunConfig: () => null }));
const { RecordBody, Comparison } = await import('../src/renderer/src/screens/procedures/RecordBody');
const { Row, Summary, ProceduresScreen } = await import('../src/renderer/src/screens/procedures/ProceduresScreen');

afterEach(() => {
  setLanguage('pt-BR');
  dom.documentElement.dataset.platform = '';
});

// A static render writes an apostrophe as an entity.
const esc = (text: string): string => text.replace(/'/g, '&#x27;');

const NOW = Date.parse('2026-10-09T12:00:00Z');
const usage = (tokens: number, over: Partial<StageUsage> = {}): StageUsage => ({ promptTokens: tokens - 100, completionTokens: 100, cachedTokens: 0, calls: 4, costUsd: null, ...over });
const used = (r: ProcedureRecord, tokens: number[], baseline = 10_000): ProcedureRecord => ({
  ...r,
  stats: { ...r.stats, uses: tokens.length, baseline: usage(baseline), recent: tokens.map((n) => ({ at: '2026-10-08T10:00:00.000Z', ref: 'app#1', failed: false, usage: usage(n) })) },
});

const body = (r: ProcedureRecord): string => renderToStaticMarkup(createElement(RecordBody, { record: r, team: undefined, now: NOW }));

describe('a record in full', () => {
  const record = procedureRecord({
    title: 'Run the end-to-end tests',
    steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite', run: 'npm run test:e2e', edited: true }],
    pitfalls: ['Do not run it twice'],
    waits: ['About 30 s after the stack is up'],
    reviewed: false,
  });

  it('shows the steps with their commands, the pitfalls and the waits, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = body(record);
      for (const text of ['Start the stack', 'npm run stack:up', 'npm run test:e2e', 'Do not run it twice', 'About 30 s after the stack is up']) expect(html).toContain(text);
      expect(html).toContain(CATALOGS[language]['ui.procedures.panel.steps']);
      expect(html).toContain(CATALOGS[language]['ui.procedures.panel.stepEdited']);
    }
  });

  it('says who wrote it and with what reach, and that the person has not reviewed it', () => {
    setLanguage('en');
    const html = body(record);
    expect(html).toContain('Revision 1, written by writer in a stage on');
    expect(html).toContain(t('ui.team.permission.worktree'));
    expect(html).toContain(t('ui.procedures.panel.unreviewed'));
    expect(body({ ...record, reviewed: true })).toContain(t('ui.procedures.panel.reviewed'));
  });

  it('says why a record is failing, old, or left out of the agents list, and that "ok" only means no failure was reported', () => {
    setLanguage('en');
    const failing = body({ ...record, state: 'failing', lastFailed: { at: '2026-10-08T10:00:00.000Z', step: 2 }, stats: { ...record.stats, failuresSinceSave: 2 } });
    expect(failing).toContain(t('ui.procedures.state.failing'));
    expect(failing).toContain('step 2');
    expect(failing).toContain(esc(t('ui.procedures.panel.withheld')));
    const old = body({ ...record, state: 'ok', lastVerified: '2026-01-01T10:00:00.000Z' });
    expect(old).toContain(t('ui.procedures.panel.old'));
    expect(old).toContain('no failure reported');
    expect(old).toContain('nobody tested the steps');
  });

  it('shows the version before this one', () => {
    setLanguage('en');
    const html = body({ ...record, previous: { title: 'Run the tests', steps: [{ text: 'The old first step' }], pitfalls: [], waits: [] } });
    expect(html).toContain(t('ui.procedures.panel.previous'));
    expect(html).toContain('The old first step');
    expect(body(record)).not.toContain(t('ui.procedures.panel.previous'));
  });

  it('names a gui record whose steps are the app recording and whose site the browser visited', () => {
    setLanguage('en');
    const gui = body({ ...record, kind: 'gui', key: 'docs.example.com', keyedBy: 'app', stepsFrom: 'recording' });
    expect(gui).toContain(esc(t('ui.procedures.panel.keyedByApp')));
    expect(gui).toContain(esc(t('ui.procedures.panel.stepsRecording')));
  });

  it('draws no control for changing it: the body is read only', () => {
    expect(body(record)).not.toContain('<button');
  });
});

describe('the comparison', () => {
  const base = procedureRecord();
  const cmp = (r: ProcedureRecord): string => renderToStaticMarkup(createElement(Comparison, { record: r }));

  it('says not used yet, and not enough uses with fewer than 3', () => {
    setLanguage('en');
    expect(cmp(base)).toContain(t('ui.procedures.panel.usage.none'));
    const two = cmp(used(base, [4_000, 4_000]));
    expect(two).toContain('Not enough uses to compare: 2 counted, at least 3 are needed.');
    expect(two).not.toContain('tokens saved');
  });

  it('shows the baseline, the average, the share with no failure and the saving, labelled approximate', () => {
    setLanguage('en');
    const html = cmp(used(base, [4_000, 5_000, 6_000]));
    expect(html).toContain('Finding it cost: 4 model calls · 9,900 tokens in');
    expect(html).toContain('A use costs on average: 4 model calls · 4,900 tokens in');
    expect(html).toContain('3 uses, 100% with no failure reported.');
    expect(html).toContain('About 15,000 tokens saved');
    expect(html).toContain(t('ui.procedures.panel.usage.approximate'));
  });

  it('shows no saving when the uses cost as much as finding it did', () => {
    setLanguage('en');
    const html = cmp(used(base, [10_000, 10_000, 10_000]));
    expect(html).toContain(t('ui.procedures.panel.usage.noSaving'));
    expect(html).not.toContain('tokens saved');
  });

  it('shows a cost only where one was reported, and as an estimate where the usage says so', () => {
    setLanguage('en');
    const priced = (estimated: boolean): ProcedureRecord => {
      const r = used(base, [4_000, 4_000, 4_000]);
      return {
        ...r,
        stats: { ...r.stats, baseline: usage(10_000, { costUsd: 0.5, ...(estimated ? { costEstimated: true } : {}) }), recent: r.stats.recent.map((e) => ({ ...e, usage: usage(4_000, { costUsd: 0.1 }) })) },
      };
    };
    expect(cmp(priced(false))).toContain('reported by the provider');
    expect(cmp(priced(true))).toContain('estimated');
    expect(cmp(used(base, [4_000, 4_000, 4_000]))).not.toContain('about $');
  });

  it('says what finding it cost is not known while the creating call has not finished', () => {
    setLanguage('en');
    const r = used(base, [4_000]);
    expect(cmp({ ...r, stats: { ...r.stats, baseline: null } })).toContain(t('ui.procedures.panel.usage.noBaseline'));
  });
});

describe('the list', () => {
  const line = (r: ProcedureRecord, open = false): string =>
    renderToStaticMarkup(createElement(Row, { p: summarize(r, NOW), who: 'writer', open, onToggle: () => undefined }));

  it('shows the title, what it is for, who wrote it, and what the person should know first', () => {
    setLanguage('en');
    const html = line({ ...procedureRecord({ title: 'Rebase a branch', kind: 'tool', key: 'git' }), lastVerified: '2026-01-01T10:00:00.000Z', state: 'ok' });
    expect(html).toContain('Rebase a branch');
    expect(html).toContain('Tool · git · Written by writer · 0 uses');
    expect(html).toContain(t('ui.procedures.badge.notReviewed'));
    expect(html).toContain(t('ui.procedures.badge.old'));
    expect(html).toContain('aria-expanded="false"');
    expect(line(procedureRecord({ reviewed: true }))).not.toContain(t('ui.procedures.badge.notReviewed'));
  });

  it('marks a record the agents list leaves out', () => {
    setLanguage('en');
    const r = procedureRecord();
    expect(line({ ...r, state: 'failing', stats: { ...r.stats, failuresSinceSave: 2 } })).toContain(esc(t('ui.procedures.badge.withheld')));
  });
});

describe('a record that waits for the review', () => {
  const held = (over: Partial<ProcedureRecord> = {}): ProcedureRecord => {
    const r = procedureRecord();
    return { ...r, origin: { ...r.origin, handoff: true }, ...over };
  };

  it('says in both languages, in the list and in the record, that the person used the screen and no agent reads it until it is reviewed', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const row = renderToStaticMarkup(createElement(Row, { p: summarize(held(), NOW), who: 'writer', open: false, onToggle: () => undefined }));
      expect(row).toContain(CATALOGS[language]['ui.procedures.badge.awaitsReview']);
      expect(esc(body(held()))).toContain(esc(CATALOGS[language]['ui.procedures.panel.awaitsReview']));
      expect(body(held())).not.toContain(CATALOGS[language]['ui.procedures.panel.unreviewed']);
    }
  });

  it('shows the ordinary notice once the person has reviewed it, and for a record no hand-off touched', () => {
    setLanguage('en');
    expect(summarize(held(), NOW).awaitsReview).toBe(true);
    expect(summarize(held({ reviewed: true }), NOW).awaitsReview).toBe(false);
    expect(summarize(procedureRecord(), NOW).awaitsReview).toBe(false);
    expect(body(held({ reviewed: true }))).toContain(t('ui.procedures.panel.reviewed'));
    expect(body(procedureRecord())).toContain(esc(t('ui.procedures.panel.unreviewed')));
  });
});

describe('the summary', () => {
  const sum = (records: ProcedureRecord[]): string => renderToStaticMarkup(createElement(Summary, { stats: statsOf(records, true, NOW) }));

  it('counts the records and says there is no saving to show yet', () => {
    setLanguage('en');
    const html = sum([procedureRecord(), procedureRecord({ reviewed: true })]);
    expect(html).toContain('Kept: 2');
    expect(html).toContain('Not reviewed: 1');
    expect(html).toContain(t('ui.procedures.summary.noSaving'));
  });

  it('adds up the savings with the label that they are approximate', () => {
    setLanguage('en');
    const html = sum([used(procedureRecord(), [4_000, 5_000, 6_000]), used(procedureRecord(), [4_000, 5_000, 6_000])]);
    expect(html).toContain('About 30,000 tokens saved in 2 procedures with enough uses. Approximate');
  });
});

describe('the screen', () => {
  it('is reached from the More sheet, so the bottom bar keeps More lit while it is open', () => {
    expect(bottomNavActive('procedures')).toBe('more');
  });

  it('starts with a spinner and no list, and says it reads only in a paired browser', () => {
    setLanguage('en');
    const desktop = renderToStaticMarkup(createElement(ProceduresScreen, { go: () => undefined }));
    expect(desktop).toContain(t('ui.procedures.title'));
    expect(desktop).toContain('aria-label="Loading the procedures"');
    expect(desktop).not.toContain(t('ui.procedures.leadWeb'));
    dom.documentElement.dataset.platform = 'web';
    expect(renderToStaticMarkup(createElement(ProceduresScreen, { go: () => undefined }))).toContain(t('ui.procedures.leadWeb'));
  });

  it('has every key of the view in both catalogs with the same placeholders', () => {
    const keys = Object.keys(CATALOGS.en).filter((k) => k.startsWith('ui.procedures.'));
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) {
      expect(CATALOGS['pt-BR'][k], k).toBeTruthy();
      const holes = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes(CATALOGS['pt-BR'][k]), k).toEqual(holes(CATALOGS.en[k]));
    }
  });
});
