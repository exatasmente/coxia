// The app's browser around a hand-off (#178): while the person has the screen every call of the agent is refused before anything is read or done and is not a step; after it,
// every page the app returns has what the person typed taken out, in the plain, URL-encoded and JSON-escaped forms, on the first read and the later ones, until the call ends; a
// value under 4 characters is not hidden; a picture of a page that shows a typed value is refused and one that does not is returned; and no step holds a typed value. The server
// is the scripted fake, the hand-off service is the real one over a hub that only lists what it was asked, and no display is involved.
import { beforeEach, describe, expect, it } from 'vitest';
import { HANDOFF_HELD_TEXT } from '../src/shared/handoff';
import { setLanguage, t } from '../src/shared/i18n';
import { toolsFor } from '../src/main/browser/allowlist';
import { type ScreenToolset, CONFIRM_TOOL_NAME, HANDOFF_TOOL_NAME, screenToolImpls } from '../src/main/browser/engineTool';
import { createHostsTally } from '../src/main/browser/hosts';
import { createIntermediary } from '../src/main/browser/intermediary';
import { createMaskSet } from '../src/main/browser/mask';
import { createStepLog } from '../src/main/browser/stepLog';
import type { ToolContext } from '../src/main/engine/open/tools/types';
import { fakeHandoff } from './helpers/handoff';
import { fakeServer, formSnapshot } from './helpers/browserServer';

beforeEach(() => setLanguage('en'));

const KEY = 'call:general:web';
const VALUE = 'p@ss "w0rd"/x';
const URL_FORM = encodeURIComponent(VALUE);
const JSON_FORM = JSON.stringify(VALUE).slice(1, -1);
const ctx = (): ToolContext => ({ cwd: '', roots: [], isSecret: () => false, secretGlobs: [], outputMax: 100_000, env: {}, bashPrefixes: [], ripgrep: 'off' });

function world() {
  const server = fakeServer();
  const masks = createMaskSet();
  const log = createStepLog();
  const fh = fakeHandoff({ masks: () => masks, step: (_key, step) => void log.add(step) });
  const inter = createIntermediary({
    client: server.client,
    network: { mode: 'proxy', hosts: ['example.com'] },
    hosts: createHostsTally(),
    masks,
    log,
    gate: { hold: async () => 'yes', passed: () => false },
    seesImages: true,
  });
  const call = fh.service.begin({ key: KEY, thread: 'general', place: 'conversation', stage: '', agent: 'web', agentName: 'Web', about: '', paths: { browser: true, shell: 'none' }, pause: () => () => undefined, signal: new AbortController().signal });
  const options = { held: call.active };
  const set: ScreenToolset = { browser: inter, handoff: { request: call.request, active: call.active }, typed: call.typed, confirm: async () => ({ answer: 'yes' }) };
  /** The whole hand-off: the agent asks, the person takes the screen, types `typed`, gives it back. */
  const handOver = async (typed: string[]): Promise<string | null> => {
    const asked = call.request({ what: 'Log in to the site' });
    await fh.take(KEY);
    fh.typed = typed;
    fh.give(KEY);
    return asked;
  };
  return { server, masks, log, fh, inter, call, options, set, handOver };
}

/** A page that shows the value in each of its forms: in the address, the title, a field and a link. */
function pageShowing(w: ReturnType<typeof world>, shown = VALUE): void {
  const snapshot = (value: string) =>
    `### Page\n- Page URL: https://example.com/welcome?code=${encodeURIComponent(value)}\n- Page Title: Welcome ${value}\n### Snapshot\n\`\`\`yaml\n- generic [active] [ref=e1]:\n  - textbox "Code" [ref=e8]: ${value}\n  - link "${JSON.stringify(value).slice(1, -1)}" [ref=e4]\n  - heading "Hello" [ref=e2]\n\`\`\``;
  w.server.state.snapshot = snapshot(shown);
  w.server.state.actText = snapshot(shown).split('### Snapshot')[0];
}

