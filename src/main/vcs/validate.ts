import { t } from '../../shared/i18n';
import type { VcsKind } from '../../shared/config/types';
import type { AuditKind } from '../../shared/auditoria';
import { validateBitbucketCommand } from './bitbucket';
import { validateGitHubCommand } from './github';
import { validateGitLabCommand } from './gitlab';
import type { VcsCommand } from './types';

// Judging a write command without a provider instance: the confirmation flow checks a proposal when it is made and again, from disk,
// when it is approved. The shape rules live next to each provider; this only routes to them.

const VALIDATORS: Record<VcsKind, (c: VcsCommand) => void> = {
  gitlab: validateGitLabCommand,
  github: validateGitHubCommand,
  bitbucket: validateBitbucketCommand,
};

/** The provider a command belongs to: an action saved before providers existed carries none and is GitLab's. */
export function commandKind(c: VcsCommand): VcsKind {
  return c.vcs ?? 'gitlab';
}

/** Throws the translated reason when the command is not one the app may run. */
export function validateVcsCommand(c: VcsCommand): void {
  const validate = VALIDATORS[commandKind(c)];
  if (!validate) throw new Error(t('vcs.validate.provider', { kind: String(c.vcs) }));
  validate(c);
}

export function auditKindOf(c: VcsCommand): AuditKind {
  return c.endpoint === 'graphql' ? 'graphql' : commandKind(c);
}

/** The fields the audit log keeps: the form fields plus the JSON body when there is one. */
export function auditFieldsOf(c: VcsCommand): Record<string, string> {
  return c.json === undefined ? c.fields : { ...c.fields, body: c.json };
}
