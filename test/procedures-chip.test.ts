// The chip of a procedure a stage used, as a static render of the stage card shows it: one chip per procedure with its title, said apart when a step failed or the agent
// replaced it, in both languages; a stage that used none has none.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import type { ProcedureUse } from '../src/shared/procedures';
import { type Run, recordProcedures, stageDone, startStage } from '../src/shared/runs';
import { drive, flowWithAutonomy, agentFlowStages } from './helpers/runs';

// src/renderer/src/api.ts reads window.api when it loads, and the viewer asks document whether it runs in a paired browser; the node environment has neither.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/screens/cycle/ArtifactView', () => ({ ArtifactView: () => null }));
const { StageTimeline } = await import('../src/renderer/src/screens/cycle/StageTimeline');

afterEach(() => setLanguage('pt-BR'));

const use = (n: number, over: Partial<ProcedureUse> = {}): ProcedureUse => ({ id: `p-${n.toString(16).padStart(8, '0')}`, revision: 1, title: `Run the tests ${n}`, outcome: 'ok', ...over });

function working(uses: ProcedureUse[]): { run: Run; flow: ReturnType<typeof agentFlowStages> } {
  const d = drive(flowWithAutonomy({}));
  for (let i = 0; i < 40 && d.run.status !== 'working'; i++) {
    if (d.run.status === 'to-start') d.do((r, when) => startStage(r, d.flow, when));
    else d.do((r, when) => stageDone(r, d.flow, { summary: 'done', handoff: '', artifacts: [`${r.stage}.md`] }, when));
  }
  expect(d.run.status).toBe('working');
  if (uses.length) d.do((r, when) => recordProcedures(r, r.stage, uses, when));
  return { run: d.run, flow: d.flow };
}

const card = (run: Run, flow: ReturnType<typeof agentFlowStages>): string => renderToStaticMarkup(createElement(StageTimeline, { run, flow, config: null, go: () => undefined }));

describe('the chip of a used procedure', () => {
  it('says "Used: title" for each procedure, in the language of the app, and stands out only for a failure', () => {
    const { run, flow } = working([use(1), use(2, { outcome: 'failed' }), use(3, { outcome: 'replaced' })]);
    setLanguage('en');
    const en = card(run, flow);
    expect(en).toContain('aria-label="Procedures the stage used"');
    expect(en).toContain('Used: Run the tests 1<');
    expect(en).toContain('Used: Run the tests 2 (a step failed)');
    expect(en).toContain('Used: Run the tests 3 (replaced by a corrected version)');
    expect(en).toMatch(/badge-block">Used: Run the tests 2/);
    expect(en).toMatch(/badge-quiet">Used: Run the tests 1</);
    setLanguage('pt-BR');
    const pt = card(run, flow);
    expect(pt).toContain('Usado: Run the tests 1<');
    expect(pt).toContain('Usado: Run the tests 2 (um passo falhou)');
  });

  it('is not on a stage that used none', () => {
    const { run, flow } = working([]);
    setLanguage('en');
    expect(card(run, flow)).not.toContain('Procedures the stage used');
  });

  it('has its words in both catalogs', () => {
    for (const key of ['procedures', 'procedureUsed', 'procedureFailed', 'procedureReplaced']) {
      expect(CATALOGS.en[`ui.cycle.stage.${key}`], key).toBeTruthy();
      expect(CATALOGS['pt-BR'][`ui.cycle.stage.${key}`], key).toBeTruthy();
    }
  });
});
