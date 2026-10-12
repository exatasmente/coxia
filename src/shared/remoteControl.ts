import { REMOTE_CONTROL_MODES, type RemoteControlMode } from './config/types';

// Who decides whether a session of the app shows up in claude.ai/code (#282). Pure, so every refusal is testable without the SDK or the network: the main process opens
// the bridge only for what `resolveRemoteControl` lets through, and the editor shows the same answer.

/** Where the session is asked from: a stage of a run, a paired browser, or the persona. Only a stage may open one; the other two are refused by name. */
export type RemoteControlOrigin = 'stage' | 'paired' | 'persona';

export type RemoteControlRefusal = 'test-workspace' | 'paired' | 'persona';

export interface RemoteControlAsk {
  /** The agent's own level; absent: off. */
  agent: RemoteControlMode | undefined;
  /** The run's level, when the run says one: it only lowers the agent's, never raises it. Absent: the agent's. */
  run?: RemoteControlMode;
  /** The workspace is a test one (fails closed: an unreadable registry counts as test). */
  test: boolean;
  origin: RemoteControlOrigin;
}

export interface RemoteControlDecision {
  mode: RemoteControlMode;
  /** Which level gave the mode: the agent's, the run's, or neither (nothing was chosen). */
  decidedBy: 'agent' | 'run' | 'default';
  /** Why a level that was asked for does not open: the mode is then `off`. */
  refusal: RemoteControlRefusal | null;
}

/** The position of a level, lowest first; an unknown or absent value counts as off. */
export const remoteControlRank = (mode: RemoteControlMode | undefined): number => Math.max(0, REMOTE_CONTROL_MODES.indexOf(mode ?? 'off'));

/** The level that applies: the lower of the agent's and the run's, then the refusals (the persona, a paired browser, a test workspace) bring it to off. */
export function resolveRemoteControl(ask: RemoteControlAsk): RemoteControlDecision {
  const agent = ask.agent ?? 'off';
  const lowered = ask.run !== undefined && remoteControlRank(ask.run) < remoteControlRank(agent);
  const mode: RemoteControlMode = lowered ? (ask.run as RemoteControlMode) : agent;
  const decidedBy = lowered ? 'run' : ask.agent === undefined ? 'default' : 'agent';
  if (mode === 'off') return { mode, decidedBy, refusal: null };
  const refusal: RemoteControlRefusal | null = ask.origin === 'persona' ? 'persona' : ask.origin === 'paired' ? 'paired' : ask.test ? 'test-workspace' : null;
  return refusal ? { mode: 'off', decidedBy, refusal } : { mode, decidedBy, refusal: null };
}
