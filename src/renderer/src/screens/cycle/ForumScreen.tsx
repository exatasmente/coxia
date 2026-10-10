import { useMemo, useState } from 'react';
import { type ThreadSummary, agentThreadId } from '../../../../shared/forum';
import { chatAgents, forumLists, totalUnread, unreadOf } from '../../../../shared/forumView';
import { isActive } from '../../../../shared/runs/view';
import type { Screen } from '../../App';
import { errorText } from '../../api';
import { intlLocale, useT } from '../../i18n';
import { useIsPhone } from '../../useIsPhone';
import { BackIcon } from '../icons';
import { forumApi, reloadThreads, useSeen, useThreads } from './forumApi';
import { RunBadge } from './RunBadge';
import { squadName } from './names';
import { Thread } from './Thread';
import { useRunConfig, useRuns } from './runsApi';
import './cycle.css';

const ALL = '';

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(intlLocale(), { day: '2-digit', month: '2-digit' });
}

function Item({ s, selected, unread, onOpen }: { s: ThreadSummary; selected: boolean; unread: number; onOpen: () => void }) {
  const t = useT();
  const runs = useRuns();
  const run = s.runId ? runs?.find((r) => r.id === s.runId) : null;
  return (
    <li>
      <button type="button" className={`cy-thread-item ${selected ? 'on' : ''}`} aria-current={selected ? 'true' : undefined} onClick={onOpen}>
        <span className="cy-thread-main">
          <span className="cy-thread-title">{s.kind === 'channel' ? <span aria-hidden="true">#&nbsp;</span> : null}{s.title}</span>
          <span className="faint small">{t('ui.forum.list.count', { count: s.count })}{s.lastAt ? ` · ${when(s.lastAt)}` : ''}</span>
        </span>
        {run && isActive(run) && <RunBadge run={run} />}
        {s.openQuestion && !(run && isActive(run)) && <span className="badge cy-tone-person">{t('ui.forum.list.open')}</span>}
        {unread > 0 && <span className="badge cy-unread" aria-label={t('ui.forum.list.unread', { count: unread })}>{unread}</span>}
      </button>
    </li>
  );
}

/** The forum: the channels and the threads with what is unread, filtered by squad, and the one that is open beside them (on a phone, instead of them). */
export function ForumScreen({ go, thread }: { go: (s: Screen) => void; thread?: string }) {
  const t = useT();
  const phone = useIsPhone();
  const all = useThreads();
  const seen = useSeen();
  const config = useRunConfig();
  const runs = useRuns();
  const [squad, setSquad] = useState(ALL);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lists = useMemo(() => forumLists(all ?? [], squad || null), [all, squad]);
  const selected = thread ? (all?.find((s) => s.id === thread) ?? null) : null;
  const squads = config?.squads ?? [];
  const open = (id: string) => go({ name: 'forum', thread: id });
  const unread = totalUnread(all ?? [], seen);
  // The direct conversation of an agent is a thread of the forum with an id of its own, made when the forum is listed: the team list only offers the way in.
  const team = chatAgents(config?.agents.team ?? []);

  const create = () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    void forumApi.create(name).then(
      (s) => {
        setTitle('');
        setBusy(false);
        reloadThreads();
        open(s.id);
      },
      (e) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };

  const list = (
    <div className="cy-forum-list">
      {squads.length > 0 && (
        <label className="cy-field">
          <span className="small muted">{t('ui.forum.filter')}</span>
          <select className="text-input" value={squad} onChange={(e) => setSquad(e.target.value)}>
            <option value={ALL}>{t('ui.forum.filter.all')}</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{squadName(squads, s.id)}</option>)}
          </select>
        </label>
      )}
      <h2 className="section-title">{t('ui.forum.channels')}</h2>
      {all && !lists.channels.length && <p className="small faint">{t('ui.forum.channels.none')}</p>}
      <ul className="cy-thread-list">
        {lists.channels.map((s) => <Item key={s.id} s={s} selected={s.id === thread} unread={unreadOf(s, seen)} onOpen={() => open(s.id)} />)}
      </ul>
      <h2 className="section-title">{t('ui.forum.threads')}</h2>
      {all && !lists.threads.length && <p className="small faint">{t('ui.forum.threads.none')}</p>}
      <ul className="cy-thread-list">
        {lists.threads.map((s) => <Item key={s.id} s={s} selected={s.id === thread} unread={unreadOf(s, seen)} onOpen={() => open(s.id)} />)}
      </ul>
      {team.length > 0 && (
        <details className="cy-new-thread">
          <summary className="small muted" style={{ cursor: 'pointer' }}>{t('ui.forum.agents')}</summary>
          <ul className="cy-thread-list" aria-label={t('ui.forum.agents')}>
            {team.map((a) => <li key={a.id}><button type="button" className="btn cy-mini" onClick={() => open(agentThreadId(a.id))}>{t('ui.forum.agentChat', { agent: a.name || a.id })}</button></li>)}
          </ul>
        </details>
      )}
      <form
        className="cy-new-thread"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="cy-field">
          <span className="small muted">{t('ui.forum.new.label')}</span>
          <input className="text-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={t('ui.forum.new.placeholder')} disabled={busy} />
        </label>
        <button type="submit" className="btn" disabled={busy || !title.trim()}>{t('ui.forum.new.create')}</button>
        {error && <div className="error" role="alert">{error}</div>}
      </form>
    </div>
  );

  const detail = thread ? (
    <div className="cy-forum-thread">
      <div className="row spread cy-forum-bar">
        {phone && <button type="button" className="btn" onClick={() => go({ name: 'forum' })}>{t('ui.forum.backToList')}</button>}
        {selected?.runId && <button type="button" className="btn" onClick={() => go({ name: 'run', id: selected.runId as string })}>{t('ui.forum.openRun')}</button>}
      </div>
      <Thread thread={thread} team={config?.agents.team} title={selected?.title} run={selected?.runId ? (runs?.find((r) => r.id === selected.runId) ?? null) : null} onSendBack={selected?.runId ? () => go({ name: 'run', id: selected.runId as string, tab: 'cycle' }) : undefined} />
    </div>
  ) : (
    <p className="dash-calm cy-forum-pick">{t('ui.forum.pick')}</p>
  );

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.forum.title')}{unread > 0 ? <span className="badge cy-unread cy-title-badge" aria-label={t('ui.forum.list.unreadAll', { count: unread })}>{unread}</span> : null}</h1>
          </div>
        </header>
        <div className={`cy-forum ${phone ? 'cy-forum-phone' : ''}`}>
          {(!phone || !thread) && list}
          {(!phone || thread) && detail}
        </div>
      </div>
    </div>
  );
}
