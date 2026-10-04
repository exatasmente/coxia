import { useEffect, useState } from 'react';
import { MEMORY_FILE } from '../../../../shared/runs';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { RichText } from '../Diagram';
import { Sheet } from '../Sheet';
import { type ArtifactText, runsApi } from './runsApi';

/** A document a stage produced, read from the run's cycle folder and shown in place (a sheet over the screen). The cycle memory is the one document the
 * person may rewrite here: the app keeps it for the next stage, so the screen sends the whole text and shows back what was really written. */
export function ArtifactView({ runId, name, onClose }: { runId: string; name: string; onClose: () => void }) {
  const t = useT();
  const [doc, setDoc] = useState<ArtifactText | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editable = name === MEMORY_FILE;
  useEffect(() => {
    let live = true;
    setDoc(undefined);
    setFailed(false);
    setEditing(false);
    setSaveError(null);
    runsApi.artifact(runId, name).then(
      (d) => live && setDoc(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [runId, name]);
  const save = () => {
    setSaving(true);
    setSaveError(null);
    void runsApi.editMemory(runId, draft).then(
      (written) => {
        setDoc(written);
        setSaving(false);
        setEditing(false);
      },
      (e) => {
        setSaveError(errorText(e));
        setSaving(false);
      },
    );
  };
  return (
    <Sheet label={name} onClose={onClose} wide>
      {doc === undefined && !failed && <span className="spinner" aria-label={t('ui.cycle.artifact.loading')} />}
      {(failed || doc === null) && <p className="small muted">{t('ui.cycle.artifact.gone')}</p>}
      {doc &&
        (editing ? (
          <>
            <label className="cy-field">
              <span className="small muted">{t('ui.cycle.artifact.editLabel')}</span>
              <textarea
                className="text-input cy-textarea"
                aria-label={t('ui.cycle.artifact.editLabel')}
                spellCheck={false}
                rows={18}
                value={draft}
                disabled={saving}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            {saveError && <div className="error" role="alert">{saveError}</div>}
            <div className="row">
              <button type="button" className="btn btn-dark" disabled={saving} onClick={save}>
                {saving ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.cycle.artifact.save')}
              </button>
              <button type="button" className="btn" disabled={saving} onClick={() => setEditing(false)}>{t('ui.cycle.artifact.cancel')}</button>
            </div>
          </>
        ) : (
          <div className="cy-doc">
            <RichText text={doc.text} />
            {doc.clipped && <p className="faint small">{t('ui.cycle.artifact.clipped')}</p>}
            {editable && (
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDraft(doc.text);
                    setSaveError(null);
                    setEditing(true);
                  }}
                >
                  {t('ui.cycle.artifact.edit')}
                </button>
              </div>
            )}
          </div>
        ))}
    </Sheet>
  );
}
