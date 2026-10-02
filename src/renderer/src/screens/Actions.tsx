import { useState } from 'react';
import { conflictProgress } from '../../../shared/conflict';
import { stageText } from '../../../shared/cycles/stages';
import type { ReleaseAction } from '../../../shared/types';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { busyText, jobs, useJobs } from '../useJobs';
import { BackIcon } from './icons';

const STATE_LABEL: Record<ReleaseAction['state'], string> = {
  pending: 'aguardando você',
  running: 'executando',
  done: 'feito',
  skipped: 'não seguido',
  failed: 'falhou',
};

function title(a: ReleaseAction): string {
  if (a.kind === 'gitlab') return a.summary ?? 'Ação no GitLab';
  if (a.kind === 'sync') return `Sincronizar #${a.issue} com a main`;
  if (a.kind === 'qa-comment') return `Atualizar o comentário do QA na #${a.issue}`;
  if (a.kind === 'conflict-push') return a.summary ?? `Publicar a resolução do conflito da #${a.issue}`;
  return `Conflito na #${a.issue} ao sincronizar com a main`;
}

function what(a: ReleaseAction): string {
  if (a.kind === 'gitlab') return 'Escreve no GitLab, visível ao time. Veja abaixo exatamente o que vai ser enviado.';
  if (a.kind === 'sync')
    return `Faz merge da main em ${a.mrs.map((m) => m.branch).join(', ')} e push (fast-forward, sem force-push). ${a.retest ? 'A release mexeu em arquivos do MR: o QA precisa retestar.' : 'A release não mexeu em arquivos do MR: sem reteste.'}`;
  if (a.kind === 'qa-comment')
    return a.noteId ? `Edita no lugar o comentário de pipelines do QA (nota ${a.noteId}), visível ao time na issue.` : 'Publica o comentário de sincronização da ferramenta na issue, visível ao time.';
  if (a.kind === 'conflict-push') return 'Push da branch com o merge da main já resolvido e verificado na worktree local: fast-forward, sem force, visível ao time. Antes de enviar, a branch é buscada de novo e o envio é recusado se ela mudou.';
  return 'A call explica o conflito; a resolução é feita na tela dele, numa worktree local. Nada vai para o GitLab sem o seu “sim” ao push.';
}

