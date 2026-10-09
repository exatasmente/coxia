// The warning the person reads before they type (#178), composed from what the agent has: the app's browser, a shell in the sandbox or on the computer, or no shell.
import { describe, expect, it } from 'vitest';
import { type HandoffPaths, composeWarning } from '../src/shared/handoff';
import { CATALOGS } from '../src/shared/i18n';

const ids = (paths: HandoffPaths): string[] => composeWarning(paths).map((k) => k.replace('ui.screen.handoff.warning.', ''));

describe('the warning', () => {
  it('always opens with what the app keeps away from the agent and that the video keeps the interval, and always ends with the last line', () => {
    for (const browser of [true, false]) {
      for (const shell of ['sandbox', 'host', 'none'] as const) {
        const lines = ids({ browser, shell });
        expect(lines.slice(0, 2)).toEqual(['always', 'recorded']);
        expect(lines.at(-1)).toBe('last');
      }
    }
  });

  it('says what is masked in the app\'s browser only for an agent that has it', () => {
    expect(ids({ browser: true, shell: 'sandbox' })).toContain('browser');
    expect(ids({ browser: false, shell: 'sandbox' })).not.toContain('browser');
  });

  it('says the agent\'s programs keep running for an agent with a shell, in the sandbox or on the computer, and the extra sentence only on the computer', () => {
    expect(ids({ browser: true, shell: 'sandbox' })).toEqual(['always', 'recorded', 'browser', 'programs', 'last']);
    expect(ids({ browser: true, shell: 'host' })).toEqual(['always', 'recorded', 'browser', 'programs', 'programsHost', 'last']);
  });

  it('says no program of the agent runs beside the screen for an agent with no shell, and does not warn of programs', () => {
    expect(ids({ browser: true, shell: 'none' })).toEqual(['always', 'recorded', 'browser', 'noPrograms', 'last']);
    expect(ids({ browser: false, shell: 'none' })).not.toContain('programs');
  });

  it('gives catalog keys, in the order they are read', () => {
    expect(composeWarning({ browser: false, shell: 'host' })).toEqual([
      'ui.screen.handoff.warning.always',
      'ui.screen.handoff.warning.recorded',
      'ui.screen.handoff.warning.programs',
      'ui.screen.handoff.warning.programsHost',
      'ui.screen.handoff.warning.last',
    ]);
  });
});

describe('the words of the warning and the viewer', () => {
  const all: HandoffPaths[] = [];
  for (const browser of [true, false]) for (const shell of ['sandbox', 'host', 'none'] as const) all.push({ browser, shell });

  it('has every line the composer can give, in both catalogs, written out', () => {
    for (const paths of all) {
      for (const key of composeWarning(paths)) {
        for (const language of ['en', 'pt-BR'] as const) expect(CATALOGS[language][key], `${key} in ${language}`).toBeTruthy();
      }
    }
  });

  it('has the rest of the hand-off words in both catalogs, and none of the keys under it is in only one', () => {
    const under = (language: 'en' | 'pt-BR'): string[] => Object.keys(CATALOGS[language]).filter((k) => k.startsWith('ui.screen.handoff.')).sort();
    expect(under('en')).toEqual(under('pt-BR'));
    for (const key of ['ui.screen.handoff.understand', 'ui.screen.handoff.banner', 'ui.screen.handoff.giveBack', 'ui.screen.handoff.take', 'ui.screen.handoff.decline', 'ui.cycle.live.held']) {
      for (const language of ['en', 'pt-BR'] as const) expect(CATALOGS[language][key], `${key} in ${language}`).toBeTruthy();
    }
  });

  it('says the interval is recorded and kept with the evidence, and that the weaker guarantee is weaker', () => {
    expect(CATALOGS.en['ui.screen.handoff.warning.recorded']).toMatch(/recorded/i);
    expect(CATALOGS.en['ui.screen.handoff.warning.recorded']).toMatch(/evidence/i);
    expect(CATALOGS.en['ui.screen.handoff.warning.programs']).toMatch(/weaker/i);
  });

  it('says the browser mask ends with the answer: a value still on the page afterwards can be read, so submit or clear it', () => {
    expect(CATALOGS.en['ui.screen.handoff.warning.browser']).toMatch(/still on the page afterwards/i);
    expect(CATALOGS.en['ui.screen.handoff.warning.browser']).toMatch(/submit or clear/i);
    expect(CATALOGS['pt-BR']['ui.screen.handoff.warning.browser']).toMatch(/ainda estiver na página depois/i);
    expect(CATALOGS['pt-BR']['ui.screen.handoff.warning.browser']).toMatch(/envie ou apague/i);
  });
});
