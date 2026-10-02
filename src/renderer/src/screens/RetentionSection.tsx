import { type CSSProperties, useState } from 'react';
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, type RetentionKind, type RetentionPreview } from '../../../shared/retention';
import type { Settings } from '../../../shared/settings';
import { errorText } from '../api';
import { intlLocale, useT } from '../i18n';
import { retentionApi } from '../retentionApi';

const SHOWN = 8;
const GROUP_STYLE: CSSProperties = { borderTop: '1px solid var(--line-2)', paddingTop: 8 }; // i18n-ignore: CSS value

const KIND_LABEL: Record<RetentionKind, string> = {
  sessoes: 'ui.retention.kind.sessoes',
  historico: 'ui.retention.kind.historico',
  gates: 'ui.retention.kind.gates',
  qa: 'ui.retention.kind.qa',
  retros: 'ui.retention.kind.retros',
  atividade: 'ui.retention.kind.atividade',
  feedback: 'ui.retention.kind.feedback',
};


function size(bytes: number): string {
  const number = (value: number, digits: number) => new Intl.NumberFormat(intlLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024, 0)} KB`;
  return `${number(bytes / 1024 / 1024, 1)} MB`;
}

export function RetentionSection({ value, onChange }: { value: Settings['retention']; onChange: (v: Settings['retention']) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setConfirming(false);
    setMessage(null);
  };

  const look = async () => {
    setBusy(true);
    setError(null);
    reset();
    try {
      setPreview(await retentionApi.preview(value.days));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const wipe = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await retentionApi.apply(preview.days, preview.fingerprint);
      setPreview(null);
      setConfirming(false);
      const failure = r.failed.length ? t('ui.retention.failure', { failed: r.failed.length, name: r.failed[0].name, error: r.failed[0].error }) : '';
      setMessage(t('ui.retention.deleted', { count: r.deleted, size: size(r.bytes), failure }));
    } catch (e) {
      setError(errorText(e));
      setPreview(null);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.retention.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {t('ui.retention.hint')}
        </p>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={value.enabled} onChange={() => { reset(); onChange({ ...value, enabled: !value.enabled }); }} />
        <span>
          <span style={{ fontWeight: 600, display: 'block' }}>{t('ui.retention.auto.label')}</span>
          <span className="small muted">{t('ui.retention.auto.hint')}</span>
        </span>
      </label>
      <div className="settings-row">
        <label htmlFor="ret-days" style={{ fontWeight: 600 }}>{t('ui.retention.days.label')}</label>
        <div className="row" style={{ gap: 8 }}>
          <input
            id="ret-days"
            type="number"
            min={RETENTION_MIN_DAYS}
            max={RETENTION_MAX_DAYS}
            className="text-input"
            style={{ maxWidth: 90 }}
            value={value.days}
            onChange={(e) => { reset(); onChange({ ...value, days: Number(e.target.value) }); }}
          />
          <span className="small muted">{t('ui.retention.days.unit', { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS })}</span>
        </div>
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>
          {busy && !confirming ? <span className="spinner" /> : null} {t('ui.retention.look')}
        </button>
        {preview && preview.count > 0 && !confirming && (
          <button type="button" className="btn btn-red" disabled={busy} onClick={() => setConfirming(true)}>{t('ui.retention.wipeNow')}</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {message && <div className="small muted">{message}</div>}
      {preview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {preview.count === 0 ? (
            <div className="small muted">{t('ui.retention.nothingExpired', { days: preview.days, untouched: preview.untouchedSessions })}</div>
          ) : (
            <>
              <div style={{ fontWeight: 600 }}>
                {t('ui.retention.wouldDelete', { count: preview.count })} · {size(preview.bytes)}
              </div>
              {preview.groups.map((g) => {
                const items = preview.items.filter((i) => i.kind === g.kind);
                const expanded = open === g.kind;
                return (
                  <div key={g.kind} style={GROUP_STYLE}>
                    <button type="button" className="btn" style={{ minHeight: 36, width: '100%', justifyContent: 'space-between' }} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.kind)}>
                      <span>{t(KIND_LABEL[g.kind])}</span>
                      <span className="small muted">{g.count} · {size(g.bytes)}</span>
                    </button>
                    {expanded && (
                      <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                        {items.slice(0, SHOWN).map((i) => (
                          <li key={i.name}><span style={{ fontFamily: 'var(--mono)' }}>{i.name.slice(0, 13)}</span>: {i.reason}</li>
                        ))}
                        {items.length > SHOWN && <li>{t('ui.retention.andMore', { more: items.length - SHOWN })}</li>}
                      </ul>
                    )}
                  </div>
                );
              })}
              <div className="small muted">{t('ui.retention.untouched', { untouched: preview.untouchedSessions })}</div>
            </>
          )}
          {confirming && (
            <div className="error" role="alertdialog" aria-label={t('ui.retention.confirm.aria')} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 600 }}>
                {t('ui.retention.confirm.text', { count: preview.count, size: size(preview.bytes) })}
              </div>
              <div className="row">
                <button type="button" className="btn btn-red" disabled={busy} onClick={() => void wipe()}>
                  {busy ? <span className="spinner" /> : null} {t('ui.retention.confirm.yes')}
                </button>
                <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>{t('ui.retention.confirm.cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
