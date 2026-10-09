import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { StepEntry } from '../src/shared/browser';
import { LABEL_MAX, buildDraft, compareDraft, failedStepsOf, pathTemplate } from '../src/main/procedures/draft';
import { procedureMcpServer, procedureToolImpls } from '../src/main/procedures/engineTool';
import { procedureScreen } from '../src/main/procedures/screen';
import { createProcedureSession, type ProcedureSession } from '../src/main/procedures/session';
import { createProcedureStore, type ProcedureStore } from '../src/main/procedures/store';
import { DRAFT_TOOL, PROCEDURE_TOOLS, procedureToolNames, procedureToolSpecs } from '../src/main/procedures/tools';
import { fakeSteps, type FakeSteps } from './helpers/screenSteps';

// The app's draft of a gui procedure (#179, spec rules 29 and 33; acceptance 1 and 2): built from the app's own step log, worded by the app, and carrying nothing a person or
// an agent typed. Neutral hosts only, in a temp folder.

const KEY = 'call:t-1:agent';
const texts = (entries: readonly StepEntry[]): string[] => buildDraft(entries).steps.map((s) => s.text);

describe('the draft of a call', () => {
  it('has one step per action, in order, naming a control by its role and visible label and the page as a path (acceptance 1)', () => {
    const f = fakeSteps(KEY);
    f.navigate('https://docs.example.com/budget');
    f.read();
    f.click('link', 'Quarter two');
    f.read('browser_find');
    f.click('button', 'Save');
    f.read('browser_take_screenshot');
    expect(texts(f.log.entries())).toEqual([
      'Open /budget on docs.example.com',
      'Click the link "Quarter two" (page /budget on docs.example.com)',
      'Click the button "Save" (page /budget on docs.example.com)',
    ]);
    expect(buildDraft(f.log.entries()).steps.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it('cuts a label to what the validator allows in a quotation and takes the quotation marks out of it', () => {
    const f = fakeSteps(KEY);
    f.click('button', `${'Very long label '.repeat(8)}`);
    f.click('button', 'Say "hello" to \u201cthem\u201d');
    const [long, quoted] = texts(f.log.entries());
    expect(/"([^"]*)"/.exec(long)?.[1].length).toBeLessThanOrEqual(LABEL_MAX);
    expect(quoted).toContain('"Say hello to them"');
  });

  it('strips zero-width, bidi and tag characters from a label', () => {
    const f = fakeSteps(KEY);
    f.click('button', 'Sa\u200bve\u202e');
    f.click('button', `Ok${String.fromCodePoint(0xe0041, 0xe0042)}`);
    for (const t of texts(f.log.entries())) expect(t).not.toMatch(/[\u200b\u202e]|[\u{E0000}-\u{E007F}]/u);
    expect(texts(f.log.entries())[0]).toContain('"Save"');
    expect(texts(f.log.entries())[1]).toContain('"Ok"');
  });

  it('drops the query and the fragment of an address and turns what names one thing into :id', () => {
    const f = fakeSteps(KEY);
    f.add('browser_click', { role: 'button', name: 'Open', path: '/orders/48151623/items/ab12cd34ef/edit?token=hunter2#top' });
    const [step] = texts(f.log.entries());
    expect(step).toBe('Click the button "Open" (page /orders/:id/items/:id/edit on docs.example.com)');
    expect(step).not.toMatch(/hunter2|token|#/);
    expect(pathTemplate('/v2/reports/q3')).toBe('/v2/reports/q3');
    expect(pathTemplate('/a/12345/b')).toBe('/a/:id/b');
    expect(pathTemplate('')).toBe('');
  });

  it('keeps a wait as the figure the app measured, rounded up, and merges the waits that follow each other', () => {
    const f = fakeSteps(KEY);
    f.navigate('/budget');
    f.wait(2300);
    f.wait(1200);
    f.click('button', 'Go');
    f.wait(400);
    const draft = buildDraft(f.log.entries());
    expect(draft.steps.map((s) => s.text)).toEqual([
      'Open /budget on docs.example.com',
      'Wait for the page or an element (about 4 s) (page /budget on docs.example.com)',
      'Click the button "Go" (page /budget on docs.example.com)',
      'Wait for the page or an element (about 1 s) (page /budget on docs.example.com)',
    ]);
    expect(draft.waits).toEqual(['On /budget on docs.example.com: wait about 4 s for the page or an element', 'On /budget on docs.example.com: wait about 1 s for the page or an element']);
  });

  it('keeps an action that did not work as a candidate for a pitfall, in the app\'s words, and not as a step', () => {
    const f = fakeSteps(KEY);
    f.navigate('https://docs.example.com/budget');
    f.click('button', 'Missing', { outcome: 'error' });
    f.click('button', 'Gone', { outcome: 'not-run' });
    f.navigate('https://elsewhere.example.net/', { outcome: 'not-run' });
    f.click('button', 'Send', { outcome: 'declined', class: 'irreversible', held: { why: 'submit', answer: 'no' } });
    f.click('button', 'Save');
    const draft = buildDraft(f.log.entries());
    expect(draft.steps.map((s) => s.text)).toEqual(['Open /budget on docs.example.com', 'Click the button "Save" (page /budget on docs.example.com)']);
    expect(draft.pitfalls).toEqual([
      'Did not work: Click the button "Missing" (page /budget on docs.example.com)',
      'Could not be done (the element was not on the page, or the call was refused): Click the button "Gone" (page /budget on docs.example.com)',
      'Refused (the site is not on the host list, or the address is not valid): Open elsewhere.example.net',
      'The person declined: Click the button "Send" (page /budget on docs.example.com)',
    ]);
  });

  it('drops a step the next one undid: a click or an address, then back', () => {
    const f = fakeSteps(KEY);
    f.navigate('/budget');
    f.click('link', 'Details');
    f.back();
    f.click('link', 'Summary');
    f.navigate('/other');
    f.back();
    expect(texts(f.log.entries())).toEqual(['Open /budget on docs.example.com', 'Click the link "Summary" (page /budget on docs.example.com)']);
    // A back after a step that changes nothing on its own has nothing to undo, and stays.
    f.type();
    f.back();
    expect(texts(f.log.entries()).slice(2)).toEqual(['Type <value> into a field (page /other on docs.example.com)', 'Go back to the previous page']);
  });

  it('folds an address opened twice running into one step', () => {
    const f = fakeSteps(KEY);
    f.navigate('/budget');
    f.navigate('/budget');
    f.click('button', 'Next');
    f.click('button', 'Next');
    expect(texts(f.log.entries())).toEqual(['Open /budget on docs.example.com', 'Click the button "Next" (page /budget on docs.example.com)', 'Click the button "Next" (page /budget on docs.example.com)']);
  });

  it('never carries a typed value: a type step reads <value>, whatever the entry holds besides the app\'s own fields (acceptance 2)', () => {
    const f = fakeSteps(KEY);
    f.navigate('/search');
    const typed = f.type();
    // Fields the real log never keeps, put there on purpose: the draft reads the table of fields it knows and copies nothing else.
    Object.assign(typed, { text: 'hunter2hunter2', value: 'hunter2hunter2', args: { text: 'hunter2hunter2' } });
    f.press('Enter');
    f.press(undefined);
    f.add('browser_fill_form');
    f.add('browser_select_option');
    const all = texts(f.log.entries());
    expect(all).toEqual([
      'Open /search on docs.example.com',
      'Type <value> into a field (page /search on docs.example.com)',
      'Press Enter (page /search on docs.example.com)',
      'Type <value> with the keyboard (page /search on docs.example.com)',
      'Fill the form fields with <value> (page /search on docs.example.com)',
      'Choose <value> in a list (page /search on docs.example.com)',
    ]);
    expect(JSON.stringify(buildDraft(f.log.entries()))).not.toContain('hunter2');
  });

  it('makes a hand-off one step with no content, and marks the draft', () => {
    const f = fakeSteps(KEY);
    f.navigate('/login');
    f.type();
    f.handoff();
    f.click('button', 'Continue');
    const draft = buildDraft(f.log.entries());
    expect(draft.handoff).toBe(true);
    expect(draft.steps.map((s) => s.text)).toContain('The person completes a login or a confidential input here');
    expect(draft.steps.filter((s) => /person completes/.test(s.text))).toHaveLength(1);
    const declined = fakeSteps(KEY);
    declined.handoff('declined');
    const d2 = buildDraft(declined.log.entries());
    expect(d2.handoff).toBe(false);
    expect(d2.steps).toEqual([]);
    expect(d2.pitfalls).toEqual(['A request to hand the screen to the person was not completed']);
  });

  it('is empty for a log with reads only, and for no log', () => {
    const f = fakeSteps(KEY);
    f.read();
    f.read('browser_find');
    expect(buildDraft(f.log.entries())).toMatchObject({ steps: [], pitfalls: [], waits: [], handoff: false });
    expect(buildDraft([]).steps).toEqual([]);
  });
});

describe('the draft against a procedure the call followed', () => {
  const step = (text: string) => ({ text });
  it('counts the steps kept, changed and new, and the old steps nothing stands for', () => {
    const draft = [{ n: 1, text: 'Open /a on docs.example.com' }, { n: 2, text: 'Click the button "Save"' }, { n: 3, text: 'Click the button "Done"' }, { n: 4, text: 'Wait about 2 s' }];
    const existing = [step('Open /a on docs.example.com'), step('Click the button "Submit"'), step('click the   button "Done"')];
    expect(compareDraft(draft, existing)).toEqual({ kept: 2, changed: 1, added: 1, gone: 0 });
    expect(compareDraft(draft.slice(0, 1), existing)).toEqual({ kept: 1, changed: 0, added: 0, gone: 2 });
    expect(compareDraft([], [])).toEqual({ kept: 0, changed: 0, added: 0, gone: 0 });
  });

  it('finds the steps of the old procedure that failed in this call', () => {
    expect(failedStepsOf(['Click the button "Save"'], [step('Open /a'), step('click the button "Save"')])).toEqual([2]);
    expect(failedStepsOf([], [step('x')])).toEqual([]);
  });
});

// ---- the tool of a session ----------------------------------------------------------------------------------------------------------------

let ws: string;
let counter: number;
let notes: { code: string; params: Record<string, string | number> }[];

function make(f: FakeSteps | null, o: { browser?: boolean; store?: ProcedureStore } = {}): { session: ProcedureSession; store: ProcedureStore } {
  const store = o.store ?? createProcedureStore(ws, { hex: () => (++counter).toString(16).padStart(8, '0') });
  const screen = f ? procedureScreen({ key: KEY, sessions: f.sessions, browser: o.browser ?? true }) : undefined;
  const session = createProcedureSession(
    { store, note: (code, params) => notes.push({ code, params }) },
    { writer: { by: 'agent', surface: 'direct', ref: 't-1', permission: 'worktree', shell: 'sandbox' }, workspaceRepos: ['api'], select: { repos: [], tools: [], hosts: ['docs.example.com'], language: 'en' }, home: '/home/someone', ...(screen ? { screen } : {}) },
  );
  return { session, store };
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-draft-'));
  counter = 0;
  notes = [];
});

describe('procedures_draft', () => {
  it('is offered to a call that has the app\'s browser, and to no other', () => {
    const f = fakeSteps(KEY);
    expect(make(f).session.tools.draft).toBeTypeOf('function');
    expect(make(f, { browser: false }).session.tools.draft).toBeUndefined();
    expect(make(null).session.tools.draft).toBeUndefined();
  });

  it('is in the tool table only for a call that has it, and then the save tool says how to save from the draft', () => {
    const f = fakeSteps(KEY);
    const withDraft = make(f).session.tools;
    const without = make(null).session.tools;
    expect(procedureToolSpecs(without)).toBe(PROCEDURE_TOOLS);
    expect(procedureToolNames(without)).toEqual(['procedures_list', 'procedures_get', 'procedures_save', 'procedures_stale']);
    expect(procedureToolNames(withDraft)).toEqual(['procedures_list', 'procedures_get', 'procedures_save', 'procedures_stale', DRAFT_TOOL]);
    const save = procedureToolSpecs(withDraft).find((t) => t.name === 'procedures_save');
    expect(save?.description).toContain('call procedures_draft');
    expect(PROCEDURE_TOOLS.find((t) => t.name === 'procedures_save')?.description).toContain('not available in this call');
    expect(procedureToolImpls(withDraft).map((i) => i.name)).toContain(DRAFT_TOOL);
    expect(procedureToolImpls(without).map((i) => i.name)).not.toContain(DRAFT_TOOL);
  });

  it('is one more tool of the SDK server and of the open engine, from the same handler', async () => {
    const f = fakeSteps(KEY);
    const { session } = make(f);
    f.navigate('/budget');
    const server = (await procedureMcpServer(session.tools)) as Record<string, any>;
    expect(Object.keys(server.coxia_procedures.instance._registeredTools)).toEqual(procedureToolNames(session.tools));
    const viaOpen = await procedureToolImpls(session.tools)
      .find((i) => i.name === DRAFT_TOOL)
      ?.run({}, { outputMax: 10_000 } as never);
    expect(String(viaOpen?.response)).toMatch(/^Draft d-1\./);
    const without = (await procedureMcpServer(make(null).session.tools)) as Record<string, any>;
    expect(Object.keys(without.coxia_procedures.instance._registeredTools)).not.toContain(DRAFT_TOOL);
  });

  it('answers with the steps inside a data fence, the sites, and how to save, and writes nothing', async () => {
    const f = fakeSteps(KEY);
    const { session, store } = make(f);
    f.navigate('/budget');
    f.click('button', 'Save');
    const a = await session.tools.draft?.({});
    expect(a?.text).toMatch(/^Draft d-1\./);
    expect(a?.text).toContain('<data>');
    expect(a?.text).toContain('1. Open /budget on docs.example.com');
    expect(a?.text).toContain('2. Click the button "Save" (page /budget on docs.example.com)');
    expect(a?.text).toContain('Sites the browser was on: docs.example.com');
    expect(a?.text).toContain('procedures_save: kind gui, draft "d-1"');
    expect(store.list().records).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('numbers each draft of the call, and the steps taken after one are in the next', async () => {
    const f = fakeSteps(KEY);
    const { session } = make(f);
    f.navigate('/budget');
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Draft d-1\./);
    f.click('button', 'More');
    const second = (await session.tools.draft?.({}))?.text ?? '';
    expect(second).toMatch(/^Draft d-2\./);
    expect(second).toContain('2. Click the button "More"');
  });

  it('has nothing to draft for work done through the shell: the app\'s browser took no step (acceptance 4, first half)', async () => {
    const f = fakeSteps(KEY);
    const { session } = make(f);
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Nothing to draft: the app's browser took no step/);
    f.read();
    expect((await session.tools.draft?.({}))?.text).toMatch(/^Nothing to keep/);
  });

  it('says what a hand-off means for the record, without anything of it', async () => {
    const f = fakeSteps(KEY);
    const { session } = make(f);
    f.navigate('/login');
    f.handoff();
    const a = (await session.tools.draft?.({}))?.text ?? '';
    expect(a).toContain('The person used the screen in this call');
    expect(a).toContain('waits for the person\'s review');
  });

  it('offers a replacement when the call followed a procedure that the draft differs from, with the comparison and the revision to name (acceptance 5, draft half)', async () => {
    const f = fakeSteps(KEY);
    const { session, store } = make(f);
    const old = store.save({
      input: { kind: 'gui', key: 'docs.example.com', title: 'Update the budget', steps: [{ text: 'Open /budget on docs.example.com' }, { text: 'Click the button "Submit" (page /budget on docs.example.com)' }] },
      writer: { by: 'earlier', surface: 'direct' },
      repos: [],
      keyedBy: 'app',
      stepsFrom: 'recording',
      home: '/home/someone',
    });
    expect(old.ok).toBe(true);
    const id = old.ok ? old.record.id : '';
    await session.tools.get({ id });
    f.navigate('/budget');
    f.click('button', 'Save');
    const a = (await session.tools.draft?.({}))?.text ?? '';
    expect(a).toContain(`You followed ${id} ("Update the budget", revision 1) and this draft differs from it: 1 steps kept, 1 changed, 0 new, 0 of its steps not in the draft.`);
    expect(a).toContain(`save with id ${id} and revision 1`);
  });

  it('says there is nothing to save when the draft is the procedure that was followed, and suggests reporting a step that failed', async () => {
    const f = fakeSteps(KEY);
    const { session, store } = make(f);
    const old = store.save({
      input: { kind: 'gui', key: 'docs.example.com', title: 'Update the budget', steps: [{ text: 'Open /budget on docs.example.com' }, { text: 'Click the button "Save" (page /budget on docs.example.com)' }] },
      writer: { by: 'earlier', surface: 'direct' },
      repos: [],
      keyedBy: 'app',
      stepsFrom: 'recording',
      home: '/home/someone',
    });
    const id = old.ok ? old.record.id : '';
    await session.tools.get({ id });
    f.navigate('/budget');
    f.click('button', 'Save');
    expect((await session.tools.draft?.({}))?.text).toContain(`is the same as ${id}`);
    f.click('button', 'Save', { outcome: 'error' });
    expect((await session.tools.draft?.({}))?.text).toContain(`Step 2 of ${id} did not work in this call: report it with procedures_stale.`);
  });
});
