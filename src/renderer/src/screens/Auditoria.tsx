import { useEffect, useMemo, useState } from 'react';
import type { AuditEntry } from '../../../shared/auditoria';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { intlLocale, useT } from '../i18n';
import { BackIcon } from './icons';

// A plain string is a product name; { key } is a catalog key translated when the row renders.
const KIND: Record<AuditEntry['kind'], string | { key: string }> = {
  gitlab: 'GitLab',
  github: 'GitHub',
  bitbucket: 'Bitbucket', // i18n-ignore
  graphql: 'GraphQL',
  sync: { key: 'ui.audit.kind.sync' },
  publish: { key: 'ui.audit.kind.publish' },
  'note-edit': { key: 'ui.audit.kind.noteEdit' },
  push: { key: 'ui.audit.kind.push' },
  minutes: { key: 'ui.audit.kind.minutes' },
  exec: { key: 'ui.audit.kind.exec' },
  release: { key: 'ui.audit.kind.release' },
  'plugin-write': { key: 'ui.audit.kind.pluginWrite' },
  'plugin-request': { key: 'ui.audit.kind.pluginRequest' },
  'screen-open': { key: 'ui.audit.kind.screenOpen' },
  'screen-close': { key: 'ui.audit.kind.screenClose' },
  'screen-hold': { key: 'ui.audit.kind.screenHold' },
  'screen-confirm': { key: 'ui.audit.kind.screenConfirm' },
  'screen-use': { key: 'ui.audit.kind.screenUse' },
  procedure: { key: 'ui.audit.kind.procedure' },
  'screen-handoff': { key: 'ui.audit.kind.screenHandoff' },
};

function Row({ e }: { e: AuditEntry }) {
  const t = useT();
  const kind = KIND[e.kind];
  const fields = Object.entries(e.fields);
  return (
    <section className="panel" style={{ padding: 16, gap: 8, borderColor: e.ok ? undefined : 'var(--red-ink)' }}>
      <div className="row" style={{ gap: 10 }}>
        <span className={`badge ${e.ok ? 'badge-now' : 'badge-block'}`}>{e.ok ? t('ui.audit.ok') : t('ui.audit.error')}{e.code ? ` ${e.code}` : ''}</span>
        <span className="badge badge-quiet">{typeof kind === 'string' ? kind : t(kind.key)}</span>
        {e.issue > 0 && <span className="mono small">#{e.issue}</span>}
        <span className="faint">{new Date(e.at).toLocaleString(intlLocale())}</span>
        <span className="faint" style={{ marginLeft: 'auto' }}>{e.origin.kind}{e.origin.summary ? ` · ${e.origin.summary}` : ''}</span>
      </div>
      <div className="mono small" style={{ wordBreak: 'break-all' }}>{e.target} <span className="faint">{t('ui.audit.via', { via: e.via })}</span></div>
      {fields.length > 0 && (
        <div className="mono small muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {fields.map(([k, v]) => `${k} = ${v}`).join('\n')}
        </div>
      )}
      <div className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: e.ok ? undefined : 'var(--red-ink)' }}>{e.result}</div>
    </section>
  );
}

export function Auditoria({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState('');

  const load = () => api.invoke<AuditEntry[]>('auditoria:list').then(setRows, (e) => setError(errorText(e)));
  useEffect(() => void load(), []);

  const shown = useMemo(() => {
    const n = issue.replace(/\D/g, '');
    return (rows ?? []).filter((r) => !n || String(r.issue).includes(n));
  }, [rows, issue]);

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 16 }}>
        <header className="row" style={{ gap: 14 }}>
          <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.audit.title')}</h1>
          <span className="faint">{rows ? t('ui.audit.shownOf', { shown: shown.length, total: rows.length }) : ''}</span>
          <input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder={t('ui.audit.filterPlaceholder')}
            aria-label={t('ui.audit.filterLabel')}
            style={{ marginLeft: 'auto', minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--field-line)', minWidth: 220 }} /* i18n-ignore */
          />
          <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => void load()}>{t('ui.audit.refresh')}</button>
        </header>
        {error && <div className="error">{error}</div>}
        {!rows && !error && <div className="row faint"><span className="spinner" /> {t('ui.audit.loading')}</div>}
        {rows && !shown.length && <p className="small faint">{rows.length ? t('ui.audit.noneForIssue') : t('ui.audit.none')}</p>}
        {shown.map((e, i) => <Row key={`${e.at}-${i}`} e={e} />)}
      </div>
    </div>
  );
}
