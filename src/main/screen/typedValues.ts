import { secretForms } from '../maskExact';

// What the person types while they hold the agent's screen (#178), kept in memory only and never written: not to disk, a log, an audit entry or a thread line. Two parts.
// The collector rebuilds the text from the keys the viewer sent during one interval (the app has no other way to know it); the per-call `TypedValues` keeps what the
// intervals of one stage attempt or conversation answer collected and masks it out of the text the app hands the agent. The rebuilding can miss (a dead key, an autofill,
// a caret moved by the mouse, a code split over several boxes), and the mask is an exact match, so this is a best-effort layer and is described as one.

/** The most characters a segment keeps and the most segments the collector holds. */
export const SEGMENT_MAX = 512;
export const SEGMENTS_MAX = 64;

/** What a masked value shows as. */
export const TYPED_PLACEHOLDER = '[secret]';

// Keys that move the caret or leave the field: the text typed after them is not a continuation of the text before them.
const BREAKS = new Set(['Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Delete']);

export interface TypedCollector {
  /** Reads a batch of the viewer's events (anything: a shape that is not an event is ignored). Never throws. */
  feed(events: readonly unknown[]): void;
  /** The segments typed so far, the open one included, without empty ones or repeats, oldest first. */
  values(): string[];
  /** Forgets everything. */
  clear(): void;
}

export function createTypedCollector(): TypedCollector {
  let segments: string[] = [];
  let current: string[] = [];
  const held = { ctrl: false, alt: false, meta: false, altGraph: false };

  const endSegment = (): void => {
    if (current.length) segments.push(current.join(''));
    current = [];
    if (segments.length > SEGMENTS_MAX) segments = segments.slice(-SEGMENTS_MAX);
  };

  const modifier = (key: string, down: boolean): boolean => {
    switch (key) {
      case 'Control':
        held.ctrl = down;
        return true;
      case 'Alt':
        held.alt = down;
        return true;
      case 'Meta':
      case 'OS':
        held.meta = down;
        return true;
      case 'AltGraph':
        held.altGraph = down;
        return true;
      default:
        return false;
    }
  };

  return {
    feed(events) {
      for (const e of events) {
        try {
          if (!e || typeof e !== 'object') continue;
          const ev = e as { t?: unknown; key?: unknown; down?: unknown };
          if (ev.t === 'button') {
            // A click may have moved the caret to another field.
            if (ev.down === true) endSegment();
            continue;
          }
          if (ev.t !== 'key' || typeof ev.key !== 'string' || typeof ev.down !== 'boolean') continue;
          if (modifier(ev.key, ev.down)) continue;
          if (!ev.down) continue;
          if (ev.key === 'Backspace') {
            // Ctrl+Backspace takes a word the app cannot size: the segment ends there rather than keep what was deleted.
            if (held.ctrl || held.alt || held.meta) endSegment();
            else current.pop();
            continue;
          }
          if (BREAKS.has(ev.key)) {
            endSegment();
            continue;
          }
          const chars = [...ev.key];
          if (chars.length !== 1) continue;
          // A shortcut (Ctrl+A, Alt+F) is not text; AltGraph composes characters, so it is not a shortcut.
          if ((held.ctrl || held.alt || held.meta) && !held.altGraph) continue;
          if (current.length < SEGMENT_MAX) current.push(chars[0]);
        } catch {
          // A malformed event is not the person's to know.
        }
      }
    },
    values() {
      const open = current.join('');
      return [...new Set(open ? [...segments, open] : segments)];
    },
    clear() {
      segments = [];
      current = [];
      held.ctrl = held.alt = held.meta = held.altGraph = false;
    },
  };
}

/** A function that takes every form of the values out of a text, in one pass so the placeholder is never itself masked. */
export function exactMask(forms: readonly string[]): (text: string) => string {
  if (forms.length === 0) return (text) => text;
  // Longest first: a long form wins over its substrings.
  const sorted = [...forms].sort((a, b) => b.length - a.length);
  const re = new RegExp(sorted.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return (text) => text.replace(re, TYPED_PLACEHOLDER);
}

export interface TypedValues {
  /** Takes the values an interval collected. Marks the call as having had a hand-off, even when nothing usable was typed. */
  add(values: readonly string[]): void;
  /** The text with every form of every value taken out. */
  mask(text: string): string;
  /** Whether any form of any value is in the text. */
  hits(text: string): boolean;
  /** A hand-off interval was taken in this call; stays true after `clear`. */
  readonly had: boolean;
  /** Forgets the values (the forms too), keeps `had`. */
  clear(): void;
}

export function createTypedValues(): TypedValues {
  let forms: string[] = [];
  let masker = exactMask(forms);
  let had = false;
  return {
    add(values) {
      had = true;
      forms = [...new Set([...forms, ...values.flatMap((v) => secretForms(v))])];
      masker = exactMask(forms);
    },
    mask: (text) => masker(text),
    hits: (text) => forms.some((f) => text.includes(f)),
    get had() {
      return had;
    },
    clear() {
      forms = [];
      masker = exactMask(forms);
    },
  };
}
