// The card of a hand-off request (#178), as a static render shows it: the agent's words set apart, Take the screen / Decline / Give back on the computer, only the text and Decline
// in a paired browser, the run's own list leaving it to the run screen's top, and the channels the buttons call. The buttons in motion are for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenScreenInfo, PendingAsk } from '../src/shared/browser';
import { HANDOFF_ASK_MS } from '../src/shared/handoff';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { ScreenFrameAnswer } from '../src/shared/screen';

// src/renderer/src/api.ts reads window.api when it loads, and the cards ask document whether they run in a paired browser; the node environment has neither.
const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  const invoke = vi.fn(async (..._args: unknown[]) => null);
  (globalThis as unknown as { window: unknown }).window = { api: { invoke }, addEventListener: () => undefined, removeEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement, hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined };
  return { documentElement, invoke };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/screens/cycle/ArtifactView', () => ({ ArtifactView: () => null }));
vi.mock('../src/renderer/src/screens/Diagram', () => ({ RichText: () => null }));
const { AskCard, AskCards } = await import('../src/renderer/src/screens/cycle/AskCard');
const { CallLine } = await import('../src/renderer/src/screens/cycle/Thread');
const { ScreenStrip } = await import('../src/renderer/src/screens/cycle/ScreenStrip');
const { asksOf, choicesOf, isHandoff } = await import('../src/renderer/src/screens/cycle/askView');
const { NO_FRAMES, framesFrom } = await import('../src/renderer/src/screens/cycle/frames');
const { screenApi } = await import('../src/renderer/src/screens/cycle/screenApi');

afterEach(() => {
  setLanguage('pt-BR');
  dom.documentElement.dataset.platform = '';
  dom.invoke.mockClear();
});

const request = (over: Partial<PendingAsk> = {}): PendingAsk => ({
  id: 'ask-1',
  key: 'call:general:coder',
  agent: 'coder',
  kind: 'handoff',
  why: 'agent',
  step: null,
  site: '',
  agentWords: 'Log in to example.com',
  since: '2026-10-09T11:59:00.000Z',
  handoff: { why: 'The page asks for a password', taken: false, paths: { browser: true, shell: 'sandbox' } },
  ...over,
});
const taken = (): PendingAsk => request({ handoff: { taken: true, paths: { browser: true, shell: 'sandbox' } } });
const card = (a: PendingAsk): string => renderToStaticMarkup(createElement(AskCard, { ask: a, team: undefined, answerable: true, onWatch: () => undefined }));

describe('the card of a request to hand the screen over', () => {
  it('says who asks, shows what the agent needs and why as its own words, and offers Take the screen and Decline on the computer', () => {
    setLanguage('en');
    const html = card(request());
    expect(html).toContain('coder asks you to take its screen.');
    expect(html).toContain('class="cy-ask-words"');
    expect(html).toContain('Log in to example.com');
    expect(html).toContain('The page asks for a password');
    expect(html).toContain(`>${t('ui.screen.handoff.take')}</button>`);
    expect(html).toContain(`>${t('ui.screen.handoff.decline')}</button>`);
    expect(html).not.toContain(t('ui.screen.handoff.giveBack'));
    // It is a request to the person, not a yes/no question: no note field and no "Yes".
    expect(html).not.toContain(t('ui.screen.ask.yes'));
    expect(html).not.toContain('text-input');
    expect(html).toContain('data-kind="handoff"');
  });

  it('counts the wait to take the screen in the minutes the service waits', () => {
    setLanguage('en');
    expect(card(request())).toContain(`With no answer in ${Math.round(HANDOFF_ASK_MS / 60_000)} minutes the request ends`);
  });

  it('shows no wait and offers Give back instead of Take the screen once the screen is taken', () => {
    const html = card(taken());
    expect(html).toContain(`>${t('ui.screen.handoff.giveBack')}</button>`);
    expect(html).not.toContain(`>${t('ui.screen.handoff.take')}</button>`);
    expect(html).not.toContain(`>${t('ui.screen.handoff.decline')}</button>`);
    expect(html).not.toContain(t('ui.screen.handoff.since', { time: '', minutes: 15 }).slice(0, 12));
  });

  it('does not offer Take the screen where there is no viewer to open', () => {
    expect(renderToStaticMarkup(createElement(AskCard, { ask: request(), team: undefined, answerable: true }))).not.toContain(`>${t('ui.screen.handoff.take')}</button>`);
  });

  it('in a paired browser says the agent waits on the computer and offers only Decline, with no switch needed', () => {
    dom.documentElement.dataset.platform = 'web';
    const html = renderToStaticMarkup(createElement(AskCard, { ask: request(), team: undefined, answerable: false, onWatch: () => undefined }));
    expect(html).toContain(t('ui.screen.handoff.computerOnly'));
    expect(html).toContain(`>${t('ui.screen.handoff.decline')}</button>`);
    expect(html).not.toContain(t('ui.screen.handoff.take'));
    expect(html).not.toContain(t('ui.screen.handoff.giveBack'));
    // The switch's own text is for the questions that need it.
    expect(html).not.toContain(t('ui.screen.ask.computerOnly'));
    // Before the switch is known the decline is still there: it needs none.
    expect(renderToStaticMarkup(createElement(AskCard, { ask: request(), team: undefined, answerable: null }))).toContain(`>${t('ui.screen.handoff.decline')}</button>`);
  });

  it('in a paired browser says who has the screen once it is taken, with no button to answer it', () => {
    dom.documentElement.dataset.platform = 'web';
    const html = card(taken());
    expect(html).toContain(t('ui.screen.handoff.takenWeb'));
    expect(html).not.toContain('<button');
  });

  it('is worded in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = card(request());
      expect(html).toContain(CATALOGS[language]['ui.screen.handoff.take']);
      expect(html).toContain(CATALOGS[language]['ui.screen.handoff.decline']);
    }
  });

  it('is listed with the other questions, oldest first, and told apart by its kind', () => {
    const early = request({ id: 'early', since: '2026-10-09T10:00:00.000Z' });
    const hold: PendingAsk = { id: 'late', key: 'call:general:qa', agent: 'qa', kind: 'hold', why: 'submit', step: null, site: 'example.com', since: '2026-10-09T11:00:00.000Z' };
    const screens = [{ key: 'k', pending: [hold, early] }] as unknown as OpenScreenInfo[];
    const asks = asksOf(screens);
    expect(asks.map((a) => a.id)).toEqual(['early', 'late']);
    expect(asks.filter(isHandoff).map((a) => a.id)).toEqual(['early']);
    expect(choicesOf(early)).toEqual([]);
    expect(renderToStaticMarkup(createElement(AskCards, { asks, team: undefined }))).toContain('data-kind="handoff"');
  });
});

