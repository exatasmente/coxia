import type { Screen } from '../App';
import { useT } from '../i18n';
import { SpectrumAvatar } from './Avatar';
import { BackIcon, HaltIcon } from './icons';

// The speaker ids the screens hand to the player, in lower case; any other one is shown as it is, capitalized.
const SPEAKER_NAMES: Record<string, string> = {
  moderador: 'ui.nowPlaying.who.moderator',
  retro: 'ui.nowPlaying.who.retro',
  gate: 'ui.nowPlaying.who.gate',
  reentrada: 'ui.nowPlaying.who.reentry',
  conflito: 'ui.nowPlaying.who.conflict',
  qa: 'ui.nowPlaying.who.qa',
  discussão: 'ui.nowPlaying.who.discussion',
};

// Speech keeps playing when the person changes screens; this bar brings them back to where it came from.
export function NowPlaying({ who, origin, go, stop }: { who: string; origin: Screen; go: (s: Screen) => void; stop: () => void }) {
  const t = useT();
  const issue = /#(\d+)$/.exec(who);
  const known = SPEAKER_NAMES[who.toLowerCase()];
  const name = issue ? t('ui.nowPlaying.who.agent', { iid: issue[1] }) : known ? t(known) : who.charAt(0).toUpperCase() + who.slice(1);
  return (
    <div className="now-playing" role="status" aria-live="polite">
      <button type="button" className="now-playing-back" onClick={() => go(origin)} aria-label={t('ui.nowPlaying.back', { who: name })}>
        <BackIcon />
        <SpectrumAvatar mood="talking" color="var(--teal-bright)" small />
        <span className="now-playing-who">{t('ui.nowPlaying.speaking', { who: name })}</span>
      </button>
      <button type="button" className="now-playing-stop" onClick={stop} aria-label={t('ui.nowPlaying.stopAudio')} title={t('ui.nowPlaying.stop')}>
        <HaltIcon />
      </button>
    </div>
  );
}
