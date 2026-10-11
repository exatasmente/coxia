// The audit that says who (#248): the stamp of a persona's act on every line written while it is open, the bounds and masks of what it had read, the lines that did not exist
// (configuration, secret, plugin decision) for the person's own changes, and that nothing writes the audit but the app.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AuditBasis, AuditEntry, AuditKind } from '../src/shared/auditoria';
import { neutralConfig } from '../src/shared/config';
import { newAgent } from '../src/shared/config/team';
import { promptEntries } from '../src/shared/cycles/prompts';
import { PLUGIN_CONTRACT } from '../src/shared/plugins/declaration';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', whenReady: () => Promise.resolve() }, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] }, dialog: {}, nativeImage: {} }));

const { bindIpc, handle, invoke, invokePersona } = await import('../src/main/rpc');
const { newActId, runAct } = await import('../src/main/persona/act');
const { boundBasis, listAudit, recordWrite } = await import('../src/main/auditoria');
const { configAuditEntry, auditPaths, valueWords } = await import('../src/main/configAudit');
const { configModule } = await import('../src/main/configModule');
const { pluginsModule, pluginsDir } = await import('../src/main/plugins/module');
const { getConfig, saveConfig } = await import('../src/main/workspaceConfig');

type Act = import('../src/main/persona/act').Act;
type Handler = (...args: unknown[]) => unknown;

const SRC = join(import.meta.dirname, '../src/main');
const ipc = new Map<string, Handler>();
bindIpc((channel, fn) => ipc.set(channel, fn as Handler));
const ctx = { handle: (channel: string, fn: unknown) => handle(channel, fn as never), notify: () => undefined, emit: () => undefined, job: () => undefined };
configModule(ctx);
pluginsModule(ctx);
const asWindow = async (channel: string, ...args: unknown[]) => ipc.get(channel)?.(...args);
const asPaired = (channel: string, ...args: unknown[]) => invoke(channel, args, 'device-1');

const makeAct = (over: Partial<Act> = {}): Act => ({ open: true, id: newActId(), door: 'window', said: '', mask: (t) => t, wrote: { count: 0, kinds: new Set<AuditKind>() }, ...over });
const base = (over: Partial<Omit<AuditEntry, 'at'>> = {}): Omit<AuditEntry, 'at'> => ({ kind: 'sync', issue: 7, target: 'POST /x', via: 'test', fields: { a: 'b' }, ok: true, code: null, result: 'done', origin: { actionId: '', kind: 'k', key: 'k', summary: null }, by: null, ...over });
const newest = (kind: AuditKind, n = 0): AuditEntry => listAudit().filter((e) => e.kind === kind)[n];

describe('the stamp of a persona act', () => {
  it('says the persona, the door, the act and its reason on a line written while the act is open', () => {
    const act = makeAct({ door: 'paired', said: 'The release is ready.' });
    runAct(act, () => recordWrite(base({ target: 'POST /stamped' })));
    const line = listAudit().find((e) => e.target === 'POST /stamped');
    expect(line).toMatchObject({ actor: 'persona', door: 'paired', id: act.id, said: 'The release is ready.' });
    expect(act.wrote.count).toBe(1);
    expect([...act.wrote.kinds]).toEqual(['sync']);
  });

  it('cannot be overridden by the handler, and leaves by (the agent whose autonomy let it go out) alone', () => {
    const act = makeAct({ door: 'window', said: 'Real reason.' });
    runAct(act, () => recordWrite(base({ target: 'POST /forged', by: 'developer', door: 'paired', id: 'a-forged', said: 'forged', actor: undefined, basis: { subject: 'forged', reads: [], message: null } })));
    const line = listAudit().find((e) => e.target === 'POST /forged');
    expect(line).toMatchObject({ actor: 'persona', door: 'window', id: act.id, said: 'Real reason.', by: 'developer' });
    expect(line?.basis).toBeUndefined();
  });

  it('counts every line of an act under one id, and an approval of several host writes is several lines', () => {
    const act = makeAct();
    runAct(act, () => {
      recordWrite(base({ target: 'PUT /one' }));
      recordWrite(base({ target: 'PUT /two', kind: 'push' }));
    });
    const lines = listAudit().filter((e) => e.id === act.id);
    expect(lines.map((e) => e.target).sort()).toEqual(['PUT /one', 'PUT /two']);
    expect(act.wrote).toEqual({ count: 2, kinds: new Set(['sync', 'push']) });
  });

  it('stamps nothing once the act has settled, and nothing for a person', () => {
    const act = makeAct();
    act.open = false;
    runAct(act, () => recordWrite(base({ target: 'POST /after' })));
    recordWrite(base({ target: 'POST /person' }));
    for (const target of ['POST /after', 'POST /person']) {
      const line = listAudit().find((e) => e.target === target) as AuditEntry;
      expect(line.actor).toBeUndefined();
      expect(line.door).toBeUndefined();
      expect(line.id).toBeUndefined();
      expect(line.said).toBeUndefined();
    }
    expect(act.wrote.count).toBe(0);
  });

  it('masks everything the act writes by the value of a secret it read, and by the app redaction', () => {
    const value = 'correct horse battery staple';
    const act = makeAct({ mask: (t) => t.split(value).join('[secret]'), said: `used ${value} and glpat-abcdefghij0123456789` });
    runAct(act, () => recordWrite(base({ target: 'POST /masked', fields: { note: `the value is ${value}` }, result: `sent ${value}` })));
    const line = listAudit().find((e) => e.target === 'POST /masked') as AuditEntry;
    expect(JSON.stringify(line)).not.toContain(value);
    expect(JSON.stringify(line)).not.toContain('abcdefghij0123456789');
    expect(line.fields.note).toBe('the value is [secret]');
  });
});

