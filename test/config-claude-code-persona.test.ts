// The persona reaches `config:save` on the desktop (#281): handing a stage's task to a Claude Code session is the person's switch, never its own. The handler is called
// through the same doors the app uses (the window and the persona's), over the stored configuration; nothing real is touched.
import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import type { AuditKind } from '../src/shared/auditoria';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle, invokePersona } = await import('../src/main/rpc');
const { newActId, runAct } = await import('../src/main/persona/act');
const { configModule } = await import('../src/main/configModule');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

type Act = import('../src/main/persona/act').Act;
type Handler = (...args: unknown[]) => unknown;

const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
configModule({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined });

const asWindow = async (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const act = (): Act => ({ open: true, id: newActId(), door: 'window', said: '', mask: (t) => t, wrote: { count: 0, kinds: new Set<AuditKind>() } });
// An async wrapper turns the handler's synchronous refusal into a rejection, as the door's caller sees it.
const asPersona = async (next: WorkspaceConfig) => runAct(act(), () => invokePersona('config:save', [next]));

const withOption = (on: boolean): WorkspaceConfig => ({ ...structuredClone(getConfig()), runner: { ...getConfig().runner, claudeCodeTasks: on } });
// The neutral configuration has no stage list, so the tests start from one work stage.
const withStage = (): WorkspaceConfig => ({ ...neutralConfig(), devCycle: { ...neutralConfig().devCycle, stages: [{ id: 'build', label: 'Build', match: [], kind: 'development', rank: 1, type: 'work' }] } });
const withExecutor = (): WorkspaceConfig => {
  const c = structuredClone(getConfig());
  c.devCycle.stages[0] = { ...c.devCycle.stages[0], executor: 'claude-code' };
  return c;
};

describe('config:save and the persona', () => {
  it('refuses the persona turning the option on, and the stored configuration does not change', async () => {
    saveConfig(neutralConfig());
    await expect(asPersona(withOption(true))).rejects.toThrow(/claudeCodeTasks/);
    expect(getConfig().runner.claudeCodeTasks).toBeFalsy();
  });

  it('refuses the persona choosing the Claude Code executor for a stage', async () => {
    saveConfig(withStage());
    await expect(asPersona(withExecutor())).rejects.toThrow(/executor/);
    expect(getConfig().devCycle.stages[0].executor).toBeUndefined();
  });

  it('lets the person in the window turn the option on and choose the executor, and the persona lower them again', async () => {
    saveConfig(withStage());
    await asWindow('config:save', withOption(true));
    expect(getConfig().runner.claudeCodeTasks).toBe(true);
    await asWindow('config:save', { ...withExecutor(), runner: { ...getConfig().runner, claudeCodeTasks: true } });
    expect(getConfig().devCycle.stages[0].executor).toBe('claude-code');
    // Lowering is not a raise: the persona may turn both back off.
    const lowered = structuredClone(getConfig());
    lowered.runner.claudeCodeTasks = false;
    lowered.devCycle.stages[0] = { ...lowered.devCycle.stages[0], executor: undefined };
    await asPersona(lowered);
    expect(getConfig().runner.claudeCodeTasks).toBe(false);
    expect(getConfig().devCycle.stages[0].executor).toBeUndefined();
  });
});
