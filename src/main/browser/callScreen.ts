import type { AgentDef, RunnerSandbox } from '../../shared/config/types';
import type { HandoffPaths } from '../../shared/handoff';
import { text as cycleWord } from '../cyclePrompts';
import type { BeginInput, CallHandoff, HandoffService } from '../screen/handoff';
import { type ScreenPrompt, refusalText, screenPromptOf } from '../runner/screenPrompt';
import type { ScreenGrants } from './guard';
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
  /** The hand-off of the screen to the person (#178); absent, or null before the app has it: no call is offered the tool. */
  handoff?: HandoffService | null;
}

export interface CallScreen {
  /** What to give the engine: absent when the call has nothing to offer. */
  toolset?: ScreenToolset;
  /** The screen the call holds; null: it goes without the app's browser. */
  lease: ScreenLease | null;
  /** Why the agent has no browser, in words, when it has the switch and the screen could not be had; null otherwise. */
  refusal: string | null;
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
  const none: CallScreen = { lease: null, refusal: null, release: () => undefined };
  if (!ports) return none;
  let lease: ScreenLease | null = null;
  let refusal: string | null = null;
  if (req.agent.screen === true) {
    const got = await ports.sessions.acquire(req);
    if (got.ok) lease = got.lease;
    else refusal = refusalText(got.why, got.detail);
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
  return { toolset, lease, refusal, release: () => lease?.release() };
}

/**
 * What the agent is told of its screen on this call: the facts of the call (the browser it got, or why it did not; the hosts the workspace let through; whether its shell
 * session carries a display), or nothing for an agent with neither the switch nor a host list.
 */
export function promptFor(screen: CallScreen | null, agent: Pick<AgentDef, 'screen' | 'shell' | 'browserProfile'>, workspace: Pick<RunnerSandbox, 'network' | 'registryHosts'>, granted: Pick<ScreenGrants, 'allowedHosts'>, display: boolean): ScreenPrompt | undefined {
  return screenPromptOf({
    agent,
    workspace,
    allowedHosts: granted.allowedHosts,
    browser: screen?.lease ? { tools: screen.lease.browser.tools().map((x) => x.name), profile: screen.lease.profile } : screen?.refusal ? { refusal: screen.refusal } : null,
    display,
    confirm: !!screen?.toolset?.confirm,
    handoff: !!screen?.toolset?.handoff,
  });
}

/** What a call holds of the hand-off from its start: the call object, and the paths its warning is worded from (filled in once the call knows what it has). */
export interface CallHandoffOffer {
  call: CallHandoff;
  paths: HandoffPaths;
}

/**
 * Starts the hand-off of a call, before its shell session is opened (the session reads the call's gate and mask). Null when the app has no hand-off service. What the call has
 * of the browser and the shell is not known yet; `offerHandoff` says it, and until then the warning would word it from the agent's switches.
 */
export function beginHandoff(service: HandoffService | null | undefined, agent: Pick<AgentDef, 'id' | 'name' | 'shell'>, input: Omit<BeginInput, 'agent' | 'agentName' | 'paths'>): CallHandoffOffer | null {
  if (!service) return null;
  const paths: HandoffPaths = { browser: false, shell: agent.shell === 'host' ? 'host' : agent.shell === 'sandbox' ? 'sandbox' : 'none' };
  return { call: service.begin({ ...input, agent: agent.id, agentName: cycleWord(agent.name), paths }), paths };
}

/**
 * Puts the hand-off tool on the call's toolset, with the call's typed values beside it, when the screen can be taken by the person (it is registered with the live hub). The
 * paths of the warning are set from what the call really has: the app's browser, and the shell session it runs commands in. A call with nothing live is left as it was.
 */
export function offerHandoff(screen: CallScreen | null, offer: CallHandoffOffer | null, has: { live: boolean; session: boolean; host: boolean }): void {
  if (!screen?.toolset || !offer || !has.live) return;
  offer.paths.browser = screen.lease !== null;
  offer.paths.shell = !has.session ? 'none' : has.host ? 'host' : 'sandbox';
  screen.toolset = { ...screen.toolset, handoff: { request: offer.call.request, active: offer.call.active }, typed: offer.call.typed };
}