describe('what it had read', () => {
  const read = (n: number, excerpt = 'x'.repeat(500)) => ({ tool: 'Runs', op: `get${n}`, target: `run-${n}`, excerpt });
  const basis = (over: Partial<AuditBasis> = {}): AuditBasis => ({ subject: 'Approve the push of the branch', reads: Array.from({ length: 12 }, (_, i) => read(i)), message: 42, ...over });

  it('keeps eight reads, each excerpt within 240 characters, the whole within 2,000, and the message number', () => {
    const bound = boundBasis(makeAct(), basis());
    expect(bound.reads).toHaveLength(8);
    expect(Math.max(...bound.reads.map((r) => r.excerpt.length))).toBeLessThanOrEqual(240);
    expect(JSON.stringify(bound).length).toBeLessThanOrEqual(2000);
    expect(bound.message).toBe(42);
    expect(bound.subject).toBe('Approve the push of the branch');
    // The newest reads go first and survive: the oldest give way.
    expect(bound.reads[0].op).toBe('get0');
  });

  it('drops the oldest reads before the subject when the whole is still too long', () => {
    const bound = boundBasis(makeAct(), basis({ subject: 's'.repeat(300), reads: Array.from({ length: 8 }, (_, i) => ({ tool: 'T'.repeat(40), op: 'o'.repeat(40), target: 't'.repeat(120), excerpt: `${i}`.repeat(240) })) }));
    expect(JSON.stringify(bound).length).toBeLessThanOrEqual(2000);
    // The newest read stays, the oldest are gone, and the subject is untouched while reads can still give way.
    expect(bound.reads.length).toBeLessThan(8);
    expect(bound.reads[0].target).toBe('t'.repeat(120));
    expect(bound.subject).toBe('s'.repeat(300));
  });

  it('masks a token, a value the persona read and a typed value in every string of it', () => {
    const value = 'tr0ub4dor&3-and-more';
    const act = makeAct({ mask: (t) => t.split(value).join('[secret]') });
    const bound = boundBasis(act, { subject: `Answer ${value}`, reads: [{ tool: 'Secrets', op: 'read', target: 'glpat-abcdefghij0123456789', excerpt: `value ${value} and token glpat-abcdefghij0123456789` }], message: null });
    const text = JSON.stringify(bound);
    expect(text).not.toContain(value);
    expect(text).not.toContain('abcdefghij0123456789');
    expect(bound.message).toBeNull();
  });

  it('is written into the line of the act with the subject the app read, whatever the model said', () => {
    const act = makeAct({ said: 'It is only a small fix.', basis: basis({ subject: 'Force-push the release branch to the shared remote', reads: [read(1, 'the run is green')] }) });
    runAct(act, () => recordWrite(base({ target: 'POST /basis' })));
    const line = listAudit().find((e) => e.target === 'POST /basis') as AuditEntry;
    expect(line.said).toBe('It is only a small fix.');
    expect(line.basis?.subject).toBe('Force-push the release branch to the shared remote');
    expect(line.basis?.reads).toHaveLength(1);
    expect(JSON.stringify(line).length).toBeLessThan(4000);
  });
});

