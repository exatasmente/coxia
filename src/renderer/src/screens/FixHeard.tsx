import { useId, useState } from 'react';
import type { Term } from '../../../shared/glossary';
import { type Correction, newCorrections } from '../../../shared/glossaryLearn';
import { errorText } from '../api';
import { wasTranscribed } from '../audio';
import { glossaryApi } from '../glossaryApi';

/**
 * "Corrigir transcrição" on a message that came from the voice: the user retypes it right and each difference is offered to the
 * dictionary. Nothing is saved without the click, and the message itself does not change.
 */
export function FixHeard({ text, className = 'bubble-fix' }: { text: string; className?: string }) {
  const field = useId();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<Term[]>([]);
  const [fixed, setFixed] = useState(text);
  const [taught, setTaught] = useState<Correction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wasTranscribed(text)) return null;

  const offers = newCorrections(terms, text, fixed).filter((c) => !taught.some((t) => t.heard === c.heard && t.term === c.term));

  const toggle = () => {
    if (open) return setOpen(false);
    setOpen(true);
    setError(null);
    void glossaryApi.get().then((g) => setTerms(g.terms), (e) => setError(errorText(e)));
  };

  const teach = async (c: Correction) => {
    setBusy(true);
    setError(null);
    try {
      setTerms(await glossaryApi.learn(c.heard, c.term));
      setTaught((t) => [...t, c]);
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };

  return (
    <>
      <button type="button" className={className} aria-expanded={open} onClick={toggle}>
        {open ? 'Fechar correção' : 'Corrigir transcrição'}
      </button>
      {open && (
        <div className="fix-panel">
          <label className="small muted" htmlFor={field}>Como era para estar escrito</label>
          <input id={field} className="text-input" value={fixed} onChange={(e) => setFixed(e.target.value)} />
          {offers.map((c) => (
            <button key={`${c.heard}>${c.term}`} type="button" className="btn fix-offer" disabled={busy} onClick={() => void teach(c)}>
              Guardar “{c.heard}” → {c.term} no dicionário
            </button>
          ))}
          {taught.map((c) => (
            <span key={`${c.heard}>${c.term}`} className="small" role="status" style={{ color: 'var(--teal)' }}>Guardado: “{c.heard}” → {c.term}</span>
          ))}
          {!offers.length && !taught.length && <span className="small muted">Corrija as palavras erradas: cada troca vira uma sugestão para o dicionário. A mensagem enviada não muda.</span>}
          {error && <span className="small" role="alert" style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
      )}
    </>
  );
}
