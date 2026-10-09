// The warning the person reads before they type (#178), composed from what the agent has: the app's browser, a shell in the sandbox or on the computer, or no shell.
import { describe, expect, it } from 'vitest';
import { type HandoffPaths, composeWarning } from '../src/shared/handoff';

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
