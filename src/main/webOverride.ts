// What a host fixed for the web door of this process alone: one process per workspace cannot share the saved port, nor the saved public address
// (the saved web settings are the data folder's, common to every workspace). It wins over the saved settings and is never saved. A module of its own
// so the passkeys can read the effective public address without importing the door.
export interface WebOverride {
  host: string;
  port: number;
  /** The public address of this process alone (an `https://` or local `http://` URL, already validated by the host); absent: the saved one. */
  publicUrl?: string;
}

let override: WebOverride | null = null;

export function setWebOverride(next: WebOverride | null): void {
  override = next;
}

export const webOverride = (): WebOverride | null => override;

/** The public address this process answers for: the host's own when it fixed one, else the saved one. */
export const effectivePublicUrl = (saved: string): string => override?.publicUrl ?? saved;
