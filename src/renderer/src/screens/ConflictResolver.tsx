import { useEffect, useState } from 'react';
import { type ConflictHunk, type ConflictStep, type HunkChoice, conflictProgress, conflictStep, hunkReady } from '../../../shared/conflict';
import { PARTIAL_HINT } from '../../../shared/partial';
import type { ReleaseAction } from '../../../shared/types';
import { AgentActivity } from '../AgentActivity';
import { api, errorText, plural } from '../api';
import { conflictApi } from '../conflictApi';
import { KIND_MARK, type ViewLine, proposalLines, sideLines } from '../conflictView';
import { withJob } from '../jobs';
import '../conflict.css';

const CHOICE_LABEL: Record<HunkChoice, string> = { proposal: 'Usar proposta', ours: 'Usar branch', theirs: 'Usar main', edit: 'Editar' };

const STEPS: { key: string; label: string; done: ConflictStep[] }[] = [
  { key: 'prepare', label: 'Preparar', done: ['prepared', 'proposed', 'applied', 'verify-failed', 'push-waiting', 'published'] },
  { key: 'propose', label: 'Propor', done: ['proposed', 'applied', 'verify-failed', 'push-waiting', 'published'] },
  { key: 'apply', label: 'Aplicar e verificar', done: ['applied', 'push-waiting', 'published'] },
  { key: 'publish', label: 'Publicar', done: ['published'] },
];

function Code({ lines, empty }: { lines: ViewLine[]; empty: string }) {
  if (!lines.length) return <div className="cr-empty">{empty}</div>;
  return (
    <pre className="cr-code">
      {lines.map((l, i) => (
        <span key={i} className="cr-line" data-kind={l.kind} data-mark={KIND_MARK[l.kind]}>{l.text || ' '}</span>
      ))}
    </pre>
  );
}

function Side({ title, picked, children }: { title: string; picked: boolean; children: React.ReactNode }) {
  return (
    <div className="cr-side" data-picked={picked}>
      <div className="cr-side-title">{title}{picked ? ' · escolhido' : ''}</div>
      {children}
    </div>
  );
}

