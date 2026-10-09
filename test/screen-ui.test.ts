// The agents' screens in a conversation, as a static render shows them: the Watch button on a call that has a screen, the strip of open screens above the message box
// with Watch and Close and the time it closes by itself, and the pure pieces under them. The viewer in motion and the asks answered are for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '../src/shared/attachments';
import { ASK_TIMEOUT_MS, type OpenScreenInfo, type PendingAsk } from '../src/shared/browser';
import type { ActivityEntry } from '../src/shared/activity';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';

// src/renderer/src/api.ts reads window.api when it loads, and the viewer asks document whether it runs in a paired browser; the node environment has neither.
const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: async () => null }, addEventListener: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement };
  return { documentElement };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The diagrams and the document viewer draw with libraries that need a browser; nothing here opens them.
vi.mock('../src/renderer/src/screens/cycle/ArtifactView', () => ({ ArtifactView: () => null }));
vi.mock('../src/renderer/src/screens/Diagram', () => ({ RichText: () => null }));
const { ScreenStrip } = await import('../src/renderer/src/screens/cycle/ScreenStrip');
const { CallLine } = await import('../src/renderer/src/screens/cycle/Thread');
const { AskCard, AskCards } = await import('../src/renderer/src/screens/cycle/AskCard');
const { LiveScreen } = await import('../src/renderer/src/screens/cycle/LiveScreen');
const { asksOf, choicesOf } = await import('../src/renderer/src/screens/cycle/askView');
const { readExternalEffects } = await import('../src/renderer/src/useExternalEffects');
const { closesInMinutes, sameScreens, screenOfCall } = await import('../src/renderer/src/screens/cycle/screens');
const { MessageAttachments } = await import('../src/renderer/src/screens/cycle/Attachments');
const { RecordingPlayer } = await import('../src/renderer/src/screens/cycle/RecordingPlayer');
const { describeStep } = await import('../src/shared/stepWords');

afterEach(() => {
  setLanguage('pt-BR');
  dom.documentElement.dataset.platform = '';
});

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const screen = (over: Partial<OpenScreenInfo> = {}): OpenScreenInfo => ({
  key: 'call:general:coder',
  agent: 'coder',
  thread: 'general',
  place: 'conversation',
  since: '2026-10-09T11:50:00.000Z',
  closesAt: '2026-10-09T12:07:00.000Z',
  width: 1280,
  height: 800,
  control: false,
  recording: 'on',
  profile: 'none',
  pending: [],
  ...over,
});

const entry: ActivityEntry = { seq: 1, runId: 'a1', jobId: null, role: 'coder', at: NOW, kind: 'status', label: 'working', state: 'started', call: { agent: 'coder', thread: 'general', message: 3 } };
const group = { agent: 'coder', thread: 'general', message: 3, runId: 'a1', entry, entries: [entry], since: NOW };

const strip = (screens: OpenScreenInfo[]): string => renderToStaticMarkup(createElement(ScreenStrip, { screens, team: undefined, onWatch: () => undefined }));
const line = (open?: OpenScreenInfo, over: Partial<typeof group> = {}): string => renderToStaticMarkup(createElement(CallLine, { group: { ...group, ...over }, team: undefined, screen: open, onWatch: () => undefined }));

describe('Watch on a call line', () => {
  it('is offered when the agent has a screen in the conversation, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      expect(line(screen())).toContain(`>${CATALOGS[language]['ui.screen.watch']}</button>`);
    }
  });

  it('is not there when the agent has no screen', () => {
    expect(line(undefined)).not.toContain(t('ui.screen.watch'));
  });
});

describe('Stop on a call line', () => {
  it('is offered on a running answer, with or without a screen', () => {
    expect(line(screen())).toContain(`>${t('ui.screen.stop')}</button>`);
    expect(line(undefined)).toContain(`>${t('ui.screen.stop')}</button>`);
  });

  it('is not offered while the call still waits its turn', () => {
    const queued: ActivityEntry = { ...entry, state: 'queued' };
    expect(line(undefined, { entry: queued, entries: [queued] })).not.toContain(t('ui.screen.stop'));
  });
});

describe('the strip of open screens', () => {
  it('lists each screen with Watch, Close and the minutes left', () => {
    const html = strip([screen(), screen({ key: 'call:general:qa', agent: 'qa', closesAt: null })]);
    expect(html.match(new RegExp(`>${t('ui.screen.watch')}</button>`, 'g'))).toHaveLength(2);
    expect(html.match(new RegExp(`>${t('ui.screen.close')}</button>`, 'g'))).toHaveLength(2);
    expect(html).toContain(`aria-label="${t('ui.screen.strip')}"`);
    // The second one has something keeping it open.
    expect(html).toContain(t('ui.screen.inUse'));
  });

  it('is nothing at all while there is no screen', () => {
    expect(strip([])).toBe('');
  });

  it('says a screen waits for the person', () => {
    const ask = { id: 'a', key: 'call:general:coder', agent: 'coder', kind: 'hold', why: 'submit', step: null, site: 'example.com', since: '2026-10-09T11:59:00.000Z' } as const;
    expect(strip([screen({ pending: [ask] })])).toContain(t('ui.screen.asking', { count: 1 }));
    expect(strip([screen()])).not.toContain(t('ui.screen.asking', { count: 1 }));
  });
});

