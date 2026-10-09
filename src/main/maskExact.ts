import type { SecretsStore } from './secrets-core';
import { redact } from './errorlog-core';

// The exact-value mask of a stage that carries the workspace's test environment. The plugin requests keep the same precedent (src/main/plugins/requests.ts):
// every resolved value is taken out in the forms it may come back in — as it is, URL-encoded, JSON-escaped — longest first, and the pattern-based redact runs
// after everything, as the second layer. The maskers are per stage, made at launch and handed through the setter below only by the module that opens the run's
// shells; a stage without entries has none, and its text is masked exactly as before (never process-wide).

/** The forms one value must never appear in, filtered to lengths a mask can act on and ordered longest first so a long form wins over its substrings. */
export function secretForms(value: string): string[] {
  return [...new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])].filter((f) => f.length >= 4).sort((a, b) => b.length - a.length);
}

export type ExactMask = (text: string) => string;

/** The masker of one stage: every form of every resolved entry, then the app's own redaction. */
export function stageMasker(forms: string[]): ExactMask {
  return (text: string): string => redact(forms.reduce((acc, f) => acc.split(f).join('[secret]'), text));
}

/**
 * Builds the masker from the values a stage hands its app under test. Everything the resolver resolved goes through it — a value that never reaches
 * `forms` can never appear unmasked in what the app later reads back, so it comes from the same list the shells were given.
 */
export function maskerFromResolved(values: string[]): ExactMask {
  const forms = [...new Set(values.flatMap((v) => secretForms(v)))].sort((a, b) => b.length - a.length);
  return stageMasker(forms);
}

/**
 * Resolves the secrets of a test environment once and returns the masker over everything it resolved. Callers that turn impossible resolutions into
 * refusals mask the values that did resolve; a value that was refused was never handed out, so it cannot leak into the stage's text.
 */
export function maskerFor(refs: string[], secrets: SecretsStore): { masker: ExactMask; done: string[] } {
  const done: string[] = [];
  for (const ref of refs) {
    try {
      done.push(secrets.resolve(ref));
    } catch {
      // Handled by the resolver, which reports the refusal and drops the entry.
    }
  }
  return { masker: maskerFromResolved(done), done };
}
