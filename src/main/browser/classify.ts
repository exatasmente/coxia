import type { HoldWhy, StepClass, StepWords } from '../../shared/browser';
import type { Probe, TargetInfo } from './probe';

export type { HoldWhy, StepClass, StepWords };

// Which steps of the app's browser the app holds for the person. Pure: the tool, what the agent asked, and what the app read of the page itself (`probe.ts`), never what the
// agent said about the element. The word list is in code and is not configurable; it is a heuristic over names and forms, and the docs say so: a control named "Go" that deletes
// is not caught, and neither is a word in a language the list lacks. What the app cannot read is held too (fail closed), and the person may answer "yes for the rest of this
// screen on this site" to those, never to a step this module calls irreversible.

export interface Classification {
  class: StepClass;
  why?: HoldWhy;
  words: StepWords;
}

export interface ClassifyInput {
  tool: string;
  /** The arguments the agent sent, already checked against the schema (`checkArguments`). */
  args: Record<string, unknown>;
  /** The element `target` names, as the app read it. null: it could not be read. */
  target?: TargetInfo | null;
  /** The element that has the focus, for a key press. */
  focus?: TargetInfo | null;
}

// ---- the words ---------------------------------------------------------------------------------------------------------------------------

// Forms of the verbs the spec lists (send, save, submit, delete, remove, publish, post, pay, buy, order, confirm, transfer, approve, share, sign, apply, unsubscribe), in English and
// Brazilian Portuguese, with the other words a checkout or a mailbox uses for the same act. The names are compared without accents and without case, one word at a time.
const EN = [
  'send sends sending',
  'save saves saving',
  'submit submits submitting',
  'delete deletes deleting',
  'remove removes removing',
  'erase erases erasing',
  'publish publishes publishing',
  'post posts posting',
  'pay pays paying',
  'buy buys buying',
  'purchase purchases purchasing',
  'order orders ordering',
  'checkout',
  'confirm confirms confirming',
  'transfer transfers transferring',
  'approve approves approving',
  'share shares sharing',
  'sign signs signing',
  'apply applies applying',
  'subscribe subscribes subscribing',
  'unsubscribe unsubscribes unsubscribing',
  'finalize finalizes finalizing',
];
const PT = [
  'enviar envie envia enviando',
  'salvar salve salva salvando',
  'submeter submeta submetendo',
  'excluir exclua exclui excluindo',
  'apagar apague apaga apagando',
  'remover remova remove removendo',
  'publicar publique publica publicando',
  'postar poste postando',
  'pagar pague paga pagando',
  'comprar compre compra comprando',
  'pedir peca pedido',
  'confirmar confirme confirma confirmando',
  'transferir transfira transfere transferindo',
  'aprovar aprove aprova aprovando',
  'compartilhar compartilhe compartilha compartilhando',
  'assinar assine assina assinando',
  'aplicar aplique aplica aplicando',
  'inscrever inscreva',
  'descadastrar descadastre',
  'finalizar finalize finaliza finalizando',
];
/** The words of the list, by the form they are written in. */
export const IRREVERSIBLE_WORDS: ReadonlySet<string> = new Set([...EN, ...PT].flatMap((line) => line.split(' ')));

// Two words together that name an act the single words do not: cancelling what was paid for.
const PHRASES: readonly (readonly string[])[] = [
  ['check', 'out'],
  ['cancel', 'subscription'],
  ['cancel', 'order'],
  ['cancelar', 'assinatura'],
  ['cancelar', 'pedido'],
  ['place', 'order'],
];

// Written the way people write them: "sign in" and "log in" are how a person gets into a site, not an irreversible act, whatever the word "sign" does elsewhere.
const FREE_PAIRS: readonly (readonly string[])[] = [['sign', 'in'], ['log', 'in'], ['sign', 'on']];
const FREE_WORDS = new Set(['signin', 'login', 'logon']);