const ask = (over: Partial<PendingAsk> = {}): PendingAsk => ({
  id: 'ask-1',
  key: 'call:general:coder',
  agent: 'coder',
  kind: 'hold',
  why: 'submit',
  step: { action: 'click', role: 'button', name: 'Send', submit: true },
  site: 'example.com',
  since: '2026-10-09T11:59:00.000Z',
  ...over,
});
const card = (a: PendingAsk, answerable: boolean | null = true): string => renderToStaticMarkup(createElement(AskCard, { ask: a, team: undefined, answerable, onWatch: () => undefined }));

describe('the card of a question', () => {
  it('says the step in the app\'s words, why it was held, and offers Yes and No', () => {
    setLanguage('en');
    const html = card(ask());
    expect(html).toContain('coder wants to click the button “Send”, which sends a form on example.com.');
    expect(html).toContain('The app held this step because it sends a form.');
    expect(html).toContain(`>${t('ui.screen.ask.yes')}</button>`);
    expect(html).toContain(`>${t('ui.screen.ask.no')}</button>`);
    expect(html).not.toContain('Yes, for the rest of this screen');
  });

  it('marks what the agent wrote as the agent\'s own words', () => {
    const html = card(ask({ agentWords: 'It is only a draft.' }));
    expect(html).toContain(t('ui.screen.ask.agentWords'));
    expect(html).toContain('<blockquote>It is only a draft.</blockquote>');
    expect(card(ask())).not.toContain('<blockquote>');
  });

  it('offers "yes for the rest of this screen on this site" only for a step the app could not read', () => {
    const unread = card(ask({ why: 'unclassified', step: { action: 'click' } }));
    expect(unread).toContain(t('ui.screen.ask.site', { site: 'example.com' }));
    expect(unread).toContain(t('ui.screen.ask.siteHint'));
    expect(card(ask({ why: 'name' }))).not.toContain(t('ui.screen.ask.site', { site: 'example.com' }));
    expect(card(ask({ kind: 'confirm', why: 'agent', step: null, confirmKind: 'send', agentWords: 'x' }))).not.toContain(t('ui.screen.ask.site', { site: 'example.com' }));
    expect(choicesOf(ask({ why: 'unclassified', site: '' }))).toEqual(['yes', 'no']);
  });

  it('words a confirmation the agent asked for by what it wants to do', () => {
    setLanguage('en');
    const html = card(ask({ kind: 'confirm', why: 'agent', step: null, confirmKind: 'delete', agentWords: 'Remove the old row', site: '' }));
    expect(html).toContain('coder wants your yes to delete.');
    expect(html).toContain('Remove the old row');
    expect(html).not.toContain('The app held this step');
  });

  it('shows the question and not the answer to a paired browser without the switch, and nothing while it is not known', () => {
    const off = card(ask(), false);
    expect(off).toContain(t('ui.screen.ask.computerOnly'));
    expect(off).not.toContain(`>${t('ui.screen.ask.yes')}</button>`);
    expect(off).toContain(t('ui.screen.ask.title', { agent: 'coder' }));
    const unknown = card(ask(), null);
    expect(unknown).not.toContain(`>${t('ui.screen.ask.yes')}</button>`);
    expect(unknown).not.toContain(t('ui.screen.ask.computerOnly'));
  });

  it('says how long it waits before it counts as a no', () => {
    expect(card(ask())).toContain(`${Math.round(ASK_TIMEOUT_MS / 60_000)}`);
  });

  it('is nothing at all in the list while none waits, and one card for each question', () => {
    const list = (asks: PendingAsk[]) => renderToStaticMarkup(createElement(AskCards, { asks, team: undefined }));
    expect(list([])).toBe('');
    const html = list([ask(), ask({ id: 'ask-2' })]);
    expect(html.match(/class="cy-ask"/g)).toHaveLength(2);
  });

  it('offers a paired browser no answer in the list until the server has said it may', () => {
    dom.documentElement.dataset.platform = 'web';
    const html = renderToStaticMarkup(createElement(AskCards, { asks: [ask()], team: undefined }));
    expect(html).toContain(t('ui.screen.ask.title', { agent: 'coder' }));
    expect(html).not.toContain(`>${t('ui.screen.ask.yes')}</button>`);
    expect(html).not.toContain(`>${t('ui.screen.ask.no')}</button>`);
  });

  it('is in the viewer of the screen it is about, and the strip counts it', () => {
    const html = renderToStaticMarkup(createElement(LiveScreen, { screenKey: 'call:general:coder', state: screen(), asks: [ask()], onClose: () => undefined }));
    expect(html).toContain(t('ui.screen.ask.title', { agent: 'coder' }));
    expect(html).toContain(`>${t('ui.screen.ask.yes')}</button>`);
  });
});

