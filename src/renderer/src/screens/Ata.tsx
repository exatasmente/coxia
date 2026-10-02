import { useCallback, useEffect, useRef, useState } from 'react';
import { teamsKey } from '../../../shared/minutes';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import type { Ceremony } from '../ceremony';
import { jobs, useJobs } from '../useJobs';
import { ContinueInClaude } from './ContinueInClaude';
import { EfeitoStatus } from './EfeitoStatus';
import { tv } from '../i18n';

function effectsPrompt(effects: Ceremony['effects']): string {
  return [
    'Da minha pré-daily de hoje, ações para executar. Peça o meu "sim" antes de cada uma, uma por vez:',
    ...effects.map((e, i) => `${i + 1}. ${e.ref} (${e.repo}): ${e.text}`),
  ].join('\n');
}

function effectPrompt(e: Ceremony['effects'][number]): string {
  return `Execute esta ação da pré-daily, pedindo o meu sim antes: ${e.ref} (${e.repo}): ${e.text}`;
}

export function Ata({ ceremony: c, go }: { ceremony: Ceremony; go: (s: Screen) => void }) {
  const m = c.minutes;
  const [selected, setSelected] = useState<boolean[]>(() => m.decisions.map(() => true));
  const { teams, setTeams, saveResult: result, setSaveResult: setResult } = c;
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'teams' | 'effects' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const asked = useRef(false);

  const key = teamsKey(c.snapshot);
  const current = !!teams && c.teamsKey === key;

  // The jobs write the text and the saved result into the ceremony store themselves, so they land even if this screen is gone by then.
  const loadTeams = useCallback(() => {
    setTeamsError(null);
    setTeams(null, null);
    jobs.launch('ata:teams', { label: 'Resumo da ata', busy: 'O agente está escrevendo no seu estilo…', screen: { name: 'ata' } }, async () => {
      const text = await api.teamsText(m, c.cards?.cards ?? []);
      setTeams(text, key);
      return text;
    });
  }, [m, c.cards, key]);

  // The text is written again only when decisions, effects or cards changed since it was written.
  useEffect(() => {
    if (asked.current || current || jobs.get('ata:teams')) return;
    asked.current = true;
    loadTeams();
  }, [loadTeams, current]);

  const running = useJobs('ata:', {
    failed: (message, job) => (job.key === 'ata:save' ? setSaveError(message) : setTeamsError(message)),
  });
  const saving = running.some((j) => j.key === 'ata:save');

  const copy = async (what: 'teams' | 'effects', text: string) => {
    await api.copy(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const save = () => {
    setSaveError(null);
    const idx = selected.flatMap((on, i) => (on ? [i] : []));
    jobs.launch('ata:save', { label: 'Gravação da ata', busy: 'Gravando a ata…', screen: { name: 'ata' } }, async () => {
      const saved = await api.saveMinutes(m, teams ?? '', idx);
      setResult(saved);
      return saved;
    });
  };

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const writtenFor = (i: number) => (result ? result.written.find((w) => w.ref === m.decisions[i].ref && w.dest === m.decisions[i].dest) : undefined);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 1240, gap: 24 }}>
        <header className="row spread" style={{ alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="row" style={{ gap: 14 }}>
              <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => go({ name: 'today' })}>← Hoje</button>
              {!c.callEnded && c.startedAt && <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => go({ name: 'call' })}>{tv('call.back')}</button>}
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 700 }}>Ata da pré-daily</h1>
            <div className="muted">
              {new Date(m.startedAt).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} · {fmt(m.startedAt)} às {fmt(m.endedAt)} ·{' '}
              {c.cards?.cards.length ?? 0} atividades
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {[
              [m.decisions.length, 'decisões'],
              [m.effects.length, 'efeitos na fila'],
              [m.unanswered.length, 'sem resposta'],
            ].map(([n, label]) => (
              <div key={label} className="panel" style={{ padding: '12px 16px', minWidth: 110, gap: 0 }}>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{n}</div>
                <div className="small muted">{label}</div>
              </div>
            ))}
          </div>
        </header>

        <div className="cols" style={{ gap: 20 }}>
          <div style={{ flex: '3 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <div className="row spread">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Decisões</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>Cada uma vai para a sua casa: Registro do Plan, nota do cartão ou só a ata.</p>
                </div>
                <button type="button" className="btn btn-dark" disabled={saving || !!result} onClick={() => save()}>
                  {saving ? <span className="spinner" /> : null} {result ? 'Gravado' : 'Gravar ata e decisões'}
                </button>
              </div>
              {!m.decisions.length && <p className="small faint">Nenhuma decisão nesta cerimônia. A ata grava mesmo assim, com a transcrição.</p>}
              {m.decisions.map((d, i) => {
                const w = writtenFor(i);
                return (
                  <label key={`${d.ref}-${i}`} className={`check-row ${w?.ok ? 'saved' : ''}`}>
                    <input type="checkbox" checked={selected[i] ?? true} disabled={!!result} onChange={() => setSelected((s) => s.map((v, j) => (j === i ? !v : v)))} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
                      <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                        <span className="mono small muted">{d.ref}</span>
                        <span style={{ lineHeight: 1.45 }}>{d.text}</span>
                      </span>
                      <span className="dest">→ {d.dest}</span>
                      {w && <span className="small" style={{ color: w.ok ? 'var(--teal-ink)' : 'var(--amber-ink)' }}>{w.ok ? 'gravada' : w.detail}</span>}
                    </span>
                  </label>
                );
              })}
              {result && <p className="small muted">Ata em <span className="mono">{result.ataPath}</span></p>}
              {saveError && <div className="error">{saveError}</div>}
            </section>

            <section className="panel" style={{ padding: 20, gap: 12 }}>
              <div className="row spread">
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 600 }}>Fila de efeitos</h2>
                  <p className="small muted" style={{ marginTop: 4 }}>Vai para o Claude Code. Lá, cada item espera o seu “sim”.</p>
                </div>
                <button type="button" className="btn" style={{ background: 'var(--warn-solid)', color: 'var(--white)', borderColor: 'var(--warn-solid)' }} disabled={!m.effects.length} onClick={() => void copy('effects', effectsPrompt(m.effects))}>
                  {copied === 'effects' ? 'Copiado' : 'Copiar para o Claude Code'}
                </button>
              </div>
              {!m.effects.length && <p className="small faint">Nenhuma ação externa pendente.</p>}
              {m.effects.map((e, i) => (
                <div key={`${e.ref}-${i}`} className="row" style={{ padding: '12px 0', borderTop: '1px solid var(--line-2)' }}>
                  <span className="badge-e3">E3</span>
                  <span style={{ flex: '1 1 260px' }}>{e.text}</span>
                  <span className="mono faint">{e.repo} · {e.ref}</span>
                  <EfeitoStatus effect={e} ceremonyId={c.snapshot.id} />
                  {c.turns[e.ref]?.sessionId ?? c.deep[e.ref]?.sessionId ? (
                    <ContinueInClaude sessionId={c.turns[e.ref]?.sessionId ?? c.deep[e.ref]?.sessionId} prompt={effectPrompt(e)} label="Executar no Claude Code" />
                  ) : (
                    <button type="button" className="btn" title="A atividade não tem sessão de agente: copie o pedido e cole numa sessão" onClick={() => void api.copy(effectPrompt(e))}>Copiar pedido</button>
                  )}
                </div>
              ))}
            </section>

            {m.unanswered.length > 0 && (
              <section className="panel" style={{ padding: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Perguntas sem resposta</h2>
                {m.unanswered.map((u) => (
                  <div key={u.ref} className="item ask">
                    <div className="mono" style={{ fontSize: 12, color: 'var(--blue-ink)' }}>{u.ref}</div>
                    <div className="small">{u.question}</div>
                  </div>
                ))}
              </section>
            )}
          </div>

          <div style={{ flex: '2 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section className="panel-dark" style={{ padding: 20, gap: 12, borderRadius: 16 }}>
              <div className="row spread">
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Para a daily do time</h2>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!teams} onClick={() => loadTeams()}>
                    Reescrever
                  </button>
                  <button type="button" className="btn" style={{ minHeight: 40, background: 'transparent', color: 'var(--on-night)', borderColor: 'var(--night-line)' }} disabled={!teams} onClick={() => teams && void copy('teams', teams)}>
                    {copied === 'teams' ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
              {teams && <pre className="teams">{teams}</pre>}
              {!teams && !teamsError && <div className="row small" style={{ color: 'var(--on-night-muted)' }}><span className="spinner" /> O agente está escrevendo no seu estilo…</div>}
              {teamsError && (
                <div className="row">
                  <span className="small" style={{ color: 'var(--night-red)' }}>{teamsError}</span>
                  <button type="button" className="btn" onClick={() => loadTeams()}>Tentar de novo</button>
                </div>
              )}
              <p className="small" style={{ color: 'var(--on-night-muted)' }}>Você cola no chat do time; nada é publicado daqui.</p>
            </section>

            <section className="panel" style={{ padding: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Transcrição</h2>
              <div style={{ maxHeight: 420, overflow: 'auto' }}>
                {m.transcript.map((t, i) => (
                  <div key={i} className="log-line">
                    <span className="at">{t.at}</span>
                    <span className="who">{t.who}</span>
                    <span className="text">{t.text}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
