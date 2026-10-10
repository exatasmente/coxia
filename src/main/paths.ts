import { join } from 'node:path';
import { app } from 'electron';

// Packaged: electron-builder copies resources/, sidecar/ and plugins/ next to app.asar (extraResources).
// Dev: they live in the repository, two levels above out/main.
// Outside Electron (tests, scripts) there is no app: treat as development.
export const PACKAGED = app?.isPackaged ?? false;
const BASE = PACKAGED ? process.resourcesPath : join(import.meta.dirname, '../..');

export const RESOURCES = join(BASE, 'resources');
export const SIDECAR_DIR = join(BASE, 'sidecar');
// The plugin declarations that come with the app: read-only, no code, and the person's own plugins folder is read first.
export const PLUGINS_BUILT_IN_DIR = join(BASE, 'plugins');

// The SDK's native Claude Code binary cannot run from inside app.asar, so it ships unpacked.
export const CLAUDE_BIN = PACKAGED
  ? join(process.resourcesPath, 'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude')
  : undefined;

// The Playwright MCP server the app's browser drives (run in Node mode by the app's own executable): a real file, so it ships unpacked.
export const PLAYWRIGHT_MCP_CLI = PACKAGED ? join(process.resourcesPath, 'app.asar.unpacked/node_modules/@playwright/mcp/cli.js') : join(BASE, 'node_modules/@playwright/mcp/cli.js');

// Where the voice setup puts what it installs: the Python environment, the speech models and the uv it may fetch, all under userData.
// A development checkout may still use its own sidecar/.venv (legacyVenvDir); the setup never writes there.
// Functions, not constants: index.ts may move userData (CERIMONIAS_DATA_DIR) after this module loads.
export const voiceVenvDir = (): string => join(app.getPath('userData'), 'voice-venv');
export const voiceModelsDir = (): string => join(app.getPath('userData'), 'voice-models');
export const voiceToolsDir = (): string => join(app.getPath('userData'), 'voice-tools');
export const legacyVenvDir = (): string | null => (PACKAGED ? null : join(SIDECAR_DIR, '.venv'));
