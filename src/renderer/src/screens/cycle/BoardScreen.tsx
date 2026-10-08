import { useState } from 'react';
import { cardRef } from '../../../../shared/board';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { useT } from '../../i18n';
import { BackIcon } from '../icons';
import { boardApi, reloadBoard, useBoard, type BoardCardView, type BoardView } from './boardApi';
import './cycle.css';

// The board of the workspace: its columns are the cycle's stages, and one card can be opened, moved, prioritised, commented, given to a squad, closed and
// reopened. With no code host the card never leaves the machine; with one, the card is the host's issue and the board follows what the host says.

const NONE = '';

function Card({ card, board }: { card: BoardCardView; board: BoardView }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      reloadBoard();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <li className={`cy-board-card ${card.state === 'closed' ? 'closed' : ''}`}>
      <button type="button" className="cy-board-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cy-board-title">{card.title}</span>
        <span className="faint small mono">{cardRef(card)}</span>
        {card.state === 'closed' && <span className="badge badge-quiet">{t('ui.board.card.closed')}</span>}
      </button>
      {open && (
        <div className="cy-board-detail">
          {card.body && <p className="small">{card.body}</p>}
          <div className="row cy-board-fields">
            <label className="cy-field">
              <span className="small muted">{t('ui.board.card.column')}</span>
              <select
                className="text-input"
                value={card.column}
                disabled={busy}
                onChange={(e) => void run(() => boardApi.update(card.id, { column: e.target.value }))}
              >
                {board.columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="cy-field">
              <span className="small muted">{t('ui.board.card.priority')}</span>
              <select
                className="text-input"
                value={card.priority ?? NONE}
                disabled={busy || !board.priorities.length}
                onChange={(e) => void run(() => boardApi.update(card.id, { priority: e.target.value || null }))}
              >
                <option value={NONE}>{t('ui.board.card.priorityNone')}</option>
                {board.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="cy-field">
              <span className="small muted">{t('ui.board.card.squad')}</span>
              <select
                className="text-input"
                value={card.squad ?? NONE}
                disabled={busy}
                onChange={(e) => void run(() => boardApi.update(card.id, { squad: e.target.value || null }))}
              >
                <option value={NONE}>{t('ui.board.card.squadNone')}</option>
                {board.squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="row cy-board-fields">
            <input className="text-input" placeholder={t('ui.board.card.commentPlaceholder')} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
            <button
              type="button"
              className="btn"
              disabled={busy || !comment.trim()}
              onClick={() =>
                void run(async () => {
                  await boardApi.comment(card.id, comment.trim());
                  setComment('');
                })
              }
            >
              {t('ui.board.card.comment')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void run(() => (card.state === 'closed' ? boardApi.reopen(card.id) : boardApi.close(card.id)))}
            >
              {card.state === 'closed' ? t('ui.board.open') : t('ui.board.card.close')}
            </button>
          </div>
          {error && <div className="error" role="alert">{error}</div>}
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
      reloadBoard();
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

/** The board of the workspace: a column per configured stage, with the cards that sit in it. */
export function BoardScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const board = useBoard();
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
            <OpenCard board={board} />
            {/* A squad that names no label is not offered as a destination: the board says why instead of pretending the card moved. */}
            {board.squads.length < board.squadCount && <p className="small faint">{t('ui.board.card.squadHint')}</p>}
            {!board.cards.length && <p className="dash-calm">{t('ui.board.empty')}</p>}
            <div className="cy-board-cols">
              {board.columns.map((c) => (
                <section key={c.id} className="cy-board-col" aria-label={c.label}>
                  <h2 className="section-title">{c.label}</h2>
                  <ul className="cy-board-list">
                    {board.cards.filter((card) => card.column === c.id).map((card) => <Card key={card.id} card={card} board={board} />)}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
