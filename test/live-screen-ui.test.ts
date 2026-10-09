// The Live screen button on the stage card and the viewer it opens, as a static render shows them: the button only on the working stage that has a screen, the switch only
// on the desktop, the recording state, the mark and the "stage ended" text. The viewer in motion (polling, the pointer, the keys) is for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { LiveScreen as LiveScreenState } from '../src/shared/screen';
import type { Run } from '../src/shared/runs';
import { drive, flowWithAutonomy, agentFlowStages } from './helpers/runs';
import { stageDone, startStage } from '../src/shared/runs';

// src/renderer/src/api.ts reads window.api when it loads, and the viewer asks document whether it runs in a paired browser; the node environment has neither.
const dom = vi.hoisted(() => {
  const documentElement = { dataset: {} as Record<string, string> };
  (globalThis as unknown as { window: unknown }).window = { api: {} };
  (globalThis as unknown as { document: unknown }).document = { documentElement };
  return { documentElement };
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

const viewer = (screen: LiveScreenState | null): string => {
  const { run } = working(() => screen);
  return renderToStaticMarkup(createElement(LiveScreen, { run, onClose: () => undefined }));
};

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

  it('says the recording stopped when a limit was reached', () => {
    const html = viewer(screenOf({ recording: 'stopped' }));
    expect(html).toContain(t('ui.cycle.live.recordingStopped'));
    expect(html).not.toContain(t('ui.cycle.live.recordingOn'));
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

describe('the words of the viewer', () => {
  it('exist in both languages with the same placeholders', () => {
    const keys = Object.keys(CATALOGS['pt-BR']).filter((k) => k.startsWith('ui.cycle.live.'));
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const k of keys) {
      expect(CATALOGS.en[k], k).toBeTruthy();
      expect([...CATALOGS.en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), k).toEqual([...CATALOGS['pt-BR'][k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
    expect(CATALOGS.en['ui.cycle.live.controlOn']).toMatch(/recorded/);
  });
});
