// The persona asked from a paired phone (#248): the same chat, through the HTTP door, makes the persona act with the reach of the table, with what the phone alone cannot do
// (`config:save` is denied to a browser), and the audit says the request came from a paired browser; asked from the window it says the window, and a message that waited for
// Resume keeps the door it came by. The model is a fake OpenAI server; nothing else is real.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { agentThreadId } from '../src/shared/forum';
import { setLanguage } from '../src/shared/i18n';
import { type Fake, type Step, fakeOpenAI, textStep, toolStep } from './helpers/fakeOpenAI';

let home: string;
let fake: Fake;
let script: (req: Fake['requests'][number]) => Step = () => textStep('ok');
const steps = (...list: Step[]) => {
  const queue = [...list];
  script = () => queue.shift() ?? textStep('(nothing scripted)');
};

type Handler = (...args: unknown[]) => unknown;
const ipc = new Map<string, Handler>();
const THREAD = agentThreadId('me');
const why = 'The person asked me to.';

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'persona-phone-'));
  mkdirSync(join(home, 'projects'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('COXIA_ENGINE', 'open');
  vi.stubEnv('COXIA_LLM_OPENAI_MODEL', 'fake-model');
  vi.stubEnv('COXIA_LLM_OPENAI_KEY', 'sk-local-test');
  fake = await fakeOpenAI((req) => script(req));
  vi.stubEnv('COXIA_LLM_OPENAI_BASEURL', fake.url);
  setLanguage('en');
  const { saveConfig } = await import('../src/main/workspaceConfig');
  const base = neutralConfig();
  saveConfig({ ...base, language: 'en', agents: { ...base.agents, team: [...base.agents.team, newAgent({ id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' })] } });
  const { bindIpc, handle } = await import('../src/main/rpc');
  bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
  const ctx = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined };
  const { forumModule, forumStore } = await import('../src/main/forum');
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  const { configModule } = await import('../src/main/configModule');
  const { mentionsModule } = await import('../src/main/mentions/module');
  const { personaModule } = await import('../src/main/persona/module');
  mkdirSync(join((await import('../src/main/env')).atasDir(), 'forum'), { recursive: true });
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  for (const register of [forumModule, configModule, mentionsModule, personaModule]) register(ctx as never);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
  rmSync(home, { recursive: true, force: true });
});

beforeEach(async () => {
  const { personaStop } = await import('../src/main/persona/runtime');
  if (personaStop().stopped()) personaStop().resume('window');
});

describe('the persona asked from a paired phone', () => {
  it('acts with what the phone alone cannot do, and the audit says the request came from a paired browser; from the window it says the window', async () => {
    const { webAccess } = await import('../src/main/webPolicy');
    const { invoke } = await import('../src/main/rpc');
    const { mentionsIdle } = await import('../src/main/mentions/module');
    const { listAudit } = await import('../src/main/auditoria');
    const { getConfig } = await import('../src/main/workspaceConfig');
    // the phone cannot save the configuration by itself
    expect(webAccess('config:save')).toBe('deny');

    steps(toolStep([{ name: 'Settings', args: { op: 'set', path: 'agents.team[me].shell', value: 'sandbox', why } }]), textStep('Done from the phone.'));
    await invoke('forum:post', [THREAD, 'Let yourself run the tests in the sandbox, please'], 'device-1');
    await mentionsIdle();
    expect(getConfig().agents.team.find((a) => a.id === 'me')?.shell).toBe('sandbox');
    const fromPhone = listAudit().find((e) => e.kind === 'config' && e.actor === 'persona');
    expect(fromPhone).toMatchObject({ door: 'paired', said: why, fields: { raised: 'agents.team[me].shell' } });

    steps(toolStep([{ name: 'Settings', args: { op: 'set', path: 'agents.team[me].shell', value: 'none', why } }]), textStep('Done from the window.'));
    await ipc.get('forum:post')?.(THREAD, 'And back to none, please');
    await mentionsIdle();
    expect(getConfig().agents.team.find((a) => a.id === 'me')?.shell).toBe('none');
    const fromWindow = listAudit().filter((e) => e.kind === 'config' && e.actor === 'persona')[0];
    expect(fromWindow).toMatchObject({ door: 'window' });
    expect(fromWindow.id).not.toBe(fromPhone?.id);
  });

  it('keeps the door a message came by when the message waited for Resume', async () => {
    const { invoke } = await import('../src/main/rpc');
    const { mentionsIdle } = await import('../src/main/mentions/module');
    const { personaStop } = await import('../src/main/persona/runtime');
    const { listAudit } = await import('../src/main/auditoria');
    const { forumStore } = await import('../src/main/forum');
    const before = listAudit().filter((e) => e.kind === 'config' && e.actor === 'persona').length;
    personaStop().stop('window');
    steps(toolStep([{ name: 'Settings', args: { op: 'set', path: 'agents.team[me].shell', value: 'sandbox', why } }]), textStep('Done after Resume.'));
    // written from the phone while the persona is stopped: nothing runs
    await invoke('forum:post', [THREAD, 'Sandbox, please'], 'device-1');
    await mentionsIdle();
    expect(listAudit().filter((e) => e.kind === 'config' && e.actor === 'persona')).toHaveLength(before);
    // resumed from the window: the waiting message is answered, still as a request from the phone
    personaStop().resume('window');
    await mentionsIdle();
    const lines = listAudit().filter((e) => e.kind === 'config' && e.actor === 'persona');
    expect(lines).toHaveLength(before + 1);
    expect(lines[0]).toMatchObject({ door: 'paired' });
    expect((forumStore().read(THREAD, 0, 2000)?.messages ?? []).at(-1)?.text).toBe('Done after Resume.');
  });

  it('can be stopped and resumed from the phone with the external-effects switch off', async () => {
    const { webAccess, EXTERNAL_EFFECT } = await import('../src/main/webPolicy');
    for (const channel of ['persona:stop', 'persona:resume', 'persona:state']) {
      expect(webAccess(channel), channel).toBe('allow');
      expect(EXTERNAL_EFFECT.has(channel), channel).toBe(false);
    }
    const { invoke } = await import('../src/main/rpc');
    const stopped = (await invoke('persona:stop', [], 'device-1')) as { stopped: boolean; door: string };
    expect(stopped).toMatchObject({ stopped: true, door: 'paired' });
    const resumed = (await invoke('persona:resume', [], 'device-1')) as { stopped: boolean };
    expect(resumed.stopped).toBe(false);
  });
});
