// The pool of models a call may move between. This file is the pure part: which list serves a turn, which members of it can take the turn, which one is picked.
// It knows nothing of clients or of the clock; the callers bring the facts and say who is resting.
import { ACTIVITIES, type Activity } from '../../../shared/config/types';

/** What the choice needs to know of a member. `undefined` is unknown, and unknown is tried. */
export interface MemberFacts {
  /** The key the rest registry knows it by. */
  key: string;
  images?: boolean;
  tools?: boolean;
  contextWindow?: number;
}

/** The role's list (its model first, then its spares) and the complete lists some activities have in place of it. */
export interface PoolLists<M> {
  main: M[];
  activities: Partial<Record<Activity, M[]>>;
}

/** The most demanding result wins: the turn has to be able to answer the hardest thing it was given. */
const PRECEDENCE: readonly Activity[] = ['screen', 'edit', 'shell', 'explore'];

/**
 * The activity of the turn that answers a set of tool results. `tags` are the activities of the tools that were called (`undefined`: the tool has none, as an MCP
 * tool); an image in any result makes it `screen`. A turn that answers nothing tagged (the start of a stage, a delivered message, the closing calls) is `write`.
 */
export function activityOf(tags: readonly (Activity | undefined)[], hadImages: boolean): Activity {
  if (hadImages) return 'screen';
  const seen = new Set(tags);
  return PRECEDENCE.find((a) => seen.has(a)) ?? 'write';
}

/** The list of an activity: its own when it has one, else the role's. */
export function listFor<M>(lists: PoolLists<M>, activity: Activity): M[] {
  const own = lists.activities[activity];
  return own?.length ? own : lists.main;
}

export interface Need {
  activity: Activity;
  /** The session offers tools. */
  tools: boolean;
  /** About what the history weighs now. */
  tokens: number;
}

/**
 * The members of a list that can take the turn. An image-blind member never takes a `screen` turn and a member known not to do tools never takes a session that has
 * them. A window that is known to be too small is passed over while another fits; when none does the rest stay, since the loop compacts what the server refuses.
 */
export function eligible<M extends MemberFacts>(list: readonly M[], need: Need): M[] {
  const capable = list.filter((m) => (need.activity !== 'screen' || m.images !== false) && (!need.tools || m.tools !== false));
  const fits = capable.filter((m) => m.contextWindow === undefined || m.contextWindow >= need.tokens);
  return fits.length ? fits : capable;
}

/**
 * Who can take a turn: the eligible members of the activity's list. A `screen` turn in a pool where no member takes images falls back to the role's list, the way a
 * lone model that cannot see keeps going with a line in place of the picture.
 */
export function candidatesFor<M extends MemberFacts>(lists: PoolLists<M>, need: Need): M[] {
  const out = eligible(listFor(lists, need.activity), need);
  if (out.length || need.activity !== 'screen') return out;
  return eligible(lists.main, { ...need, activity: 'write' });
}

/**
 * Stays on the member in use while it is in the list and not resting, so a change of activity alone costs no cache; otherwise the first of the list that is not
 * resting. null: every one of them is resting.
 */
export function pickMember<M extends MemberFacts>(list: readonly M[], current: string | null, skip: (key: string) => boolean): M | null {
  const stay = current === null ? undefined : list.find((m) => m.key === current && !skip(m.key));
  return stay ?? list.find((m) => !skip(m.key)) ?? null;
}

/** The members that appear in any list, once each, in the order they first appear. */
export function allMembers<M extends MemberFacts>(lists: PoolLists<M>): M[] {
  const seen = new Map<string, M>();
  for (const m of [...lists.main, ...ACTIVITIES.flatMap((a) => lists.activities[a] ?? [])]) if (!seen.has(m.key)) seen.set(m.key, m);
  return [...seen.values()];
}
