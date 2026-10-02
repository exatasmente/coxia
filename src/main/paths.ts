import { join } from 'node:path';
import { app } from 'electron';

// Packaged: electron-builder copies resources/ and sidecar/ next to app.asar (extraResources).
// Dev: they live in the repository, two levels above out/main.
export const PACKAGED = app.isPackaged;
const BASE = PACKAGED ? process.resourcesPath : join(import.meta.dirname, '../..');

export const RESOURCES = join(BASE, 'resources');
export const SIDECAR_DIR = join(BASE, 'sidecar');

// The SDK's native Claude Code binary cannot run from inside app.asar, so it ships unpacked.
export const CLAUDE_BIN = PACKAGED
  ? join(process.resourcesPath, 'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude')
  : undefined;

// Dev keeps the venv next to the script; the installed app builds its own under userData.
export const VENV_DIR = PACKAGED ? join(app.getPath('userData'), 'voice-venv') : join(SIDECAR_DIR, '.venv');
