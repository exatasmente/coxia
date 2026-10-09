import { recordWrite } from '../auditoria';
import { ATAS } from '../env';
import type { Module } from '../module';
import { getConfig } from '../workspaceConfig';
import { createProcedureChannels } from './channels';
import { createProcedureStore } from './store';

// The channels of the Procedures view. `list`, `get` and `stats` are reads and open to a paired browser; `save`, `delete`, `review` and `restore` are the desktop
// window's. webPolicy.ts (PROCEDURES_WRITE) denies the whole `procedures:` prefix except those three reads, so a channel added here later is closed from the day it
// exists. test/procedures-policy.test.ts reads this file and fails when a channel it registers is not classified. There is no channel for the agents' tools: they are in
// process (coxia_procedures).

export const proceduresModule: Module = (ctx) => {
  const c = createProcedureChannels({ store: createProcedureStore(ATAS), config: getConfig, audit: recordWrite });
  ctx.handle('procedures:list', () => c.list());
  ctx.handle('procedures:get', (id: unknown) => c.get(id));
  ctx.handle('procedures:stats', () => c.stats());
  ctx.handle('procedures:save', (id: unknown, revision: unknown, input: unknown) => c.save(id, revision, input));
  ctx.handle('procedures:delete', (id: unknown) => c.delete(id));
  ctx.handle('procedures:review', (id: unknown) => c.review(id));
  ctx.handle('procedures:restore', (id: unknown, revision: unknown) => c.restore(id, revision));
};
