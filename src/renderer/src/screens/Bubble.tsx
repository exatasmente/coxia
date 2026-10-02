import type { Talk, Voice } from '../../../shared/types';
import type { usePlayer } from '../audio';
import { RichText } from './Diagram';
import { FixHeard } from './FixHeard';

const SpeakerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </svg>
);

/**
 * A chat message. The agent's ones can be heard again — even with the voice off, since asking for it is explicit —
 * and say their spoken version, not the chat text with its diagrams.
 */
export function Bubble({
  m,
  who,
  voice,
  player,
  speaker,
}: {
  m: Talk;
  who: string;
  voice?: Voice | null;
  player?: ReturnType<typeof usePlayer>;
  speaker?: string;
}) {
  const id = speaker ?? who;
  const playing = !!player && player.speaking === id && player.current === m;
  return (
    <div className={`bubble-row ${m.me ? 'me' : ''}`}>
      <div className="bubble">
        <div className="who bubble-head">
          <span>{who} · {m.at}</span>
          {!m.me && voice && player && (
            <button
              type="button"
              className="bubble-replay"
              aria-label={playing ? 'Parar a reprodução' : 'Ouvir esta mensagem'}
              title={playing ? 'Parar' : 'Ouvir de novo'}
              aria-pressed={playing}
              onClick={() => (playing ? player.stop() : void player.say(m.speech ?? m.text, voice, id, { force: true, item: m }).catch(() => undefined))}
            >
              <SpeakerIcon />
            </button>
          )}
        </div>
        <div style={{ lineHeight: 1.5 }}><RichText text={m.text} /></div>
        {m.me && <FixHeard text={m.text} />}
      </div>
    </div>
  );
}
