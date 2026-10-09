import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecEntry } from '../src/main/procedures/commands';
import { procedureScreen } from '../src/main/procedures/screen';
import { CLOSING_WORDS_MAX, OFFER_MIN_SCREEN_STEPS, createProcedureSession, type CommandSource, type ProcedureSession } from '../src/main/procedures/session';
import { createProcedureStore } from '../src/main/procedures/store';
import { createTypedValues } from '../src/main/screen/typedValues';
import { fakeSteps } from './helpers/screenSteps';

// When a work earned the one last turn, and what is left to offer after it (#187, spec rules 12, 13 and 16; acceptance 5): the session's plan over a fake log of commands and a
// fake log of the browser's steps. No model, no sandbox; commands and hosts are neutral.

const KEY = 'call:t-1:agent';
let ws: string;
let counter: number;

function shell(): { source: CommandSource; ran: (command: string, exitCode?: number | null) => void } {
  const log: ExecEntry[] = [];
  return { source: { entries: () => log }, ran: (command, exitCode = 0) => void log.push({ n: log.length + 1, command, exitCode, timedOut: false }) };
}

function make(o: { commands?: CommandSource; browser?: boolean; repos?: string[]; typed?: ReturnType<typeof createTypedValues> } = {}): { session: ProcedureSession; f: ReturnType<typeof fakeSteps> } {
  const f = fakeSteps(KEY);
  const screen = o.browser ? procedureScreen({ key: KEY, sessions: f.sessions, typed: o.typed, browser: true }) : undefined;
  const store = createProcedureStore(ws, { hex: () => (++counter).toString(16).padStart(8, '0') });
  const session = createProcedureSession(
    { store },
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

/** A script fought and fixed: a failed test run, then one that works. */
function fought(s: ReturnType<typeof shell>): void {
  s.ran('npm ci');
  s.ran('npm test', 1);
  s.ran('npm test -- --runInBand');
  s.ran('npm run build');
}

/** Six steps on a site, from a page to a form. */
function browsed(f: ReturnType<typeof fakeSteps>, base = 'https://docs.example.com/'): void {
  f.navigate(base);
  f.click('button', 'Open the menu');
  f.click('link', 'Reports');
  f.click('button', 'Export');
  f.wait(2000);
  f.click('button', 'Download');
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-plan-'));
  counter = 0;
});

describe('a work that earned a last turn', () => {
  it('commands: a failure followed by a success of the same program, with nothing saved, plans a turn and one offer', () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    const plan = session.plan({ words: 'Tests pass now.' });
    expect(plan).not.toBeNull();
    expect(plan?.text).toMatch(/^Draft c-1\./);
    expect(plan?.text).toContain('<data>');
    expect(plan?.words).toBe('Tests pass now.');
    const offers = plan?.settle() ?? [];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: 'c-1', kind: 'repo', key: 'api', stepsFrom: 'recording', leftOut: 0, handoff: false });
    expect(offers[0].steps).toEqual([
      { text: 'Run npm ci', run: 'npm ci' },
      { text: 'Run npm test', run: 'npm test -- --runInBand' },
      { text: 'Run npm run', run: 'npm run build' },
    ]);
    expect(offers[0].pitfalls).toEqual(['Failed (exit 1): npm test']);
    expect(offers[0].title).toBe('Run npm run');
    expect(offers[0].keyedBy).toBeUndefined();
    expect(offers[0].screen).toBeUndefined();
  });

  it('commands: no trial and error, no turn (all worked, or a failure its program never recovered from)', () => {
    const worked = shell();
    worked.ran('npm ci');
    worked.ran('npm test');
    expect(make({ commands: worked.source }).session.plan({ words: '' })).toBeNull();
    const lost = shell();
    lost.ran('npm ci');
    lost.ran('pytest', 1);
    expect(make({ commands: lost.source }).session.plan({ words: '' })).toBeNull();
    // only noise and failures: the one step a trial needs is missing
    const noise = shell();
    noise.ran('ls');
    noise.ran('npm test', 1);
    expect(make({ commands: noise.source }).session.plan({ words: '' })).toBeNull();
  });

  it('a call with no shell and no browser has nothing to plan', () => {
    expect(make().session.plan({ words: 'done' })).toBeNull();
  });

  it('keys a many-repository call by the program with most steps, as a tool', () => {
    const s = shell();
    s.ran('make lint', 1);
    s.ran('make lint');
    s.ran('make build');
    s.ran('npm ci');
    const offers = make({ commands: s.source, repos: ['api', 'web'] }).session.plan({ words: '' })?.settle() ?? [];
    expect(offers).toMatchObject([{ kind: 'tool', key: 'make' }]);
  });

  it('a draft of more than the stored steps still earns the turn (the agent picks by number); the card is the caller\'s to refuse', () => {
    const s = shell();
    s.ran('node a.js', 1);
    for (let i = 0; i < 22; i++) s.ran(`node step${i}.js`);
    const plan = make({ commands: s.source }).session.plan({ words: '' });
    expect(plan?.text).toContain('at most 20 of the 22 draft steps');
    expect(plan?.settle()[0].steps).toHaveLength(22);
  });
});

