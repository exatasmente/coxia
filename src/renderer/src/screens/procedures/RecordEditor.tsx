import { useState } from 'react';
import { LIMITS, PROCEDURE_KINDS, type ProcedureRecord } from '../../../../shared/procedures';
import type { ProcedureWrite } from '../../../../shared/proceduresView';
import { useT } from '../../i18n';
import { ERROR_KEY, REFUSAL_KEY, addStep, fieldRef, moveStep, removeStep, sameDraft, toDraft, toInput, type EditDraft } from './editModel';
import { KIND_LABEL } from './labels';

// The person's edit of a record. What is sent goes through the same checks as an agent's save: the app refuses, field by field, what it cannot keep, and this lists each
// refusal in words, naming the field and never echoing the value.

type Failure = Extract<ProcedureWrite, { ok: false }>;

/** What a write that did not happen says to fix: one line per field the validator named, or the single reason. */
export function Refusals({ failure }: { failure: Failure }) {
  const t = useT();
  if (failure.refusals?.length) {
    return (
      <div className="error" role="alert">
        <p>{t('ui.procedures.edit.notSaved')}</p>
        <ul className="pr-list">
          {failure.refusals.map((r, i) => {
            const f = fieldRef(r.field);
            const reason = REFUSAL_KEY[r.code];
            return <li key={i}>{t(f.key, { n: f.n ?? 0 })}: {reason ? t(reason) : r.text}</li>;
          })}
        </ul>
      </div>
    );
  }
  const key = ERROR_KEY[failure.code];
  return <div className="error" role="alert">{key ? t(key) : failure.text}</div>;
}

export function RecordEditor({ record, onSave, onCancel, onReload }: { record: ProcedureRecord; onSave: (input: unknown) => Promise<ProcedureWrite>; onCancel: () => void; onReload: () => void }) {
  const t = useT();
  const first = toDraft(record);
  const [draft, setDraft] = useState<EditDraft>(first);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const set = (patch: Partial<EditDraft>) => setDraft({ ...draft, ...patch });
  const setStep = (i: number, patch: Partial<EditDraft['steps'][number]>) => set({ steps: draft.steps.map((s, at) => (at === i ? { ...s, ...patch } : s)) });

  const save = async () => {
    setBusy(true);
    try {
      const done = await onSave(toInput(draft));
      if (!done.ok) setFailure(done);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pr-edit" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={t('ui.procedures.edit.title', { title: record.title })}>
      <p className="small muted">{t('ui.procedures.edit.lead')}</p>
      <p className="faint">{t('ui.procedures.edit.limits', { title: LIMITS.title, steps: LIMITS.steps, stepText: LIMITS.stepText, stepRun: LIMITS.stepRun, pitfalls: LIMITS.pitfalls, pitfall: LIMITS.pitfall, waits: LIMITS.waits, wait: LIMITS.wait })}</p>
      <div className="pr-edit-head">
        <label className="cy-field">
          <span className="small muted">{t('ui.procedures.field.kind')}</span>
          <select className="text-input" value={draft.kind} onChange={(e) => set({ kind: e.target.value as EditDraft['kind'] })}>
            {PROCEDURE_KINDS.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
          </select>
        </label>
        <label className="cy-field">
          <span className="small muted">{t('ui.procedures.field.key')}</span>
          <input className="text-input" value={draft.key} onChange={(e) => set({ key: e.target.value })} />
        </label>
      </div>
      <label className="cy-field">
        <span className="small muted">{t('ui.procedures.field.title')}</span>
        <input className="text-input" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <fieldset className="pr-steps-edit">
        <legend className="cy-h">{t('ui.procedures.field.steps')}</legend>
        {draft.steps.map((s, i) => (
          <div key={i} className="pr-step-edit">
            <span className="pr-step-n mono">{i + 1}</span>
            <div className="pr-step-fields">
              <textarea className="text-input cy-textarea" rows={2} aria-label={t('ui.procedures.field.stepText', { n: i + 1 })} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })} />
              <input className="text-input mono" aria-label={t('ui.procedures.field.stepRun', { n: i + 1 })} placeholder={t('ui.procedures.edit.runPlaceholder')} value={s.run} onChange={(e) => setStep(i, { run: e.target.value })} />
            </div>
            <div className="pr-step-tools">
              <button type="button" className="btn cy-mini" aria-label={t('ui.procedures.edit.stepUp', { n: i + 1 })} disabled={i === 0} onClick={() => set({ steps: moveStep(draft.steps, i, -1) })}>{t('ui.procedures.edit.up')}</button>
              <button type="button" className="btn cy-mini" aria-label={t('ui.procedures.edit.stepDown', { n: i + 1 })} disabled={i === draft.steps.length - 1} onClick={() => set({ steps: moveStep(draft.steps, i, 1) })}>{t('ui.procedures.edit.down')}</button>
              <button type="button" className="btn cy-mini" aria-label={t('ui.procedures.edit.stepRemove', { n: i + 1 })} onClick={() => set({ steps: removeStep(draft.steps, i) })}>{t('ui.procedures.edit.remove')}</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn cy-mini" disabled={draft.steps.length >= LIMITS.steps} onClick={() => set({ steps: addStep(draft.steps) })}>{t('ui.procedures.edit.addStep')}</button>
      </fieldset>
      <label className="cy-field">
        <span className="small muted">{t('ui.procedures.field.pitfalls')}</span>
        <textarea className="text-input cy-textarea" rows={3} value={draft.pitfalls} onChange={(e) => set({ pitfalls: e.target.value })} />
      </label>
      <label className="cy-field">
        <span className="small muted">{t('ui.procedures.field.waits')}</span>
        <textarea className="text-input cy-textarea" rows={3} value={draft.waits} onChange={(e) => set({ waits: e.target.value })} />
      </label>
      {failure && <Refusals failure={failure} />}
      <div className="row">
        <button type="submit" className="btn btn-dark" disabled={busy || sameDraft(draft, first)}>{t('ui.procedures.edit.save')}</button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>{t('ui.procedures.edit.cancel')}</button>
        {failure?.code === 'revision' && <button type="button" className="btn" onClick={onReload}>{t('ui.procedures.edit.reload')}</button>}
      </div>
    </form>
  );
}
