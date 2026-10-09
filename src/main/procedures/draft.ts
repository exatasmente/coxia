// i18n-lint: allow-file what the app drafts for a model to read and keep: English by design, like the tool texts of the engines
import type { StepEntry } from '../../shared/browser';
import { LIMITS, type ProcedureStep } from '../../shared/procedures';

// The app's draft of a `gui` procedure (#179, spec rules 29 to 33): built from the log of the steps the app's browser took, and from nothing the model said about a page. Pure: it
// reads `StepEntry` values only, and a test feeds it entries with extra fields to show none of them is copied. A step is worded from the tool, the control's role and visible
// label as the page gave them, and the page as a path; a typed value is never in the log and is `<value>` here; a hand-off is one step with no content.

/** The most characters of a control's label in a step: what the validator allows in a quotation of a `gui` step. */
export const LABEL_MAX = LIMITS.quote;
const PAGE_PATH_MAX = 80;
const PITFALLS_MAX = LIMITS.pitfalls;
const WAITS_MAX = LIMITS.waits;

export interface DraftStep {
  /** 1-based, in the order of the draft. A save names the steps it keeps by this number. */
  n: number;
  text: string;
}

export interface DraftBody {
  steps: DraftStep[];
  /** Actions that did not work, worded by the app: candidates the agent may turn into a lesson or drop. */
  pitfalls: string[];
  /** The words of the steps that did not work, as the draft would have worded them had they worked: what a step of a procedure the agent followed is matched against. */
  failed: string[];
  /** Real figures: how long the app waited, rounded up. */
  waits: string[];
  /** The person used the screen: one of the steps is the hand-off. */
  handoff: boolean;
}

type Kind = 'navigate' | 'back' | 'click' | 'type' | 'press' | 'fill' | 'select' | 'hover' | 'drag' | 'wait' | 'tabs' | 'dialog' | 'handoff';

const KIND: Record<string, Kind> = {
  browser_navigate: 'navigate',
  browser_navigate_back: 'back',
  browser_click: 'click',
  browser_type: 'type',
  browser_press_key: 'press',
  browser_fill_form: 'fill',
  browser_select_option: 'select',
  browser_hover: 'hover',
  browser_drag: 'drag',
  browser_wait_for: 'wait',
  browser_tabs: 'tabs',
  browser_handle_dialog: 'dialog',
  screen_handoff: 'handoff',
};

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const QUOTE_MARKS = /["\u201c\u201d\u00ab\u00bb\u2018\u2019`]/g;

/** A control's label as a step may quote it: one line, no quotation mark inside (it would pair with the one around it), cut to what the validator allows. */
function labelOf(text: string): string {
  const flat = text.replace(CONTROL, ' ').replace(QUOTE_MARKS, '').replace(/(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu, '').replace(/\s+/g, ' ').trim();
  return flat.length > LABEL_MAX ? flat.slice(0, LABEL_MAX).trim() : flat;
}

const roleOf = (role: string | undefined): string => (role ?? '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);

/** The control as the step names it: its role and visible label when the log has them. */
function control(e: StepEntry, fallback: string): string {
  const role = roleOf(e.role);
  const label = e.name ? labelOf(e.name) : '';
  if (role && label) return `${role} "${label}"`;
  if (label) return `control "${label}"`;
  return role || fallback;
}

/** A path with the segments that name one thing (a number, a long mixed token) turned into `:id`, so the step never carries an id and never trips its own secret check. */
export function pathTemplate(path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) || (/\d/.test(seg) && seg.length >= 4) || (seg.length >= 12 && /\d/.test(seg)) ? ':id' : seg));
  const joined = parts.length ? `/${parts.join('/')}` : '';
  return joined.length > PAGE_PATH_MAX ? `${joined.slice(0, PAGE_PATH_MAX)}` : joined;
}

const where = (e: StepEntry): string => {
  const path = pathTemplate(e.path);
  if (e.site && path) return `${path} on ${e.site}`;
  return e.site || path;
};
const onPage = (e: StepEntry): string => (where(e) ? ` (page ${where(e)})` : '');

function textOf(e: StepEntry, kind: Kind): string {
  switch (kind) {
    case 'navigate':
      return `Open ${where(e) || 'the address'}`;
    case 'back':
      return 'Go back to the previous page';
    case 'click':
      return `Click the ${control(e, 'control')}${onPage(e)}`;
    case 'type':
      return `Type <value> into a field${onPage(e)}`;
    case 'press':
      return e.key ? `Press ${labelOf(e.key)}${e.name ? ` on the ${control(e, 'control')}` : ''}${onPage(e)}` : `Type <value> with the keyboard${onPage(e)}`;
    case 'fill':
      return `Fill the form fields with <value>${onPage(e)}`;
    case 'select':
      return `Choose <value> in a list${onPage(e)}`;
    case 'hover':
      return `Hover over a control${onPage(e)}`;
    case 'drag':
      return `Drag a control onto another${onPage(e)}`;
    case 'wait':
      return `Wait for the page or an element${onPage(e)}`;
    case 'tabs':
      return e.site ? `Open ${where(e)} in a tab` : 'Use the browser tabs';
    case 'dialog':
      return `Answer the dialog${onPage(e)}`;
    case 'handoff':
      return 'The person completes a login or a confidential input here';
  }
}

