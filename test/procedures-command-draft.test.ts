import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import type { ProcedureRecord } from '../src/shared/procedures';
import type { ExecEntry } from '../src/main/procedures/commands';
import { procedureMcpServer, procedureToolImpls } from '../src/main/procedures/engineTool';
import { procedureScreen } from '../src/main/procedures/screen';
import { createProcedureSession, type CommandSource, type ProcedureSession } from '../src/main/procedures/session';
import { createProcedureStore, proceduresPath } from '../src/main/procedures/store';
import { DRAFT_TOOL, PROCEDURE_TOOLS, procedureToolNames, procedureToolSpecs } from '../src/main/procedures/tools';
import { createTypedValues } from '../src/main/screen/typedValues';
import { fakeSteps } from './helpers/screenSteps';

// The command draft (#187, spec rules 2, 3 and 7; acceptance 3): `procedures_draft` for a call with a shell, and `procedures_save` of a repo or tool from a c- draft. The log is
// a fake; no sandbox runs. Commands are neutral.

const KEY = 'call:t-1:agent';
let ws: string;
let counter: number;
let audits: Omit<AuditEntry, 'at'>[];
let notes: { code: string; params: Record<string, string | number> }[];

/** A log the test grows as the "agent" runs commands. */
function shell(): { source: CommandSource; ran: (command: string, exitCode?: number | null, more?: Partial<ExecEntry>) => void; log: ExecEntry[] } {
  const log: ExecEntry[] = [];
  return {
    log,
    source: { entries: () => log },
    ran: (command, exitCode = 0, more = {}) => void log.push({ n: log.length + 1, command, exitCode, timedOut: false, ...more }),
  };
}

function make(o: { commands?: CommandSource | null; browser?: boolean; repos?: string[]; typed?: ReturnType<typeof createTypedValues> } = {}): { session: ProcedureSession; f: ReturnType<typeof fakeSteps> } {
  const f = fakeSteps(KEY);
  const screen = o.browser ? procedureScreen({ key: KEY, sessions: f.sessions, typed: o.typed, browser: true }) : o.typed ? procedureScreen({ key: KEY, sessions: f.sessions, typed: o.typed, browser: false }) : undefined;
  const store = createProcedureStore(ws, { hex: () => (++counter).toString(16).padStart(8, '0') });
  const session = createProcedureSession(
    { store, note: (code, params) => notes.push({ code, params }), audit: (e) => audits.push(e) },
    {
      writer: { by: 'agent', surface: 'stage', stage: 'development', ref: 'app#123', permission: 'worktree', shell: 'sandbox' },
      workspaceRepos: ['api', 'web'],
      select: { repos: o.repos ?? ['api'], stageKind: 'development', tools: [], hosts: [], language: 'en' },
      home: '/home/someone',
      ...(screen ? { screen } : {}),
      ...(o.commands ? { commands: o.commands } : {}),
    },
  );
  return { session, f };
}

const files = (): string[] => (existsSync(proceduresPath(ws)) ? readdirSync(proceduresPath(ws)).filter((x) => /^p-.*\.json$/.test(x)) : []);
const onDisk = (id: string): ProcedureRecord => JSON.parse(readFileSync(join(proceduresPath(ws), `${id}.json`), 'utf8'));

/** A script fought and fixed: a failed test run, then one that works. */
function fought(s: ReturnType<typeof shell>): void {
  s.ran('npm ci');
  s.ran('npm test', 1);
  s.ran('npm test -- --runInBand');
  s.ran('npm run build');
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-cmd-'));
  counter = 0;
  audits = [];
  notes = [];
});