describe('the configuration line', () => {
  const withAgent = (shell: 'none' | 'sandbox' | 'host') => {
    const c = neutralConfig();
    c.agents.team.push(newAgent({ id: 'me', name: 'Me', job: 'Works.', instructions: 'Private instructions the person wrote.', shell }));
    return c;
  };

  it('names the changed paths with the old and new value of a choice, a boolean and a number, and only the length of a text', () => {
    const before = withAgent('none');
    const after = structuredClone(before);
    after.notifications = !before.notifications;
    after.retention.days = before.retention.days + 1;
    const me = after.agents.team.find((a) => a.id === 'me');
    if (!me) throw new Error('no agent');
    me.shell = 'sandbox';
    me.instructions = 'A new private instruction text that must not be copied.';
    const line = configAuditEntry(before, after, { op: 'save', via: 'window' });
    expect(line).toMatchObject({ kind: 'config', target: 'config:save', via: 'window', ok: true });
    expect(line?.fields).toMatchObject({
      notifications: `${before.notifications} → ${after.notifications}`,
      'retention.days': `${before.retention.days} → ${after.retention.days}`,
      'agents.team[me].shell': 'none → sandbox',
      'agents.team[me].instructions': `len=${before.agents.team.find((a) => a.id === 'me')?.instructions.length} → len=${me.instructions.length}`,
      changed: '4',
    });
    expect(JSON.stringify(line)).not.toContain('private instruction');
  });

  it('says nothing when nothing changed', () => {
    const c = withAgent('none');
    expect(configAuditEntry(c, structuredClone(c), { op: 'save', via: 'window' })).toBeNull();
  });

  it('shows the first twenty paths and counts them all', () => {
    const before = neutralConfig();
    const after = structuredClone(before);
    after.agents.team = before.agents.team.map((a) => ({ ...a, name: `${a.name}!` }));
    for (let i = 0; i < 30; i++) after.devCycle.promptOverrides = { ...after.devCycle.promptOverrides, [`p${i}`]: { en: `text ${i}` } } as never;
    const line = configAuditEntry(before, after, { op: 'save', via: 'window' });
    const paths = Object.keys(line?.fields ?? {}).filter((k) => k !== 'changed' && k !== 'raised');
    expect(paths).toHaveLength(20);
    expect(Number(line?.fields.changed)).toBeGreaterThan(20);
  });

  it('marks a raise of reach with the names of the fields, not their values', () => {
    const before = withAgent('none');
    const after = structuredClone(before);
    const me = after.agents.team.find((a) => a.id === 'me');
    if (!me) throw new Error('no agent');
    me.shell = 'host';
    me.screen = true;
    me.allowedCommands = ['git push:*'];
    after.runner.autonomy = { ...after.runner.autonomy, push: true };
    const line = configAuditEntry(before, after, { op: 'act', via: 'persona' });
    const raised = (line?.fields.raised ?? '').split(', ');
    expect(raised).toEqual(expect.arrayContaining(['agents.team[me].shell', 'agents.team[me].screen', 'agents.team[me].allowedCommands', 'runner.autonomy.push']));
    expect(line?.result).toBe('raised');
    expect(line?.via).toBe('persona');
    expect(JSON.stringify(line)).not.toContain('git push');
  });

  it('does not mark a lowering, and walks a list of identified objects by id', () => {
    const before = withAgent('host');
    const after = structuredClone(before);
    const me = after.agents.team.find((a) => a.id === 'me');
    if (!me) throw new Error('no agent');
    me.shell = 'none';
    expect(configAuditEntry(before, after, { op: 'save', via: 'window' })?.fields.raised).toBeUndefined();
    expect(auditPaths(before, after)).toEqual(['agents.team[me].shell']);
    after.agents.team = after.agents.team.filter((a) => a.id !== 'me');
    expect(auditPaths(before, after)).toEqual(['agents.team[me]']);
  });

  it('shows a value only when it is a choice and not a text a person wrote', () => {
    expect(valueWords('agents.team[a].shell', 'host')).toBe('host');
    expect(valueWords('agents.team[a].name', 'ana')).toBe('len=3');
    expect(valueWords('agents.team[a].instructions', 'ok')).toBe('len=2');
    expect(valueWords('x', 'a long sentence with spaces')).toBe('len=27');
    expect(valueWords('x', ['a', 'b'])).toBe('len=2');
    expect(valueWords('x', undefined)).toBe('—');
  });
});

