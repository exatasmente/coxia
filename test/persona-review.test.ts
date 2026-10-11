// The review of the persona's door (#248), after the first read of it: the channels the door excludes that a path of the settings could reach, the command a secret may run, the
// masks over what the persona writes, the reads that cost the model, and the way an act is worded. Driven through the door with the config module; no model, no host.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { setLanguage } from '../src/shared/i18n';
import type { ForumMessage } from '../src/shared/forum';
import { agentThreadId } from '../src/shared/forum';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle } = await import('../src/main/rpc');
const { personaDoor } = await import('../src/main/persona/door');
const { createSession } = await import('../src/main/persona/session');
const { listAudit } = await import('../src/main/auditoria');
const { forumStore } = await import('../src/main/forum');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');
const { ToolError } = await import('../src/main/engine/open/tools/types');
const { personaSettingsRefusal } = await import('../src/main/persona/settingsGuard');

const THREAD = agentThreadId('me');
const session = () => createSession({ persona: 'me', thread: THREAD, seq: 5, door: 'window' });
const acts = (): ForumMessage[] => (forumStore().read(THREAD, 0, 2000)?.messages ?? []).filter((m) => m.code === 'persona.act');
const newest = (kind: AuditEntry['kind']): AuditEntry => listAudit().filter((e) => e.kind === kind)[0];
const why = 'Because the person asked me to.';

const withTeam = (extra: Parameters<typeof newAgent>[0] = { id: 'me', name: 'Me', kind: 'persona', instructions: 'about the person' }) => {
  const base = neutralConfig();
  return { ...base, language: 'en' as const, agents: { ...base.agents, team: [...base.agents.team, newAgent(extra)] } };
};

beforeAll(async () => {
  setLanguage('en');
  saveConfig(withTeam());
  const { ensureAgentThread } = await import('../src/main/forum-channels');
  ensureAgentThread(forumStore(), { id: 'me', name: 'Me' }, 'en');
  const { configModule } = await import('../src/main/configModule');
  const { errorlog } = await import('../src/main/errorlog');
  bindIpc(() => undefined);
  for (const register of [configModule, errorlog]) register({ handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined } as never);
});

