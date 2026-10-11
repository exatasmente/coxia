import { useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { type ForumMessage, messageText } from '../../../../shared/forum';
import type { PushTarget } from '../../../../shared/push';
import type { OpenScreenInfo } from '../../../../shared/browser';
import { ActivityItems, Chevron, useTreeOpen } from '../../ActivityTree';
import type { TreeNode } from '../../activityTreeModel';
import { buttonLabel, workItems, workOpenByDefault, workSummary } from '../../chatModel';
import { intlLocale, useT } from '../../i18n';
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
export function PersonBubble({ m, waiting }: { m: ForumMessage; waiting: boolean }) {
  const t = useT();
  return (
    <li className="chat-row chat-row-person" id={`msg-${m.seq}`}>
      <div className="chat-bubble chat-bubble-person">
        <div className="chat-text">
          <RichText text={messageText(m)} />
        </div>
        <MessageAttachments thread={m.thread} message={m.seq} refs={m.attachments} />
        {waiting && <span className="chat-waits" role="status">{t('ui.chat.queued')}</span>}
        <time className="chat-time" dateTime={m.at}>{stamp(m.at)}</time>
      </div>
    </li>
  );
}

/** The buttons an answer offers, worded by the app from their targets. A tap opens the screen on this device only. */
function Buttons({ targets, ceremony, onOpen }: { targets: readonly PushTarget[]; ceremony: string; onOpen: (target: PushTarget) => void }) {
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
  return (
    <li className="chat-row chat-row-answer" id={`msg-${m.seq}`}>
      {work && <Work root={work} />}
      <div className="chat-bubble chat-bubble-answer">
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

/** What an agent the persona called said in the persona's conversation: the author's name above the text. */
export function AgentBubble({ m, team }: { m: ForumMessage; team: readonly AgentDef[] | undefined }) {
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
      {work && <Work root={work} />}
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
