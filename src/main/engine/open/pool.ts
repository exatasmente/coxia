// The pool of models a call may move between. The first half is pure: which list serves a turn, which members of it can take the turn, which one is picked; it
// knows nothing of clients or of the clock. `PoolClient` below puts those choices in front of the clients of the members.
import { ACTIVITIES, type Activity } from '../../../shared/config/types';
import { t } from '../../../shared/i18n';
import { ProviderBusyError } from '../contract';
import type { CallOptions, ChatClient } from './client';
import { EngineError, type ErrorKind, withoutImages } from './errors';
import { type RestRegistry, restRegistry } from './rest';
import { estimateTokens } from './text';
import type { ChatMessage, Completion } from './types';

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

// ---------------------------------------------------------------------------------------------------------------------
// The client of a pool.

/** A model of the pool with the client that talks to it. */
export interface PoolMember extends MemberFacts {
  /** The model as the person reads it. */
  label: string;
  /** The provider id the model is reached through, for messages. */
  provider?: string;
  client: ChatClient;
}

/** What the loop is given besides the model it was started on: its spares, and the complete lists some activities have. */
export interface OpenPool {
  /** The name of the pool in messages (the role). */
  name: string;
  /** The model the loop was started on, as the first entry of the role's list. */
  primary: { key: string; label: string; provider?: string };
  fallbacks: PoolMember[];
  activities?: Partial<Record<Activity, PoolMember[]>>;
}

/** Why a call moved to another model. `resting`: the one in use was already resting from a refusal elsewhere; `activity`: the new list does not hold it. */
export type SwitchReason = 'rate_limit' | 'overloaded' | 'server' | 'resting' | 'activity';

export interface PoolSwitch {
  from: { label: string; provider?: string };
  to: { label: string; provider?: string };
  reason: SwitchReason;
  /** When the model left behind is back (epoch ms); null when it is not resting. */
  until: number | null;
  activity: Activity;
}

/** The refusals that move a call to the next model, after the retries of the client. A timeout does not: the next model would wait as long. */
const BUSY: ReadonlySet<ErrorKind> = new Set(['rate_limit', 'overloaded', 'server']);

export interface PoolClientOptions {
  registry?: RestRegistry;
  onSwitch?: (e: PoolSwitch) => void;
}

/**
 * Calls the model that should answer the turn, and moves to the next one when it is busy. It stays on the model in use until that one refuses, so the prompt cache is
 * lost only on a switch. The reasoning one model wrote never goes to another. A pool of one model is a pass-through: nothing rests and every error is the client's own.
 */
export class PoolClient {
  private readonly lists: PoolLists<PoolMember>;
  private current: PoolMember;
  // Members that said they cannot do tools, for the rest of the session.
  private readonly noTools = new Set<string>();
  // The member that wrote each assistant message, so a reasoning is sent back only to its author.
  private readonly authors = new WeakMap<ChatMessage, string>();
  private readonly registry: RestRegistry;

  constructor(
    readonly primary: PoolMember,
    private readonly pool: OpenPool | undefined,
    private readonly opts: PoolClientOptions = {},
  ) {
    this.registry = opts.registry ?? restRegistry;
    this.current = primary;
    const same = (list: PoolMember[] | undefined): PoolMember[] | undefined => list?.map((m) => (m.key === primary.key ? primary : m));
    const activities: PoolLists<PoolMember>['activities'] = {};
    for (const a of ACTIVITIES) {
      const list = same(pool?.activities?.[a]);
      if (list?.length) activities[a] = list;
    }
    this.lists = { main: [primary, ...(same(pool?.fallbacks) ?? []).filter((m) => m.key !== primary.key)], activities };
  }

  /** False when there is nowhere to move to. */
  get pooled(): boolean {
    return allMembers(this.lists).length > 1;
  }

  /** The model in use. */
  get member(): PoolMember {
    return this.current;
  }

  /** Who would answer a turn now, without calling anyone. */
  peek(need: Need): PoolMember {
    if (!this.pooled) return this.primary;
    return pickMember(this.candidates(need), this.current.key, (k) => this.skipped(k)) ?? this.current;
  }

  /** Marks an assistant message as written by the member that answered. */
  stamp(message: ChatMessage, member: PoolMember): void {
    this.authors.set(message, member.key);
  }

  async complete(o: CallOptions, need: Need): Promise<{ completion: Completion; member: PoolMember }> {
    if (!this.pooled) return { completion: await this.primary.client.complete(o), member: this.primary };
    // Members that refused during this call: they rest app-wide, and are not asked again by it either way.
    const refused = new Map<string, EngineError>();
    let left: { member: PoolMember; reason: SwitchReason; until: number | null } | null = null;
    for (;;) {
      const list = this.candidates(need);
      const pick = pickMember(list, this.current.key, (k) => this.skipped(k) || refused.has(k));
      if (!pick) throw this.busy(list, [...refused.values()].at(-1));
      if (pick.key !== this.current.key) {
        const from = left?.member ?? this.current;
        const resting = this.registry.until(from.key);
        const reason: SwitchReason = left ? left.reason : resting !== null ? 'resting' : 'activity';
        this.current = pick;
        this.opts.onSwitch?.({ from: { label: from.label, provider: from.provider }, to: { label: pick.label, provider: pick.provider }, reason, until: left ? left.until : resting, activity: need.activity });
      }
      left = null;
      try {
        const completion = await pick.client.complete({ ...o, messages: this.viewFor(pick, o.messages) });
        return { completion, member: pick };
      } catch (e) {
        if (e instanceof EngineError && BUSY.has(e.kind)) {
          const until = this.registry.rest(pick.key, e.restMs);
          refused.set(pick.key, e);
          left = { member: pick, reason: e.kind as SwitchReason, until };
          continue;
        }
        // A spare that cannot do tools is dropped from the session; the model the loop started on keeps the loop's own way (it falls back to plain JSON).
        if (e instanceof EngineError && e.kind === 'no_tools' && pick.key !== this.primary.key) {
          this.noTools.add(pick.key);
          continue;
        }
        throw e;
      }
    }
  }

  private skipped(key: string): boolean {
    return this.noTools.has(key) || this.registry.resting(key);
  }

  private candidates(need: Need): PoolMember[] {
    const list = candidatesFor(this.lists, need).filter((m) => !this.noTools.has(m.key));
    // Nothing can take the turn by what is known of the members: the one in use tries, as it would without a pool.
    return list.length ? list : [this.current];
  }

  /** The history as one member may read it: the reasoning of another author left out, and the pictures too when this model is known not to see. */
  private viewFor(member: PoolMember, messages: ChatMessage[]): ChatMessage[] {
    const own = messages.map((m) => {
      if (m.role !== 'assistant' || m.reasoning_content === undefined) return m;
      const author = this.authors.get(m);
      if (author === undefined || author === member.key) return m;
      const { reasoning_content: _gone, ...rest } = m;
      return rest as ChatMessage;
    });
    return member.images === false ? withoutImages(own, t('main.engine.text.noImage')) : own;
  }

  private busy(list: PoolMember[], last: EngineError | undefined): ProviderBusyError {
    const back = list.map((m) => this.registry.until(m.key)).filter((x): x is number => x !== null);
    return new ProviderBusyError(this.pool?.name ?? '', 'open', list.map((m) => m.label), back.length ? Math.min(...back) : null, last?.message ?? '');
  }
}

/** About what a history and its tools weigh now, for the window check of a turn. */
export const weigh = (messages: unknown, tools: unknown): number => estimateTokens(messages) + estimateTokens(tools ?? []);
