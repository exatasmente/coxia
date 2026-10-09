import { useMemo, useState } from 'react';
import type { AgentDef } from '../../../../shared/config/types';
import { runKey } from '../../../../shared/browser';
import { runThreadId } from '../../../../shared/forum';
import type { Run } from '../../../../shared/runs';
import { AskCards } from './AskCard';
import { LiveScreen } from './LiveScreen';
import { asksOf, isHandoff } from './askView';
import { useScreens } from './useScreens';

// The agent's request to hand its screen over, at the top of the run where the agent works (next to the command it waits to run), above the tabs so it is seen from the cycle and
// from the conversation alike. The same card is in the conversation's own list for a thread that is not a run's; here the run's thread leaves it to this one. Take the screen
// opens the viewer, which shows the warning (LiveScreen).

export function RunHandoff({ run, team }: { run: Run; team: readonly AgentDef[] | undefined }) {
  const screens = useScreens(runThreadId(run.id));
  const asks = useMemo(() => asksOf(screens), [screens]);
  const requests = useMemo(() => asks.filter(isHandoff), [asks]);
  const [watching, setWatching] = useState<string | null>(null);
  const own = runKey(run.id);
  if (requests.length === 0 && !watching) return null;
  return (
    <>
      <AskCards asks={requests} team={team} onWatch={setWatching} />
      {watching && (
        <LiveScreen
          screenKey={watching}
          state={watching === own ? (run.screen ?? null) : (screens.find((s) => s.key === watching) ?? null)}
          asks={asks.filter((a) => a.key === watching)}
          team={team}
          onClose={() => setWatching(null)}
        />
      )}
    </>
  );
}
