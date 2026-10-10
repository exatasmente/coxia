import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { OpenScreenInfo } from '../../../../shared/browser';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { agentName } from './names';
import { screenApi } from './screenApi';
import { closesInMinutes } from './screens';
import { useNow } from './useScreens';

// The agents' open screens of a conversation, in a strip above the message box: who has one, when it closes by itself, Watch to open the viewer and Close to end it. Both are
// open to a paired browser (Close only takes capability away); nothing here moves the screen, which is the viewer's, on the computer.

/** The words about when a screen closes: "in use" while something keeps it open, else the minutes left. */
export function ClosesIn({ closesAt, now }: { closesAt: string | null; now: number }) {
  const t = useT();
  const minutes = closesInMinutes(closesAt, now);
  return <span className="faint small cy-screen-closes">{minutes === null ? t('ui.screen.inUse') : t('ui.screen.closesIn', { count: minutes })}</span>;
}

function Item({ screen, team, now, onWatch }: { screen: OpenScreenInfo; team: readonly AgentDef[] | undefined; now: number; onWatch: (key: string) => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = agentName(team, screen.agent);
  const close = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await screenApi.close(screen.key);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };
  return (
    <li className="cy-screen">
      <div className="row cy-screen-row">
        <strong className="cy-screen-agent">{name}</strong>
        <ClosesIn closesAt={screen.closesAt} now={now} />
        {screen.pending.length > 0 && <span className="badge cy-tone-person">{t('ui.screen.asking', { count: screen.pending.length })}</span>}
        <span className="cy-screen-actions">
          <button type="button" className="btn cy-mini" onClick={() => onWatch(screen.key)}>{t('ui.screen.watch')}</button>
          <button type="button" className="btn cy-mini" disabled={busy} aria-label={t('ui.screen.closeAria', { agent: name })} onClick={() => void close()}>{t('ui.screen.close')}</button>
        </span>
      </div>
      {error && <p className="small error" role="alert">{error}</p>}
    </li>
  );
}

/** The open screens of the conversation; nothing at all while there are none. */
export function ScreenStrip({ screens, team, onWatch }: { screens: readonly OpenScreenInfo[]; team: readonly AgentDef[] | undefined; onWatch: (key: string) => void }) {
  const t = useT();
  const now = useNow(30_000);
  if (screens.length === 0) return null;
  return (
    <ul className="cy-screens" aria-label={t('ui.screen.strip')}>
      {screens.map((s) => <Item key={s.key} screen={s} team={team} now={now} onWatch={onWatch} />)}
    </ul>
  );
}