const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max).trim() : text);

/** What a step that did not work becomes: a candidate for the pitfalls, in the app's words. */
function failureOf(e: StepEntry, kind: Kind, text: string): string {
  if (kind === 'handoff') return 'A request to hand the screen to the person was not completed';
  if (e.outcome === 'declined') return `The person declined: ${text}`;
  if (e.outcome === 'not-run') return kind === 'navigate' || kind === 'tabs' ? `Refused (the site is not on the host list, or the address is not valid): ${text}` : `Could not be done (the element was not on the page, or the call was refused): ${text}`;
  return `Did not work: ${text}`;
}

interface Pending {
  kind: Kind;
  text: string;
  ms: number;
  entry: StepEntry;
}

/** The draft of a call from the steps the app's browser took in it. */
export function buildDraft(entries: readonly StepEntry[]): DraftBody {
  const pitfalls: string[] = [];
  const failed: string[] = [];
  const kept: Pending[] = [];
  let handoff = false;

  for (const e of entries) {
    const kind = KIND[e.tool];
    // Reads (a snapshot, a find, a picture) change nothing, and a tool the table does not know is not something a procedure can say.
    if (!kind) continue;
    const text = textOf(e, kind);
    if (e.outcome !== 'ok') {
      const line = clip(failureOf(e, kind, text), LIMITS.pitfall);
      if (!pitfalls.includes(line)) pitfalls.push(line);
      if (!failed.includes(text)) failed.push(text);
      continue;
    }
    if (kind === 'handoff') handoff = true;
    // A step undone by the next one (a click or an address, then back) is a dead end: neither is kept.
    const top = kept[kept.length - 1];
    if (kind === 'back' && top && (top.kind === 'click' || top.kind === 'navigate')) {
      kept.pop();
      continue;
    }
    // Waits that follow one another are one wait; the same address opened twice running is one.
    if (kind === 'wait' && top?.kind === 'wait') {
      top.ms += e.ms;
      continue;
    }
    if (kind === 'navigate' && top?.kind === 'navigate' && top.text === text) continue;
    kept.push({ kind, text, ms: e.ms, entry: e });
  }

  const steps: DraftStep[] = [];
  const waits: string[] = [];
  for (const p of kept) {
    if (p.kind === 'wait') {
      const seconds = Math.max(1, Math.ceil(p.ms / 1000));
      const line = clip(`${where(p.entry) ? `On ${where(p.entry)}: w` : 'W'}ait about ${seconds} s for the page or an element`, LIMITS.wait);
      if (!waits.includes(line)) waits.push(line);
      steps.push({ n: steps.length + 1, text: clip(`Wait for the page or an element (about ${seconds} s)${onPage(p.entry)}`, LIMITS.stepText) });
      continue;
    }
    steps.push({ n: steps.length + 1, text: clip(p.text, LIMITS.stepText) });
  }
  return { steps, pitfalls: pitfalls.slice(0, PITFALLS_MAX), failed, waits: waits.slice(0, WAITS_MAX), handoff };
}

export interface DraftComparison {
  /** Steps of the draft that an existing step says word for word. */
  kept: number;
  /** Steps of the draft that stand where an existing step now reads differently. */
  changed: number;
  /** Steps of the draft with no existing step to stand for. */
  added: number;
  /** Existing steps nothing in the draft stands for. */
  gone: number;
}

const flat = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim();

/** The draft against the steps of the procedure the agent followed: the comparison the person and the agent read before a replacement. */
export function compareDraft(draft: readonly DraftStep[], existing: readonly ProcedureStep[]): DraftComparison {
  const old = existing.map((s) => flat(s.text));
  const left = [...old];
  let kept = 0;
  const unmatched: string[] = [];
  for (const s of draft) {
    const at = left.indexOf(flat(s.text));
    if (at >= 0) {
      left.splice(at, 1);
      kept++;
    } else unmatched.push(s.text);
  }
  const changed = Math.min(unmatched.length, left.length);
  return { kept, changed, added: unmatched.length - changed, gone: left.length - changed };
}

/** The numbers (1-based) of the steps of a procedure that a failed action of the draft says word for word: the app suggests reporting them as failing. */
export function failedStepsOf(failed: readonly string[], existing: readonly ProcedureStep[]): number[] {
  const words = new Set(failed.map(flat));
  return existing.flatMap((s, i) => (words.has(flat(s.text)) ? [i + 1] : []));
}
