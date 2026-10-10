// How a pool is used, where the person chooses it: the workspace default in the Models step, the agent in its editor and the stage in the flow editor. Static markup
// for what is on screen; the edits themselves are the pure functions of agentEdit.ts and flowEdit.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { neutralConfig } from '../src/shared/config';
import type { StageDef, WorkspaceConfig } from '../src/shared/config/types';
import { agentFlow, applyTemplate } from '../src/shared/cycles';
import { setLanguage, t } from '../src/shared/i18n';

vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: {} };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/screens/cycle/Thread', () => ({ Thread: () => null }));
const { AgentPanel } = await import('../src/renderer/src/screens/team/TeamSection');
const { StagePanel } = await import('../src/renderer/src/screens/team/StagePanel');
const { ModelsStep } = await import('../src/renderer/src/wizard/steps/ModelsStep');
const { applyAgent, draftOf, subagentsOff } = await import('../src/renderer/src/screens/team/agentEdit');
const { applyFlows, patchStage } = await import('../src/renderer/src/screens/team/flowEdit');

function asWeb(web: boolean): void {
  (globalThis as unknown as { document: { documentElement: { dataset: Record<string, string> } } }).document = { documentElement: { dataset: web ? { platform: 'web' } : {} } };
}
beforeEach(() => {
  setLanguage('en');
  asWeb(false);
});
afterEach(() => setLanguage('pt-BR'));

const world = (): WorkspaceConfig => applyTemplate(neutralConfig(), agentFlow);
const agentOf = (c: WorkspaceConfig, id: string) => c.agents.team.find((a) => a.id === id)!;
const panel = (config: WorkspaceConfig, id: string): string =>
  renderToStaticMarkup(createElement(AgentPanel, { config, initial: draftOf(agentOf(config, id)), isNew: false, save: async (c: WorkspaceConfig) => c, onClose: () => undefined } as never));
const step = (cfg: WorkspaceConfig): string => {
  const props = { cfg, setCfg: () => undefined, view: { secrets: [], storage: {} }, refreshView: async () => ({}), reload: async () => undefined, avail: null, goTo: () => undefined };
  return renderToStaticMarkup(createElement(ModelsStep, props as never));
};
const stagePanel = (config: WorkspaceConfig, stage: StageDef): string =>
  renderToStaticMarkup(
    createElement(StagePanel, { stages: config.devCycle.stages, stage, team: config.agents.team, takenIds: [], commentKeys: [], issues: [], onPatch: () => undefined, onRename: () => undefined, onCreateAgent: () => undefined, onDuplicate: () => undefined, onRemove: () => undefined, onClose: () => undefined } as never),
  );
const checked = (html: string, label: string): boolean => new RegExp(`<input[^>]*type="radio"[^>]*checked=""[^>]*/?>\\s*<span><span class="wz-card-title">${label}`).test(html);

describe('the workspace default, in the Models step', () => {
  it('offers the three modes with what each does, and has delegate selected when the file says nothing', () => {
    const out = step(world());
    expect(out).toContain('How a pool is used');
    for (const label of ['Reserve only', 'Switch by activity', 'Main model with sub-agents']) expect(out).toContain(label);
    expect(out).toContain('keeps its cache');
    expect(out).toContain('Saving such a list starts delegation by itself');
    expect((out.match(/name="pool-mode"/g) ?? []).length).toBe(3);
    expect(checked(out, 'Main model with sub-agents')).toBe(true);
    expect(checked(out, 'Reserve only')).toBe(false);
  });

  it('selects the one the config holds, and is in Portuguese too', () => {
    const c = world();
    c.llm.poolMode = 'switch';
    expect(checked(step(c), 'Switch by activity')).toBe(true);
    setLanguage('pt-BR');
    const out = step(c);
    expect(out).toContain('Como o conjunto é usado');
    expect(out).toContain('Principal com subagentes');
    expect(out).toContain('Só reserva');
  });
});

