import { useEffect, useState } from 'react';
import { cardRef } from '../../../../shared/board';
import type { SendAllResult } from '../../../../shared/board';
import { getLanguage } from '../../../../shared/i18n';
import { clockOf } from '../../../../shared/sameDay';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { BackIcon } from '../icons';
import { boardApi, reloadBoard, useBoard, watchBoard, type BoardCardView, type BoardItemView, type BoardView } from './boardApi';
import './cycle.css';

// The board of the workspace: its columns are the cycle's stages, and one card can be opened, moved, prioritised, commented, given to a squad, closed and
// reopened. With no code host the card never leaves the machine and nothing here points at one. With a host, a card is the host's issue: the board says where
// each one stands, lists the issues of the workspace's projects that no card holds, and every change goes through the door (a proposal in Actions, or at once
// when the board's own autonomy is on).

const NONE = '';

/** Runs a change of one card or issue: busy while it goes, the reason when it fails, and the board read again either way. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    void reloadBoard();
    setBusy(false);
  };
  return { busy, error, run };
}

/** What one change asks of the board: the column, the priority and the squad of a card or a listed issue, and the comment and the state of either. */
interface Target {
  update(patch: { column?: string; priority?: string | null; squad?: string | null }): Promise<unknown>;
  comment(text: string): Promise<unknown>;
  close(): Promise<unknown>;
  reopen(): Promise<unknown>;
}

