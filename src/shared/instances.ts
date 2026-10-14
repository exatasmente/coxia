import type { SecretInput, SecretsStorageStatus } from './secrets';

// The instances the desktop can connect to (#211): the core on this computer, or a Coxia instance on a server reached through SSH. Nothing here reaches the main process.

/** The id of "run the core here", which is always there. */
export const LOCAL_INSTANCE = 'local';

/** The module event that carries the connection state to the window. */
export const INSTANCE_EVENT = 'instance:state';

/** Where the data of a server's instance is, when the person does not say. */
export const DEFAULT_REMOTE_DATA_DIR = '/var/lib/coxia/data';

/** How the desktop reaches the instance: `server` runs `coxia-server bridge <workspace>` over SSH (the admin socket belongs to the service user, not to the SSH user); `socket` forwards the admin socket itself, for a core run by the SSH user. */
export type InstanceVia = 'server' | 'socket';

/** One instance of the person's list. The SSH key is never here: only the name of the secret that holds it. */
export interface InstanceDef {
  id: string;
  name: string;
  /** user@host or user@host:port. */
  sshTarget: string;
  remoteDataDir: string;
  /** The workspace of that instance the desktop works in. */
  workspace: string;
  /** The ref, in this computer's secrets store, of the private key. */
  keyRef: string;
  via: InstanceVia;
}

export interface InstancesFile {
  /** LOCAL_INSTANCE, or the id of the instance this computer connects to at the next start. */
  current: string;
  list: InstanceDef[];
}

/** What the person types to add one; the key goes into the secrets store under a ref the app chooses. */
export interface InstanceInput {
  name: string;
  sshTarget: string;
  remoteDataDir?: string;
  workspace: string;
  /** Defaults to `server`. */
  via?: InstanceVia;
  key: Omit<SecretInput, 'ref'>;
}

export type LinkState = 'connecting' | 'connected' | 'reconnecting' | 'lost';

/** What the window shows about the instance it is connected to. `instance` is null while the core runs here. */
export interface InstanceStatus {
  instance: { id: string; name: string } | null;
  link: LinkState;
  /** From the instance's `ownership:status`; null before it answered. */
  role: 'owner' | 'client' | null;
  /** Why the link is not up, in words for the person. */
  detail: string;
}

export interface InstancesView {
  /** The instance this process runs against. */
  running: string;
  /** The one the next start uses. */
  current: string;
  list: InstanceDef[];
  status: InstanceStatus;
  storage: SecretsStorageStatus;
}

export type InstanceTest =
  | { ok: true; workspace: string; role: 'owner' | 'client'; owner: string }
  | { ok: false; code: 'host-unknown'; fingerprints: string[] }
  | { ok: false; code: 'failed'; message: string };

export interface SshTarget {
  user: string;
  host: string;
  port: number;
}

/** user@host[:port]; null when it is not one. The host is a name or an address, never an option for ssh. */
export function parseSshTarget(raw: string): SshTarget | null {
  const m = /^([A-Za-z_][A-Za-z0-9_.-]{0,63})@([A-Za-z0-9][A-Za-z0-9.-]{0,252})(?::(\d{1,5}))?$/.exec(raw.trim());
  if (!m) return null;
  const port = m[3] ? Number(m[3]) : 22;
  if (port < 1 || port > 65535) return null;
  return { user: m[1] as string, host: m[2] as string, port };
}