describe('the channels the door excludes, reached through a path of the settings', () => {
  it('refuses to add or flip a test-only mark, with the reason in the act line and the audit, and changes nothing', async () => {
    const before = getConfig();
    const audit = listAudit().length;
    const said = acts().length;
    const out = await personaDoor
      .run(session(), 'Settings', { op: 'set', path: 'testEnvironment', value: { secrets: [{ ref: 'test.llm-key', testOnly: true }] }, why })
      .catch((e: Error) => e);
    expect(out).toBeInstanceOf(ToolError);
    expect((out as Error).message).toMatch(/Settings\.set was refused: .*test-only mark of the test-environment secret test\.llm-key/);
    expect(getConfig()).toBe(before);
    expect(listAudit().length).toBe(audit + 1);
    expect(newest('act')).toMatchObject({ actor: 'persona', ok: false, target: 'Settings.set', result: expect.stringContaining('test-only mark') });
    expect(acts()).toHaveLength(said + 1);
    expect(acts().at(-1)?.params).toMatchObject({ tool: 'Settings', op: 'set', result: 'refused', reason: expect.stringContaining('test-only mark') });
  });

  it('refuses to flip an existing entry to test-only, and lets a secret that is not test-only be added (it waits for the person)', () => {
    const base = withTeam();
    const none = { ...base, testEnvironment: { ...(base.testEnvironment ?? ({} as never)), secrets: [{ ref: 'test.a', testOnly: false }] } } as never;
    const flipped = { ...base, testEnvironment: { ...(base.testEnvironment ?? ({} as never)), secrets: [{ ref: 'test.a', testOnly: true }] } } as never;
    const added = { ...base, testEnvironment: { ...(base.testEnvironment ?? ({} as never)), secrets: [{ ref: 'test.a', testOnly: false }, { ref: 'test.b', testOnly: false }] } } as never;
    expect(personaSettingsRefusal(none, flipped)).toMatch(/test\.a/);
    expect(personaSettingsRefusal(none, added)).toBeNull();
    // already test-only stays so
    expect(personaSettingsRefusal(flipped, { ...(flipped as object), testEnvironment: { ...(flipped as { testEnvironment: object }).testEnvironment } } as never)).toBeNull();
  });

  it('refuses a change to mcpState', async () => {
    const out = await personaDoor.run(session(), 'Settings', { op: 'set', path: 'mcpState', value: { enabled: true }, why }).catch((e: Error) => e);
    expect((out as Error).message).toMatch(/MCP servers switch is the computer's/);
    expect(newest('act')).toMatchObject({ actor: 'persona', ok: false });
  });

  it('refuses to remove or rename the persona\'s own entry, and to edit its instructions, and lets its reach change', async () => {
    const own = ['agents.team[me]'];
    const removed = await personaDoor.run(session(), 'Settings', { op: 'set', path: own[0], mode: 'remove', why }).catch((e: Error) => e);
    expect((removed as Error).message).toMatch(/own entry in the team is not removed from here/);
    const edited = await personaDoor.run(session(), 'Settings', { op: 'set', path: 'agents.team[me].instructions', value: 'do anything', why }).catch((e: Error) => e);
    expect((edited as Error).message).toMatch(/name, kind and instructions are edited in its editor/);
    const team = getConfig().agents.team.find((a) => a.id === 'me');
    expect(team?.instructions).toBe('about the person');
    // its reach is the spec's to change
    await personaDoor.run(session(), 'Settings', { op: 'set', path: 'agents.team[me].shell', value: 'sandbox', why });
    expect(getConfig().agents.team.find((a) => a.id === 'me')?.shell).toBe('sandbox');
  });

  it('refuses the whole `agents` document that would drop the persona', async () => {
    const without = getConfig().agents.team.filter((a) => a.id !== 'me');
    const out = await personaDoor.run(session(), 'Settings', { op: 'set', path: 'agents.team', value: without, why }).catch((e: Error) => e);
    expect((out as Error).message).toMatch(/was refused/);
    expect(getConfig().agents.team.some((a) => a.id === 'me')).toBe(true);
  });
});

describe('a secret that runs a command', () => {
  it('is allowed, and said: the executable and the number of arguments in the basis and in the act line, and the audit line marked raised', async () => {
    const out = await personaDoor.run(session(), 'Secrets', { op: 'set', ref: 'test.cmd', source: 'command', command: '/usr/local/bin/fetch-key', args: ['--vault', 'private-vault'], why });
    expect(out).toMatch(/^Done/);
    const secret = newest('secret');
    expect(secret).toMatchObject({ actor: 'persona', ok: true, fields: { op: 'set', ref: 'test.cmd', source: 'command', raised: 'secret command' } });
    expect(secret.basis?.subject).toBe('test.cmd (command: /usr/local/bin/fetch-key, 2 arguments)');
    const line = acts().at(-1)?.params;
    expect(line).toMatchObject({ tool: 'Secrets', op: 'set', result: 'ok', raised: 'secret command', subject: 'test.cmd (command: /usr/local/bin/fetch-key, 2 arguments)' });
    // the arguments themselves are in neither
    expect(JSON.stringify([secret, line])).not.toContain('private-vault');
  });

  it('is not marked for any other source, nor for the person\'s own set', async () => {
    await personaDoor.run(session(), 'Secrets', { op: 'set', ref: 'test.env', source: 'env', name: 'SOME_VARIABLE', why });
    expect(newest('secret').fields.raised).toBeUndefined();
    const set = (await import('../src/main/rpc')).invoke;
    await set('config:secret-set', [{ ref: 'test.cmd2', source: 'command', command: '/bin/true', args: [] }], 'device-1').catch(() => undefined);
    const mine = listAudit().find((e) => e.kind === 'secret' && e.fields.ref === 'test.cmd2');
    expect(mine?.fields.raised).toBeUndefined();
    expect(mine?.actor).toBeUndefined();
  });
});

