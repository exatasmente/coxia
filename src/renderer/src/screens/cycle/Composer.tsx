import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { type AttachmentRef, ATTACHMENT_LIMITS, formatBytes } from '../../../../shared/attachments';
import { type ForumMessage, parseMentions } from '../../../../shared/forum';
import { applyMention, mentionAt, mentionChoices, mentionOptions } from '../../../../shared/forumView';
import { errorText } from '../../api';
import { composerAria, refocusAfterSend } from '../../chatModel';
import { useT } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';
import { agentName } from './names';
import { forumApi } from './forumApi';
import './cycle.css';

// The box a conversation is written in: text, files by button, drop or paste, and (where wanted) `@agent` completed from the team. The run thread, the conversations
// and the persona's chat all use it; the persona's turns `@` completion off and Enter on.

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

export interface ComposerProps {
  thread: string;
  team: readonly AgentDef[] | undefined;
  note: string | null;
  onSent: (m: ForumMessage) => void;
  /** Present when the run can be sent back: a mention in the text is then said not to do it, with the way to. */
  onSendBack?: () => void;
  /** `@agent` is completed from the team as the person types. Off in the persona's chat: another agent is not addressed from there, and a `@name` stays plain text. Default on. */
  mentions?: boolean;
  /** Enter sends and Shift plus Enter breaks the line (the computer's chat). Off: Enter breaks the line and the button sends (a phone); Ctrl or Cmd plus Enter sends in both. Default off. */
  enterSends?: boolean;
  /** A class for the box root: the floating button of the jobs dock lifts above `.composer`. */
  className?: string;
  /** The line under the box that says how to send; default is the conversations'. */
  hint?: string;
  placeholder?: string;
  /** Focus the box when it appears (the computer's chat). Default off: a phone would raise its keyboard over the conversation. */
  autoFocus?: boolean;
}

/** The box a person writes in, with `@agent` completed from the team as they type and files attached by button, drag and drop or paste. */
export function Composer({ thread, team, note, onSent, onSendBack, mentions = true, enterSends = false, className = '', hint, placeholder, autoFocus = false }: ComposerProps) {
  const t = useT();
  const phone = useIsPhone();
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
  // Whether the box had the focus when the button was pressed: pressing it moves the focus to the button, and the box must know it was there to take it back on a phone.
  const hadFocus = useRef(false);
  const listId = useId();
  // A draft agent is not offered, except in its own conversation: there the person is talking to it.
  const named = useMemo(() => (mentions ? mentionChoices(team ?? [], thread).map((a) => ({ id: a.id, name: agentName(team, a.id) })) : []), [team, thread, mentions]);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  const at = dismissed || !mentions ? null : mentionAt(text, caret);
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
    const had = hadFocus.current || document.activeElement === box.current;
    hadFocus.current = false;
    // The button that sent is disabled while the message leaves, which drops the focus to the page: the box takes it back once it is free again.
    const settle = () => {
      setBusy(false);
      if (refocusAfterSend(phone, had)) requestAnimationFrame(() => box.current?.focus());
    };
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
          settle();
          return;
        }
        const m = ids.length ? await forumApi.attachmentPost(thread, body, ids) : await forumApi.post(thread, body);
        setText('');
        setFiles([]);
        settle();
        onSent(m);
      } catch (e) {
        setError(errorText(e));
        settle();
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
    <div className={['cy-composer', drag ? 'cy-composer-drag' : '', className].filter(Boolean).join(' ')}>
      {note && <p className="small muted cy-composer-note">{note}</p>}
      {mentions && onSendBack && parseMentions(text, named.map((a) => a.id)).length > 0 && (
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
          // Read-only while a message leaves, not disabled: a disabled box drops the focus and the person has to click back into it.
          readOnly={busy}
          aria-busy={busy || undefined}
          aria-label={t('ui.forum.compose')}
          placeholder={placeholder ?? t('ui.forum.composePlaceholder')}
          {...composerAria(mentions, listId, options.length, active)}
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
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (enterSends && !e.shiftKey && !e.nativeEvent.isComposing))) {
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
        <span className="faint small">{hint ?? t('ui.forum.sendHint')}</span>
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
          <button
            type="button"
            className="btn btn-dark"
            disabled={busy || (!text.trim() && !files.length)}
            onPointerDown={() => {
              hadFocus.current = document.activeElement === box.current;
            }}
            onClick={send}
          >
            {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.forum.send')}
          </button>
        </span>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}

