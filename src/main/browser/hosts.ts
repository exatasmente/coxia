import type { ProxyDecision } from '../sandbox/proxy';

// What the proxy of the app's browser decided, kept as counts. A page opens dozens of tunnels and the browser makes some of its own (updates, sync), so one line per tunnel
// would flood the conversation and the audit log: the thread gets one line the first time a host is refused while a call is in flight, the agent is told which hosts a call
// ran into, and the audit log gets one summary when the screen closes.

/** The name a decision is counted under when the request named no host at all (a method that is not CONNECT, a malformed head). */
export const NO_HOST = '(not a tunnel)';
const OTHER = '(other hosts)';

export interface HostsSummary {
  allowed: Record<string, number>;
  refused: Record<string, number>;
}

export interface HostsTallyOptions {
  /** Told once per host, the first time it is refused while a call is in flight: why a page broke. Never during the browser's own idle traffic. */
  onFirstRefusal?: (host: string, why: string) => void;
  /** The most distinct hosts counted by name; the rest are counted together. */
  maxHosts?: number;
}

export interface HostsTally {
  /** The proxy's `onDecision`. */
  decide(d: ProxyDecision): void;
  /** Marks the start of a call; the function it returns ends it and gives the hosts refused while it ran, once each, in order. */
  beginCall(): () => string[];
  summary(): HostsSummary;
  /** Decisions counted so far, allowed and refused. */
  readonly total: number;
}

export function createHostsTally(o: HostsTallyOptions = {}): HostsTally {
  const maxHosts = o.maxHosts ?? 60;
  const allowed = new Map<string, number>();
  const refused = new Map<string, number>();
  const told = new Set<string>();
  const live = new Set<{ hosts: string[] }>();
  let total = 0;

  const bump = (map: Map<string, number>, host: string): void => {
    // A page that reaches hundreds of hosts is counted by name only up to a bound: the rest add up under one name.
    const key = map.has(host) || map.size < maxHosts ? host : OTHER;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  return {
    decide(d) {
      total++;
      const host = d.host || NO_HOST;
      if (d.allowed) return bump(allowed, host);
      bump(refused, host);
      for (const call of live) if (!call.hosts.includes(host) && call.hosts.length < 8) call.hosts.push(host);
      if (live.size && !told.has(host)) {
        told.add(host);
        try {
          o.onFirstRefusal?.(host, d.why);
        } catch {
          // A failing line in the thread must not decide anything.
        }
      }
    },
    beginCall() {
      const call = { hosts: [] as string[] };
      live.add(call);
      let ended = false;
      return () => {
        if (!ended) {
          ended = true;
          live.delete(call);
        }
        return call.hosts;
      };
    },
    summary: () => ({ allowed: Object.fromEntries(allowed), refused: Object.fromEntries(refused) }),
    get total() {
      return total;
    },
  };
}
