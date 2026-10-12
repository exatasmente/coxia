// Who may show a session of the app in claude.ai/code (#282): the pure decision, the paired browser and the persona that may only lower it, the desktop-only channels
// and the template that never carries it.
import { describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate, templateFromConfig } from '../src/shared/cycles';
import { remoteControlRank, resolveRemoteControl } from '../src/shared/remoteControl';
import { refusedPaths, remoteControlRaised } from '../src/main/configScope';
import { webAccess, webRefusal } from '../src/main/webPolicy';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, BrowserWindow: { getAllWindows: () => [] } }));

const world = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlow);
const withMode = (c: WorkspaceConfig, id: string, mode: 'off' | 'mirror' | undefined): WorkspaceConfig => {
  const next = structuredClone(c);
  const a = next.agents.team.find((x) => x.id === id)!;
  if (mode === undefined) delete a.remoteControl;
  else a.remoteControl = mode;
  return next;
};

describe('resolveRemoteControl', () => {
  it('is off when nothing was chosen, and says nobody decided', () => {
    expect(resolveRemoteControl({ agent: undefined, test: false, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'default', refusal: null });
  });

  it('follows the agent for a stage of a workspace that is not a test one', () => {
    expect(resolveRemoteControl({ agent: 'mirror', test: false, origin: 'stage' })).toEqual({ mode: 'mirror', decidedBy: 'agent', refusal: null });
    expect(resolveRemoteControl({ agent: 'off', test: false, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'agent', refusal: null });
  });

  it('lets the run lower the agent, never raise it, and says which one applied', () => {
    expect(resolveRemoteControl({ agent: 'mirror', run: 'off', test: false, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'run', refusal: null });
    expect(resolveRemoteControl({ agent: 'off', run: 'mirror', test: false, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'agent', refusal: null });
    expect(resolveRemoteControl({ agent: undefined, run: 'mirror', test: false, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'default', refusal: null });
    expect(resolveRemoteControl({ agent: 'mirror', run: 'mirror', test: false, origin: 'stage' }).decidedBy).toBe('agent');
  });

  it('refuses a test workspace with the reason', () => {
    expect(resolveRemoteControl({ agent: 'mirror', test: true, origin: 'stage' })).toEqual({ mode: 'off', decidedBy: 'agent', refusal: 'test-workspace' });
  });

  it('refuses the paired browser and the persona by name, even in a workspace that is not a test one', () => {
    expect(resolveRemoteControl({ agent: 'mirror', test: false, origin: 'paired' }).refusal).toBe('paired');
    expect(resolveRemoteControl({ agent: 'mirror', test: false, origin: 'persona' }).refusal).toBe('persona');
    expect(resolveRemoteControl({ agent: 'mirror', test: false, origin: 'persona' }).mode).toBe('off');
  });

  it('ranks an unknown level as off', () => {
    expect(remoteControlRank('control' as never)).toBe(0);
    expect(remoteControlRank(undefined)).toBe(0);
    expect(remoteControlRank('mirror')).toBe(1);
  });
});

describe('a raise from the paired browser or the persona', () => {
  it('is refused by name when an agent goes from off to mirror, and a new agent may not start with it', () => {
    const before = world();
    const id = before.agents.team[0].id;
    expect(remoteControlRaised(before, withMode(before, id, 'mirror'))).toEqual([`agents.team[${id}].remoteControl`]);
    expect(refusedPaths(before, withMode(before, id, 'mirror'))).toContain(`agents.team[${id}].remoteControl`);
    const added = structuredClone(before);
    added.agents.team.push({ ...structuredClone(before.agents.team[0]), id: 'newcomer', system: false, remoteControl: 'mirror' });
    expect(remoteControlRaised(before, added)).toEqual(['agents.team[newcomer].remoteControl']);
  });

  it('lets them turn it off, and an explicit off is no raise', () => {
    const on = withMode(world(), world().agents.team[0].id, 'mirror');
    const id = on.agents.team[0].id;
    expect(remoteControlRaised(on, withMode(on, id, undefined))).toEqual([]);
    expect(remoteControlRaised(world(), withMode(world(), id, 'off'))).toEqual([]);
  });
});

describe('the channels of Remote Control', () => {
  it.each(['remoteControl:open', 'remoteControl:set', 'remoteControl:'])('denies %s to a paired browser, with or without the external-effects switch', (channel) => {
    expect(webAccess(channel)).toBe('deny');
    expect(webRefusal(channel, false)).not.toBeNull();
    expect(webRefusal(channel, true)).not.toBeNull();
  });
});

describe('a shared template', () => {
  it('never carries an agent\'s Remote Control', () => {
    const c = world();
    const id = c.agents.team.find((a) => !a.system)!.id;
    const template = templateFromConfig(withMode(c, id, 'mirror'), { id: 'mine', name: 'Mine', description: '' });
    expect(template.team?.some((a) => 'remoteControl' in a)).toBe(false);
  });
});
