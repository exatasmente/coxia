// What the screens and the config know about secrets: names and where each one comes from, never a value.

export type SecretSourceType = 'stored' | 'command' | 'env';
export const SECRET_SOURCE_TYPES: SecretSourceType[] = ['stored', 'command', 'env'];

export const SECRET_REF = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const SECRET_MAX_LENGTH = 8192;

/** How a secret is obtained. A "stored" value lives encrypted in the secrets store; the other two read it from the machine on demand. */
export type SecretSource = { type: 'stored' } | { type: 'command'; command: string; args: string[] } | { type: 'env'; name: string };

/** What a screen may know about one secret. */
export interface SecretInfo {
  ref: string;
  source: SecretSourceType;
  /** The command line or the variable name; empty for a stored value. */
  detail: string;
  updatedAt: string;
  /** Stored: the value can be decrypted here. Env: the variable is set. Command: the executable exists (it is not run to find out). */
  available: boolean;
}

/** How stored values are protected on this machine. */
export interface SecretsStorageStatus {
  /** The OS keychain protects stored values (Electron safeStorage with a real backend). */
  secure: boolean;
  /** The keychain backend, when the platform reports one ("gnome_libsecret", "kwallet", "basic_text"...). */
  backend: string | null;
  /** The user accepted keeping stored values in a plain-text file (mode 0600) because no keychain is available. */
  insecureAccepted: boolean;
  /** A new stored value can be written right now. */
  canStore: boolean;
}

/** Where to get a secret: what a config import asks the user for, and what the screen sends back. */
export type SecretInput = { ref: string; source: 'stored'; value: string } | { ref: string; source: 'command'; command: string; args?: string[] } | { ref: string; source: 'env'; name: string };
