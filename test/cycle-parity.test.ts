import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { calls, installFakeEngine, runScenario, type Scenario } from './helpers/promptCapture';
import { installLegacyConfig } from './helpers/config';

vi.mock('../src/main/workspace', async (orig) => ({ ...(await orig<typeof import('../src/main/workspace')>()), assertExternalWrite: () => {}, externalRefusal: () => null }));
vi.mock('node:child_process', async (orig) => {
  const real = await orig<typeof import('node:child_process')>();
  const { glabAnswer } = await import('./helpers/promptCapture');
  const execFile = (_cmd: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) => cb(null, { stdout: JSON.stringify(glabAnswer(args)), stderr: '' });
  return { ...real, execFile };
});

const GOLDEN = join(import.meta.dirname, 'golden', 'legacy-prompts.json');

let scenario: Scenario;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-02T12:00:00'));
  await installLegacyConfig();
  // The migrated profile points at the author's daily-report files; the test uses its own so nothing real is read.
  const dir = mkdtempSync(join(tmpdir(), 'cycle-parity-'));
  const history = join(dir, 'history.jsonl');
  writeFileSync(history, `${JSON.stringify({ at: '2026-09-30T10:00:00Z', ref: 'sz4#15499', type: 'change', field: 'stage', from: 'Doing', to: 'Test Fail' })}\n`);
  const { updateConfig } = await import('../src/main/workspaceConfig');
  updateConfig((c) => {
    c.externalTools.cardSource.historyFile = history;
    c.externalTools.cardSource.stateFile = join(dir, 'state.json');
    return c;
  });
  await installFakeEngine();
  scenario = await runScenario(process.env.CERIMONIAS_SPECS_DIR as string);
  calls.length = 0;
});

describe('legacy parity: the migrated user gets the prompts and files the app produced before the cycle templates', () => {
  it('matches the golden captured from the original code', () => {
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) {
      mkdirSync(join(import.meta.dirname, 'golden'), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(scenario, null, 1)}\n`);
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Scenario;
    expect(Object.keys(scenario.prompts)).toEqual(Object.keys(golden.prompts));
    for (const [name, want] of Object.entries(golden.prompts)) expect(scenario.prompts[name], name).toEqual(want);
    expect(scenario.files).toEqual(golden.files);
  });
});
