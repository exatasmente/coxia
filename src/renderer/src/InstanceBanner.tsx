import { useT } from './i18n';
import { isWeb } from './platform';
import { LINK_LABEL, ROLE_LABEL, useInstanceStatus } from './instancesApi';
import './instances.css';

// Which instance the window is connected to, whether the link is up and whether that instance owns the workspace. Nothing shows while the core runs on this computer.
export function InstanceBanner() {
  const t = useT();
  const status = useInstanceStatus();
  if (isWeb() || !status?.instance) return null;
  const up = status.link === 'connected';
  return (
    <div className={`inst-banner ${up ? '' : 'inst-down'}`} role="status" aria-live="polite">
      <span style={{ fontWeight: 600 }}>{t('ui.settings.instances.banner', { name: status.instance.name })}</span>
      <span>{t(LINK_LABEL[status.link])}</span>
      {up && status.role && <span>{t(ROLE_LABEL[status.role])}</span>}
      {!up && status.detail && <span className="small">{status.detail}</span>}
    </div>
  );
}
