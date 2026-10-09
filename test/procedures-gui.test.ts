import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditEntry } from '../src/shared/auditoria';
import { awaitsReview, type ProcedureRecord } from '../src/shared/procedures';
import { neutralConfig } from '../src/shared/config';
import { createProcedureChannels } from '../src/main/procedures/channels';
import { procedureScreen } from '../src/main/procedures/screen';
import { createProcedureSession, type ProcedureSession } from '../src/main/procedures/session';
import { selectProcedures } from '../src/main/procedures/select';
import { createProcedureStore, proceduresPath, type ProcedureStore } from '../src/main/procedures/store';
import { createTypedValues, type TypedValues } from '../src/main/screen/typedValues';
import { fakeSteps, type FakeSteps } from './helpers/screenSteps';

// A gui procedure is saved from the app's draft and from nothing else (#179, spec rules 24 and 29 to 33; acceptance 2 to 6): the steps are the recorded ones, the key is a site
// the browser was on, a replacement updates the record, and a call in which the person used the screen writes a record that waits for their review and none that holds what they
// typed. Neutral hosts and a temp folder only.

const KEY = 'call:t-1:agent';
let ws: string;
let counter: number;
let notes: { code: string; params: Record<string, string | number> }[];
let audits: Omit<AuditEntry, 'at'>[];

interface World {
  f: FakeSteps;
  session: ProcedureSession;
  store: ProcedureStore;
  typed: TypedValues;
  /** Pretends the service saw a hand-off on this screen before the call. */
  earlier: { had: boolean };
}

function world(o: { shell?: 'sandbox' | 'host' | 'none'; browser?: boolean; store?: ProcedureStore; f?: FakeSteps } = {}): World {
  const f = o.f ?? fakeSteps(KEY);
  const store = o.store ?? createProcedureStore(ws, { hex: () => (++counter).toString(16).padStart(8, '0') });
  const typed = createTypedValues();
  const earlier = { had: false };
  const screen = procedureScreen({ key: KEY, sessions: f.sessions, typed, handoff: { hadHandoff: () => earlier.had }, browser: o.browser ?? true });
  const session = createProcedureSession(
    { store, note: (code, params) => notes.push({ code, params }), audit: (e) => audits.push(e) },
    { writer: { by: 'agent', surface: 'direct', ref: 't-1', permission: 'worktree', shell: o.shell ?? 'sandbox' }, workspaceRepos: ['api'], select: { repos: [], tools: [], hosts: ['docs.example.com'], language: 'en' }, home: '/home/someone', screen },
  );
  return { f, session, store, typed, earlier };
}

const files = (): string[] => (existsSync(proceduresPath(ws)) ? readdirSync(proceduresPath(ws)).filter((x) => /^p-.*\.json$/.test(x)) : []);
const onDisk = (id: string): ProcedureRecord => JSON.parse(readFileSync(join(proceduresPath(ws), `${id}.json`), 'utf8'));

/** A short task on a site, so a draft has steps. */
function work(f: FakeSteps): void {
  f.navigate('https://docs.example.com/budget');
  f.read();
  f.click('link', 'Quarter two');
  f.click('button', 'Save');
}

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-gui-'));
  counter = 0;
  notes = [];
  audits = [];
});

const save = (w: World, over: Record<string, unknown> = {}): Promise<{ text: string }> => w.session.tools.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Update the budget', ...over });

