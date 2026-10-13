import { join } from 'node:path';
import { atasDir, dataRoot, HOME } from '../env';
import { createSandboxService, type SandboxService } from './index';

// The sandbox of the running workspace's agents. It is made here, not inside a module, so both the runner and the mentions of a thread share one (and a module
// can import it without a cycle). Its folders live under the workspace's data and are the app's own: nothing from an earlier process is kept.
// Made at the first use, not at import: the workspace's folder is known once the core has booted.

let service: SandboxService | null = null;
const workspaceSandbox = (): SandboxService => (service ??= createSandboxService({ dir: join(atasDir(), 'sandbox'), home: HOME, protect: [dataRoot()] }));

export const sandbox: SandboxService = {
  status: (force) => workspaceSandbox().status(force),
  open: (o) => workspaceSandbox().open(o),
  openHost: (o) => workspaceSandbox().openHost(o),
  purge: () => workspaceSandbox().purge(),
  guiStatus: (config) => workspaceSandbox().guiStatus(config),
};
