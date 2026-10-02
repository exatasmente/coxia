import { useEffect, useState } from 'react';
import { MODEL_OPTIONS, type ModelRole, type Settings, type Theme } from '../../../shared/settings';
import type { Screen } from '../App';
import { api, errorText } from '../api';
import { clearSpeechCache, setSpeechEnabled } from '../audio';
import { applyTheme } from '../theme';
import { BackIcon } from './icons';
import { RetentionSection } from './RetentionSection';

const ROLES: [ModelRole, string, string][] = [
  ['turn', 'Fala de cada agente', 'Monta a vez de cada atividade na pré-daily. É o papel mais chamado: um por atividade.'],
  ['reply', 'Resposta ao que você diz', 'Entende a sua resposta e tira dela a decisão e a ação.'],
  ['deep', 'Desbloqueio', 'Investiga a fundo, lendo spec, GitLab e playbook. Vale um modelo mais forte.'],
  ['teams', 'Texto do Teams', 'Escreve o resumo para a daily do time.'],
];

const TOOLS: [keyof Settings['tools'], string, string][] = [
  ['files', 'Ler arquivos', 'Read, Grep e Glob no workspace (specs, rules, código). Arquivos de segredo ficam sempre bloqueados.'],
  ['skills', 'Skills do playbook', 'Carregar skills como no Claude Code.'],
  ['gitlabMcp', 'GitLab pelo MCP', 'Descrição e diff de issue e MR (gitlab-issue-analysis).'],
  ['glab', 'GitLab pelo glab', 'Só leitura: discussões de MR, comentários de issue, mr/issue view. Escrita sempre bloqueada.'],
  ['subagents', 'Subagentes no desbloqueio', 'O agente do desbloqueio pode delegar leitura (kb-reader, Explore).'],
];

