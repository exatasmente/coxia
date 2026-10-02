import { useEffect, useState } from 'react';
import { errorText } from '../api';
import { conflictApi } from '../conflictApi';
import { VERIFY_DEFAULTS } from '../conflictVerifyDefaults';
import { tNodes, useT } from '../i18n';
import { isWeb } from '../platform';

const EXAMPLE_COMMAND = 'source ~/.nvm/nvm.sh; nvm use 18 >/dev/null; ln -sfn "$CLONE_DIR/node_modules" node_modules; npx jest'; // i18n-ignore: shell command

// Per project: the shell command that checks a conflict resolution in its worktree before the merge is committed.
export function ConflictVerifySection() {
  const t = useT();
  const [projects, setProjects] = useState<string[]>([]);
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const web = isWeb();

  useEffect(() => {
    conflictApi.verifyConfig().then((c) => {
      setProjects(c.projects);
      setCommands(c.commands);
      setSaved(c.commands);
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

  return (
    <section className="panel" style={{ padding: 20, gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{t('ui.verify.title')}</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          {tNodes('ui.verify.hint', { command: <code className="mono">{EXAMPLE_COMMAND}</code> })}
        </p>
        {web && <p className="small muted">{t('ui.verify.webNote')}</p>}
      </div>
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
            {!web && VERIFY_DEFAULTS[p] && commands[p] !== VERIFY_DEFAULTS[p] && (
              <button type="button" className="btn" onClick={() => setCommands({ ...commands, [p]: VERIFY_DEFAULTS[p] })}>{t('ui.verify.suggestion')}</button>
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
      {message && <div className="small muted">{message}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
