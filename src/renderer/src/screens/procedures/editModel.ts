import { LIMITS, type ProcedureKind, type ProcedureRecord } from '../../../../shared/procedures';

// What the editor holds while the person types, and what it sends: the text fields of a record as the form has them (a step is two boxes, the pitfalls and the waits one
// line each) and back. Pure, so the shape that travels to the app is tested without a form.

export interface StepDraft {
  text: string;
  run: string;
  /** The agent reworded this step of the app's recording; the person's edit leaves the mark as it was. */
  edited: boolean;
}

export interface EditDraft {
  kind: ProcedureKind;
  key: string;
  title: string;
  steps: StepDraft[];
  /** One per line. */
  pitfalls: string;
  /** One per line. */
  waits: string;
}

export const toDraft = (r: ProcedureRecord): EditDraft => ({
  kind: r.kind,
  key: r.key,
  title: r.title,
  steps: r.steps.map((s) => ({ text: s.text, run: s.run ?? '', edited: s.edited === true })),
  pitfalls: r.pitfalls.join('\n'),
  waits: r.waits.join('\n'),
});

const lines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** The content the app's validator takes. A step with an empty command has none; an empty line is not a pitfall. Nothing is cut: the app refuses what is over a limit. */
export function toInput(d: EditDraft): Record<string, unknown> {
  return {
    kind: d.kind,
    key: d.key,
    title: d.title,
    steps: d.steps.map((s) => ({ text: s.text, ...(s.run.trim() ? { run: s.run } : {}), ...(s.edited ? { edited: true } : {}) })),
    pitfalls: lines(d.pitfalls),
    waits: lines(d.waits),
  };
}

export const sameDraft = (a: EditDraft, b: EditDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

export const addStep = (steps: readonly StepDraft[]): StepDraft[] => (steps.length >= LIMITS.steps ? [...steps] : [...steps, { text: '', run: '', edited: false }]);
export const removeStep = (steps: readonly StepDraft[], i: number): StepDraft[] => steps.filter((_, at) => at !== i);

/** Moves a step one place up (-1) or down (1); at an end it stays. */
export function moveStep(steps: readonly StepDraft[], i: number, by: -1 | 1): StepDraft[] {
  const to = i + by;
  if (to < 0 || to >= steps.length) return [...steps];
  const next = [...steps];
  [next[i], next[to]] = [next[to], next[i]];
  return next;
}

export type FieldRef = { key: string; n?: number };

/** A path the validator names (`steps[2].text`, `pitfalls[0]`, `title`) as a catalog key of the field and, for a list, its number from 1. */
export function fieldRef(field: string): FieldRef {
  const step = /^steps\[(\d+)\]\.(text|run)$/.exec(field);
  if (step) return { key: step[2] === 'text' ? 'ui.procedures.field.stepText' : 'ui.procedures.field.stepRun', n: Number(step[1]) + 1 };
  const one = /^steps\[(\d+)\]/.exec(field);
  if (one) return { key: 'ui.procedures.field.step', n: Number(one[1]) + 1 };
  const item = /^(pitfalls|waits)\[(\d+)\]$/.exec(field);
  if (item) return { key: item[1] === 'pitfalls' ? 'ui.procedures.field.pitfall' : 'ui.procedures.field.wait', n: Number(item[2]) + 1 };
  const plain: Record<string, string> = { kind: 'ui.procedures.field.kind', key: 'ui.procedures.field.key', title: 'ui.procedures.field.title', steps: 'ui.procedures.field.steps', pitfalls: 'ui.procedures.field.pitfalls', waits: 'ui.procedures.field.waits', record: 'ui.procedures.field.record' };
  return { key: plain[field] ?? 'ui.procedures.field.record' };
}

/** The catalog key of what a refusal says to fix, by its code; the app's English sentence is the fallback for a code this version does not know. */
export const REFUSAL_KEY: Record<string, string> = {
  type: 'ui.procedures.refusal.type',
  empty: 'ui.procedures.refusal.empty',
  'too-long': 'ui.procedures.refusal.tooLong',
  'too-many': 'ui.procedures.refusal.tooMany',
  control: 'ui.procedures.refusal.control',
  charset: 'ui.procedures.refusal.charset',
  'unknown-field': 'ui.procedures.refusal.unknownField',
  'key-form': 'ui.procedures.refusal.keyForm',
  'key-repo': 'ui.procedures.refusal.keyRepo',
  'key-stage': 'ui.procedures.refusal.keyStage',
  email: 'ui.procedures.refusal.email',
  home: 'ui.procedures.refusal.home',
  credential: 'ui.procedures.refusal.credential',
  'url-query': 'ui.procedures.refusal.urlQuery',
  digits: 'ui.procedures.refusal.digits',
  token: 'ui.procedures.refusal.token',
  quote: 'ui.procedures.refusal.quote',
  size: 'ui.procedures.refusal.size',
};

/** Why a write that was not a validator refusal did not happen. */
export const ERROR_KEY: Record<string, string> = {
  revision: 'ui.procedures.error.revision',
  'not-found': 'ui.procedures.error.gone',
  deleted: 'ui.procedures.error.gone',
  newer: 'ui.procedures.error.newer',
  duplicate: 'ui.procedures.error.duplicate',
  'cap-key': 'ui.procedures.error.cap',
  'cap-workspace': 'ui.procedures.error.cap',
  io: 'ui.procedures.error.io',
  'no-previous': 'ui.procedures.error.noPrevious',
};
