import { useCallback, useEffect, useState } from 'react';
import { MEMORY_LIMITS } from '../../../../shared/memory';
import type { NoteGet, NoteItem, NoteWrite } from '../../../../shared/memoryView';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { ERROR_KEY, KIND_LABEL, NOTE_KIND_LIST, needsReview } from './memoryModel';
import { memoryApi } from './memoryApi';

// The open note of the list: read from the app when it opens. The person reads who wrote it and when, edits it, marks it reviewed or removes it; the same from the window and
// from a paired browser. Every change answers with the note as stored, shown at once. The text arrives masked, and an agent that wrote the note can no longer replace it once the
// person edited it (the app refuses that, not this screen).

type Failure = Extract<NoteWrite, { ok: false }>;
type Mode = 'view' | 'edit' | 'remove';

const FIELD_KEY: Record<string, string> = { title: 'ui.memory.field.title', text: 'ui.memory.field.text', kind: 'ui.memory.field.kind' };

const stamp = (iso: string): string => new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });

/** What a write that did not happen says to fix: one line per field the check named, or the single reason. */
export function Refusals({ failure }: { failure: Failure }) {
  const t = useT();
  if (failure.refusals?.length) {
    return (
      <div className="error" role="alert">
        <p>{t('ui.memory.edit.notSaved')}</p>
        <ul className="me-list">
          {failure.refusals.map((r, i) => <li key={i}>{FIELD_KEY[r.field] ? t(FIELD_KEY[r.field]) : r.field}: {r.text}</li>)}
        </ul>
      </div>
    );
  }
  const key = ERROR_KEY[failure.code];
  return <div className="error" role="alert">{key ? t(key) : failure.text}</div>;
}

