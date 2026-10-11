import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { mentionJob } from '../../../../shared/activity';
import type { PushTarget } from '../../../../shared/push';
import { buildTree, hasWork } from '../../activityTreeModel';
import { bubblesOf, composerState, queuedOf, rowKind, workOf } from '../../chatModel';
import { useCycle } from '../../cycleApi';
import { useT } from '../../i18n';
import { useActivity } from '../../useActivity';
import { agentName } from '../cycle/names';
import { useIsPhone } from '../../useIsPhone';
import { useLiveAnswers } from '../../liveApi';
import { usePersonaState } from '../../personaStopApi';
import { answerGoing } from '../../personaStopModel';
import { AskCards } from '../cycle/AskCard';
import { Composer } from '../cycle/Composer';
import { LiveScreen } from '../cycle/LiveScreen';
import { OfferCards } from '../cycle/OfferCards';
import { ScreenStrip } from '../cycle/ScreenStrip';
import { asksOf } from '../cycle/askView';
import { markThreadSeen, useThread } from '../cycle/forumApi';
import { screenOfCall } from '../cycle/screens';
import { useScreens } from '../cycle/useScreens';
import { ActRow, AgentBubble, AnswerBubble, LiveBubble, PendingBubble, PersonBubble, SystemLine } from './ChatMessage';
import './chat.css';

interface Props {
  /** The persona's conversation (`agent-<id>`). */
  thread: string;
  /** Who answers in it: the persona, or its test draft. */
  persona: AgentDef;
  team: readonly AgentDef[] | undefined;
  /** The wizard's test: the same conversation without the cards of procedures and screens. The buttons are never offered in a test (the draft has no tool for them). */
  compact?: boolean;
  /** A tap on the button of an answer: opens that screen on this device. Absent: the buttons are not drawn. */
  onOpen?: (target: PushTarget) => void;
  /** Pinned between the conversation and the box: the ceremony card of the home. */
  above?: ReactNode;
}

/**
 * The persona's conversation: the stored messages as bubbles, the answer being written, the Work above each answer, the buttons under it, and the box. One continuous
 * conversation with no list and no new chat. The same component is the home's chat and the test of the wizard (`compact`), so a person tries exactly what they will use.
 */
export function ChatThread({ thread, persona, team, compact = false, onOpen, above }: Props) {
  const t = useT();
  const phone = useIsPhone();
  const cycle = useCycle();
  const stored = useThread(thread);
  const entries = useActivity(mentionJob(thread));
  const roots = useMemo(() => buildTree(entries), [entries]);
  const writing = useLiveAnswers(thread);
  // The wizard's test copy is never stopped: it cannot act.
  const stopped = usePersonaState().stopped && !compact;
  const screens = useScreens(thread);
  const asks = useMemo(() => asksOf(screens), [screens]);
  const [watching, setWatching] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const messages = stored.messages;
  const last = messages.at(-1)?.seq ?? 0;
  const ceremony = cycle?.preDailyLabel ?? t('ui.today.preDaily');
  const name = agentName([persona], persona.id);

  const queued = useMemo(() => queuedOf(entries, thread, persona.id), [entries, thread, persona.id]);
  const bubbles = bubblesOf(writing, messages);
  const answered = new Set(messages.filter((m) => m.answersTo !== undefined).map((m) => m.answersTo));
  const shown = new Set(bubbles.map((b) => b.to));
  // A call at work that has written nothing yet (thinking, or using a tool) and is not waiting its turn: it has its Work section and Stop, and no text.
  const pending = roots.filter((r) => r.call?.agent === persona.id && hasWork(r) && !answered.has(r.call.message) && !shown.has(r.call.message) && !queued.has(r.call.message));
  // A stopped persona runs nothing: what is listed waits for Resume, and the banner says so.
  const going = answerGoing({ going: composerState(writing, roots, persona.id).going, stopped });

  // What is on screen is read: the conversation counts as seen up to its last message. A test conversation is nobody's unread.
  useEffect(() => {
    if (!compact && last) markThreadSeen(thread, last);
  }, [compact, thread, last]);

  const tail = bubbles.map((b) => b.text.length).join(',') + pending.length;
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, last, tail]);

  const empty = !stored.loading && !stored.missing && messages.length === 0 && bubbles.length === 0 && pending.length === 0;
  const screen = screenOfCall(screens, thread, persona.id);

  return (
    <section className={`chat ${compact ? 'chat-compact' : ''}`} aria-label={t('ui.chat.log', { agent: name })}>
      {stored.loading && <span className="spinner" aria-label={t('ui.forum.loading')} />}
      {stored.missing && <p className="small muted">{t('ui.forum.missing')}</p>}
      {empty && <p className="chat-empty muted">{t('ui.chat.empty', { agent: name })}</p>}
      <ol
        ref={list}
        className="chat-log"
        role="log"
        aria-label={t('ui.forum.messages')}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.map((m) => {
          const kind = rowKind(m, persona.id);
          if (kind === 'system') return <SystemLine key={m.seq} m={m} />;
          if (kind === 'act') return <ActRow key={m.seq} m={m} ceremony={ceremony} onOpen={compact ? undefined : onOpen} />;
          if (kind === 'person') return <PersonBubble key={m.seq} m={m} waiting={queued.has(m.seq)} stopped={stopped} />;
          if (kind === 'agent') return <AgentBubble key={m.seq} m={m} team={team} />;
          return <AnswerBubble key={m.seq} m={m} team={team} work={m.answersTo !== undefined ? workOf(roots, m.answersTo, persona.id) : null} ceremony={ceremony} onOpen={compact ? undefined : onOpen} />;
        })}
        {[...bubbles.map((b) => ({ to: b.to, text: b.text as string | null })), ...pending.map((r) => ({ to: r.call?.message ?? 0, text: null }))]
          .sort((a, b) => a.to - b.to)
          .map(({ to, text }) => {
            const work = workOf(roots, to, persona.id);
            if (text !== null) return <LiveBubble key={`live-${to}`} text={text} thread={thread} agent={persona.id} team={team} work={work} screen={screen} onWatch={setWatching} />;
            return work ? <PendingBubble key={`pending-${to}`} thread={thread} agent={persona.id} team={team} work={work} screen={screen} onWatch={setWatching} /> : null;
          })}
      </ol>
      {!compact && <AskCards asks={asks} team={team} onWatch={setWatching} />}
      {!compact && <OfferCards thread={thread} team={team} />}
      {!compact && <ScreenStrip screens={screens} team={team} onWatch={setWatching} />}
      {above}
      <Composer
        thread={thread}
        team={team}
        note={going ? t('ui.chat.willWait') : null}
        mentions={false}
        enterSends={!phone}
        autoFocus={!phone && !compact}
        className="composer"
        hint={phone ? t('ui.chat.hint.phone') : t('ui.chat.hint.desktop')}
        placeholder={t('ui.chat.placeholder', { agent: name })}
        onSent={() => {
          stick.current = true;
        }}
      />
      {watching && <LiveScreen screenKey={watching} state={screens.find((x) => x.key === watching) ?? null} asks={asks.filter((a) => a.key === watching)} team={team} canClose onClose={() => setWatching(null)} />}
    </section>
  );
}
