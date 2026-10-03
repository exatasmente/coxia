import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { RichText } from '../Diagram';
import { Sheet } from '../Sheet';
import { type ArtifactText, runsApi } from './runsApi';

/** A document a stage produced, read from the run's cycle folder and shown in place (a sheet over the screen). */
export function ArtifactView({ runId, name, onClose }: { runId: string; name: string; onClose: () => void }) {
  const t = useT();
  const [doc, setDoc] = useState<ArtifactText | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setDoc(undefined);
    setFailed(false);
    runsApi.artifact(runId, name).then(
      (d) => live && setDoc(d),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [runId, name]);
  return (
    <Sheet label={name} onClose={onClose} wide>
      {doc === undefined && !failed && <span className="spinner" aria-label={t('ui.cycle.artifact.loading')} />}
      {(failed || doc === null) && <p className="small muted">{t('ui.cycle.artifact.gone')}</p>}
      {doc && (
        <div className="cy-doc">
          <RichText text={doc.text} />
          {doc.clipped && <p className="faint small">{t('ui.cycle.artifact.clipped')}</p>}
        </div>
      )}
    </Sheet>
  );
}
