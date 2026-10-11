import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import type { OpenScreenInfo } from '../../../../shared/browser';
import { type ForumMessage, MAX_MENTIONS, type MessageKind, messageText } from '../../../../shared/forum';
import type { PushTarget } from '../../../../shared/push';
import { Buttons } from '../persona/ChatMessage';
import { type QuestionChain, commandRound, groupThread } from '../../../../shared/forumView';
import { type Run, canSendBack } from '../../../../shared/runs';
import { mentionJob } from '../../../../shared/activity';
import { type CallGroup, callGroups, stepText } from '../../activity';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { useActivity } from '../../useActivity';
import { RichText } from '../Diagram';
import { ArtifactView } from './ArtifactView';
import { MessageAttachments } from './Attachments';
import { AskCards } from './AskCard';
import { Composer } from './Composer';
import { EvidenceAttachment } from './Evidence';
import { LiveScreen } from './LiveScreen';
import { OfferCards } from './OfferCards';
import { ScreenStrip } from './ScreenStrip';
import { agentName, agentRole, authorName } from './names';
import { forumApi, forgetNow, markThreadSeen, useThread } from './forumApi';
import { asksOf, isHandoff } from './askView';
import { screenApi } from './screenApi';
import { screenOfCall } from './screens';
import { useScreens } from './useScreens';
import './cycle.css';

const KIND_KEY: Record<MessageKind, string> = {
  post: 'ui.forum.kind.post',
  question: 'ui.forum.kind.question',
  answer: 'ui.forum.kind.answer',
  handoff: 'ui.forum.kind.handoff',
  decision: 'ui.forum.kind.decision',
  system: 'ui.forum.kind.system',
  request: 'ui.forum.kind.request',
};

const REQUEST_KIND_KEY = { question: 'ui.forum.request.question', change: 'ui.forum.request.change' } as const;

function stamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface Ctx {
  team: readonly AgentDef[] | undefined;
  runId: string | null;
  /** The calls still going, by the message that named the agents: what each message shows under itself. */
  calls: ReadonlyMap<number, readonly CallGroup[]>;
  /** The open screens of the thread: a call that has one offers to watch it. */
  screens: readonly OpenScreenInfo[];
  /** Opens the viewer of a screen. */
  watch: (key: string) => void;
  view: (name: string) => void;
  /** Deletes a message and the files it carried: the store records the removal and the files go with it. */
  remove: (m: ForumMessage) => void;
  /** A tap on a button an agent's answer offers (the discussions of a merge request); absent, the buttons are not drawn. */
  open?: (target: PushTarget) => void;
}

function useTarget(team: readonly AgentDef[] | undefined): (to: string | null) => string {
  const t = useT();
  return (to) => (!to || to === 'person' ? t('ui.forum.to.person') : to === 'reporter' ? t('ui.forum.to.reporter') : agentName(team, to));
}

/** One call still going under the message that named the agent: it says the call works (or waits its turn), then shows its live step, offers to watch the screen the agent has and to stop the answer. It is not a message. */
export function CallLine({ group, team, screen, onWatch }: { group: CallGroup; team: readonly AgentDef[] | undefined; screen?: OpenScreenInfo; onWatch: (key: string) => void }) {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const state = group.entry.state;
  const label = state === 'queued' ? t('activity.queued') : state === 'started' ? t('activity.call.working') : stepText(group.entry, t('activity.thought'));
  // A call that still waits its turn has no answer to stop yet: the main process would refuse, so the button is not offered.
  const queued = group.entries.findLast((e) => e.kind === 'status')?.state === 'queued';
  const name = agentName(team, group.agent);
  const stop = (): void => {
    setStopping(true);
    void screenApi.stop(group.thread, group.agent).then(() => undefined, () => undefined).finally(() => setStopping(false));
  };
  return (
    <p className="cy-call" role="status">
      <span className="spinner" aria-hidden="true" />
      <strong className="cy-call-agent">{name}</strong>
      <span className="cy-call-step">{label}</span>
      {screen?.pending.some(isHandoff) && <span className="badge cy-tone-person">{t('ui.screen.handoff.callBadge')}</span>}
      <span className="cy-call-actions">
        {screen && <button type="button" className="btn cy-mini" onClick={() => onWatch(screen.key)}>{t('ui.screen.watch')}</button>}
        {!queued && <button type="button" className="btn cy-mini" disabled={stopping} aria-label={t('ui.screen.stopAria', { agent: name })} onClick={stop}>{t('ui.screen.stop')}</button>}
      </span>
    </p>
  );
}

