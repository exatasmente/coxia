// The third call origin (#248): `callOrigin()` says `persona` only inside an open act of the persona's door, `viaOf()` is the one name every audit line and answer uses, the HTTP
// door still says `web`, the scope closes when the handler settles, and nothing under src/main reads the origin but the call wrapper.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuditKind } from '../src/shared/auditoria';
import { readEntries } from '../src/main/errorlog-core';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, nativeImage: {} }));

const { bindIpc, callOrigin, handle, handleDevice, invoke, invokePersona, viaOf } = await import('../src/main/rpc');
const { newActId, runAct, currentAct, openAct } = await import('../src/main/persona/act');
const { DATA_ROOT } = await import('../src/main/env');
const { listAudit } = await import('../src/main/auditoria');
const { register: turnAsksModule, turnAsks } = await import('../src/main/turnAsks');
const { runsModule, screenAsks } = await import('../src/main/runner/module');
const { memoryModule } = await import('../src/main/memory/module');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

type Act = import('../src/main/persona/act').Act;
type Handler = (...args: unknown[]) => unknown;

const SRC = join(import.meta.dirname, '../src/main');
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const module = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined };
turnAsksModule(module);
runsModule(module);
memoryModule(module);

const logs = () => readEntries(join(DATA_ROOT, 'logs'));
const makeAct = (): Act => ({ open: true, id: newActId(), door: 'window', said: '', mask: (t) => t, wrote: { count: 0, kinds: new Set<AuditKind>() } });

/** What the door does around a handler: an open act, the call, the act closed when the handler's promise settles. */
async function asPersona(channel: string, ...args: unknown[]): Promise<unknown> {
  const act = makeAct();
  try {
    return await runAct(act, () => invokePersona(channel, args));
  } finally {
    act.open = false;
  }
}
const asWindow = (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const asPaired = (channel: string, ...args: unknown[]) => invoke(channel, args, 'device-1');

describe('callOrigin() and viaOf()', () => {
  it('say the window outside any call, for the window and for a paired browser', async () => {
    const seen: [string, string][] = [];
    handle('o:seen', (async () => {
      seen.push([callOrigin(), viaOf()]);
      await new Promise((r) => setTimeout(r, 2));
      seen.push([callOrigin(), viaOf()]);
    }) as never);
    expect([callOrigin(), viaOf()]).toEqual(['ipc', 'window']);
    await asWindow('o:seen');
    await asPaired('o:seen');
    expect(seen).toEqual([['ipc', 'window'], ['ipc', 'window'], ['web', 'paired'], ['web', 'paired']]);
  });

  it('say persona inside a door call, across its awaits, and the call wrapper is the one every call goes through', async () => {
    const seen: [string, string][] = [];
    handle('o:persona', (async () => {
      seen.push([callOrigin(), viaOf()]);
      await new Promise((r) => setTimeout(r, 2));
      seen.push([callOrigin(), viaOf()]);
    }) as never);
    await asPersona('o:persona');
    expect(seen).toEqual([['persona', 'persona'], ['persona', 'persona']]);
    expect([callOrigin(), viaOf()]).toEqual(['ipc', 'window']);
  });

  it('writes the error log of a persona call with via persona, and no arguments', async () => {
    handle('o:fails', (() => {
      throw new Error('persona boom');
    }) as never);
    await expect(asPersona('o:fails', 'text the person typed')).rejects.toThrow('persona boom');
    const last = logs().at(-1);
    expect(last).toMatchObject({ source: 'rpc:o:fails', message: 'persona boom', context: { channel: 'o:fails', via: 'persona' } });
    expect(JSON.stringify(last)).not.toContain('text the person typed');
  });

  it('closes with the act: work the handler leaves running reads the window, not the persona', async () => {
    const late: string[] = [];
    const after = new Promise<void>((done) => {
      handle('o:leaves', (() => {
        setTimeout(() => {
          late.push(callOrigin(), viaOf());
          done();
        }, 5);
        return 'returned';
      }) as never);
    });
    expect(await asPersona('o:leaves')).toBe('returned');
    await after;
    expect(late).toEqual(['ipc', 'window']);
  });

  it('keeps the persona origin while the act is open even when the handler started the work itself', async () => {
    let inside: string | null = null;
    handle('o:inside', (async () => {
      await Promise.resolve();
      inside = callOrigin();
    }) as never);
    await asPersona('o:inside');
    expect(inside).toBe('persona');
  });

  it('does not let a closed act, or no act at all, read as the persona', async () => {
    const closed = makeAct();
    closed.open = false;
    handle('o:closed', (() => callOrigin()) as never);
    expect(() => runAct(closed, () => invokePersona('o:closed', []))).toThrow(/outside an act/);
    expect(() => invokePersona('o:closed', [])).toThrow(/outside an act/);
    expect(currentAct()).toBeNull();
    expect(runAct(closed, () => [currentAct() === closed, openAct()])).toEqual([true, null]);
  });
});

describe('invokePersona', () => {
  it('refuses a persona channel, an unknown one and a device-bound one, with the wrapper never reached', async () => {
    let ran = 0;
    handle('persona:o-stop', (() => (ran += 1, 'stopped')) as never);
    handleDevice('o:device', (() => (ran += 1, 'device')) as never);
    await expect(asPersona('persona:o-stop')).rejects.toThrow(/persona:o-stop/);
    await expect(asPersona('o:nothing')).rejects.toThrow(/o:nothing/);
    await expect(asPersona('o:device')).rejects.toThrow(/o:device/);
    expect(ran).toBe(0);
    // The window still reaches the persona channel.
    expect(await asWindow('persona:o-stop')).toBe('stopped');
    expect(ran).toBe(1);
  });

  it('is not the phone: the HTTP door still labels its call web', async () => {
    const seen: string[] = [];
    handle('o:web', (() => void seen.push(callOrigin())) as never);
    await invoke('o:web', [], 'dev-1');
    expect(seen).toEqual(['web']);
  });
});

describe('the six places that named the origin now say the helper', () => {
  it('has no file under src/main but the call wrapper that names callOrigin', () => {
    const named: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      if (/\bcallOrigin\b/.test(readFileSync(join(SRC, file), 'utf8'))) named.push(file);
    }
    expect(named).toEqual(['rpc.ts']);
  });

  it('has no handler that compares an origin with web', () => {
    for (const file of ['turnAsks.ts', 'memory/module.ts', 'runner/module.ts', 'persona/assist.ts']) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toMatch(/===\s*'web'|\?\s*'paired'\s*:\s*'window'/);
    }
  });

  it('reads the helper at each of the six: the turn-limit answer, the hold answer, the correction of the activities and of the memory, the audit of the editor and its scope', () => {
    const count = (file: string) => (readFileSync(join(SRC, file), 'utf8').match(/\bviaOf\b/g) ?? []).length;
    expect(count('turnAsks.ts')).toBeGreaterThanOrEqual(2);
    expect(count('runner/module.ts')).toBeGreaterThanOrEqual(3);
    expect(count('memory/module.ts')).toBeGreaterThanOrEqual(2);
    expect(count('persona/assist.ts')).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(SRC, 'persona/assist.ts'), 'utf8')).toMatch(/viaOf\(\) === 'paired' \? refusedPaths/);
  });
});

