import { type ReactNode, useId } from 'react';
import type { SecretSourceType, SecretsStorageStatus } from '../../../shared/secrets';
import { SECRET_SOURCE_TYPES } from '../../../shared/secrets';
import type { SecretDraft } from '../../../shared/wizard';
import { useT } from '../i18n';
import './wizard.css';

export type Tone = 'info' | 'warn' | 'error' | 'ok';

export function Notice({ tone = 'info', children, role }: { tone?: Tone; children: ReactNode; role?: 'status' | 'alert' }) {
  return (
    <div className={`wz-note wz-note-${tone}`} role={role ?? (tone === 'error' ? 'alert' : undefined)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="wz-field">
      <label className="wz-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <div className="small muted">{hint}</div>}
    </div>
  );
}

export function Chip({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return <span className={`wz-chip ${ok === true ? 'wz-chip-ok' : ok === false ? 'wz-chip-no' : ''}`}>{ok === true ? '✓ ' : ok === false ? '✗ ' : ''}{children}</span>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

interface SecretFieldsProps {
  draft: SecretDraft;
  onChange: (next: SecretDraft) => void;
  storage: SecretsStorageStatus;
  onAcceptInsecure: () => void;
  /** What the secret is, for the labels ("chave de API", "token"). */
  noun: string;
  /** Pre-filled hint for the environment variable name. */
  envHint?: string;
  disabled?: boolean;
}

/** Where a key or token is kept: stored here, read from an environment variable, or the output of a command. Never shown again after saving. */
export function SecretFields({ draft, onChange, storage, onAcceptInsecure, noun, envHint, disabled }: SecretFieldsProps) {
  const t = useT();
  const id = useId();
  const set = (patch: Partial<SecretDraft>) => onChange({ ...draft, ...patch });
  const pick = (source: SecretSourceType) => set({ source });
  return (
    <div className="wz-secret">
      <div role="group" aria-label={t('wizard.secret.where', { noun })} className="wz-pills">
        {SECRET_SOURCE_TYPES.map((s) => (
          <button key={s} type="button" disabled={disabled} aria-pressed={draft.source === s} className={`filter ${draft.source === s ? 'on' : ''}`} onClick={() => pick(s)}>
            {t(`wizard.secret.source.${s}`)}
          </button>
        ))}
      </div>
      {draft.source === 'stored' && (
        <>
          {!storage.canStore && (
            <Notice tone="warn">
              <div>{t('wizard.secret.noKeychain')}</div>
              <div className="wz-actions">
                <button type="button" className="btn" disabled={disabled} onClick={onAcceptInsecure}>{t('wizard.secret.acceptInsecure')}</button>
              </div>
            </Notice>
          )}
          <Field label={t('wizard.secret.value', { noun })} htmlFor={`${id}-v`} hint={storage.canStore ? t(storage.secure ? 'wizard.secret.storedSecure' : 'wizard.secret.storedInsecure') : undefined}>
            <input id={`${id}-v`} className="text-input mono" type="password" autoComplete="off" spellCheck={false} disabled={disabled || !storage.canStore} value={draft.value} onChange={(e) => set({ value: e.target.value })} />
          </Field>
        </>
      )}
      {draft.source === 'env' && (
        <Field label={t('wizard.secret.envName')} htmlFor={`${id}-e`} hint={t('wizard.secret.envHint')}>
          <input id={`${id}-e`} className="text-input mono" autoComplete="off" spellCheck={false} placeholder={envHint ?? 'MY_API_KEY'} disabled={disabled} value={draft.envName} onChange={(e) => set({ envName: e.target.value })} />
        </Field>
      )}
      {draft.source === 'command' && (
        <Field label={t('wizard.secret.command')} htmlFor={`${id}-c`} hint={t('wizard.secret.commandHint')}>
          <input id={`${id}-c`} className="text-input mono" autoComplete="off" spellCheck={false} placeholder="pass show my/key" disabled={disabled} value={draft.command} onChange={(e) => set({ command: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

/** Message for the reason a secret draft was refused. */
export function secretProblemKey(problem: string): string {
  return `wizard.secret.problem.${problem}`;
}
