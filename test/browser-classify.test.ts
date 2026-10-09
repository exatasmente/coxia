// The classification of the app's browser steps, over snapshots and answers recorded from the pinned Playwright MCP (test/fixtures/browser, with example.com names). The class comes from
// what the app reads of the page, never from the agent's own words.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPOSED_TOOLS } from '../src/main/browser/allowlist';
import { type Classification, IRREVERSIBLE_WORDS, classify, irreversibleName, needsTarget, parseKey, stepKey } from '../src/main/browser/classify';
import { PROBE_ELEMENT_FN, PROBE_FOCUS_FN, type PageRead, type ProbeClient, type TargetInfo, focusedNode, pageUrl, parseProbe, readFocus, readPage, readTarget, snapshotNodes, snapshotText } from '../src/main/browser/probe';

const DIR = join(import.meta.dirname, 'fixtures', 'browser');
const formSnapshot = readFileSync(join(DIR, 'form.snapshot.txt'), 'utf8');
const recorded = JSON.parse(readFileSync(join(DIR, 'probes.json'), 'utf8')) as { element: string; focus: string; probes: Record<string, string>; focused: Record<string, { snapshot: string; probe: string }> };
const nodes = snapshotNodes(snapshotText(formSnapshot));

/** The element of the recorded page whose role and name read like `label`, as the app would have read it. */
function el(label: string): TargetInfo {
  const node = [...nodes.values()].find((n) => `${n.role} ${n.name}`.trim() === label);
  if (!node) throw new Error(`no ${label} in the recorded page`);
  const raw = Object.entries(recorded.probes).find(([k]) => k.startsWith(`${node.ref} `))?.[1];
  return { ref: node.ref, role: node.role, name: node.name, active: node.active, probe: raw ? parseProbe(raw) : null };
}
/** The element that had the focus in a recorded moment. */
function focused(moment: string): TargetInfo {
  const f = recorded.focused[moment];
  const n = focusedNode(snapshotNodes(snapshotText(f.snapshot)));
  return { ref: n?.ref ?? '', role: n?.role ?? '', name: n?.name ?? '', active: true, probe: parseProbe(f.probe) };
}

/** A button of the recorded page with the focus on it. */
const focusOn = (label: string): TargetInfo => ({ ...el(label), active: true });

describe('what the app reads of a recorded page', () => {
  it('asks the questions the fixtures were recorded with', () => {
    expect(recorded.element).toBe(PROBE_ELEMENT_FN);
    expect(recorded.focus).toBe(PROBE_FOCUS_FN);
  });

  it('reads role, name, ref and focus out of a snapshot, and drops what follows the colon (a field\'s value, the page\'s text)', () => {
    expect(pageUrl(formSnapshot)).toBe('https://example.com/');
    expect(nodes.get('e15')).toEqual({ ref: 'e15', role: 'button', name: 'Send', active: false });
    expect(nodes.get('e8')).toMatchObject({ role: 'textbox', name: 'Name' });
    expect(nodes.get('f1e2')).toMatchObject({ role: 'button', name: 'Inner action' });
    expect(nodes.get('e26')).toEqual({ ref: 'e26', role: 'button', name: '', active: false });
    expect(focusedNode(nodes)?.ref).toBe('e1');
    const snap = '- textbox "Cell A1" [active] [ref=e6]: hello\n- button "Say \\"hi\\"" [ref=e7]\n- text: Name\n- generic [ref=e9]: some page text';
    const n = snapshotNodes(snap);
    expect(n.get('e6')).toEqual({ ref: 'e6', role: 'textbox', name: 'Cell A1', active: true });
    expect(JSON.stringify([...n.values()])).not.toContain('hello');
    expect(n.get('e7')?.name).toBe('Say "hi"');
    expect(n.get('e9')?.name).toBe('');
    expect(n.size).toBe(3);
  });

  it('reads the answer of the question, and nothing from an error or a shape it did not ask for', () => {
    const send = el('button Send').probe;
    expect(send).toMatchObject({ tag: 'button', type: 'submit', form: true, submit: true, frame: 'top', origin: 'https://example.com' });
    expect(el('button Inner action').probe).toMatchObject({ frame: 'other', origin: 'https://frame.example.com' });
    expect(parseProbe('### Error\nTypeError: x')).toBeNull();
    expect(parseProbe('### Result\n"not json"')).toBeNull();
    expect(parseProbe('### Result\n"{\\"tag\\":\\"a\\",\\"frame\\":\\"weird\\"}"')).toBeNull();
    expect(parseProbe('')).toBeNull();
  });
});

