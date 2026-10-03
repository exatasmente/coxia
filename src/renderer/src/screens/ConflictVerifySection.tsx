import { useEffect, useState } from 'react';
import { errorText } from '../api';
import { conflictApi } from '../conflictApi';
import { VERIFY_SUGGESTION } from '../conflictVerifyDefaults';
import { tNodes, useT } from '../i18n';
import { isWeb } from '../platform';
import '../conflict.css';

const EXAMPLE_COMMAND = 'source ~/.nvm/nvm.sh; nvm use 18 >/dev/null; ln -sfn "$CLONE_DIR/node_modules" node_modules; npx jest'; // i18n-ignore: shell command

// Per project of this workspace: the shell command that checks a conflict resolution in its worktree before the merge is committed.
export function ConflictVerifySection() {
  const t = useT();
  const [projects, setProjects] = useState<string[]>([]);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [unclaimed, setUnclaimed] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();

  useEffect(() => {
    conflictApi.verifyConfig().then((c) => {
      setProjects(c.projects);
      setCommands(c.commands);
      setSaved(c.commands);
      setUnclaimed(c.unclaimed);
    }).catch((e) => setError(errorText(e)));
  }, []);

  const dirty = JSON.stringify(commands) !== JSON.stringify(saved);

  const save = async () => {
    setError(null);
    setMessage(null);
    try {
      const c = await conflictApi.setVerifyCommands(commands);
      setProjects(c.projects);
      setCommands(c.commands);
      setSaved(c.commands);
      setUnclaimed(c.unclaimed);
      setMessage(t('ui.verify.saved'));
    } catch (e) {
      setError(errorText(e));
    }
  };

  const addProject = () => {
    const p = extra.trim();
    if (!p) return;
    if (!projects.includes(p)) setProjects([...projects, p].sort());
    setExtra('');
  };

  const useHere = (project: string) => {
    if (!projects.includes(project)) setProjects([...projects, project].sort());
    setCommands({ ...commands, [project]: unclaimed[project] });
  };
  const orphans = Object.keys(unclaimed).filter((p) => !(p in commands)).sort();

  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.verify.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {tNodes('ui.verify.hint', { command: <code className="mono">{EXAMPLE_COMMAND}</code> })}
        </p>
        <p className="small muted">{t('ui.verify.scope')}</p>
        {web && <p className="small muted">{t('ui.verify.webNote')}</p>}
      </div>
      {!projects.length && <p className="small muted">{t('ui.verify.empty')}</p>}
      {projects.map((p) => (
        <div key={p} className="settings-row">
          <label htmlFor={`cv-${p}`} className="mono" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{p}</label>
          <div className="row" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
            <input
              id={`cv-${p}`}
              className="text-input mono"
              style={{ minWidth: 0, flex: 1 }}
              placeholder={t('ui.verify.none')}
              disabled={web}
              value={commands[p] ?? ''}
              onChange={(e) => setCommands({ ...commands, [p]: e.target.value })}
            />
            {!web && commands[p] !== VERIFY_SUGGESTION && (
              <button type="button" className="btn" onClick={() => setCommands({ ...commands, [p]: VERIFY_SUGGESTION })}>{t('ui.verify.suggestion')}</button>
            )}
          </div>
        </div>
      ))}
      {!web && (
        <div className="row">
          <input className="text-input mono" style={{ maxWidth: 320 }} placeholder={t('ui.verify.otherPlaceholder')} aria-label={t('ui.verify.otherAria')} value={extra} onChange={(e) => setExtra(e.target.value)} />
          <button type="button" className="btn" disabled={!extra.trim()} onClick={addProject}>{t('ui.verify.add')}</button>
          <button type="button" className="btn btn-dark" disabled={!dirty} onClick={() => void save()}>{t('ui.verify.save')}</button>
        </div>
      )}
      {orphans.length > 0 && (
        <div role="note" className="cv-unclaimed">
          <strong>{t('ui.verify.unclaimed.title')}</strong>
          <span className="small muted">{t('ui.verify.unclaimed.hint')}</span>
          {orphans.map((p) => (
            <div key={p} className="row" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
              <span className="mono small" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{p}</span>
              <span className="mono small muted" style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{unclaimed[p]}</span>
              {!web && <button type="button" className="btn" onClick={() => useHere(p)}>{t('ui.verify.unclaimed.use')}</button>}
            </div>
          ))}
        </div>
      )}
      {message && <div className="small muted">{message}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
