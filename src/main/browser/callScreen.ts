import type { AgentDef } from '../../shared/config/types';
import { rc } from '../workspaceConfig';
import { type ScreenToolset, confirmPortFor } from './engineTool';
import type { AskContext, ScreenAsks } from './asks';
import type { ScreenPlace } from './audit';
import { agentHosts } from '../../shared/network';
import type { AcquireRequest, ScreenLease, ScreenSessions } from './sessions';

// What a call (a stage's, an answer's) takes from the agent's screen: the app's browser when the agent has the switch and the screen opens, and the confirmation tool when the
// call has a display, a host list or the computer's own shell (rule 37 of the spec). One function for every place an agent works, so a stage and a conversation read the same
// rules; the lease it returns is what the caller releases when the call is over.

/** The two services a call asks; absent in a build or a test that has no screens. */
export interface ScreenPorts {
  sessions: ScreenSessions;
  asks: ScreenAsks;
}

export interface CallScreen {
  /** What to give the engine: absent when the call has nothing to offer. */
  toolset?: ScreenToolset;
  /** The screen the call holds; null: it goes without the app's browser. */
  lease: ScreenLease | null;
  /** The call is over. Idempotent, and safe to call when there is no lease. */
  release(): void;
}

/** Whether the agent's engine takes images: the Claude SDK always does, an open engine as its provider says (unknown: no). */
export function modelSeesImages(agent: Pick<AgentDef, 'model'>): boolean {
  try {
    const role = rc().agentModel(agent.model);
    return role.engine === 'claude-sdk' || role.capabilities?.images !== false;
  } catch {
    return false;
  }
}

export interface CallScreenRequest extends AcquireRequest {
  /** The call's shell session carries a display (a QA stage's, a conversation's): the confirmation tool is offered even with no browser. */
  hasDisplay?: boolean;
}

/**
 * Opens the agent's screen for one call and builds what the engine is offered. A refusal (no browser on this computer, a test workspace, the cap) has been said in the thread by
 * the sessions; the call goes on without the browser. The confirmation tool needs no browser: a call with a display, a host list or the computer's shell has it all the same.
 */
export async function openCallScreen(ports: ScreenPorts | null, req: CallScreenRequest): Promise<CallScreen> {
  const none: CallScreen = { lease: null, release: () => undefined };
  if (!ports) return none;
  let lease: ScreenLease | null = null;
  if (req.agent.screen === true) {
    const got = await ports.sessions.acquire(req);
    if (got.ok) lease = got.lease;
  }
  const offered = lease !== null || req.hasDisplay === true || req.display != null || agentHosts(req.agent).length > 0 || req.agent.shell === 'host';
  if (!lease && !offered) return none;
  const context: AskContext =
    lease?.context ?? {
      key: req.key,
      agent: req.agent.id,
      place: req.place as ScreenPlace,
      ...(req.issue ? { issue: req.issue } : {}),
      ...(req.pause ? { pause: req.pause } : {}),
    };
  const toolset: ScreenToolset = {
    ...(lease ? { browser: lease.browser, signal: lease.closed } : {}),
    confirm: confirmPortFor(ports.asks, context),
  };
  return { toolset, lease, release: () => lease?.release() };
}
