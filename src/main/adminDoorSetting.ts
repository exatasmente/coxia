import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Whether the desktop opens the local admin door (#309): a setting of this computer, kept in the data root beside the other settings that are not a workspace's. Off unless the person
// switched it on in the window; anything unreadable reads as off. A headless core decides this with its own flag and never reads the file.

export const ADMIN_DOOR_FILE = 'admin-door.json';

export function readAdminDoorSetting(root: string): boolean {
  try {
    return (JSON.parse(readFileSync(join(root, ADMIN_DOOR_FILE), 'utf8')) as { enabled?: unknown }).enabled === true;
  } catch {
    return false;
  }
}

export function writeAdminDoorSetting(root: string, enabled: boolean): void {
  mkdirSync(root, { recursive: true });
  const file = join(root, ADMIN_DOOR_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify({ enabled }, null, 1), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
