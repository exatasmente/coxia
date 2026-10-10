import { useState } from 'react';
import type { ProfileSite, RevokeResult, SitesResult } from '../../../../shared/browser';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { SITES_REFUSAL_LABEL } from './labels';
import { teamApi } from './teamApi';
import { Confirm } from './ui';

// The sessions an agent's logged-in browser keeps, site by site, and the revoking of one or all. The computer's own: the channels are refused to a paired browser, and the
// panel is not drawn there. It shows counts and never a value or the name of a cookie. Listing starts the app's browser on the closed profile, so it waits for the person to
// ask; both are refused while the agent's screen is open.

/** The sites of a profile, each with the counts it holds and a Revoke; presentational, so the panel and the tests draw the same list. */
export function SitesList({ sites, busy, onRevoke }: { sites: readonly ProfileSite[]; busy: boolean; onRevoke: (site: string) => void }) {
  const t = useT();
  if (sites.length === 0) return <p className="small muted">{t('ui.team.sessions.none')}</p>;
  return (
    <ul className="team-allowed" aria-label={t('ui.team.sessions.title')}>
      {sites.map((s) => (
        <li key={s.site} className="row spread">
          <span>
            <code>{s.site}</code> <span className="faint small">{t('ui.team.sessions.counts', { cookies: s.cookies, storage: s.storage })}</span>
          </span>
          <button type="button" className="btn" disabled={busy} aria-label={t('ui.team.sessions.revokeAria', { site: s.site })} onClick={() => onRevoke(s.site)}>{t('ui.team.sessions.revoke')}</button>
        </li>
      ))}
    </ul>
  );
}

/** The sites of an agent's logged-in browser. `agent` is the id of an agent that is saved: the main process refuses one it does not know. */
export function SessionsPanel({ agent, name }: { agent: string; name: string }) {
  const t = useT();
  const [sites, setSites] = useState<readonly ProfileSite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refuse = (r: Extract<SitesResult | RevokeResult, { ok: false }>): void => setError(t(SITES_REFUSAL_LABEL[r.why]));
  const run = async (job: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };
  const look = (): Promise<void> =>
    run(async () => {
      const r = await teamApi.sites(agent);
      if (r.ok) setSites(r.sites);
      else refuse(r);
    });
  const revoke = (site?: string): Promise<void> =>
    run(async () => {
      setAsking(false);
      const r = await teamApi.revoke(agent, site);
      if (!r.ok) {
        refuse(r);
        return;
      }
      setSites(r.sites);
      setMessage(t(site ? 'ui.team.sessions.done' : 'ui.team.sessions.doneAll'));
    });

  return (
    <fieldset className="wz-fieldset">
      <legend className="wz-label">{t('ui.team.sessions.title')}</legend>
      <p className="small muted">{t('ui.team.sessions.hint')}</p>
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void look()}>{busy && sites === null ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.team.sessions.look')}</button>
        <button type="button" className="btn tm-danger" disabled={busy} onClick={() => setAsking(true)}>{t('ui.team.sessions.revokeAll')}</button>
      </div>
      {asking && (
        <Confirm danger confirmLabel={t('ui.team.sessions.revokeAllYes')} onConfirm={() => void revoke()} onCancel={() => setAsking(false)}>
          <p>{t('ui.team.sessions.revokeAllAsk', { agent: name })}</p>
        </Confirm>
      )}
      {sites !== null && <SitesList sites={sites} busy={busy} onRevoke={(site) => void revoke(site)} />}
      {message && <p className="small" role="status">{message}</p>}
      {error && <div className="tm-field-error small" role="alert">{error}</div>}
    </fieldset>
  );
}
