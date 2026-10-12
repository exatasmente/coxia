import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { type ForumMessage, isInterrupted, messageText } from '../../../../shared/forum';
import type { PushTarget } from '../../../../shared/push';
import type { OpenScreenInfo } from '../../../../shared/browser';
import { ActivityItems, Chevron, useTreeOpen } from '../../ActivityTree';
import type { TreeNode } from '../../activityTreeModel';
import { actLine, buttonLabel, workItems, workOpenByDefault, workShown, workSummary } from '../../chatModel';
import { intlLocale, useT } from '../../i18n';
import { queuedKey } from '../../personaStopModel';
import { formatElapsed } from '../../jobs';
import { RichText } from '../Diagram';
import { MessageAttachments } from '../cycle/Attachments';
import { screenApi } from '../cycle/screenApi';
import { agentName, authorName } from '../cycle/names';
import './chat.css';

// The pieces of the persona's conversation: the person's bubble, the persona's answer with its Work above and its buttons below, another agent's bubble, a line the app wrote,
// and the answer being written. What decides anything (which tree belongs to which answer, when a bubble goes) is in chatModel.ts; this only draws.

const stamp = (iso: string): string => new Date(iso).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

/** The Work section above an answer: the tree of what the call did, open while it works and closed once the answer is complete; the person's own choice is kept. */
export function Work({ root }: { root: TreeNode }) {
  const t = useT();
  const sum = workSummary(root);
  const [open, toggle] = useTreeOpen(`work:${root.id}`, workOpenByDefault(root));
  const steps = t('ui.chat.work.steps', { count: sum.steps });
  return (
    <section className="chat-work" aria-label={t('ui.chat.work.label')}>
      <button type="button" className="chat-work-head" aria-expanded={open} onClick={toggle}>
        <Chevron open={open} />
        {sum.working && <span className="spinner act-spinner" aria-hidden="true" />}
        <span>{t('ui.chat.work.label')}</span>
        <span className="chat-work-sum">{sum.working ? t('ui.chat.work.working') : t('ui.chat.work.done', { time: formatElapsed(sum.ms), steps })}</span>
      </button>
      {open && (
        <div className="chat-work-body">
          <ActivityItems items={workItems(root)} origin={root.since} />
        </div>
      )}
    </section>
  );
}

/** The person's message, with the files it carried; a message that waits its turn behind an answer says so. */
export function PersonBubble({ m, waiting, stopped = false }: { m: ForumMessage; waiting: boolean; stopped?: boolean }) {
  const t = useT();
  return (
    <li className="chat-row chat-row-person" id={`msg-${m.seq}`}>
      <div className="chat-bubble chat-bubble-person">
        <div className="chat-text">
          <RichText text={messageText(m)} />
        </div>
        <MessageAttachments thread={m.thread} message={m.seq} refs={m.attachments} />
        {waiting && <span className="chat-waits" role="status">{t(queuedKey(stopped))}</span>}
        {m.origin === 'voice' && <span className="chat-spoken">{t('ui.voice.chat.spoken')}</span>}
        <time className="chat-time" dateTime={m.at}>{stamp(m.at)}</time>
      </div>
    </li>
  );
}

/** The buttons an answer offers, worded by the app from their targets. A tap opens the screen on this device only. A run's thread draws the same ones. */
export function Buttons({ targets, ceremony, onOpen }: { targets: readonly PushTarget[]; ceremony: string; onOpen: (target: PushTarget) => void }) {
  const t = useT();
  if (!targets.length) return null;
  return (
    <ul className="chat-buttons" aria-label={t('ui.chat.buttons')}>
      {targets.map((target, i) => (
        <li key={`${target.to}-${target.ref ?? target.id ?? ''}-${i}`}>
          <button type="button" className="btn chat-button" onClick={() => onOpen(target)}>{buttonLabel(target, t, ceremony)}</button>
        </li>
      ))}
    </ul>
  );
}

/** The persona's stored answer: its Work above (when this session still has the lines), the text, the files, the buttons. */
export function AnswerBubble({ m, team, work, ceremony, onOpen }: { m: ForumMessage; team: readonly AgentDef[] | undefined; work: TreeNode | null; ceremony: string; onOpen?: (target: PushTarget) => void }) {
  const t = useT();
  return (
    <li className="chat-row chat-row-answer" id={`msg-${m.seq}`}>
      {work && workShown(work) && <Work root={work} />}
      <div className="chat-bubble chat-bubble-answer">
        <strong className="chat-who">{authorName(m.author, team)}</strong>
        <div className="chat-text">
          <RichText text={messageText(m)} />
        </div>
        {isInterrupted(m) && <span className="chat-interrupted small" role="note">{t('ui.chat.interrupted')}</span>}
        <MessageAttachments thread={m.thread} message={m.seq} refs={m.attachments} />
        <time className="chat-time" dateTime={m.at}>{stamp(m.at)}</time>
      </div>
      {onOpen && m.buttons && <Buttons targets={m.buttons} ceremony={ceremony} onOpen={onOpen} />}
    </li>
  );
}

/** What an agent the persona called said in the persona's conversation: the author's name above the text, and the discussions button it may have offered. */
export function AgentBubble({ m, team, ceremony = '', onOpen }: { m: ForumMessage; team: readonly AgentDef[] | undefined; ceremony?: string; onOpen?: (target: PushTarget) => void }) {
  return (
    <li className="chat-row chat-row-agent" id={`msg-${m.seq}`}>
      <div className="chat-bubble chat-bubble-agent">
        <strong className="chat-who">{authorName(m.author, team)}</strong>
        <div className="chat-text">
          <RichText text={messageText(m)} />
        </div>
        <MessageAttachments thread={m.thread} message={m.seq} refs={m.attachments} />
        <time className="chat-time" dateTime={m.at}>{stamp(m.at)}</time>
      </div>
      {onOpen && m.buttons && <Buttons targets={m.buttons} ceremony={ceremony} onOpen={onOpen} />}
    </li>
  );
}