describe("the person's own changes write the lines too", () => {
  const configLines = () => listAudit().filter((e) => e.kind === 'config');

  it('a config:save from the window writes a config line with paths and no text', async () => {
    const before = configLines().length;
    const next = { ...getConfig(), notifications: !getConfig().notifications, userName: 'Some Name' };
    await asWindow('config:save', next);
    const line = configLines()[0];
    expect(configLines()).toHaveLength(before + 1);
    expect(line).toMatchObject({ target: 'config:save', via: 'window', fields: { notifications: expect.stringContaining('→'), userName: 'len=0 → len=9' } });
    expect(line.actor).toBeUndefined();
    expect(JSON.stringify(line)).not.toContain('Some Name');
  });

  it('a config:cycle-save from a paired browser writes one saying paired', async () => {
    const config = getConfig();
    const next = { ...config, runner: { ...config.runner, showReasoning: !config.runner.showReasoning } };
    await asPaired('config:cycle-save', next);
    expect(configLines()[0]).toMatchObject({ target: 'config:cycle-save', via: 'paired', fields: { 'runner.showReasoning': expect.stringContaining('→') } });
  });

  it('a save the validation refuses writes none, and one that changes nothing writes none', async () => {
    const before = configLines().length;
    await expect(asWindow('config:save', { ...getConfig(), language: 'klingon' })).rejects.toThrow();
    await asWindow('config:save', getConfig());
    expect(configLines()).toHaveLength(before);
  });

  it('a prompt override writes a config line that holds the length of the text, not the text', async () => {
    const id = promptEntries(getConfig().devCycle)[0].id;
    await asWindow('config:prompt-set', id, 'en', 'A very particular override text.');
    const line = configLines()[0];
    expect(line.target).toBe('config:prompt-set');
    expect(JSON.stringify(line)).not.toContain('particular override');
    // The override is a new entry, an object: only its size is said.
    expect(Object.entries(line.fields).filter(([k]) => k.startsWith('devCycle.promptOverrides')).map(([, v]) => v)).toEqual([expect.stringMatching(/^— → len=\d+$/)]);
    saveConfig(getConfig());
  });
});

describe('the secret line', () => {
  const secretLines = () => listAudit().filter((e) => e.kind === 'secret');

  it('records a set, with the name and the kind of source and never the value, the command, its arguments or the variable', async () => {
    await asWindow('config:secret-set', { ref: 'test.audit-env', source: 'env', name: 'SOME_SECRET_VARIABLE' });
    await asWindow('config:secret-set', { ref: 'test.audit-cmd', source: 'command', command: '/usr/local/bin/fetch-key', args: ['--vault', 'private-vault'] });
    const [cmd, env] = secretLines();
    expect(env).toMatchObject({ target: 'secret:set', via: 'window', ok: true, fields: { op: 'set', ref: 'test.audit-env', source: 'env' } });
    expect(cmd).toMatchObject({ fields: { op: 'set', ref: 'test.audit-cmd', source: 'command' } });
    const text = JSON.stringify([cmd, env]);
    for (const leak of ['SOME_SECRET_VARIABLE', '/usr/local/bin', 'fetch-key', 'private-vault']) expect(text).not.toContain(leak);
  });

  it('records a removal with the source it had, and a refusal as not ok with no message of the store', async () => {
    await asPaired('config:secret-remove', 'test.audit-env').catch(() => undefined);
    await asWindow('config:secret-remove', 'test.audit-cmd');
    expect(secretLines()[0]).toMatchObject({ target: 'secret:remove', fields: { op: 'remove', ref: 'test.audit-cmd', source: 'command' }, ok: true });
    await expect(asWindow('config:secret-set', { ref: 'Bad Ref!', source: 'env', name: 'X' })).rejects.toThrow();
    const refused = secretLines()[0];
    expect(refused).toMatchObject({ ok: false, result: 'refused', fields: { op: 'set' } });
    expect(refused.fields.ref).toBeUndefined();
  });

  it('records the acceptance of an insecure store with no name', async () => {
    await asWindow('config:secrets-accept-insecure');
    expect(secretLines()[0]).toMatchObject({ target: 'secret:accept-insecure', fields: { op: 'accept-insecure' } });
  });
});

