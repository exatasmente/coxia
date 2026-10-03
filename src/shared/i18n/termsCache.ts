import type { Language } from '../config/types';
import { CYCLE_VARIANTS, defaultTerms, type Terms } from './terms';

// The renderer keeps the last terms of a workspace so the first paint already says "PR" and not "MR" on GitHub. A cache is only good for the
// workspace and the language it was built for, and only when it still has the shape a Terms has: anything else is ignored. The sequence is
// plain functions with their effects injected, so a test drives it without a window.

const KINDS = ['gitlab', 'github', 'bitbucket'];

interface Stored {
  workspaceId: string;
  language: string;
  terms: unknown;
}

/** Whether a value read back from storage is a Terms of the language: every standard placeholder present, as text, and known cycle variants only. */
export function isTerms(value: unknown, language: Language): value is Terms {
  if (!value || typeof value !== 'object') return false;
  const v = value as { kind?: unknown; flags?: unknown; words?: unknown };
  if (v.kind !== null && !(typeof v.kind === 'string' && KINDS.includes(v.kind))) return false;
  if (!Array.isArray(v.flags) || !v.flags.every((f) => typeof f === 'string' && (CYCLE_VARIANTS as readonly string[]).includes(f))) return false;
  if (!v.words || typeof v.words !== 'object' || Array.isArray(v.words)) return false;
  const words = v.words as Record<string, unknown>;
  return Object.keys(defaultTerms(language).words).every((name) => typeof words[name] === 'string');
}

/** The terms a stored text holds for this workspace and language; null when it is not JSON, not the shape, or built for another workspace or language. */
export function parseTermsCache(raw: string | null, want: { workspaceId: string; language: Language }): Terms | null {
  if (!raw) return null;
  let stored: Stored;
  try {
    stored = JSON.parse(raw) as Stored;
  } catch {
    return null;
  }
  if (!stored || stored.workspaceId !== want.workspaceId || stored.language !== want.language) return null;
  return isTerms(stored.terms, want.language) ? stored.terms : null;
}

export const serializeTermsCache = (workspaceId: string, language: Language, terms: Terms): string => JSON.stringify({ workspaceId, language, terms });

export interface TermsLoaderDeps {
  read: () => string | null;
  write: (text: string) => void;
  setTerms: (terms: Terms) => void;
  resetTerms: () => void;
  getLanguage: () => Language;
}

/**
 * The terms of the renderer's first moments. The cache is applied once the running workspace is known and only if nothing has set the terms
 * yet; the workspace's own view replaces it (and refreshes the cache); a view that failed to load replaces it with the defaults, so words
 * from a cache are never left on screen for good.
 */
export function createTermsLoader(deps: TermsLoaderDeps) {
  let settled = false;
  return {
    /** The running workspace is known: use its cached terms, if there are good ones and the view has not answered yet. */
    workspaceKnown(workspaceId: string): void {
      if (settled) return;
      const cached = parseTermsCache(deps.read(), { workspaceId, language: deps.getLanguage() });
      if (cached) deps.setTerms(cached);
    },
    /** The cycle view of the workspace loaded. */
    fromView(terms: Terms, workspaceId: string | null): void {
      settled = true;
      deps.setTerms(terms);
      if (workspaceId) deps.write(serializeTermsCache(workspaceId, deps.getLanguage(), terms));
    },
    /** The cycle view could not be loaded and none has been: the words are the defaults. */
    viewFailed(): void {
      if (settled) return;
      settled = true;
      deps.resetTerms();
    },
  };
}
