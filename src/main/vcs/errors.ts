import { type Params, t } from '../../shared/i18n';

export type VcsErrorCode = 'not_configured' | 'no_token' | 'auth' | 'forbidden' | 'not_found' | 'rate_limited' | 'network' | 'timeout' | 'server' | 'invalid' | 'unsupported' | 'cli_missing' | 'upload_needs_api';

// Token shapes that must never reach a message, a log or the audit file, even echoed back by a host or a CLI.
const SECRETS: RegExp[] = [
  /\b(glpat|gldt|glptt|glcbt|ghp|gho|ghu|ghs|ghr|github_pat|ATBB|ATCTT|ATATT|sk-or-v1|sk-ant|sk)[-_][\w-]{8,}/g,
  /\b(Bearer|Basic|token)\s+[\w.~+/=-]{8,}/gi,
  /\b(Authorization|PRIVATE-TOKEN|X-Api-Key)\s*[:=]\s*[^\n]+/gi,
  /([?&](?:access_token|private_token|token)=)[^&\s"']+/gi,
  /(\/\/)[^\s/@:]+:[^\s/@]+@/g,
];

export function scrubSecrets(text: string): string {
  return SECRETS.reduce((out, re) => out.replace(re, (m, p1) => (typeof p1 === 'string' && /^[?&(/]/.test(p1) ? `${p1}[removed]` : '[removed]')), text);
}

/** A failure talking to a code host. The message is already translated and free of secrets; `code` is for the callers that branch. */
export class VcsError extends Error {
  readonly code: VcsErrorCode;
  readonly status: number | null;
  /** Milliseconds to wait before a retry makes sense (rate limits). */
  readonly retryAfterMs: number | null;

  constructor(code: VcsErrorCode, params: Params = {}, extra: { status?: number; retryAfterMs?: number } = {}) {
    const clean = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? scrubSecrets(v) : v]));
    super(t(`vcs.error.${code}`, clean));
    this.name = 'VcsError';
    this.code = code;
    this.status = extra.status ?? null;
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }
}

/** The one-line server explanation out of a JSON error body (message, error_description, error.message...), cut and scrubbed. */
export function serverMessage(body: unknown): string {
  let text = '';
  if (typeof body === 'string') text = body;
  else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const inner = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>).message : b.error;
    const pick = [b.message, b.error_description, inner, b.detail].find((v) => typeof v === 'string' && v);
    text = typeof pick === 'string' ? pick : '';
  }
  return scrubSecrets(text.replace(/\s+/g, ' ').trim()).slice(0, 200);
}
