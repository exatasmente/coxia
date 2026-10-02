import { useEffect, useState } from 'react';
import type { BranchHealth, RadarFinding, RadarKind, RadarResult, RadarSide } from '../../../shared/radar';
import type { Screen } from '../App';
import { api, errorText, moduleEvents, plural } from '../api';
import { BackIcon } from './icons';
import { jobs, useJobs } from '../useJobs';
import { describeBranch, refreshHealth, useWorktreeHealth } from './radarSlots';

const KIND: Record<RadarKind, { label: string; badge: string }> = {
  'same-fix': { label: 'Mesma correção', badge: 'badge-block' },
  dependency: { label: 'Dependência de código não mergeado', badge: 'badge-ask' },
  file: { label: 'Colisão de arquivo', badge: 'badge-ask' },
  scope: { label: 'Sobreposição de escopo', badge: 'badge-quiet' },
};

function Side({ s }: { s: RadarSide }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="mono small">#{s.iid}</span>
        <a className="mono small muted" href={s.url} target="_blank" rel="noreferrer">{s.mr}</a>
        <span className="badge badge-quiet">{s.stage ?? 'sem estágio'}</span>
      </div>
      <div className="small" style={{ marginTop: 2 }}>{s.title}</div>
      <div className="faint mono">{s.branch} → {s.target}</div>
    </div>
  );
}