describe('what each of them says for the persona', () => {
  it('records a turn-limit answer as the persona, not as the window or the phone', async () => {
    const waiting = turnAsks.ask({ of: 'sub', run: 'r1', thread: 'run-r1', ref: 'app#123', issue: 123, stage: 'review', agent: 'reviewer', name: 'Reviewer', kind: 'explore', task: 'map the tests', used: 12, round: 12, granted: 0, canContinue: true });
    const id = turnAsks.list()[0].id;
    expect(await asPersona('turnAsks:answer', id, 'finish')).toEqual({ ok: true });
    await waiting;
    expect(listAudit().filter((e) => e.kind === 'turn-limit')[0]).toMatchObject({ via: 'persona', fields: { through: 'persona', decision: 'finish' } });
  });

  it("records a hold's answer as the persona", async () => {
    saveConfig({ ...getConfig(), notifications: false });
    const asks = screenAsks()!;
    const pending = asks.confirm({ key: 'call:general:dev', agent: 'dev', place: 'conversation', confirmKind: 'send', words: 'send the report' });
    const id = asks.list()[0].id;
    expect(await asPersona('runs:screenAnswer', id, 'no')).toEqual({ ok: true });
    await expect(pending).resolves.toEqual({ answer: 'no' });
    expect(listAudit().filter((e) => e.kind === 'screen-confirm')[0]).toMatchObject({ via: 'persona', fields: { answer: 'no', through: 'persona' } });
  });

  it('records a memory edit as the persona', async () => {
    expect(await asPersona('memory:remove', 'general', 'developer', 'm-00000001')).toMatchObject({ ok: false });
    expect(listAudit().filter((e) => e.kind === 'memory')[0]).toMatchObject({ via: 'persona', fields: { surface: 'persona' } });
  });
});