/** One message: who said it, of what kind, whether it is a public record and where it was posted, then its text and the documents it points to. */
function Message({ m, ctx, inChain = false }: { m: ForumMessage; ctx: Ctx; inChain?: boolean }) {
  const t = useT();
  const to = useTarget(ctx.team);
  if (m.kind === 'system') {    return (
      <li className="cy-msg cy-msg-system" id={`msg-${m.seq}`}>
        <span className="cy-msg-system-text">{messageText(m)}</span>
        <time className="faint small" dateTime={m.at}>{stamp(m.at)}</time>
      </li>
    );
  }
  const who = authorName(m.author, ctx.team);
  const role = m.author.type === 'agent' ? agentRole(ctx.team, m.author.id, 48) : '';
  const params = m.params as Record<string, string | number>;
  return (
    <li className={`cy-msg cy-msg-${m.author.type} ${inChain ? 'cy-msg-chain' : ''}`} id={`msg-${m.seq}`}>
      <div className="cy-msg-head">
        <strong className="cy-msg-who">{who}</strong>
        {role && <span className="faint small cy-role">{role}</span>}
        <span className={`badge cy-kind cy-kind-${m.kind}`}>{t(KIND_KEY[m.kind])}</span>
        <span className={`badge ${m.public ? 'cy-pub' : 'cy-int'}`} title={t(m.public ? 'ui.forum.publicHint' : 'ui.forum.internalHint')}>{t(m.public ? 'ui.forum.public' : 'ui.forum.internal')}</span>
        <time className="faint small cy-msg-time" dateTime={m.at}>{stamp(m.at)}</time>
        <button type="button" className="cy-link cy-msg-remove" aria-label={t('ui.forum.remove', { n: m.seq })} title={t('ui.forum.remove')} onClick={() => ctx.remove(m)}>
          {t('ui.forum.removeLabel')}
        </button>
      </div>
      {(m.to || m.replyTo) && (
        <p className="faint small">
          {m.to ? t('ui.forum.addressed', { who: to(m.to) }) : ''}
          {m.to && m.replyTo ? ' · ' : ''}
          {m.replyTo ? t('ui.forum.replyTo', { n: m.replyTo }) : ''}
        </p>
      )}
      {m.kind === 'request' && (
        <p className="small cy-request-line">{t('ui.forum.request.line', { from: String(params.from ?? ''), squad: String(params.squad ?? ''), kind: t(REQUEST_KIND_KEY[params.kind === 'change' ? 'change' : 'question']), ref: String(params.ref ?? '') })}</p>
      )}
      <div className="cy-msg-text">
        <RichText text={messageText(m)} />
      </div>
      {(m.evidence?.length ?? 0) > 0 && ctx.runId && (
        <p className="cy-evidence-attachments">
          {m.evidence?.map((a) => <EvidenceAttachment key={a.id} runId={ctx.runId as string} attachment={a} />)}
        </p>
      )}
      {/* The button stays here, with its target, until someone taps it: nothing opens by itself, and no one's window moves. */}
      {ctx.open && m.author.type === 'agent' && m.buttons && <Buttons targets={m.buttons} ceremony="" onOpen={ctx.open} />}
      {(ctx.calls.get(m.seq) ?? []).map((g) => <CallLine key={g.runId} group={g} team={ctx.team} screen={screenOfCall(ctx.screens, g.thread, g.agent)} onWatch={ctx.watch} />)}
      {m.author.type === 'person' && m.mentions.length > 0 && (
        <>
          <p className="faint small">{t('ui.forum.mentions', { agents: m.mentions.slice(0, MAX_MENTIONS).map((id) => agentName(ctx.team, id)).join(', ') })}</p>
          {m.mentions.length > MAX_MENTIONS && <p className="faint small">{t('ui.forum.mentionsOverLimit', { agents: m.mentions.slice(MAX_MENTIONS).map((id) => agentName(ctx.team, id)).join(', ') })}</p>}
        </>
      )}
      {m.refs.length > 0 && ctx.runId && (
        <ul className="cy-artifacts" aria-label={t('ui.forum.refs')}>
          {m.refs.map((r) => (
            <li key={r.path}>
              <button type="button" className="cy-file mono" onClick={() => ctx.view(r.path)}>{r.label ?? r.path}</button>
            </li>
          ))}
        </ul>
      )}
      {/* A person's files live in every conversation, run thread or not: they are not documents of a run. */}
      <MessageAttachments thread={m.thread} message={m.seq} refs={m.attachments} />
      {m.published && (
        <p className="small cy-published">
          {m.published.url ? <a href={m.published.url} target="_blank" rel="noreferrer">{t('ui.forum.published', { target: t(m.published.target === 'mr' ? 'ui.forum.target.mr' : 'ui.forum.target.issue') })}</a> : t('ui.forum.published', { target: t(m.published.target === 'mr' ? 'ui.forum.target.mr' : 'ui.forum.target.issue') })}
        </p>
      )}
    </li>
  );
}

