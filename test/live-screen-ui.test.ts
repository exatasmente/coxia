// The Live screen button on the stage card and the viewer it opens, as a static render shows them: the button only on the working stage that has a screen, the switch only
// on the desktop, the recording state, the mark and the "stage ended" text. The viewer in motion (polling, the pointer, the keys) is for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { PendingAsk } from '../src/shared/browser';
import type { HandoffPaths } from '../src/shared/handoff';
import type { LiveScreen as LiveScreenState } from '../src/shared/screen';
import type { Run } from '../src/shared/runs';
import { drive, flowWithAutonomy, agentFlowStages } from './helpers/runs';
import { stageDone, startStage } from '../src/shared/runs';

// src/renderer/src/api.ts reads window.api when it loads, and the viewer asks document whether it runs in a paired browser; the node environment has neither.
const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  const invoke = vi.fn(async (..._args: unknown[]) => null);
  (globalThis as unknown as { window: unknown }).window = { api: { invoke } };
  (globalThis as unknown as { document: unknown }).document = { documentElement };
  return { documentElement, invoke };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
// The document viewer draws diagrams with a library that needs a browser; the card does not open it here.
vi.mock('../src/renderer/src/screens/cycle/ArtifactView', () => ({ ArtifactView: () => null }));
const { StageTimeline } = await import('../src/renderer/src/screens/cycle/StageTimeline');
const { LiveScreen } = await import('../src/renderer/src/screens/cycle/LiveScreen');

afterEach(() => {
  setLanguage('pt-BR');
  dom.documentElement.dataset.platform = '';
});

const screenOf = (over: Partial<LiveScreenState> = {}): LiveScreenState => ({ stage: 'x', width: 1280, height: 800, since: '2026-10-08T10:00:00.000Z', control: false, recording: 'on', ...over });

/** A run of the agent cycle with an agent at work on its current stage, carrying a live screen as the runner hands it out. */
function working(screen: (stage: string) => LiveScreenState | null): { run: Run; flow: ReturnType<typeof agentFlowStages> } {
  const d = drive(flowWithAutonomy({}));
  for (let i = 0; i < 40 && d.run.status !== 'working'; i++) {
    if (d.run.status === 'to-start') d.do((r, when) => startStage(r, d.flow, when));
    else d.do((r, when) => stageDone(r, d.flow, { summary: 'done', handoff: '', artifacts: [`${r.stage}.md`] }, when));
  }
  expect(d.run.status).toBe('working');
  return { run: { ...d.run, screen: screen(d.run.stage) }, flow: d.flow };
}

const timeline = (run: Run, flow: ReturnType<typeof agentFlowStages>): string =>
  renderToStaticMarkup(createElement(StageTimeline, { run, flow, config: null, go: () => undefined }));

describe('the Live screen button on the stage card', () => {
  it('shows on the working stage whose screen is open, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const { run, flow } = working((stage) => screenOf({ stage }));
      expect(timeline(run, flow)).toContain(`>${CATALOGS[language]['ui.cycle.live.open']}</button>`);
    }
  });

  it('is not there without a screen, or when the screen belongs to another stage', () => {
    const none = working(() => null);
    expect(timeline(none.run, none.flow)).not.toContain(t('ui.cycle.live.open'));
    const other = working(() => screenOf({ stage: 'a-stage-this-run-does-not-work' }));
    expect(timeline(other.run, other.flow)).not.toContain(t('ui.cycle.live.open'));
  });

  it('is not there once the stage is no longer working', () => {
    const { run, flow } = working((stage) => screenOf({ stage }));
    const done = { ...run, status: 'to-accept' as const };
    expect(timeline(done, flow)).not.toContain(t('ui.cycle.live.open'));
  });
});

const viewer = (screen: LiveScreenState | null, screenKey = 'run:r1', canClose = false): string => renderToStaticMarkup(createElement(LiveScreen, { screenKey, state: screen, canClose, onClose: () => undefined }));

