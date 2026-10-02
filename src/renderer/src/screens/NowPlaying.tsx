import type { Screen } from '../App';
import { SpectrumAvatar } from './Avatar';
import { BackIcon, HaltIcon } from './icons';

function speakerName(who: string): string {
  const issue = /#(\d+)$/.exec(who);
  if (issue) return `Agente #${issue[1]}`;
  return who.charAt(0).toUpperCase() + who.slice(1);
}

// Speech keeps playing when the person changes screens; this bar brings them back to where it came from.
export function NowPlaying({ who, origin, go, stop }: { who: string; origin: Screen; go: (s: Screen) => void; stop: () => void }) {
  return (
    <div className="now-playing" role="status" aria-live="polite">
      <button type="button" className="now-playing-back" onClick={() => go(origin)} aria-label={`Voltar para a tela de ${speakerName(who)}`}>
        <BackIcon />
        <SpectrumAvatar mood="talking" color="var(--teal-bright)" small />
        <span className="now-playing-who">{speakerName(who)} falando</span>
      </button>
      <button type="button" className="now-playing-stop" onClick={stop} aria-label="Parar o áudio" title="Parar">
        <HaltIcon />
      </button>
    </div>
  );
}
