import { join } from 'node:path';
import { DATA_ROOT } from './env';

// The folders the app works in, as the host gives them: the desktop fills them from its runtime (electronPorts.ts), a host without a
// desktop gives plain folders (or leaves them out and gets the defaults below). Read at every call, never captured at module load:
// the host may fill the port after this module loads, and the desktop itself may move userData once it starts.

export interface PathsPort {
  /** The app runs from an installed package, not a development checkout. */
  isPackaged(): boolean;
  /** Where an installed package keeps its resources (the runtime's resources folder). Empty when nothing is installed. */
  resources(): string;
  /** Where the app keeps the person's data (the desktop's userData folder). */
  userData(): string;
}

let port: PathsPort | null = null;

/** Fills the folders the host gives. Null goes back to the host-less defaults. */
export function setPathsPort(next: PathsPort | null): void {
  port = next;
}

export const isPackaged = (): boolean => port?.isPackaged() ?? false;

// Packaged: the host's resources folder holds resources/ and sidecar/ next to app.asar (extraResources).
// Dev and everything without a host: they live in the repository, two levels above out/main.
const base = (): string => (isPackaged() ? port?.resources() ?? '' : join(import.meta.dirname, '../..'));

export const resourcesDir = (): string => join(base(), 'resources');
export const sidecarDir = (): string => join(base(), 'sidecar');

// The SDK's native Claude Code binary cannot run from inside app.asar, so it ships unpacked.
export const claudeBin = (): string | undefined => (isPackaged() ? join(base(), 'app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude') : undefined);

// The Playwright MCP server the app's browser drives (run in Node mode by the app's own executable): a real file, so it ships unpacked.
export const playwrightMcpCli = (): string => (isPackaged() ? join(base(), 'app.asar.unpacked/node_modules/@playwright/mcp/cli.js') : join(base(), 'node_modules/@playwright/mcp/cli.js'));

// Where the voice setup puts what it installs: the Python environment, the speech models and the uv it may fetch, all under userData.
// A development checkout may still use its own sidecar/.venv (legacyVenvDir); the setup never writes there.
// Without a host the userData folder is under the data root, the same rule the desktop applies when the data folder is set.
export const userDataDir = (): string => port?.userData() ?? join(DATA_ROOT, 'userData');
export const voiceVenvDir = (): string => join(userDataDir(), 'voice-venv');
export const voiceModelsDir = (): string => join(userDataDir(), 'voice-models');
export const voiceToolsDir = (): string => join(userDataDir(), 'voice-tools');
export const legacyVenvDir = (): string | null => (isPackaged() ? null : join(sidecarDir(), '.venv'));