import { useCallback, useEffect, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { ProcedureRecord } from '../../../../shared/procedures';
import type { ProcedureGet, ProcedureWrite } from '../../../../shared/proceduresView';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { ERROR_KEY } from './editModel';
import { RecordBody } from './RecordBody';
import { RecordEditor, Refusals } from './RecordEditor';
import { proceduresApi } from './proceduresApi';

// The open record of the list: read from the app when it opens. On the computer the person also edits it, marks it reviewed, restores the version before it or deletes it; in a
// paired browser none of those is drawn (and the app refuses their channels to a browser anyway). Every change answers with the record as stored, shown at once.

const GONE = { missing: 'ui.procedures.panel.missing', deleted: 'ui.procedures.panel.missing', newer: 'ui.procedures.panel.newer', invalid: 'ui.procedures.panel.invalid' } as const;

export type PanelMode = 'view' | 'edit' | 'delete';

/** The buttons that change a record. Nothing at all where the person may not change it. */
export function RecordActions({ record, canWrite, mode, busy, on }: { record: ProcedureRecord; canWrite: boolean; mode: PanelMode; busy: boolean; on: { edit(): void; review(): void; restore(): void; remove(): void; confirmRemove(): void; keep(): void } }) {
  const t = useT();
  if (!canWrite) return null;
  if (mode === 'delete') {
    return (
      <div className="pr-confirm" role="alertdialog" aria-label={t('ui.procedures.delete.title', { title: record.title })}>
        <p>{t('ui.procedures.delete.confirm', { title: record.title })}</p>
        <div className="row">
          <button type="button" className="btn btn-red" disabled={busy} onClick={on.confirmRemove}>{t('ui.procedures.delete.yes')}</button>
          <button type="button" className="btn" disabled={busy} onClick={on.keep}>{t('ui.procedures.delete.no')}</button>
        </div>
      </div>
    );
  }
  if (mode === 'edit') return null;
  return (
    <div className="row pr-actions">
      <button type="button" className="btn" disabled={busy} onClick={on.edit}>{t('ui.procedures.edit.button')}</button>
      {!record.reviewed && <button type="button" className="btn" disabled={busy} onClick={on.review}>{t('ui.procedures.review')}</button>}
      {record.previous && <button type="button" className="btn" disabled={busy} onClick={on.restore}>{t('ui.procedures.restore')}</button>}
      <button type="button" className="btn" disabled={busy} onClick={on.remove}>{t('ui.procedures.delete.button')}</button>
    </div>
  );
}

export function RecordPanel({ id, revision, team, onChanged }: { id: string; /** The revision the list showed: a different one means the record changed, so it is read again. */ revision: number; team: readonly AgentDef[] | undefined; /** A write changed the list (a revision, a mark, a delete). */ onChanged: () => void }) {
  const t = useT();
  const canWrite = !isWeb();
  const [got, setGot] = useState<ProcedureGet | null>(null);
  const [mode, setMode] = useState<PanelMode>('view');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<ProcedureWrite, { ok: false }> | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [again, setAgain] = useState(0);

  useEffect(() => {
    let live = true;
    void proceduresApi.get(id).then(
      (g) => live && setGot(g),
      () => live && setGot({ status: 'invalid' }),
    );
    return () => {
      live = false;
    };
  }, [id, revision, again]);

  const reload = useCallback(() => {
    setFailure(null);
    setMode('view');
    setAgain((n) => n + 1);
  }, []);

  // One write: the answer is the record as stored (shown at once) or the reason it did not happen (shown where it was asked).
  const write = async (send: () => Promise<ProcedureWrite>): Promise<ProcedureWrite | null> => {
    setBusy(true);
    setFailure(null);
    setBroken(null);
    try {
      const done = await send();
      if (done.ok) {
        setGot({ status: 'ok', record: done.record });
        setMode('view');
        onChanged();
      } else {
        setFailure(done);
      }
      return done;
    } catch (e) {
      setBroken(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (!got) return <span className="spinner" aria-label={t('ui.procedures.panel.loading')} />;
  if (got.status !== 'ok') return <p className="small muted">{t(GONE[got.status])}</p>;
  const record = got.record;

  const remove = async () => {
    setBusy(true);
    setFailure(null);
    setBroken(null);
    try {
      const done = await proceduresApi.remove(id);
      if (done.ok) onChanged();
      else setFailure({ ok: false, code: done.code, text: done.code });
    } catch (e) {
      setBroken(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pr-panel">
      <RecordActions
        record={record}
        canWrite={canWrite}
        mode={mode}
        busy={busy}
        on={{
          edit: () => { setFailure(null); setMode('edit'); },
          review: () => void write(() => proceduresApi.review(id)),
          restore: () => void write(() => proceduresApi.restore(id, record.revision)),
          remove: () => { setFailure(null); setMode('delete'); },
          confirmRemove: () => void remove(),
          keep: () => setMode('view'),
        }}
      />
      {mode !== 'edit' && failure && <Refusals failure={failure} />}
      {failure && mode !== 'edit' && ERROR_KEY[failure.code] === 'ui.procedures.error.revision' && <button type="button" className="btn cy-mini" onClick={reload}>{t('ui.procedures.edit.reload')}</button>}
      {broken && <div className="error" role="alert">{broken}</div>}
      {canWrite && mode === 'edit' ? (
        <RecordEditor record={record} onSave={(input) => write(() => proceduresApi.save(id, record.revision, input)).then((r) => r ?? { ok: false, code: 'io', text: '' })} onCancel={() => setMode('view')} onReload={reload} />
      ) : (
        <RecordBody record={record} team={team} />
      )}
    </div>
  );
}
