import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Screen } from '../../App';
import { errorText, moduleEvents } from '../../api';
import { MEMORY_EVENT, type MemoryListView, type NoteItem } from '../../../../shared/memoryView';
import { useT } from '../../i18n';
import { BackIcon } from '../icons';
import { agentName } from '../cycle/names';
import { useRunConfig } from '../cycle/runsApi';
import { NotePanel } from './NotePanel';
import { BADGE_LABEL, KIND_LABEL, NOTE_KIND_LIST, NO_FILTERS, badgesOf, distinct, filterNotes, groupNotes, isFiltering, type NoteFilters } from './memoryModel';
import { memoryApi } from './memoryApi';
import '../cycle/cycle.css';
import './memory.css';

// The Memory view: every note the agents kept, grouped by conversation and by the agent that wrote it, each opening into its text, who wrote it and when. It reads whatever the
// workspace switch says. The person reads, edits, marks reviewed and removes notes, and removes a folder; the same from the window and from a paired browser (the phone has
// the desktop's capabilities over the memory). A change by an agent reaches the open screen through the memory event.

function Filters({ view, filters, set }: { view: MemoryListView; filters: NoteFilters; set: (f: NoteFilters) => void }) {
  const t = useT();
  const team = useRunConfig()?.agents.team;
  const conversations = useMemo(() => distinct(view.folders, (f) => f.conversation), [view]);
  const titles = useMemo(() => new Map(view.folders.map((f) => [f.conversation, f.title])), [view]);
  const agents = useMemo(() => distinct(view.folders, (f) => f.agent), [view]);
  const select = (label: string, all: string, value: string, options: [string, string][], change: (v: string) => void) => (
    <label className="cy-field me-filter">
      <span className="small muted">{label}</span>
      <select className="text-input" value={value} onChange={(e) => change(e.target.value)}>
        <option value="">{all}</option>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
  return (
    <div className="me-filters" role="group" aria-label={t('ui.memory.filter.label')}>
      <label className="cy-field me-search">
        <span className="small muted">{t('ui.memory.filter.search')}</span>
        <input className="text-input" type="search" value={filters.search} placeholder={t('ui.memory.filter.searchPlaceholder')} onChange={(e) => set({ ...filters, search: e.target.value })} />
      </label>
      {select(t('ui.memory.filter.conversation'), t('ui.memory.filter.conversationAll'), filters.conversation, conversations.map((c) => [c, titles.get(c) && titles.get(c) !== c ? `${titles.get(c)} (${c})` : c]), (v) => set({ ...filters, conversation: v }))}
      {select(t('ui.memory.filter.agent'), t('ui.memory.filter.agentAll'), filters.agent, agents.map((a) => [a, agentName(team, a)]), (v) => set({ ...filters, agent: v }))}
      {select(t('ui.memory.filter.kind'), t('ui.memory.filter.kindAll'), filters.kind, NOTE_KIND_LIST.map((k) => [k, t(KIND_LABEL[k])]), (v) => set({ ...filters, kind: v as NoteFilters['kind'] }))}
      <button type="button" className={`filter ${filters.waiting ? 'on' : ''}`} aria-pressed={filters.waiting} onClick={() => set({ ...filters, waiting: !filters.waiting })}>{t('ui.memory.filter.waiting')}</button>
      <button type="button" className={`filter ${filters.left ? 'on' : ''}`} aria-pressed={filters.left} onClick={() => set({ ...filters, left: !filters.left })}>{t('ui.memory.filter.left')}</button>
      {isFiltering(filters) && <button type="button" className="btn cy-mini" onClick={() => set(NO_FILTERS)}>{t('ui.memory.filter.clear')}</button>}
    </div>
  );
}

/** One line of the list: the title, what it is, who wrote it and what the person should know before opening it. */
function Row({ n, who, open, onToggle, onChanged }: { n: NoteItem; /** The agent that wrote it, in words. */ who: (by: string) => string; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const t = useT();
  return (
    <li className="me-item" data-unsafe={n.unsafe || undefined}>
      <button type="button" className="cy-run-row" aria-expanded={open} aria-label={t('ui.memory.row.open', { title: n.title || n.id })} onClick={onToggle}>
        <span className="cy-run-main">
          <span className="cy-run-title">{n.title || n.id}</span>
          <span className="faint small">{[n.kind ? t(KIND_LABEL[n.kind]) : t('ui.memory.kind.unknown'), t('ui.memory.row.by', { who: who(n.by) }), new Date(n.at).toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })].join(' · ')}</span>
          <span className="me-badges">
            {badgesOf(n).map((b) => <span key={b} className={`badge ${b === 'old' || b === 'left' ? 'badge-quiet' : 'badge-block'}`}>{t(BADGE_LABEL[b])}</span>)}
          </span>
        </span>
      </button>
      {open && <div className="me-open"><NotePanel note={n} who={who} onChanged={onChanged} /></div>}
    </li>
  );
}