describe('procedures_draft for a call with a shell', () => {
  it('is offered to a call with a shell and no browser, and says which drafts it can make', () => {
    const s = shell();
    const { session } = make({ commands: s.source });
    expect(session.tools.draft).toBeTypeOf('function');
    expect(session.has).toEqual({ screen: false, commands: true });
    expect(session.tools.has).toEqual({ screen: false, commands: true });
    const bare = make();
    expect(bare.session.tools.draft).toBeUndefined();
    expect(bare.session.has).toEqual({ screen: false, commands: false });
    const both = make({ commands: s.source, browser: true });
    expect(both.session.has).toEqual({ screen: true, commands: true });
  });

  it('answers with c-1: the steps with their commands inside a data fence, the pitfalls, and how to save', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toMatch(/^Draft c-1\./);
    expect(text).toContain('<data>');
    expect(text).toContain('1. Run npm ci\n   run: npm ci');
    expect(text).toContain('2. Run npm test\n   run: npm test -- --runInBand');
    expect(text).toContain('Failed (exit 1): npm test');
    expect(text).toContain('procedures_save: kind repo, key api');
    expect(text).toContain('draft "c-1"');
    expect(text).toContain('you cannot add a step or change a command');
    expect(files()).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('suggests a tool by the program with most steps when the call has no single repository', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source, repos: ['api', 'web'] });
    expect((await session.tools.draft?.({}))?.text).toContain('procedures_save: kind tool, key npm');
    const none = make({ commands: s.source, repos: [] });
    expect((await none.session.tools.draft?.({}))?.text).toContain('kind tool, key npm');
  });

  it('numbers each command draft of the call and reads the log when it is called', async () => {
    const s = shell();
    s.ran('npm ci');
    const { session } = make({ commands: s.source });
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Draft c-1\./);
    s.ran('npm run lint');
    const second = (await session.tools.draft?.({}))?.text ?? '';
    expect(second).toMatch(/^Draft c-2\./);
    expect(second).toContain('2. Run npm run\n   run: npm run lint');
  });

  it('says how many commands were left out for safety and never which', async () => {
    const s = shell();
    s.ran('export API_TOKEN=zq81xk');
    s.ran('curl -H "Authorization: Bearer zq81xk" https://example.com/api');
    s.ran('npm ci');
    const { session } = make({ commands: s.source });
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toContain('2 commands were left out for safety.');
    expect(text).not.toMatch(/zq81xk|API_TOKEN|Authorization|curl/);
    s.log.length = 0;
    s.ran('printenv HOME');
    s.ran('cat .env');
    const empty = (await session.tools.draft?.({}))?.text ?? '';
    expect(empty).toMatch(/^Nothing to keep from your commands/);
    expect(empty).toContain('1 command was left out for safety.');
    expect(empty).not.toContain('.env');
  });

  it('has nothing when no command worked, and does not register a draft', async () => {
    const s = shell();
    s.ran('pytest', 2);
    const { session } = make({ commands: s.source });
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Nothing to keep from your commands/);
    expect((await session.tools.save({ kind: 'repo', key: 'api', title: 'Run it', draft: 'c-1' })).text).toMatch(/there is no such draft/);
  });

  it('leaves out a command the mask would change and one that holds what the person typed', async () => {
    const s = shell();
    s.ran('npm run seed -- hunter22value');
    s.ran('npm run login maple-4-sunset');
    s.ran('npm ci');
    const typed = createTypedValues();
    typed.add(['maple-4-sunset']);
    const { session } = make({ commands: { entries: s.source.entries, mask: (t) => t.replaceAll('hunter22value', '***') }, typed });
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toContain('2 commands were left out for safety.');
    expect(text).toContain('1. Run npm ci\n   run: npm ci');
    expect(text).not.toMatch(/hunter22value|maple-4-sunset/);
  });

  it('serves both drafts to a call that has a browser and a shell, and each by its own id', async () => {
    const s = shell();
    fought(s);
    const { session, f } = make({ commands: s.source, browser: true });
    f.navigate('https://docs.example.com/budget');
    f.click('button', 'Save');
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toContain('Draft d-1.');
    expect(text).toContain('Draft c-1.');
    expect(text.indexOf('Draft d-1.')).toBeLessThan(text.indexOf('Draft c-1.'));
  });

  it('keeps the screen part as it was for a call with no shell', async () => {
    const { session, f } = make({ browser: true });
    f.navigate('/budget');
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toMatch(/^Draft d-1\./);
    expect(text).not.toContain('c-1');
    expect(session.has).toEqual({ screen: true, commands: false });
  });

  it('says a screen has nothing to draft without calling the shell undrafted, when the call has a shell', async () => {
    const s = shell();
    const { session } = make({ commands: s.source, browser: true });
    const text = (await session.tools.draft?.({}))?.text ?? '';
    expect(text).toMatch(/^Nothing to draft from the screen/);
    expect(text).not.toContain('work done through your own shell is not drafted');
  });

  it('survives a log that cannot be read', async () => {
    const { session } = make({ commands: { entries: () => { throw new Error('gone'); } } });
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Nothing to keep from your commands/);
  });
});