describe('a work that did not', () => {
  it('the call saved a procedure of its own', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    await session.tools.save({ kind: 'repo', key: 'api', title: 'Run the tests', steps: [{ text: 'Run npm test', run: 'npm test' }] });
    expect(session.plan({ words: '' })).toBeNull();
  });

  it('a procedure it read, or reported on, is a use and not a find', async () => {
    const s = shell();
    fought(s);
    // a record written by another call
    const other = make({ commands: s.source }).session;
    const saved = await other.tools.save({ kind: 'repo', key: 'api', title: 'Run the unit tests', steps: [{ text: 'Run npm test' }] });
    const id = /p-[0-9a-f]{8}/.exec(saved.text)?.[0] as string;
    const { session } = make({ commands: s.source });
    await session.tools.get({ id });
    expect(session.plan({ words: '' })).toBeNull();
  });

  it('a call that replaced a procedure is done with it', async () => {
    const s = shell();
    fought(s);
    const first = make({ commands: s.source }).session;
    const saved = await first.tools.save({ kind: 'repo', key: 'api', title: 'Run the unit tests', steps: [{ text: 'Run npm test' }] });
    const id = /p-[0-9a-f]{8}/.exec(saved.text)?.[0] as string;
    const { session } = make({ commands: s.source });
    await session.tools.get({ id });
    await session.tools.save({ id, revision: 1, kind: 'repo', key: 'api', title: 'Run the unit tests', steps: [{ text: 'Run npm test -- --runInBand' }] });
    expect(session.plan({ words: '' })).toBeNull();
  });

  it('a session that finished plans nothing', () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    session.finish('done');
    expect(session.plan({ words: '' })).toBeNull();
  });

  it('a plan that finds no draft worth a turn registers none: the next draft is still c-1', async () => {
    const s = shell();
    s.ran('npm ci');
    const { session } = make({ commands: s.source });
    expect(session.plan({ words: '' })).toBeNull();
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Draft c-1\./);
  });
});

describe('what is left to offer after the turn', () => {
  it('a save from the draft in the turn leaves the card unmade; a turn that saved nothing leaves it', async () => {
    const s = shell();
    fought(s);
    const none = make({ commands: s.source });
    expect(none.session.plan({ words: '' })?.settle()).toHaveLength(1);

    const { session } = make({ commands: s.source });
    const plan = session.plan({ words: '' });
    const r = await session.tools.save({ kind: 'repo', key: 'api', title: 'Fix and run the tests', draft: 'c-1' });
    expect(r.text).toMatch(/^Saved p-/);
    expect(plan?.settle()).toEqual([]);
  });

  it('a refused save from the draft keeps the card', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    const plan = session.plan({ words: '' });
    const r = await session.tools.save({ kind: 'repo', key: 'api', title: 'Bad title: with a colon', draft: 'c-1' });
    expect(r.text).toMatch(/^Not saved/);
    expect(plan?.settle()).toHaveLength(1);
  });

  it('a save of its own words, with no draft, is not the draft kept', async () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    const plan = session.plan({ words: '' });
    await session.tools.save({ kind: 'repo', key: 'api', title: 'Run the tests', steps: [{ text: 'Run npm test' }] });
    expect(plan?.settle()).toHaveLength(1);
  });

  it('settle can be read twice and does not need the shell any more', () => {
    const s = shell();
    fought(s);
    const log = (s.source.entries() as ExecEntry[]).slice();
    const { session } = make({ commands: s.source });
    const plan = session.plan({ words: '' });
    (s.source.entries() as ExecEntry[]).length = 0;
    expect(log.length).toBeGreaterThan(0);
    expect(plan?.settle()).toHaveLength(1);
    expect(plan?.settle()).toHaveLength(1);
  });
});

