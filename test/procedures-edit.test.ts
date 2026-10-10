// The person's edit in the Procedures view: what the form holds and sends (pure), the controls that exist only on the computer, the editor as a static render shows it, and
// how a refusal of the app is told: by field, in words, never with the value. Typing, clicking and the answers in motion are for the manual plan.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/shared/procedures';
import { CATALOGS, setLanguage, t } from '../src/shared/i18n';
import { checkContent } from '../src/main/procedures/record';
import { addStep, fieldRef, moveStep, removeStep, sameDraft, toDraft, toInput, ERROR_KEY, REFUSAL_KEY } from '../src/renderer/src/screens/procedures/editModel';
import { procedureRecord } from './helpers/procedures';

// src/renderer/src/api.ts reads window.api when it loads; the node environment has none.
vi.hoisted(() => {
  (globalThis as unknown as { window: unknown }).window = { api: { invoke: () => new Promise(() => undefined), onEvent: () => () => undefined } };
  (globalThis as unknown as { document: unknown }).document = { documentElement: { dataset: {} } };
});
vi.mock('../src/renderer/src/i18n', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/i18n')>()), useT: () => t }));
vi.mock('../src/renderer/src/screens/cycle/runsApi', async (orig) => ({ ...(await orig<typeof import('../src/renderer/src/screens/cycle/runsApi')>()), useRunConfig: () => null }));
const { RecordActions } = await import('../src/renderer/src/screens/procedures/RecordPanel');
const { RecordEditor, Refusals } = await import('../src/renderer/src/screens/procedures/RecordEditor');

afterEach(() => setLanguage('pt-BR'));

const none = { edit: () => undefined, review: () => undefined, restore: () => undefined, remove: () => undefined, confirmRemove: () => undefined, keep: () => undefined };
const record = procedureRecord({
  title: 'Run the end-to-end tests',
  steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite' }, { text: 'Read the report', edited: true }],
  pitfalls: ['Do not run it twice', 'Close the editor first'],
  waits: ['About 30 s after the stack is up'],
});

describe('what the form holds and sends', () => {
  it('holds a step as two boxes and the pitfalls and waits one per line, and sends them back as a record', () => {
    const d = toDraft(record);
    expect(d.steps).toEqual([
      { text: 'Start the stack', run: 'npm run stack:up', edited: false },
      { text: 'Run the suite', run: '', edited: false },
      { text: 'Read the report', run: '', edited: true },
    ]);
    expect(d.pitfalls).toBe('Do not run it twice\nClose the editor first');
    expect(toInput(d)).toEqual({
      kind: 'repo',
      key: 'api',
      title: 'Run the end-to-end tests',
      steps: [{ text: 'Start the stack', run: 'npm run stack:up' }, { text: 'Run the suite' }, { text: 'Read the report', edited: true }],
      pitfalls: ['Do not run it twice', 'Close the editor first'],
      waits: ['About 30 s after the stack is up'],
    });
  });

  it('what it sends passes the app validator unchanged, so an untouched form is not refused', () => {
    const checked = checkContent(toInput(toDraft(record)), { repos: ['api'] });
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.value.steps).toEqual(record.steps);
  });

  it('leaves out an empty command and an empty line, and cuts nothing', () => {
    const d = { ...toDraft(record), pitfalls: ' one \r\n\n  \ntwo', waits: '', steps: [{ text: ` ${'x'.repeat(500)}`, run: '   ', edited: false }] };
    const input = toInput(d) as { steps: { text: string; run?: string }[]; pitfalls: string[]; waits: string[] };
    expect(input.pitfalls).toEqual(['one', 'two']);
    expect(input.waits).toEqual([]);
    expect(input.steps[0].run).toBeUndefined();
    expect(input.steps[0].text).toHaveLength(501);
  });

  it('knows whether anything changed', () => {
    const d = toDraft(record);
    expect(sameDraft(d, toDraft(record))).toBe(true);
    expect(sameDraft({ ...d, title: 'Run the tests' }, d)).toBe(false);
  });

  it('moves, removes and adds steps, and stops at the ends and at the limit', () => {
    const steps = toDraft(record).steps;
    expect(moveStep(steps, 0, 1).map((s) => s.text)).toEqual(['Run the suite', 'Start the stack', 'Read the report']);
    expect(moveStep(steps, 0, -1)).toEqual(steps);
    expect(moveStep(steps, 2, 1)).toEqual(steps);
    expect(removeStep(steps, 1).map((s) => s.text)).toEqual(['Start the stack', 'Read the report']);
    expect(addStep(steps)).toHaveLength(4);
    let many = steps;
    for (let i = 0; i < 30; i++) many = addStep(many);
    expect(many).toHaveLength(LIMITS.steps);
  });
});