describe('the plugin decision line', () => {
  const decisions = () => listAudit().filter((e) => e.kind === 'plugin-decision');

  function install(id: string): void {
    const dir = join(pluginsDir(), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'search.sh'), 'echo "$1"\n');
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ id, name: 'Audit plugin', contract: PLUGIN_CONTRACT, offers: { events: ['stage-finished'], documents: [], network: ['search.example.com'], write: { to: 'results', reversible: true }, entry: 'search.sh' } }));
  }

  it('records a switch and a revocation with the plugin and the need', async () => {
    install('audit-plugin');
    await asWindow('plugins:set-enabled', 'audit-plugin', true);
    await asWindow('plugins:revoke', 'audit-plugin', 'network');
    const [revoke, enable] = decisions();
    expect(enable).toMatchObject({ target: 'plugin:set-enabled', via: 'window', ok: true, fields: { op: 'set-enabled', plugin: 'audit-plugin', choice: 'on' } });
    expect(revoke).toMatchObject({ target: 'plugin:revoke', fields: { op: 'revoke', plugin: 'audit-plugin', need: 'network' } });
  });

  it('records a setting by its key and never its value, and the settings of the folder without the path', async () => {
    await expect(asWindow('plugins:set-setting', 'audit-plugin', 'token', 'a-value-never-recorded')).rejects.toThrow();
    await asWindow('plugins:settings', '/some/private/folder', 45);
    const [folder, setting] = decisions();
    expect(setting).toMatchObject({ ok: false, fields: { op: 'set-setting', plugin: 'audit-plugin', key: 'token' } });
    expect(folder).toMatchObject({ ok: true, fields: { op: 'settings' } });
    expect(JSON.stringify([setting, folder])).not.toMatch(/private\/folder|never-recorded/);
    await asWindow('plugins:settings', '', 30);
  });

  it('records an answer to a request that is gone as not done, with the choice', async () => {
    await expect(asPaired('plugins:answer', 'no-such-ask', 'always')).rejects.toThrow();
    expect(decisions()[0]).toMatchObject({ ok: false, via: 'paired', fields: { op: 'answer', choice: 'always' }, origin: { actionId: 'no-such-ask' } });
  });

  it('writes every decision channel of the module through the one writer', () => {
    const text = readFileSync(join(SRC, 'plugins/module.ts'), 'utf8');
    const lambdas = [...text.matchAll(/ctx\.handle\('(plugins:[a-z-]+)'[\s\S]*?(?=\n  ctx\.handle|\n  \/\/ The document types)/g)].map((m) => [m[1], m[0]]);
    expect(lambdas.map(([c]) => c)).toEqual(expect.arrayContaining(['plugins:set-enabled', 'plugins:settings', 'plugins:set-setting', 'plugins:set-secret', 'plugins:answer', 'plugins:revoke', 'plugins:revoke-write']));
    for (const [channel, body] of lambdas) if (channel !== 'plugins:list') expect(body, channel).toMatch(/decided\(/);
  });
});

describe('the audit has no writer but the app', () => {
  it('registers one channel, the reader, and no module adds a channel that writes, edits or deletes it', () => {
    const served: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'))) {
      for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/(?:ctx\.handle|handle)\(\s*'(auditoria:[\w-]+)'/g)) served.push(m[1]);
    }
    expect(served).toEqual(['auditoria:list']);
  });

  it('is not reachable by the persona door as a write: the door only wraps the handler of a channel, and there is no such handler', async () => {
    expect(() => invokePersona('auditoria:write', [])).toThrow();
    expect(ipc.has('auditoria:write')).toBe(false);
  });
});