describe('saving a gui procedure', () => {
  it('needs a draft: without a draft id, with one the call does not have, or in a call without the browser, it is refused and nothing is written (acceptance 3)', async () => {
    const w = world();
    work(w.f);
    expect((await w.session.tools.save({ kind: 'gui', key: 'docs.example.com', title: 'Update the budget', steps: [{ text: 'Open it' }] })).text).toMatch(/^Not saved: use the draft\. Call procedures_draft/);
    expect((await save(w)).text).toMatch(/^Not saved: there is no such draft in this call/);
    expect((await w.session.tools.draft?.({}))?.text).toMatch(/^Draft d-1/);
    expect((await save(w, { draft: 'd-9' })).text).toMatch(/there is no such draft/);
    const bare = world({ browser: false });
    expect((await bare.session.tools.save({ kind: 'gui', draft: 'd-1', key: 'docs.example.com', title: 'Update the budget' })).text).toMatch(/this call has no browser of the app/);
    expect(files()).toEqual([]);
    expect(audits.map((a) => a.fields.code)).toEqual(['gui-draft', 'gui-draft', 'gui-draft', 'gui-draft']);
    expect(audits.every((a) => !a.ok)).toBe(true);
  });

  it('keeps the recorded steps as they were, marks the record keyed by the app and recorded, and leaves a line and an audit entry without a step (acceptance 3)', async () => {
    const w = world();
    work(w.f);
    await w.session.tools.draft?.({});
    const a = await save(w);
    expect(a.text).toMatch(/^Saved p-00000001 at revision 1: "Update the budget"/);
    expect(onDisk('p-00000001')).toMatchObject({
      kind: 'gui',
      key: 'docs.example.com',
      keyedBy: 'app',
      stepsFrom: 'recording',
      reviewed: false,
      steps: [
        { text: 'Open /budget on docs.example.com' },
        { text: 'Click the link "Quarter two" (page /budget on docs.example.com)' },
        { text: 'Click the button "Save" (page /budget on docs.example.com)' },
      ],
    });
    expect(onDisk('p-00000001').origin.handoff).toBeUndefined();
    expect(notes.map((n) => n.code)).toEqual(['runner.procedures.saved']);
    expect(JSON.stringify([audits, notes])).not.toContain('Quarter two');
  });

  it('takes the wait figures the app measured when the agent gives none, and its own when it does', async () => {
    const w = world();
    w.f.navigate('/budget');
    w.f.wait(2300);
    await w.session.tools.draft?.({});
    await save(w);
    expect(onDisk('p-00000001').waits).toEqual(['On /budget on docs.example.com: wait about 3 s for the page or an element']);
    // The first save moved the screen's mark (#187): the second draft is of what the screen did after it.
    w.f.navigate('/summary');
    w.f.wait(2300);
    await w.session.tools.draft?.({});
    await save(w, { draft: 'd-2', title: 'Update the budget again', waits: ['After Save, wait for the toast; about 3 s'] });
    expect(onDisk('p-00000002').waits).toEqual(['After Save, wait for the toast; about 3 s']);
  });

  it('accepts dropped steps and a reworded one, marks the reworded step and the record as edited, and refuses a step the app did not record (acceptance 3)', async () => {
    const w = world();
    work(w.f);
    await w.session.tools.draft?.({});
    const a = await save(w, { steps: [{ n: 1 }, { n: 3, text: 'Click Save and wait for the confirmation' }] });
    expect(a.text).toMatch(/^Saved/);
    const rec = onDisk('p-00000001');
    expect(rec.stepsFrom).toBe('edited');
    expect(rec.steps).toEqual([{ text: 'Open /budget on docs.example.com' }, { text: 'Click Save and wait for the confirmation', edited: true }]);

    const refusals: [unknown, RegExp][] = [
      [[{ n: 4 }], /the app did not record a step 4; the draft has steps 1 to 3/],
      [[{ n: 1 }, { text: 'Delete everything' }], /steps\[1\]\.n must be the number of a step of the draft/],
      [[{ n: 1, run: 'rm -rf /' }], /may hold only n and text/],
      [['Open the settings'], /must name a draft step by its number/],
      [[{ n: 2 }, { n: 1 }], /keep the draft's order/],
      [[{ n: 1 }, { n: 1 }], /keep the draft's order/],
      ['all of them', /steps must be a list of draft step numbers/],
    ];
    for (const [steps, message] of refusals) expect((await save(w, { title: 'Another title', steps })).text).toMatch(message);
    // The field name an agent chose is not echoed into the log.
    await save(w, { title: 'Another title', steps: [{ n: 1, 'my-chosen-field': 'x' }] });
    expect(JSON.stringify(audits)).not.toContain('my-chosen-field');
    expect(audits.at(-1)?.fields.fields).toContain('steps[0].<unknown>');
    expect(files()).toEqual(['p-00000001.json']);
  });

  it('takes the key from the pages the browser was on: a site it never reached is refused, in a sandbox and on the computer alike (acceptance 4)', async () => {
    for (const shell of ['sandbox', 'host'] as const) {
      ws = mkdtempSync(join(tmpdir(), 'coxia-procedures-gui-'));
      const w = world({ shell });
      work(w.f);
      w.f.navigate('https://elsewhere.example.net/', { outcome: 'not-run' });
      await w.session.tools.draft?.({});
      expect((await save(w, { key: 'bank.example.com' })).text).toMatch(/^Not saved: key must be a site the app's browser visited on this screen: docs\.example\.com\./);
      expect((await save(w, { key: 'elsewhere.example.net' })).text).toMatch(/^Not saved: key must be a site/);
      expect((await save(w, { key: 'Docs.Example.com' })).text).toMatch(/^Saved/);
      expect(onDisk('p-00000001').key).toBe('docs.example.com');
      counter = 0;
    }
  });

  it('leaves no gui record for work done only through the shell, and the other kinds can still be written (acceptance 4)', async () => {
    const w = world();
    expect((await w.session.tools.draft?.({}))?.text).toMatch(/^Nothing to draft/);
    expect((await save(w)).text).toMatch(/no such draft/);
    const other = await w.session.tools.save({ kind: 'repo', key: 'api', title: 'Start the stack', steps: [{ text: 'Run it', run: 'npm run stack:up' }] });
    expect(other.text).toMatch(/^Saved/);
    expect(onDisk('p-00000001').kind).toBe('repo');
    expect(files()).toEqual(['p-00000001.json']);
  });

  it('is for kind gui: a screen draft id on another kind is refused (repo and tool take a draft of commands, which this call has none of)', async () => {
    const w = world();
    work(w.f);
    await w.session.tools.draft?.({});
    expect((await w.session.tools.save({ kind: 'repo', draft: 'd-1', key: 'api', title: 'Run it', steps: [{ text: 'x' }] })).text).toMatch(/^Not saved: a command draft comes from the commands of the app's shell, and this call has none/);
    expect((await w.session.tools.save({ kind: 'cycle', draft: 'd-1', key: 'development', title: 'Run it', steps: [{ text: 'x' }] })).text).toBe('Not saved: a draft is for kind gui (a draft of the screen) or kind repo or tool (a draft of commands).');
    expect(files()).toEqual([]);
  });

  it('refuses a step, a note or a wait the validator cannot keep, naming the field and never the value (acceptance 6)', async () => {
    const w = world();
    work(w.f);
    await w.session.tools.draft?.({});
    const quote = 'x'.repeat(41);
    const cases: [Record<string, unknown>, string, RegExp][] = [
      [{ pitfalls: [`The page says "${quote}" when it fails`] }, 'pitfalls[0]', /quotes more than 40 characters/],
      [{ waits: ['See https://docs.example.com/report?id=7#top for the figure'] }, 'waits[0]', /URL with a query string or a fragment/],
      [{ steps: [{ n: 1, text: 'Open the sheet of account 123456789 first' }] }, 'steps[0].text', /run of 6 or more digits/],
      [{ title: 'Update the budget\nnow' }, 'title', /one line only/],
    ];
    for (const [over, field, reason] of cases) {
      const a = await save(w, over);
      expect(a.text).toMatch(/^Not saved\. Fix these and save again:/);
      expect(a.text).toContain(field);
      expect(a.text).toMatch(reason);
      for (const value of [quote, 'id=7', '123456789']) expect(a.text).not.toContain(value);
    }
    expect(files()).toEqual([]);
    expect(JSON.stringify(audits)).not.toMatch(/123456789|id=7/);
  });
});

describe('replacing a gui procedure the call followed', () => {
  async function existing(): Promise<{ store: ProcedureStore; id: string }> {
    const first = world();
    first.f.navigate('/budget');
    first.f.click('button', 'Submit');
    await first.session.tools.draft?.({});
    const a = await save(first);
    expect(a.text).toMatch(/^Saved p-00000001/);
    return { store: first.store, id: 'p-00000001' };
  }

  it('offers the draft with the existing id and a comparison, and saving it updates the record: revision up, the version before kept, no second record (acceptance 5)', async () => {
    const { store, id } = await existing();
    const w = world({ store });
    expect((await w.session.tools.get({ id })).text).toContain('Update the budget');
    w.f.navigate('/budget');
    w.f.click('button', 'Save');
    const draft = (await w.session.tools.draft?.({}))?.text ?? '';
    expect(draft).toContain(`You followed ${id} ("Update the budget", revision 1) and this draft differs from it: 1 steps kept, 1 changed, 0 new, 0 of its steps not in the draft. Saving this draft replaces it: save with id ${id} and revision 1.`);
    const a = await save(w, { revision: 1 });
    expect(a.text).toMatch(/^Replaced p-00000001: now revision 2/);
    expect(files()).toEqual(['p-00000001.json']);
    const rec = onDisk(id);
    expect(rec).toMatchObject({ revision: 2, state: 'unverified', stepsFrom: 'recording', keyedBy: 'app' });
    expect(rec.steps.map((s) => s.text)).toEqual(['Open /budget on docs.example.com', 'Click the button "Save" (page /budget on docs.example.com)']);
    expect(rec.previous?.steps.map((s) => s.text)).toEqual(['Open /budget on docs.example.com', 'Click the button "Submit" (page /budget on docs.example.com)']);
    expect(notes.map((n) => n.code)).toContain('runner.procedures.replaced');
  });

  it('refuses another id for that draft, and a revision that is not the one read', async () => {
    const { store, id } = await existing();
    const w = world({ store });
    await w.session.tools.get({ id });
    w.f.navigate('/budget');
    w.f.click('button', 'Save');
    await w.session.tools.draft?.({});
    expect((await save(w, { id: 'p-ffffffff', revision: 1 })).text).toMatch(/^Not saved: this draft stands for p-00000001 \(revision 1\), which you followed/);
    expect((await save(w)).text).toMatch(/changed since you read it \(it is at revision 1, you named none\)/);
    expect(onDisk(id).revision).toBe(1);
  });

  it('does not add a twin: a new record with the title of an existing one is refused, naming the one to update', async () => {
    const { store, id } = await existing();
    const w = world({ store });
    w.f.navigate('/budget');
    await w.session.tools.draft?.({});
    const a = await save(w);
    expect(a.text).toContain(`It exists: ${id}`);
    expect(files()).toEqual(['p-00000001.json']);
  });
});

describe('what the person typed in a hand-off (acceptance 2)', () => {
  const SECRET = 'correct horse 42';

  it('is refused in any field of any kind, in the plain, URL-encoded and JSON-escaped forms: nothing is written and the log has the field and no value', async () => {
    const w = world();
    work(w.f);
    w.typed.add([SECRET]);
    await w.session.tools.draft?.({});
    const forms = [SECRET, encodeURIComponent(SECRET), JSON.stringify(SECRET).slice(1, -1), `"${SECRET}"`];
    for (const form of forms) {
      const gui = await save(w, { pitfalls: [`The code is ${form} here`] });
      expect(gui.text).toBe('Not saved: pitfalls[0] holds text the person typed while they had the screen in this call. Rewrite it without it: name a control by its role and visible label, and write <value> or <your login> where a value goes.');
    }
    const kinds: [string, Record<string, unknown>, string][] = [
      ['repo', { key: 'api', title: `Start with ${SECRET}`, steps: [{ text: 'Run it' }] }, 'title'],
      ['tool', { key: 'git', title: 'Use git', steps: [{ text: 'Run it', run: `git clone ${SECRET}` }] }, 'steps[0].run'],
      ['request', { key: 'budget', title: 'Ask for it', steps: [`Say ${SECRET}`], waits: ['Wait a bit'] }, 'steps[0].text'],
      ['cycle', { key: 'development', title: 'Build it', steps: [{ text: 'Run it' }], waits: [`Wait for ${SECRET}`] }, 'waits[0]'],
    ];
    for (const [kind, rest, field] of kinds) expect((await w.session.tools.save({ kind, ...rest })).text).toContain(`${field} holds text the person typed`);
    expect((await save(w, { title: `Update ${SECRET}` })).text).toContain('title holds text the person typed');
    expect((await save(w, { key: SECRET })).text).toContain('Not saved: key must be a site');
    expect(files()).toEqual([]);
    const seen = JSON.stringify([audits, notes]);
    expect(seen).not.toContain('correct horse');
    expect(seen).not.toContain('correct%20horse');
    expect(audits.filter((a) => a.fields.code === 'typed').length).toBeGreaterThanOrEqual(8);
    expect(audits.find((a) => a.fields.code === 'typed')?.fields.fields).toBe('pitfalls[0]');
  });

  it('lets a text without it through, and the record it makes waits for the review, from a gui draft and from any other kind', async () => {
    const w = world();
    work(w.f);
    w.f.type();
    w.f.handoff();
    w.typed.add([SECRET]);
    await w.session.tools.draft?.({});
    const gui = await save(w);
    expect(gui.text).toMatch(/^Saved p-00000001 at revision 1: "Update the budget"\. The person used the screen in this call, so it waits for their review/);
    const rec = onDisk('p-00000001');
    expect(rec.origin.handoff).toBe(true);
    expect(rec.reviewed).toBe(false);
    expect(awaitsReview(rec)).toBe(true);
    expect(rec.steps.map((s) => s.text)).toContain('The person completes a login or a confidential input here');
    const repo = await w.session.tools.save({ kind: 'repo', key: 'api', title: 'Start the stack', steps: [{ text: 'Run it' }] });
    expect(repo.text).toContain('waits for their review');
    expect(onDisk('p-00000002').origin.handoff).toBe(true);
    expect(notes.filter((n) => n.code === 'runner.procedures.heldForReview').map((n) => n.params.id)).toEqual(['p-00000001', 'p-00000002']);
    expect(audits.find((a) => a.result === 'saved')?.fields.held).toBe('waits for review');
  });

  it('keeps a held record out of the prompt list, procedures_list and procedures_get until the person reviews it', async () => {
    const w = world();
    work(w.f);
    w.typed.add([SECRET]);
    await w.session.tools.draft?.({});
    await save(w);
    const id = 'p-00000001';
    const rec = onDisk(id);
    const ctx = { repos: [], tools: [], hosts: ['docs.example.com'], language: 'en' as const, now: Date.now() };
    expect(selectProcedures([rec], ctx)).toEqual([]);
    expect(selectProcedures([{ ...rec, reviewed: true }], ctx)).toHaveLength(1);

    const later = world({ store: w.store, f: fakeSteps('call:t-2:other') });
    expect((await later.session.tools.list({})).text).toMatch(/^No procedure fits this call/);
    expect((await later.session.tools.list({ kind: 'gui', key: 'docs.example.com' })).text).toMatch(/^No procedure has that kind and key/);
    expect((await later.session.tools.get({ id })).text).toMatch(/waits for their review\. No agent can read it/);
    expect(later.session.readIds()).toEqual([]);

    expect(w.store.review(id).ok).toBe(true);
    const reviewed = world({ store: w.store, f: fakeSteps('call:t-3:other') });
    expect((await reviewed.session.tools.list({ kind: 'gui' })).text).toContain(id);
    expect((await reviewed.session.tools.get({ id })).text).toContain('Update the budget');
  });

  it('holds a record from a later call on the same screen, where the typed values are gone but the service remembers the hand-off', async () => {
    const w = world();
    w.earlier.had = true;
    work(w.f);
    await w.session.tools.draft?.({});
    expect((await save(w)).text).toContain('waits for their review');
    expect(onDisk('p-00000001').origin.handoff).toBe(true);
  });

  it('is a record that does not wait when no hand-off took place', async () => {
    const w = world();
    work(w.f);
    await w.session.tools.draft?.({});
    await save(w);
    expect(awaitsReview(onDisk('p-00000001'))).toBe(false);
    expect(notes.map((n) => n.code)).not.toContain('runner.procedures.heldForReview');
  });
});

describe('the person and a record that waits for the review', () => {
  async function held(): Promise<{ w: World; id: string }> {
    const w = world();
    work(w.f);
    w.typed.add(['some words']);
    await w.session.tools.draft?.({});
    await save(w);
    return { w, id: 'p-00000001' };
  }
  const channels = (w: World) => createProcedureChannels({ store: w.store, config: () => neutralConfig(), home: '/home/someone' });

  it('is seen by the person in the list as waiting, and marking it reviewed makes it readable without changing its text or revision', async () => {
    const { w, id } = await held();
    const c = channels(w);
    expect(c.list().items.map((i) => [i.id, i.awaitsReview])).toEqual([[id, true]]);
    const before = onDisk(id);
    expect(c.review(id)).toMatchObject({ ok: true });
    expect(c.list().items[0].awaitsReview).toBe(false);
    expect(onDisk(id)).toMatchObject({ revision: before.revision, steps: before.steps, reviewed: true });
    const next = world({ store: w.store, f: fakeSteps('call:t-2:other') });
    expect((await next.session.tools.get({ id })).text).toContain('Update the budget');
  });

  it('is the person\'s own once they rewrite it: reviewed, and no longer waiting', async () => {
    const { w, id } = await held();
    const c = channels(w);
    const rec = onDisk(id);
    const r = c.save(id, rec.revision, { kind: 'gui', key: rec.key, title: 'Update the budget sheet', steps: rec.steps, pitfalls: [], waits: [] });
    expect(r).toMatchObject({ ok: true });
    expect(onDisk(id)).toMatchObject({ reviewed: true, revision: 2 });
    expect(onDisk(id).origin.handoff).toBeUndefined();
    expect(c.list().items[0].awaitsReview).toBe(false);
  });
});
