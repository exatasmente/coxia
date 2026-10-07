import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import { agentFlowEngineering, applyTemplate } from '../src/shared/cycles';
import { flowOf, parseRun, startRun } from '../src/shared/runs';
import { createRunStore } from '../src/main/runs-core';

// A run file is kept across versions of the app: one written before a field of the flow existed must still be read, with the field's
// neutral value, or the runs screen shows none of the person's runs.

const AT = '2026-10-03T11:00:00.000Z';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(String(dirs.pop()), { recursive: true, force: true });
});

/** A run as a version before the autonomy block wrote it: its flow stages carry no `cycleAutonomous`. */
function olderRun(): Record<string, unknown> {
  const flow = flowOf(applyTemplate(neutralConfig(), agentFlowEngineering));
  const run = JSON.parse(JSON.stringify(startRun({ id: 'r-abc-0001', issue: { ref: 'app#1', iid: 1, title: 'T', url: null }, repo: 'app', branch: 'cycle/1-t', worktree: '/w', cycleFolder: 'docs/cycles/1-t', cycleId: 'agent-flow' }, flow, AT).run));
  for (const stage of run.flow.stages) delete stage.cycleAutonomous;
  return run;
}

describe('a run written before the autonomy block', () => {
  it('is read, with the general switch off on every stage', () => {
    const parsed = parseRun(olderRun());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.run.flow?.stages.every((s) => s.cycleAutonomous === false)).toBe(true);
  });

  it('is listed by the store, not counted as unreadable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coxia-older-runs-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'runs'));
    writeFileSync(join(dir, 'runs', 'r-abc-0001.json'), JSON.stringify(olderRun()));
    const store = createRunStore(join(dir, 'runs'));
    expect(store.list().map((r) => r.id)).toEqual(['r-abc-0001']);
    expect(store.unreadable()).toEqual([]);
  });
});
