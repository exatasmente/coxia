import { ContractError } from '../shared/contract';
import { t } from '../shared/i18n';
import { stepUpContext } from './passkeyContext';
import { viaOf } from './rpc';

/**
 * What a passkey step-up is asked for. Closed list: an assertion is bound to one kind, so one made for a secret cannot move the budget.
 *  - secret: the secrets store and the confirmations of the test environment
 *  - permission: raising what an agent may do, the configuration that decides it, a plugin's grant
 *  - budget: the spending limits (#198 calls `requireSensitive('budget')` in its own handler)
 *  - infrastructure: destroying or lowering the guard of a workspace (a later issue's destructive channels join it)
 *  - ownership: handing a workspace to another owner (#209 calls `requireSensitive('ownership')`)
 *  - pairing: pairing, renaming-by-revocation and configuring the door itself
 *  - passkey: removing a passkey
 */
export const SENSITIVE_KINDS = ['secret', 'permission', 'budget', 'infrastructure', 'ownership', 'pairing', 'passkey'] as const;
export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];
export const isSensitiveKind = (v: unknown): v is SensitiveKind => typeof v === 'string' && (SENSITIVE_KINDS as readonly string[]).includes(v);

/** The refusal of a call that needs a passkey: the page reads `kind` from the answer to ask for an assertion of that kind. */
export class StepUpRequired extends ContractError {
  constructor(readonly kind: SensitiveKind, message: string) {
    super('passkey-required', message);
  }
}

/** What the passkey module offers the hook: spend a fresh assertion for a device and kind, and say whether a device has a passkey. Absent until the module registers. */
interface Hooks {
  spend(deviceId: string, assertionId: string, kind: SensitiveKind): boolean;
  hasPasskey(deviceId: string): boolean;
}
let hooks: Hooks | null = null;
export const setPasskeyHooks = (next: Hooks | null): void => {
  hooks = next;
};

/** True for a call of a paired browser whose device has a registered passkey: an admin device (webPolicy.ts), whose sensitive changes ask for the step-up. */
export function isAdminDevice(): boolean {
  const ctx = stepUpContext.getStore();
  return viaOf() === 'paired' && !!ctx && !!hooks?.hasPasskey(ctx.deviceId);
}

/**
 * The one hook a handler (or the web door's channel list) calls before a sensitive change. A call from a paired browser must carry a fresh assertion made for this kind
 * (single use) or it is refused with `passkey-required`, and the page asks the person for the passkey and retries once.
 *
 * Not asked of: the desktop window and the local admin socket, because they are the machine itself (the person at the window or the shell of the server already
 * holds every key the app has, and an existing install with no passkey must not lock itself out), and the persona's act, which the person confirms before it runs.
 * `context` is a short word for the refusal message (which change was asked for), never a value.
 */
export function requireSensitive(kind: SensitiveKind, context?: string): void {
  if (viaOf() !== 'paired') return;
  const ctx = stepUpContext.getStore();
  if (ctx?.assertionId && hooks?.spend(ctx.deviceId, ctx.assertionId, kind)) return;
  throw new StepUpRequired(kind, t('main.passkey.required', { kind, context: context ?? kind }));
}