describe('where the conversation shows that the agent waits', () => {
  const NOW = Date.parse('2026-10-09T12:00:00.000Z');
  const open = (pending: PendingAsk[]): OpenScreenInfo => ({ key: 'call:general:coder', agent: 'coder', thread: 'general', place: 'conversation', since: '2026-10-09T11:50:00.000Z', closesAt: null, width: 1280, height: 800, control: false, recording: 'on', profile: 'none', pending });
  const entry = { seq: 1, runId: 'a1', jobId: null, role: 'coder', at: NOW, kind: 'status' as const, label: 'working', state: 'started' as const, call: { agent: 'coder', thread: 'general', message: 3 } };
  const group = { agent: 'coder', thread: 'general', message: 3, runId: 'a1', entry, entries: [entry], since: NOW };

  it('marks the call line of an agent that asks for the screen, and not one that asks for something else', () => {
    const line = (screen: OpenScreenInfo): string => renderToStaticMarkup(createElement(CallLine, { group, team: undefined, screen, onWatch: () => undefined }));
    expect(line(open([request()]))).toContain(t('ui.screen.handoff.callBadge'));
    expect(line(open([]))).not.toContain(t('ui.screen.handoff.callBadge'));
  });

  it('counts the request among what waits in the strip of open screens', () => {
    expect(renderToStaticMarkup(createElement(ScreenStrip, { screens: [open([request()])], team: undefined, onWatch: () => undefined }))).toContain(t('ui.screen.asking', { count: 1 }));
  });
});

describe('the phone\'s viewer while the person holds the screen', () => {
  const answer = (a: ScreenFrameAnswer) => framesFrom(a);

  it('keeps no picture, says the screen is held, and stops showing "controlled" for a screen it cannot see', () => {
    const got = answer({ state: 'held' });
    expect(got.next).toMatchObject({ held: true, src: null, screen: null, remote: false, ended: false });
    expect(got.again).toBe(true);
    // The next picture after the hand-off is asked for afresh.
    expect(got.since).toBe(0);
  });

  it('is never "ended" by it, and the next picture or an unchanged answer clears it', () => {
    expect(answer({ state: 'held' }).next.ended).toBe(false);
    expect(answer({ state: 'same', seq: 3, control: false }).next).toMatchObject({ held: false });
    expect(answer({ state: 'none' })).toMatchObject({ again: false, next: { ended: true, held: false } });
    expect({ ...NO_FRAMES, ...answer({ state: 'held' }).next }.held).toBe(true);
  });

  it('is worded in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) expect(CATALOGS[language]['ui.cycle.live.held']).toBeTruthy();
  });
});

describe('the channels of the card', () => {
  it('take, give back, the person\'s frame and decline are called by the screen key or the ask, positionally', async () => {
    await screenApi.handoffTake('call:general:coder', 'ask-1');
    await screenApi.handoffGive('call:general:coder');
    await screenApi.handoffFrame('call:general:coder', 3, 640);
    await screenApi.handoffDecline('ask-1');
    expect(dom.invoke.mock.calls).toEqual([
      ['screen:handoffTake', 'call:general:coder', 'ask-1'],
      ['screen:handoffGive', 'call:general:coder'],
      ['screen:handoffFrame', 'call:general:coder', 3, 640],
      ['runs:handoffDecline', 'ask-1'],
    ]);
  });
});