/**
 * A round of commands, folded: one line that says who ran how many, opened to read each command and its output. It opens by itself while the last command still
 * waits for the person, so what is asked of them is never hidden.
 */
function Commands({ agent, messages, ctx }: { agent: string; messages: ForumMessage[]; ctx: Ctx }) {
  const t = useT();
  const { ran, waiting } = commandRound(messages);
  const last = messages[messages.length - 1];
  return (
    <li className="cy-msg cy-msg-system cy-cmds" id={`msg-${messages[0].seq}`}>
      <details open={waiting}>
        <summary className="cy-cmds-head">
          <span className="cy-msg-system-text">
            {ran ? t('ui.forum.commands.summary', { agent: agentName(ctx.team, agent), count: ran }) : t('ui.forum.commands.none', { agent: agentName(ctx.team, agent) })}
            {waiting ? ` · ${t('ui.forum.commands.waiting')}` : ''}
          </span>
          <time className="faint small" dateTime={last.at}>{stamp(last.at)}</time>
        </summary>
        <ol className="cy-msgs cy-msgs-inner">
          {messages.map((m) => <Message key={m.seq} m={m} ctx={ctx} />)}
        </ol>
      </details>
    </li>
  );
}

/** The way a question went: who asked whom, each time it was passed on, and why it reached the person; the messages that tell it are inside. */
function Chain({ chain, messages, ctx }: { chain: QuestionChain; messages: ForumMessage[]; ctx: Ctx }) {
  const t = useT();
  const to = useTarget(ctx.team);
  const asker = authorName(chain.asker, ctx.team);
  const route = [asker, to(chain.first), ...chain.steps.map((s) => to(s.to))];
  // The asker is the first name; the path is each holder in turn.
  const path = chain.asker.type === 'app' ? route.slice(1) : route;
  return (
    <li className={`cy-chain ${chain.open ? 'cy-chain-open' : ''}`} aria-label={t('ui.forum.chain.title')}>
      <div className="cy-chain-head">
        <span className="section-title">{t('ui.forum.chain.title')}</span>
        <span className={`badge ${chain.open ? 'cy-tone-person' : 'cy-tone-done'}`}>
          {chain.open ? t(chain.reachedPerson ? 'ui.forum.chain.openPerson' : 'ui.forum.chain.openAgent', { who: to(chain.holder) }) : t('ui.forum.chain.answered', { who: chain.answer ? authorName(chain.answer.author, ctx.team) : '' })}
        </span>
      </div>
      <p className="cy-chain-path small" aria-label={t('ui.forum.chain.path')}>
        {path.join(' → ')}
        {chain.steps.length > 0 && <span className="faint"> · {t('ui.forum.chain.hops', { count: chain.steps.length })}</span>}
      </p>
      {chain.reachedPerson && chain.why && <p className="small cy-chain-why">{t('ui.forum.chain.why', { reason: chain.why })}</p>}
      <ol className="cy-msgs cy-msgs-inner">
        {messages.map((m) => <Message key={m.seq} m={m} ctx={ctx} inChain />)}
      </ol>
    </li>
  );
}

/** What deleting a message is asked first, because the files it carried go with it and cannot be brought back. */
function RemoveMessage({ target, onClose, onDone }: { target: ForumMessage; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = target.attachments.length;
  return (
    <div className="cy-confirm" role="dialog" aria-modal="true" aria-label={t('ui.forum.remove')}>
      <p>
        {t('ui.forum.removeAsk', { n: target.seq })}
        {files > 0 && ` ${t('ui.forum.removeFiles', { count: files })}`}
      </p>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row spread">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>{t('ui.forum.removeCancel')}</button>
        <button
          type="button"
          className="btn btn-dark"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void forumApi.attachmentDelete(target.thread, target.seq).then(
              (ok) => {
                setBusy(false);
                if (!ok) {
                  setError(t('ui.forum.removeFailed'));
                  return;
                }
                onDone();
              },
              (e: unknown) => {
                setBusy(false);
                setError(errorText(e));
              },
            );
          }}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.forum.removeConfirm')}
        </button>
      </div>
    </div>
  );
}

