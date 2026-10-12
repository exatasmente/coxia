import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ActivityEntry } from '../../../shared/activity';
import type { ClaudeAnswerResult, ClaudeSessionResult, ClaudeSessionsList, PendingClaudePermission, PermissionDecision } from '../../../shared/claudeSessions';
import { ActivityTree } from '../ActivityTree';
import { buildTree } from '../activityTreeModel';
import { errorText } from '../api';
import { claudeSessionsApi } from '../claudeSessionsApi';
import { type SessionRow, applyLines, asksFor, refusalText, sessionControls, sessionGroups } from '../claudeSessionsView';
import { intlLocale, useT } from '../i18n';

// The machine's Claude Code sessions: the three groups of the list, and one open session in the activity view the runs use, with a message box, its permission
// requests (allow or deny, the person's only), Stop for the app's turn and End for a process the app started. Desktop window only; never shown in a paired browser.

function Group({ title, rows, onOpen }: { title: string; rows: SessionRow[]; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <section className="panel" style={{ padding: 16, gap: 8 }}>
      <h2 className="wz-sub">{title}</h2>
      {!rows.length && <p className="small muted">{t('ui.claude.empty')}</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <li key={r.id} className="row spread" style={{ gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
              <div className="small muted">{r.meta}</div>
            </div>
            <button type="button" className="btn" onClick={() => onOpen(r.id)}>{t('ui.claude.open')}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Asks({ asks, onAnswer }: { asks: PendingClaudePermission[]; onAnswer: (id: string, d: PermissionDecision) => void }) {
  const t = useT();
  if (!asks.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {asks.map((a) => (
        <div key={a.id} className="panel" role="alert" style={{ padding: 12, gap: 8, borderColor: 'var(--warn)' }}>
          <div style={{ fontWeight: 600 }}>{t('ui.claude.ask.title', { tool: a.tool })}</div>
          <pre className="small" style={{ fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', margin: 0 }}>{a.input}</pre>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-dark" onClick={() => onAnswer(a.id, 'allow')}>{t('ui.claude.ask.allow')}</button>
            <button type="button" className="btn" onClick={() => onAnswer(a.id, 'deny')}>{t('ui.claude.ask.deny')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ClaudeSessionsScreen() {
  const t = useT();
  const [list, setList] = useState<ClaudeSessionsList | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [asks, setAsks] = useState<PendingClaudePermission[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [draft, setDraft] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState<string | null>(null);
  const time = useCallback((ms: number) => (ms ? new Date(ms).toLocaleString(intlLocale()) : ''), []);

  const reload = useCallback(async () => {
    try {
      setList(await claudeSessionsApi.list());
      setAsks(await claudeSessionsApi.asks());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    void claudeSessionsApi.folders().then((f) => {
      setFolders(f);
      setFolder((cur) => cur || f[0] || '');
    }, () => undefined);
    const offAsks = claudeSessionsApi.onAsks(setAsks);
    const offState = claudeSessionsApi.onState(() => void reload());
    return () => {
      offAsks();
      offState();
    };
  }, [reload]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setEntries([]);
    setError(null);
    // The whole conversation first; what arrives meanwhile comes again with the next whole read of the follow.
    const off = claudeSessionsApi.onLines((ev) => setEntries((prev) => applyLines(prev, ev, open)));
    void claudeSessionsApi.read(open).then((r) => live && setEntries(r.entries), (e) => live && setError(errorText(e)));
    void claudeSessionsApi.follow(open);
    return () => {
      live = false;
      off();
      void claudeSessionsApi.follow(null).catch(() => undefined);
    };
  }, [open]);

  const say = (r: ClaudeSessionResult | ClaudeAnswerResult): void => setError(refusalText(r, t));
  const act = async <R extends ClaudeSessionResult | ClaudeAnswerResult>(run: () => Promise<R>, after?: (r: R) => void) => {
    setError(null);
    try {
      const r = await run();
      say(r);
      if (r.ok) after?.(r);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const groups = useMemo(() => (list ? sessionGroups(list, t, time) : null), [list, t, time]);
  const nodes = useMemo(() => buildTree(entries), [entries]);

  if (open) {
    const controls = sessionControls(list, open);
    return (
      <div className="page">
        <div className="wrap" style={{ gap: 16 }}>
          <header className="row spread">
            <button type="button" className="btn" onClick={() => setOpen(null)}>{t('ui.claude.back')}</button>
            <div className="row" style={{ gap: 8 }}>
              {controls.canStop && <button type="button" className="btn" onClick={() => void act(() => claudeSessionsApi.stop(open))}>{t('ui.claude.stop')}</button>}
              {controls.canEnd && <button type="button" className="btn" onClick={() => void act(() => claudeSessionsApi.end(open))}>{t('ui.claude.end')}</button>}
            </div>
          </header>
          {controls.copy && <p className="small" role="status" style={{ color: 'var(--warn)' }}>{t('ui.claude.copy')}</p>}
          {error && <div className="error" role="alert">{error}</div>}
          <Asks asks={asksFor(asks, list, open)} onAnswer={(id, d) => void act(() => claudeSessionsApi.answer(id, d))} />
          {entries.length ? <ActivityTree nodes={nodes} /> : <p className="small muted">{t('ui.claude.noLines')}</p>}
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => claudeSessionsApi.send(open, draft), () => setDraft(''));
            }}
          >
            <input className="text-input" style={{ flex: 1 }} value={draft} placeholder={t('ui.claude.message')} aria-label={t('ui.claude.message')} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn btn-accent" disabled={!draft.trim()}>{t('ui.claude.send')}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 16 }}>
        <header className="row spread">
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>{t('ui.claude.title')}</h1>
            <p className="small muted">{t('ui.claude.hint')}</p>
          </div>
          <button type="button" className="btn" onClick={() => void reload()}>{t('ui.claude.refresh')}</button>
        </header>
        {error && <div className="error" role="alert">{error}</div>}
        {list?.cli === 'missing' && <div className="error" role="status">{t('ui.claude.missing', { reason: list.reason })}</div>}
        {!list && !error && <span className="spinner" aria-hidden="true" />}
        {groups && (
          <>
            <Group title={t('ui.claude.group.running')} rows={groups.running} onOpen={setOpen} />
            <Group title={t('ui.claude.group.background')} rows={groups.background} onOpen={setOpen} />
            <Group title={t('ui.claude.group.transcripts')} rows={groups.transcripts} onOpen={setOpen} />
          </>
        )}
        <section className="panel" style={{ padding: 16, gap: 8 }}>
          <h2 className="wz-sub">{t('ui.claude.start.title')}</h2>
          {!folders.length ? (
            <p className="small muted">{t('ui.claude.start.noFolders')}</p>
          ) : (
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  () => claudeSessionsApi.start(folder, first),
                  (r) => {
                    setFirst('');
                    if (r.ok) setOpen(r.sessionId);
                  },
                );
              }}
            >
              <label className="wz-label">
                {t('ui.claude.start.folder')}
                <select className="text-input" value={folder} onChange={(e) => setFolder(e.target.value)}>
                  {folders.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="wz-label">
                {t('ui.claude.start.prompt')}
                <input className="text-input" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <div>
                <button type="submit" className="btn btn-accent" disabled={!first.trim() || !folder}>{t('ui.claude.start.go')}</button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
