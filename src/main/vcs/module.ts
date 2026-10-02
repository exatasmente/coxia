import type { VcsProbeRequest } from '../../shared/vcs';
import type { Module } from '../module';
import { vcsRuntimeDeps } from './index';
import { probeVcs } from './probe';

// The channel the setup wizard tests an integration with. Desktop only (webPolicy.ts): it accepts a token typed in the screen.
export const vcsModule: Module = (ctx) => {
  ctx.handle('vcs:probe', (request: VcsProbeRequest) => probeVcs(request, vcsRuntimeDeps()));
};
