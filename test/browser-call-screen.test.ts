// The screen step approvals of a call (#269): read once when the call opens its screen, handed to every browser step and confirmation of the call, and said in its prompt.
// A change of the config in the middle of a stage waits for the next call. Fakes only: no screen, no browser, no config file.
import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/shared/i18n';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import type { ScreenPolicy } from '../src/shared/config/screenPolicy';
import type { WorkspaceConfig } from '../src/shared/config/types';
import { openCallScreen, policyOf, type ScreenPorts } from '../src/main/browser/callScreen';
import type { CallOptions } from '../src/main/browser/intermediary';

beforeEach(() => setLanguage('en'));

function world(policy: ScreenPolicy) {
  let config: WorkspaceConfig = { ...neutralConfig(), runner: { ...neutralConfig().runner, screenPolicy: policy } };
  config.agents.team.push(newAgent({ id: 'scout', screen: true }));
  const seen: (CallOptions | undefined)[] = [];
  const confirmed: string[] = [];
  const autonomous: string[] = [];
  const lease = {
    key: 'run:1',
    browser: { tools: () => [], call: async (_tool: string, _args: unknown, o?: CallOptions) => (seen.push(o), { text: '', images: [], isError: false }) },
    context: { key: 'run:1', agent: 'scout', place: 'stage' as const },
    profile: 'none' as const,
    display: null,
    closed: new AbortController().signal,
    release: () => undefined,
  };
  const ports = {
    sessions: { acquire: async () => ({ ok: true, lease }) },
    asks: { confirm: async (a: { words: string }) => (confirmed.push(a.words), { answer: 'no' as const }), autonomous: (a: { words: string }) => void autonomous.push(a.words) },
    config: () => config,
  } as unknown as ScreenPorts;
  const open = () => openCallScreen(ports, { key: 'run:1', agent: { id: 'scout', screen: true, shell: 'none' }, thread: 't', place: 'stage', seesImages: false });
  return { ports, open, seen, confirmed, autonomous, change: (p: ScreenPolicy) => (config = { ...config, runner: { ...config.runner, screenPolicy: p } }) };
}

describe('the policy of a call', () => {
  it('holds everything when nothing is set, and when the config cannot be read', () => {
    const w = world({});
    expect(policyOf(w.ports, 'scout').name).toEqual({ mode: 'held', source: 'default' });
    expect(policyOf({ config: () => { throw new Error('no config'); } }, 'scout').name.mode).toBe('held');
  });

  it('goes with every browser step of the call, and stays the one the call opened with', async () => {
    const w = world({ name: 'autonomous' });
    const call = await w.open();
    expect(call.policy?.name).toEqual({ mode: 'autonomous', source: 'workspace' });
    w.change({});
    await call.toolset?.browser?.call('browser_click', { target: 'e1' });
    expect(w.seen[0]?.policy?.name.mode).toBe('autonomous');
    // The next call (the next stage) reads the new one.
    const next = await w.open();
    await next.toolset?.browser?.call('browser_click', { target: 'e1' });
    expect(w.seen[1]?.policy?.name.mode).toBe('held');
  });

  it('answers a released confirmation without asking, and still asks for a payment, a sending and sensitive words', async () => {
    const w = world({ agent: 'autonomous' });
    const c = await w.open();
    expect(await c.toolset?.confirm?.({ confirmKind: 'save', words: 'save the draft' })).toEqual({ answer: 'yes' });
    expect(w.autonomous).toEqual(['save the draft']);
    for (const ask of [{ confirmKind: 'pay', words: 'the invoice' }, { confirmKind: 'send', words: 'the report' }, { confirmKind: 'other', words: 'type the password' }] as const) await c.toolset?.confirm?.(ask);
    expect(w.confirmed).toEqual(['the invoice', 'the report', 'type the password']);
    expect(c.policy?.agent.mode).toBe('autonomous');
  });

  it('asks for every confirmation when the kind is held', async () => {
    const w = world({});
    const c = await w.open();
    expect(await c.toolset?.confirm?.({ confirmKind: 'save', words: 'save the draft' })).toEqual({ answer: 'no' });
    expect(w.autonomous).toEqual([]);
  });
});
