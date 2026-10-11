import { useId, useMemo, useState } from 'react';
import type { ReleaseAction } from '../../../../shared/types';
import type { AgentDef } from '../../../../shared/config/types';
import { agentThreadId } from '../../../../shared/forum';
import type { PushTarget } from '../../../../shared/push';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { Chevron } from '../../ActivityTree';
import { cardOpen, cardParts } from '../../chatModel';
import { useCycle } from '../../cycleApi';
import { OVERVIEW, ceremonyCard, homeCounts } from '../../home';
import { useT } from '../../i18n';
import { bannerView } from '../../personaStopModel';
import { usePersonaState } from '../../personaStopApi';
import { targetToScreen } from '../../pushTarget';
import { useIsPhone } from '../../useIsPhone';
import { useWatcherAlerts } from '../../watchersApi';
import type { AgoraPlan } from '../../dashboard';
import { AgoraCard } from '../TodayParts';
import { useRuns } from '../cycle/runsApi';
import { useAgora } from '../useAgora';
import { ChatHeader } from './ChatHeader';
import { ChatThread } from './ChatThread';
import { StatusStrip } from './StatusStrip';
import './chat.css';

// The chat that is the home: the header, the strip of counts, the conversation with the persona, the ceremony card when there is something to say, and the box. The ceremony
// state belongs to the app (useCeremony) and is only read here; a ceremony started from this screen is held in its own screens, as before.

interface Props {
  ceremony: Ceremony;
  go: (s: Screen) => void;
  persona: AgentDef | null;
  team: readonly AgentDef[] | undefined;
  actions: ReleaseAction[];
}

/**
 * The ceremony card pinned above the box. On the computer it is the Agora card in full; on a phone it is one line (what it is, in a word) that opens the card when tapped,
 * so the conversation keeps most of the height of a small screen.
 */
function CeremonyCard({ plan, onAction }: { plan: AgoraPlan; onAction: (a: AgoraPlan['primary']['action']) => void }) {
  const t = useT();
  const phone = useIsPhone();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const body = useId();
  const open = cardOpen(phone, chosen);
  return (
    <div className="chat-card">
      {phone && (
        <button type="button" className="chat-card-chip" aria-expanded={open} aria-controls={body} onClick={() => setChosen(!open)}>
          <Chevron open={open} />
          <span className="chat-card-chip-label">{t('ui.today.now')}</span>
          <span className="chat-card-chip-title">{plan.title}</span>
          {plan.progress && <span className="chat-card-chip-progress small">{plan.progress}</span>}
        </button>
      )}
      {open && (
        <div id={body}>
          <AgoraCard plan={plan} onAction={onAction} bare={!cardParts(phone).head} />
        </div>
      )}
    </div>
  );
}

/** The banner over the box while the persona is stopped: what it means for the messages the person writes now. */
function StoppedBanner() {
  const t = useT();
  const view = bannerView(usePersonaState());
  if (!view.shown) return null;
  return (
    <div className="persona-banner" role="status">
      <span>{t('ui.persona.banner')}</span>
      {view.waiting > 0 && <span className="persona-banner-waiting">{t('ui.persona.banner.waiting', { count: view.waiting })}</span>}
    </div>
  );
}

export function ChatScreen({ ceremony: c, go, persona, team, actions }: Props) {
  const t = useT();
  const cycle = useCycle();
  const runs = useRuns();
  const { alerts } = useWatcherAlerts();
  const { plan, onAgora } = useAgora(c, go);
  const cards = useMemo(() => c.cards?.cards ?? [], [c.cards]);
  const counts = useMemo(() => homeCounts({ cards, turns: c.turns, answered: c.answered, runs, actions, alerts }), [cards, c.turns, c.answered, runs, actions, alerts]);
  const card = ceremonyCard(plan, cycle?.ceremonies);

  // A tap on a button of an answer opens that screen on this device only.
  const open = (target: PushTarget): void => {
    const next = targetToScreen(target, !!c.cards);
    if (next) go(next);
  };

  return (
    <div className="chat-page">
      <ChatHeader persona={persona} go={go} ceremony={c} />
      <StatusStrip counts={counts} go={go} />
      {c.cardsError && <div className="error">{t('ui.today.cardsError', { error: c.cardsError })}</div>}
      {persona ? (
        <ChatThread
          thread={agentThreadId(persona.id)}
          persona={persona}
          team={team}
          onOpen={open}
          above={
            <>
              {card ? <CeremonyCard plan={card} onAction={onAgora} /> : null}
              <StoppedBanner />
            </>
          }
        />
      ) : (
        <div className="panel chat-none" role="status">
          <p>{t('ui.chat.noPersona.body')}</p>
          <div className="wz-actions">
            <button type="button" className="btn btn-dark" onClick={() => go({ name: 'settings' })}>{t('ui.chat.noPersona.settings')}</button>
            <button type="button" className="btn" onClick={() => go(OVERVIEW)}>{t('ui.chat.menu.overview')}</button>
          </div>
          {card && <AgoraCard plan={card} onAction={onAgora} />}
        </div>
      )}
    </div>
  );
}
