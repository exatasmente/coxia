import { CommandCard, useCeremonyCommands } from './CeremonyCommands';
import { useT } from './i18n';
import { TurnAskCard, useTurnAsks } from './TurnAsks';
import './ceremonyCommands.css';

// Everything that waits for the person on every screen of the window and of the paired phone, in one stack: the commands a ceremony agent wants to run and the questions an
// agent leaves at its turn limit. One container because the bottom of the screen is taken, and a second fixed stack would sit over the first.
export function AskStack() {
  const t = useT();
  const [commands, doneCommand] = useCeremonyCommands();
  const [turns, doneTurn] = useTurnAsks();
  if (!commands.length && !turns.length) return null;
  return (
    <div className="cc-stack" role="region" aria-label={t('ui.ask.region')}>
      {commands.map((c) => (
        <CommandCard key={c.id} item={c} onDone={doneCommand} />
      ))}
      {turns.map((a) => (
        <TurnAskCard key={a.id} item={a} onDone={doneTurn} />
      ))}
    </div>
  );
}
