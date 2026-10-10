// The last turn of a working stage (#187, spec rules 12 to 15; acceptance 5 and 6): a stage that fought a command until it worked and kept no procedure gets one more call,
// with the procedure tools only, before it is closed; its tokens are the stage's, and nothing it does changes the stage's result. The real procedure port and offer store over a
// temp folder, the fake sandbox and the fake engine; no model, no network.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import type { AgentCall } from '../src/main/agents';
import { createProcedureOffers, type ProcedureOffers } from '../src/main/procedures/offers';
import { createProceduresPort } from '../src/main/procedures/port';
import { createProcedureStore } from '../src/main/procedures/store';
import type { Run } from '../src/shared/runs';
import { type Boot, type BootOptions, boot, doc, fakeSandbox, work } from './helpers/runner';

vi.setConfig({ testTimeout: 60_000 });

const { getConfig, updateConfig } = await import('../src/main/workspaceConfig');
const { DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');

let dir: string;
let offers: ProcedureOffers;
let lines: { thread: string; code: string; params: Record<string, string | number> }[];

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  updateConfig((c) => ({ ...c, language: 'en' }));
  dir = mkdtempSync(join(tmpdir(), 'procedures-stage-turn-'));
  writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test: false }] });
  lines = [];
  offers = createProcedureOffers({ store: createProcedureStore(dir), config: getConfig, note: (thread, code, params) => void lines.push({ thread, code, params }) });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** `npm test` fails and the same program then works with a flag: the trial and error a draft keeps. */
const TABLE = { 'npm test': { exitCode: 1 } };

const start = (over: BootOptions = {}): Promise<Boot> =>
  boot({
    dir,
    procedures: createProceduresPort({ config: getConfig, dir }),
    offers,
    sandbox: fakeSandbox({ table: TABLE }),
    ...over,
    configure: (c) => {
      c.language = 'en';
      c.runner.procedures = true;
      c.agents.team.find((a) => a.id === 'qa')!.shell = 'sandbox';
      over.configure?.(c);
    },
  });

/** The other stages of the run say a short thing; qa runs the commands and answers as the test says. */
function script(b: Boot, qa: (call: AgentCall, n: number) => Promise<unknown> | unknown): void {
  b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md')], handoff: 'Plan.' }));
  b.engine.script('planner', () => work('Plan.', { artifacts: [doc('2_PLAN.md')] }));
  b.engine.script('developer', () => work('Built.', { commit: 'add the thing', artifacts: [doc('3_IMPLEMENTATION.md')] }));
  b.engine.script('reviewer', () => work('Fine.', { artifacts: [doc('4_REVIEW.md')], verdict: 'approved', findings: [] }));
  let n = 0;
  b.engine.script('qa', (call) => qa(call, ++n));
}

const fight = async (call: AgentCall): Promise<void> => {
  await call.exec?.exec('npm ci');
  await call.exec?.exec('npm test');
  await call.exec?.exec('npm test -- --runInBand');
};
const checked = (extra: Record<string, unknown> = {}) => work('Checked, after a retry with --runInBand.', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [], ...extra });
const turn = (b: Boot): AgentCall[] => b.engine.calls.filter((c) => c.agent.id === 'qa' && c.procedureOnly);

async function drive(b: Boot): Promise<Run> {
  let run = await b.runner.start('101');
  for (let i = 0; i < 40; i++) {
    await b.settle();
    run = b.runner.get(run.id)!;
    if (run.status === 'gate') b.runner.gate(run.id, 'approve');
    else if (run.stage === 'ready' || run.status === 'done') break;
  }
  return run;
}