const tokens = (text: string): string[] => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The word of the list a name carries, or null. Pure over text, so the table test pins the list. */
export function irreversibleName(text: string): string | null {
  const all = tokens(text).filter((t) => !FREE_WORDS.has(t));
  // A pair that is free goes out of the reckoning whole.
  const words: string[] = [];
  for (let i = 0; i < all.length; i++) {
    if (FREE_PAIRS.some(([a, b]) => all[i] === a && all[i + 1] === b)) {
      i++;
      continue;
    }
    words.push(all[i]);
  }
  for (let i = 0; i < words.length; i++) {
    if (PHRASES.some((p) => p.every((w, k) => words[i + k] === w))) return `${words[i]} ${words[i + 1]}`;
    if (IRREVERSIBLE_WORDS.has(words[i])) return words[i];
  }
  return null;
}

// ---- keys --------------------------------------------------------------------------------------------------------------------------------

const MODIFIERS = new Set(['control', 'meta', 'controlormeta', 'alt', 'shift']);
const NAMED_KEYS = new Set([
  'backspace', 'tab', 'enter', 'numpadenter', 'escape', 'delete', 'insert', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown', 'space', 'capslock', 'contextmenu',
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
  ...MODIFIERS,
]);
// The keys that are shortcuts of the page, not letters: nothing here sends anything by itself.
const FREE_CHORD_KEYS = new Set(['a', 'c', 'v', 'x', 'z', 'y', 'f']);

export interface ParsedKey {
  mods: Set<string>;
  /** The key, lowercase. */
  key: string;
}

// Playwright takes a line break (`\n`, `\r`) as Enter and a lone space as Space, so the text is read as it was sent: trimming it would turn them into a free character.
const KEY_ALIASES: Readonly<Record<string, string>> = { '\n': 'enter', '\r': 'enter', ' ': 'space', numpadenter: 'enter' };

/** `Control+Shift+Z` as its modifiers and its key. The aliases of Enter and Space are the key they stand for. */
export function parseKey(raw: string): ParsedKey {
  if (raw === '+') return { mods: new Set(), key: '+' };
  const parts = raw.split('+');
  const last = (parts.pop() ?? '').toLowerCase();
  const key = last === '' ? '+' : (KEY_ALIASES[last] ?? last);
  return { mods: new Set(parts.filter(Boolean).map((p) => p.toLowerCase())), key };
}

// A single character that is whitespace or a control one is a key nobody can name: it fails closed instead of passing as a letter.
const isKnownKey = (key: string): boolean => (key.length === 1 && !/[\s\p{C}\p{Z}]/u.test(key)) || NAMED_KEYS.has(key) || /^(key[a-z]|digit\d|numpad\d)$/.test(key);

/**
 * The key of a press as the step log keeps it: a named key that types nothing (Enter, Tab, Escape, arrows...), or a chord with a Control, Meta or Alt (a shortcut, never
 * text). A letter, a digit or a symbol, alone or with Shift, is typed text and is not kept. null: nothing to keep.
 */
export function stepKey(raw: string): string | null {
  const { mods, key } = parseKey(raw);
  if (![...mods].every((m) => MODIFIERS.has(m))) return null;
  const shortcut = [...mods].some((m) => m === 'control' || m === 'meta' || m === 'controlormeta' || m === 'alt');
  const named = NAMED_KEYS.has(key) && !MODIFIERS.has(key) && key !== 'space';
  if (!named && !(shortcut && isKnownKey(key))) return null;
  // Written the way the agent wrote it, cut to what a key name is; a line break stands for Enter and a space for Space.
  return raw.replace(/(^|\+)[\r\n]$/, '$1Enter').replace(/(^|\+) $/, '$1Space').slice(0, 40);
}

// ---- the target --------------------------------------------------------------------------------------------------------------------------

