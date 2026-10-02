// Pure parts of the update machinery (no Electron, no disk): settings, feed checks, mode detection, release notes, schedule.
import { join } from 'node:path';
import {
  DEFAULT_UPDATE_SETTINGS,
  INTERVAL_MAX_HOURS,
  INTERVAL_MIN_HOURS,
  UPDATE_CHANNELS,
  UPDATE_MODE_SETTINGS,
  type ModeInfo,
  type UpdateChannel,
  type UpdateSettings,
} from '../shared/updates';
import { QUIT_FLAG } from './update-core';

// ---- settings --------------------------------------------------------------------------------------------------------------------

/** Reads the stored file tolerantly: anything unknown falls back to the default, numbers are clamped. */
export function normalizeSettings(raw: unknown): UpdateSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const hours = Number(r.intervalHours);
  return {
    auto: typeof r.auto === 'boolean' ? r.auto : DEFAULT_UPDATE_SETTINGS.auto,
    channel: UPDATE_CHANNELS.includes(r.channel as UpdateChannel) ? (r.channel as UpdateChannel) : DEFAULT_UPDATE_SETTINGS.channel,
    intervalHours: Number.isFinite(hours) ? Math.min(INTERVAL_MAX_HOURS, Math.max(INTERVAL_MIN_HOURS, Math.round(hours))) : DEFAULT_UPDATE_SETTINGS.intervalHours,
    mode: UPDATE_MODE_SETTINGS.includes(r.mode as never) ? (r.mode as UpdateSettings['mode']) : DEFAULT_UPDATE_SETTINGS.mode,
    fetchSource: typeof r.fetchSource === 'boolean' ? r.fetchSource : DEFAULT_UPDATE_SETTINGS.fetchSource,
  };
}

/** What a save accepts: a wrong type or value is an error, not a silent fallback. Returns the problem as a catalog key, or null. */
export function settingsProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return 'updates.error.settings';
  const r = raw as Record<string, unknown>;
  if (typeof r.auto !== 'boolean' || typeof r.fetchSource !== 'boolean') return 'updates.error.settings';
  if (!UPDATE_CHANNELS.includes(r.channel as UpdateChannel)) return 'updates.error.channel';
  if (!UPDATE_MODE_SETTINGS.includes(r.mode as never)) return 'updates.error.mode';
  if (!Number.isInteger(r.intervalHours) || (r.intervalHours as number) < INTERVAL_MIN_HOURS || (r.intervalHours as number) > INTERVAL_MAX_HOURS) return 'updates.error.interval';
  return null;
}

// ---- the updater's configuration ---------------------------------------------------------------------------------------------------

export interface UpdaterConfig {
  channel: string;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
}

// stable follows latest*.yml and never a pre-release; beta follows beta*.yml (and pre-release tags on GitHub). electron-updater switches
// allowDowngrade on by itself when a channel is set: it is forced off here, so a channel change never moves the app to an older version.
// Only the explicit "go back to the stable version" check passes allowDowngrade.
export function updaterConfig(channel: UpdateChannel, allowDowngrade = false): UpdaterConfig {
  return {
    channel: channel === 'beta' ? 'beta' : 'latest',
    allowPrerelease: channel === 'beta',
    allowDowngrade,
    autoDownload: true,
    autoInstallOnAppQuit: true,
  };
}

export interface ConfigurableUpdater {
  channel: string | null;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
}

export function applyUpdaterConfig(updater: ConfigurableUpdater, config: UpdaterConfig): void {
  // Order matters: the channel setter turns allowDowngrade on, and the prerelease flag can too.
  updater.channel = config.channel;
  updater.allowPrerelease = config.allowPrerelease;
  updater.allowDowngrade = config.allowDowngrade;
  updater.autoDownload = config.autoDownload;
  updater.autoInstallOnAppQuit = config.autoInstallOnAppQuit;
}

// ---- the feed (app-update.yml, written by electron-builder from `publish`) --------------------------------------------------------------