describe('a stage that fought a command and kept nothing', () => {
  it('gets one more call, with the procedure tools only, then an offer in the run\'s thread; the stage\'s result stands', async () => {
    const b = await start();
    script(b, async (call) => {
      if (call.procedureOnly) return { note: '' };
      await fight(call);
      return checked();
    });
    const run = await drive(b);
    const calls = turn(b);
    expect(calls).toHaveLength(1);
    const c = calls[0];
    expect(c.maxTurns).toBe(3);
    expect(c.background).toBe(true);
    expect(c.agent.permission).toBe('read');
    expect(c.exec).toBeUndefined();
    expect(c.screen).toBeUndefined();
    expect(c.confine).toBeUndefined();
    expect(c.runnerTools).toBeUndefined();
    expect(c.resume).toBeUndefined();
    expect(c.prompt).toContain('Checked, after a retry with --runInBand.');
    expect(c.prompt).toContain('run: npm test -- --runInBand');
    // it was the stage's last call: nothing of the stage came after it, and the run went on as it would have
    expect(b.runs.get(run.id)!.stages.find((s) => s.stage === 'qa')?.status).toBe('done');
    const thread = b.thread(run);
    expect(thread.find((m) => m.code === 'runner.procedures.wrapUp')?.params).toMatchObject({ agent: 'qa' });
    const pending = offers.list(`run-${run.id}`);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ agent: 'qa', kind: 'repo', key: 'app', stage: 'qa', thread: `run-${run.id}` });
    expect(pending[0].steps.map((s) => s.run)).toEqual(['npm ci', 'npm test -- --runInBand']);
    expect(lines.find((l) => l.code === 'runner.procedures.offered')?.params).toMatchObject({ count: 2 });
  });

  it('puts the turn\'s tokens into the stage\'s usage and not into the baseline of the offer', async () => {
    const b = await start();
    script(b, async (call) => {
      if (call.procedureOnly) {
        call.onUsage?.({ promptTokens: 700, completionTokens: 100, cachedTokens: 0, costUsd: 0.001 });
        return { note: '' };
      }
      await fight(call);
      call.onUsage?.({ promptTokens: 5000, completionTokens: 500, cachedTokens: 0, costUsd: 0.01 });
      return checked();
    });
    const run = await drive(b);
    const usage = b.runs.get(run.id)!.stages.find((s) => s.stage === 'qa')?.usage;
    expect(usage).toMatchObject({ promptTokens: 5700, completionTokens: 600, calls: 2 });
    expect(b.thread(run).find((m) => m.code === 'runner.procedures.wrapUp')?.params).toMatchObject({ tokens: 800 });
    // what finding it cost is the work's own call
    const keep = offers.keep(offers.list()[0].offerId);
    expect(keep.ok).toBe(true);
    const stored = createProcedureStore(dir).list().records[0];
    expect(stored.stats.baseline).toMatchObject({ promptTokens: 5000, completionTokens: 500, calls: 1 });
  });

  it('leaves no offer when the agent saves from the draft in the turn', async () => {
    const b = await start();
    script(b, async (call) => {
      if (call.procedureOnly) {
        const r = await call.procedures?.save({ kind: 'repo', key: 'app', title: 'Run the tests with a retry', draft: 'c-1' });
        expect(r?.text).toMatch(/^Saved p-/);
        return { note: 'kept' };
      }
      await fight(call);
      return checked();
    });
    const run = await drive(b);
    expect(offers.list()).toEqual([]);
    const thread = b.thread(run);
    expect(thread.some((m) => m.code === 'runner.procedures.saved')).toBe(true);
    expect(thread.some((m) => m.code === 'runner.procedures.wrapUp')).toBe(true);
    expect(thread.some((m) => m.code === 'runner.procedures.offered')).toBe(false);
    // the record the turn created has the work as its baseline
    expect(createProcedureStore(dir).list().records[0].origin).toMatchObject({ by: 'qa', surface: 'stage', stage: 'qa' });
    expect(createProcedureStore(dir).list().records[0].stats.baseline).toBeTruthy();
  });
});

