// A stage of an agent with Remote Control on is shown in claude.ai/code (#282), through the runner with a scripted engine and a fake bridge: the engine gets the mirror,
// the mirror closes with the attempt, the thread says it, and an agent with it off loads no bridge at all.
import { describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { createRemoteControlPort, type BridgeApi } from '../src/main/remoteBridge';
import { boot, doc, work } from './helpers/runner';

vi.setConfig({ testTimeout: 30_000 });

function fakeWorld() {
  const written: unknown[] = [];
  const lines: Omit<AuditEntry, 'at'>[] = [];
  let closed = 0;
  let loads = 0;
  let n = 0;
  const api: BridgeApi = {
    createCodeSession: async () => `cse_${++n}`,
    fetchRemoteCredentials: async () => ({ worker_jwt: 'jwt', api_base_url: 'https://example.com', worker_epoch: 1 }),
    attachBridgeSession: async () => ({ write: (m) => void written.push(m), sendResult: () => undefined, close: () => void closed++ }),
  };
  const port = createRemoteControlPort({
    test: () => false,
    token: () => 'token',
    api: async () => {
      loads++;
      return api;
    },
    audit: (e) => void lines.push(e),
  });
  return { port, written, lines, closed: () => closed, loads: () => loads };
}

describe('a stage with Remote Control', () => {
  it('hands the engine a mirror, closes it with the attempt, writes one audit line and says it in the thread', async () => {
    const w = fakeWorld();
    const b = await boot({ remoteControl: w.port, configure: (c) => void (c.agents.team.find((a) => a.id === 'refiner')!.remoteControl = 'mirror') });
    b.engine.script('refiner', (call) => {
      // What the engine would hand it while the session runs.
      call.mirror?.write({ type: 'assistant', message: { content: [] } });
      return work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' });
    });
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls[0].mirror?.id).toBe('cse_1');
    expect(w.closed()).toBe(1);
    expect(w.lines).toHaveLength(1);
    expect(w.lines[0]).toMatchObject({ kind: 'remote-control', issue: 101, fields: { session: 'cse_1', agent: 'refiner', mode: 'mirror', run: run.id, ref: 'app#101' } });
    expect(b.thread(run).map((m) => m.code)).toContain('runner.remoteControl.opened');
  });

  it('shows nothing and loads no bridge for an agent with it off', async () => {
    const w = fakeWorld();
    const b = await boot({ remoteControl: w.port });
    b.engine.script('refiner', () => work('Spec.', { artifacts: [doc('1_SPEC.md'), doc('REQUIREMENTS.md')], handoff: 'Plan it.' }));
    const run = await b.runner.start('app#101');
    await b.settle();
    expect(b.engine.calls[0].mirror).toBeUndefined();
    expect(w.loads()).toBe(0);
    expect(w.lines).toHaveLength(0);
    expect(b.thread(run).some((m) => (m.code ?? '').startsWith('runner.remoteControl'))).toBe(false);
  });
});
