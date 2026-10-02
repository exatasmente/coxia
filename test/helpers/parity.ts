import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { installLegacyConfig } from './config';
import { calls, installFakeEngine, runScenario, type Scenario } from './promptCapture';

// The parity run: the ceremonies of an install migrated from the example legacy profile (fictional org "acme") against a fake engine, compared
// with a golden snapshot (see docs/cycles.md). The snapshot was first captured from the code as it was before the prompts moved into the cycle
// templates, and carried over to the fictional fixtures by renaming; the same run with voice off has its own snapshot.
// Regenerate with UPDATE_GOLDEN=1 after a deliberate change of a prompt, and review the diff.

export function parity(title: string, goldenName: string, options: { voice: boolean; setup?: () => Promise<void>; registro?: string }): void {
  const golden = join(import.meta.dirname, '..', 'golden', goldenName);
  let scenario: Scenario;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T12:00:00'));
    // The quiz shuffles the options of each question; a fixed value makes the shuffle, and so the letter of the right answer, repeatable.
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
    if (options.setup) {
      // Not the migrated profile: a configuration of its own (another language, another name), set up by the test.
      await options.setup();
    } else {
      await installLegacyConfig();
      // The example profile points at card tool files in the home folder; the test uses its own so nothing real is read.
      const dir = mkdtempSync(join(tmpdir(), 'cycle-parity-'));
      const history = join(dir, 'history.jsonl');
      writeFileSync(history, `${JSON.stringify({ at: '2026-09-30T10:00:00Z', ref: 'web#101', type: 'change', field: 'stage', from: 'Doing', to: 'Test Fail' })}\n`);
      const { updateConfig } = await import('../../src/main/workspaceConfig');
      updateConfig((c) => {
        c.externalTools.cardSource.historyFile = history;
        c.externalTools.cardSource.stateFile = join(dir, 'state.json');
        c.voice.enabled = options.voice;
        return c;
      });
    }
    await installFakeEngine();
    scenario = await runScenario(process.env.CERIMONIAS_SPECS_DIR as string, options.registro ? { registro: options.registro } : {});
    calls.length = 0;
  });

  describe(title, () => {
    it('matches the golden snapshot', () => {
      if (process.env.UPDATE_GOLDEN === '1' || !existsSync(golden)) {
        mkdirSync(join(import.meta.dirname, '..', 'golden'), { recursive: true });
        writeFileSync(golden, `${JSON.stringify(scenario, null, 1)}\n`);
      }
      const want = JSON.parse(readFileSync(golden, 'utf8')) as Scenario;
      expect(Object.keys(scenario.prompts)).toEqual(Object.keys(want.prompts));
      for (const [name, expected] of Object.entries(want.prompts)) {
        expect(scenario.prompts[name], name).toEqual(expected);
      }
      expect(scenario.files).toEqual(want.files);
    });
  });
}
