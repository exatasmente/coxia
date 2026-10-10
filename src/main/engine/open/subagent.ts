// The sub-agents of kind that `delegate` mode hands work to. A kind says which tools the sub-agent has (those of the principal that carry the kind's activities, never
// more), how many turns it gets, and which model list it runs on. Everything here is pure: `loop.ts` runs the sub-agent.
import type { Activity, ScoreOverrides } from '../../../shared/config/types';
import type { Capabilities } from './loop';
import type { MemberParams, OpenPool, PoolMember } from './pool';
import type { ChatClient } from './client';
import type { ToolImpl } from './tools/types';

export const SUB_KINDS = ['explore', 'edit', 'shell', 'screen'] as const;
export type SubKind = (typeof SUB_KINDS)[number];

export const isSubKind = (v: unknown): v is SubKind => typeof v === 'string' && (SUB_KINDS as readonly string[]).includes(v);

/** The activities of the tools a sub-agent of a kind has: its own, and the reading ones to look around with. */
export const KIND_ACTIVITIES: Record<SubKind, readonly Activity[]> = {
  explore: ['explore'],
  edit: ['explore', 'edit'],
  shell: ['explore', 'shell'],
  screen: ['explore', 'screen'],
};

/** Turns a sub-agent of each kind gets; running out is an error the principal reads and decides on. */
export const KIND_TURNS: Record<SubKind, number> = { explore: 12, edit: 30, shell: 20, screen: 30 };

/** The kinds that change something, one at a time: two of them at once would be two hands on the same worktree (or the same screen). */
export const MUTATING_KINDS: ReadonlySet<SubKind> = new Set(['edit', 'shell', 'screen']);

/**
 * The tools of a sub-agent of a kind: those of the principal that carry one of the kind's activities. A filter over what the principal already has, so the result is
 * always a subset of it; a tool with no activity (an MCP tool, the evidence, release and procedure tools, the messages) stays with the principal, and so does `Agent`.
 */
export function toolsOfKind<T extends Pick<ToolImpl, 'name' | 'activity'>>(kind: SubKind, tools: readonly T[]): T[] {
  const own = new Set<Activity>(KIND_ACTIVITIES[kind]);
  return tools.filter((x) => x.name !== 'Agent' && x.activity !== undefined && own.has(x.activity));
}

export interface OfferInput {
  /** The lists some activities have in the pool. */
  lists: Partial<Record<Activity, readonly unknown[]>> | undefined;
  /** The tools the principal has (without `Agent`). */
  tools: readonly Pick<ToolImpl, 'name' | 'activity'>[];
  /** The principal changes files in a worktree (it is not a reader). */
  writes: boolean;
}

/**
 * The kinds worth offering. `explore` always; the others only when the activity has a list of its own and the principal has a tool of that kind, so the model is never
 * offered what would do nothing. A reader (an agent that does not change files) is offered neither `edit` nor `shell`.
 */
export function offeredKinds(o: OfferInput): SubKind[] {
  const has = (a: Activity): boolean => (o.lists?.[a]?.length ?? 0) > 0 && o.tools.some((x) => x.activity === a && x.name !== 'Agent');
  return SUB_KINDS.filter((k) => k === 'explore' || (k === 'screen' ? has('screen') : o.writes && has(k)));
}

/** What a sub-agent of a kind runs on: its list is the pool of its own, the first model that can use tools first. */
export interface KindModel {
  client: ChatClient;
  capabilities: Capabilities;
  params?: MemberParams;
  pool: OpenPool;
}

export function modelOfKind(kind: SubKind, pool: OpenPool | undefined): KindModel | null {
  const list = pool?.activities?.[kind];
  if (!pool || !list?.length) return null;
  const first: PoolMember = list.find((m) => m.tools !== false) ?? list[0];
  const overrides: ScoreOverrides | undefined = pool.scoreOverrides;
  return {
    client: first.client,
    ...(first.params ? { params: first.params } : {}),
    capabilities: { ...(first.tools !== undefined ? { tools: first.tools } : {}), ...(first.contextWindow !== undefined ? { contextWindow: first.contextWindow } : {}), ...(first.images !== undefined ? { images: first.images } : {}) },
    // Its pool is the list: a busy model hands the call to the next of the list, and the call stays where it is (`fallback`), never moving by activity.
    pool: { name: pool.name, primary: { key: first.key, label: first.label, provider: first.provider }, fallbacks: list.filter((m) => m.key !== first.key), mode: 'fallback', ...(overrides ? { scoreOverrides: overrides } : {}) },
  };
}
