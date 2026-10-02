import { useEffect, useState } from 'react';
import { errorText } from '../api';
import { conflictApi } from '../conflictApi';
import { VERIFY_SUGGESTION } from '../conflictVerifyDefaults';
import { isWeb } from '../platform';

// Per project: the shell command that checks a conflict resolution in its worktree before the merge is committed.
export function ConflictVerifySection() {
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
      setMessage('Salvo.');
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
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Verificação de conflitos</h2>
        <p className="small muted" style={{ marginTop: 4 }}>
          Comando de shell que roda na worktree do conflito, depois de aplicar a resolução e antes do commit do merge. Vazio: sem verificação (o app pede um “seguir sem testes”).
          Variáveis: CLONE_DIR (seu clone, de onde dá para ligar o node_modules) e WORKTREE_DIR. Exemplo para um projeto que só testa no Node 18:{' '}
          <code className="mono">source ~/.nvm/nvm.sh; nvm use 18 &gt;/dev/null; ln -sfn "$CLONE_DIR/node_modules" node_modules; npx jest</code>
        </p>
        {web && <p className="small muted">Só a janela do app altera estes comandos: o navegador não pode escolher o que o Aplicar executa.</p>}
      </div>
      {projects.map((p) => (
        <div key={p} className="settings-row">
          <label htmlFor={`cv-${p}`} className="mono" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{p}</label>
          <div className="row" style={{ minWidth: 0, flexWrap: 'nowrap' }}>
            <input
              id={`cv-${p}`}
              className="text-input mono"
              style={{ minWidth: 0, flex: 1 }}
              placeholder="nenhum"
              disabled={web}
              value={commands[p] ?? ''}
              onChange={(e) => setCommands({ ...commands, [p]: e.target.value })}
            />
            {!web && commands[p] !== VERIFY_SUGGESTION && (
              <button type="button" className="btn" onClick={() => setCommands({ ...commands, [p]: VERIFY_SUGGESTION })}>Sugestão (Node)</button>
            )}
          </div>
        </div>
      ))}
      {!web && (
        <div className="row">
          <input className="text-input mono" style={{ maxWidth: 320 }} placeholder="grupo/projeto" aria-label="Outro projeto" value={extra} onChange={(e) => setExtra(e.target.value)} />
          <button type="button" className="btn" disabled={!extra.trim()} onClick={addProject}>Adicionar projeto</button>
          <button type="button" className="btn btn-dark" disabled={!dirty} onClick={() => void save()}>Salvar comandos</button>
        </div>
      )}
      {message && <div className="small muted">{message}</div>}
      {error && <div className="error">{error}</div>}
    </section>
  );
}