describe('the screen', () => {
  it(`earns a turn at ${OFFER_MIN_SCREEN_STEPS} kept steps and not before`, () => {
    const four = make({ browser: true });
    four.f.navigate('https://docs.example.com/');
    four.f.click('button', 'Open the menu');
    four.f.click('link', 'Reports');
    four.f.click('button', 'Export');
    expect(four.session.plan({ words: '' })).toBeNull();
    four.f.click('button', 'Download');
    const plan = four.session.plan({ words: 'Exported.' });
    expect(plan?.text).toMatch(/^Draft d-1\./);
    const offers = plan?.settle() ?? [];
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ id: 'd-1', kind: 'gui', key: 'docs.example.com', title: 'Steps on docs.example.com', keyedBy: 'app', screen: KEY, stepsFrom: 'recording', leftOut: 0, handoff: false });
    expect(offers[0].upTo).toBe(5);
    expect(offers[0].steps).toHaveLength(5);
    expect(offers[0].steps.every((x) => x.run === undefined)).toBe(true);
  });

  it('takes the site with most steps for the key, the first on a tie', () => {
    const { session, f } = make({ browser: true });
    f.navigate('https://one.example.com/');
    f.click('button', 'A');
    f.navigate('https://two.example.com/');
    f.click('button', 'B');
    f.click('button', 'C');
    f.click('button', 'D');
    const offers = session.plan({ words: '' })?.settle() ?? [];
    expect(offers[0].key).toBe('two.example.com');
    const tie = make({ browser: true });
    tie.f.navigate('https://one.example.com/');
    tie.f.click('button', 'A');
    tie.f.click('button', 'B');
    tie.f.navigate('https://two.example.com/');
    tie.f.click('button', 'C');
    tie.f.click('button', 'D');
    expect(tie.session.plan({ words: '' })?.settle()[0].key).toBe('one.example.com');
  });

  it('a work with both a browser and a shell can leave two offers, and a save from one leaves the other', async () => {
    const s = shell();
    fought(s);
    const { session, f } = make({ browser: true, commands: s.source });
    browsed(f);
    const plan = session.plan({ words: '' });
    expect(plan?.text).toMatch(/Draft d-1\.[\s\S]*Draft c-1\./);
    expect(plan?.settle().map((x) => x.id)).toEqual(['d-1', 'c-1']);
    const r = await session.tools.save({ kind: 'gui', key: 'docs.example.com', title: 'Export the report', draft: 'd-1' });
    expect(r.text).toMatch(/^Saved p-/);
    expect(plan?.settle().map((x) => x.id)).toEqual(['c-1']);
  });

  it('moves no mark when it only plans: the mark moves when something is kept or declined', () => {
    const { session, f } = make({ browser: true });
    browsed(f);
    session.plan({ words: '' });
    expect(f.sessions.markOf(KEY)).toBe(0);
  });

  it('does not make a card out of a draft that holds what the person typed', () => {
    const typed = createTypedValues();
    typed.add(['maple-4-sunset']);
    const { session, f } = make({ browser: true, typed });
    f.navigate('https://docs.example.com/');
    f.click('button', 'maple-4-sunset');
    f.click('link', 'Reports');
    f.click('button', 'Export');
    f.click('button', 'Download');
    const plan = session.plan({ words: '' });
    expect(plan).not.toBeNull();
    expect(plan?.settle()).toEqual([]);
  });

  it('says the person used the screen when they did', () => {
    const typed = createTypedValues();
    typed.add(['maple-4-sunset']);
    const { session, f } = make({ browser: true, typed });
    browsed(f);
    expect(session.plan({ words: '' })?.settle()[0].handoff).toBe(true);
  });
});

describe('the closing words', () => {
  it('are one line, masked and cut', () => {
    const s = shell();
    fought(s);
    const { session } = make({ commands: s.source });
    const long = `Done.\n${'word '.repeat(300)}`;
    const w = session.plan({ words: long })?.words ?? '';
    expect(w.length).toBe(CLOSING_WORDS_MAX);
    expect(w).not.toContain('\n');
    const masked = make({ commands: s.source }).session.plan({ words: 'Used the key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to log in.' })?.words ?? '';
    expect(masked).not.toContain('abcdefghijklmnop');
  });
});