describe('the agent\'s own choice', () => {
  it('is a choice between inheriting and the three modes, inheriting by default, with the hint of what is chosen', () => {
    const c = world();
    const html = panel(c, 'developer');
    expect(html).toContain('Use of the pool of models');
    expect(html).toMatch(/<option value="" selected="">The stage&#x27;s or the workspace&#x27;s<\/option>/);
    for (const label of ['Reserve only', 'Switch by activity', 'Main model with sub-agents']) expect(html).toContain(`>${label}</option>`);
    expect(html).toContain('Follows the stage of the cycle');
    agentOf(c, 'developer').poolMode = 'switch';
    const chosen = panel(c, 'developer');
    expect(chosen).toMatch(/<option value="switch" selected="">Switch by activity<\/option>/);
    expect(chosen).toContain('Each switch loses the prompt cache');
  });

  it('warns that delegation does nothing while the switch of sub-agents is off for how the agent runs', () => {
    const c = world();
    const dev = agentOf(c, 'developer');
    dev.poolMode = 'delegate';
    expect(panel(c, 'developer')).not.toContain('sub-agents switch is off');
    // An agent that writes runs its stages under the workspace's tools: its own tools do not count.
    dev.tools = { ...c.agents.tools, subagents: false };
    expect(panel(c, 'developer')).not.toContain('sub-agents switch is off');
    c.agents.tools.subagents = false;
    expect(panel(c, 'developer')).toContain('sub-agents switch is off');
    // Another mode has nothing to warn about.
    dev.poolMode = 'fallback';
    expect(panel(c, 'developer')).not.toContain('sub-agents switch is off');
  });

  it('knows which tools an agent runs with', () => {
    const c = world();
    const reader = { permission: 'read' as const, tools: { ...c.agents.tools, subagents: false } };
    expect(subagentsOff(c, reader)).toBe(true);
    expect(subagentsOff(c, { permission: 'worktree', tools: reader.tools })).toBe(false);
    expect(subagentsOff(c, { permission: 'read', tools: null })).toBe(false);
  });

  it('is there for a paired browser too: it changes no reach', () => {
    asWeb(true);
    const html = panel(world(), 'developer');
    expect(html).toContain('Use of the pool of models');
  });

  it('is in Portuguese', () => {
    setLanguage('pt-BR');
    const html = panel(world(), 'developer');
    expect(html).toContain('Uso do conjunto de modelos');
    expect(html).toContain('O da etapa ou do workspace');
    expect(html).toContain('Principal com subagentes');
  });

  it('is written to the config only when chosen, and the form saving something else keeps it', () => {
    const c = world();
    const set = applyAgent(c, { ...draftOf(agentOf(c, 'developer')), poolMode: 'delegate' }, false);
    expect(agentOf(set, 'developer').poolMode).toBe('delegate');
    expect('poolMode' in agentOf(applyAgent(c, draftOf(agentOf(c, 'developer')), false), 'developer')).toBe(false);
  });
});

describe('the stage\'s choice, in the flow editor', () => {
  it('is offered on a work stage, as a choice between inheriting and the three modes', () => {
    const c = world();
    const work = c.devCycle.stages.find((s) => (s.type ?? 'work') === 'work')!;
    const html = stagePanel(c, work);
    expect(html).toContain('Use of the pool of models');
    expect(html).toMatch(/<option value="" selected="">The agent&#x27;s or the workspace&#x27;s<\/option>/);
    for (const label of ['Reserve only', 'Switch by activity', 'Main model with sub-agents']) expect(html).toContain(`>${label}</option>`);
    expect(stagePanel(c, { ...work, poolMode: 'delegate' })).toMatch(/<option value="delegate" selected="">Main model with sub-agents<\/option>/);
  });

  it('is not offered on a gate or a wait: they run no agent', () => {
    const c = world();
    const gate = c.devCycle.stages.find((s) => s.type === 'gate')!;
    expect(stagePanel(c, gate)).not.toContain('Use of the pool of models');
  });

  it('is set and cleared by the panel\'s patch, and kept by the draft that makes the config', () => {
    const c = world();
    const work = c.devCycle.stages.find((s) => (s.type ?? 'work') === 'work')!;
    const set = patchStage(c.devCycle.stages, work.id, { poolMode: 'switch' });
    expect(set.find((s) => s.id === work.id)?.poolMode).toBe('switch');
    const cleared = patchStage(set, work.id, { poolMode: undefined });
    expect('poolMode' in cleared.find((s) => s.id === work.id)!).toBe(false);
    const made = applyFlows(c, { workspace: set, flows: {}, autonomy: {}, renames: {}, comments: {}, newAgents: [] } as never);
    expect(made.devCycle.stages.find((s) => s.id === work.id)?.poolMode).toBe('switch');
  });
});
