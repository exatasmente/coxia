import type { PushTarget } from '../../shared/push';
import type { Screen } from './App';
import { feedbackApi } from './feedbackApi';
import { buttonScreen } from './pushTarget';

/**
 * A tap on a button under an answer in a conversation: the screen opens on this device only. The discussions of a merge request named by project and number leave a line
 * in the conversation saying what was opened (main writes it, and only for a button the thread carries), and their Back returns to that conversation.
 */
export function openButton(target: PushTarget, o: { thread: string; hasCards: boolean; back: Screen; go: (s: Screen) => void }): void {
  const next = buttonScreen(target, o.hasCards, o.back);
  if (!next) return;
  // The line is a record, not a gate: the screen opens whether or not it was written.
  if (next.name === 'discussions' && 'project' in next) void feedbackApi.discussionsOpened(o.thread, next.project, next.number).catch(() => undefined);
  o.go(next);
}
