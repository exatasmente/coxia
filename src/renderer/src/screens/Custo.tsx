import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustoRow, CustoScope, CustoSummary, CustoWorkspaceRow } from '../../../shared/custo';
import type { Screen } from '../App';
import { api, errorText, moduleEvents } from '../api';
import '../custo.css';
import { jobs, useJobs } from '../useJobs';
import { FalasEconomia } from './FalasCusto';
import { BackIcon } from './icons';

const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`);

const SCOPE_KEY = 'cerimonias.custo.scope';

function savedScope(): CustoScope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'current';
  } catch {
    return 'current';
  }
}

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function Bar({ value, max, color = 'var(--teal)' }: { value: number; max: number; color?: string }) {
  return (
    <div className="custo-bar" style={{ height: 8, borderRadius: 4, background: 'var(--line-2)', overflow: 'hidden' }} aria-hidden="true">
      <div style={{ width: `${max ? Math.min(100, (value / max) * 100) : 0}%`, height: '100%', background: color }} />
    </div>
  );
}

function Tile({ title, row, hint }: { title: string; row: CustoRow; hint?: string }) {
  return (
    <div className="panel" style={{ padding: '14px 18px', minWidth: 190, flex: '1 1 190px', gap: 2 }}>
      <div className="small muted">{title}</div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{usd(row.cost)}</div>
      <div className="small faint">{hint ?? `${row.calls} chamadas · cache ${pct(row.cachePct)}`}</div>
    </div>
  );
}

function ScopeToggle({ scope, data, onChange }: { scope: CustoScope; data: CustoSummary | null; onChange: (s: CustoScope) => void }) {
  const unassigned = data?.unassigned ?? 0;
  return (
    <div className="custo-scope">
      <div className="custo-seg" role="group" aria-label="Quais sessões somar">
        <button type="button" className={`filter${scope === 'current' ? ' on' : ''}`} aria-pressed={scope === 'current'} onClick={() => onChange('current')}>
          Este workspace{data ? `: ${data.workspace.name}` : ''}
        </button>
        <button type="button" className={`filter${scope === 'all' ? ' on' : ''}`} aria-pressed={scope === 'all'} onClick={() => onChange('all')}>
          Todos os workspaces
        </button>
      </div>
      {data && (
        <p className="small muted custo-scope-note">
          {scope === 'current'
            ? `Só as sessões que o workspace ${data.workspace.name} iniciou.${unassigned ? ` ${unassigned} ${unassigned === 1 ? 'sessão anterior' : 'sessões anteriores'} à atribuição ${unassigned === 1 ? 'aparece' : 'aparecem'} só em Todos os workspaces, como "sem workspace".` : ''}`
            : 'Todas as sessões do app lidas, de qualquer workspace.'}
        </p>
      )}
    </div>
  );
}

function WorkspaceBreakdown({ rows, current }: { rows: CustoWorkspaceRow[]; current: string }) {
  return (
    <section className="panel" style={{ padding: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Por workspace</h2>
      <ul className="custo-ws-list">
        {rows.map((w) => (
          <li key={w.id ?? 'none'} className="custo-ws">
            <div className="custo-ws-name">
              <span className="custo-ws-title">
                {w.name}
                {w.test && <span className="ws-test-chip">Testes</span>}
                {w.id === current && <span className="badge badge-quiet">em uso</span>}
              </span>
              <span className="small faint">
                {w.sessions} {w.sessions === 1 ? 'sessão' : 'sessões'} · {w.calls} chamadas
                {w.id === null ? ' · anteriores à atribuição' : ''}
              </span>
            </div>
            <div className="custo-figs">
              <div className="custo-fig"><span className="small muted">Hoje</span><span>{usd(w.today)}</span></div>
              <div className="custo-fig"><span className="small muted">7 dias</span><span>{usd(w.week)}</span></div>
              <div className="custo-fig"><span className="small muted">Mês</span><span>{usd(w.month)}</span></div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Custo({ go }: { go: (s: Screen) => void }) {
  const [data, setData] = useState<CustoSummary | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [scope, setScope] = useState<CustoScope>(savedScope);
  const scopeRef = useRef(scope);

  const load = useCallback(
    () =>
      api.invoke<CustoSummary>('custo:summary', scopeRef.current).then((s) => {
        if (s.scope === scopeRef.current) setData(s);
        setGoal((prev) => prev || String(s.goal));
        return s;
      }),
    [],
  );

  const refresh = useCallback(() => {
    setError(null);
    const asked = scopeRef.current;
    jobs.launch('custo:refresh', { label: 'Atualização de custos', busy: 'Atualizando os preços…', screen: { name: 'custo' } }, () => api.invoke<CustoSummary>('custo:refresh', asked));
  }, []);

  const chooseScope = (next: CustoScope) => {
    if (next === scopeRef.current) return;
    scopeRef.current = next;
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {}
    void load().catch((e) => setError(errorText(e)));
  };

  const running = useJobs<CustoSummary>('custo:', {
    done: (next) => {
      // The scope may have changed while prices were being fetched: the summary then belongs to the other one.
      if (next.scope === scopeRef.current) setData(next);
      else void load();
      setGoal(String(next.goal));
      setProgress(null);
    },
    failed: (message) => {
      setError(message);
      setProgress(null);
    },
  });
  const busy = running.some((j) => j.key === 'custo:refresh');

  useEffect(() => {
    const onProgress = (ev: Event) => setProgress((ev as CustomEvent<{ done: number; total: number }>).detail);
    moduleEvents.addEventListener('custo-progress', onProgress);
    void load().then((s) => {
      // Prices are final once fetched, so refreshing only asks for what is new; do it when the numbers are stale.
      if (!s.refreshedAt || Date.now() - new Date(s.refreshedAt).getTime() > 30 * 60_000) refresh();
    });
    return () => moduleEvents.removeEventListener('custo-progress', onProgress);
  }, [refresh, load]);

  const saveGoal = async () => {
    try {
      setData(await api.invoke<CustoSummary>('custo:goal', Number(goal.replace(',', '.')), scopeRef.current));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const key = data?.key ?? null;
  const spent = key?.usageMonthly ?? data?.month.cost ?? 0;
  const goalNow = data?.goal ?? 20;
  const maxDay = Math.max(0, ...(data?.days.map((d) => d.cost) ?? []));
  const maxKind = Math.max(0, ...(data?.kinds.map((k) => k.cost) ?? []));
  const over = spent > goalNow;
  const tag = data?.scope === 'all' ? 'app' : 'workspace';

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Custo</h1>
            <span className="faint">
              {data?.refreshedAt ? `Atualizado às ${new Date(data.refreshedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
            {busy ? <span className="spinner" /> : null}
            {busy ? (progress?.total ? `Buscando preços ${progress.done}/${progress.total}` : 'Conferindo…') : 'Atualizar'}
          </button>
        </header>

        <ScopeToggle scope={scope} data={data} onChange={chooseScope} />

        {error && <div className="error">{error}</div>}
        {data?.keyError && <div className="error">Não consegui ler o uso da chave: {data.keyError}</div>}
        {!data && <div className="row faint"><span className="spinner" /> Lendo o custo…</div>}

        {data && (
          <>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <div className="row spread">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Meta do mês</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>
                    Gasto da chave inteira no mês (o app e o Claude Code pela OpenRouter){key?.limit ? `, limite da chave US$ ${key.limit}` : ''}.
                  </p>
                </div>
                <label className="row small muted" style={{ gap: 8 }}>
                  Meta US$
                  <input className="text-input" style={{ width: 90 }} inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} onBlur={() => void saveGoal()} onKeyDown={(e) => e.key === 'Enter' && void saveGoal()} />
                </label>
              </div>
              <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
                <Bar value={spent} max={goalNow} color={over ? 'var(--warn)' : 'var(--teal)'} />
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{usd(spent)} de {usd(goalNow)} · {pct((spent / goalNow) * 100)}</span>
              </div>
              {data.projected !== null && (
                <p className="small" style={{ color: data.projected > goalNow ? 'var(--amber-ink)' : 'var(--muted)' }}>
                  No ritmo de hoje, o mês fecha em {usd(data.projected)}{data.projected > goalNow ? ', acima da meta.' : '.'}
                </p>
              )}
            </section>

            <div className="row" style={{ gap: 14, alignItems: 'stretch' }}>
              <Tile title={`Hoje (${tag})`} row={data.today} />
              <Tile title={`7 dias (${tag})`} row={data.week} />
              <Tile title={`Mês (${tag})`} row={data.month} />
              {key && (
                <div className="panel" style={{ padding: '14px 18px', minWidth: 190, flex: '1 1 190px', gap: 2 }}>
                  <div className="small muted">Chave hoje / 7 dias</div>
                  <div style={{ fontSize: 26, fontWeight: 700 }}>{usd(key.usageDaily)}</div>
                  <div className="small faint">{usd(key.usageWeekly)} em 7 dias · tudo que usa a chave</div>
                </div>
              )}
              <FalasEconomia falas={data.falas} />
            </div>

            {data.scope === 'all' && <WorkspaceBreakdown rows={data.byWorkspace} current={data.workspace.id} />}

            <div className="cols" style={{ gap: 20 }}>
              <section className="panel" style={{ flex: '1 1 420px', padding: 20, minWidth: 0 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Por dia</h2>
                {!data.days.length && <p className="small faint">Nenhuma chamada do app encontrada.</p>}
                {data.days.slice(-14).map((d) => (
                  <div key={d.key} className="custo-line">
                    <span className="mono small muted custo-label">{dayLabel(d.key)}</span>
                    <Bar value={d.cost} max={maxDay} />
                    <span className="small custo-cost">{usd(d.cost)}</span>
                    <span className="small faint custo-meta">cache {pct(d.cachePct)}</span>
                  </div>
                ))}
              </section>

              <section className="panel" style={{ flex: '1 1 420px', padding: 20, minWidth: 0 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Por cerimônia · 7 dias</h2>
                {!data.kinds.length && <p className="small faint">Nenhuma chamada nos últimos 7 dias.</p>}
                {data.kinds.map((k) => (
                  <div key={k.key} className="custo-line">
                    <span className="small custo-label-wide">{k.label}</span>
                    <Bar value={k.cost} max={maxKind} color="var(--blue)" />
                    <span className="small custo-cost">{usd(k.cost)}</span>
                    <span className="small faint custo-meta">{k.calls} · cache {pct(k.cachePct)}</span>
                  </div>
                ))}
              </section>
            </div>

            <p className="faint">
              {data.sessions} sessões {data.scope === 'all' ? 'do app' : `do workspace ${data.workspace.name}`} lidas de ~/.claude/projects, preço de cada chamada pela OpenRouter (guardado em custo.json).
              Subagentes e sessões continuadas fora do app não entram na soma por cerimônia{data.pending ? `; ${data.pending} chamadas ainda sem preço` : ''}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