describe('the live screen viewer', () => {
  it('offers Take control, off, with the recording state, on the desktop', () => {
    const html = viewer(screenOf());
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain(t('ui.cycle.live.control'));
    expect(html).toContain(t('ui.cycle.live.recordingOn'));
    expect(html).toContain(t('ui.cycle.live.waiting'));
    expect(html).not.toContain(t('ui.cycle.live.controlOn'));
    expect(html).not.toContain(t('ui.cycle.live.ended'));
  });

  it('never offers Take control in the paired browser', () => {
    dom.documentElement.dataset.platform = 'web';
    const html = viewer(screenOf());
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(t('ui.cycle.live.control'));
    expect(html).toContain(t('ui.cycle.live.recordingOn'));
  });

  it('says it waits for a window, not that it records, while the screen is bare (#176)', () => {
    const html = viewer(screenOf({ recording: 'waiting' }));
    expect(html).toContain(t('ui.cycle.live.recordingWaiting'));
    expect(html).not.toContain(t('ui.cycle.live.recordingOn'));
    expect(html).not.toContain(t('ui.cycle.live.recordingStopped'));
    // The badge is a quiet one, not the red of a recording under way.
    expect(html).toContain('badge cy-tone-quiet');
    expect(html).not.toContain('cy-tone-blocked');
  });

  it('says the recording stopped when a limit was reached', () => {
    const html = viewer(screenOf({ recording: 'stopped' }));
    expect(html).toContain(t('ui.cycle.live.recordingStopped'));
    expect(html).not.toContain(t('ui.cycle.live.recordingOn'));
  });

  it('shows a conversation screen by its key just as a stage\'s', () => {
    const html = viewer(screenOf(), 'call:general:coder');
    expect(html).toContain('role="switch"');
    expect(html).toContain(t('ui.cycle.live.recordingOn'));
  });

  it('offers to close the agent\'s screen only where the caller allows it, and not once it is gone', () => {
    expect(viewer(screenOf(), 'call:general:coder', true)).toContain(`>${t('ui.screen.closeScreen')}</button>`);
    expect(viewer(screenOf(), 'call:general:coder')).not.toContain(t('ui.screen.closeScreen'));
    expect(viewer(null, 'call:general:coder', true)).not.toContain(t('ui.screen.closeScreen'));
  });

  it('says the screen was closed, not that a stage ended, for an agent\'s screen in a conversation', () => {
    const html = viewer(null, 'call:general:coder');
    expect(html).toContain(t('ui.screen.ended'));
    expect(html).not.toContain(t('ui.cycle.live.ended'));
  });

  it('says the stage ended, and offers nothing to control, when the run no longer has a screen', () => {
    const html = viewer(null);
    expect(html).toContain(t('ui.cycle.live.ended'));
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(t('ui.cycle.live.waiting'));
  });

  it('puts the live screen in a dialog labelled with its title', () => {
    expect(viewer(screenOf())).toContain(`aria-label="${t('ui.cycle.live.title')}"`);
  });
});

// #178: the viewer of a screen an agent asked the person to take.
const request = (paths: HandoffPaths, taken = false): PendingAsk => ({
  id: 'ask-1',
  key: 'run:r1',
  agent: 'coder',
  kind: 'handoff',
  why: 'agent',
  step: null,
  site: '',
  agentWords: 'Log in to example.com',
  since: '2026-10-09T11:59:00.000Z',
  handoff: { taken, paths },
});
const handoffViewer = (ask: PendingAsk | null, screenKey = 'run:r1'): string =>
  renderToStaticMarkup(createElement(LiveScreen, { screenKey, state: screenOf(), asks: ask ? [ask] : [], onClose: () => undefined }));
const lines = (html: string): string[] => [...html.matchAll(/data-line="([A-Za-z]+)"/g)].map((m) => m[1]);

