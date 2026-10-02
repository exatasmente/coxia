import type { Card } from './types';

export type WatcherKind = 'gate' | 'rejections' | 'postmortem';

export interface WatcherAlert {
  // Stable per condition: dismissing an id hides exactly that condition, a changed condition gets a new id.
  id: string;
  kind: WatcherKind;
  ref: string;
  iid: string;
  title: string;
  message: string;
  detail: string | null;
  // Only gate alerts: the card the Gate screen opens with.
  card: Card | null;
  since: string;
}