export interface FeedConfig {
  provider: string;
  [key: string]: string;
}

/** app-update.yml is a flat `key: value` file. */
export function parseAppUpdateYml(text: string): FeedConfig | null {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out.provider ? (out as FeedConfig) : null;
}

export type FeedProblem = 'missing' | 'placeholder' | 'insecure' | 'unsupported';

const PLACEHOLDER = /^(OWNER|REPO|YOUR[_-].*|<.*>)$/i;

export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127(\.\d{1,3}){3}|\[::1\]|::1)$/i.test(host);
}

// Updates come over HTTPS only (plain HTTP only to this machine, which is what the local end-to-end test uses), from a feed that is
// actually configured: the placeholders in electron-builder.yml never reach the network.
export function feedProblem(feed: FeedConfig | null): FeedProblem | null {
  if (!feed) return 'missing';
  if (feed.provider === 'github') {
    if (!feed.owner || !feed.repo || PLACEHOLDER.test(feed.owner) || PLACEHOLDER.test(feed.repo)) return 'placeholder';
    if (feed.protocol && feed.protocol.toLowerCase() !== 'https') return 'insecure';
    return null;
  }
  if (feed.provider === 'generic') {
    if (!feed.url) return 'missing';
    let url: URL;
    try {
      url = new URL(feed.url);
    } catch {
      return 'unsupported';
    }
    if (PLACEHOLDER.test(url.hostname) || /\.invalid$|\.example$/i.test(url.hostname)) return 'placeholder';
    if (url.protocol === 'https:') return null;
    return url.protocol === 'http:' && isLoopbackHost(url.hostname) ? null : 'insecure';
  }
  return 'unsupported';
}

// ---- where the app came from -------------------------------------------------------------------------------------------------------

/** What scripts/install-local.sh leaves behind: the source tree the installed AppImage was built from. */
export interface SourceRecord {
  source: string;
  appImage: string | null;
}

export const sourceRecordName = 'install-source.json';

export function parseSourceRecord(text: string): SourceRecord | null {
  try {
    const data = JSON.parse(text) as { source?: unknown; appImage?: unknown };
    if (typeof data.source !== 'string' || !data.source.startsWith('/')) return null;
    return { source: data.source, appImage: typeof data.appImage === 'string' && data.appImage ? data.appImage : null };
  } catch {
    return null;
  }
}

export function sourceRecordPath(stateDir: string): string {
  return join(stateDir, sourceRecordName);
}

export interface ModeInputs {
  packaged: boolean;
  platform: NodeJS.Platform;
  /** process.env.APPIMAGE: set when the app runs from an AppImage. */
  appImage: string | undefined;
  feed: FeedConfig | null;
  /** The record install-local.sh left (or CERIMONIAS_SOURCE_DIR); `sourceUsable`: its folder is a work tree of a repository (the caller looked). */
  source: SourceRecord | null;
  sourceUsable: boolean;
  /** The mode setting: auto, or the person's override. */
  override: 'auto' | 'release' | 'source';
}

function releasePossible(i: ModeInputs): ModeInfo {
  const signing = i.platform !== 'linux';
  if (i.platform === 'linux' && !i.appImage) return { mode: 'package', reason: 'package', selfUpdate: false, requiresSigning: false };
  const problem = feedProblem(i.feed);
  if (problem) return { mode: 'none', reason: `feed-${problem}`, selfUpdate: false, requiresSigning: signing };
  return { mode: 'release', reason: 'release', selfUpdate: true, requiresSigning: signing };
}

function sourceMode(i: ModeInputs, why: string): ModeInfo {
  if (!i.source || !i.sourceUsable) return { mode: 'none', reason: i.source ? 'source-missing' : 'source-unknown', selfUpdate: false, requiresSigning: false };
  return { mode: 'source', reason: why, selfUpdate: false, requiresSigning: false };
}