describe('procedures_save from a command draft (acceptance 3)', () => {
  async function drafted(over: { repos?: string[] } = {}): Promise<{ session: ProcedureSession; s: ReturnType<typeof shell> }> {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source, ...over });
    await session.tools.draft?.({});
    return { session, s };
  }
  const save = (session: ProcedureSession, over: Record<string, unknown> = {}) => session.tools.save({ kind: 'repo', key: 'api', title: 'Run the tests', draft: 'c-1', ...over });

  it('keeps the recorded commands, marks the record recorded, and is not keyed by the app', async () => {
    const { session } = await drafted();
    const a = await save(session, { pitfalls: ['Run the suite in band; a plain run times out'] });
    expect(a.text).toMatch(/^Saved p-00000001 at revision 1: "Run the tests"/);
    expect(onDisk('p-00000001')).toMatchObject({
      kind: 'repo',
      key: 'api',
      stepsFrom: 'recording',
      reviewed: false,
      steps: [{ text: 'Run npm ci', run: 'npm ci' }, { text: 'Run npm test', run: 'npm test -- --runInBand' }, { text: 'Run npm run', run: 'npm run build' }],
      pitfalls: ['Run the suite in band; a plain run times out'],
    });
    expect(onDisk('p-00000001').keyedBy).toBeUndefined();
    expect(notes.map((n) => n.code)).toEqual(['runner.procedures.saved']);
    expect(JSON.stringify([audits, notes])).not.toContain('npm ci');
  });

  it('keeps a tool procedure under a program slug', async () => {
    const { session } = await drafted();
    expect((await save(session, { kind: 'tool', key: 'npm' })).text).toMatch(/^Saved/);
    expect(onDisk('p-00000001')).toMatchObject({ kind: 'tool', key: 'npm', stepsFrom: 'recording' });
  });

  it('takes {n} and {n, text}, keeps the run of the draft, and marks a reworded step edited', async () => {
    const { session } = await drafted();
    const a = await save(session, { steps: [{ n: 2, text: 'Run the suite in band' }, 3] });
    expect(a.text).toMatch(/^Saved/);
    const rec = onDisk('p-00000001');
    expect(rec.stepsFrom).toBe('edited');
    expect(rec.steps).toEqual([{ text: 'Run the suite in band', run: 'npm test -- --runInBand', edited: true }, { text: 'Run npm run', run: 'npm run build' }]);
  });

  it('is recorded when every step is kept as drafted, by the same words', async () => {
    const { session } = await drafted();
    await save(session, { steps: [{ n: 1 }, { n: 2, text: 'Run npm test' }, { n: 3 }] });
    expect(onDisk('p-00000001').stepsFrom).toBe('recording');
  });

  it('refuses a step number the app did not record, an unordered list, a step of its own and a command of its own', async () => {
    const { session } = await drafted();
    expect((await save(session, { steps: [{ n: 9 }] })).text).toMatch(/the app did not record a step 9; the draft has steps 1 to 3/);
    expect((await save(session, { steps: [{ n: 2 }, { n: 1 }] })).text).toMatch(/keep the draft's order/);
    expect((await save(session, { steps: [{ text: 'Run my own thing' }] })).text).toMatch(/must be the number of a step of the draft/);
    expect((await save(session, { steps: [{ n: 1, run: 'rm -rf /' }] })).text).toMatch(/may hold only n and text/);
    expect((await save(session, { steps: 'all' })).text).toMatch(/steps must be a list of draft step numbers/);
    expect(files()).toEqual([]);
    expect(audits.map((a) => a.fields.code)).toEqual(['cmd-steps', 'cmd-steps', 'cmd-steps', 'cmd-steps', 'cmd-steps']);
    expect(audits.every((a) => !a.ok)).toBe(true);
  });

  it('refuses a draft the call does not have, a screen draft id, and a kind a command draft is not for', async () => {
    const { session } = await drafted();
    expect((await save(session, { draft: 'c-9' })).text).toMatch(/there is no such draft in this call\. Call procedures_draft \(the last command draft is c-1\)/);
    expect((await save(session, { draft: 'd-1' })).text).toMatch(/a d- draft is a draft of the screen/);
    expect((await save(session, { kind: 'cycle', key: 'development' })).text).toBe('Not saved: a draft is for kind gui (a draft of the screen) or kind repo or tool (a draft of commands).');
    expect((await save(session, { kind: 'request', key: 'tests' })).text).toMatch(/^Not saved: a draft is for kind gui/);
    expect((await save(session, { kind: 'gui', key: 'docs.example.com' })).text).toMatch(/this call has no browser of the app/);
    expect(files()).toEqual([]);
  });

  it('refuses a c- draft on kind gui in a call that has both', async () => {
    const s = shell();
    fought(s);
    const { session, f } = make({ commands: s.source, browser: true });
    f.navigate('https://docs.example.com/budget');
    await session.tools.draft?.({});
    expect((await session.tools.save({ kind: 'gui', key: 'docs.example.com', title: 'Update it', draft: 'c-1' })).text).toMatch(/a c- draft is a draft of commands/);
  });

  it('refuses a draft in a call with no shell', async () => {
    const { session } = make();
    expect((await session.tools.save({ kind: 'repo', key: 'api', title: 'Run it', draft: 'c-1', steps: [{ text: 'x' }] })).text).toMatch(/this call has none/);
    expect(audits[0]).toMatchObject({ ok: false, fields: { code: 'cmd-draft' } });
  });

  it('takes the key and the title through the validator like any save', async () => {
    const { session } = await drafted();
    expect((await save(session, { key: 'elsewhere' })).text).toMatch(/key is not a repository of this workspace/);
    expect((await save(session, { kind: 'tool', key: 'Not A Slug' })).text).toMatch(/key must be a lowercase slug/);
    expect((await save(session, { title: 'Token sk-live-4f9a8b7c6d5e4f3a2b1c' })).text).toMatch(/^Not saved/);
    expect(files()).toEqual([]);
  });

  it('holds the agent\'s own pitfalls and rewording to the same checks, and to what the person typed', async () => {
    const s = shell();
    fought(s);
    const typed = createTypedValues();
    typed.add(['maple-4-sunset']);
    const { session } = make({ commands: s.source, typed });
    await session.tools.draft?.({});
    const a = await session.tools.save({ kind: 'repo', key: 'api', title: 'Run the tests', draft: 'c-1', pitfalls: ['Log in with maple-4-sunset first'] });
    expect(a.text).toMatch(/pitfalls\[0\] holds text the person typed/);
    expect(files()).toEqual([]);
  });

  it('still saves a repo procedure without a draft, in a call that has a shell', async () => {
    const { session } = await drafted();
    const a = await session.tools.save({ kind: 'repo', key: 'api', title: 'Start the stack', steps: [{ text: 'Run it', run: 'npm run stack:up' }] });
    expect(a.text).toMatch(/^Saved/);
    expect(onDisk('p-00000001')).toMatchObject({ stepsFrom: 'agent', steps: [{ text: 'Run it', run: 'npm run stack:up' }] });
  });

  it('replaces a procedure with a c- draft when the agent names its id and revision', async () => {
    const { session } = await drafted();
    await save(session);
    await session.tools.draft?.({});
    const a = await save(session, { draft: 'c-2', title: 'Run the tests, fixed', id: 'p-00000001', revision: 1 });
    expect(a.text).toMatch(/^Replaced p-00000001/);
    expect(onDisk('p-00000001')).toMatchObject({ revision: 2, title: 'Run the tests, fixed', stepsFrom: 'recording' });
  });
});

