import { useEffect, useMemo, useRef, useState } from 'react';
import { type Term, corrected, spoken } from '../../../shared/glossary';
import type { Screen } from '../App';
import { errorText } from '../api';
import { clearSpeechCache } from '../audio';
import { glossaryApi } from '../glossaryApi';
import { BackIcon } from './icons';

interface Row {
  key: number;
  term: string;
  say: string;
  sayKokoro: string;
  heard: string;
}

let nextKey = 1;
const toRows = (terms: Term[]): Row[] => terms.map((t) => ({ key: nextKey++, term: t.term, say: t.say, sayKokoro: t.sayKokoro ?? '', heard: t.heard.join(', ') }));
const toTerms = (rows: Row[]): Term[] =>
  rows
    .map((r) => ({ term: r.term.trim(), say: r.say.trim(), sayKokoro: r.sayKokoro.trim(), heard: r.heard.split(',').map((h) => h.trim()).filter(Boolean) }))
    .filter((t) => t.term)
    .map(({ sayKokoro, ...t }) => (sayKokoro ? { ...t, sayKokoro } : t));

export function Glossario({ go }: { go: (s: Screen) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [defaults, setDefaults] = useState<Term[]>([]);
  const [filter, setFilter] = useState('');
  const [sample, setSample] = useState('O sz4!9302 está aprovado e o QA libera o merge no hub-whatsapp.');
  const [heardSample, setHeardSample] = useState('o Q&A liberou o merdi no hub WhatsApp');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    void glossaryApi.get().then((g) => {
      setRows(toRows(g.terms));
      setSaved(JSON.stringify(g.terms));
      setDefaults(g.defaults);
    });
    return () => audio.current?.pause();
  }, []);

  const terms = useMemo(() => toTerms(rows ?? []), [rows]);
  const dirty = rows !== null && JSON.stringify(terms) !== saved;
  const shown = (rows ?? []).filter((r) => !filter.trim() || `${r.term} ${r.say} ${r.sayKokoro} ${r.heard}`.toLowerCase().includes(filter.trim().toLowerCase()));

  const edit = (key: number, field: 'term' | 'say' | 'sayKokoro' | 'heard', value: string) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const hear = async (text: string, id: string) => {
    if (!text.trim()) return;
    setBusy(id);
    setError(null);
    try {
      const bytes = await glossaryApi.hear(text, terms);
      audio.current?.pause();
      const url = URL.createObjectURL(new Blob([bytes], { type: new TextDecoder().decode(new Uint8Array(bytes, 0, 4)) === 'RIFF' ? 'audio/wav' : 'audio/mpeg' }));
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      const next = await glossaryApi.save(terms);
      setRows(toRows(next));
      setSaved(JSON.stringify(next));
      clearSpeechCache();
      setNotice(`Dicionário salvo: ${next.length} termos. Vale para a próxima fala e a próxima gravação.`);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(null);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ gap: 20 }}>
        <header className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <button type="button" className="btn icon-btn" aria-label="Voltar para Configurações" onClick={() => go({ name: 'settings' })}><BackIcon /></button>
            <h1 style={{ fontSize: 26, fontWeight: 700 }}>Dicionário de termos</h1>
            {rows && <span className="faint">{terms.length} termos</span>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={!dirty || busy !== null} onClick={() => setRows(toRows(JSON.parse(saved) as Term[]))}>Descartar</button>
            <button type="button" className="btn btn-accent" disabled={!dirty || busy !== null} onClick={() => void save()}>
              {busy === 'save' ? <span className="spinner" /> : null} Salvar
            </button>
          </div>
        </header>

        <p className="muted" style={{ margin: 0 }}>
          Cada termo vale para os dois lados da voz. <strong>Como falar</strong> é o que a voz pronuncia no lugar do termo; vazio, ela lê como está escrito. <strong>Kokoro</strong> é a pronúncia só para essa voz, que lê palavras em inglês pior que a Edge; vazio, ela usa o <strong>Como falar</strong>.{' '}
          <strong>Como o reconhecimento ouve</strong> são as grafias erradas que a transcrição costuma produzir, separadas por vírgula: viram o termo. Os termos também
          entram como dica de vocabulário para o reconhecimento. Na tela tudo continua escrito do jeito certo.
        </p>

        {error && <div className="error">{error}</div>}
        {notice && !dirty && <div className="small" role="status" style={{ color: 'var(--teal)' }}>{notice}</div>}

        <section className="panel" style={{ padding: 20, gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Testar</h2>
          <div className="glossary-test">
            <label htmlFor="g-sample" className="small" style={{ fontWeight: 600 }}>Frase falada</label>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <input id="g-sample" className="text-input" style={{ flex: '1 1 auto', minWidth: 0 }} value={sample} onChange={(e) => setSample(e.target.value)} />
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void hear(sample, 'sample')}>
                {busy === 'sample' ? <span className="spinner" /> : null} Ouvir
              </button>
            </div>
            <span className="small muted">Edge lê: <span className="mono">{spoken(sample, terms, 'edge')}</span></span>
            <span className="small muted">Kokoro lê: <span className="mono">{spoken(sample, terms, 'kokoro')}</span></span>
            <label htmlFor="g-heard" className="small" style={{ fontWeight: 600, marginTop: 6 }}>Transcrição recebida</label>
            <input id="g-heard" className="text-input" value={heardSample} onChange={(e) => setHeardSample(e.target.value)} />
            <span className="small muted">Fica: <span className="mono">{corrected(heardSample, terms)}</span></span>
          </div>
        </section>

        <section className="panel" style={{ padding: 20, gap: 12 }}>
          <div className="row spread" style={{ gap: 8 }}>
            <input className="text-input" aria-label="Filtrar termos" placeholder="Filtrar" style={{ flex: '1 1 200px', minWidth: 0 }} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFilter('');
                  setRows((rs) => [{ key: nextKey++, term: '', say: '', sayKokoro: '', heard: '' }, ...(rs ?? [])]);
                }}
              >
                Adicionar termo
              </button>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setRows(toRows(defaults))}>Restaurar padrões</button>
            </div>
          </div>
          {!rows && <div className="row faint"><span className="spinner" /> Lendo…</div>}
          {rows && (
            <div className="glossary" role="table" aria-label="Termos">
              <div className="glossary-row glossary-head small muted" role="row">
                <span role="columnheader">Termo</span>
                <span role="columnheader">Como falar</span>
                <span role="columnheader">Kokoro</span>
                <span role="columnheader">Como o reconhecimento ouve</span>
                <span role="columnheader"><span className="sr-only">Ações</span></span>
              </div>
              {shown.map((r) => (
                <div key={r.key} className="glossary-row" role="row">
                  <label className="glossary-cell">
                    <span className="glossary-cap small muted">Termo</span>
                    <input className="text-input" aria-label="Termo" value={r.term} placeholder="termo" onChange={(e) => edit(r.key, 'term', e.target.value)} />
                  </label>
                  <label className="glossary-cell">
                    <span className="glossary-cap small muted">Como falar</span>
                    <input className="text-input" aria-label={`Como falar ${r.term}`} value={r.say} placeholder="como está escrito" onChange={(e) => edit(r.key, 'say', e.target.value)} />
                  </label>
                  <label className="glossary-cell">
                    <span className="glossary-cap small muted">Como falar no Kokoro</span>
                    <input className="text-input" aria-label={`Como falar ${r.term} no Kokoro`} value={r.sayKokoro} placeholder="igual ao anterior" onChange={(e) => edit(r.key, 'sayKokoro', e.target.value)} />
                  </label>
                  <label className="glossary-cell">
                    <span className="glossary-cap small muted">Como o reconhecimento ouve</span>
                    <input className="text-input" aria-label={`Como o reconhecimento ouve ${r.term}`} value={r.heard} placeholder="grafias erradas, por vírgula" onChange={(e) => edit(r.key, 'heard', e.target.value)} />
                  </label>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <button type="button" className="btn" disabled={busy !== null || !r.term.trim()} title="Ouvir a pronúncia" onClick={() => void hear(r.term, `row-${r.key}`)}>
                      {busy === `row-${r.key}` ? <span className="spinner" /> : null} Ouvir
                    </button>
                    <button type="button" className="btn" aria-label={`Remover ${r.term || 'termo'}`} onClick={() => setRows((rs) => (rs ?? []).filter((x) => x.key !== r.key))}>×</button>
                  </div>
                </div>
              ))}
              {shown.length === 0 && <span className="faint small">Nenhum termo com esse filtro.</span>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