describe('a work that did not earn it', () => {
  it('a stage that saved a procedure itself gets no turn', async () => {
    const b = await start();
    script(b, async (call) => {
      await fight(call);
      await call.procedures?.save({ kind: 'repo', key: 'app', title: 'Run the tests', steps: [{ text: 'Run npm test -- --runInBand' }] });
      return checked();
    });
    await drive(b);
    expect(turn(b)).toEqual([]);
    expect(offers.list()).toEqual([]);
  });

  it('a stage whose commands all worked gets no turn, and one with no shell neither', async () => {
    const b = await start({ sandbox: fakeSandbox() });
    script(b, async (call) => {
      await call.exec?.exec('npm ci');
      await call.exec?.exec('npm test');
      return checked();
    });
    await drive(b);
    expect(turn(b)).toEqual([]);
    expect(b.engine.calls.filter((c) => c.procedureOnly)).toEqual([]);
  });

  it('a stage that ends in a question does not, and the one that resumes it does', async () => {
    const b = await start();
    let asked = false;
    script(b, async (call) => {
      if (call.procedureOnly) return { note: '' };
      await fight(call);
      if (!asked) {
        asked = true;
        return checked({ question: 'Which environment should I test?' });
      }
      return checked();
    });
    let run = await b.runner.start('101');
    for (let i = 0; i < 40; i++) {
      await b.settle();
      run = b.runner.get(run.id)!;
      if (run.status === 'gate') b.runner.gate(run.id, 'approve');
      else if (run.status === 'waiting' || run.question) {
        expect(turn(b)).toEqual([]);
        b.runner.answer(run.id, 'staging');
      } else if (run.stage === 'ready' || run.status === 'done') break;
    }
    expect(asked).toBe(true);
    expect(turn(b)).toHaveLength(1);
  });

  it('a stage that failed gets none', async () => {
    const b = await start();
    script(b, async (call) => {
      await fight(call);
      throw new Error('the model went away');
    });
    const run = await drive(b);
    expect(b.runs.get(run.id)!.status).not.toBe('done');
    expect(turn(b)).toEqual([]);
    expect(offers.list()).toEqual([]);
  });

  it.each([
    ['a document the stage owes is missing', () => work('Checked.', { artifacts: [], scenarios: [] })],
    ['the answer is empty', () => work('', { artifacts: [doc('5_TEST_PLAN.md')], scenarios: [] })],
  ])('a stage that fought a command and then failed its own checks gets no turn and no card: %s', async (_name, answer) => {
    const b = await start();
    script(b, async (call) => {
      await fight(call);
      return answer();
    });
    const run = await drive(b);
    expect(b.runs.get(run.id)!.stages.find((x) => x.stage === 'qa')?.status).not.toBe('done');
    expect(turn(b)).toEqual([]);
    expect(offers.list()).toEqual([]);
    expect(b.thread(run).some((m) => m.code === 'runner.procedures.wrapUp')).toBe(false);
  });

  it('with the workspace\'s switch off, nothing is offered or called', async () => {
    const b = await start({ configure: (c) => void (c.runner.procedures = false) });
    script(b, async (call) => {
      await fight(call);
      return checked();
    });
    await drive(b);
    expect(b.engine.calls.filter((c) => c.procedureOnly)).toEqual([]);
    expect(offers.list()).toEqual([]);
  });

  it('a runner built without offers gives no turn (the app\'s own tests of other things)', async () => {
    const b = await start({ offers: undefined });
    script(b, async (call) => {
      await fight(call);
      return checked();
    });
    await drive(b);
    expect(turn(b)).toEqual([]);
  });
});

describe('what the turn never does', () => {
  it('an engine that fails on the turn leaves the stage as it was, and the card is still offered', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const b = await start();
      script(b, async (call) => {
        if (call.procedureOnly) throw new Error('the provider fell over');
        await fight(call);
        return checked();
      });
      const run = await drive(b);
      expect(b.runs.get(run.id)!.stages.find((s) => s.stage === 'qa')?.status).toBe('done');
      expect(b.thread(run).some((m) => m.code === 'runner.procedures.wrapUp')).toBe(false);
      expect(offers.list()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it('a Cancel during the turn stops it, and nothing is offered for work that was cancelled', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const b = await start();
      let began: () => void = () => undefined;
      const inTurn = new Promise<void>((resolve) => (began = resolve));
      let aborted = false;
      script(b, async (call) => {
        if (call.procedureOnly) {
          call.abort?.signal.addEventListener('abort', () => void (aborted = true));
          began();
          return new Promise(() => undefined);
        }
        await fight(call);
        return checked();
      });
      let run = await b.runner.start('101');
      await vi.waitFor(
        () => {
          const now = b.runner.get(run.id)!;
          if (now.status === 'gate') b.runner.gate(now.id, 'approve');
          expect(b.engine.calls.some((c) => c.procedureOnly)).toBe(true);
        },
        { timeout: 30_000, interval: 25 },
      );
      await inTurn;
      run = b.runner.cancel(run.id);
      await b.settle();
      expect(run.status).toBe('cancelled');
      expect(aborted).toBe(true);
      expect(offers.list()).toEqual([]);
      expect(b.runner.get(run.id)!.status).toBe('cancelled');
    } finally {
      log.mockRestore();
    }
  });

  it('a turn that hangs is stopped at its limit and the stage goes on', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const b = await start({ procedureTurnMs: 40 });
      let aborted = false;
      script(b, async (call) => {
        if (call.procedureOnly) {
          call.abort?.signal.addEventListener('abort', () => void (aborted = true));
          return new Promise(() => undefined);
        }
        await fight(call);
        return checked();
      });
      const run = await drive(b);
      expect(aborted).toBe(true);
      expect(b.runs.get(run.id)!.stages.find((s) => s.stage === 'qa')?.status).toBe('done');
      expect(offers.list()).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });
});
