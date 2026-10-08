import type { BoardHost } from './board';
import { vcsName } from './cyclePrompts';
import { readBoard } from './vcs/boardRead';
import { vcsProvider, vcsReady } from './vcs';

// The board's one way to the code host. It is the only file of the board that imports the host (and, once a card can be written, Actions): the board proper
// (`board.ts`) holds a port and nothing else, the same arrangement as the runner's door (`runner/door.ts`).

export const realBoardHost: BoardHost = {
  ready: () => vcsReady(),
  name: () => vcsName(),
  labels: () => {
    try {
      return vcsProvider().caps.issueLabels;
    } catch {
      return false;
    }
  },
  read: (refresh) => readBoard(refresh),
};