describe('the pieces under the card', () => {
  it('lists the questions of every screen, the oldest first', () => {
    const late = ask({ id: 'late', since: '2026-10-09T11:59:30.000Z' });
    const early = ask({ id: 'early', since: '2026-10-09T11:58:00.000Z' });
    expect(asksOf([screen({ pending: [late] }), screen({ key: 'call:general:qa', agent: 'qa', pending: [early] })]).map((a) => a.id)).toEqual(['early', 'late']);
  });

  it('words a step in both languages with the translator it is given', () => {
    const step = { action: 'press', key: 'Enter', role: 'textbox', name: 'Name', submit: true } as const;
    expect(describeStep(step, '', (key, params) => CATALOGS.en[key].replace(/\{(\w+)\}/g, (_, n: string) => String(params?.[n] ?? `{${n}}`)))).toBe('press Enter in the textbox “Name”, which sends a form');
  });

  it('reads the switch of actions with external effects from the server\'s session answer', async () => {
    const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
    expect(await readExternalEffects(answer({ allowExternalEffects: true }), 'http://localhost/')).toBe(true);
    expect(await readExternalEffects(answer({ allowExternalEffects: false }), 'http://localhost/')).toBe(false);
    expect(await readExternalEffects(answer({}, false), 'http://localhost/')).toBeNull();
    expect(await readExternalEffects((async () => { throw new Error('offline'); }) as unknown as typeof fetch, 'http://localhost/')).toBeNull();
  });
});

const files = (refs: AttachmentRef[]): string => renderToStaticMarkup(createElement(MessageAttachments, { thread: 'general', message: 4, refs }));
const video: AttachmentRef = { id: 'ab12cd34ef56', name: 'Screen of coder 11:50-12:00', kind: 'video', bytes: 3_000_000 };

describe('the recording of a conversation\'s screen', () => {
  it('is offered to play in place and to save, and loads no video until it is played', () => {
    const html = files([video]);
    expect(html).toContain(`>${t('ui.screen.rec.play')}</button>`);
    expect(html).toContain(`>${t('ui.forum.file.save')}</button>`);
    expect(html).toContain(t('ui.forum.file.kind.video'));
    expect(html).not.toContain('<video');
    expect(html).not.toContain('blob:');
  });

  it('says retention took the file, with nothing to play or save', () => {
    const html = files([{ ...video, removed: true }]);
    expect(html).toContain(t('ui.screen.rec.removed'));
    expect(html).not.toContain(t('ui.screen.rec.play'));
    expect(html).not.toContain(`>${t('ui.forum.file.save')}</button>`);
  });

  it('leaves the other files as they were', () => {
    const html = files([{ id: 'ee11ee11ee11', name: 'notes.txt', kind: 'text', bytes: 100 }]);
    expect(html).toContain(`>${t('ui.forum.file.open')}</button>`);
    expect(html).not.toContain(t('ui.screen.rec.play'));
  });

  it('plays with the player of the evidence block, with no marks or cuts to draw for a conversation', () => {
    const html = renderToStaticMarkup(createElement(RecordingPlayer, { record: {}, url: 'blob:recording' }));
    expect(html).toContain('<video');
    expect(html).toContain('src="blob:recording"');
    expect(html).not.toContain('cy-rec-marks');
    expect(html).not.toContain('cy-rec-cuts');
  });
});

describe('what the conversation makes of the list', () => {
  it('counts whole minutes to the closing time, at least one, and none while something keeps it open', () => {
    expect(closesInMinutes('2026-10-09T12:07:00.000Z', NOW)).toBe(7);
    expect(closesInMinutes('2026-10-09T12:00:10.000Z', NOW)).toBe(1);
    expect(closesInMinutes('2026-10-09T11:59:00.000Z', NOW)).toBe(1);
    expect(closesInMinutes(null, NOW)).toBeNull();
    expect(closesInMinutes('not a date', NOW)).toBeNull();
  });

  it('finds the screen of a call by thread and agent, never a stage\'s', () => {
    const list = [screen({ key: 'run:r1', place: 'stage', thread: 'run-r1' }), screen()];
    expect(screenOfCall(list, 'general', 'coder')?.key).toBe('call:general:coder');
    expect(screenOfCall(list, 'general', 'qa')).toBeUndefined();
    expect(screenOfCall(list, 'run-r1', 'coder')).toBeUndefined();
  });

  it('tells a read that found nothing new from one that did', () => {
    expect(sameScreens([screen()], [screen()])).toBe(true);
    expect(sameScreens([screen()], [screen({ closesAt: null })])).toBe(false);
    expect(sameScreens([screen()], [])).toBe(false);
  });
});

describe('the words of the screens', () => {
  it('exist in both languages with the same placeholders', () => {
    const keys = Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('ui.screen.'));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      expect(CATALOGS.en[k], k).toBeTruthy();
      expect([...CATALOGS.en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k).toEqual([...CATALOGS['pt-BR'][k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});