// Roles whose click only focuses, toggles or chooses: the name of the element is a label, not an act.
const PLAIN_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'checkbox', 'radio', 'switch', 'slider', 'tab', 'tabpanel', 'option', 'listbox', 'heading', 'paragraph', 'text', 'img', 'progressbar', 'scrollbar', 'separator']);
const TEXT_INPUTS = new Set(['', 'text', 'search', 'email', 'password', 'tel', 'url', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
const BUTTON_INPUTS = new Set(['submit', 'image', 'button', 'reset']);
const OPAQUE_TAGS = new Set(['canvas', 'iframe', 'object', 'embed']);
// A container's text is every word of its children: only the short text of a small element names it.
const TEXT_NAME_MAX = 80;

const clip = (s: string, max = 80): string => (s.length > max ? s.slice(0, max) : s);

/** Every name the element has: the snapshot's, then the page's (aria-label, a short text, a button's own label, title, alt). */
function namesOf(t: TargetInfo): string[] {
  const p = t.probe;
  const texts = p ? p.texts.filter((x, i) => (i === 1 ? x.length <= TEXT_NAME_MAX : true)) : [];
  return [t.name, ...texts].filter((s) => s.length > 0);
}

const wordsFor = (action: StepWords['action'], t?: TargetInfo | null, extra: Partial<StepWords> = {}): StepWords => ({
  action,
  ...(t?.role ? { role: t.role } : {}),
  ...(t && namesOf(t)[0] ? { name: clip(namesOf(t)[0]) } : {}),
  ...extra,
});

const free = (words: StepWords): Classification => ({ class: 'free', words });
const held = (why: HoldWhy, words: StepWords): Classification => ({ class: 'irreversible', why, words });
const unclassified = (words: StepWords): Classification => ({ class: 'unclassified', why: 'unclassified', words });

/** Whether activating the element is an act named by what it is called: the word, or null. */
function activationName(t: TargetInfo): string | null {
  for (const n of namesOf(t)) {
    const w = irreversibleName(n);
    if (w) return w;
  }
  return null;
}

function unreadable(t: TargetInfo | null | undefined): t is null | undefined | (TargetInfo & { probe: null }) {
  return !t || !t.probe;
}

/** A click, or the activation of a focused control by Enter or Space. */
function activate(action: StepWords['action'], t: TargetInfo | null | undefined, key?: string): Classification {
  const base: Partial<StepWords> = key ? { key } : {};
  if (unreadable(t)) return unclassified(wordsFor(action, t, base));
  const p = t.probe as Probe;
  // What cannot be read: a frame of another site, a canvas, an embedded page.
  if (p.frame === 'other' || OPAQUE_TAGS.has(p.tag)) return unclassified(wordsFor(action, t, base));
  if (p.submit) return held('submit', wordsFor(action, t, { ...base, submit: true }));
  const word = PLAIN_ROLES.has(t.role) ? null : activationName(t);
  if (word) return held('name', wordsFor(action, t, { ...base, word }));
  // A control with no name at all, of a kind that acts: the app cannot say what it does.
  if (!PLAIN_ROLES.has(t.role) && namesOf(t).length === 0) return unclassified(wordsFor(action, t, base));
  return free(wordsFor(action, t, base));
}

/** Enter (or Space) pressed while an element has the focus. */
function activateByKey(key: string | undefined, space: boolean, focus: TargetInfo | null | undefined): Classification {
  const words = (extra: Partial<StepWords> = {}): StepWords => wordsFor('press', focus, { ...(key ? { key } : {}), ...extra });
  if (unreadable(focus)) return unclassified(words());
  const p = focus.probe as Probe;
  if (p.frame === 'other' || OPAQUE_TAGS.has(p.tag)) return unclassified(words());
  if (p.editable) return space ? free(words()) : unclassified(words());
  // Chat and comment boxes send on Enter: what a textarea does with it is the page's script, which the app cannot read. A new line there is still free for Space.
  if (p.tag === 'textarea') return space ? free(words()) : unclassified(words());
  if (p.tag === 'select' || p.tag === 'body' || p.tag === 'html' || p.tag === '') return free(words());
  if (p.tag === 'input' && !BUTTON_INPUTS.has(p.type)) {
    // Space types a space or toggles; Enter in a field is the form's implicit submission, and with no form the page's script decides.
    if (space) return free(words());
    if (p.form) return held('submit', words({ submit: true }));
    return TEXT_INPUTS.has(p.type) ? unclassified(words()) : free(words());
  }
  if (p.tag === 'input' || p.tag === 'button' || p.tag === 'a' || ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem'].includes(focus.role)) {
    if (p.tag === 'a' && space) return free(words());
    return activate('press', focus, key);
  }
  return free(words());
}

/** Whether a key types a character (a letter, a digit, a symbol), by its name once the aliases are read. */
const isPrintable = (key: string): boolean => (key.length === 1 && isKnownKey(key)) || /^(key[a-z]|digit\d)$/.test(key);

/** Whether the element takes typed characters: a field, a text area, an editable region. */
function takesText(p: Probe): boolean {
  return p.editable || p.tag === 'textarea' || (p.tag === 'input' && TEXT_INPUTS.has(p.type));
}

/** A printable key pressed with the focus where it is: typed text in a field, but a single-key shortcut (delete, archive, send) of the page anywhere else. */
function typedKey(words: StepWords, focus: TargetInfo | null | undefined): Classification {
  const on = wordsFor('press', focus, words.key ? { key: words.key } : {});
  if (unreadable(focus)) return unclassified(on);
  const p = focus.probe as Probe;
  if (p.frame === 'other' || OPAQUE_TAGS.has(p.tag)) return unclassified(on);
  return takesText(p) ? free(on) : unclassified(on);
}

function pressKey(raw: string, focus: TargetInfo | null | undefined): Classification {
  const { mods, key } = parseKey(raw);
  const shown = stepKey(raw) ?? undefined;
  const words: StepWords = { action: 'press', ...(shown ? { key: shown } : {}) };
  if (!isKnownKey(key) || ![...mods].every((m) => MODIFIERS.has(m))) return unclassified(words);
  const shortcutMods = [...mods].filter((m) => m !== 'shift');
  if (shortcutMods.length) {
    // Control or Meta with S or Enter saves or sends; with the editing keys it only edits; anything else with a modifier is a shortcut the app has no row for.
    if (shortcutMods.every((m) => m === 'control' || m === 'meta' || m === 'controlormeta')) {
      if (key === 's' || key === 'enter') return held('shortcut', words);
      if (FREE_CHORD_KEYS.has(key)) return free(words);
    }
    return unclassified(words);
  }
  if (key === 'enter') return activateByKey(shown, false, focus);
  if (key === 'space') return activateByKey(undefined, true, focus);
  if (isPrintable(key)) return typedKey(words, focus);
  return free(words);
}

/** Types in a text that holds a line break when it is typed key by key: the break is an Enter. */
const typesEnter = (text: unknown): boolean => typeof text === 'string' && /[\r\n]/.test(text);

/** Classifies one call of the app's browser. Total: a tool or an argument without a row is `unclassified`, never free. */
export function classify(i: ClassifyInput): Classification {
  const a = i.args;
  switch (i.tool) {
    case 'browser_navigate':
      return free({ action: 'navigate' });
    case 'browser_navigate_back':
      return free({ action: 'navigate' });
    case 'browser_snapshot':
    case 'browser_find':
    case 'browser_take_screenshot':
      return free({ action: 'read' });
    case 'browser_wait_for':
      return free({ action: 'wait' });
    case 'browser_tabs':
      return free({ action: 'tabs' });
    case 'browser_hover':
      return free(wordsFor('hover', i.target));
    case 'browser_select_option':
      return free(wordsFor('select', i.target));
    case 'browser_fill_form':
      return free({ action: 'fill' });
    case 'browser_type': {
      if (a.submit === true) return held('submit', wordsFor('type', i.target, { submit: true }));
      // Typed key by key, a line break presses Enter in the field.
      if (a.slowly === true && typesEnter(a.text)) return activateByKey('Enter', false, i.target);
      return free(wordsFor('type', i.target));
    }
    case 'browser_press_key':
      return typeof a.key === 'string' ? pressKey(a.key, i.focus) : unclassified({ action: 'press' });
    case 'browser_click':
      return activate('click', i.target);
    case 'browser_drag':
      // Where a drop lands, and what it does there, is not in the snapshot.
      return unclassified({ action: 'drag' });
    case 'browser_handle_dialog':
      return a.accept === true ? held('dialog', { action: 'dialog' }) : free({ action: 'dialog' });
    default:
      return unclassified({ action: 'other' });
  }
}

/** Which call needs the page read before it is classified: the element a click acts on, and the one a key press lands on. */
export function needsTarget(tool: string, args: Record<string, unknown>): 'target' | 'focus' | null {
  if (tool === 'browser_click') return 'target';
  if (tool === 'browser_press_key') {
    if (typeof args.key !== 'string') return null;
    const { mods, key } = parseKey(args.key);
    const shortcut = [...mods].some((m) => m !== 'shift');
    return !shortcut && (key === 'enter' || key === 'space' || isPrintable(key)) ? 'focus' : null;
  }
  if (tool === 'browser_type' && args.slowly === true && typesEnter(args.text)) return 'target';
  return null;
}