function Hunk({ h, index, total, locked, onChoose }: { h: ConflictHunk; index: number; total: number; locked: boolean; onChoose: (id: string, choice: HunkChoice, edited?: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const choose = async (choice: HunkChoice, edited?: string) => {
    setError(null);
    try {
      await onChoose(h.id, choice, edited);
      if (choice !== 'edit') setEditing(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const startEdit = () => {
    setDraft(h.edited ?? h.proposal ?? h.ours);
    setEditing(true);
  };

  const proposal = h.choice === 'edit' && h.edited !== null ? h.edited : h.proposal;
  const proposalLabel = h.choice === 'edit' && h.edited !== null ? 'Sua edição' : 'Proposta';
  const noMain = h.whole && h.theirsGone;
  const noBranch = h.whole && h.oursGone;

  return (
    <div className="cr-hunk" data-chosen={hunkReady(h)}>
      <div className="row spread" style={{ gap: 8 }}>
        <span className="small muted">{h.whole ? 'Arquivo inteiro' : `Trecho ${index + 1} de ${total}`}</span>
        <span className="row" style={{ gap: 6 }}>
          {h.confidence && <span className={`badge ${h.confidence === 'alta' ? 'badge-now' : h.confidence === 'media' ? 'badge-ask' : 'badge-block'}`}>confiança {h.confidence === 'media' ? 'média' : h.confidence}</span>}
          {hunkReady(h) && <span className="badge badge-quiet">{CHOICE_LABEL[h.choice as HunkChoice].replace('Usar ', '')}</span>}
        </span>
      </div>

      <div className="cr-sides">
        <Side title="Branch" picked={h.choice === 'ours'}>
          <Code lines={sideLines(h.ours, h.base, 'ours')} empty={noBranch ? 'a branch removeu este arquivo' : 'a branch não acrescentou nada aqui'} />
        </Side>
        <Side title="Main" picked={h.choice === 'theirs'}>
          <Code lines={sideLines(h.theirs, h.base, 'theirs')} empty={noMain ? 'a main removeu este arquivo' : 'a main não acrescentou nada aqui'} />
        </Side>
        <Side title={proposalLabel} picked={h.choice === 'proposal' || h.choice === 'edit'}>
          {proposal !== null ? (
            <Code lines={proposalLines(proposal, h)} empty="proposta vazia: o trecho some" />
          ) : (
            <div className="cr-empty">{h.sensitive ? 'Arquivo com nome de segredo: o agente não lê. Decida você.' : 'Sem proposta ainda.'}</div>
          )}
        </Side>
      </div>

      {h.partial && <p className="cr-note" style={{ color: 'var(--amber-ink)' }}>{PARTIAL_HINT}</p>}
      {h.explanation && <p className="cr-note">{h.explanation}</p>}
      {h.test && <p className="cr-note muted"><strong>Testar:</strong> {h.test}</p>}

      {editing && (
        <>
          <textarea className="cr-edit" aria-label="Texto final do trecho" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="cr-picks">
            <button type="button" className="btn btn-dark" disabled={locked} onClick={() => void choose('edit', draft)}>Usar este texto</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </>
      )}

      <div className="cr-picks" role="group" aria-label="Decisão do trecho">
        {h.proposal !== null && <button type="button" className={`btn ${h.choice === 'proposal' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'proposal'} disabled={locked} onClick={() => void choose('proposal')}>{CHOICE_LABEL.proposal}</button>}
        <button type="button" className={`btn ${h.choice === 'ours' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'ours'} disabled={locked} onClick={() => void choose('ours')}>{CHOICE_LABEL.ours}</button>
        <button type="button" className={`btn ${h.choice === 'theirs' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'theirs'} disabled={locked} onClick={() => void choose('theirs')}>{CHOICE_LABEL.theirs}</button>
        <button type="button" className={`btn ${h.choice === 'edit' ? 'btn-on' : ''}`} aria-pressed={h.choice === 'edit'} disabled={locked} onClick={startEdit}>{CHOICE_LABEL.edit}</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

// The in-app resolution of a release conflict: prepare → propose → review → apply and verify → publish.
export function ConflictResolver({ action }: { action: ReleaseAction }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [busySince, setBusySince] = useState<number>();
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string | null | undefined>(undefined);
  const [skipTests, setSkipTests] = useState(false);
  const [confirm, setConfirm] = useState<'commit' | 'push' | 'discard' | null>(null);
  const [push, setPush] = useState<ReleaseAction | null>(null);

  const r = action.resolve ?? null;
  const step = conflictStep(action);
  const project = String((action.unit ?? {}).project_path ?? '');
  const files = r?.files ?? [];
  const hunks = files.flatMap((f) => f.hunks);
  const undecided = hunks.filter((h) => !hunkReady(h)).length;
  const proposals = hunks.filter((h) => h.proposal !== null && !hunkReady(h)).length;
  const reviewing = step === 'prepared' || step === 'proposed';
  const working = !!busy || !!r?.busy;
  const pushId = r?.pushId ?? null;

  useEffect(() => {
    let live = true;
    conflictApi.verifyConfig().then((c) => live && setCommand(c.commands[project] ?? null)).catch(() => live && setCommand(null));
    return () => {
      live = false;
    };
  }, [project, step]);

  useEffect(() => {
    if (!pushId) {
      setPush(null);
      return;
    }
    let live = true;
    api.listActions().then((all) => live && setPush(all.find((a) => a.id === pushId) ?? null)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pushId, action]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setBusySince(Date.now());
    setError(null);
    try {
      await withJob(`resolve:${action.id}`, fn);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
    setConfirm(null);
  };

  const choose = async (hunkId: string, choice: HunkChoice, edited?: string) => {
    await api.conflictChoose(action.id, hunkId, choice, edited);
  };

  if (action.state === 'skipped') return null;

  return (
    <section className="panel cr" style={{ padding: '18px 20px' }} aria-label="Resolução do conflito">
      <div className="row spread">
        <h2 className="section-title">Resolver aqui</h2>
        <span className="badge badge-ask">{conflictProgress(action)}</span>
      </div>
      <div className="cr-steps">
        {STEPS.map((s) => {
          const done = s.done.includes(step);
          const now = !done && (STEPS.find((x) => !x.done.includes(step))?.key === s.key);
          return <span key={s.key} className="cr-step" data-state={done ? 'done' : now ? 'now' : 'todo'}>{done ? '✓ ' : ''}{s.label}</span>;
        })}
      </div>

      {step === 'none' && (
        <>
          <p className="cr-note">
            Cria uma worktree temporária a partir do seu clone local (o seu trabalho no clone não é tocado), faz o merge da main na branch e mostra cada trecho em conflito.
            Tudo fica na sua máquina até você dizer “sim” ao push.
          </p>
          <div className="row">
            <button type="button" className="btn btn-amber" disabled={working} onClick={() => void run('Preparando a worktree…', () => api.conflictPrepare(action.id))}>
              {busy ? <span className="spinner" /> : null} Preparar a worktree
            </button>
          </div>
        </>
      )}

      {r && reviewing && (
        <>
          <p className="cr-note muted mono" style={{ wordBreak: 'break-all' }}>{r.worktree}</p>
          {r.proposalSummary && <p className="cr-note">{r.proposalSummary}</p>}
          {hunks.length === 0 && <p className="cr-note">A main entrou sem conflito nesta branch: não há trecho para decidir. Verifique e publique a branch sincronizada.</p>}
          <div className="row" hidden={hunks.length === 0}>
            <button type="button" className="btn btn-dark" disabled={working} onClick={() => void run('O agente está propondo a resolução…', () => api.conflictPropose(action.id))}>
              {busy?.startsWith('O agente') ? <span className="spinner" /> : null} {step === 'proposed' ? 'Pedir outra proposta' : 'Pedir proposta ao agente'}
            </button>
            {proposals > 0 && (
              <button type="button" className="btn" disabled={working} onClick={() => void run('', () => choose('*', 'proposal'))}>Usar a proposta em {plural(proposals, 'trecho', 'trechos')}</button>
            )}
          </div>
          {files.map((f) => (
            <div key={f.path} className="cr-file">
              <div className="cr-file-name">{f.path}</div>
              {f.hunks.map((h, i) => (
                <Hunk key={h.id} h={h} index={i} total={f.hunks.length} locked={working} onChoose={choose} />
              ))}
            </div>
          ))}

          <div className="cr-file">
            <h3 className="section-title">Aplicar e verificar</h3>
            {command ? (
              <p className="cr-note">Comando de verificação de {project}: <code className="mono">{command}</code></p>
            ) : (
              <>
                <p className="cr-note">Nenhum comando de verificação configurado para {project || 'este projeto'} (Configurações › Verificação de conflitos).</p>
                <label className="check-row">
                  <input type="checkbox" checked={skipTests} onChange={() => setSkipTests(!skipTests)} />
                  <span><span style={{ fontWeight: 600, display: 'block' }}>Seguir sem testes</span><span className="small muted">Aplica e commita o merge sem rodar nada. Confirme só se vai testar por fora.</span></span>
                </label>
              </>
            )}
            <div className="row">
              <button type="button" className="btn btn-dark" disabled={working || undecided > 0 || (!command && !skipTests)} onClick={() => void run(command ? 'Aplicando e verificando…' : 'Aplicando…', () => api.conflictApply(action.id, { skipTests: !command && skipTests }))}>
                {busy?.startsWith('Aplicando') ? <span className="spinner" /> : null} Aplicar e verificar
              </button>
              {undecided > 0 && <span className="small muted">Falta decidir {plural(undecided, 'trecho', 'trechos')}.</span>}
            </div>
          </div>
        </>
      )}

      {r && (step === 'verify-failed' || step === 'applied') && (
        <div className="cr-file">
          {r.verify?.skipped ? (
            <p className="cr-note">Aplicado sem testes, como você confirmou.</p>
          ) : (
            <>
              <div className="row" style={{ gap: 8 }}>
                <span className={`badge ${r.verify?.exitCode === 0 ? 'badge-now' : 'badge-block'}`}>{r.verify?.exitCode === 0 ? 'verificação passou' : `verificação terminou com código ${r.verify?.exitCode}`}</span>
                <code className="small mono" style={{ overflowWrap: 'anywhere' }}>{r.verify?.command}</code>
              </div>
              <pre className="cr-log">{r.verify?.tail || '(sem saída)'}</pre>
              {r.verify?.log && <p className="small faint mono" style={{ wordBreak: 'break-all' }}>Log completo: {r.verify.log}</p>}
            </>
          )}
          {step === 'verify-failed' && <p className="cr-note">Julgue a saída: a main pode ter falhas que já existiam. O commit só sai se você pedir.</p>}
          <div className="row">
            {confirm === 'commit' ? (
              <button type="button" className="btn btn-red" disabled={working} onClick={() => void run('Commitando o merge…', () => api.conflictCommit(action.id))}>Confirmar: commitar assim mesmo</button>
            ) : (
              <button type="button" className="btn btn-dark" disabled={working} onClick={() => (step === 'verify-failed' ? setConfirm('commit') : void run('Commitando o merge…', () => api.conflictCommit(action.id)))}>
                {step === 'verify-failed' ? 'Commitar mesmo assim' : 'Commitar o merge'}
              </button>
            )}
            <button type="button" className="btn" disabled={working} onClick={() => void run('Reabrindo os conflitos…', () => api.conflictReopen(action.id))}>Reabrir a resolução</button>
          </div>
        </div>
      )}

      {r && step === 'push-waiting' && (
        <div className="cr-file">
          <h3 className="section-title">Publicar</h3>
          <p className="cr-note">
            Merge commitado na worktree (<span className="mono">{r.commit?.slice(0, 9)}</span>): “Merge branch 'main' into '{r.branch}'”.
            Publicar faz <span className="mono">git push origin HEAD:refs/heads/{r.branch}</span>, só fast-forward, sem force. Antes de enviar, a branch é buscada de novo e o envio é recusado se ela mudou desde o preparo.
          </p>
          {push?.state === 'failed' && <div className="error" style={{ whiteSpace: 'pre-wrap' }}>O envio falhou: {push.output}</div>}
          <div className="row">
            {confirm === 'push' ? (
              <button type="button" className="btn btn-red" disabled={working || !pushId} onClick={() => void run('Enviando…', () => api.approveAction(pushId as string))}>
                {busy === 'Enviando…' ? <span className="spinner" /> : null} Confirmar: fazer push em {r.branch}
              </button>
            ) : (
              <button type="button" className="btn btn-dark" disabled={working || !pushId} onClick={() => setConfirm('push')}>Seguir com o push</button>
            )}
            {confirm === 'push' && <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancelar</button>}
          </div>
        </div>
      )}

      {r && step === 'published' && (
        <p className="cr-note">Publicado em {r.branch}. A worktree foi removida. A atualização do comentário do QA aparece em Ações de release, com o seu próprio “sim”.</p>
      )}

      {busy && <div className="row faint"><span className="spinner" /> {busy}</div>}
      {busy && <AgentActivity jobId={`resolve:${action.id}`} since={busySince} />}
      {!busy && r?.busy && <div className="row faint"><span className="spinner" /> {r.busy}</div>}
      {error && <div className="error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}

      {r && step !== 'published' && (
        <div className="row">
          {confirm === 'discard' ? (
            <button type="button" className="btn btn-red" disabled={working} onClick={() => void run('Descartando…', () => api.conflictDiscard(action.id))}>Confirmar: descartar a worktree e as escolhas</button>
          ) : (
            <button type="button" className="btn" disabled={working} onClick={() => setConfirm('discard')}>Descartar</button>
          )}
          {confirm === 'discard' && <button type="button" className="btn" onClick={() => setConfirm(null)}>Cancelar</button>}
        </div>
      )}
    </section>
  );
}