/** The controls both a card and a listed issue have. `locked`: a proposal waits for this one, so nothing about it changes until that is decided. */
function Controls({ board, target, column, priority, squad, closed, locked, hostLabels, writeNote }: {
  board: BoardView;
  target: Target;
  column: string | null;
  priority: string | null;
  squad: string | null;
  closed: boolean;
  locked: boolean;
  /** False where the host keeps no labels and the thing is not a card of the board: there is nowhere to put a column, a priority or a squad. */
  hostLabels: boolean;
  /** The label the current column is written as on the host, when it is the app's own. */
  writeNote: string | null;
}) {
  const t = useT();
  const [comment, setComment] = useState('');
  const { busy, error, run } = useRun();
  const off = busy || locked;
  return (
    <>
      {hostLabels && (
        <div className="row cy-board-fields">
          <label className="cy-field">
            <span className="small muted">{t('ui.board.card.column')}</span>
            <select className="text-input" value={column ?? NONE} disabled={off} onChange={(e) => void run(() => target.update({ column: e.target.value }))}>
              {column === null && <option value={NONE} disabled>{t('ui.board.noColumn')}</option>}
              {board.columns.map((c) => (
                <option key={c.id} value={c.id} disabled={c.writes?.by === 'refused' && c.id !== column}>
                  {c.writes?.by === 'refused' ? t('ui.board.column.refusedOption', { column: c.label }) : c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cy-field">
            <span className="small muted">{t('ui.board.card.priority')}</span>
            <select className="text-input" value={priority ?? NONE} disabled={off || !board.priorities.length} onChange={(e) => void run(() => target.update({ priority: e.target.value || null }))}>
              <option value={NONE}>{t('ui.board.card.priorityNone')}</option>
              {board.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="cy-field">
            <span className="small muted">{t('ui.board.card.squad')}</span>
            <select className="text-input" value={squad ?? NONE} disabled={off} onChange={(e) => void run(() => target.update({ squad: e.target.value || null }))}>
              <option value={NONE}>{t('ui.board.card.squadNone')}</option>
              {board.squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>
      )}
      {writeNote && <p className="small faint">{t('ui.board.column.writes', { label: writeNote })}</p>}
      <div className="row cy-board-fields">
        <input className="text-input" placeholder={t('ui.board.card.commentPlaceholder')} value={comment} maxLength={2000} disabled={locked} onChange={(e) => setComment(e.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={off || !comment.trim()}
          onClick={() =>
            void run(async () => {
              await target.comment(comment.trim());
              setComment('');
            })
          }
        >
          {t('ui.board.card.comment')}
        </button>
        <button type="button" className="btn" disabled={off} onClick={() => void run(() => (closed ? target.reopen() : target.close()))}>
          {closed ? t('ui.board.open') : t('ui.board.card.close')}
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </>
  );
}

/** One short line for where a card stands in relation to the host, in the order of precedence the board gives them. Null: no host, nothing to say. */
function standing(card: BoardCardView, t: ReturnType<typeof useT>): { text: string; kind: 'ask' | 'block' | 'quiet' } | null {
  switch (card.hostState) {
    case 'waiting':
      return { text: t('ui.board.card.waiting'), kind: 'ask' };
    case 'failed':
      return { text: t('ui.board.card.failed'), kind: 'block' };
    case 'linked':
      return { text: t('ui.board.card.onHost'), kind: 'quiet' };
    case 'missing':
      return { text: t('ui.board.card.outside'), kind: 'block' };
    case 'unread':
      return { text: t('ui.board.card.unread'), kind: 'quiet' };
    case 'notSent':
      return { text: t('ui.board.card.notSent'), kind: 'quiet' };
    default:
      return null;
  }
}

const BADGE = { ask: 'badge-ask', block: 'badge-block', quiet: 'badge-quiet' } as const;

function Card({ card, board, go }: { card: BoardCardView; board: BoardView; go: (s: Screen) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useRun();
  const state = standing(card, t);
  const locked = card.hostState === 'waiting' || card.hostState === 'failed';
  const writes = board.columns.find((c) => c.id === card.column)?.writes;
  const target: Target = {
    update: (patch) => boardApi.update(card.id, patch),
    comment: (text) => boardApi.comment(card.id, text),
    close: () => boardApi.close(card.id),
    reopen: () => boardApi.reopen(card.id),
  };
  // A card on a host that keeps no labels has its column, priority and squad on the board only; that is said, not hidden.
  const labelsLocal = !!board.host && !board.host.labels && !!card.host;
  return (
    <li className={`cy-board-card ${card.state === 'closed' ? 'closed' : ''}`}>
      <button type="button" className="cy-board-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cy-board-title">{card.title}</span>
        <span className="faint small mono">{card.host ? `${card.host.project}#${card.host.iid}` : cardRef(card)}</span>
        {card.state === 'closed' && <span className="badge badge-quiet">{t('ui.board.card.closed')}</span>}
        {state && <span className={`badge ${BADGE[state.kind]}`}>{state.text}</span>}
      </button>
      {open && (
        <div className="cy-board-detail">
          {card.body && <p className="small">{card.body}</p>}
          {card.host && <p className="small"><a href={card.host.url} target="_blank" rel="noreferrer">{card.host.url}</a></p>}
          {card.host && <p className="small faint">{t('ui.board.card.textHost')}</p>}
          {locked && (
            <p className="small">
              {card.hostState === 'failed' ? t('ui.board.card.failedHint') : t('ui.board.card.waitingHint')}{' '}
              <button type="button" className="btn" onClick={() => go({ name: 'actions' })}>{t('ui.board.card.openActions')}</button>
            </p>
          )}
          {card.hostState === 'missing' && <p className="small">{t('ui.board.card.outsideHint')}</p>}
          {card.hostState === 'unread' && <p className="small">{t('ui.board.card.unreadHint')}</p>}
          {card.hostState === 'notSent' && (
            <div className="row cy-board-fields">
              {card.hostNote && <p className="small">{card.hostNote.text}</p>}
              <button type="button" className="btn btn-dark" disabled={busy || !!board.host?.cannotSend} onClick={() => void run(() => boardApi.send(card.id))}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.board.send')}
              </button>
              {board.host?.cannotSend && <p className="small faint">{board.host.cannotSend}</p>}
            </div>
          )}
          {labelsLocal && <p className="small faint">{t('ui.board.host.noLabelsCard')}</p>}
          <Controls
            board={board}
            target={target}
            column={card.column}
            priority={card.priority}
            squad={card.squad}
            closed={card.state === 'closed'}
            locked={locked}
            hostLabels
            writeNote={card.host && writes?.by === 'default' ? writes.label : null}
          />
          {error && <div className="error" role="alert">{error}</div>}
        </div>
      )}
    </li>
  );
}

/** An issue the host lists that no card holds: the host's, with the same actions aimed at its project and number. */
function Item({ item, board, go }: { item: BoardItemView; board: BoardView; go: (s: Screen) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const locked = !!item.waiting;
  const writes = board.columns.find((c) => c.id === item.column)?.writes;
  const at = { project: item.project, iid: item.iid };
  const target: Target = {
    update: (patch) => boardApi.update(at, patch),
    comment: (text) => boardApi.comment(at, text),
    close: () => boardApi.close(at),
    reopen: () => boardApi.reopen(at),
  };
  return (
    <li className="cy-board-card">
      <button type="button" className="cy-board-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cy-board-title">{item.title}</span>
        <span className="faint small mono">{item.key}</span>
        <span className="badge badge-quiet">{t('ui.board.fromHost')}</span>
        {locked && <span className={`badge ${item.waiting?.failed ? 'badge-block' : 'badge-ask'}`}>{item.waiting?.failed ? t('ui.board.card.failed') : t('ui.board.card.waiting')}</span>}
      </button>
      {open && (
        <div className="cy-board-detail">
          <p className="small"><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a></p>
          {item.labels.length > 0 && <div className="cy-labels">{item.labels.map((l) => <span key={l} className="badge badge-quiet">{l}</span>)}</div>}
          <p className="small faint">{t('ui.board.card.textHost')}</p>
          {item.waiting && (
            <p className="small">
              {item.waiting.failed ? t('ui.board.card.failedHint') : t('ui.board.card.waitingHint')}{' '}
              <button type="button" className="btn" onClick={() => go({ name: 'actions' })}>{t('ui.board.card.openActions')}</button>
            </p>
          )}
          {!board.host?.labels && <p className="small faint">{t('ui.board.host.noLabelsItem')}</p>}
          <Controls
            board={board}
            target={target}
            column={item.column}
            priority={item.priority}
            squad={item.squad}
            closed={false}
            locked={locked}
            hostLabels={!!board.host?.labels}
            writeNote={writes?.by === 'default' ? writes.label : null}
          />
        </div>
      )}
    </li>
  );
}

/** Opens a card on the board: a title, a description, and the column it starts in. */
function OpenCard({ board }: { board: BoardView }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [column, setColumn] = useState(board.columns[0]?.id ?? '');
  const [repo, setRepo] = useState(board.repos[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await boardApi.create({ title: title.trim(), body, column, repo: repo || null });
      setTitle('');
      setBody('');
      void reloadBoard();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <section className="panel cy-board-new" aria-label={t('ui.board.create')}>
      <h2 className="cy-release-title">{t('ui.board.create')}</h2>
      <label className="cy-field">
        <span className="small muted">{t('ui.board.create.title')}</span>
        <input className="text-input" value={title} maxLength={200} placeholder={t('ui.board.create.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="cy-field">
        <span className="small muted">{t('ui.board.create.body')}</span>
        <textarea className="text-input" rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="row cy-board-fields">
        <label className="cy-field">
          <span className="small muted">{t('ui.board.create.column')}</span>
          <select className="text-input" value={column} onChange={(e) => setColumn(e.target.value)}>
            {board.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {board.repos.length > 1 && (
          <label className="cy-field">
            <span className="small muted">{t('ui.board.create.repo')}</span>
            <select className="text-input" value={repo} onChange={(e) => setRepo(e.target.value)}>
              {board.repos.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
        )}
        <button type="button" className="btn btn-dark" disabled={busy || !title.trim() || !column} onClick={() => void open()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.board.create')}
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

/** The host above the columns: its name, when it was read, a refresh, what it left out, and the one action for every card not sent yet. */
function HostBar({ board }: { board: BoardView }) {
  const t = useT();
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendAllResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const host = board.host;
  if (!host) return null;
  const name = host.name ?? '';
  const sendAll = async () => {
    setSending(true);
    setError(null);
    try {
      setResult(await boardApi.sendAll());
    } catch (e) {
      setError(errorText(e));
    }
    void reloadBoard();
    setSending(false);
  };
  return (
    <section className="panel cy-board-host" aria-label={name}>
      <div className="row spread">
        <span className="small">{host.readAt ? t('ui.board.host.line', { host: name, time: clockOf(host.readAt, getLanguage()) }) : t('ui.board.host.notRead', { host: name })}</span>
        <button
          type="button"
          className="btn"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void reloadBoard(true).then(() => setRefreshing(false));
          }}
        >
          {refreshing ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.board.refresh')}
        </button>
      </div>
      {host.error && <div className="error" role="alert">{t('ui.board.host.readFailed', { reason: host.error })}</div>}
      {!host.labels && <p className="small faint">{t('ui.board.host.noLabels', { host: name })}</p>}
      {board.noProject && <p className="small faint">{t('ui.board.noProject', { host: name })}</p>}
      {board.projects.filter((p) => p.truncated).map((p) => <p key={`t-${p.project}`} className="small faint">{t('ui.board.truncated', { count: p.count, project: p.project })}</p>)}
      {board.projects.filter((p) => p.error).map((p) => <p key={`e-${p.project}`} className="small">{t('ui.board.projectFailed', { project: p.project, reason: p.error ?? '' })}</p>)}
      {board.sendable > 0 && (
        <div className="row cy-board-fields">
          <button type="button" className="btn btn-dark" disabled={sending} onClick={() => void sendAll()}>
            {sending ? <span className="spinner" aria-hidden="true" /> : null} {t('ui.board.sendAll', { count: board.sendable })}
          </button>
        </div>
      )}
      {host.cannotSend && board.cards.some((c) => c.hostState === 'notSent') && <p className="small faint">{host.cannotSend}</p>}
      {result && (
        <div role="status">
          <p className="small">{t('ui.board.sendAll.result', { sent: result.sent, proposed: result.proposed, failed: result.failed.length, remaining: result.remaining })}</p>
          {result.failed.map((f) => <p key={f.id} className="small faint">{board.cards.find((c) => c.id === f.id)?.title ?? f.id}: {f.reason}</p>)}
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}

/** The board of the workspace: a column per configured stage, with the cards that sit in it and the host's issues placed by their stage. */
export function BoardScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const board = useBoard();
  // Opening the board reads it (and the host, when it has one); a read less than five minutes old is reused.
  useEffect(() => {
    void reloadBoard();
    return watchBoard();
  }, []);
  const unplaced = board?.items.filter((i) => i.column === null) ?? [];
  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.board.title')}</h1>
          </div>
        </header>
        {!board && <span className="spinner" aria-label={t('ui.board.title')} />}
        {board && (
          <>
            <HostBar board={board} />
            <OpenCard board={board} />
            {/* A squad that names no label is not offered as a destination: the board says why instead of pretending the card moved. */}
            {board.squads.length < board.squadCount && <p className="small faint">{t('ui.board.card.squadHint')}</p>}
            {!board.cards.length && !board.items.length && <p className="dash-calm">{t('ui.board.empty')}</p>}
            <div className="cy-board-cols">
              {board.columns.map((c) => (
                <section key={c.id} className="cy-board-col" aria-label={c.label}>
                  <h2 className="section-title">{c.label}</h2>
                  <ul className="cy-board-list">
                    {board.cards.filter((card) => card.column === c.id).map((card) => <Card key={card.id} card={card} board={board} go={go} />)}
                    {board.items.filter((item) => item.column === c.id).map((item) => <Item key={item.key} item={item} board={board} go={go} />)}
                  </ul>
                </section>
              ))}
              {unplaced.length > 0 && (
                <section className="cy-board-col" aria-label={t('ui.board.noColumn')}>
                  <h2 className="section-title">{t('ui.board.noColumn')}</h2>
                  <ul className="cy-board-list">
                    {unplaced.map((item) => <Item key={item.key} item={item} board={board} go={go} />)}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
