import { useEffect, useState } from 'react';
import { SHOWN_EVENT } from '../../shared/update';
import { moduleEvents } from './api';
import { useT } from './i18n';
import { isWeb } from './platform';
import { updateApi } from './updateApi';
import './update.css';

const SHOWN_MS = 12_000;

// After an update (scripts/update.sh, or a downloaded release), the first start says what it is running, once: the commit after a rebuild,
// the version after a release. The main process only hands it over while the window is visible: a start in the tray (--hidden) waits
// until the window is shown.
export function UpdateToast() {
  const t = useT();
  const [to, setTo] = useState<string | null>(null);

  useEffect(() => {
    if (isWeb()) return;
    const check = () => {
      void updateApi.info().then((info) => {
        if (!info.announce) return;
        setTo(info.announce);
        void updateApi.seen().catch(() => undefined);
      }, () => undefined);
    };
    check();
    moduleEvents.addEventListener(SHOWN_EVENT, check);
    return () => moduleEvents.removeEventListener(SHOWN_EVENT, check);
  }, []);

  useEffect(() => {
    if (!to) return;
    const timer = setTimeout(() => setTo(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [to]);

  if (!to) return null;
  return (
    <div className="upd-toast" role="status" aria-live="polite">
      <span>{t('updates.toast.updated', { to })}</span>
      <button type="button" aria-label={t('updates.toast.dismiss')} onClick={() => setTo(null)}>×</button>
    </div>
  );
}