function ActionCard({ a, go }: { a: ReleaseAction; go: (s: Screen) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const open = a.state === 'pending' || a.state === 'failed';

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  // The release action itself is told to the app by main (actions event); the jobs keep the busy state and the preview text.
  const running = useJobs<string>(`action:${a.id}:`, {
    done: (text, job) => {
      if (job.key.endsWith(':preview')) setPreview(text);
    },
    failed: (message) => setError(message),
  });
  const busy = busyText(running, localBusy);
  const start = (op: 'preview' | 'approve', label: string, fn: () => Promise<string | unknown>) => {
    setError(null);
    jobs.launch(`action:${a.id}:${op}`, { label: `${label}: ${title(a)}`, busy: op === 'preview' ? 'Simulando…' : 'Executando…', screen: { name: 'actions' } }, async () => {
      const r = await fn();
      return typeof r === 'string' ? r : '';
    });
  };

  return (
    <section className="panel" style={{ padding: 20, gap: 12, borderColor: a.kind === 'conflict' && open ? 'var(--amber-line)' : undefined }}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title(a)}</h2>
            {a.release && <span className="badge badge-quiet">release {a.release}</span>}
            <span className={`badge ${a.state === 'done' ? 'badge-now' : a.state === 'failed' ? 'badge-block' : a.state === 'pending' ? 'badge-ask' : 'badge-quiet'}`}>
              {a.kind === 'conflict' && a.state === 'skipped' ? 'tratado fora' : STATE_LABEL[a.state]}
            </span>
            {a.kind === 'conflict' && open && a.resolve && <span className="badge badge-ask">{conflictProgress(a)}</span>}
            {a.kind === 'conflict' && a.state === 'done' && a.resolve?.publishedAt && <span className="badge badge-quiet">publicado</span>}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>{a.issueTitle} · {stageText(a.stage)}</div>
        </div>
      </div>

      <div className="row" style={{ gap: 8 }}>
        {a.mrs.map((m) => (
          <a key={m.ref} className="badge badge-quiet mono" href={m.url} target="_blank" rel="noreferrer">
            {m.ref} · {m.behind} atrás
          </a>
        ))}
      </div>
      <p className="small" style={{ lineHeight: 1.5 }}>{what(a)}</p>

      {a.files.length > 0 && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            {a.kind === 'conflict' ? `${a.files.length} arquivo(s) em conflito` : a.kind === 'conflict-push' ? `${a.files.length} arquivo(s) resolvido(s)` : `${a.files.length} arquivo(s) do MR que a release também mudou`}
          </summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{a.files.join('\n')}</pre>
        </details>
      )}

      {a.kind === 'qa-comment' && a.currentBody && a.proposedBody && (
        <div className="quad" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          <div style={{ background: 'var(--surface-2)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>Hoje na issue</div>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)' }}>{a.currentBody}</pre>
          </div>
          <div style={{ background: 'var(--teal-soft)' }}>
            <div className="section-title" style={{ marginBottom: 6 }}>Vai ficar</div>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)' }}>{a.proposedBody}</pre>
          </div>
        </div>
      )}
      {a.output && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 220, overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{a.output}</pre>}
      {preview && <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxHeight: 320, overflow: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 10 }}>{preview}</pre>}
      {error && <div className="error">{error}</div>}

      {open && (
        <div className="row">
          {a.kind === 'conflict' ? (
            <button type="button" className="btn btn-amber" onClick={() => go({ name: 'conflict', id: a.id })}>{a.resolve ? 'Continuar a resolução' : 'Abrir call e resolver o conflito'}</button>
          ) : (
            <>
              {!(a.kind === 'qa-comment' && a.proposedBody) && (
                <button type="button" className="btn" disabled={!!busy} onClick={() => start('preview', 'Simulação', () => api.previewAction(a.id))}>
                  {busy === 'Simulando…' ? <span className="spinner" /> : null} {a.kind === 'sync' ? 'Ver simulação' : a.kind === 'gitlab' || a.kind === 'conflict-push' ? 'Ver o envio' : 'Ver o comentário'}
                </button>
              )}
              {confirming ? (
                <button type="button" className="btn btn-red" disabled={!!busy} onClick={() => { setConfirming(false); start('approve', 'Execução', () => api.approveAction(a.id)); }}>
                  {busy === 'Executando…' ? <span className="spinner" /> : null} Confirmar: {a.kind === 'sync' ? 'fazer merge e push' : a.kind === 'conflict-push' ? 'fazer push da resolução' : a.kind === 'gitlab' ? 'executar no GitLab' : 'publicar na issue'}
                </button>
              ) : (
                <button type="button" className="btn btn-dark" disabled={!!busy} onClick={() => setConfirming(true)}>Seguir</button>
              )}
            </>
          )}
          {confirming ? (
            <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirming(false)}>Cancelar</button>
          ) : (
            a.kind === 'conflict-push' ? (
              <button type="button" className="btn" onClick={() => go({ name: 'conflict', id: String((a.unit ?? {}).conflictId ?? '') })}>Abrir o conflito</button>
            ) : (
              <button type="button" className="btn" disabled={!!busy} onClick={() => void run('', () => api.skipAction(a.id))}>{a.kind === 'conflict' ? 'Já tratei fora' : 'Agora não'}</button>
            )
          )}
        </div>
      )}
      {a.state === 'running' && <div className="row faint"><span className="spinner" /> Executando…</div>}
    </section>
  );
}

export function Actions({ actions, go }: { actions: ReleaseAction[]; go: (s: Screen) => void }) {
  const [checking, setChecking] = useState<string | null>(null);
  const pending = actions.filter((a) => a.state === 'pending' || a.state === 'running' || a.state === 'failed');
  const past = actions.filter((a) => !pending.includes(a));

  const running = useJobs<string>('release:', {
    done: (text) => setChecking(text),
    failed: (message) => setChecking(`Falhou: ${message}`),
  });
  const detecting = running.length > 0;

  const detect = () => jobs.launch('release:detect', { label: 'Conferência da release', busy: 'Conferindo a release…', screen: { name: 'actions' } }, () => api.detectRelease());

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1100, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Ações de release</h1>
          </div>
          <div className="row">
            {detecting ? <span className="small muted">Conferindo a release…</span> : checking && <span className="small muted">{checking}</span>}
            <button type="button" className="btn" disabled={detecting} onClick={() => detect()}>Conferir release agora</button>
          </div>
        </header>
        <p className="small muted">
          Vindas da skill post-release-sync. Nada é executado sem o seu “seguir” e a confirmação; o comentário do QA pede um novo “seguir” depois da sincronização.
        </p>
        <h2 className="section-title">Aguardando você · {pending.length}</h2>
        {!pending.length && <p className="small faint">Nenhuma ação pendente.</p>}
        {pending.map((a) => <ActionCard key={a.id} a={a} go={go} />)}
        {past.length > 0 && <h2 className="section-title" style={{ marginTop: 12 }}>Histórico · {past.length}</h2>}
        {past.map((a) => <ActionCard key={a.id} a={a} go={go} />)}
      </div>
    </div>
  );
}
