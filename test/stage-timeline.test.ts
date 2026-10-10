// The run screen's timeline marks with which attempt each artifact of a resumed stage was produced; a static render shows what a person reads.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FlowStage, Run } from '../src/shared/runs';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';

vi.hoisted(() => {
  // The timeline's neighbors read window.api and ask document whether the screen runs in a paired browser; node has neither. ArtifactView (not drawn here)
  // loads mermaid, which wants a headless window's addEventListener/resolve, so the hoisted window carries them.
  (globalThis as unknown as { window: unknown }).window = { api: {}, addEventListener: () => undefined, resolve: () => undefined };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
// useT subscribes with useSyncExternalStore, which has no server snapshot: a static render reads the translator directly.
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
const { StageTimeline } = await import('../src/renderer/src/screens/cycle/StageTimeline');
const { agentFlowStages, drive, flowWithAutonomy } = await import('./helpers/runs');
const { gateApprove, stageDone, sendBackTo } = await import('../src/shared/runs');

beforeAll(() => setLanguage('en'));

const done = (name: string) => ({ summary: `${name} done`, handoff: 'over to the next', artifacts: [`${name}.md`] });
type Driven = ReturnType<typeof drive>;

/** A run whose implementation stage finished, and was entered again when the person sent the work back to it, with the artifacts of both attempts. */
function resumed(): Driven {
  const d = drive(flowWithAutonomy({ reviewer: false }));
  d.do((r, when) => stageDone(r, d.flow, done('1_SPEC'), when));
  d.do((r, when) => gateApprove(r, d.flow, when));
  d.do((r, when) => stageDone(r, d.flow, done('2_PLAN'), when));
  d.do((r, when) => gateApprove(r, d.flow, when));
  d.do((r, when) => stageDone(r, d.flow, done('3_IMPLEMENTATION'), when));
  d.do((r, when) => sendBackTo(r, d.flow, { toStage: 'implement', note: 'The review points are real.' }, when));
  d.do((r, when) => stageDone(r, d.flow, { summary: 'again', handoff: 'over', artifacts: ['3_FOLLOW_UP.md'] }, when));
  return d;
}

const headed = (d: Driven): Run => d.run;

const draw = (run: Run, flow: FlowStage[]): string => renderToStaticMarkup(createElement(StageTimeline, { run, flow, config: null, go: () => undefined }));

describe('the attempt badge of an artifact in the timeline', () => {
  it('names the attempt each artifact is from when the stage restarted, in the language in force', () => {
    const d = resumed();
    const html = draw(headed(d), d.flow);
    expect(t('ui.cycle.stage.attemptOf', { count: 1 })).toBe('attempt 1');
    expect(`${t('ui.cycle.stage.attemptOf', { count: 2 })}</span>`).toBe('attempt 2</span>');
    expect(html).toContain('<li><button type="button" class="cy-file mono">3_IMPLEMENTATION.md</button><span class="faint small"> · attempt 1</span></li>');
    expect(html).toContain('<li><button type="button" class="cy-file mono">3_FOLLOW_UP.md</button><span class="faint small"> · attempt 2</span></li>');
  });

  it('shows no badge when the run predates the recording or the stage ran once', () => {
    const d = resumed();
    d.run.stages = d.run.stages.map((s) => (s.stage === 'implement' ? { ...s, artifactAttempts: undefined } : s));
    expect(draw(headed(d), d.flow)).not.toMatch(/<\/button><span class="faint small"> · attempt/);
    const once = resumed();
    once.run.stages = once.run.stages.map((s) => (s.stage === 'implement' ? { ...s, attempts: 1 } : s));
    expect(draw(headed(once), once.flow)).not.toMatch(/<\/button><span class="faint small"> · attempt/);
    expect(CATALOGS['pt-BR']['ui.cycle.stage.attemptOf']).toBe('tentativa {count}');
  });
});
