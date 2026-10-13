import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { listAudit, recordWrite, register } from '../src/main/auditoria';
import { atasDir } from '../src/main/env';
import { getConfig, saveConfig, updateConfig } from '../src/main/workspaceConfig';

// The audit log keeps what the autonomy policy let go out and cannot be edited by the persona: it only appends, and a line changed or removed by hand shows up.

const FILE = join(atasDir(), 'auditoria.jsonl');
const POLICY = { cycle: true, hostCommands: true, gates: false, push: false, pullRequest: false, level: 'flow' as const, flow: 'platform' };

const step = (target: string, extra: Partial<Omit<AuditEntry, 'at'>> = {}): Omit<AuditEntry, 'at'> => ({
  kind: 'auto-step', issue: 123, target, via: 'runner', fields: {}, ok: true, code: null, result: '', origin: { actionId: '', kind: 'run', key: 'run-1', summary: null }, by: 'developer', ...extra,
});

const lines = (): string[] => readFileSync(FILE, 'utf8').split('\n').filter(Boolean);

describe('the chained audit log', () => {
  beforeEach(() => rmSync(FILE, { force: true }));

  it('keeps the policy in effect with the step and seals each line to the one before', () => {
    recordWrite(step('host command: npm test', { policy: POLICY }));
    recordWrite(step('gate: Plan'));
    const rows = listAudit();
    expect(rows.map((r) => r.target)).toEqual(['gate: Plan', 'host command: npm test']);
    expect(rows[1].policy).toEqual(POLICY);
    expect(rows.every((r) => typeof r.chain === 'string' && !r.tampered)).toBe(true);
    expect(rows[1].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('flags a line edited afterwards, and only that one', () => {
    for (const t of ['a', 'b', 'c']) recordWrite(step(t));
    const [a, b, c] = lines();
    writeFileSync(FILE, [a, b.replace('"ok":true', '"ok":false'), c].join('\n') + '\n');
    const rows = listAudit();
    expect(rows.find((r) => r.target === 'b')?.tampered).toBe(true);
    expect(rows.filter((r) => r.target !== 'b').some((r) => r.tampered)).toBe(false);
  });

  it('flags the line after one that was removed', () => {
    for (const t of ['a', 'b', 'c']) recordWrite(step(t));
    const [a, , c] = lines();
    writeFileSync(FILE, `${a}\n${c}\n`);
    expect(listAudit().find((r) => r.target === 'c')?.tampered).toBe(true);
  });

  it('flags a line put in by hand without a chain, but reads the lines older than the chain as they are', () => {
    const old = { ...step('old'), at: '2026-01-01T00:00:00.000Z' };
    delete (old as Partial<AuditEntry>).by;
    writeFileSync(FILE, `${JSON.stringify(old)}\n`);
    recordWrite(step('new'));
    appendFileSync(FILE, `${JSON.stringify({ ...step('forged'), at: '2026-01-02T00:00:00.000Z' })}\n`);
    const rows = listAudit();
    expect(rows.find((r) => r.target === 'old')).toMatchObject({ target: 'old' });
    expect(rows.find((r) => r.target === 'old')?.tampered).toBeUndefined();
    expect(rows.find((r) => r.target === 'old')?.policy).toBeUndefined();
    expect(rows.find((r) => r.target === 'new')?.tampered).toBeUndefined();
    expect(rows.find((r) => r.target === 'forged')?.tampered).toBe(true);
  });

  it('never keeps a token from a command, and never writes the reader\'s mark', () => {
    recordWrite(step('host command: curl -H "Authorization: Bearer abcdefghijklmnop1234" example.com', { tampered: true } as Partial<AuditEntry>));
    expect(readFileSync(FILE, 'utf8')).not.toContain('abcdefghijklmnop1234');
    expect(readFileSync(FILE, 'utf8')).not.toContain('tampered');
    expect(listAudit()[0].tampered).toBeUndefined();
  });

  it('opens one channel to the log, and it only reads: nothing the persona reaches can edit or remove a line', async () => {
    const channels = new Map<string, () => unknown>();
    register({ handle: (channel: string, fn: () => unknown) => channels.set(channel, fn) } as never);
    expect([...channels.keys()]).toEqual(['auditoria:list']);
    recordWrite(step('a'));
    const before = readFileSync(FILE, 'utf8');
    await channels.get('auditoria:list')!();
    expect(readFileSync(FILE, 'utf8')).toBe(before);
  });
});

describe('a change of the autonomy policy', () => {
  const base = structuredClone(getConfig());
  const changes = (): AuditEntry[] => listAudit().filter((r) => r.kind === 'policy-change');

  beforeEach(() => {
    saveConfig(structuredClone(base));
    rmSync(FILE, { force: true });
  });

  it('leaves one line per choice it changed, in the workspace and then in a flow, with before, after, level and who', () => {
    updateConfig((c) => ({ ...c, runner: { ...c.runner, autonomy: { ...c.runner.autonomy, push: !base.runner.autonomy.push } } }));
    expect(changes()).toEqual([
      expect.objectContaining({ by: 'person', fields: { level: 'workspace', flow: '', choice: 'push', before: String(base.runner.autonomy.push), after: String(!base.runner.autonomy.push) } }),
    ]);
    updateConfig((c) => ({ ...c, devCycle: { ...c.devCycle, autonomy: { ...c.devCycle.autonomy, platform: { useWorkspace: false, cycle: false, hostCommands: false, gates: false, push: true, pullRequest: false } } } }));
    const flow = changes().filter((r) => r.fields.level === 'flow');
    expect(flow.map((r) => [r.fields.flow, r.fields.choice, r.fields.before, r.fields.after])).toEqual(expect.arrayContaining([['platform', 'useWorkspace', 'true', 'false'], ['platform', 'push', 'false', 'true']]));
    expect(flow.every((r) => r.at && r.policy === undefined)).toBe(true);
  });

  it('says who changed it when the caller is not the person', () => {
    updateConfig((c) => ({ ...c, runner: { ...c.runner, autonomy: { ...c.runner.autonomy, gates: !base.runner.autonomy.gates } } }), 'team-lead');
    expect(changes()[0].by).toBe('team-lead');
  });

  it('leaves nothing for a save that does not touch the policy', () => {
    updateConfig((c) => ({ ...c, language: c.language === 'en' ? 'pt-BR' : 'en' }));
    expect(changes()).toEqual([]);
  });
});