type Row = [string, string, Record<string, unknown>, () => Partial<Parameters<typeof classify>[0]>, Classification['class'], Classification['why']?];

const FREE = 'free';
const HELD = 'irreversible';
const UNCLEAR = 'unclassified';

const rows: Row[] = [
  // A submit: a type that asks to submit, Enter in a field of a form, a click on a submit control.
  ['type that asks to submit', 'browser_type', { target: 'e8', text: 'x', submit: true }, () => ({ target: el('textbox Name') }), HELD, 'submit'],
  ['type with submit, whatever it is typed into', 'browser_type', { target: 'e21', text: 'x', submit: true }, () => ({ target: el('textbox Search the help') }), HELD, 'submit'],
  ['Enter in a field of a form', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('name') }), HELD, 'submit'],
  ['Enter on a checkbox of a form (implicit submission)', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('agree') }), HELD, 'submit'],
  ['click on a submit button', 'browser_click', { target: 'e15' }, () => ({ target: el('button Send') }), HELD, 'submit'],
  ['click on a submit input', 'browser_click', { target: 'e18' }, () => ({ target: el('button Save') }), HELD, 'submit'],
  ['click on a submit button with a name nobody listed', 'browser_click', { target: 'e15' }, () => ({ target: { ...el('button Send'), name: 'Go ahead', probe: { ...el('button Send').probe!, texts: ['', 'Go ahead', '', '', ''] } } }), HELD, 'submit'],
  ['Enter on a focused submit button', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  // A name: English and Brazilian Portuguese.
  ['click on Delete', 'browser_click', { target: 'e22' }, () => ({ target: el('button Delete') }), HELD, 'name'],
  ['click on Excluir', 'browser_click', { target: 'e23' }, () => ({ target: el('button Excluir') }), HELD, 'name'],
  ['click on Pagar', 'browser_click', { target: 'e24' }, () => ({ target: el('button Pagar') }), HELD, 'name'],
  ['click on a div named Publish', 'browser_click', { target: 'e31' }, () => ({ target: el('button Publish') }), HELD, 'name'],
  ['click on Enviar', 'browser_click', { target: 'e16' }, () => ({ target: el('button Enviar') }), HELD, 'submit'],
  ['a click the agent calls harmless on Delete', 'browser_click', { target: 'e22', element: 'harmless menu item', reason: 'just looking' }, () => ({ target: el('button Delete') }), HELD, 'name'],
  ['click on a Delete that is only in the page\'s own label', 'browser_click', { target: 'e25' }, () => ({ target: { ...el('button Details'), probe: { ...el('button Details').probe!, texts: ['Delete everything', 'Details', '', '', ''] } } }), HELD, 'name'],
  // A shortcut.
  ['Control+S', 'browser_press_key', { key: 'Control+S' }, () => ({ focus: focused('body') }), HELD, 'shortcut'],
  ['Meta+Enter', 'browser_press_key', { key: 'Meta+Enter' }, () => ({ focus: focused('body') }), HELD, 'shortcut'],
  ['Control and a line feed', 'browser_press_key', { key: 'Control+\n' }, () => ({}), HELD, 'shortcut'],
  ['ControlOrMeta+s', 'browser_press_key', { key: 'ControlOrMeta+s' }, () => ({}), HELD, 'shortcut'],
  // A dialog.
  ['accepting a dialog', 'browser_handle_dialog', { accept: true }, () => ({}), HELD, 'dialog'],
  ['dismissing a dialog', 'browser_handle_dialog', { accept: false }, () => ({}), FREE],
  // The aliases Playwright reads as Enter and Space press the same keys, and are held the same.
  ['a line feed on a focused submit button', 'browser_press_key', { key: '\n' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  ['a line feed on a focused Delete button', 'browser_press_key', { key: '\n' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  ['a line feed in a text field inside a form', 'browser_press_key', { key: '\n' }, () => ({ focus: focused('name') }), HELD, 'submit'],
  ['a carriage return on a focused submit button', 'browser_press_key', { key: '\r' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  ['a carriage return on a focused Delete button', 'browser_press_key', { key: '\r' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  ['a carriage return in a text field inside a form', 'browser_press_key', { key: '\r' }, () => ({ focus: focused('name') }), HELD, 'submit'],
  ['Shift and a line feed on a focused submit button', 'browser_press_key', { key: 'Shift+\n' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  ['Shift and a line feed on a focused Delete button', 'browser_press_key', { key: 'Shift+\n' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  ['Shift and a line feed in a text field inside a form', 'browser_press_key', { key: 'Shift+\n' }, () => ({ focus: focused('name') }), HELD, 'submit'],
  ['NumpadEnter on a focused submit button', 'browser_press_key', { key: 'NumpadEnter' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  ['NumpadEnter on a focused Delete button', 'browser_press_key', { key: 'NumpadEnter' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  ['NumpadEnter in a text field inside a form', 'browser_press_key', { key: 'NumpadEnter' }, () => ({ focus: focused('name') }), HELD, 'submit'],
  ['a lone space on a focused submit button', 'browser_press_key', { key: ' ' }, () => ({ focus: focused('send') }), HELD, 'submit'],
  ['a lone space on a focused Delete button', 'browser_press_key', { key: ' ' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  ['Shift and a space on a focused Delete button', 'browser_press_key', { key: 'Shift+ ' }, () => ({ focus: focusOn('button Delete') }), HELD, 'name'],
  // Not held.
  ['click on a link named Next', 'browser_click', { target: 'e4' }, () => ({ target: el('link Next') }), FREE],
  ['click on Cancel', 'browser_click', { target: 'e17' }, () => ({ target: el('button Cancel') }), FREE],
  ['click on Reset', 'browser_click', { target: 'e19' }, () => ({ target: el('button Reset') }), FREE],
  ['click on Sign in (free by name)', 'browser_click', { target: 'e29' }, () => ({ target: el('button Sign in') }), FREE],
  ['click on Details', 'browser_click', { target: 'e25' }, () => ({ target: el('button Details') }), FREE],
  ['click on a text box whose label holds a listed word', 'browser_click', { target: 'e21' }, () => ({ target: { ...el('textbox Search the help'), name: 'Send to' } }), FREE],
  ['click on a checkbox', 'browser_click', { target: 'e12' }, () => ({ target: el('checkbox I agree') }), FREE],
  ['click on a combobox', 'browser_click', { target: 'e14' }, () => ({ target: el('combobox Plan') }), FREE],
  ['typing', 'browser_type', { target: 'e8', text: 'Delete everything and send it' }, () => ({ target: el('textbox Name') }), FREE],
  ['typing slowly with no line break', 'browser_type', { target: 'e8', text: 'abc', slowly: true }, () => ({ target: el('textbox Name') }), FREE],
  ['filling a form without submitting', 'browser_fill_form', { fields: [{ target: 'e8', name: 'Name', type: 'textbox', value: 'x' }] }, () => ({}), FREE],
  ['selecting an option', 'browser_select_option', { target: 'e14', values: ['Pro'] }, () => ({ target: el('combobox Plan') }), FREE],
  ['hovering', 'browser_hover', { target: 'e22' }, () => ({ target: el('button Delete') }), FREE],
  ['a tab change', 'browser_tabs', { action: 'select', index: 1 }, () => ({}), FREE],
  ['a tab list', 'browser_tabs', { action: 'list' }, () => ({}), FREE],
  ['a GET navigation', 'browser_navigate', { url: 'https://example.com/delete-everything' }, () => ({}), FREE],
  ['going back', 'browser_navigate_back', {}, () => ({}), FREE],
  ['a snapshot', 'browser_snapshot', {}, () => ({}), FREE],
  ['a search of the snapshot', 'browser_find', { text: 'Delete' }, () => ({}), FREE],
  ['waiting', 'browser_wait_for', { time: 2 }, () => ({}), FREE],
  ['a screenshot', 'browser_take_screenshot', {}, () => ({}), FREE],
  ['Tab, Escape and the arrows', 'browser_press_key', { key: 'Tab' }, () => ({ focus: focused('send') }), FREE],
  ['Escape', 'browser_press_key', { key: 'Escape' }, () => ({}), FREE],
  ['ArrowDown', 'browser_press_key', { key: 'ArrowDown' }, () => ({}), FREE],
  ['a letter in a text field', 'browser_press_key', { key: 'a' }, () => ({ focus: focused('name') }), FREE],
  ['a capital letter in a text field', 'browser_press_key', { key: 'Shift+A' }, () => ({ focus: focused('name') }), FREE],
  ['a letter in a text area', 'browser_press_key', { key: 'a' }, () => ({ focus: focused('notes') }), FREE],
  ['a digit in a field outside any form', 'browser_press_key', { key: '7' }, () => ({ focus: focused('search') }), FREE],
  ['a letter in an editable region', 'browser_press_key', { key: 'a' }, () => ({ focus: { ref: 'e3', role: 'textbox', name: 'Doc', active: true, probe: { ...focused('name').probe!, editable: true, tag: 'div', form: false } } }), FREE],
  ['Control+A', 'browser_press_key', { key: 'Control+A' }, () => ({}), FREE],
  ['Control+C and Control+V', 'browser_press_key', { key: 'Control+v' }, () => ({}), FREE],
  ['Control+Z', 'browser_press_key', { key: 'ControlOrMeta+z' }, () => ({}), FREE],
  ['Space in a text area', 'browser_press_key', { key: 'Space' }, () => ({ focus: focused('notes') }), FREE],
  ['Enter on a select', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('plan') }), FREE],
  ['Enter with nothing focused', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('body') }), FREE],
  ['Space on a checkbox', 'browser_press_key', { key: 'Space' }, () => ({ focus: focused('agree') }), FREE],
  ['Space in a field', 'browser_press_key', { key: ' ' }, () => ({ focus: focused('name') }), FREE],
  ['Space in a field, spelled Space', 'browser_press_key', { key: 'Space' }, () => ({ focus: focused('name') }), FREE],
  // The app cannot say what these do.
  ['a control with no name at all', 'browser_click', { target: 'e26' }, () => ({ target: el('button') }), UNCLEAR, 'unclassified'],
  ['an iframe', 'browser_click', { target: 'e33' }, () => ({ target: el('iframe') }), UNCLEAR, 'unclassified'],
  ['a button inside a frame of another site', 'browser_click', { target: 'f1e2' }, () => ({ target: el('button Inner action') }), UNCLEAR, 'unclassified'],
  ['a click whose element could not be asked about', 'browser_click', { target: 'e4' }, () => ({ target: { ...el('link Next'), probe: null } }), UNCLEAR, 'unclassified'],
  ['a click on a ref the page does not have', 'browser_click', { target: 'e99' }, () => ({ target: null }), UNCLEAR, 'unclassified'],
  ['a click on a canvas', 'browser_click', { target: 'e5' }, () => ({ target: { ref: 'e5', role: 'img', name: 'Sheet', active: false, probe: { ...el('link Next').probe!, tag: 'canvas' } } }), UNCLEAR, 'unclassified'],
  ['a drag', 'browser_drag', { startTarget: 'e1', endTarget: 'e2' }, () => ({}), UNCLEAR, 'unclassified'],
  ['Enter in a text area (chat boxes send on it)', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('notes') }), UNCLEAR, 'unclassified'],
  ['a line break in a text area', 'browser_press_key', { key: '\n' }, () => ({ focus: focused('notes') }), UNCLEAR, 'unclassified'],
  ['a letter with the focus on the page (a single-key shortcut)', 'browser_press_key', { key: 'a' }, () => ({ focus: focused('body') }), UNCLEAR, 'unclassified'],
  ['a capital letter with the focus on the page', 'browser_press_key', { key: 'Shift+A' }, () => ({ focus: focused('body') }), UNCLEAR, 'unclassified'],
  ['a symbol with the focus on the page', 'browser_press_key', { key: '#' }, () => ({ focus: focused('body') }), UNCLEAR, 'unclassified'],
  ['a letter named by its code with the focus on the page', 'browser_press_key', { key: 'KeyE' }, () => ({ focus: focused('body') }), UNCLEAR, 'unclassified'],
  ['a letter on a button', 'browser_press_key', { key: 'e' }, () => ({ focus: focused('send') }), UNCLEAR, 'unclassified'],
  ['a letter on a checkbox', 'browser_press_key', { key: 'e' }, () => ({ focus: focused('agree') }), UNCLEAR, 'unclassified'],
  ['a letter where the focus could not be read', 'browser_press_key', { key: 'e' }, () => ({ focus: null }), UNCLEAR, 'unclassified'],
  ['a letter in a frame of another site', 'browser_press_key', { key: 'e' }, () => ({ focus: { ...focused('name'), probe: { ...focused('name').probe!, frame: 'other' as const } } }), UNCLEAR, 'unclassified'],
  ['Enter in a field outside any form', 'browser_press_key', { key: 'Enter' }, () => ({ focus: focused('search') }), UNCLEAR, 'unclassified'],
  ['Enter where the focus could not be read', 'browser_press_key', { key: 'Enter' }, () => ({ focus: null }), UNCLEAR, 'unclassified'],
  ['Enter in an editable region', 'browser_press_key', { key: 'Enter' }, () => ({ focus: { ref: 'e3', role: 'textbox', name: 'Doc', active: true, probe: { ...focused('name').probe!, editable: true, tag: 'div', form: false } } }), UNCLEAR, 'unclassified'],
  ['a chord the list has no row for', 'browser_press_key', { key: 'Control+Shift+K' }, () => ({}), UNCLEAR, 'unclassified'],
  ['Alt+F4', 'browser_press_key', { key: 'Alt+F4' }, () => ({}), UNCLEAR, 'unclassified'],
  ['Return as a key', 'browser_press_key', { key: 'Return' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['Spacebar as a key', 'browser_press_key', { key: 'Spacebar' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['a tab character as a key', 'browser_press_key', { key: '\t' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['a no-break space as a key', 'browser_press_key', { key: '\u00a0' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['a null character as a key', 'browser_press_key', { key: '\u0000' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['a line separator as a key', 'browser_press_key', { key: '\u2028' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['Enter and a trailing space as a key', 'browser_press_key', { key: 'Enter ' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['Enter and a leading space as a key', 'browser_press_key', { key: ' Enter' }, () => ({ focus: focused('name') }), UNCLEAR, 'unclassified'],
  ['a key nobody knows', 'browser_press_key', { key: 'Banana' }, () => ({}), UNCLEAR, 'unclassified'],
  ['a tool with no row', 'browser_evaluate', { function: '() => 1' }, () => ({}), UNCLEAR, 'unclassified'],
  ['an unknown tool', 'something_new', {}, () => ({}), UNCLEAR, 'unclassified'],
];

describe('the class of a step', () => {
  it.each(rows)('%s', (_label, tool, args, read, expected, why) => {
    const c = classify({ tool, args, ...read() });
    expect(c.class).toBe(expected);
    expect(c.why).toBe(why);
  });

  it('types Enter when text with a line break is typed key by key into a field of a form', () => {
    const name = el('textbox Name');
    expect(classify({ tool: 'browser_type', args: { target: 'e8', text: 'a\nb', slowly: true }, target: name })).toMatchObject({ class: HELD, why: 'submit' });
    // Typed key by key into a text area, the break is an Enter the page may take as send.
    expect(classify({ tool: 'browser_type', args: { target: 'e10', text: 'a\nb', slowly: true }, target: el('textbox Notes') }).class).toBe(UNCLEAR);
    expect(classify({ tool: 'browser_type', args: { target: 'e8', text: 'a\nb' }, target: name }).class).toBe(FREE);
  });

  it('has a row for every tool it offers: none of them falls to the default but the drag', () => {
    const sample: Record<string, Record<string, unknown>> = { browser_click: { target: 'e4' }, browser_press_key: { key: 'Tab' }, browser_handle_dialog: { accept: false } };
    for (const tool of EXPOSED_TOOLS) {
      const c = classify({ tool: tool.name, args: sample[tool.name] ?? {}, target: el('link Next'), focus: focused('body') });
      if (tool.name === 'browser_drag') expect(c.class).toBe(UNCLEAR);
      else expect(c.class, tool.name).toBe(FREE);
    }
  });

  it('describes the step by role and name, with the action and never a value the agent typed', () => {
    const c = classify({ tool: 'browser_type', args: { target: 'e8', text: 'my-secret-password', submit: true }, target: el('textbox Name') });
    expect(c.words).toEqual({ action: 'type', role: 'textbox', name: 'Name', submit: true });
    expect(JSON.stringify(c)).not.toContain('my-secret-password');
    expect(classify({ tool: 'browser_click', args: { target: 'e22' }, target: el('button Delete') }).words).toEqual({ action: 'click', role: 'button', name: 'Delete', word: 'delete' });
    expect(classify({ tool: 'browser_press_key', args: { key: 'Enter' }, focus: focused('name') }).words).toMatchObject({ action: 'press', key: 'Enter', role: 'textbox', name: 'Name', submit: true });
  });
});

describe('the words of the list', () => {
  const held = ['Send', 'send message', 'Sending...', 'Save changes', 'Save & close', 'Submit', 'Delete account', 'Remove item', 'Publish', 'Post', 'Pay now', 'Buy', 'Place order', 'Confirm', 'Transfer funds', 'Approve', 'Share', 'Sign document', 'Apply', 'Unsubscribe', 'Check out', 'Checkout', 'Cancel subscription',
    'Enviar', 'Enviar mensagem', 'Salvar', 'Salve', 'Excluir', 'Excluir conta', 'Apagar', 'Remover', 'Publicar', 'Postar', 'Pagar', 'Pague agora', 'Comprar', 'Confirmar', 'Transferir', 'Aprovar', 'Compartilhar', 'Assinar', 'Aplicar', 'Finalizar compra', 'Cancelar assinatura', 'EXCLUIR', 'enviár'];
  const free = ['Next', 'Back', 'Cancel', 'Close', 'Details', 'Open', 'Search', 'Sign in', 'Sign in with email', 'Log in', 'Login', 'Entrar', 'Acessar', 'Voltar', 'Cancelar', 'Fechar', 'Pesquisar', 'Go', 'OK', 'Menu', 'Sender', 'Sentinel', 'Postal code', 'Payment', ''];

  it.each(held)('holds a control named %j', (name) => {
    expect(irreversibleName(name), name).not.toBeNull();
  });
  it.each(free)('lets a control named %j go', (name) => {
    expect(irreversibleName(name), name).toBeNull();
  });
  it('is made of lowercase words without accents, once each', () => {
    for (const w of IRREVERSIBLE_WORDS) expect(w).toMatch(/^[a-z]+$/);
  });
  it('names the word it found', () => {
    expect(irreversibleName('Please DELETE this')).toBe('delete');
    expect(irreversibleName('Check out now')).toBe('check out');
  });
});

describe('keys', () => {
  it('keeps for the step log only a named key that types nothing, or a chord of Control, Meta or Alt', () => {
    for (const [key, kept] of [['Enter', 'Enter'], ['Tab', 'Tab'], ['Escape', 'Escape'], ['ArrowLeft', 'ArrowLeft'], ['Control+S', 'Control+S'], ['Meta+Enter', 'Meta+Enter'], ['F5', 'F5'], ['Shift+Tab', 'Shift+Tab'], ['Control+Shift+Z', 'Control+Shift+Z']] as const) expect(stepKey(key), key).toBe(kept);
    for (const key of ['a', 'A', 'Shift+A', '7', '$', '+', ' ', 'Space', 'hunter2', 'Banana', 'Control+Banana', 'Alt+Foo+Bar']) expect(stepKey(key), key).toBeNull();
  });
  it('splits a chord into its modifiers and its key', () => {
    expect(parseKey('Control+Shift+Z')).toEqual({ mods: new Set(['control', 'shift']), key: 'z' });
    expect(parseKey('+')).toEqual({ mods: new Set(), key: '+' });
    expect(parseKey('Control++')).toEqual({ mods: new Set(['control']), key: '+' });
  });
  it('reads the line breaks, the lone space and NumpadEnter as the keys Playwright takes them for, and does not trim', () => {
    expect(parseKey('\n').key).toBe('enter');
    expect(parseKey('\r').key).toBe('enter');
    expect(parseKey('Shift+\n')).toEqual({ mods: new Set(['shift']), key: 'enter' });
    expect(parseKey('NumpadEnter').key).toBe('enter');
    expect(parseKey(' ').key).toBe('space');
    expect(parseKey('Enter ').key).toBe('enter ');
    expect(stepKey('\n')).toBe('Enter');
    expect(stepKey('Control+ ')).toBe('Control+Space');
  });
  it('reads the page for the same keys the classifier takes for Enter and Space', () => {
    for (const key of ['\n', '\r', 'Shift+\n', ' ', 'Shift+ ', 'NumpadEnter']) expect(needsTarget('browser_press_key', { key }), JSON.stringify(key)).toBe('focus');
    for (const key of ['Return', 'Spacebar', '\t', '\u00a0', 'Enter ']) expect(needsTarget('browser_press_key', { key }), JSON.stringify(key)).toBeNull();
  });
  it('reads the page for a click, an Enter or a Space, and not for the rest', () => {
    expect(needsTarget('browser_click', { target: 'e1' })).toBe('target');
    expect(needsTarget('browser_press_key', { key: 'Enter' })).toBe('focus');
    expect(needsTarget('browser_press_key', { key: 'Space' })).toBe('focus');
    expect(needsTarget('browser_press_key', { key: 'Control+S' })).toBeNull();
    expect(needsTarget('browser_press_key', { key: 'Tab' })).toBeNull();
    for (const key of ['a', 'Shift+A', '7', '#', 'KeyE', 'Digit3']) expect(needsTarget('browser_press_key', { key }), key).toBe('focus');
    expect(needsTarget('browser_press_key', { key: 'Control+a' })).toBeNull();
    expect(needsTarget('browser_type', { target: 'e1', text: 'a\nb', slowly: true })).toBe('target');
    expect(needsTarget('browser_type', { target: 'e1', text: 'ab' })).toBeNull();
    expect(needsTarget('browser_navigate', { url: 'https://example.com/' })).toBeNull();
  });
});

describe('reading the page through the server', () => {
  /** A server that answers from the recording: the snapshot, and the question about a ref or about the focus. */
  function recordedClient(over: { snapshot?: string; fail?: 'snapshot' | 'evaluate' | 'throw' } = {}): ProbeClient & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async callTool(name, args) {
        calls.push(name === 'browser_evaluate' ? `evaluate ${String(args.target ?? 'focus')}` : name);
        if (over.fail === 'throw') throw new Error('the server is gone');
        if (name === 'browser_snapshot') return over.fail === 'snapshot' ? { content: [{ type: 'text', text: '### Error\nno page' }], isError: true } : { content: [{ type: 'text', text: over.snapshot ?? formSnapshot }] };
        if (over.fail === 'evaluate') return { content: [{ type: 'text', text: '### Error\nTypeError' }], isError: true };
        if (args.function === PROBE_FOCUS_FN) return { content: [{ type: 'text', text: recorded.focused.name.probe }] };
        const raw = Object.entries(recorded.probes).find(([k]) => k.startsWith(`${String(args.target)} `))?.[1];
        return { content: [{ type: 'text', text: raw ?? '### Error\nnot found' }], isError: raw ? undefined : true };
      },
    };
  }

  it('takes its own snapshot, then asks about the ref, and tells a ref the page no longer has', async () => {
    const client = recordedClient();
    const page = (await readPage(client)) as PageRead;
    expect(page.url).toBe('https://example.com/');
    const t = await readTarget(client, page, 'e15');
    expect(t).toMatchObject({ ref: 'e15', role: 'button', name: 'Send', probe: { submit: true } });
    expect(await readTarget(client, page, 'e404')).toBe('stale');
    expect(client.calls).toEqual(['browser_snapshot', 'evaluate e15']);
  });

  it('asks about the focused element, and still has what the snapshot knows when the question fails', async () => {
    const page = (await readPage(recordedClient())) as PageRead;
    expect(await readFocus(recordedClient(), page)).toMatchObject({ ref: 'e1', role: 'generic', probe: { tag: 'input' } });
    const failing = await readFocus(recordedClient({ fail: 'evaluate' }), page);
    expect(failing).toMatchObject({ ref: 'e1', probe: null });
    expect(classify({ tool: 'browser_press_key', args: { key: 'Enter' }, focus: failing }).class).toBe(UNCLEAR);
  });

  it('gives null for a page it cannot read, and does not throw', async () => {
    expect(await readPage(recordedClient({ fail: 'snapshot' }))).toBeNull();
    expect(await readPage(recordedClient({ fail: 'throw' }))).toBeNull();
    expect(await readPage(recordedClient({ snapshot: '### Page\n- Page URL: https://example.com/\n' }))).toBeNull();
    const page = (await readPage(recordedClient())) as PageRead;
    expect(await readTarget(recordedClient({ fail: 'throw' }), page, 'e15')).toMatchObject({ probe: null });
  });
});