const THEME_LABELS: [Theme, string, string][] = [
  ['system', 'Sistema', 'Segue o claro ou escuro do computador.'],
  ['light', 'Claro', 'Sempre claro.'],
  ['dark', 'Escuro', 'Sempre escuro.'],
];

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function SettingsScreen({ go }: { go: (s: Screen) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.getSettings().then(setS, (e) => setError(errorText(e)));
  }, []);

  if (!s) return <div className="page"><div className="wrap">{error ? <div className="error">{error}</div> : <span className="spinner" />}</div></div>;

  const set = (change: (prev: Settings) => Settings) => {
    setSaved(null);
    setS((prev) => (prev ? change(prev) : prev));
  };

  const save = async () => {
    setError(null);
    try {
      const saved = await api.saveSettings(s);
      setS(saved);
      setSpeechEnabled(saved.voice.speak);
      clearSpeechCache();
      applyTheme(saved.appearance.theme);
      setSaved(`Salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const check = async () => {
    setChecking(true);
    setStatus(null);
    try {
      setStatus(await api.checkStatus());
    } catch (e) {
      setStatus(`Falhou: ${errorText(e)}`);
    }
    setChecking(false);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 980, gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Hoje" onClick={() => go({ name: 'today' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Configurações</h1>
          </div>
          <div className="row">
            {saved && <span className="small" style={{ color: 'var(--teal-ink)' }}>{saved}</span>}
            <button type="button" className="btn btn-dark" onClick={() => void save()}>Salvar</button>
          </div>
        </header>
        {error && <div className="error">{error}</div>}

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Modelos</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Pelo OpenRouter. Vale a partir da próxima chamada de agente.</p>
          </div>
          {ROLES.map(([role, label, hint]) => {
            const custom = !MODEL_OPTIONS.includes(s.models[role]);
            return (
              <div key={role} className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{label}</div>
                  <div className="small muted">{hint}</div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <select
                    className="text-input"
                    aria-label={`Modelo: ${label}`}
                    value={custom ? '__custom' : s.models[role]}
                    onChange={(e) => set((p) => ({ ...p, models: { ...p.models, [role]: e.target.value === '__custom' ? '' : e.target.value } }))}
                  >
                    {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                    <option value="__custom">Outro…</option>
                  </select>
                  {custom && (
                    <input
                      className="text-input mono"
                      aria-label={`Outro modelo: ${label}`}
                      placeholder="provedor/modelo"
                      value={s.models[role]}
                      onChange={(e) => set((p) => ({ ...p, models: { ...p.models, [role]: e.target.value.trim() } }))}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Ferramentas dos agentes</h2>
            <p className="small muted" style={{ marginTop: 4 }}>
              Sempre bloqueado, independentemente daqui: editar arquivos, web, arquivos de segredo e qualquer escrita no GitLab.
            </p>
          </div>
          {TOOLS.map(([key, label, hint]) => (
            <label key={key} className="check-row">
              <input type="checkbox" checked={s.tools[key]} onChange={() => set((p) => ({ ...p, tools: { ...p.tools, [key]: !p.tools[key] } }))} />
              <span>
                <span style={{ fontWeight: 600, display: 'block' }}>{label}</span>
                <span className="small muted">{hint}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Voz</h2>
            <p className="small muted" style={{ marginTop: 4 }}>O espaço continua enviando a fala antes da hora. Vale a partir da próxima gravação.</p>
          </div>
          <div className="settings-row">
            <label htmlFor="engine" style={{ fontWeight: 600 }}>Voz dos agentes</label>
            <div>
              <select id="engine" className="text-input" value={s.voice.engine} onChange={(e) => set((p) => ({ ...p, voice: { ...p.voice, engine: e.target.value as 'edge' | 'kokoro' } }))}>
                <option value="edge">Edge (nuvem)</option>
                <option value="kokoro">Kokoro (local)</option>
              </select>
              <p className="small muted" style={{ marginTop: 6 }}>
                {s.voice.engine === 'kokoro'
                  ? 'Roda na sua máquina: nada sai dela. Soa um pouco mais robótico, e a primeira fala demora mais porque carrega o modelo.'
                  : 'Soa mais natural, mas o texto falado vai para a Microsoft. Para nada sair da máquina, use o Kokoro.'}
              </p>
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.speak} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, speak: !p.voice.speak } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>Agentes falam em voz alta</span>
              <span className="small muted">Desligado, tudo continua na tela (transcrição, perguntas, respostas) e nenhum texto é sintetizado. O microfone segue funcionando.</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.voice.autoStop} onChange={() => set((p) => ({ ...p, voice: { ...p.voice, autoStop: !p.voice.autoStop } }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>Enviar sozinho quando eu parar de falar</span>
              <span className="small muted">Depois que você começa a falar, uma pausa longa envia a fala. Cada fala tem no máximo 30 segundos.</span>
            </span>
          </label>
          <div className="settings-row">
            <label htmlFor="silence" style={{ fontWeight: 600 }}>Pausa que encerra a fala</label>
            <div className="row" style={{ gap: 8 }}>
              <input id="silence" type="number" min={500} max={5000} step={100} className="text-input" style={{ maxWidth: 110 }} disabled={!s.voice.autoStop} value={s.voice.silenceMs} onChange={(e) => set((p) => ({ ...p, voice: { ...p.voice, silenceMs: Number(e.target.value) } }))} />
              <span className="small muted">ms (de 500 a 5000)</span>
            </div>
          </div>
        </section>

        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Agenda e notificações</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Conferir o status usa só o daily-report: não chama nenhum modelo.</p>
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>Dias</div>
            <div className="row" style={{ gap: 6 }}>
              {DAYS.map((d, i) => {
                const on = s.schedule.days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    className={`filter ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    onClick={() => set((p) => ({ ...p, schedule: { ...p.schedule, days: on ? p.schedule.days.filter((x) => x !== i) : [...p.schedule.days, i].sort() } }))}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="settings-row">
            <label htmlFor="pre" style={{ fontWeight: 600 }}>Aviso da pré-daily</label>
            <input id="pre" type="time" className="text-input" style={{ maxWidth: 140 }} value={s.schedule.preDaily} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, preDaily: e.target.value } }))} />
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>Conferir o status</div>
            <div className="row" style={{ gap: 8 }}>
              <span className="small muted">a cada</span>
              <input type="number" min={5} max={240} className="text-input" aria-label="Intervalo em minutos" style={{ maxWidth: 90 }} value={s.schedule.statusEveryMin} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, statusEveryMin: Number(e.target.value) } }))} />
              <span className="small muted">min, das</span>
              <input type="time" className="text-input" aria-label="Início" style={{ maxWidth: 130 }} value={s.schedule.from} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, from: e.target.value } }))} />
              <span className="small muted">às</span>
              <input type="time" className="text-input" aria-label="Fim" style={{ maxWidth: 130 }} value={s.schedule.to} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, to: e.target.value } }))} />
            </div>
          </div>
          <div className="settings-row">
            <div style={{ fontWeight: 600 }}>Aviso da retro</div>
            <div className="row" style={{ gap: 8 }}>
              <select className="text-input" aria-label="Dia da retro" style={{ maxWidth: 140 }} value={s.schedule.retroDay} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, retroDay: Number(e.target.value) } }))}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
              <input type="time" className="text-input" aria-label="Hora da retro" style={{ maxWidth: 130 }} value={s.schedule.retroTime} onChange={(e) => set((p) => ({ ...p, schedule: { ...p.schedule, retroTime: e.target.value } }))} />
            </div>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={s.notifications} onChange={() => set((p) => ({ ...p, notifications: !p.notifications }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>Notificações</span>
              <span className="small muted">Hora da pré-daily, bloqueio novo (com convite para a call) e mudança de status.</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={s.closeToTray} onChange={() => set((p) => ({ ...p, closeToTray: !p.closeToTray }))} />
            <span>
              <span style={{ fontWeight: 600, display: 'block' }}>Fechar mantém na bandeja</span>
              <span className="small muted">A janela some, o app fica no ícone da bandeja e o agendador continua. Para sair de vez: Sair, no menu da bandeja.</span>
            </span>
          </label>
          <div className="row">
            <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
              {checking ? <span className="spinner" /> : null} Conferir status agora
            </button>
            {status && <span className="small muted" style={{ whiteSpace: 'pre-line' }}>{status}</span>}
          </div>
        </section>

        <RetentionSection value={s.retention} onChange={(retention) => set((p) => ({ ...p, retention }))} />
        <section className="panel" style={{ padding: 20, gap: 14 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600 }}>Aparência</h2>
            <p className="small muted" style={{ marginTop: 4 }}>Vale ao salvar. A call e os painéis escuros ficam escuros nos dois temas.</p>
          </div>
          <div role="group" aria-label="Tema" className="row" style={{ gap: 8 }}>
            {THEME_LABELS.map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                aria-pressed={s.appearance.theme === value}
                title={hint}
                className={`filter ${s.appearance.theme === value ? 'on' : ''}`}
                onClick={() => set((p) => ({ ...p, appearance: { ...p.appearance, theme: value } }))}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="small muted">{THEME_LABELS.find(([value]) => value === s.appearance.theme)?.[2]}</p>
        </section>
      </div>
    </div>
  );
}
