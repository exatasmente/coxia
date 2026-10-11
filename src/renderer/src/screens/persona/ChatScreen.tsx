import type { ReleaseAction } from '../../../../shared/types';
import type { AgentDef } from '../../../../shared/config/types';
import { agentThreadId } from '../../../../shared/forum';
import type { PushTarget } from '../../../../shared/push';
import type { Screen } from '../../App';
import type { Ceremony } from '../../ceremony';
import { useCycle } from '../../cycleApi';
import { HOME, OVERVIEW, ceremonyCard } from '../../home';
import { useT } from '../../i18n';
import { openButton } from '../../openButton';
import { bannerView } from '../../personaStopModel';
import { usePersonaState } from '../../personaStopApi';
import type { AgoraPlan } from '../../dashboard';
import { AgoraCard } from '../TodayParts';
import { useAgora } from '../useAgora';
import { ChatHeader } from './ChatHeader';
import { ChatThread } from './ChatThread';
import { HomeShell } from './HomeShell';
import { NavIcon } from './navIcons';
import './chat.css';

// The chat that is the home: the navigation beside it (a sheet on the phone), the header, the conversation with the persona taking the height, the ceremony bar when there is
// something to say, and the box. The ceremony state belongs to the app (useCeremony) and is only read here; a ceremony started from this screen is held in its own screens.

interface Props {
  ceremony: Ceremony;
  go: (s: Screen) => void;
  persona: AgentDef | null;
  team: readonly AgentDef[] | undefined;
  actions: ReleaseAction[];
}

/**
 * The ceremony as one line above the box: what it is, where it stands, and its buttons. The accent is kept for a ceremony that waits to start or is being held; an ended one
 * is told quietly, since the conversation is what the person came for.
 */
function CeremonyBar({ plan, onAction }: { plan: AgoraPlan; onAction: (a: AgoraPlan['primary']['action']) => void }) {
  const t = useT();
  const loud = plan.phase === 'ready' || plan.phase === 'live';
  return (
    <section className={`chat-cer ${loud ? 'chat-cer-loud' : ''}`} aria-label={t('ui.today.now')}>
      <span className="chat-cer-icon"><NavIcon id="call" /></span>
      <div className="chat-cer-text">
        <span className="chat-cer-title" title={plan.title}>{plan.title}</span>
        {plan.progress && <span className="chat-cer-progress" aria-live="polite" title={plan.progress}>{plan.progress}</span>}
        {plan.hint && <span className="chat-cer-detail" title={plan.hint}>{plan.hint}</span>}
      </div>
      <div className="chat-cer-actions">
        <button type="button" className={`btn ${loud ? 'btn-accent' : ''}`} disabled={plan.primary.disabled} onClick={() => onAction(plan.primary.action)}>
          {plan.primary.label}
        </button>
        {plan.secondary.map((b) => (
          <button key={b.action} type="button" className="btn" disabled={b.disabled} onClick={() => onAction(b.action)}>
            {b.label}
          </button>
        ))}
      </div>
    </section>
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
  const { plan, onAgora } = useAgora(c, go);
  const card = ceremonyCard(plan, cycle?.ceremonies);

  // A tap on a button of an answer opens that screen on this device only.
  const open = (target: PushTarget): void => {
    if (persona) openButton(target, { thread: agentThreadId(persona.id), hasCards: !!c.cards, back: HOME, go });
  };

  return (
    <HomeShell go={go} ceremony={c} actions={actions} current="chat" persona={!!persona}>
      <div className="chat-page">
        <ChatHeader persona={persona} go={go} ceremony={c} actions={actions} current="chat" />
        {c.cardsError && <div className="error">{t('ui.today.cardsError', { error: c.cardsError })}</div>}
        {persona ? (
          <ChatThread
            thread={agentThreadId(persona.id)}
            persona={persona}
            team={team}
            onOpen={open}
            above={
              <>
                {card ? <CeremonyBar plan={card} onAction={onAgora} /> : null}
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
    </HomeShell>
  );
}