/** A line the app wrote (a failed answer, a stopped one, a held provider): in the flow, as in every conversation. */
export function SystemLine({ m }: { m: ForumMessage }) {
  return (
    <li className="chat-row chat-row-system" id={`msg-${m.seq}`}>
      <span className="chat-system">{messageText(m)}</span>
    </li>
  );
}

/** Lines the app wrote one after another, as one line that opens: how many there are and the last one, then all of them. */
export function NoticeGroup({ items }: { items: ForumMessage[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const last = items[items.length - 1];
  return (
    <li className="chat-row chat-row-system" id={`msg-${items[0].seq}`}>
      <button type="button" className="chat-notices" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Chevron open={open} />
        <span className="chat-notices-count">{t('ui.chat.notices', { count: items.length })}</span>
        {!open && <span className="chat-notices-last">{messageText(last)}</span>}
      </button>
      {open && (
        <ul className="chat-notices-list">
          {items.map((m) => (
            <li key={m.seq} id={m.seq === items[0].seq ? undefined : `msg-${m.seq}`} className="chat-system">{messageText(m)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The line an act of the persona leaves in its conversation, before the answer: what it did, in the viewer's words, whether the handler refused it, the fields of a raise of its
 * own reach, the link to its entry of the audit (the reason and what it had read are there) and the button of the screen the act was about. The links move the device they were
 * tapped on; with no `onOpen` (the wizard's test) the line is only text.
 */
export function ActRow({ m, ceremony, onOpen }: { m: ForumMessage; ceremony: string; onOpen?: (target: PushTarget) => void }) {
  const t = useT();
  const line = actLine(m, t);
  return (
    <li className={`chat-row chat-row-act ${line.refused ? 'chat-row-act-refused' : ''}`} id={`msg-${m.seq}`}>
      <div className="chat-act" role="group" aria-label={t('ui.chat.act.label')}>
        <span className="chat-act-text">{line.text}</span>
        {line.door && <span className="badge chat-act-door">{line.door === 'terminal' ? t('ui.chat.act.door.terminal') : line.door}</span>}
        {line.raised && <span className="badge badge-ask chat-act-raised">{t('ui.chat.act.raised', { fields: line.raised })}</span>}
        {onOpen && (
          <span className="chat-act-links">
            {line.auditId && (
              <button type="button" className="btn cy-mini" onClick={() => onOpen({ to: 'auditoria', id: line.auditId as string })}>
                {t('ui.chat.act.audit')}
              </button>
            )}
            {line.target && (
              <button type="button" className="btn cy-mini" onClick={() => onOpen(line.target as PushTarget)}>
                {buttonLabel(line.target, t, ceremony)}
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

/** Stop (and watch, where the call has a screen open): the controls the call line has in every conversation, nothing new. */
function AnswerActions({ thread, agent, team, screen, onWatch }: { thread: string; agent: string; team: readonly AgentDef[] | undefined; screen?: OpenScreenInfo; onWatch: (key: string) => void }) {
  const t = useT();
  const [stopping, setStopping] = useState(false);
  const stop = (): void => {
    setStopping(true);
    void screenApi.stop(thread, agent).then(() => undefined, () => undefined).finally(() => setStopping(false));
  };
  return (
    <span className="chat-actions">
      {screen && <button type="button" className="btn cy-mini" onClick={() => onWatch(screen.key)}>{t('ui.screen.watch')}</button>}
      <button type="button" className="btn cy-mini" disabled={stopping} aria-label={t('ui.screen.stopAria', { agent: agentName(team, agent) })} onClick={stop}>{t('ui.screen.stop')}</button>
    </span>
  );
}

/** The answer being written: the text so far with a caret at its end, and Stop. It is a view of the events; the stored answer replaces it by arriving. */
export function LiveBubble({ text, thread, agent, team, work, screen, onWatch }: { text: string; thread: string; agent: string; team: readonly AgentDef[] | undefined; work: TreeNode | null; screen?: OpenScreenInfo; onWatch: (key: string) => void }) {
  const t = useT();
  return (
    <li className="chat-row chat-row-answer" aria-busy="true">
      {work && workShown(work) && <Work root={work} />}
      <div className="chat-bubble chat-bubble-answer chat-bubble-live">
        <strong className="chat-who">{agentName(team, agent)}</strong>
        <div className="chat-text" aria-live="off">
          <RichText text={text} />
          <span className="chat-caret" role="img" aria-label={t('ui.chat.writing')} />
        </div>
        <AnswerActions thread={thread} agent={agent} team={team} screen={screen} onWatch={onWatch} />
      </div>
    </li>
  );
}

/** A call at work that has written nothing yet: it thinks or uses a tool. Its Work section is open, and Stop is there. */
export function PendingBubble({ thread, agent, team, work, screen, onWatch }: { thread: string; agent: string; team: readonly AgentDef[] | undefined; work: TreeNode; screen?: OpenScreenInfo; onWatch: (key: string) => void }) {
  const t = useT();
  return (
    <li className="chat-row chat-row-answer" aria-busy="true">
      <Work root={work} />
      <div className="chat-bubble chat-bubble-answer chat-bubble-live">
        <strong className="chat-who">{agentName(team, agent)}</strong>
        <span className="chat-pending" role="status">
          <span className="spinner" aria-hidden="true" />
          {t('ui.chat.thinking')}
        </span>
        <AnswerActions thread={thread} agent={agent} team={team} screen={screen} onWatch={onWatch} />
      </div>
    </li>
  );
}