describe('the viewer of a screen the agent handed over', () => {
  it('puts the warning in place of the control, composed from what the agent has, and offers no switch before the click', () => {
    setLanguage('en');
    const html = handoffViewer(request({ browser: true, shell: 'sandbox' }));
    expect(html).toContain(t('ui.screen.handoff.warning.title'));
    expect(lines(html)).toEqual(['always', 'recorded', 'browser', 'programs', 'last']);
    expect(html).toContain(`>${t('ui.screen.handoff.understand')}</button>`);
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(t('ui.screen.handoff.giveBack'));
    // The request is answered by the warning, not by a second card inside the viewer.
    expect(html).not.toContain('class="cy-ask"');
  });

  it('says the recording keeps the interval, and that the video may be played from a paired browser', () => {
    setLanguage('en');
    const html = handoffViewer(request({ browser: false, shell: 'none' }));
    expect(html).toContain('This is recorded.');
    expect(html).toContain('paired browser');
  });

  it('adds the sentence about the computer only for an agent that runs there, and the "no program" line for one with no shell', () => {
    expect(lines(handoffViewer(request({ browser: true, shell: 'host' })))).toEqual(['always', 'recorded', 'browser', 'programs', 'programsHost', 'last']);
    expect(lines(handoffViewer(request({ browser: true, shell: 'none' })))).toEqual(['always', 'recorded', 'browser', 'noPrograms', 'last']);
  });

  it('repeats the warning for each request: it is there for a new one, and gone once the screen is taken', () => {
    expect(handoffViewer(request({ browser: true, shell: 'sandbox' }))).toContain('cy-handoff-warning');
    expect(handoffViewer(request({ browser: true, shell: 'sandbox' }, true))).not.toContain('cy-handoff-warning');
  });

  it('once taken shows Give back always and a banner that says whose the screen is, offering control again when it is off; the card is not repeated', () => {
    setLanguage('en');
    const html = handoffViewer(request({ browser: true, shell: 'sandbox' }, true));
    expect(html).toContain(`>${t('ui.screen.handoff.giveBack')}</button>`);
    // A render before the take's answer has control off (the take turns it on): the viewer says the screen is still the person's, and the switch turns control on again with no warning.
    expect(html).toContain('with control off');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('class="cy-ask"');
  });

  it('shows no warning and no Give back in a paired browser, which can only watch', () => {
    dom.documentElement.dataset.platform = 'web';
    const html = handoffViewer(request({ browser: true, shell: 'sandbox' }, true));
    expect(html).not.toContain('cy-handoff-warning');
    expect(html).not.toContain(t('ui.screen.handoff.giveBack'));
    expect(html).not.toContain('role="switch"');
  });

  it('shows the screen as it was for a viewer with no request, and for a request of another screen', () => {
    const plain = handoffViewer(null);
    expect(plain).toContain('role="switch"');
    expect(plain).not.toContain('cy-handoff-warning');
    expect(handoffViewer(request({ browser: true, shell: 'sandbox' }), 'run:other')).not.toContain('cy-handoff-warning');
  });
});

describe('the channels of the viewer', () => {
  it('ask for a frame, take control and send input by the screen key, whatever the screen', async () => {
    const { screenApi } = await import('../src/renderer/src/screens/cycle/screenApi');
    for (const key of ['run:r1', 'call:general:coder']) {
      dom.invoke.mockClear();
      await screenApi.frame(key, 3, 640);
      await screenApi.control(key, true);
      await screenApi.input(key, [{ t: 'move', x: 1, y: 2 }]);
      expect(dom.invoke.mock.calls.map((c) => [c[0], c[1]])).toEqual([['runs:screen', key], ['screen:control', key], ['screen:input', key]]);
    }
  });

  it('read the person\'s frame, take and give back by the same key, never by the paired browser\'s read', async () => {
    const { screenApi } = await import('../src/renderer/src/screens/cycle/screenApi');
    dom.invoke.mockClear();
    await screenApi.handoffFrame('call:general:coder', 0, 1280);
    await screenApi.handoffTake('call:general:coder', 'ask-1');
    await screenApi.handoffGive('call:general:coder');
    expect(dom.invoke.mock.calls.map((c) => c[0])).toEqual(['screen:handoffFrame', 'screen:handoffTake', 'screen:handoffGive']);
  });
});

describe('the words of the viewer', () => {
  it('exist in both languages with the same placeholders', () => {
    const keys = Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('ui.cycle.live.'));
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const k of keys) {
      expect(CATALOGS.en[k], k).toBeTruthy();
      expect([...CATALOGS.en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k).toEqual([...CATALOGS['pt-BR'][k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
    expect(CATALOGS.en['ui.cycle.live.controlOn']).toMatch(/recorded/);
    // On a bare screen nothing is recorded yet, and the banner of Take control must not say it is.
    expect(CATALOGS.en['ui.cycle.live.controlWaiting']).not.toMatch(/is being recorded/);
  });
});
