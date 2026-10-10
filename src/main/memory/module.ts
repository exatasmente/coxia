import { recordWrite } from '../auditoria';
import type { Module } from '../module';
import { forumStore } from '../forum';
import { setCeremonyMemory } from './ceremony';
import { callOrigin } from '../rpc';
import { getConfig } from '../workspaceConfig';
import { MEMORY_EVENT } from '../../shared/memoryView';
import { memoryOn } from '../../shared/memory';
import { createMemoryChannels } from './channels';
import { memoryStore, onMemoryChange } from './instance';
import { memoryFacts, memoryPort } from './runtime';

// The channels of the Memory view. All six are open to a paired browser on purpose (gate 1: the phone has the desktop's capabilities over the memory, ahead of #218), and
// webPolicy.ts names them (MEMORY_CHANNELS) with a pattern that denies any other `memory:` channel, so one added here later is closed until somebody classifies it.
// test/memory-policy.test.ts reads this file and fails when a channel it registers is not classified. There is no channel for the agents' tools: they are in process.

export const memoryModule: Module = (ctx) => {
  onMemoryChange(() => ctx.emit({ type: 'module', name: MEMORY_EVENT, payload: null }));
  // The ceremonies read the memory through a door registered here (askAgent has no dependency object), read only and from the cache: the facts are warmed now, so the first
  // voice turn finds the version already read. Both are inert while the workspace's switch is off.
  setCeremonyMemory((ask) => memoryPort().open({ surface: 'ceremony', agent: ask.agent, conversation: null, writes: false, tools: ask.tools, cacheOnly: true }));
  if (memoryOn(getConfig())) void memoryFacts().warm().catch(() => undefined);
  const c = createMemoryChannels({
    store: memoryStore(),
    config: getConfig,
    audit: recordWrite,
    via: () => (callOrigin() === 'web' ? 'paired' : 'window'),
    titleOf: (conversation) => forumStore().summary(conversation)?.title ?? null,
  });
  ctx.handle('memory:list', () => c.list());
  ctx.handle('memory:read', (conversation: unknown, agent: unknown, id: unknown) => c.read(conversation, agent, id));
  ctx.handle('memory:save', (conversation: unknown, agent: unknown, id: unknown, revision: unknown, patch: unknown) => c.save(conversation, agent, id, revision, patch));
  ctx.handle('memory:review', (conversation: unknown, agent: unknown, id: unknown) => c.review(conversation, agent, id));
  ctx.handle('memory:remove', (conversation: unknown, agent: unknown, id: unknown) => c.remove(conversation, agent, id));
  ctx.handle('memory:remove-folder', (conversation: unknown, agent?: unknown) => c.removeFolder(conversation, agent));
};
