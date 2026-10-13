import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { useT } from '../i18n';
import { isWeb } from '../platform';
import type { EffectKind, EffectStatus } from '../../../shared/effects';

// Settings › autonomy per kind of external effect (#199): the track record of each kind, when it is offered, and the grant with its revocation. Every kind asks until the person
// grants it here; the app only offers. Granting and revoking are admin acts (webPolicy.ts), so a paired browser never shows the section.

// Literal keys, so the catalog check sees each one used.
const KIND_LABEL: Record<EffectKind, string> = {
  push: 'ui.settings.autonomy.kind.push',
  'pull-request': 'ui.settings.autonomy.kind.pullRequest',
  comment: 'ui.settings.autonomy.kind.comment',
  review: 'ui.settings.autonomy.kind.review',
  tracker: 'ui.settings.autonomy.kind.tracker',
  deploy: 'ui.settings.autonomy.kind.deploy',
  email: 'ui.settings.autonomy.kind.email',
  dns: 'ui.settings.autonomy.kind.dns',
  spend: 'ui.settings.autonomy.kind.spend',
  'budget-raise': 'ui.settings.autonomy.kind.budgetRaise',
  'permission-raise': 'ui.settings.autonomy.kind.permissionRaise',
};

export function AutonomySection() {
  const t = useT();
  const web = isWeb();
  const [rows, setRows] = useState<EffectStatus[] | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    api.invoke<EffectStatus[]>('autonomy:status').then(setRows, (e) => setError(errorText(e)));
  };
  useEffect(() => {
    if (web) return;
    load();
    return api.onEvent((ev) => {
      if (ev.type === 'module' && ev.name === 'autonomy:changed') load();
    });
  }, [web]);

  if (web) return null;
  if (!rows) return error ? <div className="error" role="alert">{error}</div> : null;

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="autonomy-title">
      <div>
        <h3 id="autonomy-title" className="wz-sub">{t('ui.settings.autonomy.title')}</h3>
        <p className="small muted" style={{ marginTop: 4 }}>{t('ui.settings.autonomy.hint')}</p>
      </div>
      {rows.map((r) => (
        <div className="settings-row" key={r.kind}>
          <div style={{ fontWeight: 600 }}>{t(KIND_LABEL[r.kind])}</div>
          <div>
            <div className="small muted">{t('ui.settings.autonomy.record', { proposed: r.record.proposed, approved: r.record.approved, refused: r.record.refused, reverted: r.record.reverted, autonomous: r.record.autonomous })}</div>
            <div className="small muted">{t('ui.settings.autonomy.progress', { streak: r.record.streak, n: r.offerAfter })}</div>
            {r.grant ? (
              <div className="row" style={{ gap: 8 }}>
                <span className="small" role="status">
                  {t(r.grant.legacy ? 'ui.settings.autonomy.grantedLegacy' : 'ui.settings.autonomy.granted', { id: r.grant.id, limit: r.grant.threshold === undefined ? t('ui.settings.autonomy.noLimit') : String(r.grant.threshold) })}
                </span>
                <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.invoke('autonomy:revoke', r.kind))}>{t('ui.settings.autonomy.revoke')}</button>
              </div>
            ) : r.offered ? (
              <div className="row" style={{ gap: 8 }}>
                <span className="small" role="status">{t('ui.settings.autonomy.offered')}</span>
                <input type="number" min={0} className="text-input" style={{ maxWidth: 100 }} aria-label={t(r.amountThreshold ? 'ui.settings.autonomy.maxAmount' : 'ui.settings.autonomy.maxPerHour')} placeholder={t(r.amountThreshold ? 'ui.settings.autonomy.maxAmount' : 'ui.settings.autonomy.maxPerHour')} value={limits[r.kind] ?? ''} onChange={(e) => setLimits({ ...limits, [r.kind]: e.target.value })} />
                <button type="button" className="btn" disabled={busy} onClick={() => void act(() => api.invoke('autonomy:grant', r.kind, (limits[r.kind] ?? '').trim() === '' ? undefined : Number(limits[r.kind])))}>{t('ui.settings.autonomy.grant')}</button>
              </div>
            ) : (
              <div className="small muted">{t('ui.settings.autonomy.asking')}</div>
            )}
          </div>
        </div>
      ))}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
