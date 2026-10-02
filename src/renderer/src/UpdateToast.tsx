import { useEffect, useState } from 'react';
import { updatedToast } from '../../shared/update';
import { isWeb } from './platform';
import { updateApi } from './updateApi';
import './update.css';

const SHOWN_MS = 12_000;

// After scripts/update.sh, the first start says which commit it is running, once. A start in the tray
// (--hidden) waits until the window is actually seen.
export function UpdateToast() {
  const [commit, setCommit] = useState<string | null>(null);

  useEffect(() => {
    if (isWeb()) return;
    let off = (): void => undefined;
    void updateApi.info().then((info) => {
      const announce = info.announce;
      if (!announce) return;
      const show = () => {
        if (document.visibilityState !== 'visible') return false;
        setCommit(announce);
        void updateApi.seen().catch(() => undefined);
        return true;
      };
      if (show()) return;
      const onVisible = () => {
        if (show()) off();
      };
      document.addEventListener('visibilitychange', onVisible);
      off = () => document.removeEventListener('visibilitychange', onVisible);
    }, () => undefined);
    return () => off();
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