interface Props {
  /** The thread's id (`run-<id>`, a channel, a general thread). */
  thread: string;
  /** The run the thread belongs to: its documents open from the messages, and a question that waits changes what the box says. */
  run?: Run | null;
  team: readonly AgentDef[] | undefined;
  title?: string;
  /** Opens the form that sends the run back to a stage (the run screen's): offered next to the box while a mention is typed and the run can be sent back. */
  onSendBack?: () => void;
  /** The run screen shows the requests to hand a screen over at its top (RunHandoff), so this thread leaves them out of its list of questions. */
  handoffAbove?: boolean;
  /** A tap on a button an agent's answer offers; absent (the wizard's test), the buttons are not drawn. */
  onOpen?: (target: PushTarget) => void;
}

/** A thread read and written: messages by kind with their author and where they stand, the chain of each question, live, and the box to write in. */
export function Thread({ thread, run = null, team, title, onSendBack, handoffAbove = false, onOpen }: Props) {
  const t = useT();
  const live = useThread(thread);
  const runId = run?.id ?? null;
  // A run's thread reads the run's activity; any other conversation reads its own, where the mentions module keeps its calls.
  const activity = useActivity(runId ? `run:${runId}` : mentionJob(thread));
  const [viewing, setViewing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ForumMessage | null>(null);
  // The agents' open screens of this thread, and the one whose viewer is open (it stays open when the screen goes, to say so).
  const screens = useScreens(thread);
  const [watching, setWatching] = useState<string | null>(null);
  const asks = useMemo(() => asksOf(screens), [screens]);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  const rows = useMemo(() => groupThread(live.messages, messageText), [live.messages]);
  const last = live.messages.at(-1)?.seq ?? 0;
  // The calls of this thread, by the message that named them: only the lines carrying a call are grouped, so the run's own stage work never shows here.
  const calls = useMemo(() => {
    const byMessage = new Map<number, CallGroup[]>();
    for (const group of callGroups(activity)) {
      if (group.thread !== thread) continue;
      const here = byMessage.get(group.message);
      if (here) here.push(group);
      else byMessage.set(group.message, [group]);
    }
    return byMessage;
  }, [activity, thread]);
  const ctx: Ctx = { team, runId, calls, screens, watch: setWatching, view: setViewing, remove: setRemoving, open: onOpen };

  // What is on screen is read: the thread counts as seen up to its last message.
  useEffect(() => {
    if (last) markThreadSeen(thread, last);
  }, [thread, last]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, last]);

  const asking = run?.status === 'question' && run.question?.kind !== 'squad' && run.question?.kind !== 'pr-retry';
  const note = asking ? t('ui.forum.noteAnswers') : t('ui.forum.noteMention');

  return (
    <section className="panel cy-thread" aria-label={title ?? t('ui.forum.thread')}>
      {title && <h2 className="cy-h">{title}</h2>}
      {live.loading && <span className="spinner" aria-label={t('ui.forum.loading')} />}
      {live.missing && <p className="small muted">{t('ui.forum.missing')}</p>}
      {!live.loading && !live.missing && live.messages.length === 0 && <p className="small muted">{t('ui.forum.empty')}</p>}
      <ol
        ref={list}
        className="cy-msgs cy-msgs-scroll"
        role="log"
        aria-label={t('ui.forum.messages')}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {rows.map((row) =>
          row.type === 'chain' ? (
            <Chain key={`c${row.messages[0].seq}`} chain={row.chain} messages={row.messages} ctx={ctx} />
          ) : row.type === 'commands' ? (
            <Commands key={`x${row.messages[0].seq}`} agent={row.agent} messages={row.messages} ctx={ctx} />
          ) : (
            <Message key={row.message.seq} m={row.message} ctx={ctx} />
          ),
        )}
      </ol>
      <AskCards asks={handoffAbove ? asks.filter((a) => !isHandoff(a)) : asks} team={team} onWatch={setWatching} />
      <OfferCards thread={thread} team={team} />
      <ScreenStrip screens={screens} team={team} onWatch={setWatching} />
      <Composer
        thread={thread}
        team={team}
        note={note}
        onSendBack={onSendBack && run && run.status !== 'question' && canSendBack(run) ? onSendBack : undefined}
        onSent={() => {
          stick.current = true;
        }}
      />
      {watching && <LiveScreen screenKey={watching} state={screens.find((x) => x.key === watching) ?? null} asks={asks.filter((a) => a.key === watching)} team={team} canClose onClose={() => setWatching(null)} />}
      {viewing && run && <ArtifactView runId={run.id} name={viewing} onClose={() => setViewing(null)} />}
      {removing && (
        <RemoveMessage
          target={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            // The thread is read again from the file: the removed message and the files it carried are gone from the screen.
            forgetNow();
          }}
        />
      )}
    </section>
  );
}
