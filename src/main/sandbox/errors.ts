import { t } from '../../shared/i18n';

export const SANDBOX_ERROR_CODES = ['unavailable', 'no-node', 'copy-too-big', 'path-missing', 'path-refused', 'start-failed'] as const;
export type SandboxErrorCode = (typeof SANDBOX_ERROR_CODES)[number];

/** A sandbox that cannot be made, for a reason the person can act on; the message is in the catalog (`main.sandbox.error.<code>`). */
export class SandboxError extends Error {
  constructor(
    readonly code: SandboxErrorCode,
    params: Record<string, string | number> = {},
  ) {
    super(t(`main.sandbox.error.${code}`, params));
    this.name = 'SandboxError';
  }
}