// An install made by scripts/install-local.sh (its record points at this very AppImage and at a source tree that still exists) is a
// source install: it updates by rebuilding that tree. Anything else packaged is a published build.
export function detectMode(i: ModeInputs): ModeInfo {
  if (!i.packaged) return { mode: 'dev', reason: 'dev', selfUpdate: false, requiresSigning: false };
  if (i.override === 'source') return sourceMode(i, 'forced-source');
  if (i.override === 'release') {
    const info = releasePossible(i);
    return info.mode === 'release' ? { ...info, reason: 'forced-release' } : info;
  }
  const recordIsOurs = !!i.source && (!i.source.appImage || !i.appImage || i.source.appImage === i.appImage);
  if (recordIsOurs && i.sourceUsable) return { mode: 'source', reason: 'source', selfUpdate: false, requiresSigning: false };
  return releasePossible(i);
}

// ---- release notes ----------------------------------------------------------------------------------------------------------------

export const MAX_NOTES_CHARS = 4000;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

function htmlToText(html: string): string {
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

// GitHub gives HTML, a latest*.yml gives plain text or markdown, and a list for a full changelog. The screen shows plain text
// (React escapes it), so this strips the markup, tidies the blank lines and caps the size.
export function releaseNotesText(notes: unknown): string | null {
  let raw = '';
  if (typeof notes === 'string') raw = notes;
  else if (Array.isArray(notes)) {
    raw = notes
      .map((n) => (n && typeof n === 'object' ? `${(n as { version?: string }).version ?? ''}\n${(n as { note?: string | null }).note ?? ''}` : ''))
      .join('\n\n');
  }
  const text = htmlToText(raw)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  return text.length > MAX_NOTES_CHARS ? `${text.slice(0, MAX_NOTES_CHARS - 1).trimEnd()}…` : text;
}

// ---- schedule ---------------------------------------------------------------------------------------------------------------------

export const STARTUP_CHECK_DELAY_MS = 30_000;
export const SOURCE_POLL_MS = 30 * 60_000;
// A focus event right after a check does not check again.
export const FOCUS_MIN_GAP_MS = 60_000;

/** When the next published-release check should run: at the end of the interval since the last one, never sooner than the startup delay. */
export function nextCheckDelay(lastCheckAt: number | null, now: number, intervalHours: number): number {
  const due = lastCheckAt === null ? 0 : lastCheckAt + intervalHours * 3_600_000 - now;
  return Math.max(STARTUP_CHECK_DELAY_MS, due);
}

export function focusCheckDue(lastCheckAt: number | null, now: number): boolean {
  return lastCheckAt === null || now - lastCheckAt >= FOCUS_MIN_GAP_MS;
}

// ---- relaunch ---------------------------------------------------------------------------------------------------------------------

/** The arguments the new instance starts with: what this one had (a debugging port, a user-data-dir), shown, not in the tray. */
export function relaunchArgs(argv: readonly string[]): string[] {
  return argv.slice(1).filter((a) => a !== '--hidden' && a !== QUIT_FLAG);
}

// The helper runs detached: it waits until the old instance (and its AppImage mount) is gone, so the single-instance lock is free, and starts
// the installed AppImage. A new instance started by the installer while the old one still holds the lock would just quit.
// It first closes every descriptor it inherited from the app (like scripts/update.sh does): files inside the old AppImage mount would keep
// that mount busy, and the old debugging port or listening socket would stay bound to a process that is gone.
// i18n-ignore: shell script
export const RELAUNCH_SCRIPT = `for fd in /proc/$$/fd/*; do
  case "\${fd##*/}" in 0|1|2|255) ;; *) eval "exec \${fd##*/}>&-" 2>/dev/null || true ;; esac
done
pid="$1"; app="$2"; shift 2
i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 200 ]; do sleep 0.3; i=$((i+1)); done
exec nohup "$app" "$@" >/dev/null 2>&1 </dev/null`;

// ---- the toast marker ---------------------------------------------------------------------------------------------------------------

/** The marker a published-release install leaves: the next start announces it once, if it really runs that version now. */
export function releaseMarker(version: string, at: string): string {
  return `${JSON.stringify({ version, at })}\n`;
}