const forms = (text: string): string[] => [VALUE, URL_FORM, JSON_FORM].filter((f) => text.includes(f));

describe('while the person has the screen', () => {
  it('refuses every call of the app\'s browser, a confirmation and a second hand-off, reads and does nothing, and records no step', async () => {
    const w = world();
    const asked = w.call.request({ what: 'Log in to the site' });
    // Asked, not yet taken: nothing is refused.
    expect((await w.inter.call('browser_snapshot', {}, w.options)).isError).toBe(false);
    const before = w.server.calls.length;
    const steps = w.log.entries().length;
    await w.fh.take(KEY);
    expect(w.call.active()).toBe(true);
    for (const row of toolsFor(true)) {
      const r = await w.inter.call(row.name, row.name === 'browser_navigate' ? { url: 'https://example.com/' } : {}, w.options);
      expect(r, row.name).toEqual({ text: HANDOFF_HELD_TEXT, images: [], isError: true });
    }
    // Through the tools the engines offer: the confirmation and a second hand-off are refused with the same words, and the browser's tool too.
    for (const impl of screenToolImpls(w.set)) {
      const input = impl.name === CONFIRM_TOOL_NAME ? { kind: 'send', words: 'send it' } : impl.name === HANDOFF_TOOL_NAME ? { what: 'again' } : impl.name === 'browser_navigate' ? { url: 'https://example.com/' } : {};
      const out = await impl.run(input as never, ctx()).then(
        (r) => r.render(r.response),
        (e: Error) => e.message,
      );
      expect(out, impl.name).toBe(HANDOFF_HELD_TEXT);
    }
    expect(w.server.calls).toHaveLength(before);
    expect(w.log.entries()).toHaveLength(steps);
    w.fh.give(KEY);
    expect(await asked).toBe('done');
    // And everything runs again.
    expect((await w.inter.call('browser_snapshot', {}, w.options)).isError).toBe(false);
    expect(w.server.calls.length).toBeGreaterThan(before);
  });

  it('refuses a call that was queued behind a slow one when the person took the screen in between', async () => {
    const w = world();
    let held = false;
    const options = { held: () => held || w.call.active() };
    // The click is in the browser when the person takes the screen.
    w.server.state.onAct = () => void (held = true);
    const slow = w.inter.call('browser_click', { target: 'e4' }, options);
    const queued = w.inter.call('browser_snapshot', {}, options);
    expect((await slow).isError).toBe(false);
    const seen = w.server.calls.length;
    expect(await queued).toEqual({ text: HANDOFF_HELD_TEXT, images: [], isError: true });
    expect(w.server.calls).toHaveLength(seen);
    // The refusal is not a step and does not hold the screen busy.
    expect(w.log.entries().map((e) => e.tool)).toEqual(['browser_click']);
  });
});

