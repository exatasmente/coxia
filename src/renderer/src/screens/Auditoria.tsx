import { useEffect, useMemo, useRef, useState } from 'react';
import type { AuditEntry } from '../../../shared/auditoria';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { intlLocale, useT } from '../i18n';
import { BackIcon } from './icons';
import { HOME } from '../home';
import { approvedOwn, basisLines, doorWords, filterEntries, indexOfAct, isWhoFilter, whoOf, WHO_FILTERS, type WhoFilter } from '../auditModel';

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
  worktree: { key: 'ui.audit.kind.worktree' },
  'plugin-write': { key: 'ui.audit.kind.pluginWrite' },
  'plugin-request': { key: 'ui.audit.kind.pluginRequest' },
  'plugin-call': { key: 'ui.audit.kind.pluginCall' },
  'screen-open': { key: 'ui.audit.kind.screenOpen' },
  'screen-close': { key: 'ui.audit.kind.screenClose' },
  'screen-hold': { key: 'ui.audit.kind.screenHold' },
  'screen-confirm': { key: 'ui.audit.kind.screenConfirm' },
  'screen-use': { key: 'ui.audit.kind.screenUse' },
  procedure: { key: 'ui.audit.kind.procedure' },
  'screen-handoff': { key: 'ui.audit.kind.screenHandoff' },
  'test-env': { key: 'ui.audit.kind.testEnv' },
  memory: { key: 'ui.audit.kind.memory' },
  'turn-limit': { key: 'ui.audit.kind.turnLimit' },
  persona: { key: 'ui.audit.kind.persona' },
  config: { key: 'ui.audit.kind.config' },
  secret: { key: 'ui.audit.kind.secret' },
  'plugin-decision': { key: 'ui.audit.kind.pluginDecision' },
  act: { key: 'ui.audit.kind.act' },
};

const WHO_LABEL: Record<WhoFilter, string> = { all: 'ui.audit.who.all', person: 'ui.audit.who.person', persona: 'ui.audit.who.persona', agent: 'ui.audit.who.agent' };

function Row({ e, focused }: { e: AuditEntry; focused: boolean }) {
  const t = useT();
  const kind = KIND[e.kind] ?? e.kind;
  const fields = Object.entries(e.fields);
  const door = doorWords(e.door);
  const basis = basisLines(e);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center' });
  }, [focused]);
  return (
    <section ref={ref} className="panel" style={{ padding: 16, gap: 8, borderColor: focused ? 'var(--focus)' : e.ok ? undefined : 'var(--red-ink)' }}>
      <div className="row" style={{ gap: 10 }}>
        <span className={`badge ${e.ok ? 'badge-now' : 'badge-block'}`}>{e.ok ? t('ui.audit.ok') : t('ui.audit.error')}{e.code ? ` ${e.code}` : ''}</span>
        <span className="badge badge-quiet">{typeof kind === 'string' ? kind : t(kind.key)}</span>
        {whoOf(e) === 'persona' && <span className="badge badge-now">{t('ui.audit.badge.persona')}</span>}
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
      {e.actor === 'persona' && (
        <div className="small" style={{ display: 'grid', gap: 4 }}>
          {door && <span className="faint">{t('ui.audit.door', { door: 'key' in door ? t(door.key) : door.raw })}</span>}
          {e.said && <span>{t('ui.audit.said', { said: e.said })}</span>}
          {approvedOwn(e) && <span>{t('ui.audit.ownProposal')}</span>}
          {basis && (
            <details>
              <summary>{t('ui.audit.basis')}</summary>
              <div className="mono small muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {[t('ui.audit.basis.subject', { subject: basis.subject }), ...basis.reads, ...(basis.message !== null ? [t('ui.audit.basis.message', { n: basis.message })] : [])].join('\n')}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export function Auditoria({ go, act }: { go: (s: Screen) => void; act?: string }) {
  const t = useT();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState('');
  // A link from the chat opens the list at the entries of one act, whoever wrote them; the filters are the person's own once they change.
  const [who, setWho] = useState<WhoFilter>('all');

  const load = () => api.invoke<AuditEntry[]>('auditoria:list').then(setRows, (e) => setError(errorText(e)));
  useEffect(() => void load(), []);

  const shown = useMemo(() => filterEntries(rows ?? [], { issue, who }), [rows, issue, who]);
  const target = indexOfAct(shown, act);

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 16 }}>
        <header className="row" style={{ gap: 14 }}>
          <button type="button" className="btn icon-btn" aria-label={t('ui.nav.backToday')} onClick={() => go(HOME)}><BackIcon /></button>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.audit.title')}</h1>
          <span className="faint">{rows ? t('ui.audit.shownOf', { shown: shown.length, total: rows.length }) : ''}</span>
          <label className="row small faint" style={{ marginLeft: 'auto', gap: 8 }}>
            {t('ui.audit.who.label')}
            <select value={who} onChange={(e) => isWhoFilter(e.target.value) && setWho(e.target.value)} style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--field-line)' }} /* i18n-ignore */>
              {WHO_FILTERS.map((w) => <option key={w} value={w}>{t(WHO_LABEL[w])}</option>)}
            </select>
          </label>
          <input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder={t('ui.audit.filterPlaceholder')}
            aria-label={t('ui.audit.filterLabel')}
            style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--field-line)', minWidth: 220 }} /* i18n-ignore */
          />
          <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => void load()}>{t('ui.audit.refresh')}</button>
        </header>
        {error && <div className="error">{error}</div>}
        {act && rows && target < 0 && <p className="small faint">{t('ui.audit.actOlder')}</p>}
        {!rows && !error && <div className="row faint"><span className="spinner" /> {t('ui.audit.loading')}</div>}
        {rows && !shown.length && <p className="small faint">{rows.length ? t('ui.audit.noneForIssue') : t('ui.audit.none')}</p>}
        {shown.map((e, i) => <Row key={`${e.at}-${i}`} e={e} focused={i === target} />)}
      </div>
    </div>
  );
}
