import { AsyncLocalStorage } from 'node:async_hooks';

// What a call from a paired browser carries for the passkey step-up: the device the session belongs to, the page's origin and the assertion the page obtained
// for this call (header X-Coxia-Assertion). Absent for the window, the admin socket and the persona's act. Kept apart from rpc.ts and passkeyStepUp.ts so neither imports the other.
export interface StepUpContext {
  deviceId: string;
  assertionId?: string;
  origin?: string;
}

export const stepUpContext = new AsyncLocalStorage<StepUpContext>();
