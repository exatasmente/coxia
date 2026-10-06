import type { DocsStatus } from '../../shared/harness/status';
import type { Run } from '../../shared/runs';
import { api } from './api';

// Both channels are the desktop window's: webPolicy.ts refuses `docs:*` to a paired browser, and Settings does not show the section there.
export const docsApi = {
  status: () => api.invoke<DocsStatus>('docs:status'),
  /** `apply` is the person's yes to adding the documentation flow and its agent, when the workspace has none. */
  start: (repo: string, mode: 'create' | 'update', apply: boolean) => api.invoke<Run>('docs:start', repo, mode, apply),
};
