import { useEffect, useState } from 'react';
import { SHOWN_EVENT, updatedToast } from '../../shared/update';
import { moduleEvents } from './api';
import { isWeb } from './platform';
import { updateApi } from './updateApi';
import './update.css';

const SHOWN_MS = 12_000;

// After scripts/update.sh, the first start says which commit it is running, once. The main process only hands the
// commit over while the window is visible: a start in the tray (--hidden) waits until the window is shown.
export function UpdateToast() {
  const [commit, setCommit] = useState<string | null>(null);

  useEffect(() => {
    if (isWeb()) return;
    const check = () => {
      void updateApi.info().then((info) => {
        if (!info.announce) return;
        setCommit(info.announce);
        void updateApi.seen().catch(() => undefined);
      }, () => undefined);
    };
    check();
    moduleEvents.addEventListener(SHOWN_EVENT, check);
    return () => moduleEvents.removeEventListener(SHOWN_EVENT, check);
  }, []);

  useEffect(() => {
    if (!commit) return;
    const t = setTimeout(() => setCommit(null), SHOWN_MS);
    return () => clearTimeout(t);
  }, [commit]);

  if (!commit) return null;
  return (
    <div className="upd-toast" role="status" aria-live="polite">
      <span>{updatedToast(commit)}</span>
      <button type="button" aria-label="Dispensar aviso" onClick={() => setCommit(null)}>×</button>
    </div>
  );
}