describe('the tools of a call with a shell', () => {
  it('lists procedures_draft and a save that takes a c- draft, and the engines are given the same texts', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    expect(procedureToolNames(session.tools)).toEqual(['procedures_list', 'procedures_get', 'procedures_save', 'procedures_stale', DRAFT_TOOL]);
    const specs = procedureToolSpecs(session.tools);
    const save = specs.find((t) => t.name === 'procedures_save');
    expect(save?.description).toContain('c- draft');
    expect(save?.description).toContain('not available in this call');
    expect(JSON.stringify(save?.schema)).toContain('c-1');
    const draft = specs.find((t) => t.name === DRAFT_TOOL);
    expect(draft?.description).toContain('commands you ran');
    expect(draft?.description).not.toContain('on the screen');
    expect(PROCEDURE_TOOLS.find((t) => t.name === 'procedures_save')?.description).not.toContain('c- draft');

    const viaOpen = await procedureToolImpls(session.tools)
      .find((i) => i.name === DRAFT_TOOL)
      ?.run({}, { outputMax: 10_000 } as never);
    expect(String(viaOpen?.response)).toMatch(/^Draft c-1\./);
    const server = (await procedureMcpServer(session.tools)) as Record<string, any>;
    expect(Object.keys(server.coxia_procedures.instance._registeredTools)).toEqual(procedureToolNames(session.tools));
  });

  it('describes both drafts to a call with a browser and a shell, and the screen alone as before', () => {
    const both = make({ commands: shell().source, browser: true });
    const bothDraft = procedureToolSpecs(both.session.tools).find((t) => t.name === DRAFT_TOOL)?.description ?? '';
    expect(bothDraft).toContain('on the screen');
    expect(bothDraft).toContain('commands you ran');
    const screenOnly = make({ browser: true });
    const d = procedureToolSpecs(screenOnly.session.tools).find((t) => t.name === DRAFT_TOOL)?.description ?? '';
    expect(d).toContain('on the screen');
    expect(d).not.toContain('commands you ran');
    expect(procedureToolSpecs(screenOnly.session.tools).find((t) => t.name === 'procedures_save')?.description).not.toContain('c- draft');
  });
});
