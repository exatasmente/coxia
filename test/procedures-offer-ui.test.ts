// The card that offers to keep a procedure (#187) as a static render, in both languages, and what it does with the app's answers. Clicking is for the manual plan; the
// answers are pure functions of the model and are tested here with a fake channel, so no window, host or model is reached.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { OfferView } from '../src/shared/proceduresView';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has none.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: () => new Promise(() => undefined), onEvent: () => () => undefined } };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { OfferCard, OfferCards } = await import('../src/renderer/src/screens/cycle/OfferCards');
const { OFFER_REFRESH_MS, declineOffer, keepOffer, offersHere, readOffers } = await import('../src/renderer/src/screens/procedures/offerModel');

afterEach(() => setLanguage('pt-BR'));

const offer = (over: Partial<OfferView> = {}): OfferView => ({
  offerId: 'o-00000001',
  thread: 'app#123',
  agent: 'developer',
  kind: 'repo',
  key: 'api',
  title: 'Run the tests',
  steps: [{ text: 'Install the packages', run: 'npm ci' }, { text: 'Run the suite', run: 'npm test' }],
  pitfalls: ['The suite needs the packages first'],
  waits: ['About 30 s after the packages'],
  leftOut: 0,
  handoff: false,
  stepsFrom: 'recording',
  screen: false,
  at: '2026-10-09T10:00:00.000Z',
  expiresAt: '2026-10-10T10:00:00.000Z',
  ...over,
});
const never = async () => ({ ok: true }) as const;
const card = (o: OfferView): string => renderToStaticMarkup(createElement(OfferCard, { offer: o, team: undefined, onKeep: never, onDecline: never }));
// A static render writes an apostrophe as an entity.
const esc = (text: string): string => text.replace(/'/g, '&#x27;');

describe('the card of an offer', () => {
  it('shows the question, the title to edit, the steps with their commands, the pitfalls, the waits and Yes and No, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = card(offer());
      for (const key of ['ui.procedures.offer.title', 'ui.procedures.offer.titleField', 'ui.procedures.offer.yes', 'ui.procedures.offer.no', 'ui.procedures.offer.expires', 'ui.procedures.panel.steps', 'ui.procedures.panel.pitfalls', 'ui.procedures.panel.waits']) {
        expect(html, key).toContain(esc(CATALOGS[language][key]));
      }
      for (const text of ['Run the tests', 'Install the packages', 'npm ci', 'npm test', 'The suite needs the packages first', 'About 30 s after the packages']) expect(html).toContain(text);
      expect(html).toContain(t('ui.procedures.kind.repo'));
      expect(html).toContain('api');
      expect(html).not.toContain(esc(CATALOGS[language]['ui.procedures.offer.gone']));
    }
  });

  it('says how many commands were left out only when some were, and warns after a hand-off only then', () => {
    expect(card(offer())).not.toContain(t('ui.procedures.offer.leftOut', { count: 0 }));
    expect(card(offer())).not.toContain(esc(t('ui.procedures.offer.handoff')));
    const html = card(offer({ leftOut: 3, handoff: true }));
    expect(html).toContain(esc(t('ui.procedures.offer.leftOut', { count: 3 })));
    expect(html).toContain(esc(t('ui.procedures.offer.handoff')));
  });

  it('leaves out the pitfalls and waits blocks when the draft has none, and draws a screen draft with no commands', () => {
    const html = card(offer({ kind: 'gui', key: 'example.com', pitfalls: [], waits: [], screen: true, steps: [{ text: 'Open the page' }, { text: 'Press "Close"' }] }));
    expect(html).not.toContain(t('ui.procedures.panel.pitfalls'));
    expect(html).not.toContain(t('ui.procedures.panel.waits'));
    expect(html).not.toContain('<code');
    expect(html).toContain('example.com');
  });

  it('has every offer string in both catalogs', () => {
    for (const key of Object.keys(CATALOGS.en).filter((k) => k.startsWith('ui.procedures.offer.'))) expect(CATALOGS['pt-BR'][key], key).toBeTruthy();
    for (const key of Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('ui.procedures.offer.'))) expect(CATALOGS.en[key], key).toBeTruthy();
  });

  it('draws nothing before it has read the offers', () => {
    expect(renderToStaticMarkup(createElement(OfferCards, { thread: 'app#123', team: undefined }))).toBe('');
  });
});

describe('what the card does with the answers', () => {
  it('reads the offers, and none when the app refuses the call or answers with something else', async () => {
    expect(await readOffers(async () => [offer()])).toHaveLength(1);
    expect(await readOffers(async () => Promise.reject(new Error('Not available in the browser')))).toEqual([]);
    expect(await readOffers(async () => undefined as unknown as OfferView[])).toEqual([]);
  });

  it('does not call the channel at all in a paired browser', async () => {
    const dataset = (document.documentElement as unknown as { dataset: Record<string, string> }).dataset;
    const read = vi.fn(async () => [offer()]);
    dataset.platform = 'web';
    try {
      expect(offersHere()).toBe(false);
      expect(await readOffers(read)).toEqual([]);
      expect(read).not.toHaveBeenCalled();
    } finally {
      delete dataset.platform;
    }
    expect(offersHere()).toBe(true);
    expect(await readOffers(read)).toHaveLength(1);
  });

  it('keeps under the title typed, and tells a refusal, a gone offer and a failure apart', async () => {
    const keep = vi.fn(async (_id: string, _title: string) => ({ ok: true }) as never);
    expect(await keepOffer(keep, 'o-00000001', 'My title')).toEqual({ ok: true });
    expect(keep).toHaveBeenCalledWith('o-00000001', 'My title');

    const refused = { ok: false as const, code: 'duplicate', text: 'It exists', refusals: [{ field: 'title', code: 'x', text: 'y' }] };
    expect(await keepOffer(async () => refused, 'o-1', 't')).toEqual({ ok: false, gone: false, failure: refused });
    expect(await keepOffer(async () => ({ ok: false, code: 'gone', text: 'gone' }), 'o-1', 't')).toEqual({ ok: false, gone: true });
    expect(await keepOffer(async () => Promise.reject(new Error('lost')), 'o-1', 't')).toMatchObject({ ok: false, gone: false, failure: { code: 'error', text: 'lost' } });
  });

  it('declines, and counts an offer that is already gone as done', async () => {
    expect(await declineOffer(async () => ({ ok: true }), 'o-1')).toEqual({ ok: true });
    expect(await declineOffer(async () => ({ ok: false, code: 'gone' }), 'o-1')).toEqual({ ok: true });
    expect(await declineOffer(async () => Promise.reject(new Error('lost')), 'o-1')).toMatchObject({ ok: false, gone: false });
  });

  it('reads again every 30 seconds', () => {
    expect(OFFER_REFRESH_MS).toBe(30_000);
  });
});