describe('the words for a refusal', () => {
  it('names the field the validator names, from 1 for a list', () => {
    expect(fieldRef('title')).toEqual({ key: 'ui.procedures.field.title' });
    expect(fieldRef('steps[2].text')).toEqual({ key: 'ui.procedures.field.stepText', n: 3 });
    expect(fieldRef('steps[0].run')).toEqual({ key: 'ui.procedures.field.stepRun', n: 1 });
    expect(fieldRef('steps[4]')).toEqual({ key: 'ui.procedures.field.step', n: 5 });
    expect(fieldRef('pitfalls[1]')).toEqual({ key: 'ui.procedures.field.pitfall', n: 2 });
    expect(fieldRef('waits[0]')).toEqual({ key: 'ui.procedures.field.wait', n: 1 });
    expect(fieldRef('something-new')).toEqual({ key: 'ui.procedures.field.record' });
  });

  it('has a sentence, in both languages, for every code the validator can give', () => {
    const bad: Record<string, unknown>[] = [
      { kind: 'x' },
      { kind: 'repo', key: '', title: 'A title', steps: [] },
      { kind: 'repo', key: 'zzz', title: 'a <b> title', steps: [{ text: 'x'.repeat(300), nope: 1 }, { text: 'line\nbreak' }, { text: 'mail me@example.com' }, { text: 'sk-or-v1-0123456789abcdef0123456789abcdef' }, { text: 'see https://example.com/a?b=c' }, { text: 'call 1234567890' }, { text: 'key abcdef0123456789abcdef0123456789' }, { text: 'set password=hunter2 first' }, { text: 7 }], pitfalls: Array(9).fill('x'), waits: Array(7).fill('x') },
      { kind: 'cycle', key: 'nope', title: 'T', steps: [{ text: 'x' }] },
      { kind: 'gui', key: 'https://x.example.com/p', title: 'T', steps: [{ text: `click "${'q'.repeat(50)}"` }] },
      { kind: 'tool', key: 'Not A Slug', title: 'T', steps: [{ text: 'x' }] },
      { kind: 'repo', key: 'api', title: 'T', steps: Array.from({ length: 20 }, () => ({ text: 'x'.repeat(240) })) },
      { kind: 'repo', key: 'api', title: 'T', steps: [{ text: 'open /home/someone/work' }] },
    ];
    const codes = new Set<string>();
    for (const input of bad) {
      const r = checkContent(input, { repos: ['api'], home: '/home/someone' });
      if (!r.ok) for (const x of r.refusals) codes.add(x.code);
    }
    expect([...codes].sort()).toEqual(Object.keys(REFUSAL_KEY).sort());
    for (const key of [...Object.values(REFUSAL_KEY), ...Object.values(ERROR_KEY)]) {
      expect(CATALOGS.en[key], key).toBeTruthy();
      expect(CATALOGS['pt-BR'][key], key).toBeTruthy();
    }
  });

  it('has a sentence for every reason a save, review, restore or delete can fail', () => {
    for (const code of ['revision', 'not-found', 'deleted', 'newer', 'duplicate', 'cap-key', 'cap-workspace', 'io', 'no-previous']) expect(ERROR_KEY[code], code).toBeTruthy();
  });

  it('lists each field the app named with its reason, and never the value', () => {
    setLanguage('en');
    const secret = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const html = renderToStaticMarkup(createElement(Refusals, { failure: { ok: false, code: 'invalid', text: `Not saved: ${secret}`, refusals: [{ field: 'steps[1].text', code: 'credential', text: 'steps[1].text holds a credential' }, { field: 'title', code: 'charset', text: 'x' }] } }));
    expect(html).toContain('Step 2, what to do: has what looks like a credential');
    expect(html).toContain('Title: may hold only letters');
    expect(html).toContain(t('ui.procedures.edit.notSaved'));
    expect(html).not.toContain(secret);
  });

  it('tells a change that is not a refusal in one sentence, and falls back to the app text for a code it does not know', () => {
    setLanguage('en');
    expect(renderToStaticMarkup(createElement(Refusals, { failure: { ok: false, code: 'revision', text: 'changed since you read it' } }))).toContain(t('ui.procedures.error.revision'));
    expect(renderToStaticMarkup(createElement(Refusals, { failure: { ok: false, code: 'brand-new', text: 'A reason from a newer app' } }))).toContain('A reason from a newer app');
  });
});

