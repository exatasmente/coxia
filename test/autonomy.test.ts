import { describe, expect, it } from 'vitest';
import { autonomyOf, choiceOn, flowKeyOf, newFlowAutonomy, onChoices, RELEASE_AUTONOMY_KEY, type EffectiveAutonomy } from '../src/shared/config/autonomy';
import { neutralConfig } from '../src/shared/config/index';
import type { WorkspaceConfig } from '../src/shared/config/types';

const ON = { cycle: true, hostCommands: true, gates: true, push: true, pullRequest: true };

const withWorkspace = (block: Partial<typeof ON>, c: WorkspaceConfig = neutralConfig()): WorkspaceConfig => ({ ...c, runner: { ...c.runner, autonomy: { ...neutralConfig().runner.autonomy, ...block } } });

const withFlow = (key: string, block: Record<string, unknown>, c: WorkspaceConfig = neutralConfig()): WorkspaceConfig => ({ ...c, devCycle: { ...c.devCycle, autonomy: { [key]: { useWorkspace: true, ...neutralConfig().runner.autonomy, ...block } } } });

describe('the autonomy resolver', () => {
  it('names the flow of a squad by its id and the main flow by the empty key', () => {
    expect(flowKeyOf(null)).toBe('');
    expect(flowKeyOf(undefined)).toBe('');
    expect(flowKeyOf('platform')).toBe('platform');
    expect(RELEASE_AUTONOMY_KEY).toBe('release');
  });

  it('takes the workspace block when the flow follows it (its switch on, or no block at all)', () => {
    const c = withWorkspace(ON);
    expect(autonomyOf(c, '')).toMatchObject({ ...ON, from: 'workspace', flow: null });
    expect(autonomyOf(c, 'platform')).toMatchObject({ ...ON, from: 'workspace', flow: null });
    const following = withFlow('platform', { cycle: true, gates: true }, c);
    expect(autonomyOf(following, 'platform')).toMatchObject({ ...ON, from: 'workspace', flow: null });
  });

  it('takes the flow block when its switch is off, and ignores the workspace one', () => {
    const c = withWorkspace(ON);
    const own = withFlow('platform', { useWorkspace: false, cycle: true, push: true }, c);
    expect(autonomyOf(own, 'platform')).toMatchObject({ cycle: true, push: true, hostCommands: false, gates: false, pullRequest: false, from: 'flow', flow: 'platform' });
    // the main flow of the same config still follows the workspace
    expect(autonomyOf(own, '')).toMatchObject({ from: 'workspace' });
  });

  it('reads a config stored without a map or a block as every field off and the workspace deciding', () => {
    const c = neutralConfig();
    delete (c.devCycle as { autonomy?: unknown }).autonomy;
    expect(autonomyOf(c, '')).toMatchObject({ cycle: false, hostCommands: false, gates: false, push: false, pullRequest: false, from: 'workspace', flow: null });
    expect(autonomyOf(c, 'platform')).toMatchObject({ from: 'workspace', flow: null });
  });

  it('only lets one of the four choices count with cycle on', () => {
    const a = autonomyOf(withWorkspace({ ...ON, cycle: false }), '');
    expect(onChoices(a)).toEqual([]);
    expect(choiceOn(a, 'gates')).toBe(false);
    expect(choiceOn(a, 'push')).toBe(false);
    const b = autonomyOf(withWorkspace({ cycle: true, gates: true }), '');
    expect(onChoices(b)).toEqual(['gates']);
  });

  it('fills a flow block written with only some fields', () => {
    expect(newFlowAutonomy()).toEqual({ cycle: false, hostCommands: false, gates: false, push: false, pullRequest: false, useWorkspace: true });
    expect(newFlowAutonomy({ useWorkspace: false, cycle: true })).toEqual({ cycle: true, hostCommands: false, gates: false, push: false, pullRequest: false, useWorkspace: false });
  });

  it('reports the origin and the flow of every decision, for the run header', () => {
    const a: EffectiveAutonomy = autonomyOf(withFlow('', { useWorkspace: false, cycle: true, gates: true }), '');
    expect(a.from).toBe('flow');
    expect(a.flow).toBe('');
    expect(onChoices(a)).toEqual(['gates']);
  });
});
