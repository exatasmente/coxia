import { openersOf } from '../shared/cycles/prompts';
import { t } from '../shared/i18n';
import { retentionLabel, type RetentionKind } from '../shared/retention';

export const DAY = 86_400_000;
// A transcript touched this recently may still be in use, whatever the retention says.
export const RECENT_MS = DAY;
export const APP_ENTRYPOINT = 'sdk-ts';

// A session belongs to the app only when its first prompt starts like one the app sends (the prompt catalogs, src/shared/i18n: every language
// and family). Anything else, including sessions that look similar, is the user's own work and is never listed.
const APP_PROMPTS: [string, string][] = [
  ['turn.main', 'turn'],
  ['deep.intro', 'unblock'],
  ['gate.start', 'gate'],
  ['gate.answer', 'gate'],
  ['gate.explain', 'gate'],
  ['gate.visual', 'gate'],
  ['gate.round', 'gate'],
  ['qa.prepare', 'qa'],
  ['qa.ask', 'qa'],
  ['retro.main', 'retro'],
  ['retro.ask', 'retro'],
  ['teams.main', 'teams'],
  ['conflict.comment', 'sync'],
  ['conflict.ask.intro', 'sync'],
  ['reentry.main', 'reentry'],
  ['discussion.main', 'review'],
  ['deep.options', 'unblock'],
  ['reply.main', 'turn'],
  ['assist.round', 'assist'],
  ['assist.review', 'assist'],
];

export function appPromptKind(firstPrompt: string | null | undefined): string | null {
  if (!firstPrompt) return null;
  const kind = APP_PROMPTS.find(([id]) => openersOf(id).some((re) => re.test(firstPrompt)))?.[1];
  return kind ? t(`main.retention.app.${kind}`) : null;
}

export interface RetentionRef {
  sessionId: string;
  // When the thing that mentions the session was last alive (ms).
  at: number;
  // The thing that mentions it is marked to be kept: the session is too, whatever the age.
  keep: boolean;
  from: string;
}

export interface RetentionFile {
  kind: RetentionKind;
  path: string;
  size: number;
  mtimeMs: number;
  // Session transcripts only.
  sessionId?: string;
  firstPrompt?: string | null;
  // Every entrypoint found in the transcript: a session the user resumed in the CLI has more than the SDK's.
  entrypoints?: string[];
  // Data files only: the user asked to keep it.
  keep?: boolean;
}

export interface Verdict {
  file: RetentionFile;
  remove: boolean;
  reason: string;
}

export interface Selection {
  remove: Verdict[];
  keep: Verdict[];
}

function when(ms: number, now: number): string {
  const d = Math.floor((now - ms) / DAY);
  return t('main.retention.unchanged', { count: d });
}

function name(path: string): string {
  return path.split('/').slice(-1)[0];
}

export function selectRetention(files: RetentionFile[], refs: RetentionRef[], opts: { now: number; days: number }): Selection {
  const { now, days } = opts;
  const cutoff = now - days * DAY;
  const out: Selection = { remove: [], keep: [] };
  const decide = (file: RetentionFile, remove: boolean, reason: string) => (remove ? out.remove : out.keep).push({ file, remove, reason });

  for (const file of files) {
    if (file.kind !== 'sessoes') {
      if (file.keep) decide(file, false, t('main.retention.marked'));
      else if (now - file.mtimeMs < RECENT_MS) decide(file, false, t('main.retention.recentFile'));
      else if (file.mtimeMs >= cutoff) decide(file, false, t('main.retention.inTime'));
      else decide(file, true, `${retentionLabel(file.kind).toLowerCase()}, ${when(file.mtimeMs, now)}`);
      continue;
    }

    const kind = appPromptKind(file.firstPrompt);
    if (!kind) {
      decide(file, false, t('main.retention.notAppPrompt'));
      continue;
    }
    const foreign = (file.entrypoints ?? []).filter((e) => e !== APP_ENTRYPOINT);
    if (!(file.entrypoints ?? []).includes(APP_ENTRYPOINT)) {
      decide(file, false, t('main.retention.notAppSdk'));
      continue;
    }
    if (foreign.length) {
      decide(file, false, t('main.retention.continued', { entrypoints: foreign.join(', ') }));
      continue;
    }
    if (now - file.mtimeMs < RECENT_MS) {
      decide(file, false, t('main.retention.recentSession'));
      continue;
    }
    if (file.mtimeMs >= cutoff) {
      decide(file, false, t('main.retention.inTime'));
      continue;
    }
    const live = refs.find((r) => r.sessionId === file.sessionId && (r.keep || r.at >= cutoff));
    if (live) {
      decide(file, false, t('main.retention.usedBy', { from: live.from }));
      continue;
    }
    decide(file, true, t('main.retention.removeSession', { kind, when: when(file.mtimeMs, now) }));
  }
  return out;
}

export function entrypointsOf(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/"entrypoint":"([^"]*)"/g)) found.add(m[1]);
  return [...found];
}

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

export function fileName(path: string): string {
  return name(path);
}
