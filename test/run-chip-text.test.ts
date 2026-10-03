import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../src/shared/i18n';
import { RUN_STATUSES } from '../src/shared/runs';

// The chip of a run reads "<stage> · <status>": the stage's name, then what the run is doing there. The text of a status has to follow a stage name
// without sounding odd, above all after a gate ("Gate 1 · waiting for you", not "Gate 1: at the gate").

const KEY: Record<(typeof RUN_STATUSES)[number], string> = {
  working: 'ui.cycle.status.working',
  gate: 'ui.cycle.status.gate',
  question: 'ui.cycle.status.question',
  'to-start': 'ui.cycle.status.toStart',
  'to-accept': 'ui.cycle.status.toAccept',
  waiting: 'ui.cycle.status.waiting',
  failed: 'ui.cycle.status.failed',
  done: 'ui.cycle.status.done',
  cancelled: 'ui.cycle.status.cancelled',
};
const chip = (stage: string, status: (typeof RUN_STATUSES)[number]) => t('ui.cycle.badge.withStage', { stage, status: t(KEY[status]) });

afterEach(() => setLanguage('pt-BR'));

describe('the chip of a run', () => {
  it('reads naturally for a gate, in both languages', () => {
    setLanguage('pt-BR');
    expect(chip('Gate 1', 'gate')).toBe('Gate 1 · esperando você');
    setLanguage('en');
    expect(chip('Gate 1', 'gate')).toBe('Gate 1 · waiting for you');
  });

  it('keeps the stage and the status apart with a dot, and says nothing the stage name already said', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      setLanguage(lang);
      for (const status of RUN_STATUSES) {
        const text = chip('Triage', status);
        expect(text, `${lang}/${status}`).toMatch(/^Triage · \S/);
        expect(text, `${lang}/${status}`).not.toMatch(/no gate|at the gate/i);
      }
    }
  });

  it('reads "Triagem · falhou" for a stage that failed', () => {
    setLanguage('pt-BR');
    expect(chip('Triagem', 'failed')).toBe('Triagem · falhou');
  });

  it('has a status text in both languages for every status', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      setLanguage(lang);
      for (const status of RUN_STATUSES) expect(t(KEY[status]), `${lang}/${status}`).not.toBe(KEY[status]);
    }
  });
});
