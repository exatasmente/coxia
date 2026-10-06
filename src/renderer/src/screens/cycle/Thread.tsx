import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { type AttachmentRef, ATTACHMENT_LIMITS, formatBytes } from '../../../../shared/attachments';
import { type ForumMessage, MAX_MENTIONS, type MessageKind, messageText, parseMentions } from '../../../../shared/forum';
import { type QuestionChain, applyMention, groupThread, mentionAt, mentionOptions } from '../../../../shared/forumView';
import { type Run, canSendBack } from '../../../../shared/runs';
import { type CallGroup, callGroups } from '../../activity';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { useActivity } from '../../useActivity';
import { RichText } from '../Diagram';
import { ArtifactView } from './ArtifactView';
import { MessageAttachments } from './Attachments';
import { agentName, agentRole, authorName } from './names';
import { forumApi, markThreadSeen, useThread } from './forumApi';
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
  view: (name: string) => void;
}

function useTarget(team: readonly AgentDef[] | undefined): (to: string | null) => string {
  const t = useT();
  return (to) => (!to || to === 'person' ? t('ui.forum.to.person') : to === 'reporter' ? t('ui.forum.to.reporter') : agentName(team, to));
}

/** One call still going under the message that named the agent: it says the call works (or waits its turn), then shows its live step. It is not a message. */
function CallLine({ group, team }: { group: CallGroup; team: readonly AgentDef[] | undefined }) {
  const t = useT();
  const state = group.entry.state;
  const label = state === 'queued' ? t('activity.queued') : state === 'started' ? t('activity.call.working') : group.entry.label;
  return (
    <p className="cy-call" role="status">
      <span className="spinner" aria-hidden="true" />
      <strong className="cy-call-agent">{agentName(team, group.agent)}</strong>
      <span className="cy-call-step">{label}</span>
    </p>
  );
}