export function NotePanel({ note, who, onChanged }: { note: NoteItem; /** The agent or the person, in words. */ who: (by: string) => string; /** A write changed the list (a revision, a mark, a removal). */ onChanged: () => void }) {
  const t = useT();
  const { conversation, agent, id } = note;
  const [got, setGot] = useState<NoteGet | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState<NonNullable<NoteItem['kind']>>('note');

  // A different revision in the list means the note changed under the panel, so it is read again.
  useEffect(() => {
    let live = true;
    void memoryApi.read(conversation, agent, id).then(
      (g) => live && setGot(g),
      () => live && setGot({ status: 'missing' }),
    );
    return () => {
      live = false;
    };
  }, [conversation, agent, id, note.revision, note.reviewed, note.at, again]);

  const reload = useCallback(() => {
    setFailure(null);
    setMode('view');
    setAgain((n) => n + 1);
  }, []);

  const send = async (run: () => Promise<NoteWrite>): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setBroken(null);
    try {
      const done = await run();
      if (done.ok) {
        setMode('view');
        setAgain((n) => n + 1);
        onChanged();
      } else {
        setFailure(done);
      }
    } catch (e) {
      setBroken(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setBroken(null);
    try {
      const done = await memoryApi.remove(conversation, agent, id);
      if (done.ok) onChanged();
      else setFailure({ ok: false, code: done.code, text: done.text });
    } catch (e) {
      setBroken(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!got) return <span className="spinner" aria-label={t('ui.memory.panel.loading')} />;
  if (got.status !== 'ok') return <p className="small muted">{t('ui.memory.panel.missing')}</p>;
  const current = got.note;

  const startEdit = (): void => {
    setTitle(current.title);
    setText(got.text);
    setKind(current.kind ?? 'note');
    setFailure(null);
    setMode('edit');
  };
  const changed = title !== current.title || text !== got.text || kind !== (current.kind ?? 'note');

  return (
    <div className="me-panel">
      <dl className="me-meta small">
        <dt className="muted">{t('ui.memory.meta.by')}</dt>
        <dd>{current.person && !current.foreign ? t('ui.memory.person') : who(current.by)}{current.person && !current.foreign && current.by !== 'person' ? ` (${t('ui.memory.meta.wroteBy', { who: who(current.by) })})` : ''}</dd>
        <dt className="muted">{t('ui.memory.meta.at')}</dt>
        <dd>{stamp(current.at)}</dd>
        <dt className="muted">{t('ui.memory.meta.revision')}</dt>
        <dd>{current.revision}</dd>
        {current.activity && <><dt className="muted">{t('ui.memory.meta.activity')}</dt><dd className="mono">{current.activity}</dd></>}
        {current.repo && <><dt className="muted">{t('ui.memory.meta.repo')}</dt><dd className="mono">{current.repo}</dd></>}
        <dt className="muted">{t('ui.memory.meta.id')}</dt>
        <dd className="mono">{`${conversation}/${agent}/${current.id}.md`}</dd>
      </dl>

      {mode === 'remove' ? (
        <div className="me-confirm" role="alertdialog" aria-label={t('ui.memory.remove.title', { title: current.title })}>
          <p>{t('ui.memory.remove.confirm', { title: current.title })}</p>
          <div className="row">
            <button type="button" className="btn btn-red" disabled={busy} onClick={() => void remove()}>{t('ui.memory.remove.yes')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode('view')}>{t('ui.memory.remove.no')}</button>
          </div>
        </div>
      ) : mode === 'view' ? (
        <div className="row me-actions">
          <button type="button" className="btn" disabled={busy} onClick={startEdit}>{t('ui.memory.edit.button')}</button>
          {needsReview(current) && <button type="button" className="btn" disabled={busy || current.unsafe} onClick={() => void send(() => memoryApi.review(conversation, agent, id))}>{t('ui.memory.review')}</button>}
          <button type="button" className="btn" disabled={busy} onClick={() => { setFailure(null); setMode('remove'); }}>{t('ui.memory.remove.button')}</button>
        </div>
      ) : null}

      {mode !== 'edit' && failure && <Refusals failure={failure} />}
      {failure?.code === 'revision' && mode !== 'edit' && <button type="button" className="btn cy-mini" onClick={reload}>{t('ui.memory.edit.reload')}</button>}
      {broken && <div className="error" role="alert">{broken}</div>}

      {mode === 'edit' ? (
        <form className="me-edit" onSubmit={(e) => { e.preventDefault(); void send(() => memoryApi.save(conversation, agent, id, current.revision, { title, text, kind })); }} aria-label={t('ui.memory.edit.form', { title: current.title })}>
          <p className="small muted">{t('ui.memory.edit.lead')}</p>
          <p className="faint">{t('ui.memory.edit.limits', { title: MEMORY_LIMITS.title, text: MEMORY_LIMITS.note })}</p>
          <div className="me-edit-head">
            <label className="cy-field">
              <span className="small muted">{t('ui.memory.field.kind')}</span>
              <select className="text-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                {NOTE_KIND_LIST.map((k) => <option key={k} value={k}>{t(KIND_LABEL[k])}</option>)}
              </select>
            </label>
            <label className="cy-field">
              <span className="small muted">{t('ui.memory.field.title')}</span>
              <input className="text-input" maxLength={MEMORY_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
          </div>
          <label className="cy-field">
            <span className="small muted">{t('ui.memory.field.text')}</span>
            <textarea className="text-input cy-textarea me-textarea" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          {failure && <Refusals failure={failure} />}
          <div className="row">
            <button type="submit" className="btn btn-dark" disabled={busy || !changed}>{t('ui.memory.edit.save')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setFailure(null); setMode('view'); }}>{t('ui.memory.edit.cancel')}</button>
            {failure?.code === 'revision' && <button type="button" className="btn" onClick={reload}>{t('ui.memory.edit.reload')}</button>}
          </div>
        </form>
      ) : (
        <pre className="me-text" aria-label={t('ui.memory.field.text')}>{got.text || t('ui.memory.panel.noText')}</pre>
      )}
    </div>
  );
}