describe('the controls', () => {
  const actions = (over: Partial<Parameters<typeof RecordActions>[0]> = {}): string =>
    renderToStaticMarkup(createElement(RecordActions, { record: procedureRecord({ reviewed: false, previous: { title: 'Before', steps: [{ text: 'x' }], pitfalls: [], waits: [] } }), canWrite: true, mode: 'view', busy: false, on: none, ...over }));

  it('are Edit, Mark as reviewed, Restore and Delete on the computer', () => {
    setLanguage('en');
    const html = actions();
    for (const key of ['ui.procedures.edit.button', 'ui.procedures.review', 'ui.procedures.restore', 'ui.procedures.delete.button']) expect(html).toContain(`>${t(key)}</button>`);
  });

  it('draw nothing in a paired browser: no edit, no review, no restore, no delete', () => {
    expect(actions({ canWrite: false })).toBe('');
    expect(actions({ canWrite: false, mode: 'delete' })).toBe('');
    expect(actions({ canWrite: false, mode: 'edit' })).toBe('');
  });

  it('offer review only to what the person has not reviewed, and restore only where there is a version before', () => {
    setLanguage('en');
    const reviewed = actions({ record: procedureRecord({ reviewed: true, previous: null }) });
    expect(reviewed).not.toContain(t('ui.procedures.review'));
    expect(reviewed).not.toContain(t('ui.procedures.restore'));
    expect(reviewed).toContain(t('ui.procedures.edit.button'));
  });

  it('ask before a delete, say what it means, and have both ways out', () => {
    setLanguage('en');
    const html = actions({ mode: 'delete', record: procedureRecord({ title: 'Rebase a branch' }) });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Delete “Rebase a branch”? Its file is removed and its id is never used again.');
    expect(html).toContain(`>${t('ui.procedures.delete.yes')}</button>`);
    expect(html).toContain(`>${t('ui.procedures.delete.no')}</button>`);
    expect(html).not.toContain(`>${t('ui.procedures.edit.button')}</button>`);
  });

  it('disable themselves while a write is on its way', () => {
    expect(actions({ busy: true }).match(/disabled=""/g)).toHaveLength(4);
  });
});

describe('the editor', () => {
  const editor = (): string => renderToStaticMarkup(createElement(RecordEditor, { record, onSave: () => Promise.resolve({ ok: true as const, record }), onCancel: () => undefined, onReload: () => undefined }));

  it('shows the fields as they are, with the limits and the warning about what never to write, in both languages', () => {
    for (const language of ['en', 'pt-BR'] as const) {
      setLanguage(language);
      const html = editor();
      expect(html).toContain('value="Run the end-to-end tests"');
      expect(html).toContain('value="npm run stack:up"');
      expect(html).toContain('Do not run it twice\nClose the editor first');
      expect(html).toContain(CATALOGS[language]['ui.procedures.edit.save']);
      expect(html).toContain(CATALOGS[language]['ui.procedures.edit.cancel']);
      expect(html).toContain(CATALOGS[language]['ui.procedures.edit.addStep']);
      expect(html).toContain(`${LIMITS.steps}`);
    }
  });

  it('starts with Save off, since nothing changed', () => {
    setLanguage('en');
    expect(editor()).toMatch(/<button type="submit" class="btn btn-dark" disabled="">Save<\/button>/);
  });
});