/** One message: who said it, of what kind, whether it is a public record and where it was posted, then its text and the documents it points to. */
function Message({ m, ctx, inChain = false }: { m: ForumMessage; ctx: Ctx; inChain?: boolean }) {
  const t = useT();
  const to = useTarget(ctx.team);
  if (m.kind === 'system') {
    return (
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
      {(ctx.calls.get(m.seq) ?? []).map((g) => <CallLine key={g.runId} group={g} team={ctx.team} />)}
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

/** A file waiting to be sent: the bytes and what the person sees of it (name and size) before the message leaves. */
interface Pending {
  key: string;
  name: string;
  bytes: number;
  dataBase64: string;
}

/** The files a person chose, in the box, before sending: name and size, each removable. The kind is decided by the app when the message is sent. */
function PendingFiles({ files, onRemove }: { files: readonly Pending[]; onRemove: (key: string) => void }) {
  const t = useT();
  if (!files.length) return null;
  return (
    <ul className="cy-pending" aria-label={t('ui.forum.file.pending')}>
      {files.map((f) => (
        <li key={f.key} className="cy-pending-item">
          <span className="cy-pending-name mono">{f.name}</span>
          <span className="faint small">{formatBytes(f.bytes)}</span>
          <button type="button" className="cy-link" aria-label={t('ui.forum.file.remove', { name: f.name })} onClick={() => onRemove(f.key)}>{t('ui.forum.file.removeLabel')}</button>
        </li>
      ))}
    </ul>
  );
}

/** The one-time warning that what an agent reads here leaves the computer; the box shows it while a file is waiting to be sent. */
function AttachmentNotice() {
  const t = useT();
  return <p className="cy-attach-notice small" role="note">{t('main.attachment.notice')}</p>;
}

async function readFileAsBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The box a person writes in, with `@agent` completed from the team as they type and files attached by button, drag and drop or paste. */
function Composer({ thread, team, note, onSent, onSendBack }: { thread: string; team: readonly AgentDef[] | undefined; note: string | null; onSent: (m: ForumMessage) => void; /** Present when the run can be sent back: a mention in the text is then said not to do it, with the way to. */ onSendBack?: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [files, setFiles] = useState<readonly Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const listId = useId();
  const named = useMemo(() => (team ?? []).map((a) => ({ id: a.id, name: agentName(team, a.id) })), [team]);
  const at = dismissed ? null : mentionAt(text, caret);
  const options = at ? mentionOptions(named, at.query) : [];

  const addFiles = (list: FileList | File[] | null | undefined) => {
    if (!list) return;
    void (async () => {
      const next: Pending[] = [];
      let base = files;
      let total = base.reduce((n, f) => n + f.bytes, 0);
      for (const file of Array.from(list).slice(0, ATTACHMENT_LIMITS.perMessage)) {
        if (base.length >= ATTACHMENT_LIMITS.perMessage) {
          setError(t('main.attachment.tooMany', { max: ATTACHMENT_LIMITS.perMessage }));
          break;
        }
        const data = await readFileAsBase64(file);
        const bytes = file.size;
        total += bytes;
        if (total > ATTACHMENT_LIMITS.messageBytes) {
          setError(t('main.attachment.messageLimit', { max: Math.round(ATTACHMENT_LIMITS.messageBytes / 1024 / 1024) }));
          break;
        }
        next.push({ key: `${Date.now()}-${next.length}-${file.name}`, name: file.name, bytes, dataBase64: data });
      }
      base = [...base, ...next];
      setFiles(base);
    })();
  };

  const removeFile = (key: string) => setFiles((cur) => cur.filter((f) => f.key !== key));

  const send = () => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // The bytes go one by one, so the body of each call stays small; a file the app refuses is dropped and the rest are kept.
        const ids: string[] = [];
        const kept: Pending[] = [];
        for (const f of files) {
          try {
            const ref = await forumApi.attachmentPut(thread, f.name, f.dataBase64);
            ids.push(ref.id);
          } catch (e) {
            setError(errorText(e));
            kept.push(f);
          }
        }
        if (!ids.length && files.length) {
          setFiles(kept);
          setBusy(false);
          return;
        }
        const m = ids.length ? await forumApi.attachmentPost(thread, body, ids) : await forumApi.post(thread, body);
        setText('');
        setFiles([]);
        setBusy(false);
        onSent(m);
      } catch (e) {
        setError(errorText(e));
        setBusy(false);
      }
    })();
  };

  const pick = (id: string) => {
    if (!at) return;
    const next = applyMention(text, at.start, caret, id);
    setText(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className={`cy-composer ${drag ? 'cy-composer-drag' : ''}`}>
      {note && <p className="small muted cy-composer-note">{note}</p>}
      {onSendBack && parseMentions(text, named.map((a) => a.id)).length > 0 && (
        <p className="small cy-composer-note cy-sendback-hint" role="note">
          {t('ui.forum.noteSendBack')}{' '}
          <button type="button" className="cy-link" onClick={onSendBack}>{t('ui.forum.noteSendBackOpen')}</button>
        </p>
      )}
      {files.length > 0 && <AttachmentNotice />}
      <PendingFiles files={files} onRemove={removeFile} />
      <div
        className="cy-composer-box"
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          addFiles(e.dataTransfer?.files ?? null);
        }}
      >
        <textarea
          ref={box}
          className="text-input cy-textarea cy-compose"
          rows={2}
          value={text}
          disabled={busy}
          aria-label={t('ui.forum.compose')}
          placeholder={t('ui.forum.composePlaceholder')}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
            setDismissed(false);
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.files;
            if (items && items.length) {
              e.preventDefault();
              addFiles(items);
            }
          }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(options[active].id);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(true);
                return;
              }
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {options.length > 0 && (
          <ul id={listId} role="listbox" className="cy-mentions" aria-label={t('ui.forum.mentionList')}>
            {options.map((o, i) => (
              <li key={o.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}>
                <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.id)}>
                  <strong>{o.name}</strong> <span className="faint mono">@{o.id}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="row spread">
        <span className="faint small">{t('ui.forum.sendHint')}</span>
        <span className="row">
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            aria-hidden="true"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn cy-attach-btn" disabled={busy} aria-label={t('ui.forum.file.attach')} onClick={() => picker.current?.click()}>
            {t('ui.forum.file.attach')}
          </button>
          <button type="button" className="btn btn-dark" disabled={busy || (!text.trim() && !files.length)} onClick={send}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.forum.send')}
          </button>
        </span>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
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
}

/** A thread read and written: messages by kind with their author and where they stand, the chain of each question, live, and the box to write in. */
export function Thread({ thread, run = null, team, title, onSendBack }: Props) {
  const t = useT();
  const live = useThread(thread);
  const runId = run?.id ?? null;
  const activity = useActivity(runId ? `run:${runId}` : undefined);
  const [viewing, setViewing] = useState<string | null>(null);
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
  const ctx: Ctx = { team, runId, calls, view: setViewing };

  // What is on screen is read: the thread counts as seen up to its last message.
  useEffect(() => {
    if (last) markThreadSeen(thread, last);
  }, [thread, last]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, last]);

  const asking = run?.status === 'question' && run.question?.kind !== 'squad';
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
        {rows.map((row) => (row.type === 'chain' ? <Chain key={`c${row.messages[0].seq}`} chain={row.chain} messages={row.messages} ctx={ctx} /> : <Message key={row.message.seq} m={row.message} ctx={ctx} />))}
      </ol>
      <Composer
        thread={thread}
        team={team}
        note={note}
        onSendBack={onSendBack && run && run.status !== 'question' && canSendBack(run) ? onSendBack : undefined}
        onSent={() => {
          stick.current = true;
        }}
      />
      {viewing && run && <ArtifactView runId={run.id} name={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