describe('after the person gave the screen back', () => {
  it('masks every kind of read, in the three forms, on the first read and on later ones', async () => {
    const w = world();
    pageShowing(w);
    // Before the hand-off the page is the page.
    const plain = await w.inter.call('browser_snapshot', {}, w.options);
    expect(forms(plain.text).sort()).toEqual([JSON_FORM, URL_FORM, VALUE].sort());
    expect(await w.handOver([VALUE])).toBe('done');
    const reads = [
      await w.inter.call('browser_snapshot', {}, w.options),
      await w.inter.call('browser_find', { text: 'Code' }, w.options),
      await w.inter.call('browser_navigate', { url: 'https://example.com/welcome' }, w.options),
      await w.inter.call('browser_click', { target: 'e4' }, w.options),
      await w.inter.call('browser_snapshot', {}, w.options),
    ];
    for (const r of reads) expect(forms(r.text), r.text).toEqual([]);
    expect(reads[0].text).toContain('[secret]');
    expect(reads[0].text).toContain('Welcome [secret]');
    expect(reads[0].text).toContain('code=[secret]');
    expect(reads[0].text).toContain('textbox "Code" [ref=e8]: [secret]');
    // The rest of the page is the page.
    expect(reads[0].text).toContain('heading "Hello"');
    // The act's snapshot comes from the app's own read and is masked too.
    expect(reads[3].text).toContain('textbox "Code"');
  });

  it('does not hide a value of fewer than 4 characters, and keeps hiding the longer one of an earlier hand-off', async () => {
    const w = world();
    pageShowing(w, 'abc');
    expect(await w.handOver(['abc'])).toBe('done');
    expect((await w.inter.call('browser_snapshot', {}, w.options)).text).toContain('Welcome abc');
    pageShowing(w);
    expect(await w.handOver([VALUE])).toBe('done');
    expect(forms((await w.inter.call('browser_snapshot', {}, w.options)).text)).toEqual([]);
    expect(w.call.typed.had).toBe(true);
  });

  it('refuses a picture of a page that shows the value, with the fixed sentence, and returns the picture of a page that does not', async () => {
    const w = world();
    pageShowing(w);
    expect(await w.handOver([VALUE])).toBe('done');
    const refused = await w.inter.call('browser_take_screenshot', {}, w.options);
    expect(refused).toEqual({ text: t('main.browser.reason.shownTyped'), images: [], isError: true });
    expect(refused.text).toBe('The page shows what the person typed; read it as text instead.');
    expect(w.server.calls.some((c) => c.name === 'browser_take_screenshot')).toBe(false);
    // The text read is the way, and it comes back masked.
    expect(forms((await w.inter.call('browser_snapshot', {}, w.options)).text)).toEqual([]);
    // The page moves on to one that does not show it: the picture is returned.
    w.server.state.snapshot = formSnapshot;
    const shot = await w.inter.call('browser_take_screenshot', {}, w.options);
    expect(shot.isError).toBe(false);
    expect(shot.images).toHaveLength(1);
  });

  it('refuses the picture too when the page cannot be read to check it', async () => {
    const w = world();
    pageShowing(w);
    expect(await w.handOver([VALUE])).toBe('done');
    w.server.state.snapshot = 'no snapshot here';
    const r = await w.inter.call('browser_take_screenshot', {}, w.options);
    expect(r).toEqual({ text: t('main.browser.reason.maskFailed'), images: [], isError: true });
  });

  it('answers a picture as it always did when there was no hand-off', async () => {
    const w = world();
    pageShowing(w);
    const shot = await w.inter.call('browser_take_screenshot', {}, w.options);
    expect(shot.isError).toBe(false);
    expect(shot.images).toHaveLength(1);
  });

  it('puts one step for the hand-off, with no name, and no typed value in any step', async () => {
    const w = world();
    pageShowing(w);
    // A page whose address and a control's name carry the value: the steps the log keeps are cleaned too.
    w.server.state.actText = `### Page\n- Page URL: https://example.com/${URL_FORM}\n- Page Title: x`;
    expect(await w.handOver([VALUE])).toBe('done');
    await w.inter.call('browser_navigate', { url: 'https://example.com/welcome' }, w.options);
    await w.inter.call('browser_click', { target: 'e4' }, w.options);
    const entries = w.log.entries();
    const handoff = entries.filter((e) => e.tool === 'screen_handoff');
    expect(handoff).toHaveLength(1);
    expect(handoff[0]).toMatchObject({ class: 'free', outcome: 'ok' });
    expect(handoff[0].name).toBeUndefined();
    const json = JSON.stringify(entries);
    for (const f of [VALUE, URL_FORM, JSON_FORM]) expect(json).not.toContain(f);
  });

  it('stops hiding when the call ends, and remembers only that there was a hand-off', async () => {
    const w = world();
    pageShowing(w);
    expect(await w.handOver([VALUE])).toBe('done');
    expect(w.masks.size).toBe(1);
    w.call.end();
    expect(w.masks.size).toBe(0);
    expect(w.call.typed.had).toBe(true);
    expect(w.call.typed.hits(VALUE)).toBe(false);
    expect(forms((await w.inter.call('browser_snapshot', {})).text).length).toBeGreaterThan(0);
  });
});
