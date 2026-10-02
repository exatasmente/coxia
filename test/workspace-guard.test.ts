import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Minutes } from '../src/shared/types';

// Own data root, with the flat layout of the app before workspaces: it migrates to a test workspace on import.
const ROOT = mkdtempSync(join(tmpdir(), 'cerimonias-guard-'));
writeFileSync(join(ROOT, 'config.json'), JSON.stringify({ notifications: false, web: { enabled: true, port: 4999 } }));
process.env.CERIMONIAS_DATA_DIR = ROOT;

const { approveAction, listActions, proposeGitlabAction } = await import('../src/main/actions');
const { getSettings, saveSettings, saveWebSettings } = await import('../src/main/config');
const { ATAS, DATA_ROOT, WORKSPACE_ID } = await import('../src/main/env');
const { insertGateVisual, recordGate } = await import('../src/main/gate');
const { writeQaChecklist } = await import('../src/main/qa');
const { saveMinutes } = await import('../src/main/store');
const { currentWorkspace, isTestWorkspace } = await import('../src/main/workspace');
const { readRegistry, setTestFlag } = await import('../src/main/workspaces-core');

const REFUSED = /^Workspace de testes: .* não é feito aqui/;

function minutes(dest: string): Minutes {
  return {
    startedAt: '2026-10-02T09:40:00Z',
    endedAt: '2026-10-02T09:50:00Z',
    decisions: [
      { ref: 'sz4#1', text: 'decidido', target: 'spec', dest },
      { ref: 'sz4#2', text: 'avisar', target: 'daily-report', dest: 'daily-report' },
      { ref: 'sz4#3', text: 'so na ata', target: 'ata', dest: 'ata' },
    ],
    effects: [],
    unanswered: [],
    transcript: [],
  } as unknown as Minutes;
}

describe('a data dir from before workspaces', () => {
  it('opens as the "Testes" workspace with the test flag on', () => {
    expect(WORKSPACE_ID).toBe('testes');
    expect(ATAS).toBe(join(ROOT, 'workspaces', 'testes'));
    expect(DATA_ROOT).toBe(ROOT);
    expect(currentWorkspace()).toMatchObject({ id: 'testes', name: 'Testes', test: true });
    expect(isTestWorkspace()).toBe(true);
  });

  it('keeps the web access settings in the root, not in the workspace config', () => {
    expect(getSettings().web).toMatchObject({ enabled: true, port: 4999 });
    expect(JSON.parse(readFileSync(join(ROOT, 'web.json'), 'utf8'))).toMatchObject({ enabled: true, port: 4999 });
    const saved = saveSettings({ ...getSettings(), notifications: true });
    expect(saved.web.port).toBe(4999);
    expect(JSON.parse(readFileSync(join(ATAS, 'config.json'), 'utf8')).web).toBeUndefined();
    saveWebSettings({ ...getSettings().web, port: 4998 });
    expect(JSON.parse(readFileSync(join(ROOT, 'web.json'), 'utf8')).port).toBe(4998);
    expect(JSON.parse(readFileSync(join(ATAS, 'config.json'), 'utf8')).web).toBeUndefined();
  });
});

describe('external writes in a test workspace', () => {
  it('approveAction refuses and leaves the action pending', async () => {
    const action = proposeGitlabAction({
      key: 'guard:1',
      issue: 1,
      summary: 'comentar',
      command: { via: 'glab', method: 'POST', endpoint: 'projects/1/issues/1/notes', fields: { body: 'oi' } },
    });
    expect(action).not.toBeNull();
    await expect(approveAction(action!.id)).rejects.toThrow(REFUSED);
    expect(listActions().find((a) => a.id === action!.id)?.state).toBe('pending');
  });

  it('the spec Plan and the daily-report note are not written; the ata still is', async () => {
    const plan = join(ROOT, 'plan.md');
    writeFileSync(plan, '# Plan\n\n## Registro\n\n- antes\n');
    const result = await saveMinutes(minutes(`${plan} › Registro`), 'texto', [0, 1, 2]);
    expect(readFileSync(plan, 'utf8')).toBe('# Plan\n\n## Registro\n\n- antes\n');
    expect(result.written.map((w) => [w.ref, w.ok])).toEqual([['sz4#1', false], ['sz4#2', false], ['sz4#3', true]]);
    expect(result.written[0].detail).toMatch(/workspace de testes/);
    expect(existsSync(result.ataPath)).toBe(true);
    expect(result.ataPath.startsWith(ATAS)).toBe(true);
  });

  it('gate and QA files in the specs are refused', () => {
    expect(() => insertGateVisual('any')).toThrow(REFUSED);
    expect(() => recordGate('any')).toThrow(REFUSED);
    expect(() => writeQaChecklist('1')).toThrow(REFUSED);
  });
});

describe('the same calls once the flag is off', () => {
  it('pass the guard (they fail later on what they need, not on the workspace)', async () => {
    setTestFlag(DATA_ROOT, 'testes', false);
    expect(isTestWorkspace()).toBe(false);
    await expect(approveAction('missing')).rejects.toThrow(/não existe/);
    expect(() => writeQaChecklist('missing')).toThrow(/não preparada/);

    const plan = join(ROOT, 'plan2.md');
    mkdirSync(ROOT, { recursive: true });
    writeFileSync(plan, '# Plan\n\n## Registro\n\n- antes\n');
    const result = await saveMinutes(minutes(`${plan} › Registro`), 'texto', [0]);
    expect(result.written[0].ok).toBe(true);
    expect(readFileSync(plan, 'utf8')).toMatch(/pré-daily por voz\): decidido/);
  });

  it('a registry that becomes unreadable blocks again (fail closed)', async () => {
    writeFileSync(join(ROOT, 'workspaces.json'), 'broken');
    expect(readRegistry(ROOT)).toBeNull();
    expect(isTestWorkspace()).toBe(true);
    await expect(approveAction('missing')).rejects.toThrow(REFUSED);
  });
});