function Finding({ f }: { f: RadarFinding }) {
  const [copied, setCopied] = useState(false);
  const isNew = Date.now() - new Date(f.firstSeen).getTime() < 24 * 3600_000;
  return (
    <section className="panel" style={{ padding: 18, gap: 12, borderColor: f.kind === 'same-fix' ? 'var(--amber-line)' : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        <span className={`badge ${KIND[f.kind].badge}`}>{KIND[f.kind].label}</span>
        {f.silent && <span className="badge badge-e3">merge silencioso</span>}
        {isNew && <span className="badge badge-now">novo</span>}
        <span className="faint">desde {new Date(f.firstSeen).toLocaleDateString('pt-BR')}</span>
      </div>
      <div className="quad" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <div>
          {f.kind === 'dependency' && <div className="section-title" style={{ marginBottom: 4 }}>Já adiantada</div>}
          <Side s={f.a} />
        </div>
        <div>
          {f.kind === 'dependency' && <div className="section-title" style={{ marginBottom: 4 }}>Entra depois</div>}
          <Side s={f.b} />
        </div>
      </div>
      <p className="small" style={{ lineHeight: 1.5 }}>{f.summary.replace(/`/g, '')}</p>
      {(f.files.length > 0 || f.scopes.length > 0) && (
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            {f.files.length ? plural(f.files.length, 'arquivo em comum', 'arquivos em comum') : plural(f.scopes.length, 'módulo em comum', 'módulos em comum')}
          </summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
            {[...f.files, ...f.scopes.map((s) => `módulo ${s}`)].join('\n')}
          </pre>
          {f.regions.length > 0 && (
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
              {f.regions.map((r) => `${r.file}\n  #${f.a.iid} linhas ${r.a[0]}-${r.a[1]} · #${f.b.iid} linhas ${r.b[0]}-${r.b[1]} · distância ${r.distance}`).join('\n')}
            </pre>
          )}
        </details>
      )}
      <div className="item" style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
        <div className="section-title">O que fazer</div>
        <div className="small" style={{ color: 'var(--teal-ink)', lineHeight: 1.5 }}>{f.recommendation}</div>
        {f.identicalLines >= 3 && f.kind === 'same-fix' && (
          <div className="small" style={{ color: 'var(--teal-ink)' }}>{f.identicalLines} linhas adicionadas são idênticas nas duas MRs.</div>
        )}
      </div>
      {f.collideCommand && (
        <div className="row" style={{ gap: 8 }}>
          <code className="mono small" style={{ flex: '1 1 400px', wordBreak: 'break-all' }}>{f.collideCommand}</code>
          <button
            type="button"
            className="btn"
            onClick={() => void api.copy(f.collideCommand ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
          >
            {copied ? 'Copiado' : 'Copiar comando'}
          </button>
        </div>
      )}
    </section>
  );
}

function BranchRow({ b }: { b: BranchHealth }) {
  return (
    <div className="item" style={{ gap: 2 }}>
      <div className="row" style={{ gap: 8 }}>
        <span className="mono small">{b.repo} · {b.branch}</span>
        {b.unpushed > 0 && <span className="badge badge-block">{b.unpushed} sem push</span>}
        {b.dirty > 0 && <span className="badge badge-block">{plural(b.dirty, 'alteração', 'alterações')}</span>}
        {b.conventionNote && <span className="badge badge-ask">fora do padrão</span>}
      </div>
      <div className="faint">{describeBranch(b).replace(`${b.repo} · ${b.branch}: `, '')}</div>
      {b.worktree && <div className="faint mono">{b.worktree}</div>}
      {b.dirtyFiles.length > 0 && (
        <details>
          <summary className="faint" style={{ cursor: 'pointer' }}>arquivos</summary>
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{b.dirtyFiles.join('\n')}</pre>
        </details>
      )}
      <div className="faint">MR vai para {b.base}</div>
    </div>
  );
}

export function Radar({ go }: { go: (s: Screen) => void }) {
  const [result, setResult] = useState<RadarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const health = useWorktreeHealth();

  useEffect(() => {
    void api.invoke<RadarResult | null>('radar:latest').then((r) => setResult((prev) => prev ?? r));
    const on = (e: Event) => setResult((e as CustomEvent<RadarResult>).detail);
    moduleEvents.addEventListener('radar', on);
    return () => moduleEvents.removeEventListener('radar', on);
  }, []);

  const running = useJobs<RadarResult>('radar:', {
    done: (r) => setResult(r),
    failed: (message) => setError(message),
  });
  const busy = running.length > 0;

  const run = () => {
    setError(null);
    jobs.launch('radar:run', { label: 'Radar de colisões', busy: 'Conferindo as MRs abertas…', screen: { name: 'radar' } }, async () => {
      const [r] = await Promise.all([api.invoke<RadarResult>('radar:run'), refreshHealth()]);
      return r;
    });
  };

  const issues = Object.entries(health?.byIssue ?? {}).sort(([a], [b]) => Number(b) - Number(a));

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1100, gap: 18 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Radar</h1>
          </div>
          <div className="row">
            {result && (
              <span className="small muted">
                Conferido às {new Date(result.checkedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {plural(result.mrsChecked, 'MR', 'MRs')}
              </span>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => run()}>
              {busy ? <span className="spinner" /> : null} Conferir agora
            </button>
          </div>
        </header>
        <p className="small muted">
          Cruza os arquivos e os trechos das suas MRs abertas, de atividades diferentes, pelo critério da skill related-work-radar. Só lê: nada é comentado nem alterado no GitLab.
        </p>
        {error && <div className="error">{error}</div>}
        {result?.failed.length ? <div className="error">Não consegui ler: {result.failed.join(' · ')}</div> : null}

        <h2 className="section-title">Colisões entre atividades · {result?.findings.length ?? 0}</h2>
        {!result && !busy && <p className="small faint">Ainda não rodou. Use “Conferir agora”.</p>}
        {result && !result.findings.length && <p className="small faint">Nenhuma colisão entre as MRs abertas.</p>}
        {result?.findings.map((f) => <Finding key={f.key} f={f} />)}

        <h2 className="section-title" style={{ marginTop: 12 }}>Saúde das worktrees · {issues.length} atividades</h2>
        <p className="small muted">
          Leitura dos repositórios em ~/projects pelo estado local. “Sem push” usa os refs remotos da última busca; branches cov/, exp/, local/, backup/ e test/ são locais por definição e ficam de fora.
        </p>
        {!health && <p className="small faint">Lendo as worktrees…</p>}
        {issues.map(([iid, items]) => (
          <section key={iid} className="panel" style={{ padding: 16, gap: 8 }}>
            <div className="mono" style={{ fontWeight: 600 }}>#{iid}</div>
            {items.map((b) => <BranchRow key={`${b.repo}:${b.branch}:${b.worktree}`} b={b} />)}
          </section>
        ))}
        {health && health.unassigned.length > 0 && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>Sem número de issue na branch · {health.unassigned.length}</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {health.unassigned.map((b) => <BranchRow key={`${b.repo}:${b.branch}:${b.worktree}`} b={b} />)}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
