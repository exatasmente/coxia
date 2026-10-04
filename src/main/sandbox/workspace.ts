import { join } from 'node:path';
import { ATAS, DATA_ROOT, HOME } from '../env';
import { createSandboxService, type SandboxService } from './index';

// The sandbox of the running workspace's agents. It is made here, not inside a module, so both the runner and the mentions of a thread share one (and a module
// can import it without a cycle). Its folders live under the workspace's data and are the app's own: nothing from an earlier process is kept.

export const sandbox: SandboxService = createSandboxService({ dir: join(ATAS, 'sandbox'), home: HOME, protect: [DATA_ROOT] });
