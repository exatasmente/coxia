import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Screen } from '../../App';
import { api, errorText } from '../../api';
import { LANGUAGES, type Language } from '../../../../shared/config/types';
import type { PromptEntry } from '../../../../shared/cycles/prompts';
import { getLanguage } from '../../../../shared/i18n';
import { useT } from '../../i18n';
import { isWeb } from '../../platform';
import { BackIcon } from '../icons';
import '../cycle/cycle.css';
import './prompts.css';

// The developer mode: every prompt the app sends an agent, read from the catalogs through config:prompts each time the screen opens (a text added in a later version
// shows up without a list here), and the change of one text in one language, kept in the workspace's devCycle.promptOverrides. Ctrl+Shift+I opens and closes it,
// in the desktop window only: the channels are refused to a paired browser (webPolicy.ts), and the shortcut is not bound there.

export const promptsApi = {
  list: () => api.invoke<PromptEntry[]>('config:prompts'),
  set: (id: string, language: Language, text: string | null) => api.invoke<PromptEntry[]>('config:prompt-set', id, language, text),
};

/** Ctrl+Shift+I (Cmd+Shift+I on a Mac) opens the prompt editor from any screen and closes it when it is open. Not bound in a paired browser. */
export function usePromptsShortcut(current: Screen['name'], go: (s: Screen) => void) {
  useEffect(() => {
    if (isWeb()) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey || e.code !== 'KeyI' || e.repeat) return;
      e.preventDefault();
      go({ name: current === 'prompts' ? 'today' : 'prompts' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, go]);
}

const placeholdersOf = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

const LANGUAGE_LABEL: Record<Language, string> = { 'pt-BR': 'ui.prompts.language.pt-BR', en: 'ui.prompts.language.en' };

function Editor({ entry, language, onSaved }: { entry: PromptEntry; language: Language; onSaved: (list: PromptEntry[]) => void }) {
  const t = useT();
  const original = entry.defaults[language] ?? '';
  const stored = entry.override[language];
  const [draft, setDraft] = useState(stored ?? original);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(stored ?? original);
    setError(null);
    setSaved(false);
  }, [entry.id, language, stored, original]);

  const write = async (text: string | null) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await promptsApi.set(entry.id, language, text));
      setSaved(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const changed = draft !== (stored ?? original);
  const placeholders = placeholdersOf(original);
  return (
    <section className="panel pm-editor" aria-label={t('ui.prompts.editor.label', { id: entry.id })}>
      <div className="row spread pm-editor-head">
        <h2 className="pm-id mono">{entry.id}</h2>
        <span className="small faint">{t('ui.prompts.family', { family: entry.family })}</span>
      </div>
      {stored !== undefined && <span className="badge badge-block pm-badge">{t('ui.prompts.badge.changed')}</span>}
      {placeholders.length > 0 && (
        <div className="pm-block">
          <span className="small muted">{t('ui.prompts.placeholders')}</span>
          <div className="pm-chips">{placeholders.map((p) => <code key={p} className="pm-chip">{`{${p}}`}</code>)}</div>
        </div>
      )}
      <label className="cy-field">
        <span className="small muted">{t('ui.prompts.text', { language: t(LANGUAGE_LABEL[language]) })}</span>
        <textarea className="text-input pm-text mono" spellCheck={false} rows={14} maxLength={20_000} value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} />
      </label>
      <p className="small muted">{t('ui.prompts.emptyHint')}</p>
      {error && <div className="error" role="alert">{error}</div>}
      {saved && !changed && <p className="small pm-saved" role="status">{t('ui.prompts.saved')}</p>}
      <div className="row pm-actions">
        <button type="button" className="btn btn-dark" disabled={busy || !changed} onClick={() => void write(draft)}>{t('ui.prompts.save')}</button>
        {changed && <button type="button" className="btn" disabled={busy} onClick={() => setDraft(stored ?? original)}>{t('ui.prompts.discard')}</button>}
        {stored !== undefined && <button type="button" className="btn" disabled={busy} onClick={() => void write(null)}>{t('ui.prompts.restore')}</button>}
      </div>
      {stored !== undefined && (
        <details className="pm-block">
          <summary className="small muted">{t('ui.prompts.original')}</summary>
          <pre className="pm-original mono">{original}</pre>
        </details>
      )}
    </section>
  );
}

export function PromptsScreen({ go }: { go: (s: Screen) => void }) {
  const t = useT();
  const [list, setList] = useState<PromptEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [language, setLanguage] = useState<Language>(getLanguage());
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    void promptsApi.list().then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => load(), [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list ?? []).filter((p) => (!onlyChanged || Object.keys(p.override).length > 0) && (!q || p.id.toLowerCase().includes(q) || (p.override[language] ?? p.defaults[language] ?? '').toLowerCase().includes(q)));
  }, [list, search, onlyChanged, language]);
  const changedCount = (list ?? []).filter((p) => Object.keys(p.override).length > 0).length;
  const open = list?.find((p) => p.id === openId) ?? null;

  return (
    <div className="page">
      <div className="wrap cy-wrap">
        <header className="row spread cy-top">
          <div className="row cy-top-main">
            <button type="button" className="btn icon-btn" aria-label={t('ui.cycle.back')} onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 className="cy-title">{t('ui.prompts.title')}</h1>
          </div>
          {list && <span className="faint">{t('ui.prompts.shown', { shown: shown.length, total: list.length, changed: changedCount })}</span>}
        </header>
        <p className="small muted">{t('ui.prompts.lead')}</p>
        {error && <div className="error" role="alert">{error}</div>}
        {!list && !error && <span className="spinner" aria-label={t('ui.prompts.loading')} />}
        {list && (
          <div className="pm-filters" role="group" aria-label={t('ui.prompts.filter.label')}>
            <label className="cy-field pm-search">
              <span className="small muted">{t('ui.prompts.filter.search')}</span>
              <input className="text-input" type="search" value={search} placeholder={t('ui.prompts.filter.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
            </label>
            <label className="cy-field pm-language">
              <span className="small muted">{t('ui.prompts.filter.language')}</span>
              <select className="text-input" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
                {LANGUAGES.map((l) => <option key={l} value={l}>{t(LANGUAGE_LABEL[l])}</option>)}
              </select>
            </label>
            <button type="button" className={`filter ${onlyChanged ? 'on' : ''}`} aria-pressed={onlyChanged} onClick={() => setOnlyChanged(!onlyChanged)}>{t('ui.prompts.filter.changed')}</button>
          </div>
        )}
        {list && !shown.length && <p className="dash-calm">{t('ui.prompts.empty')}</p>}
        {shown.length > 0 && (
          <div className="pm-layout">
            <ul className="pm-list" aria-label={t('ui.prompts.list.label')}>
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`pm-row ${openId === p.id ? 'on' : ''}`} aria-pressed={openId === p.id} onClick={() => setOpenId(p.id)}>
                    <span className="mono pm-row-id">{p.id}</span>
                    {p.override[language] !== undefined && <span className="badge badge-block">{t('ui.prompts.badge.changed')}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {open ? <Editor entry={open} language={language} onSaved={setList} /> : <p className="dash-calm pm-pick">{t('ui.prompts.pick')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
