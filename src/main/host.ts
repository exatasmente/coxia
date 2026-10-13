import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../shared/i18n';
import { appPath } from './paths';
import type { EncoderEnv } from './screen/encoderHost';
import type { NativeImageLike } from './screen/frame';

// What only the owner of the process does: say its version, end it, start it again, ask the person for a file, encode the agents' screen.
// The desktop fills this from its runtime (electronPorts.ts); a host without a desktop gives what it has, and a feature whose port is absent
// answers with HostUnavailableError instead of reaching for a runtime that is not there. Read at every call, never captured at module load:
// the modules load before the desktop fills the port.

/** One file or folder the person picks, as the desktop's native dialogs ask for it. */
export interface PickRequest {
  mode: 'open-file' | 'open-dir' | 'save';
  title: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  /** Hidden files are listed too (an SSH key, a dotfile). */
  showHidden?: boolean;
}

/** The agents' screen: the JPEG encoder of a frame and the hidden window that records. Only the desktop has them. */
export interface ScreenPort {
  nativeImage: NativeImageLike;
  encoderEnv(): EncoderEnv;
}

export interface HostPort {
  /** The version of the app that runs. */
  version(): string;
  /** Ends the process with this code. */
  exit(code: number): void;
  /** Ends the process and starts a fresh one in its place (changing workspace). Absent where something else starts the process. */
  restart?(): void;
  /** The path the person picked, or null when they cancelled. Absent without a desktop. */
  pick?(request: PickRequest): Promise<string | null>;
  screen?: ScreenPort;
}

export type HostFeature = 'restart' | 'pick' | 'screen';

/** A feature that needs the desktop, asked of a host that has none: absent, not broken. The code is stable for every client. */
export class HostUnavailableError extends Error {
  readonly code = 'host-unavailable';
  constructor(readonly feature: HostFeature) {
    super(t(`main.host.unavailable.${feature}`));
    this.name = 'HostUnavailableError';
  }
}

// Without a host: the version written in the app's own package.json (what the desktop runtime reads too), and a plain exit.
let packageVersion: string | null = null;
const withoutHost: HostPort = {
  version: () => (packageVersion ??= String((JSON.parse(readFileSync(join(appPath(), 'package.json'), 'utf8')) as { version?: unknown }).version ?? '')),
  exit: (code) => process.exit(code),
};

let port: HostPort | null = null;

/** Fills what the host gives. Null goes back to the host-less defaults. */
export function setHostPort(next: HostPort | null): void {
  port = next;
}

const host = (): HostPort => port ?? withoutHost;

export const appVersion = (): string => host().version();
export const exitProcess = (code: number): void => host().exit(code);

/** Throws when the host lacks the feature: a channel checks before it changes anything it could not finish. */
export function requireHost(feature: HostFeature): void {
  const h = host();
  if (!(feature === 'screen' ? h.screen : h[feature])) throw new HostUnavailableError(feature);
}

export function restartProcess(): void {
  const h = host();
  if (!h.restart) throw new HostUnavailableError('restart');
  h.restart();
}

export function pickPath(request: PickRequest): Promise<string | null> {
  const h = host();
  if (!h.pick) return Promise.reject(new HostUnavailableError('pick'));
  return h.pick(request);
}

/** The agents' screen, or null where the host has none: the screen hub then stays off. */
export const screenPort = (): ScreenPort | null => host().screen ?? null;