type Removal = { conversation: string; agent?: string };

export function MemoryScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const team = useRunConfig()?.agents.team;
  const [view, setView] = useState<MemoryListView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<NoteFilters>(NO_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Removal | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void memoryApi.list().then(
      (v) => {
        setView(v);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => {
    load();
    moduleEvents.addEventListener(MEMORY_EVENT, load);
    window.addEventListener('focus', load);
    return () => {
      moduleEvents.removeEventListener(MEMORY_EVENT, load);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const titleOf = useCallback((conversation: string) => view?.folders.find((f) => f.conversation === conversation)?.title ?? conversation, [view]);
  const filtering = isFiltering(filters);
  const shown = useMemo(() => filterNotes(view?.items ?? [], filters, titleOf), [view, filters, titleOf]);
  const groups = useMemo(() => (view ? groupNotes(view, shown, filtering) : []), [view, shown, filtering]);

  const confirmRemoval = async (): Promise<void> => {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      const done = await memoryApi.removeFolder(removing.conversation, removing.agent);
      if (!done.ok) setError(done.text);
      setRemoving(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const same = (a: Removal | null, conversation: string, agent?: string): boolean => a?.conversation === conversation && a.agent === agent;
  const confirmBlock = (what: string) => (
    <div className="me-confirm" role="alertdialog" aria-label={what}>
      <p>{what}</p>
      <div className="row">
        <button type="button" className="btn btn-red" disabled={busy} onClick={() => void confirmRemoval()}>{t('ui.memory.folder.yes')}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setRemoving(null)}>{t('ui.memory.folder.no')}</button>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.memory.title')}</h1>
          </div>
          {view && <span className="faint">{t('ui.memory.shown', { shown: shown.length, total: view.items.length })}</span>}
        </header>
        <p className="small muted">{t('ui.memory.lead')}</p>
        {error && <div className="error" role="alert">{error} {t('ui.memory.loadError')}</div>}
        {view && !view.enabled && <p className="me-notice" role="status">{t('ui.memory.off')}</p>}
        {view && view.skipped > 0 && <p className="small muted">{t('ui.memory.skipped', { count: view.skipped })}</p>}
        {!view && !error && <span className="spinner" aria-label={t('ui.memory.loading')} />}
        {view && view.items.length > 0 && <Filters view={view} filters={filters} set={setFilters} />}
        {view && !groups.length && <p className="dash-calm">{t(filtering ? 'ui.memory.emptyFilter' : 'ui.memory.empty')}</p>}
        {groups.map((g) => (
          <section key={g.conversation} className="panel me-conv" aria-label={t('ui.memory.conversation.label', { title: g.title })}>
            <div className="row spread">
              <div className="me-conv-title">
                <strong>{g.title}</strong>
                {g.title !== g.conversation && <span className="mono faint small">{g.conversation}</span>}
              </div>
              <button type="button" className="btn cy-mini" disabled={busy} onClick={() => setRemoving({ conversation: g.conversation })}>{t('ui.memory.conversation.remove')}</button>
            </div>
            {same(removing, g.conversation) && confirmBlock(t('ui.memory.conversation.confirm', { title: g.title }))}
            {g.agents.map((a) => (
              <div key={a.agent} className="me-folder">
                <div className="row spread">
                  <span className="row me-folder-name">
                    <strong>{agentName(team, a.agent)}</strong>
                    <span className="mono faint small">{a.agent}</span>
                    {a.left && <span className="badge badge-quiet">{t('ui.memory.badge.left')}</span>}
                  </span>
                  <button type="button" className="btn cy-mini" disabled={busy} onClick={() => setRemoving({ conversation: g.conversation, agent: a.agent })}>{t('ui.memory.folder.remove')}</button>
                </div>
                {same(removing, g.conversation, a.agent) && confirmBlock(t('ui.memory.folder.confirm', { agent: agentName(team, a.agent) }))}
                {a.notes.length === 0 ? (
                  <p className="small muted">{t('ui.memory.folder.empty')}</p>
                ) : (
                  <ul className="cy-run-list" aria-label={t('ui.memory.list.label', { agent: agentName(team, a.agent) })}>
                    {a.notes.map((n) => {
                      const key = `${n.conversation}/${n.agent}/${n.id}`;
                      return <Row key={key} n={n} who={(by) => agentName(team, by)} open={openId === key} onToggle={() => setOpenId(openId === key ? null : key)} onChanged={load} />;
                    })}
                  </ul>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
