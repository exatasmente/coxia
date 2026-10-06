// What the renderer and the main process both know about the sandbox: whether this machine can make one, and why not. Pure types and constants.

/** Why a sandbox cannot be made here. */
export const SANDBOX_REASONS = ['platform', 'no-bwrap', 'refused', 'no-prlimit', 'no-timeout'] as const;
export type SandboxReason = (typeof SANDBOX_REASONS)[number];

export interface SandboxStatus {
  /** A real sandbox, built the way a stage builds it, ran a harmless command. */
  available: boolean;
  backend: 'bwrap' | null;
  version: string | null;
  reason: SandboxReason | null;
  /** The first line of what the backend said when it refused (for the person to read); empty otherwise. */
  detail: string;
  /** What a sandbox has to test an interface, from the saved settings; it never makes the sandbox unavailable. Absent: not asked. */
  gui?: SandboxGuiStatus;
}

/**
 * Browsers: none set, ready (the folder exists, passes the guards and holds a browser build), missing, refused by the guards, or holding no browser. Display: switched
 * off, a display program on the sandbox's path, or none.
 */
export interface SandboxGuiStatus {
  browsers: 'unset' | 'ready' | 'missing' | 'refused' | 'empty';
  display: 'off' | 'ready' | 'missing';
}

export const SANDBOX_UNAVAILABLE: SandboxStatus = { available: false, backend: null, version: null, reason: 'platform', detail: '' };

/** The longest command text the Shell tool takes (bytes). */
export const SHELL_COMMAND_MAX = 8 * 1024;
