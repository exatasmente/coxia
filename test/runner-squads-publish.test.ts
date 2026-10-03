// What squads put on the code host: the label of the squad on the issue when a run starts in it (by itself when the squad's liaison runs by itself, a
// proposal otherwise, refused in a test workspace).
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { setLanguage } from '../src/shared/i18n';
import { type Forge, makeForge } from './helpers/fakeForge';
import { type Boot, boot, doc, work } from './helpers/runner';
import { withSquads } from './helpers/squads';

vi.setConfig({ testTimeout: 30_000 });

const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { installLegacyConfig } = await import('./helpers/config');
await installLegacyConfig();
const { writeRegistry } = await import('../src/main/workspaces-core');
const actions = await import('../src/main/actions');
const { setVcsRuntimeForTests } = await import('../src/main/vcs');
const { listAudit } = await import('../src/main/auditoria');
const { onRunnerActionDone } = await import('../src/main/runner/door');

let forge: Forge;
let stop: (() => void) | null = null;
const asReal = (test: boolean) => writeRegistry(DATA_ROOT, { current: WORKSPACE_ID, list: [{ id: WORKSPACE_ID, name: 'work', createdAt: '2026-10-01T00:00:00Z', test }] });

beforeAll(() => setLanguage('en'));
afterAll(() => setLanguage('pt-BR'));
beforeEach(() => {
  for (const f of ['acoes.json', 'auditoria.jsonl']) rmSync(join(ATAS, f), { force: true });
  for (const d of ['runs', 'forum']) rmSync(join(ATAS, d), { recursive: true, force: true });
  asReal(false);
  stop?.();
  stop = null;
});

async function started(configure: (c: WorkspaceConfig) => void = () => undefined, test = false): Promise<{ b: Boot; id: string }> {
  forge = makeForge();
  setVcsRuntimeForTests(forge.runtime());
  asReal(test);
  const b = await boot({ dir: ATAS, publish: true, configure: (c) => { c.language = 'en'; withSquads(c); configure(c); } });
  b.engine.script('support', () => work('Triaged.', { artifacts: [doc('0_TRIAGE.md')] }));
  b.engine.script('dev-a', () => work('Built.', { artifacts: [doc('3_IMPLEMENTATION.md')] }));
  stop = onRunnerActionDone((a, responses) => b.runner.actionDone(a, responses));
  const run = await b.runner.start('app#101', 'app');
  await b.settle();
  return { b, id: run.id };
}

describe('the label of the squad', () => {
  it('goes onto the issue by itself when the liaison of the squad runs by itself, audited and said in the thread', async () => {
    const { b, id } = await started();
    expect(forge.labels).toEqual(['squad-a']);
    expect(b.thread(id).some((m) => m.code === 'runner.squad.set' && m.params.label === 'squad-a')).toBe(true);
    expect(listAudit().find((a) => a.target.includes('/issues/101/labels'))).toMatchObject({ ok: true, kind: 'github', issue: 101 });
    // the other squad's label is not on it
    expect(forge.writes.filter((w) => w.endpoint.endsWith('/issues/101/labels'))).toHaveLength(1);
  });

  it('waits for a "yes" when the squad is switched off, and goes on at the "yes"', async () => {
    const { b, id } = await started((c) => ((c.squads ?? [])[0].autonomy = false));
    expect(forge.labels).toEqual([]);
    const proposal = actions.listActions().find((a) => (a.unit as { purpose?: string } | null)?.purpose === 'squad');
    expect(proposal).toMatchObject({ state: 'pending', summary: expect.stringContaining('squad-a') });
    expect(b.thread(id).some((m) => m.code === 'runner.squad.proposed')).toBe(true);
    await actions.approveAction(proposal!.id);
    expect(forge.labels).toEqual(['squad-a']);
  });

  it('is not written at all when the squad has none, and a test workspace refuses it', async () => {
    const none = await started((c) => ((c.squads ?? [])[0].label = null));
    expect(forge.writes).toEqual([]);
    expect(none.b.thread(none.id).some((m) => m.code?.startsWith('runner.squad.'))).toBe(false);
    const refused = await started(() => undefined, true);
    expect(forge.writes).toEqual([]);
    expect(refused.b.thread(refused.id).some((m) => m.code === 'runner.squad.refused')).toBe(true);
  });
});
